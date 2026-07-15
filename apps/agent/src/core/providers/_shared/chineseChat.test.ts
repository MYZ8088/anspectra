import { describe, expect, it } from "vitest";
import { buildSources } from "../../../lib/extraction/sourceUtils.js";
import { parseReportedSearchSourceCount } from "../../steps/extractSources.js";
import { extractVisibleUrlCandidates } from "./chineseChat.js";

describe("visible Chinese-platform source extraction", () => {
	it("captures full URLs, www links, and bare citation domains", () => {
		expect(
			extractVisibleUrlCandidates(`
        resources.rework.com
        www.toolsforhumans.ai.
        research.vendor.xyz/report
        See https://amplitude.com/docs/analytics?from=qwen,
      `),
		).toEqual([
			{
				rawHref: "https://resources.rework.com",
				title: "resources.rework.com",
				citedText: "",
				sourceKind: "answer_link",
			},
			{
				rawHref: "https://www.toolsforhumans.ai",
				title: "www.toolsforhumans.ai",
				citedText: "",
				sourceKind: "answer_link",
			},
			{
				rawHref: "https://research.vendor.xyz/report",
				title: "research.vendor.xyz/report",
				citedText: "",
				sourceKind: "answer_link",
			},
			{
				rawHref: "https://amplitude.com/docs/analytics?from=qwen",
				title: "https://amplitude.com/docs/analytics?from=qwen",
				citedText: "",
				sourceKind: "answer_link",
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

	it("keeps only HTTP Web URLs in report evidence", () => {
		expect(
			buildSources([
				{
					rawHref: "javascript:void(0)",
					title: "Open panel",
					citedText: "",
					sourceKind: "search_source",
				},
				{
					rawHref: "https://example.com/source",
					title: "Source",
					citedText: "",
					sourceKind: "search_source",
				},
			]),
		).toHaveLength(1);
	});

	it("keeps the provider-reported search count separate from extracted URLs", () => {
		expect(
			parseReportedSearchSourceCount(
				"搜索 3 个关键词，参考 15 篇资料；回答正文只展示了 2 个链接。",
			),
		).toBe(15);
		expect(parseReportedSearchSourceCount("Reviewed 24 web pages")).toBe(24);
		expect(
			parseReportedSearchSourceCount("No source count is visible"),
		).toBeNull();
	});
});
