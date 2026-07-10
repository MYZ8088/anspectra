import { describe, expect, it } from "vitest";
import { extractVisibleUrlCandidates } from "./chineseChat.js";

describe("visible Chinese-platform source extraction", () => {
	it("captures full URLs, www links, and bare citation domains", () => {
		expect(
			extractVisibleUrlCandidates(`
        resources.rework.com
        www.toolsforhumans.ai.
        See https://amplitude.com/docs/analytics?from=qwen,
      `),
		).toEqual([
			{
				rawHref: "https://resources.rework.com",
				title: "resources.rework.com",
				citedText: "",
			},
			{
				rawHref: "https://www.toolsforhumans.ai",
				title: "www.toolsforhumans.ai",
				citedText: "",
			},
			{
				rawHref: "https://amplitude.com/docs/analytics?from=qwen",
				title: "https://amplitude.com/docs/analytics?from=qwen",
				citedText: "",
			},
		]);
	});

	it("does not manufacture a source from ordinary answer prose", () => {
		expect(
			extractVisibleUrlCandidates(
				"Choose a product based on pricing, integrations, and evidence quality.",
			),
		).toEqual([]);
	});
});
