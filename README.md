# Recall

An Obsidian plugin that syncs your vault to a [Locus](https://github.com/MiguelAPerez/locus) semantic search instance and lets you search your notes with natural language from a sidebar panel.

## Features

- **Semantic search** — query your notes in plain language and get ranked results with highlighted excerpts
- **Auto-sync** — notes are pushed to Locus automatically when created, modified, renamed, or deleted
- **Startup sync** — optionally re-sync the full vault on every Obsidian launch
- **Click-to-open** — clicking a result opens the source note directly

## Requirements

A running [Locus](https://github.com/MiguelAPerez/locus) instance. By default the plugin expects it at `http://localhost:8000`.

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/locus-obsidian/` directory.
2. Enable the plugin in **Settings → Community plugins**.

## Configuration

Open **Settings → Locus** and fill in:

| Setting | Description | Default |
|---|---|---|
| Locus URL | Base URL of your Locus instance | `http://localhost:8000` |
| Space name | Locus space this vault maps to (created automatically) | *(required)* |
| Auto-sync | Push note changes to Locus in real time | on |
| Sync on startup | Full vault sync when Obsidian loads | on |
| Default result count | How many results to show (1–50) | 5 |

Use the **Test** button next to the URL field to verify connectivity. Use **Sync now** to manually trigger a full vault sync, or **Clear cache** to force a full re-ingest on the next sync.

## Usage

Open the search panel via:
- The **search** ribbon icon
- Command palette: `Locus: Open search panel`
- Command palette: `Locus: Sync vault now`

Type a query and press `Enter` or click **Search**. Results show the note title, a similarity score, and a highlighted text excerpt. Click any result to open the note.

## Development

```bash
npm install
npm run dev       # watch mode
npm run build     # type-check + production bundle
```

The plugin is built with esbuild and targets the Obsidian plugin API. Source files live in `src/`:

- `main.ts` — plugin entry point, vault event wiring, status bar
- `locus-client.ts` — HTTP client for the Locus REST API
- `sync-engine.ts` — tracks synced files (path → doc ID + mtime) and drives ingest/delete/rename
- `chat-panel.ts` — sidebar `ItemView` with the search UI
- `settings.ts` — settings schema, defaults, and settings tab UI

Sync state (`SyncData`) is persisted alongside settings via Obsidian's `loadData`/`saveData`. The engine compares each file's `mtime` against the stored record to skip unchanged notes during a full sync.
