import type { BrandAnalysisResult } from "@aloom/types";
import { describe, expect, it, vi } from "vitest";
import {
	buildDetectionExecutiveSummary,
	buildDetectionFailureBreakdown,
	buildDetectionSlices,
} from "./detectionReport.js";
import { planDetectionPrompts } from "./promptEngine.js";

vi.mock("@aloom/db", () => ({ clickhouse: {}, db: {}, schema: {} }));
vi.mock("../analysis/runAnalysis.js", () => ({ parseAnalysisOutput: vi.fn() }));

function analysis(args: {
	mentioned: boolean;
	recommended?: boolean;
	targetShare?: number;
}): BrandAnalysisResult {
	return {
		geoScore: { overall: args.mentioned ? 70 : 0 },
		presence: {
			mentioned: args.mentioned,
			visibility: args.mentioned ? 70 : 0,
		},
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
			factuality: {
				score: null,
				reviewedClaims: 0,
				accurateClaims: 0,
				errors: [],
			},
			evidence: {
				score: 0,
				visibleCitations: 0,
				supportedClaims: 0,
				unsupportedClaims: 0,
			},
			stability: {
				score: null,
				comparableSamples: 1,
				consistentSamples: 1,
				note: "Repeated samples required",
			},
			competition: {
				score: args.targetShare ?? 0,
				targetShare: args.targetShare ?? 0,
				competitorShare: 100 - (args.targetShare ?? 0),
			},
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
	it("aggregates a complete 54-cell matrix without combining answer contexts", () => {
		const plan = planDetectionPrompts(
			{
				brandName: "Aloom",
				category: "GEO detection software",
				industry: "B2B software",
				products: ["Aloom Monitor"],
				competitors: ["Competitor Atlas"],
				audiences: ["growth teams"],
				regions: ["APAC"],
				locale: "en-US",
			},
			{ suiteKey: "full_matrix", samplingDepth: "single" },
		);
		const rows = plan.prompts.map((prompt, index) =>
			sample({
				id: `sample-${index}`,
				analyticsSampleId: `answer-${index}`,
				prompt: {
					id: `prompt-${index}`,
					prompt: prompt.prompt,
					promptHash: prompt.promptHash,
					intent: prompt.promptGroup,
					decisionStage: prompt.decisionStage,
					locale: prompt.locale,
					brandExposure: prompt.brandExposure,
				},
				dimensions: prompt.dimensions,
			}),
		);
		const slices = buildDetectionSlices({
			rows: rows as never,
			tier: "standard",
			requiredProviders: ["doubao"],
		});

		expect(slices.overall[0]).toMatchObject({
			planned: 54,
			completed: 54,
			analysed: 54,
		});
		expect(slices.prompt).toHaveLength(54);
		expect(slices.intent).toHaveLength(9);
		expect(slices.decision_stage).toHaveLength(6);
		expect(slices.intent_stage).toHaveLength(54);
		expect(
			slices.prompt.every((slice) => slice.mentionRate.denominator === 1),
		).toBe(true);
	});

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
		expect(
			slices.brand_exposure.find((row) => row.key === "blind")?.planned,
		).toBe(3);
	});

	it("separates collection failures from structured analysis failures", () => {
		const rows = [
			sample({
				id: "sample-collection-failure",
				status: "failed",
				analysisStatus: "not_applicable",
				analysis: null,
				errorCode: "response_timeout",
			}),
			sample({
				id: "sample-analysis-failure",
				analysisStatus: "failed",
				analysis: null,
				analysisErrorCode: "invalid_structured_output",
				analysisErrorMessage: "Schema validation failed",
			}),
		];

		expect(buildDetectionFailureBreakdown(rows as never)).toEqual([
			{ kind: "analysis", code: "invalid_structured_output", count: 1 },
			{ kind: "collection", code: "response_timeout", count: 1 },
		]);
	});

	it("describes rates against the planned sample denominator", () => {
		const rows = [
			sample(),
			sample({
				id: "sample-failed",
				status: "failed",
				analysisStatus: "not_applicable",
				analysis: null,
			}),
		];
		const slices = buildDetectionSlices({
			rows: rows as never,
			tier: "standard",
			requiredProviders: ["doubao", "deepseek"],
		});
		const summary = buildDetectionExecutiveSummary({
			rows: rows as never,
			plannedSamples: 2,
			slices,
			competitors: [],
		});

		expect(summary[1]).toContain("Across all planned samples");
		expect(summary[1]).toContain("50%");
	});
});
