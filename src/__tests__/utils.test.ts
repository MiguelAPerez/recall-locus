import { describe, it, expect } from "vitest";

// Pure utility: extract .md paths from text (mirrors chat-view logic)
// The regex [\w./ -]+ captures word chars, dots, slashes, spaces, hyphens.
function extractPaths(text: string): string[] {
	const seen = new Set<string>();
	const results: string[] = [];
	for (const m of text.matchAll(/[\w./ -]+\.md/g)) {
		const p = m[0].trim();
		if (!seen.has(p)) { seen.add(p); results.push(p); }
	}
	return results;
}

describe("extractPaths", () => {
	it("extracts a bare path", () => {
		expect(extractPaths("Notes/Foo.md")).toEqual(["Notes/Foo.md"]);
	});

	it("extracts path at start of sentence", () => {
		const [first] = extractPaths("Notes/Foo.md has the details");
		expect(first).toBe("Notes/Foo.md");
	});

	it("extracts multiple paths separated by newlines", () => {
		const paths = extractPaths("Notes/A.md\nNotes/B.md");
		expect(paths).toEqual(["Notes/A.md", "Notes/B.md"]);
	});

	it("deduplicates repeated paths", () => {
		const paths = extractPaths("Notes/A.md\nNotes/A.md");
		expect(paths).toEqual(["Notes/A.md"]);
	});

	it("returns empty array when no paths found", () => {
		expect(extractPaths("no markdown files here")).toEqual([]);
	});

	it("handles nested paths", () => {
		const paths = extractPaths("folder/sub/note.md");
		expect(paths).toContain("folder/sub/note.md");
	});

	it("handles hyphenated file names", () => {
		const paths = extractPaths("Notes/hello-world.md");
		expect(paths).toContain("Notes/hello-world.md");
	});
});
