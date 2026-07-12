import { clickhouse, db, schema } from "@answerloom/db";
import { NotFoundError, ValidationError } from "@answerloom/errors";
import type {
	BrandAnalysisResult,
	DetectionReport,
	DetectionSliceKey,
	DetectionSliceMetrics,
	DetectionSuiteKey,
	SamplingDepth,
} from "@answerloom/types";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
	calculateBaselineScorecard,
	loadAnalysisMap,
	type ScorecardSample,
} from "./scorecard.js";

type RawSource = {
	title: string;
	citedText: string;
	url: string;
	domain: string | null;
};

type ReportSample = ScorecardSample & {
	dimensions: Record<string, unknown>;
	response: string | null;
	sources: RawSource[];
	conversationId: string | null;
	conversationUrl: string | null;
	errorCode: string | null;
	errorMessage: string | null;
};

type RawAnswerRow = {
	id: string;
	response: string;
	sources: unknown;
};

function percentage(numerator: number, denominator: number): number {
	return denominator > 0
		? Math.round((numerator / denominator) * 10_000) / 100
		: 0;
}

function sourceFromUnknown(value: unknown): RawSource | null {
	if (Array.isArray(value)) {
		const [title, citedText, url, domain] = value;
		if (typeof url !== "string") return null;
		return {
			title: typeof title === "string" ? title : url,
			citedText: typeof citedText === "string" ? citedText : "",
			url,
			domain: typeof domain === "string" ? domain : null,
		};
	}
	if (!value || typeof value !== "object") return null;
	const row = value as Record<string, unknown>;
	if (typeof row.url !== "string") return null;
	return {
		title: typeof row.title === "string" ? row.title : row.url,
		citedText:
			typeof row.cited_text === "string"
				? row.cited_text
				: typeof row.citedText === "string"
					? row.citedText
					: "",
		url: row.url,
		domain: typeof row.domain === "string" ? row.domain : null,
	};
}

function sourcesFromUnknown(value: unknown): RawSource[] {
	return Array.isArray(value)
		? value.flatMap((source) => {
				const normalized = sourceFromUnknown(source);
				return normalized ? [normalized] : [];
			})
		: [];
}

async function loadRawAnswerMap(workspaceId: string, sampleIds: string[]) {
	if (sampleIds.length === 0) return new Map<string, RawAnswerRow>();
	const result = await clickhouse.query({
		query: `
			SELECT id,
				argMax(response, created_at) AS response,
				argMax(sources, created_at) AS sources
			FROM analytics.answer_samples_v2
			WHERE workspace_id = {workspaceId:String}
			  AND id IN ({sampleIds:Array(String)})
			GROUP BY id
		`,
		query_params: { workspaceId, sampleIds },
		format: "JSONEachRow",
	});
	const rows = (await result.json()) as RawAnswerRow[];
	return new Map(rows.map((row) => [row.id, row]));
}

function dimensionValue(
	sample: ReportSample,
	key: "targetProduct" | "targetCompetitor" | "targetAudience" | "targetRegion",
): string | null {
	const value = sample.dimensions[key];
	return typeof value === "string" && value.trim() ? value : null;
}

function averageShare(
	rows: ReportSample[],
	field: "targetShare" | "competitorShare",
): number {
	if (rows.length === 0) return 0;
	const total = rows.reduce(
		(sum, row) => sum + (row.analysis?.scorecard.competition[field] ?? 0),
		0,
	);
	return Math.round((total / rows.length) * 100) / 100;
}

function aggregateSlice(args: {
	key: string;
	label: string;
	rows: ReportSample[];
	tier: string;
	requiredProviders: string[];
}): DetectionSliceMetrics {
	const scorecard = calculateBaselineScorecard({
		plannedSamples: args.rows.length,
		tier: args.tier,
		requiredProviders: args.requiredProviders,
		samples: args.rows,
	});
	return {
		key: args.key,
		label: args.label,
		planned: args.rows.length,
		completed: scorecard.completedSamples,
		analysed: scorecard.analysedSamples,
		failed: args.rows.filter((row) => row.status !== "completed").length,
		completionRate: scorecard.completionRate,
		analysisRate: scorecard.analysisRate,
		confidence: scorecard.confidence,
		mentionRate: scorecard.metrics.mentionRate,
		candidateRate: scorecard.metrics.candidateRate,
		recommendationRate: scorecard.metrics.recommendationRate,
		averageRank: scorecard.metrics.averageAbsoluteRank,
		averageSentiment: scorecard.metrics.averageSentiment,
		sourceExposureRate: scorecard.metrics.sourceExposureRate,
		stability: scorecard.layers.stability.score,
		targetShare: averageShare(args.rows, "targetShare"),
		competitorShare: averageShare(args.rows, "competitorShare"),
	};
}

function groupRows(
	rows: ReportSample[],
	select: (row: ReportSample) => string | null,
): Map<string, ReportSample[]> {
	const groups = new Map<string, ReportSample[]>();
	for (const row of rows) {
		const key = select(row);
		if (!key) continue;
		groups.set(key, [...(groups.get(key) ?? []), row]);
	}
	return groups;
}

export function buildDetectionSlices(args: {
	rows: ReportSample[];
	tier: string;
	requiredProviders: string[];
}): Record<DetectionSliceKey, DetectionSliceMetrics[]> {
	const selectors: Record<
		Exclude<DetectionSliceKey, "overall">,
		(row: ReportSample) => string | null
	> = {
		provider: (row) => row.provider,
		locale: (row) => row.prompt?.locale ?? null,
		intent: (row) => row.prompt?.intent ?? null,
		decision_stage: (row) => row.prompt?.decisionStage ?? null,
		brand_exposure: (row) => row.prompt?.brandExposure ?? null,
		product: (row) => dimensionValue(row, "targetProduct"),
		competitor: (row) => dimensionValue(row, "targetCompetitor"),
		audience: (row) => dimensionValue(row, "targetAudience"),
		region: (row) => dimensionValue(row, "targetRegion"),
		prompt: (row) => row.prompt?.promptHash ?? row.prompt?.id ?? null,
		intent_stage: (row) =>
			row.prompt?.intent && row.prompt.decisionStage
				? `${row.prompt.intent}:${row.prompt.decisionStage}`
				: null,
	};
	const result: Record<DetectionSliceKey, DetectionSliceMetrics[]> = {
		overall: [],
		provider: [],
		locale: [],
		intent: [],
		decision_stage: [],
		brand_exposure: [],
		product: [],
		competitor: [],
		audience: [],
		region: [],
		prompt: [],
		intent_stage: [],
	};
	result.overall = [
		aggregateSlice({
			key: "overall",
			label: "Overall",
			rows: args.rows,
			tier: args.tier,
			requiredProviders: args.requiredProviders,
		}),
	];
	for (const [sliceKey, selector] of Object.entries(selectors) as Array<
		[Exclude<DetectionSliceKey, "overall">, (row: ReportSample) => string | null]
	>) {
		result[sliceKey] = [...groupRows(args.rows, selector).entries()]
			.map(([key, rows]) =>
				aggregateSlice({
					key,
					label:
						sliceKey === "prompt"
							? rows[0]?.prompt?.prompt ?? key
							: key.replaceAll("_", " "),
					rows,
					tier: args.tier,
					requiredProviders: [
						...new Set(rows.map((row) => row.provider)),
					],
				}),
			)
			.sort((left, right) => left.label.localeCompare(right.label));
	}
	return result;
}

export async function getDetectionReport(args: {
	workspaceId: string;
	seriesId: string;
}): Promise<DetectionReport> {
	const series = await db.query.collectionSeries.findFirst({
		where: and(
			eq(schema.collectionSeries.id, args.seriesId),
			eq(schema.collectionSeries.workspaceId, args.workspaceId),
		),
	});
	if (!series) throw new NotFoundError("Detection series not found");
	if (series.purpose !== "baseline" || !series.promptSetId) {
		throw new ValidationError("Only formal detection series have reports");
	}
	const promptSet = await db.query.promptSets.findFirst({
		where: and(
			eq(schema.promptSets.id, series.promptSetId),
			eq(schema.promptSets.workspaceId, args.workspaceId),
		),
	});
	if (!promptSet || promptSet.purpose !== "baseline") {
		throw new ValidationError("Diagnostic and legacy runs are excluded from reports");
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
	const [analyses, rawAnswers] = await Promise.all([
		loadAnalysisMap(args.workspaceId, analyticsIds).catch(
			() => new Map<string, BrandAnalysisResult>(),
		),
		loadRawAnswerMap(args.workspaceId, analyticsIds).catch(
			() => new Map<string, RawAnswerRow>(),
		),
	]);
	const rows: ReportSample[] = checkpoints.map((checkpoint) => {
		const prompt = checkpoint.promptId
			? (promptById.get(checkpoint.promptId) ?? null)
			: null;
		const raw = checkpoint.analyticsSampleId
			? rawAnswers.get(checkpoint.analyticsSampleId)
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
				? (analyses.get(checkpoint.analyticsSampleId) ?? null)
				: null,
			dimensions: prompt?.dimensions ?? {},
			response: raw?.response ?? null,
			sources: sourcesFromUnknown(raw?.sources),
			conversationId: checkpoint.conversationId,
			conversationUrl: checkpoint.conversationUrl,
			errorCode: checkpoint.errorCode,
			errorMessage: checkpoint.errorMessage,
		};
	});
	const promptManifest = (promptSet.manifest ?? {}) as {
		suiteKey?: DetectionSuiteKey;
		samplingDepth?: SamplingDepth;
	};
	const suiteKey = promptManifest.suiteKey ?? "full_matrix";
	const samplingDepth =
		promptManifest.samplingDepth ??
		(series.tier === "quick"
			? "single"
			: series.tier === "standard"
				? "reliable"
				: "stability");
	const competitorMap = new Map<
		string,
		{ name: string; mentions: number; recommendations: number }
	>();
	for (const row of rows) {
		for (const competitor of row.analysis?.competitors ?? []) {
			const key = competitor.name.trim().toLocaleLowerCase();
			if (!key) continue;
			const current = competitorMap.get(key) ?? {
				name: competitor.name,
				mentions: 0,
				recommendations: 0,
			};
			current.mentions += 1;
			current.recommendations += Number(competitor.isRecommended);
			competitorMap.set(key, current);
		}
	}
	return {
		seriesId: series.id,
		promptSetId: promptSet.id,
		seriesStatus: series.status,
		provisional:
			rows.length === 0 ||
			percentage(
				rows.filter((row) => row.status === "completed").length,
				Math.max(series.plannedSamples, rows.length),
			) < 90,
		suiteKey,
		samplingDepth,
		createdAt: series.createdAt,
		slices: buildDetectionSlices({
			rows,
			tier: series.tier,
			requiredProviders: series.requiredProviders ?? [],
		}),
		competitors: [...competitorMap.values()].sort(
			(left, right) => right.mentions - left.mentions,
		),
		samples: rows.map((row) => ({
			checkpointId: row.id,
			provider: row.provider,
			status: row.status,
			analysisStatus: row.analysisStatus,
			prompt: row.prompt?.prompt ?? "",
			promptHash: row.prompt?.promptHash ?? null,
			intent: row.prompt?.intent ?? "unknown",
			decisionStage: row.prompt?.decisionStage ?? null,
			locale: row.prompt?.locale ?? "unknown",
			brandExposure: row.prompt?.brandExposure ?? null,
			response: row.response,
			sources: row.sources,
			sourceExposure: row.sourceExposure,
			conversationId: row.conversationId,
			conversationUrl: row.conversationUrl,
			errorCode: row.errorCode,
			errorMessage: row.errorMessage,
			dimensions: row.dimensions,
		})),
	};
}

function stableString(value: unknown): string {
	if (Array.isArray(value)) return JSON.stringify([...value].sort());
	if (value && typeof value === "object") {
		return JSON.stringify(
			Object.fromEntries(
				Object.entries(value as Record<string, unknown>)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([key, item]) => [key, Array.isArray(item) ? [...item].sort() : item]),
			),
		);
	}
	return JSON.stringify(value);
}

export async function getDetectionTrend(args: {
	workspaceId: string;
	seriesId?: string;
	limit?: number;
}) {
	const candidates = await db.query.collectionSeries.findMany({
		where: and(
			eq(schema.collectionSeries.workspaceId, args.workspaceId),
			eq(schema.collectionSeries.purpose, "baseline"),
		),
		orderBy: [desc(schema.collectionSeries.createdAt)],
		limit: 50,
	});
	const selected = args.seriesId
		? candidates.find((series) => series.id === args.seriesId)
		: candidates[0];
	if (!selected?.promptSetId) return { comparableSeries: [], points: [] };
	const providerSignature = stableString(selected.requiredProviders ?? []);
	const modeSignature = stableString(selected.providerModes ?? {});
	const comparable = candidates
		.filter(
			(series) =>
				series.promptSetId === selected.promptSetId &&
				stableString(series.requiredProviders ?? []) === providerSignature &&
				stableString(series.providerModes ?? {}) === modeSignature,
		)
		.slice(0, args.limit ?? 12)
		.reverse();
	const reports = [];
	for (const series of comparable) {
		reports.push(
			await getDetectionReport({
				workspaceId: args.workspaceId,
				seriesId: series.id,
			}),
		);
	}
	return {
		comparableSeries: comparable.map((series) => series.id),
		points: reports.map((report) => {
			const overall = report.slices.overall[0];
			return {
				seriesId: report.seriesId,
				createdAt: report.createdAt,
				status: report.seriesStatus,
				provisional: report.provisional,
				completionRate: overall?.completionRate ?? 0,
				mentionRate: overall?.mentionRate.value ?? 0,
				recommendationRate: overall?.recommendationRate.value ?? 0,
				averageRank: overall?.averageRank ?? null,
				sourceExposureRate: overall?.sourceExposureRate.value ?? 0,
				stability: overall?.stability ?? null,
			};
		}),
	};
}

export async function getLatestDetectionReport(workspaceId: string) {
	const candidates = await db.query.collectionSeries.findMany({
		where: and(
			eq(schema.collectionSeries.workspaceId, workspaceId),
			eq(schema.collectionSeries.purpose, "baseline"),
		),
		orderBy: [desc(schema.collectionSeries.createdAt)],
		limit: 20,
	});
	for (const series of candidates) {
		if (!series.promptSetId) continue;
		const promptSet = await db.query.promptSets.findFirst({
			where: and(
				eq(schema.promptSets.id, series.promptSetId),
				eq(schema.promptSets.workspaceId, workspaceId),
				eq(schema.promptSets.purpose, "baseline"),
			),
		});
		if (promptSet) {
			return getDetectionReport({ workspaceId, seriesId: series.id });
		}
	}
	return null;
}
