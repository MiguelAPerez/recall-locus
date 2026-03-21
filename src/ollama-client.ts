import { Platform, requestUrl } from "obsidian";

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
			const res = await requestUrl({ url: `${this.baseUrl}/api/tags`, throw: false });
			return res.status === 200;
		} catch {
			return false;
		}
	}

	async listModels(): Promise<string[]> {
		try {
			const res = await requestUrl({ url: `${this.baseUrl}/api/tags`, throw: false });
			if (res.status !== 200) return [];
			return (res.json.models ?? []).map((m: { name: string }) => m.name);
		} catch {
			return [];
		}
	}

	/** Non-streaming call — returns full response text. Use format:"json" for structured output. */
	async chat(messages: OllamaMessage[], model: string, format?: "json"): Promise<string> {
		const body: Record<string, unknown> = { model, messages, stream: false };
		if (format) body.format = format;

		const res = await requestUrl({
			url: `${this.baseUrl}/api/chat`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			throw: false,
		});
		if (res.status < 200 || res.status >= 300) throw new Error(`Ollama error: ${res.status}`);
		return res.json.message?.content ?? "";
	}

	/** Streaming call — fires onToken for each chunk, returns full accumulated text.
	 *  Falls back to a single non-streaming call on mobile where ReadableStream is unreliable. */
	async chatStream(
		messages: OllamaMessage[],
		model: string,
		onToken: (token: string) => void,
		signal?: AbortSignal
	): Promise<string> {
		if (Platform.isMobile) {
			const full = await this.chat(messages, model);
			onToken(full);
			return full;
		}

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
