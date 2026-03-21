import { LocusClient, SearchResult } from "./locus-client";
import { OllamaClient, OllamaMessage } from "./ollama-client";

// ---------------------------------------------------------------------------
// Action types the agent can emit
// ---------------------------------------------------------------------------

interface SearchAction {
	action: "search";
	thought: string;
	query: string;
}

interface OpenFileAction {
	action: "open_file";
	thought: string;
	path: string;
	reason: string;
}

interface AnswerAction {
	action: "answer";
	thought: string;
	sources?: Array<{ path: string; reason?: string }>;
}

type AgentAction = SearchAction | OpenFileAction | AnswerAction;

// ---------------------------------------------------------------------------
// Events emitted to the UI
// ---------------------------------------------------------------------------

export type AgentEvent =
	| { type: "thinking" }
	| { type: "search"; thought: string; query: string }
	| { type: "search_results"; query: string; results: SearchResult[] }
	| { type: "open_file_request"; path: string; reason: string; resolve: (content: string | null) => void }
	| { type: "answer_start"; thought: string }
	| { type: "answer_token"; token: string }
	| { type: "answer_done"; sources: Array<{ path: string; reason?: string }> }
	| { type: "error"; message: string };

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a research assistant with access to a personal knowledge vault.
You reason step-by-step and respond with JSON only — no extra text.

Available actions:

Search the vault:
{"thought":"reason for searching","action":"search","query":"search terms"}

Open a full file (only when you know the exact path from a previous search result):
{"thought":"reason","action":"open_file","path":"exact/path/to/note.md","reason":"one-line reason shown to user"}

Signal you are ready to answer (after gathering enough context):
{"thought":"summary of what you found","action":"answer","sources":[{"path":"file.md","reason":"why relevant"}]}

Rules:
- Output valid JSON only — no markdown, no preamble
- Run at least one search before answering
- open_file only with an exact path seen in search results
- answer when you have sufficient context (or after 6 steps)
- Include relevant sources in the answer action`;

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class Agent {
	private locus: LocusClient;
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
		this.locus = new LocusClient(opts.locusUrl);
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

		for (let step = 0; step < this.maxSteps; step++) {
			if (this.abort.signal.aborted) return;

			emit({ type: "thinking" });

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

			// Add to history so the model sees its own reasoning
			messages.push({ role: "assistant", content: raw });

			// ---------------------------------------------------------------
			if (action.action === "search") {
				emit({ type: "search", thought: action.thought, query: action.query });

				try {
					const resp = await this.locus.search(this.space, action.query, 5, false);
					emit({ type: "search_results", query: action.query, results: resp.results });

					const context = resp.results.length
						? resp.results
							.map((r) => `[${r.source ?? r.doc_id}] (score: ${r.score.toFixed(2)})\n${r.text}`)
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
				// Pause loop — wait for user to allow or skip
				const content = await new Promise<string | null>((resolve) => {
					emit({
						type: "open_file_request",
						path: action.path,
						reason: action.reason,
						resolve,
					});
				});

				if (content !== null) {
					messages.push({
						role: "user",
						content: `Full content of "${action.path}":\n${content}`,
					});
				} else {
					messages.push({
						role: "user",
						content: `User declined to open "${action.path}". Continue without it.`,
					});
				}

			// ---------------------------------------------------------------
			} else if (action.action === "answer") {
				emit({ type: "answer_start", thought: action.thought });

				// Stream a synthesis call — model writes freely, not constrained to JSON
				const synthMessages: OllamaMessage[] = [
					...messages,
					{
						role: "user",
						content:
							"Now write your final answer in plain prose. Be clear and specific. " +
							"Reference exact note titles where relevant. Do not output JSON.",
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

				emit({ type: "answer_done", sources: action.sources ?? [] });
				return;
			}
		}

		emit({ type: "error", message: "Reached the step limit without an answer." });
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	private parse(raw: string): AgentAction | null {
		try {
			return JSON.parse(raw) as AgentAction;
		} catch { /* fall through */ }

		// Try to fish out a JSON object if the model added surrounding text
		const match = raw.match(/\{[\s\S]*\}/);
		if (match) {
			try { return JSON.parse(match[0]) as AgentAction; } catch { /* fall through */ }
		}
		return null;
	}
}
