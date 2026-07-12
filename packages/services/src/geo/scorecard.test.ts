import type { BrandAnalysisResult } from "@aloom/types";
import { describe, expect, it, vi } from "vitest";
import { calculateBaselineScorecard } from "./scorecard.js";

vi.mock("@aloom/db", () => ({ clickhouse: {}, db: {}, schema: {} }));
vi.mock("../analysis/runAnalysis.js", () => ({ parseAnalysisOutput: vi.fn() }));

function analysis(mentioned: boolean, recommended = false): BrandAnalysisResult {
	return {
		geoScore: { overall: mentioned ? 60 : 0 },
		presence: { mentioned, visibility: mentioned ? 60 : 0 },
		position: { rankPosition: mentioned ? 2 : null },
		sentiment: { score: mentioned ? 70 : 0 },
		recommendation: {
			type: recommended ? "strong_alternative" : mentioned ? "mentioned_only" : "not_mentioned",
		},
		competitors: [],
		perception: { coreClaims: [], differentiators: [], bestKnownFor: null, pricingPerception: "not_mentioned" },
		risks: { items: [] },
		scorecard: {
			visibility: { score: mentioned ? 60 : 0, numerator: mentioned ? 1 : 0, denominator: 1 },
			factuality: { score: 100, reviewedClaims: 1, accurateClaims: 1, errors: [] },
			evidence: { score: 100, visibleCitations: 1, supportedClaims: 1, unsupportedClaims: 0 },
			stability: { score: null, comparableSamples: 1, consistentSamples: 1, note: "Requires repeated samples" },
			competition: { score: mentioned ? 60 : 0, targetShare: mentioned ? 60 : 0, competitorShare: mentioned ? 40 : 100 },
			governanceAttribution: { score: 25, confidence: "low", caveats: ["Single sample"] },
		},
	};
}

describe("calculateBaselineScorecard", () => {
	it("keeps failed samples in metric denominators", () => {
		const result = calculateBaselineScorecard({
			plannedSamples: 4,
			tier: "standard",
			requiredProviders: ["doubao", "deepseek"],
			samples: [
				{ id: "1", provider: "doubao", status: "completed", analysisStatus: "completed", sourceExposure: "exposed", analyticsSampleId: "a", prompt: { id: "p1", prompt: "Q", promptHash: "h", intent: "recommendation", decisionStage: "evaluation", locale: "zh-CN", brandExposure: "blind" }, analysis: analysis(true, true) },
				{ id: "2", provider: "deepseek", status: "failed", analysisStatus: "not_applicable", sourceExposure: null, analyticsSampleId: null, prompt: { id: "p1", prompt: "Q", promptHash: "h", intent: "recommendation", decisionStage: "evaluation", locale: "zh-CN", brandExposure: "blind" }, analysis: null },
			],
		});
		expect(result.metrics.mentionRate).toEqual({ numerator: 1, denominator: 4, value: 25 });
		expect(result.complete).toBe(false);
		expect(result.missing.providers).toContain("deepseek");
	});
});
