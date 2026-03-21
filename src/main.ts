import { Plugin, Notice, TFile, TAbstractFile } from "obsidian";
import { RecallLocusSettings, DEFAULT_SETTINGS, RecallLocusSettingTab } from "./settings";
import { SyncEngine, SyncData } from "./sync-engine";
import { RecallLocusChatView as SearchView, VIEW_TYPE_RL_SEARCH } from "./chat-panel";
import { RecallLocusChatView, VIEW_TYPE_RL_CHAT, ChatSession } from "./chat-view";
import { RecallLocusChatModal } from "./chat-modal";

interface PluginData {
	settings: RecallLocusSettings;
	syncData: SyncData;
	chatSessions: ChatSession[];
}

export default class RecallLocusPlugin extends Plugin {
	settings: RecallLocusSettings;
	syncData: SyncData;
	chatSessions: ChatSession[] = [];
	syncEngine: SyncEngine;

	private statusBarItem: HTMLElement;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.syncEngine = new SyncEngine(this);

		// Register views
		this.registerView(VIEW_TYPE_RL_SEARCH, (leaf) => new SearchView(leaf, this));
		this.registerView(VIEW_TYPE_RL_CHAT, (leaf) => new RecallLocusChatView(leaf, this));

		// Settings tab
		this.addSettingTab(new RecallLocusSettingTab(this.app, this));

		// Status bar
		this.statusBarItem = this.addStatusBarItem();
		this.setStatus("idle");

		// Ribbon icons
		this.addRibbonIcon("search", "RecallLocus Search", () => this.activateView(VIEW_TYPE_RL_SEARCH));
		this.addRibbonIcon("message-square", "RecallLocus Chat", () => this.activateView(VIEW_TYPE_RL_CHAT));

		// Commands
		this.addCommand({
			id: "open-search",
			name: "Open search panel",
			callback: () => this.activateView(VIEW_TYPE_RL_SEARCH),
		});

		this.addCommand({
			id: "open-chat",
			name: "Open chat panel",
			callback: () => this.activateView(VIEW_TYPE_RL_CHAT),
		});

		this.addCommand({
			id: "ask",
			name: "Ask (quick modal)",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "l" }],
			callback: () => new RecallLocusChatModal(this.app, this).open(),
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
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_RL_SEARCH);
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_RL_CHAT);
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
		this.app.workspace.getLeavesOfType(VIEW_TYPE_RL_SEARCH).forEach((leaf) => {
			(leaf.view as SearchView).refreshClient();
		});
		this.app.workspace.getLeavesOfType(VIEW_TYPE_RL_CHAT).forEach((leaf) => {
			(leaf.view as RecallLocusChatView).refreshSettings();
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
			idle: "RL ●",
			syncing: "RL ↻",
			error: "RL ✕",
		};
		this.statusBarItem.setText(icons[state] ?? "RecallLocus");
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
