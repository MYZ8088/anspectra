import { downloadCsv, downloadJson } from "@/lib/export/download";
import { buildDetailedAnalysisCsvRow } from "@aloom/utils";
import type { DashboardMetrics } from "./types";

function getThresholdObservations(metrics: DashboardMetrics): string[] {
	const observations = [
		metrics.aggregateStats.presenceRate < 70
			? "Brand presence is below 70% across analyzed prompts."
			: null,
		(metrics.avgRank.position ?? 99) > 3
			? "Average observed rank is outside the top three."
			: null,
		metrics.impactMetrics.topPickRate < 35
			? "Top-pick rate is below 35% across analyzed prompts."
			: null,
		metrics.impactMetrics.criticalRiskCount > 0
			? "One or more critical risk signals were observed in provider answers."
			: null,
	].filter((observation): observation is string => observation !== null);

	return observations.length > 0
		? observations
		: ["No configured detection threshold was triggered."];
}

function serializeSourceMetrics(
	sources: DashboardMetrics["sourcesIntelligence"],
) {
	return sources.map((source) => ({
		domain: source.domain,
		favicon: source.favicon,
		citationCount: source.citationCount,
		uniqueRecordCount: source.uniqueRecords.size,
		modelCount: source.models.size,
		models: [...source.models],
		uniqueRecords: [...source.uniqueRecords],
	}));
}

export function exportAnalysisJson(args: {
	workspaceId: string;
	metrics: DashboardMetrics;
	modelFilter: string;
	timeFilter: string;
}): void {
	const { workspaceId, metrics, modelFilter, timeFilter } = args;
	const generatedAt = new Date().toISOString();

	const topCompetitors = metrics.competitorData
		.filter((competitor) => !competitor.isBrand)
		.slice(0, 5);

	const thresholdObservations = getThresholdObservations(metrics);
	const promptRows = metrics.analyzedRecords.map((record) =>
		buildDetailedAnalysisCsvRow(record),
	);
	const sourceRows = serializeSourceMetrics(metrics.sourcesIntelligence);

	downloadJson(`dashboard-${workspaceId}-${Date.now()}.json`, {
		generatedAt,
		workspaceId,
		report: {
			title: "AI Visibility Dashboard Export",
			version: "2.0",
			filters: { modelFilter, timeFilter },
		},
		overview: {
			brandName: metrics.brandName,
			brandDomain: metrics.brandDomain,
			responsesAnalyzed: metrics.analyzedRecords.length,
			totalResponses: metrics.impactMetrics.totalResponses,
			citationsCaptured: metrics.totalCitations,
		},
		impactSummary: {
			presenceRate: `${metrics.aggregateStats.presenceRate}%`,
			averageRank: metrics.avgRank.position,
			recommendationRate: `${metrics.impactMetrics.recommendationRate}%`,
			topPickRate: `${metrics.impactMetrics.topPickRate}%`,
			avgSentiment: metrics.avgSentiment.score,
			avgVisibility: metrics.impactMetrics.avgVisibility,
			criticalRiskCount: metrics.impactMetrics.criticalRiskCount,
			topSourceDomain: metrics.sourcesIntelligence[0]?.domain ?? null,
			topCompetitor: metrics.aggregateStats.topCompetitor,
			topCompetitorDomain: metrics.aggregateStats.topCompetitorDomain,
			totalCitations: metrics.totalCitations,
		},
		thresholdObservations,
		brandPerception: metrics.brandPerception,
		leaderboards: {
			competitors: topCompetitors,
			sources: sourceRows.slice(0, 10),
		},
		detailedData: {
			competitors: metrics.competitorData,
			sources: sourceRows,
			prompts: promptRows,
		},
	});
}

export function exportAnalysisCsv(args: {
	workspaceId: string;
	metrics: DashboardMetrics;
}): void {
	const { workspaceId, metrics } = args;
	const thresholdObservations = getThresholdObservations(metrics);

	const overviewRows = [
		{ section: "overview", metric: "Brand", value: metrics.brandName },
		{ section: "overview", metric: "Domain", value: metrics.brandDomain },
		{
			section: "overview",
			metric: "Responses Analyzed",
			value: metrics.analyzedRecords.length,
		},
		{
			section: "impact_summary",
			metric: "Presence Rate",
			value: `${metrics.aggregateStats.presenceRate}%`,
		},
		{
			section: "impact_summary",
			metric: "Average Rank",
			value: metrics.avgRank.position ?? "N/A",
		},
		{
			section: "impact_summary",
			metric: "Recommendation Rate",
			value: `${metrics.impactMetrics.recommendationRate}%`,
		},
		{
			section: "impact_summary",
			metric: "Top Pick Rate",
			value: `${metrics.impactMetrics.topPickRate}%`,
		},
		{
			section: "impact_summary",
			metric: "Avg Visibility",
			value: `${metrics.impactMetrics.avgVisibility}%`,
		},
		{
			section: "impact_summary",
			metric: "Avg Sentiment",
			value: metrics.avgSentiment.score,
		},
		{
			section: "impact_summary",
			metric: "Critical Risks",
			value: metrics.impactMetrics.criticalRiskCount,
		},
		{
			section: "impact_summary",
			metric: "Top Competitor",
			value: metrics.aggregateStats.topCompetitor,
		},
		{
			section: "impact_summary",
			metric: "Top Competitor Domain",
			value: metrics.aggregateStats.topCompetitorDomain ?? "",
		},
		{
			section: "impact_summary",
			metric: "Total Citations",
			value: metrics.totalCitations,
		},
		...thresholdObservations.map((observation, index) => ({
			section: "threshold_observations",
			observation: index + 1,
			value: observation,
		})),
		{
			section: "brand_perception",
			metric: "Best Known For",
			value: metrics.brandPerception.bestKnownFor ?? "",
		},
		{
			section: "brand_perception",
			metric: "Pricing Perception",
			value: metrics.brandPerception.pricingPerception,
		},
		{
			section: "brand_perception",
			metric: "Core Claims",
			value: metrics.brandPerception.coreClaims.join(" | "),
		},
		{
			section: "brand_perception",
			metric: "Differentiators",
			value: metrics.brandPerception.differentiators.join(" | "),
		},
		...metrics.competitorData
			.filter((c) => !c.isBrand)
			.map((c) => ({
				section: "competitors",
				name: c.name,
				domain: c.domain,
				appearances: c.appearances,
				visibility: c.visibility ?? "",
				avg_rank: c.avgRank ?? "",
				avg_sentiment: c.avgSentiment,
				recommendation_count: c.recCount,
			})),
		...metrics.sourcesIntelligence.map((s) => ({
			section: "citation_sources",
			domain: s.domain,
			favicon: s.favicon ?? "",
			citation_count: s.citationCount,
			unique_record_count: s.uniqueRecords.size,
			model_count: s.models.size,
			models: [...s.models].join(" | "),
			unique_records: [...s.uniqueRecords].join(" | "),
		})),
		...metrics.analyzedRecords.map((record) =>
			buildDetailedAnalysisCsvRow(record),
		),
	];

	downloadCsv(`dashboard-${workspaceId}-${Date.now()}.csv`, overviewRows);
}
