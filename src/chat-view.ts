import { ItemView, WorkspaceLeaf, TFile, MarkdownRenderer, Component } from "obsidian";
import type LocusPlugin from "./main";
import { Agent, AgentEvent } from "./agent";
import { SearchResult } from "./locus-client";

export const VIEW_TYPE_LOCUS_CHAT = "locus-chat-view";

interface Turn {
	role: "user" | "assistant";
	content: string; // user text or final answer text
	steps?: StepRecord[];
	sources?: Array<{ path: string; reason?: string }>;
	error?: string;
}

interface StepRecord {
	type: "search" | "open_file_request";
	thought: string;
	query?: string;
	results?: SearchResult[];
	path?: string;
	reason?: string;
	resultCount?: number;
}

export class LocusChatView extends ItemView {
	private plugin: LocusPlugin;
	private turns: Turn[] = [];
	private activeAgent?: Agent;

	// DOM refs
	private messagesEl: HTMLElement;
	private inputEl: HTMLTextAreaElement;
	private sendBtn: HTMLButtonElement;
	private stopBtn: HTMLButtonElement;
	private spaceLabel: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: LocusPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE_LOCUS_CHAT; }
	getDisplayText() { return "Locus Chat"; }
	getIcon() { return "message-square"; }

	async onOpen() { this.buildUI(); }
	async onClose() { this.activeAgent?.cancel(); }

	refreshSettings() {
		if (this.spaceLabel) this.updateSpaceLabel();
	}

	// ---------------------------------------------------------------------------
	// UI construction
	// ---------------------------------------------------------------------------

	private buildUI() {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass("locus-chat-root");

		// Header
		const header = root.createDiv("locus-chat-header");
		header.createEl("span", { text: "Locus Chat", cls: "locus-chat-title" });
		this.spaceLabel = header.createEl("span", { cls: "locus-space-label" });
		this.updateSpaceLabel();

		// Messages
		this.messagesEl = root.createDiv("locus-chat-messages");

		// Input row
		const inputRow = root.createDiv("locus-chat-input-row");
		this.inputEl = inputRow.createEl("textarea", {
			placeholder: "Ask anything about your notes…",
			cls: "locus-chat-input",
		});
		this.inputEl.rows = 2;
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.submit();
			}
		});

		const btnGroup = inputRow.createDiv("locus-chat-btns");
		this.sendBtn = btnGroup.createEl("button", { text: "Send", cls: "locus-send-btn" });
		this.sendBtn.addEventListener("click", () => this.submit());

		this.stopBtn = btnGroup.createEl("button", { text: "Stop", cls: "locus-stop-btn" });
		this.stopBtn.style.display = "none";
		this.stopBtn.addEventListener("click", () => {
			this.activeAgent?.cancel();
			this.setRunning(false);
		});
	}

	private updateSpaceLabel() {
		const s = this.plugin.settings.spaceName;
		this.spaceLabel.setText(s || "no space set");
		this.spaceLabel.toggleClass("locus-space-unset", !s);
	}

	// ---------------------------------------------------------------------------
	// Submit
	// ---------------------------------------------------------------------------

	private async submit() {
		const question = this.inputEl.value.trim();
		if (!question || this.activeAgent) return;

		const { spaceName, locusUrl, ollamaUrl, chatModel } = this.plugin.settings;
		if (!spaceName) { this.showError("Set a space name in Locus settings first."); return; }
		if (!chatModel) { this.showError("Set a chat model in Locus settings first."); return; }

		this.inputEl.value = "";
		this.addUserTurn(question);
		this.setRunning(true);

		const turn: Turn = { role: "assistant", content: "", steps: [], sources: [] };
		this.turns.push(turn);
		const bubble = this.renderAssistantBubble(turn);

		this.activeAgent = new Agent({ locusUrl, ollamaUrl, space: spaceName, model: chatModel });

		await this.activeAgent.run(question, (event: AgentEvent) => {
			this.handleEvent(event, turn, bubble);
		});

		this.activeAgent = undefined;
		this.setRunning(false);
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

			case "open_file_request": {
				bubble.setThinking(false);
				const step: StepRecord = {
					type: "open_file_request",
					thought: "",
					path: event.path,
					reason: event.reason,
				};
				turn.steps!.push(step);
				bubble.addOpenFileRequest(event.path, event.reason, event.resolve);
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
				turn.sources = event.sources;
				bubble.finishAnswer(event.sources, (path) => this.openFile(path));
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
		this.turns.push({ role: "user", content: text });
		const el = this.messagesEl.createDiv("locus-msg-user");
		el.createDiv({ text, cls: "locus-msg-user-bubble" });
		this.scrollToBottom();
	}

	private renderAssistantBubble(turn: Turn): AssistantBubble {
		const wrapper = this.messagesEl.createDiv("locus-msg-assistant");
		const bubble = new AssistantBubble(wrapper, this.app, this);
		this.scrollToBottom();
		return bubble;
	}

	private showError(msg: string) {
		const el = this.messagesEl.createDiv("locus-msg-error");
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
	private root: HTMLElement;
	private stepsEl: HTMLElement;
	private stepsToggle: HTMLElement;
	private stepsBody: HTMLElement;
	private thinkingEl: HTMLElement;
	private answerEl: HTMLElement;
	private sourcesEl: HTMLElement;
	private stepEls: Map<string, HTMLElement> = new Map();
	private app: ReturnType<typeof Object>;
	private view: LocusChatView;

	constructor(root: HTMLElement, app: unknown, view: LocusChatView) {
		super();
		this.root = root;
		this.app = app as ReturnType<typeof Object>;
		this.view = view;

		// Thinking indicator
		this.thinkingEl = root.createDiv("locus-thinking");
		this.thinkingEl.createSpan({ cls: "locus-thinking-dot" });
		this.thinkingEl.createSpan({ cls: "locus-thinking-dot" });
		this.thinkingEl.createSpan({ cls: "locus-thinking-dot" });
		this.thinkingEl.style.display = "none";

		// Step trace (collapsible)
		this.stepsEl = root.createDiv("locus-steps");
		this.stepsToggle = this.stepsEl.createDiv("locus-steps-toggle");
		this.stepsBody = this.stepsEl.createDiv("locus-steps-body");
		this.stepsToggle.addEventListener("click", () => {
			const open = this.stepsBody.style.display !== "none";
			this.stepsBody.style.display = open ? "none" : "";
			this.stepsToggle.toggleClass("locus-steps-collapsed", open);
		});
		this.updateStepsToggle();

		// Answer
		this.answerEl = root.createDiv("locus-answer");

		// Sources
		this.sourcesEl = root.createDiv("locus-sources");
	}

	setThinking(on: boolean) {
		this.thinkingEl.style.display = on ? "flex" : "none";
	}

	addStep(step: StepRecord) {
		const el = this.stepsBody.createDiv("locus-step");
		el.createSpan({ text: "🔍", cls: "locus-step-icon" });
		const textEl = el.createSpan({ cls: "locus-step-text" });
		textEl.createSpan({ text: step.query ?? "", cls: "locus-step-query" });
		const badge = el.createSpan({ text: "…", cls: "locus-step-badge" });
		this.stepEls.set(step.query ?? "", el);
		this.updateStepsToggle();
	}

	updateStepResults(query: string, count: number) {
		const el = this.stepEls.get(query);
		if (!el) return;
		const badge = el.querySelector(".locus-step-badge") as HTMLElement;
		if (badge) badge.setText(`${count} found`);
		el.toggleClass("locus-step-empty", count === 0);
	}

	addOpenFileRequest(path: string, reason: string, resolve: (content: string | null) => void) {
		const el = this.stepsBody.createDiv("locus-step locus-step-openfile");
		el.createSpan({ text: "📄", cls: "locus-step-icon" });
		const info = el.createDiv("locus-step-openfile-info");
		info.createDiv({ text: `Open: ${path.split("/").pop()}`, cls: "locus-step-openfile-name" });
		info.createDiv({ text: reason, cls: "locus-step-openfile-reason" });

		const btnRow = el.createDiv("locus-step-openfile-btns");
		const allow = btnRow.createEl("button", { text: "Allow", cls: "locus-allow-btn" });
		const skip = btnRow.createEl("button", { text: "Skip", cls: "locus-skip-btn" });

		allow.addEventListener("click", async () => {
			allow.disabled = true; skip.disabled = true;
			// Read the file and resolve the promise
			const file = (this.app as { vault: { getAbstractFileByPath: (p: string) => unknown } })
				.vault.getAbstractFileByPath(path) as TFile | null;
			if (file instanceof TFile) {
				const content = await (this.app as { vault: { read: (f: TFile) => Promise<string> } })
					.vault.read(file);
				el.addClass("locus-step-allowed");
				allow.setText("✓ Opened");
				resolve(content);
			} else {
				allow.setText("Not found");
				resolve(null);
			}
		});

		skip.addEventListener("click", () => {
			allow.disabled = true; skip.disabled = true;
			el.addClass("locus-step-skipped");
			skip.setText("Skipped");
			resolve(null);
		});

		this.updateStepsToggle();
	}

	collapseSteps() {
		this.stepsBody.style.display = "none";
		this.stepsToggle.addClass("locus-steps-collapsed");
		this.updateStepsToggle();
	}

	startAnswer() {
		this.answerEl.empty();
		this.answerEl.addClass("locus-answer-streaming");
	}

	appendToken(token: string) {
		// Append raw text; we'll render markdown on done
		this.answerEl.appendText(token);
		this.view["scrollToBottom"]();
	}

	finishAnswer(
		sources: Array<{ path: string; reason?: string }>,
		onOpen: (path: string) => void
	) {
		const raw = this.answerEl.getText();
		this.answerEl.empty();
		this.answerEl.removeClass("locus-answer-streaming");

		// Render markdown
		MarkdownRenderer.render(
			(this.app as Parameters<typeof MarkdownRenderer.render>[0]),
			raw,
			this.answerEl,
			"",
			this
		);

		// Sources
		if (sources.length) {
			this.sourcesEl.empty();
			this.sourcesEl.createDiv({ text: "Sources", cls: "locus-sources-label" });
			for (const src of sources) {
				const btn = this.sourcesEl.createEl("button", {
					text: src.path.split("/").pop()?.replace(/\.md$/, "") ?? src.path,
					cls: "locus-source-btn",
				});
				if (src.reason) btn.title = src.reason;
				btn.addEventListener("click", () => onOpen(src.path));
			}
		}

		this.view["scrollToBottom"]();
	}

	showError(msg: string) {
		this.answerEl.createDiv({ text: `⚠ ${msg}`, cls: "locus-answer-error" });
	}

	private updateStepsToggle() {
		const count = this.stepsBody.children.length;
		this.stepsToggle.setText(count ? `▶ ${count} step${count !== 1 ? "s" : ""}` : "");
		this.stepsEl.style.display = count ? "" : "none";
	}
}
