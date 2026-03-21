import { ItemView, WorkspaceLeaf, TFile, debounce } from "obsidian";
import type LocusPlugin from "./main";
import { LocusClient, SearchResult } from "./locus-client";

export const VIEW_TYPE_LOCUS = "locus-chat";

export class LocusChatView extends ItemView {
	private plugin: LocusPlugin;
	private client: LocusClient;

	// DOM refs
	private spaceLabel: HTMLElement;
	private input: HTMLInputElement;
	private kSelect: HTMLSelectElement;
	private resultsEl: HTMLElement;
	private statusEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: LocusPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.client = new LocusClient(plugin.settings.locusUrl);
	}

	getViewType(): string {
		return VIEW_TYPE_LOCUS;
	}

	getDisplayText(): string {
		return "Locus Search";
	}

	getIcon(): string {
		return "search";
	}

	async onOpen(): Promise<void> {
		this.buildUI();
	}

	async onClose(): Promise<void> {}

	/** Refresh client when settings change. */
	refreshClient(): void {
		this.client = new LocusClient(this.plugin.settings.locusUrl);
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
		root.addClass("locus-panel");

		// Header
		const header = root.createDiv("locus-header");
		header.createEl("span", { text: "Locus", cls: "locus-title" });
		this.spaceLabel = header.createEl("span", { cls: "locus-space-label" });
		this.updateSpaceLabel();

		// Search bar
		const searchBar = root.createDiv("locus-search-bar");
		this.input = searchBar.createEl("input", {
			type: "text",
			placeholder: "Search your notes…",
			cls: "locus-input",
		});
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.runSearch();
		});

		const searchBtn = searchBar.createEl("button", { text: "Search", cls: "locus-search-btn" });
		searchBtn.addEventListener("click", () => this.runSearch());

		// Result count selector
		const controls = root.createDiv("locus-controls");
		controls.createEl("label", { text: "Results: ", cls: "locus-label" });
		this.kSelect = controls.createEl("select", { cls: "locus-select" });
		for (const n of [3, 5, 10, 20]) {
			const opt = this.kSelect.createEl("option", { text: String(n), value: String(n) });
			if (n === this.plugin.settings.defaultResults) opt.selected = true;
		}

		// Status line
		this.statusEl = root.createDiv("locus-status");

		// Results container
		this.resultsEl = root.createDiv("locus-results");
	}

	private updateSpaceLabel(): void {
		const space = this.plugin.settings.spaceName;
		this.spaceLabel.setText(space ? `space: ${space}` : "no space configured");
		this.spaceLabel.toggleClass("locus-space-unset", !space);
	}

	// -------------------------------------------------------------------------
	// Search
	// -------------------------------------------------------------------------

	private async runSearch(): Promise<void> {
		const query = this.input.value.trim();
		if (!query) return;

		const { spaceName, locusUrl } = this.plugin.settings;
		if (!spaceName) {
			this.setStatus("Set a space name in Locus settings first.");
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
			const card = this.resultsEl.createDiv("locus-result-card");

			// Title row
			const titleRow = card.createDiv("locus-result-title-row");
			const title = result.source
				? result.source.replace(/\.md$/, "").split("/").pop() ?? result.source
				: result.doc_id;
			titleRow.createEl("span", { text: title, cls: "locus-result-title" });
			titleRow.createEl("span", {
				text: result.score.toFixed(2),
				cls: "locus-result-score",
			});

			// Excerpt
			const excerpt = this.highlight(result.text.slice(0, 200).trim(), query);
			const excerptEl = card.createDiv("locus-result-excerpt");
			excerptEl.innerHTML = excerpt + (result.text.length > 200 ? "…" : "");

			// Click to open
			if (result.source) {
				card.addClass("locus-result-clickable");
				card.addEventListener("click", () => this.openNote(result.source!));
			}
		}
	}

	private highlight(text: string, query: string): string {
		const escaped = text.replace(/[&<>"']/g, (c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c)
		);
		const terms = query
			.split(/\s+/)
			.filter(Boolean)
			.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
		if (!terms.length) return escaped;
		const re = new RegExp(`(${terms.join("|")})`, "gi");
		return escaped.replace(re, "<mark>$1</mark>");
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
