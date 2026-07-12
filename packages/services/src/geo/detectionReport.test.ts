import type { BrandAnalysisResult } from "@answerloom/types";
import { describe, expect, it, vi } from "vitest";
import { buildDetectionSlices } from "./detectionReport.js";

vi.mock("@answerloom/db", () => ({ clickhouse: {}, db: {}, schema: {} }));
vi.mock("../analysis/runAnalysis.js", () => ({ parseAnalysisOutput: vi.fn() }));

function analysis(args: {
	mentioned: boolean;
	recommended?: boolean;
	targetShare?: number;
}): BrandAnalysisResult {
	return {
		geoScore: { overall: args.mentioned ? 70 : 0 },
		presence: { mentioned: args.mentioned, visibility: args.mentioned ? 70 : 0 },
		position: { rankPosition: args.mentioned ? 2 : null },
		sentiment: { score: args.mentioned ? 75 : 0 },
		recommendation: {
			type: args.recommended
				? "strong_alternative"
				: args.mentioned
					? "mentioned_only"
					: "not_mentioned",
		},
		competitors: [],
		perception: {
			coreClaims: [],
			differentiators: [],
			bestKnownFor: null,
			pricingPerception: "not_mentioned",
		},
		risks: { items: [] },
		scorecard: {
			visibility: {
				score: args.mentioned ? 70 : 0,
				numerator: Number(args.mentioned),
				denominator: 1,
			},
			factuality: { score: null, reviewedClaims: 0, accurateClaims: 0, errors: [] },
			evidence: { score: 0, visibleCitations: 0, supportedClaims: 0, unsupportedClaims: 0 },
			stability: { score: null, comparableSamples: 1, consistentSamples: 1, note: "Repeated samples required" },
			competition: { score: args.targetShare ?? 0, targetShare: args.targetShare ?? 0, competitorShare: 100 - (args.targetShare ?? 0) },
			governanceAttribution: { score: 25, confidence: "low", caveats: [] },
		},
	};
}

function sample(overrides: Record<string, unknown> = {}) {
	return {
		id: "sample-1",
		provider: "doubao",
		status: "completed",
		analysisStatus: "completed",
		sourceExposure: "exposed",
		analyticsSampleId: "answer-1",
		prompt: {
			id: "prompt-1",
			prompt: "Which product should a team shortlist?",
			promptHash: "hash-1",
			intent: "recommendation",
			decisionStage: "evaluation",
			locale: "en-US",
			brandExposure: "blind",
		},
		analysis: analysis({ mentioned: true, recommended: true, targetShare: 60 }),
		dimensions: {
			targetProduct: "Product A",
			targetCompetitor: "Competitor B",
			targetAudience: "Product teams",
			targetRegion: "APAC",
		},
		response: "Product A is worth considering.",
		sources: [],
		conversationId: "conversation-1",
		conversationUrl: "https://example.test/conversation-1",
		errorCode: null,
		errorMessage: null,
		...overrides,
	};
}

describe("buildDetectionSlices", () => {
	it("keeps failed checkpoints in every relevant denominator", () => {
		const rows = [
			sample(),
			sample({
				id: "sample-2",
				provider: "deepseek",
				status: "failed",
				analysisStatus: "not_applicable",
				sourceExposure: null,
				analyticsSampleId: null,
				analysis: null,
				response: null,
				errorCode: "response_timeout",
			}),
			sample({
				id: "sample-3",
				provider: "qwen",
				sourceExposure: "not_exposed",
				prompt: {
					id: "prompt-2",
					prompt: "What is Product A?",
					promptHash: "hash-2",
					intent: "information",
					decisionStage: "awareness",
					locale: "en-US",
					brandExposure: "aided",
				},
				analysis: analysis({ mentioned: false }),
			}),
			sample({
				id: "sample-4",
				provider: "hunyuan",
				status: "waiting_human",
				analysisStatus: "pending",
				sourceExposure: null,
				analysis: null,
				response: null,
			}),
		];
		const slices = buildDetectionSlices({
			rows: rows as never,
			tier: "standard",
			requiredProviders: ["doubao", "deepseek", "qwen", "hunyuan"],
		});
		expect(slices.overall[0]?.planned).toBe(4);
		expect(slices.overall[0]?.completed).toBe(2);
		expect(slices.overall[0]?.mentionRate).toEqual({
			numerator: 1,
			denominator: 4,
			value: 25,
		});
		expect(slices.provider).toHaveLength(4);
		expect(slices.product[0]?.planned).toBe(4);
		expect(slices.intent_stage.map((row) => row.key)).toEqual(
			expect.arrayContaining([
				"information:awareness",
				"recommendation:evaluation",
			]),
		);
		expect(slices.brand_exposure.find((row) => row.key === "blind")?.planned).toBe(3);
	});
});
