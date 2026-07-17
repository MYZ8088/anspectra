import { clickhouse, db, schema } from "@aloom/db";
import { NotFoundError, ValidationError } from "@aloom/errors";
import type {
	BrandAnalysisResult,
	DetectedAnswerLanguage,
	DetectionMetricRate,
	DetectionReport,
	DetectionRunPlan,
	DetectionSliceKey,
	DetectionSliceMetrics,
	DetectionSuiteKey,
	SamplingDepth,
	SearchSourceCoverage,
	SourceKind,
} from "@aloom/types";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ensureSourceKindSchema } from "../prompt/lib/ensureSourceKindSchema.js";
import {
	type ScorecardSample,
	calculateBaselineScorecard,
	loadAnalysisMap,
} from "./scorecard.js";

type RawSource = {
	title: string;
	citedText: string;
	url: string;
	domain: string | null;
	sourceKind: SourceKind;
};

type ReportSample = ScorecardSample & {
	dimensions: Record<string, unknown>;
	response: string | null;
	responseLanguage: DetectedAnswerLanguage;
	languageMatch: boolean | null;
	sources: RawSource[];
	conversationId: string | null;
	conversationUrl: string | null;
	requestedMode: string;
	actualMode: string | null;
	reportedSearchSourceCount: number | null;
	searchSourceCoverage: SearchSourceCoverage;
	errorCode: string | null;
	errorMessage: string | null;
	analysisErrorCode: string | null;
	analysisErrorMessage: string | null;
};

type RawAnswerRow = {
	id: string;
	response: string;
	sources: unknown;
	reported_search_source_count: number | null;
	search_source_coverage: string;
};

type RawCitationRow = {
	sample_id: string;
	title: string;
	cited_text: string;
	url: string;
	domain: string | null;
	source_kind: string;
};

const TERMINAL_COLLECTION_FAILURE_STATUSES = new Set([
	"failed",
	"not_attempted",
	"cancelled",
]);

function percentage(numerator: number, denominator: number): number {
	return denominator > 0
		? Math.round((numerator / denominator) * 10_000) / 100
		: 0;
}

export function detectAnswerLanguage(
	value: string | null,
): DetectedAnswerLanguage {
	const text = value?.trim() ?? "";
	if (!text) return "unknown";
	const hanCount = text.match(/\p{Script=Han}/gu)?.length ?? 0;
	const latinCount = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
	const letterCount = hanCount + latinCount;
	if (letterCount < 12) return "unknown";
	const hanShare = hanCount / letterCount;
	if (hanCount >= 12 && hanShare >= 0.15) return "zh-CN";
	if (latinCount >= 20 && hanShare <= 0.05) return "en-US";
	return "mixed";
}

export function answerMatchesPromptLocale(args: {
	responseLanguage: DetectedAnswerLanguage;
	promptLocale: string | null | undefined;
}): boolean | null {
	if (args.responseLanguage === "unknown" || !args.promptLocale) return null;
	if (args.promptLocale.toLowerCase().startsWith("zh")) {
		return args.responseLanguage === "zh-CN";
	}
	if (args.promptLocale.toLowerCase().startsWith("en")) {
		return args.responseLanguage === "en-US";
	}
	return null;
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
			sourceKind:
				typeof value[5] === "string"
					? normalizeSourceKind(value[5])
					: "legacy_unknown",
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
		sourceKind: normalizeSourceKind(row.source_kind ?? row.sourceKind),
	};
}

function normalizeSourceKind(value: unknown): SourceKind {
	return value === "answer_link" || value === "search_source"
		? value
		: "legacy_unknown";
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
	await ensureSourceKindSchema();
	const result = await clickhouse.query({
		query: `
			SELECT id,
				argMax(response, created_at) AS response,
				argMax(sources, created_at) AS sources,
				argMax(reported_search_source_count, created_at) AS reported_search_source_count,
				argMax(search_source_coverage, created_at) AS search_source_coverage
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

async function loadCitationMap(workspaceId: string, sampleIds: string[]) {
	const grouped = new Map<string, RawSource[]>();
	if (sampleIds.length === 0) return grouped;
	await ensureSourceKindSchema();
	const result = await clickhouse.query({
		query: `
			SELECT sample_id, title, cited_text, url, domain, source_kind
			FROM analytics.sample_citations FINAL
			WHERE workspace_id = {workspaceId:String}
			  AND sample_id IN ({sampleIds:Array(String)})
			ORDER BY sample_id, source_index
		`,
		query_params: { workspaceId, sampleIds },
		format: "JSONEachRow",
	});
	const rows = (await result.json()) as RawCitationRow[];
	for (const row of rows) {
		const source: RawSource = {
			title: row.title || row.url,
			citedText: row.cited_text,
			url: row.url,
			domain: row.domain,
			sourceKind: normalizeSourceKind(row.source_kind),
		};
		grouped.set(row.sample_id, [...(grouped.get(row.sample_id) ?? []), source]);
	}
	return grouped;
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
	const languageRows = args.rows.filter(
		(row) => row.status === "completed" && row.languageMatch !== null,
	);
	const languageMatches = languageRows.filter(
		(row) => row.languageMatch === true,
	).length;
	const completedRows = args.rows.filter((row) => row.status === "completed");
	const sourceKindRate = (sourceKind: SourceKind): DetectionMetricRate => {
		const exposed = completedRows.filter((row) =>
			row.sources.some((source) => source.sourceKind === sourceKind),
		).length;
		return {
			numerator: exposed,
			denominator: completedRows.length,
			value: percentage(exposed, completedRows.length),
		};
	};
	const reportedSearchRows = completedRows.filter(
		(row) => (row.reportedSearchSourceCount ?? 0) > 0,
	);
	const reportedSearchSourceCount = reportedSearchRows.reduce(
		(total, row) => total + (row.reportedSearchSourceCount ?? 0),
		0,
	);
	const extractedReportedSearchSourceCount = reportedSearchRows.reduce(
		(total, row) => {
			const extracted = new Set(
				row.sources
					.filter((source) => source.sourceKind === "search_source")
					.map((source) => source.url),
			).size;
			return total + Math.min(extracted, row.reportedSearchSourceCount ?? 0);
		},
		0,
	);
	return {
		key: args.key,
		label: args.label,
		planned: args.rows.length,
		completed: scorecard.completedSamples,
		analysed: scorecard.analysedSamples,
		failed: args.rows.filter((row) =>
			TERMINAL_COLLECTION_FAILURE_STATUSES.has(row.status),
		).length,
		completionRate: scorecard.completionRate,
		analysisRate: scorecard.analysisRate,
		confidence: scorecard.confidence,
		mentionRate: scorecard.metrics.mentionRate,
		candidateRate: scorecard.metrics.candidateRate,
		recommendationRate: scorecard.metrics.recommendationRate,
		averageRank: scorecard.metrics.averageAbsoluteRank,
		averageSentiment: scorecard.metrics.averageSentiment,
		sourceExposureRate: scorecard.metrics.sourceExposureRate,
		answerLinkExposureRate: sourceKindRate("answer_link"),
		searchSourceExposureRate: sourceKindRate("search_source"),
		searchSourceUrlCoverageRate: {
			numerator: extractedReportedSearchSourceCount,
			denominator: reportedSearchSourceCount,
			value: percentage(
				extractedReportedSearchSourceCount,
				reportedSearchSourceCount,
			),
		},
		answerLanguageMatchRate: {
			numerator: languageMatches,
			denominator: languageRows.length,
			value: percentage(languageMatches, languageRows.length),
		},
		stability: scorecard.layers.stability.score,
		targetShare: averageShare(args.rows, "targetShare"),
		competitorShare: averageShare(args.rows, "competitorShare"),
		answerPerformanceScore: scorecard.metrics.averageAnswerGeoScore,
		weightedScore: scorecard.weightedScore,
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
		provider_mode: (row) =>
			`${row.provider}:${row.actualMode ?? row.requestedMode}`,
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
		provider_mode: [],
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
		[
			Exclude<DetectionSliceKey, "overall">,
			(row: ReportSample) => string | null,
		]
	>) {
		result[sliceKey] = [...groupRows(args.rows, selector).entries()]
			.map(([key, rows]) =>
				aggregateSlice({
					key,
					label:
						sliceKey === "prompt"
							? (rows[0]?.prompt?.prompt ?? key)
							: key.replaceAll("_", " "),
					rows,
					tier: args.tier,
					requiredProviders: [...new Set(rows.map((row) => row.provider))],
				}),
			)
			.sort((left, right) => left.label.localeCompare(right.label));
	}
	return result;
}

export function buildDetectionFailureBreakdown(
	rows: ReportSample[],
): DetectionReport["failures"] {
	const grouped = new Map<string, DetectionReport["failures"][number]>();
	for (const row of rows) {
		if (TERMINAL_COLLECTION_FAILURE_STATUSES.has(row.status)) {
			const code = row.errorCode ?? row.status;
			const key = `collection:${code}`;
			const current = grouped.get(key) ?? {
				kind: "collection" as const,
				code,
				count: 0,
			};
			current.count += 1;
			grouped.set(key, current);
		}
		if (row.analysisStatus === "failed") {
			const code = row.analysisErrorCode ?? "analysis_failed";
			const key = `analysis:${code}`;
			const current = grouped.get(key) ?? {
				kind: "analysis" as const,
				code,
				count: 0,
			};
			current.count += 1;
			grouped.set(key, current);
		}
	}
	return [...grouped.values()].sort(
		(left, right) =>
			right.count - left.count || left.code.localeCompare(right.code),
	);
}

export function buildDetectionExecutiveSummary(args: {
	rows: ReportSample[];
	plannedSamples: number;
	slices: Record<DetectionSliceKey, DetectionSliceMetrics[]>;
	competitors: Array<{
		name: string;
		mentions: number;
		recommendations: number;
	}>;
}): string[] {
	const overall = args.slices.overall[0];
	if (!overall) return ["No planned samples are available for this series."];
	const bestProvider = [...args.slices.provider].sort(
		(left, right) => right.mentionRate.value - left.mentionRate.value,
	)[0];
	const topCompetitor = args.competitors[0];
	return [
		`${overall.completed} of ${args.plannedSamples} planned samples were collected (${overall.completionRate}%).`,
		`The Aloom GEO Score is ${overall.weightedScore.overall}/100 with ${overall.weightedScore.coverage}% of scoring dimensions currently assessable${overall.weightedScore.provisional ? "; treat it as provisional" : ""}.`,
		`Across all planned samples, the target appeared in ${overall.mentionRate.value}% and was recommended in ${overall.recommendationRate.value}%.`,
		`${overall.answerLanguageMatchRate.numerator} of ${overall.answerLanguageMatchRate.denominator} collected answers matched the requested prompt language (${overall.answerLanguageMatchRate.value}%).`,
		`Provider search sources were exposed in ${overall.searchSourceExposureRate.value}% of collected answers; answer-body links appeared in ${overall.answerLinkExposureRate.value}%.`,
		overall.searchSourceUrlCoverageRate.denominator > 0
			? `${overall.searchSourceUrlCoverageRate.numerator} of ${overall.searchSourceUrlCoverageRate.denominator} provider-reported search sources had extractable URLs (${overall.searchSourceUrlCoverageRate.value}%).`
			: "Providers did not expose a numeric searched-source total for URL coverage comparison.",
		bestProvider
			? `${bestProvider.label} had the highest measured mention rate at ${bestProvider.mentionRate.value}%.`
			: "No provider has enough analysed answers for a provider comparison.",
		topCompetitor
			? `${topCompetitor.name} was the most frequently observed competitor (${topCompetitor.mentions} answer mentions).`
			: "No competitor mentions were extracted from the analysed answers.",
	];
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
		throw new ValidationError(
			"Diagnostic and legacy runs are excluded from reports",
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
	const [analyses, rawAnswers, citations] = await Promise.all([
		loadAnalysisMap(args.workspaceId, analyticsIds).catch(
			() => new Map<string, BrandAnalysisResult>(),
		),
		loadRawAnswerMap(args.workspaceId, analyticsIds).catch(
			() => new Map<string, RawAnswerRow>(),
		),
		loadCitationMap(args.workspaceId, analyticsIds).catch(
			() => new Map<string, RawSource[]>(),
		),
	]);
	const rows: ReportSample[] = checkpoints.map((checkpoint) => {
		const prompt = checkpoint.promptId
			? (promptById.get(checkpoint.promptId) ?? null)
			: null;
		const raw = checkpoint.analyticsSampleId
			? rawAnswers.get(checkpoint.analyticsSampleId)
			: null;
		const response = raw?.response ?? null;
		const responseLanguage = detectAnswerLanguage(response);
		return {
			id: checkpoint.id,
			provider: checkpoint.provider,
			status: checkpoint.status,
			analysisStatus: checkpoint.analysisStatus,
			analysisErrorCode: checkpoint.analysisErrorCode,
			analysisErrorMessage: checkpoint.analysisErrorMessage,
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
			response,
			responseLanguage,
			languageMatch: answerMatchesPromptLocale({
				responseLanguage,
				promptLocale: prompt?.locale,
			}),
			sources: checkpoint.analyticsSampleId
				? (citations.get(checkpoint.analyticsSampleId) ??
					sourcesFromUnknown(raw?.sources))
				: [],
			conversationId: checkpoint.conversationId,
			conversationUrl: checkpoint.conversationUrl,
			requestedMode: checkpoint.requestedMode,
			actualMode: checkpoint.actualMode,
			reportedSearchSourceCount:
				typeof raw?.reported_search_source_count === "number"
					? raw.reported_search_source_count
					: null,
			searchSourceCoverage:
				raw?.search_source_coverage === "complete" ||
				raw?.search_source_coverage === "partial" ||
				raw?.search_source_coverage === "count_not_exposed"
					? raw.search_source_coverage
					: "not_exposed",
			errorCode: checkpoint.errorCode,
			errorMessage: checkpoint.errorMessage,
		};
	});
	const promptManifest = (promptSet.manifest ?? {}) as {
		suiteKey?: DetectionSuiteKey;
		samplingDepth?: SamplingDepth;
		runPlan?: DetectionRunPlan | null;
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
	const slices = buildDetectionSlices({
		rows,
		tier: series.tier,
		requiredProviders: series.requiredProviders ?? [],
	});
	const competitors = [...competitorMap.values()].sort(
		(left, right) => right.mentions - left.mentions,
	);
	return {
		seriesId: series.id,
		promptSetId: promptSet.id,
		seriesStatus: series.status,
		provisional: slices.overall[0]?.weightedScore.provisional ?? true,
		suiteKey,
		samplingDepth,
		runPlan: promptManifest.runPlan ?? null,
		createdAt: series.createdAt,
		methodology: {
			analysisUnit: "single_answer",
			answersPerAnalysisCall: 1,
			aggregation: "deterministic_structured_rollup",
			roundCount: series.roundCount,
			plannedSamples: series.plannedSamples,
			checkpointSamples: rows.length,
			uniquePromptHashes: new Set(
				rows.flatMap((row) => row.prompt?.promptHash ?? []),
			).size,
			totalResponseCharacters: rows.reduce(
				(total, row) => total + (row.response?.length ?? 0),
				0,
			),
			largestResponseCharacters: Math.max(
				0,
				...rows.map((row) => row.response?.length ?? 0),
			),
		},
		executiveSummary: buildDetectionExecutiveSummary({
			rows,
			plannedSamples: series.plannedSamples,
			slices,
			competitors,
		}),
		failures: buildDetectionFailureBreakdown(rows),
		slices,
		competitors,
		samples: rows.map((row) => ({
			checkpointId: row.id,
			provider: row.provider,
			status: row.status,
			analysisStatus: row.analysisStatus,
			analysisErrorCode: row.analysisErrorCode,
			analysisErrorMessage: row.analysisErrorMessage,
			prompt: row.prompt?.prompt ?? "",
			promptHash: row.prompt?.promptHash ?? null,
			intent: row.prompt?.intent ?? "unknown",
			decisionStage: row.prompt?.decisionStage ?? null,
			locale: row.prompt?.locale ?? "unknown",
			brandExposure: row.prompt?.brandExposure ?? null,
			requestedMode:
				row.requestedMode as DetectionReport["samples"][number]["requestedMode"],
			actualMode:
				row.actualMode as DetectionReport["samples"][number]["actualMode"],
			response: row.response,
			responseLength: row.response?.length ?? 0,
			responseLanguage: row.responseLanguage,
			languageMatch: row.languageMatch,
			sources: row.sources,
			sourceExposure: row.sourceExposure,
			reportedSearchSourceCount: row.reportedSearchSourceCount,
			searchSourceCoverage: row.searchSourceCoverage,
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
					.map(([key, item]) => [
						key,
						Array.isArray(item) ? [...item].sort() : item,
					]),
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
