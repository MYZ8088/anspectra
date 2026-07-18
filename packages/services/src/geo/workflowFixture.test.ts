import type { BrandAnalysisResult } from "@aloom/types";
import { describe, expect, it, vi } from "vitest";
import { buildContentQualityReport } from "./content.js";
import { buildMatchedPromptCohorts } from "./experimentCohorts.js";
import { planMonitorPrompts } from "./promptEngine.js";
import { calculateBaselineScorecard } from "./scorecard.js";

vi.mock("@aloom/db", () => ({ clickhouse: {}, db: {}, schema: {} }));
vi.mock("../analysis/runAnalysis.js", () => ({ parseAnalysisOutput: vi.fn() }));

function visibleAnalysis(): BrandAnalysisResult {
	return {
		geoScore: { overall: 70 },
		presence: { mentioned: true, visibility: 70 },
		position: { rankPosition: 2 },
		sentiment: { score: 70 },
		recommendation: { type: "strong_alternative" },
		competitors: [],
		perception: {
			coreClaims: [],
			differentiators: [],
			bestKnownFor: null,
			pricingPerception: "not_mentioned",
		},
		risks: { items: [] },
		scorecard: {
			visibility: { score: 70, numerator: 1, denominator: 1 },
			factuality: {
				score: 100,
				reviewedClaims: 1,
				accurateClaims: 1,
				errors: [],
			},
			evidence: {
				score: 100,
				visibleCitations: 1,
				supportedClaims: 1,
				unsupportedClaims: 0,
			},
			stability: {
				score: null,
				comparableSamples: 1,
				consistentSamples: 1,
				note: "Requires repeated samples",
			},
			competition: { score: 60, targetShare: 60, competitorShare: 40 },
			governanceAttribution: {
				score: 25,
				confidence: "low",
				caveats: ["Single answer"],
			},
		},
	};
}

describe("GEO detection full-cycle fixture", () => {
	it("keeps the baseline, quality gate, and retest cohorts traceable", () => {
		const plan = planMonitorPrompts(
			{
				brandName: "PostHog",
				category: "product analytics",
				competitors: ["Mixpanel", "Amplitude"],
				audiences: ["B2B SaaS teams"],
				regions: ["CN"],
				locale: "zh-CN",
			},
			"standard",
		);
		expect(plan.manifest.corePromptCount).toBe(54);
		const scorecard = calculateBaselineScorecard({
			plannedSamples: plan.prompts.length,
			tier: "standard",
			requiredProviders: ["doubao"],
			samples: plan.prompts.map((prompt, index) => ({
				id: `sample-${index}`,
				provider: "doubao",
				status: "completed",
				analysisStatus: "completed",
				sourceExposure: "exposed",
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
				analysis: visibleAnalysis(),
			})),
		});
		expect(scorecard.complete).toBe(true);
		expect(scorecard.metrics.mentionRate.denominator).toBe(54);

		const now = new Date("2026-07-10T00:00:00.000Z");
		const quality = buildContentQualityReport({
			now,
			revision: {
				markdown:
					"## 结论\nPostHog 是一个开源产品分析平台，适合需要自托管选项的产品团队。",
				html: "<h2>结论</h2><p>PostHog 是一个开源产品分析平台。</p>",
				jsonLd: null,
				factIds: ["fact-1"],
				claimMap: [
					{
						claim: "PostHog 是一个开源产品分析平台",
						factIds: ["fact-1"],
						status: "verified",
					},
				],
				atomicFacts: [],
				evidenceGaps: [],
				faq: [{ question: "适合谁？", answer: "需要产品分析的团队。" }],
				directAnswer: "PostHog 适合需要开源产品分析和自托管选项的团队。",
				structuredSummary: "核心能力、适用边界和来源都在正文中明确列出。",
			},
			facts: [
				{
					id: "fact-1",
					workspaceId: "workspace-1",
					subject: "PostHog",
					predicate: "product_type",
					value: "开源产品分析平台",
					sourceUrl: "https://posthog.com/",
					sourceType: "official_website",
					evidenceGrade: "A",
					retrievedAt: now,
					region: null,
					validUntil: null,
					supportedClaims: ["PostHog 是一个开源产品分析平台"],
					confidence: 95,
					status: "verified",
					verifiedAt: now,
					createdAt: now,
					updatedAt: now,
				},
			],
		});
		expect(quality.passed).toBe(true);

		const cohorts = buildMatchedPromptCohorts(
			[
				{
					id: "treatment",
					promptGroup: "comparison",
					decisionStage: "evaluation",
					locale: "zh-CN",
					brandExposure: "aided",
					cohort: "treatment",
				},
				{
					id: "control",
					promptGroup: "comparison",
					decisionStage: "evaluation",
					locale: "zh-CN",
					brandExposure: "blind",
					cohort: "control",
				},
			],
			["treatment"],
		);
		expect(cohorts.control.map((prompt) => prompt.id)).toEqual(["control"]);
	});
});
