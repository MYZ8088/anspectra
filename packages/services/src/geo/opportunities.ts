import { clickhouse, db, schema } from "@aloom/db";
import { ValidationError } from "@aloom/errors";
import type { BrandAnalysisResult } from "@aloom/types";
import { and, desc, eq } from "drizzle-orm";
import { parseAnalysisOutput } from "../analysis/runAnalysis.js";
import {
	getBaselineScorecard,
	getLatestFormalBaselineScorecard,
} from "./scorecard.js";

const OPPORTUNITY_TYPES = [
	"factual_error",
	"content_gap",
	"evidence_gap",
	"page_not_extractable",
	"competitor_pressure",
	"negative_misunderstanding",
	"page_technical_issue",
	"external_source_gap",
] as const;

type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

type BaselineAnswerRow = {
	id: string;
	checkpoint_id: string | null;
	prompt_id: string;
	prompt: string;
	prompt_group: string;
	prompt_hash: string;
	decision_stage: string;
	locale: string;
	model_provider: string;
	response: string;
	sources: unknown;
	source_exposure: string;
	status: string;
};

type OpportunityDraft = {
	type: OpportunityType;
	priority: "P0" | "P1" | "P2";
	title: string;
	description: string;
	evidenceSampleIds: string[];
	promptIds: string[];
	acceptanceMetric: string;
	reason: string;
	effort: "small" | "medium" | "large";
	confidence: number;
	retestScope: Record<string, unknown>;
	targetPageId?: string | null;
};

type AnalysedAnswer = BaselineAnswerRow & {
	analysis: BrandAnalysisResult | null;
};

function dedupe<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function promptLabel(prompt: string) {
	return prompt.length > 76 ? `${prompt.slice(0, 76)}...` : prompt;
}

function sourceMentionsDomain(sources: unknown, hostname: string) {
	return (
		hostname.length > 0 &&
		JSON.stringify(sources).toLowerCase().includes(hostname)
	);
}

function average(values: number[]) {
	return values.length
		? values.reduce((total, value) => total + value, 0) / values.length
		: 0;
}

function clusterDrafts(args: {
	rows: AnalysedAnswer[];
	officialHostname: string;
	baselineConfidence: "low" | "medium" | "high";
}): OpportunityDraft[] {
	const first = args.rows[0];
	if (!first) return [];
	const analyses = args.rows.flatMap((row) =>
		row.analysis ? [row.analysis] : [],
	);
	if (analyses.length === 0) return [];
	const evidenceSampleIds = dedupe(
		args.rows.map((row) => row.checkpoint_id ?? row.id),
	);
	const promptIds = dedupe(args.rows.map((row) => row.prompt_id));
	const providers = dedupe(args.rows.map((row) => row.model_provider));
	const retestScope = {
		promptHashes: [first.prompt_hash],
		providers,
		intent: first.prompt_group,
		decisionStage: first.decision_stage,
		locale: first.locale,
	};
	const confidenceBase =
		args.baselineConfidence === "high"
			? 85
			: args.baselineConfidence === "medium"
				? 70
				: 50;
	const confidence = Math.min(
		95,
		confidenceBase + Math.min(10, analyses.length),
	);
	const titlePrompt = promptLabel(first.prompt);
	const drafts: OpportunityDraft[] = [];
	const absent = analyses.filter((analysis) => !analysis.presence.mentioned);
	if (absent.length / analyses.length >= 0.5) {
		drafts.push({
			type: "content_gap",
			priority: "P0",
			title: `品牌在 Prompt 簇中缺席：${titlePrompt}`,
			description:
				"该问题在多个真实 Web 样本中没有形成品牌候选，需要补齐与意图和决策阶段直接对应的公开内容。",
			evidenceSampleIds,
			promptIds,
			acceptanceMetric:
				"同 Prompt hash 的出现率和候选率提升，失败样本仍保留在分母。",
			reason: `${absent.length}/${analyses.length} 个已分析样本未提及品牌。`,
			effort: "medium",
			confidence,
			retestScope,
		});
	}

	const weakRecommendation = analyses.filter((analysis) =>
		["mentioned_only", "conditional", "discouraged"].includes(
			analysis.recommendation.type,
		),
	);
	const targetShare = average(
		analyses.map((analysis) => analysis.scorecard.competition.targetShare),
	);
	if (weakRecommendation.length > 0 || targetShare < 40) {
		drafts.push({
			type: "competitor_pressure",
			priority: absent.length === analyses.length ? "P2" : "P1",
			title: `竞品压制品牌推荐位置：${titlePrompt}`,
			description:
				"品牌存在但推荐力度、绝对排名或候选份额偏弱，需要用真实差异、适用边界和实施证据改进比较内容。",
			evidenceSampleIds,
			promptIds,
			acceptanceMetric: "推荐率提升且平均绝对排名改善，竞品真实优势仍被保留。",
			reason: `${weakRecommendation.length}/${analyses.length} 个样本推荐偏弱，平均目标份额 ${Math.round(targetShare)}%。`,
			effort: "large",
			confidence,
			retestScope,
		});
	}

	const notExposed = args.rows.filter(
		(row) => row.source_exposure !== "exposed",
	);
	const unsupportedClaims = analyses.reduce(
		(total, analysis) => total + analysis.scorecard.evidence.unsupportedClaims,
		0,
	);
	if (notExposed.length > 0 || unsupportedClaims > 0) {
		drafts.push({
			type: "evidence_gap",
			priority: "P1",
			title: `公开证据不足或未暴露：${titlePrompt}`,
			description:
				"未暴露链接不等于没有信源；应补足可抽取的官方事实页、FAQ、比较依据和逐条来源映射。",
			evidenceSampleIds,
			promptIds,
			acceptanceMetric:
				"后续样本出现可见且支持对应断言的来源，或证据支持率提升。",
			reason: `${notExposed.length}/${args.rows.length} 个样本未暴露可抽取链接，${unsupportedClaims} 条断言未获可见引用支持。`,
			effort: "medium",
			confidence,
			retestScope,
		});
	}

	const factualErrors = analyses.flatMap((analysis) => [
		...analysis.scorecard.factuality.errors,
		...analysis.risks.items
			.filter((risk) =>
				["factual_error", "outdated_info", "brand_confusion"].includes(
					risk.type ?? "",
				),
			)
			.map((risk) => ({
				claim: risk.claim ?? "Unspecified factual risk",
				severity: risk.severity,
				correction: risk.correction ?? null,
			})),
	]);
	if (factualErrors.length > 0) {
		drafts.push({
			type: "factual_error",
			priority: factualErrors.some((error) => error.severity === "critical")
				? "P0"
				: "P1",
			title: `回答存在事实错误：${titlePrompt}`,
			description:
				"先在事实台账确认正确口径和证据等级，再修订官网内容；未核验的价格、客户、资质和效果不得进入正文。",
			evidenceSampleIds,
			promptIds,
			acceptanceMetric: "被标记的错误断言在连续复测中消失，事实准确率提升。",
			reason: factualErrors
				.slice(0, 3)
				.map((error) => error.claim)
				.join("；"),
			effort: "small",
			confidence,
			retestScope,
		});
	}

	const negative = analyses.filter(
		(analysis) =>
			analysis.sentiment.score <= 40 ||
			analysis.recommendation.type === "discouraged" ||
			analysis.risks.items.some((risk) => risk.type === "negative_association"),
	);
	if (negative.length > 0) {
		drafts.push({
			type: "negative_misunderstanding",
			priority: "P0",
			title: `负面表述或品牌误解：${titlePrompt}`,
			description:
				"用可核验事实澄清限制、适用边界和常见误解，不通过无证据贬损竞品来抬高品牌。",
			evidenceSampleIds,
			promptIds,
			acceptanceMetric: "负面表述减少，情感改善，且事实准确率不下降。",
			reason: `${negative.length}/${analyses.length} 个样本出现负面或劝退信号。`,
			effort: "medium",
			confidence,
			retestScope,
		});
	}

	const exposedRows = args.rows.filter(
		(row) => row.source_exposure === "exposed",
	);
	if (
		exposedRows.length > 0 &&
		exposedRows.every(
			(row) => !sourceMentionsDomain(row.sources, args.officialHostname),
		)
	) {
		drafts.push({
			type: "external_source_gap",
			priority: "P2",
			title: `可见引用未覆盖官方或可信站外证据：${titlePrompt}`,
			description:
				"为媒体、百科、社区、伙伴和行业报告建立人工证据任务，不自动向第三方平台发布。",
			evidenceSampleIds,
			promptIds,
			acceptanceMetric:
				"复测出现支持目标断言的高可信站外来源，且来源与正文一致。",
			reason: `${exposedRows.length} 个已暴露来源的样本均未引用官方域名。`,
			effort: "large",
			confidence: Math.max(40, confidence - 10),
			retestScope,
		});
	}

	return drafts;
}

function pageDrafts(
	pages: Array<typeof schema.sitePages.$inferSelect>,
): OpportunityDraft[] {
	const drafts: OpportunityDraft[] = [];
	for (const page of pages) {
		const snapshot = page.snapshot as {
			mainText?: string;
			h1?: string[];
			metaRobots?: string;
			initialHtmlHasMainContent?: boolean;
		};
		if (
			!snapshot.initialHtmlHasMainContent ||
			(snapshot.mainText?.length ?? 0) < 300
		) {
			drafts.push({
				type: "page_not_extractable",
				priority: "P0",
				title: `页面正文不可稳定抽取：${page.title || page.url}`,
				description:
					"初始 HTML 中缺少足够主内容，需要补充服务端渲染、语义正文和稳定标题层级。",
				evidenceSampleIds: [],
				promptIds: [],
				acceptanceMetric: "页面重新审计后主内容可抽取，正文超过 300 字符。",
				reason: "网站扫描未在初始 HTML 中识别到稳定主内容。",
				effort: "medium",
				confidence: 90,
				retestScope: { pageUrl: page.url },
				targetPageId: page.id,
			});
		}
		if (
			(page.httpStatus ?? 0) >= 400 ||
			!page.canonicalUrl ||
			(snapshot.h1?.length ?? 0) !== 1 ||
			/noindex/i.test(snapshot.metaRobots ?? "")
		) {
			drafts.push({
				type: "page_technical_issue",
				priority: (page.httpStatus ?? 0) >= 400 ? "P0" : "P1",
				title: `页面技术信号需修复：${page.title || page.url}`,
				description:
					"修复 HTTP 状态、canonical、唯一 H1 或 robots 索引信号，并在发布后立即重审。",
				evidenceSampleIds: [],
				promptIds: [],
				acceptanceMetric:
					"页面技术审计通过且内容哈希、canonical 和索引信号可追溯。",
				reason: `HTTP ${page.httpStatus ?? "unknown"}；canonical ${page.canonicalUrl ? "present" : "missing"}；H1 ${snapshot.h1?.length ?? 0}。`,
				effort: "small",
				confidence: 95,
				retestScope: { pageUrl: page.url },
				targetPageId: page.id,
			});
		}
	}
	return drafts;
}

async function loadBaselineAnswers(workspaceId: string, seriesId: string) {
	const response = await clickhouse.query({
		query: `
			SELECT id, checkpoint_id, prompt_id, prompt, prompt_group, prompt_hash,
			       decision_stage, locale, model_provider, response, sources,
			       source_exposure, status
			FROM analytics.answer_samples_v2 FINAL
			WHERE workspace_id = {workspaceId:String}
			  AND series_id = toNullable({seriesId:String})
			ORDER BY prompt_hash, model_provider, repeat_index
		`,
		query_params: { workspaceId, seriesId },
		format: "JSONEachRow",
	});
	const rows: BaselineAnswerRow[] = await response.json();
	const sampleIds = rows.map((row) => row.id);
	if (sampleIds.length === 0) return [] as AnalysedAnswer[];
	const analysisResponse = await clickhouse.query({
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
	const analysisRows: Array<{ sample_id: string; analysis_json: string }> =
		await analysisResponse.json();
	const analysisById = new Map<string, BrandAnalysisResult>();
	for (const row of analysisRows) {
		try {
			analysisById.set(row.sample_id, parseAnalysisOutput(row.analysis_json));
		} catch {}
	}
	return rows.map((row) => ({
		...row,
		analysis: analysisById.get(row.id) ?? null,
	}));
}

export async function refreshWorkspaceOpportunities(
	workspaceId: string,
	seriesId?: string,
) {
	const scorecard = seriesId
		? await getBaselineScorecard({ workspaceId, seriesId })
		: await getLatestFormalBaselineScorecard(workspaceId);
	if (!scorecard) {
		throw new ValidationError("Run a formal Yao baseline before diagnosis");
	}
	const [answers, pages, profile, existing] = await Promise.all([
		loadBaselineAnswers(workspaceId, scorecard.series.id),
		db.query.sitePages.findMany({
			where: eq(schema.sitePages.workspaceId, workspaceId),
			orderBy: [desc(schema.sitePages.lastCrawledAt)],
			limit: 100,
		}),
		db.query.brandProfiles.findFirst({
			where: eq(schema.brandProfiles.workspaceId, workspaceId),
		}),
		db.query.opportunities.findMany({
			where: and(
				eq(schema.opportunities.workspaceId, workspaceId),
				eq(schema.opportunities.baselineSeriesId, scorecard.series.id),
			),
		}),
	]);
	const officialHostname = (() => {
		try {
			return new URL(
				/^https?:\/\//i.test(profile?.officialDomain ?? "")
					? (profile?.officialDomain ?? "")
					: `https://${profile?.officialDomain ?? ""}`,
			).hostname.toLowerCase();
		} catch {
			return "";
		}
	})();
	const clusters = new Map<string, AnalysedAnswer[]>();
	for (const answer of answers) {
		const key = answer.prompt_hash || answer.prompt_id;
		clusters.set(key, [...(clusters.get(key) ?? []), answer]);
	}
	const drafts = [
		...[...clusters.values()].flatMap((rows) =>
			clusterDrafts({
				rows,
				officialHostname,
				baselineConfidence: scorecard.confidence,
			}),
		),
		...pageDrafts(pages),
	];
	const existingKeys = new Set(
		existing.map((opportunity) => `${opportunity.type}:${opportunity.title}`),
	);
	const uniqueDrafts = drafts.filter((draft) => {
		const key = `${draft.type}:${draft.title}`;
		if (existingKeys.has(key)) return false;
		existingKeys.add(key);
		return true;
	});
	if (uniqueDrafts.length > 0) {
		const inserted = await db
			.insert(schema.opportunities)
			.values(
				uniqueDrafts.map((draft) => ({
					workspaceId,
					baselineSeriesId: scorecard.series.id,
					...draft,
				})),
			)
			.returning();
		const external = inserted.filter(
			(opportunity) => opportunity.type === "external_source_gap",
		);
		if (external.length > 0) {
			await db.insert(schema.externalEvidenceTasks).values(
				external.flatMap((opportunity) =>
					["media", "community", "partner", "industry_report"].map(
						(channel) => ({
							workspaceId,
							opportunityId: opportunity.id,
							channel,
							title: `${channel.replaceAll("_", " ")}: ${opportunity.title}`,
							description:
								"Prepare a verifiable evidence contribution for human review. Do not auto-publish.",
							acceptanceMetric: opportunity.acceptanceMetric,
						}),
					),
				),
			);
		}
	}
	return listWorkspaceOpportunities(workspaceId, scorecard.series.id);
}

export async function listWorkspaceOpportunities(
	workspaceId: string,
	seriesId?: string,
) {
	return db.query.opportunities.findMany({
		where: seriesId
			? and(
					eq(schema.opportunities.workspaceId, workspaceId),
					eq(schema.opportunities.baselineSeriesId, seriesId),
				)
			: eq(schema.opportunities.workspaceId, workspaceId),
		orderBy: [desc(schema.opportunities.createdAt)],
	});
}

export async function listExternalEvidenceTasks(workspaceId: string) {
	return db.query.externalEvidenceTasks.findMany({
		where: eq(schema.externalEvidenceTasks.workspaceId, workspaceId),
		orderBy: [desc(schema.externalEvidenceTasks.createdAt)],
	});
}
