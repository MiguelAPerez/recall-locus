import { requestUrl } from "obsidian";

interface RawSearchResult {
	chunk_id: string;
	doc_id: string;
	text: string;
	score: number;
	metadata?: { source?: string; filename?: string; doc_id?: string };
}

export interface SearchResult {
	doc_id: string;
	score: number;
	text: string;
	source?: string; // lifted from metadata.source or metadata.filename
	space: string;
}

export interface SearchResponse {
	query: string;
	space: string;
	results: SearchResult[];
}

export interface IngestResponse {
	doc_id: string;
	space: string;
	chunk_count: number;
}

export interface DocumentEntry {
	doc_id: string;
	source?: string;
}

function buildMultipart(fields: Record<string, string>): { body: ArrayBuffer; contentType: string } {
	const boundary = `----LocusBoundary${Math.random().toString(36).slice(2)}`;
	let raw = "";
	for (const [key, value] of Object.entries(fields)) {
		raw += `--${boundary}\r\n`;
		raw += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
		raw += `${value}\r\n`;
	}
	raw += `--${boundary}--\r\n`;

	const encoder = new TextEncoder();
	return {
		body: encoder.encode(raw).buffer,
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

export class LocusClient {
	private baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
	}

	async health(): Promise<boolean> {
		try {
			const res = await requestUrl({ url: `${this.baseUrl}/health`, throw: false });
			return res.status === 200;
		} catch {
			return false;
		}
	}

	async createSpace(name: string): Promise<void> {
		const res = await requestUrl({
			url: `${this.baseUrl}/spaces`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
			throw: false,
		});
		if (res.status !== 200 && res.status !== 201 && res.status !== 409) {
			throw new Error(`Failed to create space "${name}": ${res.status}`);
		}
	}

	async listDocuments(space: string): Promise<DocumentEntry[]> {
		const res = await requestUrl({
			url: `${this.baseUrl}/spaces/${encodeURIComponent(space)}/documents`,
			throw: false,
		});
		if (res.status !== 200) throw new Error(`Failed to list documents: ${res.status}`);
		return res.json.documents ?? [];
	}

	async ingestText(space: string, text: string, source: string): Promise<IngestResponse> {
		const { body, contentType } = buildMultipart({ text, source });
		const res = await requestUrl({
			url: `${this.baseUrl}/spaces/${encodeURIComponent(space)}/documents`,
			method: "POST",
			headers: { "Content-Type": contentType },
			body,
			throw: false,
		});
		if (res.status !== 200 && res.status !== 201) {
			throw new Error(`Failed to ingest "${source}": ${res.status}`);
		}
		return res.json;
	}

	async getDocument(space: string, docId: string): Promise<{ text: string; source?: string }> {
		const res = await requestUrl({
			url: `${this.baseUrl}/spaces/${encodeURIComponent(space)}/documents/${encodeURIComponent(docId)}`,
			throw: false,
		});
		if (res.status !== 200) throw new Error(`Failed to get document "${docId}": ${res.status}`);
		return res.json;
	}

	async deleteDocument(space: string, docId: string): Promise<void> {
		const res = await requestUrl({
			url: `${this.baseUrl}/spaces/${encodeURIComponent(space)}/documents/${encodeURIComponent(docId)}`,
			method: "DELETE",
			throw: false,
		});
		if (res.status !== 200 && res.status !== 404) {
			throw new Error(`Failed to delete document "${docId}": ${res.status}`);
		}
	}

	async search(space: string, query: string, k = 5, full = false): Promise<SearchResponse> {
		const params = new URLSearchParams({ q: query, k: String(k), full: String(full) });
		const res = await requestUrl({
			url: `${this.baseUrl}/spaces/${encodeURIComponent(space)}/search?${params}`,
			throw: false,
		});
		if (res.status !== 200) throw new Error(`Search failed: ${res.status}`);

		const raw = res.json as { query: string; space: string; results: RawSearchResult[] };
		return {
			query: raw.query,
			space: raw.space,
			results: raw.results.map((r) => ({
				doc_id: r.doc_id,
				score: r.score,
				text: r.text,
				space: raw.space,
				// source lives inside metadata — prefer source over filename
				source: r.metadata?.source || r.metadata?.filename || undefined,
			})),
		};
	}
}
