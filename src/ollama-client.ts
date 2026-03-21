import { requestUrl } from "obsidian";

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

	/** Non-streaming chat call that fires onToken with the complete response.
	 *  Uses requestUrl for cross-platform compatibility. */
	async chatStream(
		messages: OllamaMessage[],
		model: string,
		onToken: (token: string) => void,
		_signal?: AbortSignal
	): Promise<string> {
		const full = await this.chat(messages, model);
		onToken(full);
		return full;
	}
}
