import { clickhouse, db, schema } from "@answerloom/db";
import { NotFoundError, ValidationError } from "@answerloom/errors";
import type { BrandAnalysisResult } from "@answerloom/types";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { parseAnalysisOutput } from "../analysis/runAnalysis.js";

type ScorecardSample = {
	id: string;
	provider: string;
	status: string;
	analysisStatus: string;
	sourceExposure: string | null;
	analyticsSampleId: string | null;
	prompt: {
		id: string;
		prompt: string;
		promptHash: string | null;
		intent: string;
		decisionStage: string | null;
		locale: string;
		brandExposure: string | null;
	} | null;
	analysis: BrandAnalysisResult | null;
};

type AggregateInput = {
	plannedSamples: number;
	tier: string;
	requiredProviders: string[];
	samples: ScorecardSample[];
};

function percentage(numerator: number, denominator: number): number {
	return denominator > 0
		? Math.round((numerator / denominator) * 10_000) / 100
		: 0;
}

function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return (
		Math.round(
			(values.reduce((total, value) => total + value, 0) / values.length) * 100,
		) / 100
	);
}

function recommendationBucket(analysis: BrandAnalysisResult) {
	return ["top_pick", "strong_alternative", "conditional"].includes(
		analysis.recommendation.type,
	);
}

function candidateBucket(analysis: BrandAnalysisResult) {
	return (
		recommendationBucket(analysis) ||
		analysis.position.rankPosition !== null ||
		analysis.recommendation.type === "mentioned_only"
	);
}

function stablePair(left: BrandAnalysisResult, right: BrandAnalysisResult) {
	if (left.presence.mentioned !== right.presence.mentioned) return false;
	if (left.recommendation.type !== right.recommendation.type) return false;
	if (
		left.position.rankPosition === null ||
		right.position.rankPosition === null
	) {
		return left.position.rankPosition === right.position.rankPosition;
	}
	return (
		Math.abs(left.position.rankPosition - right.position.rankPosition) <= 1
	);
}

export function calculateBaselineScorecard(input: AggregateInput) {
	const denominator = Math.max(input.plannedSamples, input.samples.length);
	const completed = input.samples.filter(
		(sample) => sample.status === "completed",
	);
	const analysed = input.samples.filter((sample) => sample.analysis);
	const mentioned = analysed.filter(
		(sample) => sample.analysis?.presence.mentioned,
	);
	const candidates = analysed.filter(
		(sample) => sample.analysis && candidateBucket(sample.analysis),
	);
	const recommended = analysed.filter(
		(sample) => sample.analysis && recommendationBucket(sample.analysis),
	);
	const exposed = completed.filter(
		(sample) => sample.sourceExposure === "exposed",
	);

	let reviewedClaims = 0;
	let accurateClaims = 0;
	let supportedClaims = 0;
	let unsupportedClaims = 0;
	for (const sample of analysed) {
		const scorecard = sample.analysis?.scorecard;
		if (!scorecard) continue;
		reviewedClaims += scorecard.factuality.reviewedClaims;
		accurateClaims += scorecard.factuality.accurateClaims;
		supportedClaims += scorecard.evidence.supportedClaims;
		unsupportedClaims += scorecard.evidence.unsupportedClaims;
	}

	const stabilityGroups = new Map<string, BrandAnalysisResult[]>();
	for (const sample of analysed) {
		if (!sample.analysis || !sample.prompt?.promptHash) continue;
		const key = `${sample.provider}:${sample.prompt.promptHash}`;
		stabilityGroups.set(key, [
			...(stabilityGroups.get(key) ?? []),
			sample.analysis,
		]);
	}
	let comparablePairs = 0;
	let consistentPairs = 0;
	for (const group of stabilityGroups.values()) {
		for (let index = 1; index < group.length; index += 1) {
			const left = group[index - 1];
			const right = group[index];
			if (!left || !right) continue;
			comparablePairs += 1;
			if (stablePair(left, right)) consistentPairs += 1;
		}
	}

	const expectedIntents = [
		...new Set(
			input.samples.flatMap((sample) =>
				sample.prompt?.intent ? [sample.prompt.intent] : [],
			),
		),
	];
	const expectedLocales = [
		...new Set(
			input.samples.flatMap((sample) =>
				sample.prompt?.locale ? [sample.prompt.locale] : [],
			),
		),
	];
	const missingProviders = input.requiredProviders.filter(
		(provider) => !completed.some((sample) => sample.provider === provider),
	);
	const missingIntents = expectedIntents.filter(
		(intent) => !completed.some((sample) => sample.prompt?.intent === intent),
	);
	const missingLocales = expectedLocales.filter(
		(locale) => !completed.some((sample) => sample.prompt?.locale === locale),
	);
	const completionRate = percentage(completed.length, denominator);
	const analysisRate = percentage(analysed.length, denominator);
	const complete =
		completionRate >= 90 &&
		missingProviders.length === 0 &&
		missingIntents.length === 0 &&
		missingLocales.length === 0;
	const dimensionCoverage = percentage(
		input.requiredProviders.length -
			missingProviders.length +
			expectedIntents.length -
			missingIntents.length +
			expectedLocales.length -
			missingLocales.length,
		input.requiredProviders.length +
			expectedIntents.length +
			expectedLocales.length,
	);
	const governanceScore = Math.round(
		(completionRate + analysisRate + dimensionCoverage) / 3,
	);
	const confidence: "low" | "medium" | "high" =
		complete && input.tier === "deep"
			? "high"
			: complete && input.tier === "standard"
				? "medium"
				: "low";
	const targetShares = analysed.map(
		(sample) => sample.analysis?.scorecard.competition.targetShare ?? 0,
	);

	return {
		complete,
		provisional: !complete,
		confidence,
		denominator,
		completedSamples: completed.length,
		analysedSamples: analysed.length,
		completionRate,
		analysisRate,
		missing: {
			providers: missingProviders,
			intents: missingIntents,
			locales: missingLocales,
		},
		metrics: {
			mentionRate: {
				numerator: mentioned.length,
				denominator,
				value: percentage(mentioned.length, denominator),
			},
			candidateRate: {
				numerator: candidates.length,
				denominator,
				value: percentage(candidates.length, denominator),
			},
			recommendationRate: {
				numerator: recommended.length,
				denominator,
				value: percentage(recommended.length, denominator),
			},
			averageAbsoluteRank: average(
				mentioned.flatMap((sample) =>
					sample.analysis?.position.rankPosition
						? [sample.analysis.position.rankPosition]
						: [],
				),
			),
			averageSentiment: average(
				mentioned.map((sample) => sample.analysis?.sentiment.score ?? 0),
			),
			sourceExposureRate: {
				numerator: exposed.length,
				denominator,
				value: percentage(exposed.length, denominator),
			},
		},
		layers: {
			visibility: {
				score: percentage(mentioned.length, denominator),
				numerator: mentioned.length,
				denominator,
			},
			factuality: {
				score:
					reviewedClaims > 0
						? percentage(accurateClaims, reviewedClaims)
						: null,
				numerator: accurateClaims,
				denominator: reviewedClaims,
			},
			evidence: {
				score:
					supportedClaims + unsupportedClaims > 0
						? Math.round(
								(percentage(exposed.length, denominator) +
									percentage(
										supportedClaims,
										supportedClaims + unsupportedClaims,
									)) /
									2,
							)
						: percentage(exposed.length, denominator),
				numerator: supportedClaims,
				denominator: supportedClaims + unsupportedClaims,
				visibleSamples: exposed.length,
			},
			stability: {
				score:
					comparablePairs > 0
						? percentage(consistentPairs, comparablePairs)
						: null,
				numerator: consistentPairs,
				denominator: comparablePairs,
			},
			competition: {
				score:
					denominator > 0
						? Math.round(
								targetShares.reduce((total, value) => total + value, 0) /
									denominator,
							)
						: 0,
				numerator: mentioned.length,
				denominator,
			},
			governanceAttribution: {
				score: governanceScore,
				numerator: analysed.length,
				denominator,
			},
		},
		providerBreakdown: input.requiredProviders.map((provider) => {
			const rows = input.samples.filter(
				(sample) => sample.provider === provider,
			);
			const completedRows = rows.filter(
				(sample) => sample.status === "completed",
			);
			const mentionedRows = rows.filter(
				(sample) => sample.analysis?.presence.mentioned,
			);
			return {
				provider,
				total: rows.length,
				completed: completedRows.length,
				failed: rows.filter((sample) => sample.status === "failed").length,
				mentionRate: percentage(mentionedRows.length, rows.length),
			};
		}),
	};
}

async function loadAnalysisMap(workspaceId: string, sampleIds: string[]) {
	if (sampleIds.length === 0) return new Map<string, BrandAnalysisResult>();
	const result = await clickhouse.query({
		query: `
			SELECT sample_id, argMax(analysis_json, created_at) AS analysis_json
			FROM analytics.sample_analysis_v2
			WHERE workspace_id = {workspaceId:String}
			  AND sample_id IN ({sampleIds:Array(String)})
			  AND status = 'completed'
			GROUP BY sample_id
		`,
		query_params: { workspaceId, sampleIds },
		format: "JSONEachRow",
	});
	const rows: Array<{ sample_id: string; analysis_json: string }> =
		await result.json();
	const analysis = new Map<string, BrandAnalysisResult>();
	for (const row of rows) {
		try {
			analysis.set(row.sample_id, parseAnalysisOutput(row.analysis_json));
		} catch {
			// The checkpoint keeps the separate analysis failure state.
		}
	}
	return analysis;
}

export async function getBaselineScorecard(args: {
	workspaceId: string;
	seriesId: string;
}) {
	const series = await db.query.collectionSeries.findFirst({
		where: and(
			eq(schema.collectionSeries.id, args.seriesId),
			eq(schema.collectionSeries.workspaceId, args.workspaceId),
		),
	});
	if (!series) throw new NotFoundError("Baseline series not found");
	if (series.purpose !== "baseline") {
		throw new ValidationError("Scorecards require a formal baseline series");
	}
	const promptSet = series.promptSetId
		? await db.query.promptSets.findFirst({
				where: eq(schema.promptSets.id, series.promptSetId),
			})
		: null;
	if (!promptSet || promptSet.purpose !== "baseline") {
		throw new ValidationError(
			"Smoke and legacy runs cannot be used as baselines",
		);
	}
	const runs = await db.query.collectionRuns.findMany({
		where: eq(schema.collectionRuns.seriesId, series.id),
		orderBy: [asc(schema.collectionRuns.scheduledAt)],
	});
	const runIds = runs.map((run) => run.id);
	const checkpoints = runIds.length
		? await db.query.sampleCheckpoints.findMany({
				where: inArray(schema.sampleCheckpoints.runId, runIds),
			})
		: [];
	const promptIds = [
		...new Set(
			checkpoints.flatMap((checkpoint) =>
				checkpoint.promptId ? [checkpoint.promptId] : [],
			),
		),
	];
	const prompts = promptIds.length
		? await db.query.monitorPrompts.findMany({
				where: inArray(schema.monitorPrompts.id, promptIds),
			})
		: [];
	const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
	const analyticsIds = checkpoints.flatMap((checkpoint) =>
		checkpoint.analyticsSampleId ? [checkpoint.analyticsSampleId] : [],
	);
	const analysis = await loadAnalysisMap(args.workspaceId, analyticsIds);
	const samples: ScorecardSample[] = checkpoints.map((checkpoint) => {
		const prompt = checkpoint.promptId
			? (promptById.get(checkpoint.promptId) ?? null)
			: null;
		return {
			id: checkpoint.id,
			provider: checkpoint.provider,
			status: checkpoint.status,
			analysisStatus: checkpoint.analysisStatus,
			sourceExposure: checkpoint.sourceExposure,
			analyticsSampleId: checkpoint.analyticsSampleId,
			prompt: prompt
				? {
						id: prompt.id,
						prompt: prompt.prompt,
						promptHash: prompt.promptHash,
						intent: prompt.promptGroup,
						decisionStage: prompt.decisionStage,
						locale: prompt.locale,
						brandExposure: prompt.brandExposure,
					}
				: null,
			analysis: checkpoint.analyticsSampleId
				? (analysis.get(checkpoint.analyticsSampleId) ?? null)
				: null,
		};
	});
	return {
		series,
		promptSet,
		...calculateBaselineScorecard({
			plannedSamples: series.plannedSamples,
			tier: series.tier,
			requiredProviders: series.requiredProviders ?? [],
			samples,
		}),
	};
}

export async function getLatestFormalBaselineScorecard(workspaceId: string) {
	const candidates = await db.query.collectionSeries.findMany({
		where: and(
			eq(schema.collectionSeries.workspaceId, workspaceId),
			eq(schema.collectionSeries.purpose, "baseline"),
		),
		orderBy: [desc(schema.collectionSeries.createdAt)],
		limit: 20,
	});
	const promptSetIds = candidates.flatMap((series) =>
		series.promptSetId ? [series.promptSetId] : [],
	);
	const promptSets = promptSetIds.length
		? await db.query.promptSets.findMany({
				where: inArray(schema.promptSets.id, promptSetIds),
			})
		: [];
	const formalPromptSetIds = new Set(
		promptSets
			.filter((promptSet) => promptSet.purpose === "baseline")
			.map((promptSet) => promptSet.id),
	);
	const series = candidates.find(
		(candidate) =>
			candidate.promptSetId && formalPromptSetIds.has(candidate.promptSetId),
	);
	return series
		? getBaselineScorecard({ workspaceId, seriesId: series.id })
		: null;
}
