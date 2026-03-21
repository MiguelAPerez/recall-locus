import { Plugin, Notice, TFile, TAbstractFile } from "obsidian";
import { LocusSettings, DEFAULT_SETTINGS, LocusSettingTab } from "./settings";
import { SyncEngine, SyncData } from "./sync-engine";
import { LocusChatView as SearchView, VIEW_TYPE_LOCUS } from "./chat-panel";
import { LocusChatView, VIEW_TYPE_LOCUS_CHAT, ChatSession } from "./chat-view";
import { LocusChatModal } from "./chat-modal";

interface PluginData {
	settings: LocusSettings;
	syncData: SyncData;
	chatSessions: ChatSession[];
}

export default class LocusPlugin extends Plugin {
	settings: LocusSettings;
	syncData: SyncData;
	chatSessions: ChatSession[] = [];
	syncEngine: SyncEngine;

	private statusBarItem: HTMLElement;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.syncEngine = new SyncEngine(this);

		// Register views
		this.registerView(VIEW_TYPE_LOCUS, (leaf) => new SearchView(leaf, this));
		this.registerView(VIEW_TYPE_LOCUS_CHAT, (leaf) => new LocusChatView(leaf, this));

		// Settings tab
		this.addSettingTab(new LocusSettingTab(this.app, this));

		// Status bar
		this.statusBarItem = this.addStatusBarItem();
		this.setStatus("idle");

		// Ribbon icons
		this.addRibbonIcon("search", "Locus Search", () => this.activateView(VIEW_TYPE_LOCUS));
		this.addRibbonIcon("message-square", "Locus Chat", () => this.activateView(VIEW_TYPE_LOCUS_CHAT));

		// Commands
		this.addCommand({
			id: "open-search",
			name: "Open search panel",
			callback: () => this.activateView(VIEW_TYPE_LOCUS),
		});

		this.addCommand({
			id: "open-chat",
			name: "Open chat panel",
			callback: () => this.activateView(VIEW_TYPE_LOCUS_CHAT),
		});

		this.addCommand({
			id: "ask",
			name: "Ask (quick modal)",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "l" }],
			callback: () => new LocusChatModal(this.app, this).open(),
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
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_LOCUS_CHAT);
	}

	// ---------------------------------------------------------------------------
	// Data persistence
	// ---------------------------------------------------------------------------

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
		this.syncData = data?.syncData ?? { files: {} };
		this.chatSessions = data?.chatSessions ?? [];
	}

	async saveChatSessions(): Promise<void> {
		await this.saveData({ settings: this.settings, syncData: this.syncData, chatSessions: this.chatSessions });
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ settings: this.settings, syncData: this.syncData, chatSessions: this.chatSessions });
		this.syncEngine?.refreshClient();
		this.app.workspace.getLeavesOfType(VIEW_TYPE_LOCUS).forEach((leaf) => {
			(leaf.view as SearchView).refreshClient();
		});
		this.app.workspace.getLeavesOfType(VIEW_TYPE_LOCUS_CHAT).forEach((leaf) => {
			(leaf.view as LocusChatView).refreshSettings();
		});
	}

	async saveSyncData(): Promise<void> {
		await this.saveData({ settings: this.settings, syncData: this.syncData, chatSessions: this.chatSessions });
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	setStatus(state: "idle" | "syncing" | "error"): void {
		const icons: Record<string, string> = {
			idle: "Locus ●",
			syncing: "Locus ↻",
			error: "Locus ✕",
		};
		this.statusBarItem.setText(icons[state] ?? "Locus");
	}

	private async activateView(type: string): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(type);
		if (existing.length) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}
}
