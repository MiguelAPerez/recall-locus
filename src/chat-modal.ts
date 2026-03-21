import { App, Modal, TFile, MarkdownRenderer, Component } from "obsidian";
import type LocusPlugin from "./main";
import { Agent, AgentEvent } from "./agent";
import { VIEW_TYPE_LOCUS_CHAT, LocusChatView } from "./chat-view";

export class LocusChatModal extends Modal {
	private plugin: LocusPlugin;
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

	constructor(app: App, plugin: LocusPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		this.modalEl.addClass("locus-modal");
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
		contentEl.addClass("locus-modal-content");

		// Title row
		const titleRow = contentEl.createDiv("locus-modal-title-row");
		titleRow.createEl("span", { text: "Ask Locus", cls: "locus-modal-title" });
		const spaceName = this.plugin.settings.spaceName;
		titleRow.createEl("span", {
			text: spaceName || "no space set",
			cls: `locus-space-label${spaceName ? "" : " locus-space-unset"}`,
		});

		// Input
		this.inputEl = contentEl.createEl("textarea", {
			placeholder: "What would you like to know about your notes?",
			cls: "locus-modal-input",
		});
		this.inputEl.rows = 3;
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.submit();
			}
			if (e.key === "Escape") this.close();
		});

		// Buttons
		const btnRow = contentEl.createDiv("locus-modal-btn-row");
		this.submitBtn = btnRow.createEl("button", { text: "Ask", cls: "locus-send-btn" });
		this.submitBtn.addEventListener("click", () => this.submit());

		this.stopBtn = btnRow.createEl("button", { text: "Stop", cls: "locus-stop-btn" });
		this.stopBtn.style.display = "none";
		this.stopBtn.addEventListener("click", () => {
			this.agent?.cancel();
			this.setRunning(false);
		});

		this.openPanelBtn = btnRow.createEl("button", {
			text: "Open in chat panel",
			cls: "locus-open-panel-btn",
		});
		this.openPanelBtn.style.display = "none";
		this.openPanelBtn.addEventListener("click", () => this.openInPanel());

		// Status
		this.statusEl = contentEl.createDiv("locus-modal-status");

		// Steps trace
		this.stepsEl = contentEl.createDiv("locus-modal-steps");

		// Answer
		this.answerEl = contentEl.createDiv("locus-modal-answer");

		// Sources
		this.sourcesEl = contentEl.createDiv("locus-modal-sources");
	}

	// ---------------------------------------------------------------------------
	// Submit
	// ---------------------------------------------------------------------------

	private async submit() {
		const question = this.inputEl.value.trim();
		if (!question) return;

		const { spaceName, locusUrl, ollamaUrl, chatModel } = this.plugin.settings;
		if (!spaceName) { this.setStatus("Set a space name in Locus settings first."); return; }
		if (!chatModel) { this.setStatus("Set a chat model in Locus settings first."); return; }

		this.lastQuestion = question;
		this.lastAnswer = "";

		this.stepsEl.empty();
		this.answerEl.empty();
		this.sourcesEl.empty();
		this.openPanelBtn.style.display = "none";
		this.setRunning(true);
		this.setStatus("Planning…");

		this.agent = new Agent({ locusUrl, ollamaUrl, space: spaceName, model: chatModel });

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
				this.addStepRow(`🔍 ${event.query}`, "locus-modal-step");
				break;

			case "search_results": {
				const rows = this.stepsEl.querySelectorAll(".locus-modal-step");
				const last = rows[rows.length - 1] as HTMLElement | undefined;
				if (last) {
					const badge = last.createSpan({ cls: "locus-step-badge" });
					badge.setText(`${event.results.length} found`);
					if (!event.results.length) last.addClass("locus-step-empty");
				}
				break;
			}

			case "open_file": {
				const row = this.stepsEl.createDiv("locus-modal-step");
				row.dataset.docId = event.doc_id;
				row.createSpan({ text: "📄 fetching full document…" });
				break;
			}

			case "open_file_done": {
				const row = this.stepsEl.querySelector(`[data-doc-id="${event.doc_id}"]`) as HTMLElement | null;
				if (row) row.setText(`📄 ${event.source ?? event.doc_id} ✓`);
				break;
			}

			case "answer_start":
				this.setStatus("Writing answer…");
				this.answerEl.empty();
				this.answerEl.addClass("locus-answer-streaming");
				break;

			case "answer_token":
				this.answerEl.appendText(event.token);
				this.lastAnswer += event.token;
				break;

			case "answer_done": {
				const raw = this.answerEl.getText();
				this.lastAnswer = raw;
				this.answerEl.empty();
				this.answerEl.removeClass("locus-answer-streaming");

				const comp = new Component();
				MarkdownRenderer.render(this.app, raw, this.answerEl, "", comp);

				// Extract .md paths mentioned in the answer and render open buttons
				for (const m of raw.matchAll(/[\w./ -]+\.md/g)) {
					const p = m[0].trim();
					const btn = this.sourcesEl.createEl("button", {
						text: p.split("/").pop()?.replace(/\.md$/, "") ?? p,
						cls: "locus-source-btn",
					});
					btn.title = p;
					btn.addEventListener("click", () => this.openFile(p));
				}

				this.setStatus("");
				this.openPanelBtn.style.display = "";
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
		this.submitBtn.style.display = running ? "none" : "";
		this.stopBtn.style.display = running ? "" : "none";
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
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LOCUS_CHAT);
		let leaf = existing[0];
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false)!;
			await leaf.setViewState({ type: VIEW_TYPE_LOCUS_CHAT, active: true });
		}
		this.app.workspace.revealLeaf(leaf);
	}
}
