import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type LocusPlugin from "./main";
import { LocusClient } from "./locus-client";

export interface LocusSettings {
	locusUrl: string;
	spaceName: string;
	autoSync: boolean;
	syncOnStartup: boolean;
	defaultResults: number;
}

export const DEFAULT_SETTINGS: LocusSettings = {
	locusUrl: "http://localhost:8000",
	spaceName: "",
	autoSync: true,
	syncOnStartup: true,
	defaultResults: 5,
};

export class LocusSettingTab extends PluginSettingTab {
	plugin: LocusPlugin;

	constructor(app: App, plugin: LocusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Locus" });

		new Setting(containerEl)
			.setName("Locus URL")
			.setDesc("Base URL of your running Locus instance.")
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:8000")
					.setValue(this.plugin.settings.locusUrl)
					.onChange(async (value) => {
						this.plugin.settings.locusUrl = value.trim();
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Test")
					.setCta()
					.onClick(async () => {
						const client = new LocusClient(this.plugin.settings.locusUrl);
						const ok = await client.health();
						new Notice(ok ? "Connected to Locus!" : "Could not reach Locus.");
					})
			);

		new Setting(containerEl)
			.setName("Space name")
			.setDesc("Locus space this vault maps to. Created automatically on first sync.")
			.addText((text) =>
				text
					.setPlaceholder("my_vault")
					.setValue(this.plugin.settings.spaceName)
					.onChange(async (value) => {
						this.plugin.settings.spaceName = value.trim().toLowerCase().replace(/\s+/g, "_");
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-sync")
			.setDesc("Automatically sync notes to Locus when they are created or modified.")
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

		containerEl.createEl("h3", { text: "Actions" });

		new Setting(containerEl)
			.setName("Full vault sync")
			.setDesc("Re-ingest every note in this vault into Locus.")
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
