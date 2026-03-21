import { App, Modal, TFile, MarkdownRenderer, Component } from "obsidian";
import type RecallLocusPlugin from "./main";
import { Agent, AgentEvent } from "./agent";
import { VIEW_TYPE_RL_CHAT } from "./chat-view";

export class RecallLocusChatModal extends Modal {
	private plugin: RecallLocusPlugin;
	private agent?: Agent;

	// DOM refs
	private inputEl: HTMLTextAreaElement;
	private stepsEl: HTMLElement;
	private answerEl: HTMLElement;
	private sourcesEl: HTMLElement;
	private statusEl: HTMLElement;
	private submitBtn: HTMLButtonElement;
	private stopBtn: HTMLButtonElement;
	private openPanelBtn: HTMLButtonElement;

	// Accumulated state for "open in panel"
	private lastQuestion = "";
	private lastAnswer = "";

	constructor(app: App, plugin: RecallLocusPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		this.modalEl.addClass("rl-modal");
		this.buildUI();
		setTimeout(() => this.inputEl.focus(), 50);
	}

	onClose() {
		this.agent?.cancel();
	}

	// ---------------------------------------------------------------------------
	// UI
	// ---------------------------------------------------------------------------

	private buildUI() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("rl-modal-content");

		// Title row
		const titleRow = contentEl.createDiv("rl-modal-title-row");
		titleRow.createEl("span", { text: "Quick ask", cls: "rl-modal-title" });
		const spaceName = this.plugin.settings.spaceName;
		titleRow.createEl("span", {
			text: spaceName || "no space set",
			cls: `rl-space-label${spaceName ? "" : " rl-space-unset"}`,
		});

		// Input
		this.inputEl = contentEl.createEl("textarea", {
			placeholder: "What would you like to know about your notes?",
			cls: "rl-modal-input",
		});
		this.inputEl.rows = 3;
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void this.submit();
			}
			if (e.key === "Escape") this.close();
		});

		// Buttons
		const btnRow = contentEl.createDiv("rl-modal-btn-row");
		this.submitBtn = btnRow.createEl("button", { text: "Ask", cls: "rl-send-btn" });
		this.submitBtn.addEventListener("click", () => { void this.submit(); });

		this.stopBtn = btnRow.createEl("button", { text: "Stop", cls: "rl-stop-btn" });
		this.stopBtn.hide();
		this.stopBtn.addEventListener("click", () => {
			this.agent?.cancel();
			this.setRunning(false);
		});

		this.openPanelBtn = btnRow.createEl("button", {
			text: "Open in chat panel",
			cls: "rl-open-panel-btn",
		});
		this.openPanelBtn.hide();
		this.openPanelBtn.addEventListener("click", () => { void this.openInPanel(); });

		// Status
		this.statusEl = contentEl.createDiv("rl-modal-status");

		// Steps trace
		this.stepsEl = contentEl.createDiv("rl-modal-steps");

		// Answer
		this.answerEl = contentEl.createDiv("rl-modal-answer");

		// Sources
		this.sourcesEl = contentEl.createDiv("rl-modal-sources");
	}

	// ---------------------------------------------------------------------------
	// Submit
	// ---------------------------------------------------------------------------

	private async submit() {
		const question = this.inputEl.value.trim();
		if (!question) return;

		const { spaceName, recallLocusUrl, ollamaUrl, chatModel } = this.plugin.settings;
		if (!spaceName) { this.setStatus("Set a space name in RecallLocus settings first."); return; }
		if (!chatModel) { this.setStatus("Set a chat model in RecallLocus settings first."); return; }

		this.lastQuestion = question;
		this.lastAnswer = "";

		this.stepsEl.empty();
		this.answerEl.empty();
		this.sourcesEl.empty();
		this.openPanelBtn.hide();
		this.setRunning(true);
		this.setStatus("Planning…");

		this.agent = new Agent({ locusUrl: recallLocusUrl, ollamaUrl, space: spaceName, model: chatModel });

		await this.agent.run(question, (event: AgentEvent) => this.handleEvent(event));

		this.agent = undefined;
		this.setRunning(false);
	}

	// ---------------------------------------------------------------------------
	// Event handler
	// ---------------------------------------------------------------------------

	private handleEvent(event: AgentEvent) {
		switch (event.type) {
			case "thinking":
				this.setStatus("Thinking…");
				break;

			case "search":
				this.setStatus(`Searching: "${event.query}"`);
				this.addStepRow(`🔍 ${event.query}`, "rl-modal-step");
				break;

			case "search_results": {
				const rows = this.stepsEl.querySelectorAll(".rl-modal-step");
				const last = rows[rows.length - 1] as HTMLElement | undefined;
				if (last) {
					const badge = last.createSpan({ cls: "rl-step-badge" });
					badge.setText(`${event.results.length} found`);
					if (!event.results.length) last.addClass("rl-step-empty");
				}
				break;
			}

			case "open_file": {
				const row = this.stepsEl.createDiv("rl-modal-step");
				row.dataset.docId = event.doc_id;
				row.createSpan({ text: "📄 fetching full document…" });
				break;
			}

			case "open_file_done": {
				const row = this.stepsEl.querySelector(`[data-doc-id="${event.doc_id}"]`);
				if (row) row.textContent = `📄 ${event.source ?? event.doc_id} ✓`;
				break;
			}

			case "answer_start":
				this.setStatus("Writing answer…");
				this.answerEl.empty();
				this.answerEl.addClass("rl-answer-streaming");
				break;

			case "answer_token":
				this.answerEl.appendText(event.token);
				this.lastAnswer += event.token;
				break;

			case "answer_done": {
				const raw = this.answerEl.getText();
				this.lastAnswer = raw;
				this.answerEl.empty();
				this.answerEl.removeClass("rl-answer-streaming");

				const comp = new Component();
				void MarkdownRenderer.render(this.app, raw, this.answerEl, "", comp);

				// Extract .md paths mentioned in the answer and render open buttons
				for (const m of raw.matchAll(/[\w./ -]+\.md/g)) {
					const p = m[0].trim();
					const btn = this.sourcesEl.createEl("button", {
						text: p.split("/").pop()?.replace(/\.md$/, "") ?? p,
						cls: "rl-source-btn",
					});
					btn.title = p;
					btn.addEventListener("click", () => { void this.openFile(p); });
				}

				this.setStatus("");
				this.openPanelBtn.show();
				break;
			}

			case "error":
				this.setStatus(`⚠ ${event.message}`);
				break;
		}
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private addStepRow(text: string, cls: string) {
		this.stepsEl.createDiv({ text, cls });
	}

	private setStatus(msg: string) {
		this.statusEl.setText(msg);
	}

	private setRunning(running: boolean) {
		if (running) { this.submitBtn.hide(); this.stopBtn.show(); }
		else { this.submitBtn.show(); this.stopBtn.hide(); }
		this.inputEl.disabled = running;
	}

	private async openFile(path: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			this.close();
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf) await leaf.openFile(file);
		}
	}

	private async openInPanel() {
		this.close();
		// Activate chat panel
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_RL_CHAT);
		let leaf = existing[0];
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false)!;
			await leaf.setViewState({ type: VIEW_TYPE_RL_CHAT, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}
}
