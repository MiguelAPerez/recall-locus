import { Notice, TFile } from "obsidian";
import type RecallLocusPlugin from "./main";
import { RecallLocusClient } from "./recall-locus-client";

interface FileRecord {
	docId: string;
	mtime: number;
}

export interface SyncData {
	files: Record<string, FileRecord>;
}

export class SyncEngine {
	private plugin: RecallLocusPlugin;
	private client: RecallLocusClient;
	private isSyncing = false;

	constructor(plugin: RecallLocusPlugin) {
		this.plugin = plugin;
		this.client = new RecallLocusClient(plugin.settings.recallLocusUrl);
	}

	/** Call when settings change so the client picks up the new URL. */
	refreshClient(): void {
		this.client = new RecallLocusClient(this.plugin.settings.recallLocusUrl);
	}

	// -------------------------------------------------------------------------
	// Vault event wiring
	// -------------------------------------------------------------------------

	rebindVaultEvents(): void {
		// Events are registered/unregistered via the plugin's registerEvent helper.
		// We re-register on settings change by toggling the flag; Obsidian handles
		// deregistration on plugin unload automatically.
		// Nothing to do here at runtime — the event handlers check `autoSync` inline.
	}

	// -------------------------------------------------------------------------
	// Public sync API
	// -------------------------------------------------------------------------

	async syncVault(): Promise<void> {
		if (this.isSyncing) return;
		const { spaceName } = this.plugin.settings;
		if (!spaceName) {
			new Notice("Set a space name in settings before syncing.");
			return;
		}

		this.isSyncing = true;
		this.plugin.setStatus("syncing");

		try {
			await this.client.ensureSpace(spaceName);

			const files = this.plugin.app.vault.getMarkdownFiles();
			const syncData = this.plugin.syncData;
			const vaultPaths = new Set(files.map((f) => f.path));

			// Remove stale entries (deleted notes)
			const stalePaths = Object.keys(syncData.files).filter((p) => !vaultPaths.has(p));
			for (const p of stalePaths) {
				await this.removeRecord(p);
			}

			// Ingest new / changed notes
			let count = 0;
			for (const file of files) {
				const record = syncData.files[file.path];
				const changed = !record || record.mtime !== file.stat.mtime;
				if (changed) {
					await this.ingestFile(file);
					count++;
				}
			}

			await this.plugin.saveSyncData();
			new Notice(`RecallLocus: synced ${count} note${count !== 1 ? "s" : ""}.`);
		} catch (err) {
			console.error("[RecallLocus] Sync error:", err);
			new Notice(`RecallLocus sync failed: ${(err as Error).message}`);
		} finally {
			this.isSyncing = false;
			this.plugin.setStatus("idle");
		}
	}

	async syncFile(file: TFile): Promise<void> {
		if (!this.plugin.settings.autoSync) return;
		const { spaceName } = this.plugin.settings;
		if (!spaceName) return;

		try {
			await this.client.ensureSpace(spaceName);
			await this.ingestFile(file);
			await this.plugin.saveSyncData();
		} catch (err) {
			console.error("[RecallLocus] File sync error:", err);
		}
	}

	async deleteFile(path: string): Promise<void> {
		if (!this.plugin.settings.autoSync) return;
		const { spaceName } = this.plugin.settings;
		if (!spaceName) return;

		try {
			await this.removeRecord(path);
			await this.plugin.saveSyncData();
		} catch (err) {
			console.error("[RecallLocus] Delete error:", err);
		}
	}

	async renameFile(file: TFile, oldPath: string): Promise<void> {
		if (!this.plugin.settings.autoSync) return;
		const { spaceName } = this.plugin.settings;
		if (!spaceName) return;

		try {
			await this.client.ensureSpace(spaceName);
			await this.removeRecord(oldPath);
			await this.ingestFile(file);
			await this.plugin.saveSyncData();
		} catch (err) {
			console.error("[RecallLocus] Rename error:", err);
		}
	}

	async clearCache(): Promise<void> {
		this.plugin.syncData = { files: {} };
		await this.plugin.saveSyncData();
	}

	// -------------------------------------------------------------------------
	// Internal helpers
	// -------------------------------------------------------------------------

	private async ingestFile(file: TFile): Promise<void> {
		const { spaceName } = this.resolveContext();
		const text = await this.plugin.app.vault.read(file);
		if (!text.trim()) return;
		const resp = await this.client.ingestText(spaceName, text, file.path);

		// If there was an old doc for this path, delete it first
		const existing = this.plugin.syncData.files[file.path];
		if (existing && existing.docId !== resp.doc_id) {
			await this.client.deleteDocument(spaceName, existing.docId).catch(() => {});
		}

		this.plugin.syncData.files[file.path] = {
			docId: resp.doc_id,
			mtime: file.stat.mtime,
		};
	}

	private async removeRecord(path: string): Promise<void> {
		const { spaceName } = this.resolveContext();
		const record = this.plugin.syncData.files[path];
		if (record) {
			await this.client.deleteDocument(spaceName, record.docId);
			delete this.plugin.syncData.files[path];
		}
	}

	private resolveContext() {
		return {
			spaceName: this.plugin.settings.spaceName,
			syncData: this.plugin.syncData,
		};
	}
}
