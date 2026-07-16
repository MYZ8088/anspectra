import { describe, expect, it } from "vitest";
import { normalizePromptValue } from "./promptInput.js";

describe("normalizePromptValue", () => {
	it("treats contenteditable line-break expansion as equivalent", () => {
		const prompt =
			"Product analytics是什么？\n\n请使用简体中文完整回答；产品名可保留原文。";
		const editorValue =
			"Product analytics是什么？\n\n\n请使用简体中文完整回答；产品名可保留原文。\n";
		expect(normalizePromptValue(editorValue)).toBe(
			normalizePromptValue(prompt),
		);
	});

	it("keeps non-whitespace prompt differences detectable", () => {
		expect(normalizePromptValue("PostHog 是什么？")).not.toBe(
			normalizePromptValue("Mixpanel 是什么？"),
		);
	});
});
