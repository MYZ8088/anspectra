import { describe, expect, it, vi } from "vitest";
import { buildContentQualityReport } from "./content.js";

vi.mock("@aloom/db", () => ({ db: {}, schema: {} }));
vi.mock("../env.js", () => ({
	env: { AIHUBMIX_ANALYSIS_MODEL: "test", AIHUBMIX_ANALYSIS_FALLBACK_MODEL: "" },
}));
vi.mock("../llm/index.js", () => ({ aihubmix: {} }));

const now = new Date("2026-07-10T00:00:00.000Z");
const baseRevision = {
	markdown: "## 结论\n这是一段经过核验的产品说明，用于帮助采购团队理解适用范围。",
	html: "<h2>结论</h2><p>这是一段经过核验的产品说明。</p>",
	jsonLd: null,
	factIds: [] as string[],
	claimMap: [] as Array<Record<string, unknown>>,
	atomicFacts: [] as Array<{ fact: string; sourceUrl?: string; status: string }>,
	evidenceGaps: [] as string[],
	faq: [{ question: "适合谁？", answer: "适合需要核验内容的采购团队。" }],
	directAnswer: "该产品适合需要核验内容和来源的采购团队。",
	structuredSummary: "适用对象、事实边界和证据来源均在正文中明确列出。",
};

function fact(status: string) {
	return {
		id: "fact-1",
		workspaceId: "workspace-1",
		subject: "产品",
		predicate: "价格",
		value: "官方套餐每月 100 元",
		sourceUrl: "https://example.com/pricing",
		sourceType: "official",
		evidenceGrade: "A",
		retrievedAt: now,
		region: "CN",
		validUntil: new Date("2027-01-01T00:00:00.000Z"),
		supportedClaims: ["官方套餐每月 100 元"],
		confidence: 100,
		status,
		verifiedAt: status === "verified" ? now : null,
		createdAt: now,
		updatedAt: now,
	};
}

describe("buildContentQualityReport", () => {
	it("blocks sensitive claims backed only by an unverified fact", () => {
		const report = buildContentQualityReport({
			now,
			revision: {
				...baseRevision,
				markdown: `${baseRevision.markdown}\n官方价格为每月 100 元。`,
				factIds: ["fact-1"],
				claimMap: [
					{
						claim: "官方价格为每月 100 元",
						factIds: ["fact-1"],
						status: "verified",
					},
				],
			},
			facts: [fact("unverified")],
		});
		expect(report.passed).toBe(false);
		expect(report.gates.find((gate) => gate.key === "fact_references")?.status).toBe("fail");
	});

	it("passes a current verified sensitive claim mapping", () => {
		const report = buildContentQualityReport({
			now,
			revision: {
				...baseRevision,
				markdown: `${baseRevision.markdown}\n官方价格为每月 100 元。`,
				factIds: ["fact-1"],
				claimMap: [
					{
						claim: "官方价格为每月 100 元",
						factIds: ["fact-1"],
						status: "verified",
					},
				],
			},
			facts: [fact("verified")],
		});
		expect(report.passed).toBe(true);
	});
});
