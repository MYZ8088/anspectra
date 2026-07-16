import { describe, expect, it } from "vitest";
import { normalizeProviderMarkdown } from "./normalizeProviderMarkdown.js";

describe("normalizeProviderMarkdown", () => {
	it("removes duplicated ordered-list markers", () => {
		expect(normalizeProviderMarkdown("1.  1. **First**\n2.  2. Second")).toBe(
			"1. **First**\n2. Second",
		);
	});

	it("removes provider bullet glyph duplication", () => {
		expect(normalizeProviderMarkdown("-   ∙ First\n* • Second")).toBe(
			"- First\n- Second",
		);
	});

	it("removes empty glyph bullets inside blockquotes", () => {
		const normalized = normalizeProviderMarkdown(
			"> **Unverified**\n>\n> - ∙\n>\n> - First estimate",
		);
		expect(normalized).not.toContain("∙");
		expect(normalized).toContain("> - First estimate");
	});

	it("normalizes conversion whitespace without changing valid lists", () => {
		expect(
			normalizeProviderMarkdown(
				"\u200B1. First  \n2. Second\n\n\n* * *\n\nParagraph",
			),
		).toBe("1. First\n2. Second\n\n---\n\nParagraph");
	});
});
