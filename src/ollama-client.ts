export interface OllamaMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export class OllamaClient {
	private baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
	}

	async health(): Promise<boolean> {
		try {
			const res = await fetch(`${this.baseUrl}/api/tags`);
			return res.ok;
		} catch {
			return false;
		}
	}

	async listModels(): Promise<string[]> {
		try {
			const res = await fetch(`${this.baseUrl}/api/tags`);
			if (!res.ok) return [];
			const data = await res.json();
			return (data.models ?? []).map((m: { name: string }) => m.name);
		} catch {
			return [];
		}
	}

	/** Non-streaming call — returns full response text. Use format:"json" for structured output. */
	async chat(messages: OllamaMessage[], model: string, format?: "json"): Promise<string> {
		const body: Record<string, unknown> = { model, messages, stream: false };
		if (format) body.format = format;

		const res = await fetch(`${this.baseUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
		const data = await res.json();
		return data.message?.content ?? "";
	}

	/** Streaming call — fires onToken for each chunk, returns full accumulated text. */
	async chatStream(
		messages: OllamaMessage[],
		model: string,
		onToken: (token: string) => void,
		signal?: AbortSignal
	): Promise<string> {
		const res = await fetch(`${this.baseUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model, messages, stream: true }),
			signal,
		});
		if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`);

		const reader = res.body?.getReader();
		if (!reader) throw new Error("No response body");

		const decoder = new TextDecoder();
		let full = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				for (const line of decoder.decode(value, { stream: true }).split("\n")) {
					if (!line.trim()) continue;
					try {
						const token = (JSON.parse(line).message?.content as string) ?? "";
						if (token) { full += token; onToken(token); }
					} catch { /* partial line, skip */ }
				}
			}
		} finally {
			reader.releaseLock();
		}
		return full;
	}
}
