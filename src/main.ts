import { Plugin, Notice, TFile, TAbstractFile } from "obsidian";
import { LocusSettings, DEFAULT_SETTINGS, LocusSettingTab } from "./settings";
import { SyncEngine, SyncData } from "./sync-engine";
import { LocusChatView, VIEW_TYPE_LOCUS } from "./chat-panel";

interface PluginData {
	settings: LocusSettings;
	syncData: SyncData;
}

export default class LocusPlugin extends Plugin {
	settings: LocusSettings;
	syncData: SyncData;
	syncEngine: SyncEngine;

	private statusBarItem: HTMLElement;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.syncEngine = new SyncEngine(this);

		// Register the chat panel view
		this.registerView(VIEW_TYPE_LOCUS, (leaf) => new LocusChatView(leaf, this));

		// Settings tab
		this.addSettingTab(new LocusSettingTab(this.app, this));

		// Status bar
		this.statusBarItem = this.addStatusBarItem();
		this.setStatus("idle");

		// Ribbon icon — opens the chat panel
		this.addRibbonIcon("search", "Locus Search", () => this.activateChatPanel());

		// Commands
		this.addCommand({
			id: "open-search",
			name: "Open search panel",
			callback: () => this.activateChatPanel(),
		});

		this.addCommand({
			id: "sync-vault",
			name: "Sync vault now",
			callback: async () => {
				await this.syncEngine.syncVault();
			},
		});

		// Vault events
		this.registerEvent(
			this.app.vault.on("create", (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "md") {
					this.syncEngine.syncFile(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "md") {
					this.syncEngine.syncFile(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "md") {
					this.syncEngine.deleteFile(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile && file.extension === "md") {
					this.syncEngine.renameFile(file, oldPath);
				}
			})
		);

		// Startup sync
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.syncOnStartup && this.settings.spaceName) {
				await this.syncEngine.syncVault();
			}
		});
	}

	async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_LOCUS);
	}

	// -------------------------------------------------------------------------
	// Data persistence
	// -------------------------------------------------------------------------

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
		this.syncData = data?.syncData ?? { files: {} };
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ settings: this.settings, syncData: this.syncData });
		this.syncEngine?.refreshClient();
		// Refresh the chat panel client too
		this.app.workspace.getLeavesOfType(VIEW_TYPE_LOCUS).forEach((leaf) => {
			(leaf.view as LocusChatView).refreshClient();
		});
	}

	async saveSyncData(): Promise<void> {
		await this.saveData({ settings: this.settings, syncData: this.syncData });
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	setStatus(state: "idle" | "syncing" | "error"): void {
		const icons: Record<string, string> = {
			idle: "Locus ●",
			syncing: "Locus ↻",
			error: "Locus ✕",
		};
		this.statusBarItem.setText(icons[state] ?? "Locus");
	}

	private async activateChatPanel(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LOCUS);
		if (existing.length) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_LOCUS, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}
}
