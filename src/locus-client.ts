export interface SearchResult {
	doc_id: string;
	score: number;
	text: string;
	source?: string;
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

export class LocusClient {
	private baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
	}

	async health(): Promise<boolean> {
		try {
			const res = await fetch(`${this.baseUrl}/health`);
			return res.ok;
		} catch {
			return false;
		}
	}

	async createSpace(name: string): Promise<void> {
		const res = await fetch(`${this.baseUrl}/spaces`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});
		// 409 = already exists, that's fine
		if (!res.ok && res.status !== 409) {
			throw new Error(`Failed to create space "${name}": ${res.statusText}`);
		}
	}

	async listDocuments(space: string): Promise<DocumentEntry[]> {
		const res = await fetch(`${this.baseUrl}/spaces/${encodeURIComponent(space)}/documents`);
		if (!res.ok) throw new Error(`Failed to list documents: ${res.statusText}`);
		const data = await res.json();
		return data.documents ?? [];
	}

	async ingestText(space: string, text: string, source: string): Promise<IngestResponse> {
		const form = new FormData();
		form.append("text", text);
		form.append("source", source);
		const res = await fetch(`${this.baseUrl}/spaces/${encodeURIComponent(space)}/documents`, {
			method: "POST",
			body: form,
		});
		if (!res.ok) {
			throw new Error(`Failed to ingest "${source}": ${res.statusText}`);
		}
		return res.json();
	}

	async deleteDocument(space: string, docId: string): Promise<void> {
		const res = await fetch(
			`${this.baseUrl}/spaces/${encodeURIComponent(space)}/documents/${encodeURIComponent(docId)}`,
			{ method: "DELETE" }
		);
		// 404 = already gone, that's fine
		if (!res.ok && res.status !== 404) {
			throw new Error(`Failed to delete document "${docId}": ${res.statusText}`);
		}
	}

	async search(space: string, query: string, k = 5, full = false): Promise<SearchResponse> {
		const params = new URLSearchParams({
			q: query,
			k: String(k),
			full: String(full),
		});
		const res = await fetch(
			`${this.baseUrl}/spaces/${encodeURIComponent(space)}/search?${params}`
		);
		if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
		return res.json();
	}
}
