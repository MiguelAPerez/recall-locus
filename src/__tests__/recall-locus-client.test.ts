import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecallLocusClient } from "../recall-locus-client";

// Mock requestUrl from obsidian
vi.mock("obsidian", () => ({
	requestUrl: vi.fn(),
}));

import { requestUrl } from "obsidian";
const mockRequestUrl = vi.mocked(requestUrl);

describe("RecallLocusClient", () => {
	let client: RecallLocusClient;

	beforeEach(() => {
		client = new RecallLocusClient("http://localhost:8000");
		vi.clearAllMocks();
	});

	describe("health()", () => {
		it("returns true when server responds 200", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 200 } as any);
			expect(await client.health()).toBe(true);
		});

		it("returns false when server responds non-200", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 503 } as any);
			expect(await client.health()).toBe(false);
		});

		it("returns false when request throws", async () => {
			mockRequestUrl.mockRejectedValueOnce(new Error("ECONNREFUSED"));
			expect(await client.health()).toBe(false);
		});
	});

	describe("search()", () => {
		it("hits the correct URL with query params", async () => {
			const payload = {
				query: "hello",
				space: "test",
				results: [{ doc_id: "1", text: "hello world", score: 0.9, source: "Notes/a.md" }],
			};
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: payload } as any);

			const resp = await client.search("test", "hello", 3, false);

			expect(resp.results).toHaveLength(1);
			expect(resp.results[0].score).toBe(0.9);

			const call = mockRequestUrl.mock.calls[0][0] as any;
			expect(call.url).toContain("/spaces/test/search");
			expect(call.url).toContain("q=hello");
			expect(call.url).toContain("k=3");
		});

		it("throws when server returns non-200", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 500 } as any);
			await expect(client.search("test", "hello", 3, false)).rejects.toThrow("Search failed");
		});
	});

	describe("ensureSpace()", () => {
		it("does nothing when space is already confirmed (cached)", async () => {
			// First call: list returns the space
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { spaces: ["my_space"] },
			} as any);
			await client.ensureSpace("my_space");
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);

			// Second call: should skip all network requests due to cache
			vi.clearAllMocks();
			await client.ensureSpace("my_space");
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		it("creates space when it does not exist in the list", async () => {
			// list call returns other spaces
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { spaces: ["other_space"] },
			} as any);
			// create call
			mockRequestUrl.mockResolvedValueOnce({ status: 201 } as any);

			await expect(client.ensureSpace("my_space")).resolves.not.toThrow();
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});

		it("throws when space creation fails", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { spaces: [] },
			} as any);
			mockRequestUrl.mockResolvedValueOnce({ status: 500 } as any);

			await expect(client.ensureSpace("my_space")).rejects.toThrow("Failed to create space");
		});
	});
});
