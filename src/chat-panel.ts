import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type RecallLocusPlugin from "./main";
import { RecallLocusClient, SearchResult } from "./recall-locus-client";

export const VIEW_TYPE_RL_SEARCH = "rl-search";

export class RecallLocusChatView extends ItemView {
	private plugin: RecallLocusPlugin;
	private client: RecallLocusClient;

	// DOM refs
	private spaceLabel: HTMLElement;
	private input: HTMLInputElement;
	private kSelect: HTMLSelectElement;
	private resultsEl: HTMLElement;
	private statusEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: RecallLocusPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.client = new RecallLocusClient(plugin.settings.recallLocusUrl);
	}

	getViewType(): string {
		return VIEW_TYPE_RL_SEARCH;
	}

	getDisplayText(): string {
		return "Semantic search";
	}

	getIcon(): string {
		return "search";
	}

	onOpen(): Promise<void> {
		this.buildUI();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		return Promise.resolve();
	}

	/** Refresh client when settings change. */
	refreshClient(): void {
		this.client = new RecallLocusClient(this.plugin.settings.recallLocusUrl);
		if (this.spaceLabel) {
			this.updateSpaceLabel();
		}
	}

	// -------------------------------------------------------------------------
	// UI construction
	// -------------------------------------------------------------------------

	private buildUI(): void {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass("rl-panel");

		// Header
		const header = root.createDiv("rl-header");
		header.createEl("span", { text: "Search", cls: "rl-title" });
		this.spaceLabel = header.createEl("span", { cls: "rl-space-label" });
		this.updateSpaceLabel();

		// Search bar
		const searchBar = root.createDiv("rl-search-bar");
		this.input = searchBar.createEl("input", {
			type: "text",
			placeholder: "Search your notes…",
			cls: "rl-input",
		});
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") void this.runSearch();
		});

		const searchBtn = searchBar.createEl("button", { text: "Search", cls: "rl-search-btn" });
		searchBtn.addEventListener("click", () => { void this.runSearch(); });

		// Result count selector
		const controls = root.createDiv("rl-controls");
		controls.createEl("label", { text: "Results: ", cls: "rl-label" });
		this.kSelect = controls.createEl("select", { cls: "rl-select" });
		for (const n of [3, 5, 10, 20]) {
			const opt = this.kSelect.createEl("option", { text: String(n), value: String(n) });
			if (n === this.plugin.settings.defaultResults) opt.selected = true;
		}

		// Status line
		this.statusEl = root.createDiv("rl-status");

		// Results container
		this.resultsEl = root.createDiv("rl-results");
	}

	private updateSpaceLabel(): void {
		const space = this.plugin.settings.spaceName;
		this.spaceLabel.setText(space ? `space: ${space}` : "no space configured");
		this.spaceLabel.toggleClass("rl-space-unset", !space);
	}

	// -------------------------------------------------------------------------
	// Search
	// -------------------------------------------------------------------------

	private async runSearch(): Promise<void> {
		const query = this.input.value.trim();
		if (!query) return;

		const { spaceName } = this.plugin.settings;
		if (!spaceName) {
			this.setStatus("Set a space name in RecallLocus settings first.");
			return;
		}

		const k = parseInt(this.kSelect.value, 10);
		this.setStatus("Searching…");
		this.resultsEl.empty();

		try {
			const resp = await this.client.search(spaceName, query, k, false);
			this.renderResults(resp.results, query);
			this.setStatus(
				resp.results.length
					? `${resp.results.length} result${resp.results.length !== 1 ? "s" : ""}`
					: "No results found."
			);
		} catch (err) {
			this.setStatus(`Error: ${(err as Error).message}`);
		}
	}

	private renderResults(results: SearchResult[], query: string): void {
		this.resultsEl.empty();

		if (!results.length) return;

		for (const result of results) {
			const card = this.resultsEl.createDiv("rl-result-card");

			// Title row
			const titleRow = card.createDiv("rl-result-title-row");
			const title = result.source
				? result.source.replace(/\.md$/, "").split("/").pop() ?? result.source
				: result.doc_id;
			titleRow.createEl("span", { text: title, cls: "rl-result-title" });
			titleRow.createEl("span", {
				text: result.score.toFixed(2),
				cls: "rl-result-score",
			});

			// Excerpt
			const excerptEl = card.createDiv("rl-result-excerpt");
			this.renderHighlight(excerptEl, result.text.slice(0, 200).trim(), query);
			if (result.text.length > 200) excerptEl.appendText("…");

			// Click to open
			if (result.source) {
				card.addClass("rl-result-clickable");
				card.addEventListener("click", () => { void this.openNote(result.source!); });
			}
		}
	}

	private renderHighlight(container: HTMLElement, text: string, query: string): void {
		const terms = query
			.split(/\s+/)
			.filter(Boolean)
			.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
		if (!terms.length) {
			container.appendText(text);
			return;
		}
		const re = new RegExp(`(${terms.join("|")})`, "gi");
		let last = 0;
		for (const m of text.matchAll(re)) {
			if ((m.index ?? 0) > last) container.appendText(text.slice(last, m.index));
			container.createEl("mark", { text: m[0] });
			last = (m.index ?? 0) + m[0].length;
		}
		if (last < text.length) container.appendText(text.slice(last));
	}

	private async openNote(source: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(source);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf) await leaf.openFile(file);
		}
	}

	private setStatus(msg: string): void {
		this.statusEl.setText(msg);
	}
}
