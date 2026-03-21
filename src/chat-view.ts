import { ItemView, WorkspaceLeaf, TFile, MarkdownRenderer, Component } from "obsidian"; // TFile used in openFile()
import type RecallLocusPlugin from "./main";
import { Agent, AgentEvent } from "./agent";
import { SearchResult } from "./recall-locus-client";

export const VIEW_TYPE_RL_CHAT = "rl-chat";

interface Turn {
	role: "user" | "assistant";
	content: string;
	steps?: StepRecord[];
	error?: string;
}

interface StepRecord {
	type: "search" | "open_file";
	thought: string;
	query?: string;
	doc_id?: string;
	source?: string;
	results?: SearchResult[];
	resultCount?: number;
}

export interface ChatSession {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	turns: Turn[];
}

export class RecallLocusChatView extends ItemView {
	private plugin: RecallLocusPlugin;
	private currentSession: ChatSession | null = null;
	private activeAgent?: Agent;

	// DOM refs
	private rootEl: HTMLElement;
	private sessionsScreenEl: HTMLElement;
	private chatScreenEl: HTMLElement;
	private messagesEl: HTMLElement;
	private inputEl: HTMLTextAreaElement;
	private sendBtn: HTMLButtonElement;
	private stopBtn: HTMLButtonElement;
	private chatTitleEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: RecallLocusPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE_RL_CHAT; }
	getDisplayText() { return "RecallLocus Chat"; }
	getIcon() { return "message-square"; }

	async onOpen() { this.buildUI(); }
	async onClose() { this.activeAgent?.cancel(); }

	refreshSettings() {
		this.rootEl?.querySelectorAll<HTMLElement>(".rl-space-label").forEach((el) => {
			const s = this.plugin.settings.spaceName;
			el.setText(s || "no space set");
			el.toggleClass("rl-space-unset", !s);
		});
	}

	// ---------------------------------------------------------------------------
	// UI construction
	// ---------------------------------------------------------------------------

	private buildUI() {
		this.rootEl = this.containerEl.children[1] as HTMLElement;
		this.rootEl.empty();
		this.rootEl.addClass("rl-chat-root");

		this.sessionsScreenEl = this.rootEl.createDiv("rl-sessions-screen");
		this.chatScreenEl = this.rootEl.createDiv("rl-chat-screen");
		this.buildChatScreen();

		this.showSessionsList();
	}

	private buildSessionsScreen() {
		this.sessionsScreenEl.empty();

		const header = this.sessionsScreenEl.createDiv("rl-chat-header");
		header.createEl("span", { text: "RecallLocus Chat", cls: "rl-chat-title" });
		const spaceEl = header.createEl("span", { cls: "rl-space-label" });
		const s = this.plugin.settings.spaceName;
		spaceEl.setText(s || "no space set");
		spaceEl.toggleClass("rl-space-unset", !s);

		const newBtn = this.sessionsScreenEl.createEl("button", { text: "+ New Chat", cls: "rl-new-chat-btn" });
		newBtn.addEventListener("click", () => this.newSession());

		const list = this.sessionsScreenEl.createDiv("rl-sessions-list");
		const sessions = this.plugin.chatSessions ?? [];
		const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

		if (!sorted.length) {
			list.createDiv({ text: "No chats yet. Start a new one!", cls: "rl-sessions-empty" });
		} else {
			for (const session of sorted) {
				const item = list.createDiv("rl-session-item");
				const info = item.createDiv("rl-session-info");
				info.createDiv({ text: session.title, cls: "rl-session-title" });
				info.createDiv({ text: new Date(session.updatedAt).toLocaleDateString(), cls: "rl-session-date" });
				const delBtn = item.createEl("button", { text: "×", cls: "rl-session-delete" });
				delBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					this.deleteSession(session.id);
				});
				item.addEventListener("click", () => this.openSession(session));
			}
		}
	}

	private buildChatScreen() {
		this.chatScreenEl.empty();

		const header = this.chatScreenEl.createDiv("rl-chat-header");
		const backBtn = header.createEl("button", { text: "←", cls: "rl-back-btn" });
		backBtn.addEventListener("click", () => this.showSessionsList());
		this.chatTitleEl = header.createEl("span", { text: "", cls: "rl-chat-session-title" });
		const spaceEl = header.createEl("span", { cls: "rl-space-label" });
		const s = this.plugin.settings.spaceName;
		spaceEl.setText(s || "no space set");
		spaceEl.toggleClass("rl-space-unset", !s);

		this.messagesEl = this.chatScreenEl.createDiv("rl-chat-messages");

		const inputRow = this.chatScreenEl.createDiv("rl-chat-input-row");
		this.inputEl = inputRow.createEl("textarea", {
			placeholder: "Ask anything about your notes…",
			cls: "rl-chat-input",
		});
		this.inputEl.rows = 2;
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.submit();
			}
		});

		const btnGroup = inputRow.createDiv("rl-chat-btns");
		this.sendBtn = btnGroup.createEl("button", { text: "Send", cls: "rl-send-btn" });
		this.sendBtn.addEventListener("click", () => this.submit());

		this.stopBtn = btnGroup.createEl("button", { text: "Stop", cls: "rl-stop-btn" });
		this.stopBtn.style.display = "none";
		this.stopBtn.addEventListener("click", () => {
			this.activeAgent?.cancel();
			this.setRunning(false);
		});
	}

	private showSessionsList() {
		this.activeAgent?.cancel();
		this.currentSession = null;
		this.buildSessionsScreen();
		this.sessionsScreenEl.style.display = "";
		this.chatScreenEl.style.display = "none";
	}

	private newSession() {
		const now = Date.now();
		const session: ChatSession = {
			id: `chat-${now}`,
			title: "New Chat",
			createdAt: now,
			updatedAt: now,
			turns: [],
		};
		if (!this.plugin.chatSessions) this.plugin.chatSessions = [];
		this.plugin.chatSessions.push(session);
		this.openSession(session);
	}

	private openSession(session: ChatSession) {
		this.currentSession = session;
		this.buildChatScreen();
		this.chatTitleEl.setText(session.title);

		// Restore existing turns
		for (const turn of session.turns) {
			if (turn.role === "user") {
				const el = this.messagesEl.createDiv("rl-msg-user");
				el.createDiv({ text: turn.content, cls: "rl-msg-user-bubble" });
			} else {
				const wrapper = this.messagesEl.createDiv("rl-msg-assistant");
				const bubble = new AssistantBubble(wrapper, this.app, this);
				if (turn.content) bubble.restoreAnswer(turn.content, (path) => this.openFile(path));
				if (turn.error) bubble.showError(turn.error);
			}
		}

		this.sessionsScreenEl.style.display = "none";
		this.chatScreenEl.style.display = "";
		this.scrollToBottom();
		this.inputEl.focus();
	}

	private deleteSession(id: string) {
		this.plugin.chatSessions = (this.plugin.chatSessions ?? []).filter((s) => s.id !== id);
		this.plugin.saveChatSessions();
		this.buildSessionsScreen();
	}

	// ---------------------------------------------------------------------------
	// Submit
	// ---------------------------------------------------------------------------

	private async submit() {
		const question = this.inputEl.value.trim();
		if (!question || this.activeAgent) return;

		const { spaceName, recallLocusUrl, ollamaUrl, chatModel } = this.plugin.settings;
		if (!spaceName) { this.showError("Set a space name in RecallLocus settings first."); return; }
		if (!chatModel) { this.showError("Set a chat model in RecallLocus settings first."); return; }
		if (!this.currentSession) return;

		this.inputEl.value = "";

		// Set title from first user message
		if (this.currentSession.turns.length === 0) {
			this.currentSession.title = question.length > 50 ? question.slice(0, 50) + "…" : question;
			this.chatTitleEl.setText(this.currentSession.title);
		}

		this.addUserTurn(question);
		this.setRunning(true);

		const turn: Turn = { role: "assistant", content: "", steps: [] };
		this.currentSession.turns.push(turn);
		const bubble = this.renderAssistantBubble(turn);

		this.activeAgent = new Agent({ locusUrl: recallLocusUrl, ollamaUrl, space: spaceName, model: chatModel });

		await this.activeAgent.run(question, (event: AgentEvent) => {
			this.handleEvent(event, turn, bubble);
		});

		this.activeAgent = undefined;
		this.setRunning(false);

		this.currentSession.updatedAt = Date.now();
		this.plugin.saveChatSessions();
	}

	// ---------------------------------------------------------------------------
	// Event handler — updates the live bubble
	// ---------------------------------------------------------------------------

	private handleEvent(event: AgentEvent, turn: Turn, bubble: AssistantBubble) {
		switch (event.type) {
			case "thinking":
				bubble.setThinking(true);
				break;

			case "search": {
				bubble.setThinking(false);
				const step: StepRecord = { type: "search", thought: event.thought, query: event.query };
				turn.steps!.push(step);
				bubble.addStep(step);
				break;
			}

			case "search_results": {
				const step = turn.steps!.find((s) => s.query === event.query && s.type === "search");
				if (step) {
					step.results = event.results;
					step.resultCount = event.results.length;
					bubble.updateStepResults(event.query, event.results.length);
				}
				break;
			}

			case "open_file": {
				bubble.setThinking(false);
				const step: StepRecord = { type: "open_file", thought: "", doc_id: event.doc_id };
				turn.steps!.push(step);
				bubble.addOpenFileStep(step);
				break;
			}

			case "open_file_done": {
				const step = turn.steps!.find((s) => s.type === "open_file" && s.doc_id === event.doc_id);
				if (step) step.source = event.source;
				bubble.resolveOpenFileStep(event.doc_id, event.source);
				break;
			}

			case "answer_start":
				bubble.setThinking(false);
				bubble.collapseSteps();
				bubble.startAnswer();
				break;

			case "answer_token":
				bubble.appendToken(event.token);
				turn.content += event.token;
				break;

			case "answer_done":
				bubble.finishAnswer((path) => this.openFile(path));
				break;

			case "error":
				bubble.setThinking(false);
				bubble.showError(event.message);
				turn.error = event.message;
				break;
		}
	}

	// ---------------------------------------------------------------------------
	// Rendering helpers
	// ---------------------------------------------------------------------------

	private addUserTurn(text: string) {
		this.currentSession!.turns.push({ role: "user", content: text });
		const el = this.messagesEl.createDiv("rl-msg-user");
		el.createDiv({ text, cls: "rl-msg-user-bubble" });
		this.scrollToBottom();
	}

	private renderAssistantBubble(_turn: Turn): AssistantBubble {
		const wrapper = this.messagesEl.createDiv("rl-msg-assistant");
		const bubble = new AssistantBubble(wrapper, this.app, this);
		this.scrollToBottom();
		return bubble;
	}

	private showError(msg: string) {
		const el = this.messagesEl.createDiv("rl-msg-error");
		el.setText(msg);
		this.scrollToBottom();
	}

	private setRunning(running: boolean) {
		this.sendBtn.style.display = running ? "none" : "";
		this.stopBtn.style.display = running ? "" : "none";
		this.inputEl.disabled = running;
	}

	private scrollToBottom() {
		setTimeout(() => {
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		}, 0);
	}

	async openFile(path: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf) await leaf.openFile(file);
		}
	}
}

// ---------------------------------------------------------------------------
// AssistantBubble — manages a single assistant turn's DOM
// ---------------------------------------------------------------------------

class AssistantBubble extends Component {
	private stepsEl: HTMLElement;
	private stepsToggle: HTMLElement;
	private stepsBody: HTMLElement;
	private thinkingEl: HTMLElement;
	private answerEl: HTMLElement;
	private sourcesEl: HTMLElement;
	private stepEls: Map<string, HTMLElement> = new Map();
	private app: ReturnType<typeof Object>;
	private view: RecallLocusChatView;

	constructor(root: HTMLElement, app: unknown, view: RecallLocusChatView) {
		super();
		this.app = app as ReturnType<typeof Object>;
		this.view = view;

		// Thinking indicator
		this.thinkingEl = root.createDiv("rl-thinking");
		this.thinkingEl.createSpan({ cls: "rl-thinking-dot" });
		this.thinkingEl.createSpan({ cls: "rl-thinking-dot" });
		this.thinkingEl.createSpan({ cls: "rl-thinking-dot" });
		this.thinkingEl.style.display = "none";

		// Step trace (collapsible)
		this.stepsEl = root.createDiv("rl-steps");
		this.stepsToggle = this.stepsEl.createDiv("rl-steps-toggle");
		this.stepsBody = this.stepsEl.createDiv("rl-steps-body");
		this.stepsToggle.addEventListener("click", () => {
			const open = this.stepsBody.style.display !== "none";
			this.stepsBody.style.display = open ? "none" : "";
			this.stepsToggle.toggleClass("rl-steps-collapsed", open);
		});
		this.updateStepsToggle();

		// Answer
		this.answerEl = root.createDiv("rl-answer");

		// Sources
		this.sourcesEl = root.createDiv("rl-sources");
	}

	setThinking(on: boolean) {
		this.thinkingEl.style.display = on ? "flex" : "none";
	}

	addStep(step: StepRecord) {
		const el = this.stepsBody.createDiv("rl-step");
		el.createSpan({ text: "🔍", cls: "rl-step-icon" });
		const textEl = el.createSpan({ cls: "rl-step-text" });
		textEl.createSpan({ text: step.query ?? "", cls: "rl-step-query" });
		el.createSpan({ text: "…", cls: "rl-step-badge" });
		this.stepEls.set(step.query ?? "", el);
		this.updateStepsToggle();
	}

	updateStepResults(query: string, count: number) {
		const el = this.stepEls.get(query);
		if (!el) return;
		const badge = el.querySelector(".rl-step-badge") as HTMLElement;
		if (badge) badge.setText(`${count} found`);
		el.toggleClass("rl-step-empty", count === 0);
	}

	addOpenFileStep(step: StepRecord) {
		const el = this.stepsBody.createDiv("rl-step");
		el.dataset.docId = step.doc_id ?? "";
		el.createSpan({ text: "📄", cls: "rl-step-icon" });
		el.createSpan({ text: "fetching full document…", cls: "rl-step-query rl-step-fetching" });
		this.stepEls.set(`open_file:${step.doc_id}`, el);
		this.updateStepsToggle();
	}

	resolveOpenFileStep(doc_id: string, source?: string) {
		const el = this.stepEls.get(`open_file:${doc_id}`);
		if (!el) return;
		const label = el.querySelector(".rl-step-fetching") as HTMLElement | null;
		if (label) label.setText(source ?? doc_id);
		el.createSpan({ text: "✓", cls: "rl-step-badge" });
	}

	collapseSteps() {
		this.stepsBody.style.display = "none";
		this.stepsToggle.addClass("rl-steps-collapsed");
		this.updateStepsToggle();
	}

	startAnswer() {
		this.answerEl.empty();
		this.answerEl.addClass("rl-answer-streaming");
	}

	appendToken(token: string) {
		// Append raw text; we'll render markdown on done
		this.answerEl.appendText(token);
		this.view["scrollToBottom"]();
	}

	finishAnswer(onOpen: (path: string) => void) {
		const raw = this.answerEl.getText();
		this.answerEl.empty();
		this.answerEl.removeClass("rl-answer-streaming");

		MarkdownRenderer.render(
			(this.app as Parameters<typeof MarkdownRenderer.render>[0]),
			raw,
			this.answerEl,
			"",
			this
		);

		this.renderSources(raw, onOpen);
		this.view["scrollToBottom"]();
	}

	restoreAnswer(content: string, onOpen: (path: string) => void) {
		this.stepsEl.style.display = "none";
		MarkdownRenderer.render(
			(this.app as Parameters<typeof MarkdownRenderer.render>[0]),
			content,
			this.answerEl,
			"",
			this
		);
		this.renderSources(content, onOpen);
	}

	showError(msg: string) {
		this.answerEl.createDiv({ text: `⚠ ${msg}`, cls: "rl-answer-error" });
	}

	private renderSources(raw: string, onOpen: (path: string) => void) {
		const paths = extractPaths(raw);
		if (paths.length) {
			this.sourcesEl.empty();
			this.sourcesEl.createDiv({ text: "Open", cls: "rl-sources-label" });
			for (const p of paths) {
				const btn = this.sourcesEl.createEl("button", {
					text: p.split("/").pop()?.replace(/\.md$/, "") ?? p,
					cls: "rl-source-btn",
				});
				btn.title = p;
				btn.addEventListener("click", () => onOpen(p));
			}
		}
	}

	private updateStepsToggle() {
		const count = this.stepsBody.children.length;
		this.stepsToggle.setText(count ? `${count} step${count !== 1 ? "s" : ""}` : "");
		this.stepsEl.style.display = count ? "" : "none";
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull every *.md path out of the answer text so we can render open buttons. */
function extractPaths(text: string): string[] {
	const seen = new Set<string>();
	const results: string[] = [];
	for (const m of text.matchAll(/[\w./ -]+\.md/g)) {
		const p = m[0].trim();
		if (!seen.has(p)) { seen.add(p); results.push(p); }
	}
	return results;
}
