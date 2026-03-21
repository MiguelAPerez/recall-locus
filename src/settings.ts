import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type RecallLocusPlugin from "./main";
import { RecallLocusClient } from "./recall-locus-client";
import { OllamaClient } from "./ollama-client";

export interface RecallLocusSettings {
	recallLocusUrl: string;
	spaceName: string;
	autoSync: boolean;
	syncOnStartup: boolean;
	defaultResults: number;
	ollamaUrl: string;
	chatModel: string;
}

export const DEFAULT_SETTINGS: RecallLocusSettings = {
	recallLocusUrl: "http://localhost:8000",
	spaceName: "",
	autoSync: true,
	syncOnStartup: true,
	defaultResults: 5,
	ollamaUrl: "http://localhost:11434",
	chatModel: "",
};

export class RecallLocusSettingTab extends PluginSettingTab {
	plugin: RecallLocusPlugin;

	constructor(app: App, plugin: RecallLocusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("Base URL of your running server.")
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					.setPlaceholder("http://localhost:8000")
					.setValue(this.plugin.settings.recallLocusUrl)
					.onChange(async (value) => {
						this.plugin.settings.recallLocusUrl = value.trim();
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Test")
					.setCta()
					.onClick(async () => {
						const client = new RecallLocusClient(this.plugin.settings.recallLocusUrl);
						const ok = await client.health();
						new Notice(ok ? "Connected to RecallLocus!" : "Could not reach RecallLocus.");
					})
			);

		new Setting(containerEl)
			.setName("Space name")
			.setDesc("Space this vault maps to. Created automatically on first sync.")
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					.setPlaceholder("my_vault")
					.setValue(this.plugin.settings.spaceName)
					.onChange(async (value) => {
						this.plugin.settings.spaceName = value.trim().toLowerCase().replace(/\s+/g, "_");
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-sync")
			.setDesc("Automatically sync notes to the server when they are created or modified.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
					this.plugin.settings.autoSync = value;
					await this.plugin.saveSettings();
					this.plugin.syncEngine.rebindVaultEvents();
				})
			);

		new Setting(containerEl)
			.setName("Sync on startup")
			.setDesc("Run a full vault sync when Obsidian loads.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncOnStartup).onChange(async (value) => {
					this.plugin.settings.syncOnStartup = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Default result count")
			.setDesc("How many search results to show by default (1–50).")
			.addSlider((slider) =>
				slider
					.setLimits(1, 50, 1)
					.setValue(this.plugin.settings.defaultResults)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.defaultResults = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Chat").setHeading();

		new Setting(containerEl)
			.setName("Ollama URL")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Base URL of your Ollama instance.")
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					.setPlaceholder("http://localhost:11434")
					.setValue(this.plugin.settings.ollamaUrl)
					.onChange(async (value) => {
						this.plugin.settings.ollamaUrl = value.trim();
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Test")
					.onClick(async () => {
						const client = new OllamaClient(this.plugin.settings.ollamaUrl);
						const ok = await client.health();
						new Notice(ok ? "Connected to Ollama!" : "Could not reach Ollama.");
					})
			);

		new Setting(containerEl)
			.setName("Chat model")
			.setDesc("Ollama model to use for the chat agent (eg llama3.2).")
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					.setPlaceholder("llama3.2")
					.setValue(this.plugin.settings.chatModel)
					.onChange(async (value) => {
						this.plugin.settings.chatModel = value.trim();
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("List models").onClick(async () => {
					const client = new OllamaClient(this.plugin.settings.ollamaUrl);
					const models = await client.listModels();
					new Notice(models.length ? models.join(", ") : "No models found.");
				})
			);

		new Setting(containerEl).setName("Actions").setHeading();

		new Setting(containerEl)
			.setName("Full vault sync")
			.setDesc("Re-ingest every note in this vault into the server.")
			.addButton((btn) =>
				btn
					.setButtonText("Sync now")
					.setCta()
					.onClick(async () => {
						btn.setButtonText("Syncing…").setDisabled(true);
						await this.plugin.syncEngine.syncVault();
						btn.setButtonText("Sync now").setDisabled(false);
						new Notice("Vault sync complete.");
					})
			);

		new Setting(containerEl)
			.setName("Clear sync cache")
			.setDesc("Forget which notes have been synced. Next sync will re-ingest everything.")
			.addButton((btn) =>
				btn.setButtonText("Clear cache").onClick(async () => {
					await this.plugin.syncEngine.clearCache();
					new Notice("Sync cache cleared.");
				})
			);
	}
}
