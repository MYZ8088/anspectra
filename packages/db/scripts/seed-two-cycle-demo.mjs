import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@clickhouse/client";
import postgres from "postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const workspaceId = "workspace_anspectra_two_cycle_demo";
const workspaceSlug = "anspectra-two-cycle-demo";
const promptSetId = "a6200000-0000-4000-8000-000000000001";
const seriesId = "a6200000-0000-4000-8000-000000000002";
const runIds = [
	"a6200000-0000-4000-8000-000000000011",
	"a6200000-0000-4000-8000-000000000012",
];
const profileId = "a6200000-0000-4000-8000-000000000003";
const packKey = "anspectra-geo-detection-v1";
const packVersion = "1.2.0";
const providers = ["doubao", "deepseek", "hunyuan", "qwen"];
const providerLabels = {
	doubao: "豆包",
	deepseek: "DeepSeek",
	hunyuan: "元宝",
	qwen: "千问",
};
const competitors = ["Profound", "AthenaHQ", "Peec AI"];

function argument(name) {
	const prefix = `--${name}=`;
	return process.argv
		.find((value) => value.startsWith(prefix))
		?.slice(prefix.length);
}

const ownerEmail = argument("owner-email")?.trim();
if (!ownerEmail) {
	throw new Error(
		"Pass the local workspace owner with --owner-email=<email>. No demo data was written.",
	);
}

function assertLocalUrl(label, rawValue) {
	if (!rawValue) throw new Error(`${label} is required.`);
	const value = new URL(rawValue);
	if (!["localhost", "127.0.0.1", "::1"].includes(value.hostname)) {
		throw new Error(`${label} must point to localhost for demo seeding.`);
	}
	return rawValue;
}

const databaseUrl = assertLocalUrl("DATABASE_URL", process.env.DATABASE_URL);
const clickhouseUrl = assertLocalUrl(
	"CLICKHOUSE_URL",
	process.env.CLICKHOUSE_URL,
);
const sql = postgres(databaseUrl, { max: 1 });
const clickhouse = createClient({
	url: clickhouseUrl,
	username: process.env.CLICKHOUSE_USER || "default",
	password: process.env.CLICKHOUSE_PASSWORD || "clickhouse",
	database: process.env.CLICKHOUSE_DB || "analytics",
});

const presetPath = path.join(
	repoRoot,
	"packages/services/src/geo/presets/anspectra-geo-detection-v1.2.zh-CN.json",
);
const preset = JSON.parse(await readFile(presetPath, "utf8"));
const quickEntries = preset.entries.filter(
	(entry) => entry.stage === "awareness" || entry.stage === "evaluation",
);
if (quickEntries.length !== 18) {
	throw new Error(
		`Expected 18 Quick Scan templates, found ${quickEntries.length}.`,
	);
}

const profile = {
	brand: "Anspectra",
	product: "Official-Web GEO Detection",
	category: "官方 Web GEO 检测工具",
	audience: "B2B SaaS 增长与产品营销团队",
	region: "中国市场",
	market: "中国市场",
	industry: "B2B 软件",
	budget: "开源自托管预算",
	teamSize: "5 至 20 人团队",
	implementationPeriod: "一天内完成本地部署",
	evidenceRequirement: "引用注明日期且可核验的公开来源，并标记无法确认的信息",
};

function renderPrompt(entry, index) {
	const competitor = competitors[index % competitors.length];
	const values = { ...profile, competitor };
	const question = entry.prompt.replace(/\{([a-zA-Z]+)\}/g, (_, key) => {
		const value = values[key];
		if (!value) throw new Error(`Missing demo prompt value: ${key}`);
		return value;
	});
	const prompt = `${question.trim()}\n\n请使用简体中文完整回答；产品名和专有名词可保留原文。`;
	const promptHash = createHash("sha256")
		.update(`zh-CN\n${packVersion}\n${prompt.trim().replace(/\s+/g, " ")}`)
		.digest("hex");
	return {
		...entry,
		prompt,
		promptHash,
		competitor,
		workspacePromptId: randomUUID(),
		monitorPromptId: randomUUID(),
	};
}

const prompts = quickEntries.map(renderPrompt);
const expectedPromptHashes = prompts.map((prompt) => prompt.promptHash);

function clickhouseDate(value) {
	return value.toISOString().slice(0, 19).replace("T", " ");
}

function mentionLimit(providerIndex, roundIndex) {
	return [8, 10, 7, 9][providerIndex] + (roundIndex - 1) * 2;
}

function recommendationLimit(providerIndex, roundIndex) {
	return [2, 3, 1, 2][providerIndex] + (roundIndex - 1);
}

function sourceLimit(providerIndex, roundIndex) {
	return [5, 7, 4, 6][providerIndex] + (roundIndex - 1) * 2;
}

function buildAnalysis({ prompt, promptIndex, providerIndex, roundIndex }) {
	const mentioned = promptIndex < mentionLimit(providerIndex, roundIndex);
	const recommended =
		mentioned && promptIndex < recommendationLimit(providerIndex, roundIndex);
	const discouraged =
		mentioned && prompt.intent === "risk" && promptIndex % 2 === 1;
	const rankPosition = mentioned
		? 1 + ((promptIndex + providerIndex) % 4)
		: null;
	const recommendationType = !mentioned
		? "not_mentioned"
		: discouraged
			? "discouraged"
			: recommended
				? promptIndex % 2 === 0
					? "top_pick"
					: "conditional"
				: "mentioned_only";
	const competitorCount = mentioned ? 2 : 3;
	const targetShare = mentioned
		? Math.round((100 / (competitorCount + 1)) * 100) / 100
		: 0;
	const reviewedClaims = mentioned ? 2 : 0;
	const accurateClaims = mentioned
		? roundIndex === 2 || (promptIndex + providerIndex) % 4 !== 0
			? 2
			: 1
		: 0;
	const visibility = mentioned
		? 55 + ((promptIndex * 7 + providerIndex * 5) % 35)
		: 0;
	const sentiment = mentioned
		? 58 + ((promptIndex * 3 + roundIndex * 4) % 25)
		: 50;
	const geoScore = mentioned
		? Math.round(
				(visibility + sentiment + targetShare + (recommended ? 85 : 35)) / 4,
			)
		: 0;
	return {
		metadata: {
			brandName: "Anspectra",
			brandDomain: "anspectra.pages.dev",
			brandAliases: ["AS"],
			products: ["Official-Web GEO Detection"],
			matchedTargetEntities: mentioned ? ["Anspectra"] : [],
		},
		geoScore: { overall: geoScore },
		presence: { mentioned, visibility },
		position: { rankPosition },
		sentiment: { score: sentiment },
		recommendation: { type: recommendationType },
		competitors: competitors.slice(0, competitorCount).map((name, index) => ({
			name,
			domain:
				name === "Profound"
					? "tryprofound.com"
					: name === "AthenaHQ"
						? "athenahq.ai"
						: "peec.ai",
			visibility: 62 - index * 8,
			sentiment: 64 - index * 3,
			rankPosition: index + 1 + (mentioned ? 1 : 0),
			isRecommended: index === 0 || (!mentioned && index === 1),
		})),
		perception: {
			coreClaims: mentioned
				? ["通过真实官方 Web 页面采集回答", "使用固定且版本化的 GEO 提示词套件"]
				: [],
			differentiators: mentioned
				? ["本机持久浏览器 profile", "回答与搜索来源分开记录"]
				: [],
			bestKnownFor: mentioned ? "中国 AI Web 平台的 GEO 检测" : null,
			pricingPerception: mentioned ? "free" : "not_mentioned",
		},
		risks: {
			items: mentioned
				? []
				: [
						{
							severity: "info",
							type: "missing_from_response",
							claim: "回答没有提及 Anspectra。",
							correction: null,
						},
					],
		},
		scorecard: {
			visibility: {
				score: visibility,
				numerator: mentioned ? 1 : 0,
				denominator: 1,
			},
			factuality: {
				score: reviewedClaims ? (accurateClaims / reviewedClaims) * 100 : null,
				reviewedClaims,
				accurateClaims,
				errors:
					accurateClaims < reviewedClaims
						? [
								{
									claim: "平台覆盖范围表述不完整。",
									severity: "info",
									correction: "当前正式支持豆包、DeepSeek、元宝和千问。",
								},
							]
						: [],
			},
			evidence: {
				score: mentioned ? 60 + roundIndex * 8 : 20,
				visibleCitations: mentioned ? 2 : 1,
				supportedClaims: mentioned ? accurateClaims : 0,
				unsupportedClaims: mentioned ? reviewedClaims - accurateClaims : 1,
			},
			stability: {
				score: null,
				comparableSamples: 0,
				consistentSamples: 0,
				note: "Calculated across completed cycles at report level",
			},
			competition: {
				score: targetShare,
				targetShare,
				competitorShare: 100 - targetShare,
			},
			governanceAttribution: {
				score: 100,
				confidence: "medium",
				caveats: ["Synthetic demonstration sample"],
			},
		},
	};
}

function buildSources({ promptIndex, providerIndex, roundIndex }) {
	const searchExposed = promptIndex < sourceLimit(providerIndex, roundIndex);
	const answerLinkExposed =
		searchExposed && (promptIndex + providerIndex) % 3 === 0;
	const sources = [];
	if (searchExposed) {
		sources.push(
			{
				title: "Anspectra — Official-Web GEO Detection",
				cited_text: "Product overview and supported official Web providers",
				url: "https://anspectra.pages.dev/",
				domain: "anspectra.pages.dev",
				favicon: null,
				source_kind: "search_source",
			},
			{
				title: "Anspectra source repository",
				cited_text: "Open-source implementation and documentation",
				url: "https://github.com/MYZ8088/anspectra",
				domain: "github.com",
				favicon: null,
				source_kind: "search_source",
			},
		);
	}
	if (answerLinkExposed) {
		sources.push({
			title: "Anspectra documentation",
			cited_text: "Detection methodology and report metrics",
			url: "https://github.com/MYZ8088/anspectra#readme",
			domain: "github.com",
			favicon: null,
			source_kind: "answer_link",
		});
	}
	return { searchExposed, answerLinkExposed, sources };
}

function buildResponse({ mentioned, recommended, provider, sources }) {
	const providerLabel = providerLabels[provider];
	if (!mentioned) {
		return `${providerLabel} 的这次回答主要列出了 Profound、AthenaHQ 和 Peec AI，并从部署方式、数据来源与报告能力进行了比较。回答没有把 Anspectra 列入明确候选。\n\n这是用于展示报告布局的模拟回答，不代表平台真实输出。`;
	}
	const recommendation = recommended
		? "在需要本机持久登录态和中国 AI Web 平台采样时，可以把 Anspectra 列入候选。"
		: "Anspectra 在回答中被描述为一种可选方案，但没有被列为首选。";
	const answerLink = sources.some(
		(source) => source.source_kind === "answer_link",
	)
		? "\n\n可见链接：[Anspectra 文档](https://github.com/MYZ8088/anspectra#readme)"
		: "";
	return `Anspectra 是一个面向豆包、DeepSeek、元宝和千问官方 Web 页面的 GEO 检测工具。它使用固定提示词套件、独立新对话和样本级 checkpoint，区分搜索来源与回答正文链接。\n\n${recommendation}\n\n对比时还应关注 Profound、AthenaHQ 和 Peec AI 的覆盖平台、部署方式与数据口径。${answerLink}\n\n这是用于展示报告布局的模拟回答，不代表平台真实输出。`;
}

async function clearClickHouseDemo() {
	for (const table of [
		"analytics.sample_analysis_v2",
		"analytics.sample_citations",
		"analytics.answer_samples_v2",
	]) {
		await clickhouse.command({
			query: `ALTER TABLE ${table} DELETE WHERE workspace_id = {workspaceId:String} SETTINGS mutations_sync = 2`,
			query_params: { workspaceId },
		});
	}
}

const now = new Date();
now.setSeconds(0, 0);
const cycleDates = [new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000), now];

const answerRows = [];
const citationRows = [];
const analysisRows = [];
const checkpointRows = [];

try {
	const [owner] = await sql`
		SELECT id, email FROM "user" WHERE lower(email) = lower(${ownerEmail}) LIMIT 1
	`;
	if (!owner) throw new Error(`No local user found for ${ownerEmail}.`);
	const [ownerWorkspace] = await sql`
		SELECT w.tenant_id
		FROM workspace_members wm
		JOIN workspaces w ON w.id = wm.workspace_id
		WHERE wm.user_id = ${owner.id} AND wm.deleted_at IS NULL
		ORDER BY w.created_at DESC
		LIMIT 1
	`;
	if (!ownerWorkspace) {
		throw new Error("The owner must belong to an existing local organization.");
	}

	await clearClickHouseDemo();
	await sql.begin(async (tx) => {
		await tx`DELETE FROM workspaces WHERE id = ${workspaceId}`;
		await tx`
			INSERT INTO workspaces (
				id, name, slug, domain, tenant_id, schedule, enabled_providers,
				selected_prompt_ids, created_at, archived_at, deleted_at
			) VALUES (
				${workspaceId}, 'Anspectra Two-Cycle Demo', ${workspaceSlug},
				'anspectra.pages.dev', ${ownerWorkspace.tenant_id}, NULL, NULL,
				NULL, ${cycleDates[0]}, NULL, NULL
			)
		`;
		await tx`
			INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
			VALUES (${workspaceId}, ${owner.id}, 'owner', ${cycleDates[0]})
		`;
		await tx`
			INSERT INTO brand_profiles (
				id, workspace_id, brand_name, official_domain, aliases, products,
				category, industry, market, audiences, competitors, regions, locales,
				budget, team_size, implementation_period, evidence_requirement,
				version, confirmation_status, confirmed_at, created_at, updated_at
			) VALUES (
				${profileId}, ${workspaceId}, 'Anspectra', 'anspectra.pages.dev',
				${sql.json(["AS"])}, ${sql.json(["Official-Web GEO Detection"])},
				'official-Web GEO detection tools', 'B2B software', 'China',
				${sql.json(["B2B SaaS growth and product marketing teams"])},
				${sql.json(competitors)}, ${sql.json(["China"])}, ${sql.json(["zh-CN"])},
				'Open-source self-hosted budget', '5-20 people', 'One day',
				'Use dated, verifiable public sources and mark unconfirmed information',
				1, 'confirmed', ${cycleDates[0]}, ${cycleDates[0]}, ${now}
			)
		`;

		const promptSetManifest = {
			suiteKey: "quick_scan",
			samplingDepth: "reliable",
			runPlan: {
				totalRuns: 2,
				cadence: "weekly",
				timezone: "Asia/Shanghai",
				localTime: "09:00",
				dayOfWeek: 1,
				dayOfMonth: null,
			},
			locales: ["zh-CN"],
			completePreset: true,
			customPromptCount: 0,
			expectedPromptHashes,
			dataOrigin: "synthetic_demo",
		};
		await tx`
			INSERT INTO prompt_sets (
				id, workspace_id, name, tier, version, status, purpose, pack_key,
				template_version, manifest, created_at, updated_at
			) VALUES (
				${promptSetId}, ${workspaceId}, 'Anspectra Quick Scan · Two-Cycle Demo',
				'quick', 1, 'frozen', 'baseline', ${packKey}, ${packVersion},
				${sql.json(promptSetManifest)}, ${cycleDates[0]}, ${now}
			)
		`;

		for (const [index, prompt] of prompts.entries()) {
			const dimensions = {
				templateKey: `${packKey}:${prompt.key}`,
				intent: prompt.intent,
				decisionStage: prompt.stage,
				locale: "zh-CN",
				brandExposure: prompt.brandExposure,
				origin: "system_preset",
				targetProduct: "Official-Web GEO Detection",
				targetCompetitor: prompt.competitor,
				targetAudience: "B2B SaaS growth and product marketing teams",
				targetRegion: "China",
				queryForm: "standalone",
			};
			await tx`
				INSERT INTO workspace_prompts (
					id, workspace_id, template_id, origin, prompt, prompt_hash, locale,
					intent, decision_stage, brand_exposure, dimensions, rewrites, tags,
					version, created_by_user_id, profile_version, relevance, locked,
					active, created_at, updated_at
				) VALUES (
					${prompt.workspacePromptId}, ${workspaceId}, NULL, 'system_preset',
					${prompt.prompt}, ${prompt.promptHash}, 'zh-CN', ${prompt.intent},
					${prompt.stage}, ${prompt.brandExposure}, ${sql.json(dimensions)},
					${sql.json({})}, ${sql.json(["demo", "quick_scan"])}, 1,
					${owner.id}, 1, ${sql.json({ status: "relevant" })}, TRUE, TRUE,
					${cycleDates[0]}, ${now}
				)
			`;
			await tx`
				INSERT INTO prompt_set_items (
					id, prompt_set_id, workspace_prompt_id, position, enabled, role,
					created_at, updated_at
				) VALUES (
					${randomUUID()}, ${promptSetId}, ${prompt.workspacePromptId},
					${index}, TRUE, 'measurement', ${cycleDates[0]}, ${now}
				)
			`;
			await tx`
				INSERT INTO monitor_prompts (
					id, workspace_id, prompt_set_id, prompt, workspace_prompt_id,
					prompt_group, locale, persona, decision_stage, cohort, origin,
					template_key, template_version, prompt_hash, brand_exposure,
					dimensions, rewrites, version, active, created_at, updated_at
				) VALUES (
					${prompt.monitorPromptId}, ${workspaceId}, ${promptSetId}, ${prompt.prompt},
					${prompt.workspacePromptId}, ${prompt.intent}, 'zh-CN',
					'B2B SaaS growth and product marketing teams', ${prompt.stage},
					${prompt.brandExposure === "blind" ? "control" : "treatment"},
					'system_preset', ${`${packKey}:${prompt.key}`}, ${packVersion},
					${prompt.promptHash}, ${prompt.brandExposure}, ${sql.json(dimensions)},
					${sql.json({})}, 1, TRUE, ${cycleDates[0]}, ${now}
				)
			`;
		}

		const providerModes = Object.fromEntries(
			providers.map((provider) => [provider, ["default"]]),
		);
		await tx`
			INSERT INTO collection_series (
				id, workspace_id, prompt_set_id, purpose, status, tier,
				required_providers, provider_modes, round_count, planned_samples,
				completed_samples, failed_samples, waiting_samples, manifest,
				started_at, completed_at, created_at, updated_at
			) VALUES (
				${seriesId}, ${workspaceId}, ${promptSetId}, 'baseline', 'completed', 'quick',
				${sql.json(providers)}, ${sql.json(providerModes)}, 2, 144, 144, 0, 0,
				${sql.json({
					dataOrigin: "synthetic_demo",
					sampleSource: "synthetic_demo",
					evidenceLevel: "synthetic_demo",
					expectedPromptHashes,
					conversationIsolation: "not_applicable",
				})},
				${cycleDates[0]}, ${now}, ${cycleDates[0]}, ${now}
			)
		`;

		for (let roundIndex = 1; roundIndex <= 2; roundIndex += 1) {
			const runId = runIds[roundIndex - 1];
			const runAt = cycleDates[roundIndex - 1];
			await tx`
				INSERT INTO collection_runs (
					id, workspace_id, prompt_set_id, series_id, status, tier,
					total_samples, completed_samples, failed_samples, round_index,
					scheduled_at, started_at, completed_at, metadata, created_at, updated_at
				) VALUES (
					${runId}, ${workspaceId}, ${promptSetId}, ${seriesId}, 'completed', 'quick',
					72, 72, 0, ${roundIndex}, ${runAt}, ${runAt}, ${runAt},
					${sql.json({
						providers,
						providerModes: Object.fromEntries(
							providers.map((provider) => [provider, "default"]),
						),
						roundIndex,
						roundCount: 2,
						dataOrigin: "synthetic_demo",
						sampleSource: "synthetic_demo",
					})},
					${runAt}, ${runAt}
				)
			`;

			for (const [providerIndex, provider] of providers.entries()) {
				for (const [promptIndex, prompt] of prompts.entries()) {
					const checkpointId = randomUUID();
					const sampleId = randomUUID();
					const analysis = buildAnalysis({
						prompt,
						promptIndex,
						providerIndex,
						roundIndex,
					});
					const sourceResult = buildSources({
						promptIndex,
						providerIndex,
						roundIndex,
					});
					const response = buildResponse({
						mentioned: analysis.presence.mentioned,
						recommended: ["top_pick", "conditional"].includes(
							analysis.recommendation.type,
						),
						provider,
						sources: sourceResult.sources,
					});
					const sourceExposure = sourceResult.sources.length
						? "exposed"
						: "not_exposed";
					await tx`
						INSERT INTO sample_checkpoints (
							id, run_id, prompt_id, workspace_prompt_id, provider,
							repeat_index, status, phase, requested_mode, actual_mode,
							analysis_status, attempt_count, retryable, source_exposure,
							analytics_sample_id, started_at, completed_at, last_event_at,
							created_at, updated_at
						) VALUES (
							${checkpointId}, ${runId}, ${prompt.monitorPromptId},
							${prompt.workspacePromptId}, ${provider}, ${roundIndex - 1},
							'completed', 'completed', 'default', 'default', 'completed',
							1, FALSE, ${sourceExposure}, ${sampleId}, ${runAt}, ${runAt},
							${runAt}, ${runAt}, ${runAt}
						)
					`;
					await tx`
						INSERT INTO sample_attempts (
							id, checkpoint_id, attempt_index, status, phase, retryable,
							diagnostics, started_at, completed_at, created_at, updated_at
						) VALUES (
							${randomUUID()}, ${checkpointId}, 1, 'completed', 'completed', FALSE,
							${sql.json({ dataOrigin: "synthetic_demo" })}, ${runAt}, ${runAt},
							${runAt}, ${runAt}
						)
					`;

					checkpointRows.push({ checkpointId, sampleId });
					answerRows.push({
						id: sampleId,
						legacy_response_id: null,
						run_id: runId,
						checkpoint_id: checkpointId,
						prompt_set_id: promptSetId,
						series_id: seriesId,
						prompt_id: prompt.monitorPromptId,
						prompt: prompt.prompt,
						prompt_group: prompt.intent,
						prompt_hash: prompt.promptHash,
						prompt_origin: "system_preset",
						decision_stage: prompt.stage,
						locale: "zh-CN",
						brand_exposure: prompt.brandExposure,
						repeat_index: roundIndex - 1,
						user_id: owner.id,
						workspace_id: workspaceId,
						model: providerLabels[provider],
						model_provider: provider,
						response,
						sources: sourceResult.sources.map(
							({ source_kind: _sourceKind, ...source }) => source,
						),
						source_exposure: sourceExposure,
						reported_search_source_count: sourceResult.searchExposed ? 3 : null,
						search_source_coverage: sourceResult.searchExposed
							? "partial"
							: "not_exposed",
						requested_mode: "default",
						actual_mode: "default",
						conversation_id: null,
						conversation_url: null,
						conversation_isolation: "not_applicable",
						evidence_level: "synthetic_demo",
						account_state: "demo",
						region: "China",
						network_fingerprint: "synthetic-demo",
						status: "completed",
						error_code: null,
						error_message: null,
						prompt_run_at: clickhouseDate(runAt),
						created_at: clickhouseDate(runAt),
					});
					for (const [sourceIndex, source] of sourceResult.sources.entries()) {
						citationRows.push({
							id: randomUUID(),
							sample_id: sampleId,
							workspace_id: workspaceId,
							model_provider: provider,
							source_index: sourceIndex,
							title: source.title,
							cited_text: source.cited_text,
							url: source.url,
							domain: source.domain,
							source_kind: source.source_kind,
							support_level: "demo",
							created_at: clickhouseDate(runAt),
						});
					}
					analysisRows.push({
						id: randomUUID(),
						sample_id: sampleId,
						prompt_id: prompt.monitorPromptId,
						workspace_id: workspaceId,
						user_id: owner.id,
						model_provider: provider,
						analysis_json: JSON.stringify(analysis),
						analysis_model: "synthetic-demo",
						template_version: "anspectra-six-layer-analysis-v1",
						raw_output: JSON.stringify({ dataOrigin: "synthetic_demo" }),
						status: "completed",
						error: "",
						attempt_count: 1,
						prompt_run_at: clickhouseDate(runAt),
						created_at: clickhouseDate(runAt),
					});
				}
			}
		}
	});

	await clickhouse.insert({
		table: "analytics.answer_samples_v2",
		values: answerRows,
		format: "JSONEachRow",
	});
	if (citationRows.length) {
		await clickhouse.insert({
			table: "analytics.sample_citations",
			values: citationRows,
			format: "JSONEachRow",
		});
	}
	await clickhouse.insert({
		table: "analytics.sample_analysis_v2",
		values: analysisRows,
		format: "JSONEachRow",
	});

	const [counts] = await sql`
		SELECT
			(SELECT count(*)::int FROM collection_runs WHERE series_id = ${seriesId}) AS runs,
			(SELECT count(*)::int FROM sample_checkpoints sc JOIN collection_runs cr ON cr.id = sc.run_id WHERE cr.series_id = ${seriesId}) AS checkpoints
	`;
	if (
		counts.runs !== 2 ||
		counts.checkpoints !== 144 ||
		answerRows.length !== 144
	) {
		throw new Error(`Demo verification failed: ${JSON.stringify(counts)}`);
	}
	console.log(
		JSON.stringify(
			{
				ok: true,
				workspaceId,
				seriesId,
				runs: counts.runs,
				checkpoints: counts.checkpoints,
				answers: answerRows.length,
				analyses: analysisRows.length,
				citations: citationRows.length,
			},
			null,
			2,
		),
	);
} finally {
	await sql.end({ timeout: 5 });
	await clickhouse.close();
}
