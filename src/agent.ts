import { RecallLocusClient, SearchResult } from "./recall-locus-client";
import { OllamaClient, OllamaMessage } from "./ollama-client";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface SearchAction {
	action: "search";
	thought: string;
	query: string;
}

interface OpenFileAction {
	action: "open_file";
	thought: string;
	doc_id: string; // exact doc_id from search results
}

interface AnswerAction {
	action: "answer";
	thought: string;
}

type AgentAction = SearchAction | OpenFileAction | AnswerAction;

// ---------------------------------------------------------------------------
// Events emitted to the UI
// ---------------------------------------------------------------------------

export type AgentEvent =
	| { type: "thinking" }
	| { type: "search"; thought: string; query: string }
	| { type: "search_results"; query: string; results: SearchResult[] }
	| { type: "open_file"; doc_id: string; source?: string }
	| { type: "open_file_done"; doc_id: string; source?: string }
	| { type: "answer_start"; thought: string }
	| { type: "answer_token"; token: string }
	| { type: "answer_done" }
	| { type: "error"; message: string };

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a research assistant with access to a personal knowledge vault.
Respond with JSON only — no extra text, no markdown fences.

Available actions:

Search the vault (returns excerpts):
{"thought":"why you're searching","action":"search","query":"search terms"}

Fetch the FULL content of a specific document from the server (use the doc_id from search results):
{"thought":"why you need the full document","action":"open_file","doc_id":"exact-doc_id-from-results"}

Signal you are ready to give your final answer:
{"thought":"summary of findings","action":"answer"}

Rules:
- Output valid JSON only
- Run 1–3 searches before answering; use open_file when a chunk isn't enough
- The doc_id field must be copied exactly from the search results (the id shown as "doc_id:...")
- After 3 searches you MUST use action:"answer"
- In your final answer reference notes by their file name (the "File:" value), never by id or UUID`;

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class Agent {
	private locus: RecallLocusClient;
	private ollama: OllamaClient;
	private space: string;
	private model: string;
	private maxSteps: number;
	private abort: AbortController;

	constructor(opts: {
		locusUrl: string;
		ollamaUrl: string;
		space: string;
		model: string;
		maxSteps?: number;
	}) {
		this.locus = new RecallLocusClient(opts.locusUrl);
		this.ollama = new OllamaClient(opts.ollamaUrl);
		this.space = opts.space;
		this.model = opts.model;
		this.maxSteps = opts.maxSteps ?? 6;
		this.abort = new AbortController();
	}

	cancel(): void {
		this.abort.abort();
	}

	async run(question: string, emit: (event: AgentEvent) => void): Promise<void> {
		this.abort = new AbortController();

		const messages: OllamaMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: question },
		];

		let searchCount = 0;

		for (let step = 0; step < this.maxSteps; step++) {
			if (this.abort.signal.aborted) return;

			emit({ type: "thinking" });

			// Hard-nudge after 3 searches
			if (searchCount >= 3) {
				const last = messages[messages.length - 1];
				if (last.role === "user" && !last.content.includes("MUST answer")) {
					last.content += "\n\nYou have searched enough. You MUST use action:\"answer\" now.";
				}
			}

			let raw: string;
			try {
				raw = await this.ollama.chat(messages, this.model, "json");
			} catch (err) {
				emit({ type: "error", message: (err as Error).message });
				return;
			}

			const action = this.parse(raw);
			if (!action) {
				emit({ type: "error", message: `Could not parse response: ${raw.slice(0, 120)}` });
				return;
			}

			messages.push({ role: "assistant", content: raw });

			// ---------------------------------------------------------------
			if (action.action === "search") {
				searchCount++;
				emit({ type: "search", thought: action.thought, query: action.query });

				try {
					const resp = await this.locus.search(this.space, action.query, 5, false);
					emit({ type: "search_results", query: action.query, results: resp.results });

					const context = resp.results.length
						? resp.results
							.map((r) => {
								const name = r.source ?? "unknown";
								return `File: ${name} [id:${r.doc_id}] (score:${r.score.toFixed(2)})\n${r.text}`;
							})
							.join("\n---\n")
						: "No results found.";

					messages.push({
						role: "user",
						content: `Search results for "${action.query}":\n${context}`,
					});
				} catch (err) {
					messages.push({
						role: "user",
						content: `Search failed: ${(err as Error).message}`,
					});
				}

			// ---------------------------------------------------------------
			} else if (action.action === "open_file") {
				emit({ type: "open_file", doc_id: action.doc_id });

				try {
					const doc = await this.locus.getDocument(this.space, action.doc_id);
					emit({ type: "open_file_done", doc_id: action.doc_id, source: doc.source });
					messages.push({
						role: "user",
						content: `Full content of document "${action.doc_id}" (${doc.source ?? "unknown"}):\n${doc.text}`,
					});
				} catch (err) {
					messages.push({
						role: "user",
						content: `Failed to fetch document "${action.doc_id}": ${(err as Error).message}`,
					});
				}

			// ---------------------------------------------------------------
			} else if (action.action === "answer") {
				emit({ type: "answer_start", thought: action.thought });

				const synthMessages: OllamaMessage[] = [
					...messages,
					{
						role: "user",
						content:
							"Now write your answer in plain prose. Be specific. " +
							"When referencing a note, use its file name (the 'File:' value from search results), " +
							"never a doc id or UUID. Do not output JSON.",
					},
				];

				try {
					await this.ollama.chatStream(
						synthMessages,
						this.model,
						(token) => emit({ type: "answer_token", token }),
						this.abort.signal
					);
				} catch (err) {
					if ((err as Error).name !== "AbortError") {
						emit({ type: "error", message: (err as Error).message });
					}
					return;
				}

				emit({ type: "answer_done" });
				return;
			}
		}

		emit({ type: "error", message: "Reached the step limit without an answer." });
	}

	private parse(raw: string): AgentAction | null {
		try { return JSON.parse(raw) as AgentAction; } catch { /* fall through */ }
		const match = raw.match(/\{[\s\S]*\}/);
		if (match) {
			try { return JSON.parse(match[0]) as AgentAction; } catch { /* fall through */ }
		}
		return null;
	}
}
