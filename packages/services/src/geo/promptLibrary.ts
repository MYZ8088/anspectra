import { createHash } from "node:crypto";
import { clickhouse, db, schema } from "@aloom/db";
import { NotFoundError, ValidationError } from "@aloom/errors";
import type {
	DetectionDimensionFilter,
	DetectionRunPlan,
	DetectionSuiteKey,
	GeoDecisionStage,
	GeoIntent,
	ProfileCompleteness,
	PromptOrigin,
	PromptRelevance,
	SamplingDepth,
} from "@aloom/types";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "../env.js";
import { aihubmix } from "../llm/index.js";
import {
	createOpenAiCompatibleGenerator,
	generateStructuredOutput,
} from "../llm/structuredOutput.js";
import {
	type BrandPromptProfile,
	GEO_DECISION_STAGES,
	GEO_PROMPT_GROUPS,
	type GeneratedMonitorPrompt,
	type GeoDetectionTier,
	estimateSamplingMinimumDays,
	getDetectionPresetPack,
	listDetectionSuites,
	planDetectionPrompts,
	samplingDepthRoundCount,
} from "./promptEngine.js";

export type CustomPromptInput = {
	prompt: string;
	locale?: string;
	intent?: GeoIntent;
	decisionStage?: GeoDecisionStage;
	brandExposure?: "blind" | "aided";
	targetProduct?: string | null;
	targetCompetitor?: string | null;
	targetAudience?: string | null;
	targetRegion?: string | null;
	tags?: string[];
};

const ALOOM_PACK_KEY = "aloom-geo-detection-v1";
const ALOOM_PACK_VERSION = "1.1.0";
const DEFAULT_PROVIDERS = ["doubao", "deepseek", "hunyuan", "qwen"];

function normalizeLocale(locale?: string | null): "zh-CN" | "en-US" {
	return locale?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function normalizedText(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function promptHash(args: {
	prompt: string;
	locale: string;
	version: number | string;
	dimensions?: Record<string, unknown>;
}): string {
	return createHash("sha256")
		.update(
			[
				args.locale,
				String(args.version),
				normalizedText(args.prompt),
				JSON.stringify(args.dimensions ?? {}),
			].join("\n"),
		)
		.digest("hex");
}

function templateId(args: {
	packKey: string;
	version: string;
	locale: string;
	key: string;
}): string {
	return `${args.packKey}:${args.version}:${args.locale}:${args.key}`;
}

function classifyIntent(prompt: string): GeoIntent {
	const value = prompt.toLowerCase();
	if (/价格|预算|成本|贵不贵|price|pricing|cost|budget/.test(value))
		return "price";
	if (
		/风险|缺点|限制|合规|安全|risk|limitation|security|compliance/.test(value)
	)
		return "risk";
	if (/替代|alternative|instead of|replace/.test(value)) return "alternative";
	if (/比较|对比|区别| versus | vs\.? |compare|difference/.test(value))
		return "comparison";
	if (/推荐|哪些.*适合|最好|recommend|best|shortlist/.test(value))
		return "recommendation";
	if (/购买|采购|试用|演示|续费|buy|purchase|trial|demo|renew/.test(value))
		return "transaction";
	if (/是否可信|正规吗|是什么品牌|credible|legitimate|verify/.test(value))
		return "brand_validation";
	if (/场景|团队|行业|适合谁|scenario|team|industry|use case/.test(value))
		return "scenario";
	return "information";
}

function inferExposure(prompt: string, brandName?: string | null) {
	return brandName && prompt.toLowerCase().includes(brandName.toLowerCase())
		? ("aided" as const)
		: ("blind" as const);
}

function classifyStage(prompt: string): GeoDecisionStage {
	const value = prompt.toLowerCase();
	if (
		/复盘|续费|效果|结果|review|renew|outcome|after implementation/.test(value)
	)
		return "review";
	if (/实施|部署|集成|迁移|落地|implement|deploy|integrat|migrat/.test(value))
		return "implementation";
	if (/采购|购买|合同|试用|演示|buy|purchase|contract|trial|demo/.test(value))
		return "purchase";
	if (/评估|对比|风险|价格|evaluate|compare|risk|price/.test(value))
		return "evaluation";
	if (/筛选|候选|短名单|shortlist|screen|select/.test(value))
		return "screening";
	return "awareness";
}

const ClassificationResponseSchema = z.object({
	items: z.array(
		z.object({
			index: z.coerce.number().int().min(0),
			intent: z.enum(GEO_PROMPT_GROUPS),
			decisionStage: z.enum(GEO_DECISION_STAGES),
			locale: z.enum(["zh-CN", "en-US"]),
			brandExposure: z.enum(["blind", "aided"]),
			confidence: z.coerce.number().min(0).max(100),
		}),
	),
});

export async function classifyCustomPromptDimensions(args: {
	workspaceId: string;
	prompts: string[];
}) {
	const profile = await loadProfile(args.workspaceId);
	const prompts = args.prompts
		.map(normalizedText)
		.filter(Boolean)
		.slice(0, 100);
	if (prompts.length === 0) throw new ValidationError("No prompts to classify");
	const fallback = () => ({
		mode: "deterministic_fallback" as const,
		items: prompts.map((prompt, index) => ({
			index,
			intent: classifyIntent(prompt),
			decisionStage: classifyStage(prompt),
			locale: normalizeLocale(
				/\p{Script=Han}/u.test(prompt) ? "zh-CN" : "en-US",
			),
			brandExposure: inferExposure(prompt, profile.brandName),
			confidence: 55,
		})),
	});
	try {
		const models = [
			env.AIHUBMIX_ANALYSIS_MODEL,
			env.AIHUBMIX_ANALYSIS_FALLBACK_MODEL,
		]
			.map((model) => model.trim())
			.filter(
				(model, index, values) => model && values.indexOf(model) === index,
			);
		const generators = models.map((model) =>
			createOpenAiCompatibleGenerator({
				client: aihubmix,
				provider: "AIHubMix",
				model,
				maxTokens: 4096,
				timeoutMs: 120_000,
			}),
		);
		const execution = await generateStructuredOutput({
			schema: ClassificationResponseSchema,
			schemaName: "geo_prompt_classification",
			systemPrompt:
				"Classify GEO prompts using the required schema. intent must be information, recommendation, comparison, transaction, risk, price, alternative, scenario, or brand_validation. decisionStage must be awareness, screening, evaluation, purchase, implementation, or review. brandExposure is aided only when the target brand is explicit in the prompt. Keep every supplied index exactly once and do not create prompts.",
			userPrompt: JSON.stringify({
				brand: profile.brandName,
				aliases: profile.aliases,
				prompts: prompts.map((prompt, index) => ({ index, prompt })),
			}),
			generators,
			repairGenerator: generators.at(-1),
			repairInstructions:
				"Preserve every original item index. Do not add, remove, or rewrite prompts.",
			errorMessage: "Prompt classifier returned invalid structured JSON",
		});
		const parsed = execution.data;
		const byIndex = new Map(parsed.items.map((item) => [item.index, item]));
		if (prompts.some((_prompt, index) => !byIndex.has(index)))
			return fallback();
		const items = [];
		for (let index = 0; index < prompts.length; index += 1) {
			const item = byIndex.get(index);
			if (!item) return fallback();
			items.push(item);
		}
		return {
			mode: "aihubmix" as const,
			items,
		};
	} catch {
		return fallback();
	}
}

async function loadProfile(workspaceId: string) {
	const profile = await db.query.brandProfiles.findFirst({
		where: eq(schema.brandProfiles.workspaceId, workspaceId),
	});
	if (!profile) throw new ValidationError("Complete the brand profile first");
	return profile;
}

export function getProfileCompleteness(
	profile: Awaited<ReturnType<typeof loadProfile>>,
): ProfileCompleteness {
	const missing: ProfileCompleteness["missing"] = [];
	if (!profile.brandName.trim()) missing.push("brandName");
	if (!profile.officialDomain.trim()) missing.push("officialDomain");
	if (!profile.category?.trim()) missing.push("category");
	if (!(profile.products ?? []).some((value) => value.trim()))
		missing.push("products");
	if (!(profile.audiences ?? []).some((value) => value.trim()))
		missing.push("audiences");
	if (!(profile.regions ?? []).some((value) => value.trim()))
		missing.push("regions");
	if (!(profile.competitors ?? []).some((value) => value.trim()))
		missing.push("competitors");
	return {
		complete: missing.length === 0,
		confirmed: profile.confirmationStatus === "confirmed",
		missing,
	};
}

export function evaluatePromptRelevance(args: {
	prompt: string;
	brandExposure: "blind" | "aided";
	profile: Awaited<ReturnType<typeof loadProfile>>;
}): PromptRelevance {
	const normalized = normalizedText(args.prompt).toLocaleLowerCase();
	const targetEntities = [
		args.profile.brandName,
		...(args.profile.aliases ?? []),
		...(args.profile.products ?? []),
	].filter(Boolean);
	const contextEntities = [
		args.profile.category,
		args.profile.industry,
		...(args.profile.audiences ?? []),
		...(args.profile.regions ?? []),
		...(args.profile.competitors ?? []),
	].filter((value): value is string => Boolean(value));
	const matchedTarget = targetEntities.filter((entity) =>
		normalized.includes(entity.toLocaleLowerCase()),
	);
	const matchedContext = contextEntities.filter((entity) =>
		normalized.includes(entity.toLocaleLowerCase()),
	);
	const matchedEntities = [...new Set([...matchedTarget, ...matchedContext])];
	if (args.brandExposure === "aided") {
		return matchedTarget.length > 0
			? { status: "relevant", matchedEntities, reasons: [] }
			: {
					status: "unrelated",
					matchedEntities,
					reasons: [
						"An aided prompt must mention the brand, an alias, or a tracked product.",
					],
				};
	}
	return matchedContext.length > 0
		? { status: "relevant", matchedEntities, reasons: [] }
		: {
				status: "needs_confirmation",
				matchedEntities,
				reasons: [
					"This blind prompt does not match the confirmed category, audience, region, scenario, or competitor.",
				],
			};
}

function toBrandPromptProfile(
	profile: Awaited<ReturnType<typeof loadProfile>>,
	locale: string,
): BrandPromptProfile {
	return {
		brandName: profile.brandName,
		aliases: profile.aliases ?? [],
		products: profile.products ?? [],
		category: profile.category,
		market: profile.market,
		industry: profile.industry ?? profile.category,
		audiences: profile.audiences ?? [],
		competitors: profile.competitors ?? [],
		regions: profile.regions ?? [],
		locale,
		budget: profile.budget,
		teamSize: profile.teamSize,
		implementationPeriod: profile.implementationPeriod,
		evidenceRequirement: profile.evidenceRequirement,
	};
}

export async function syncSystemPromptTemplates(locales = ["zh-CN", "en-US"]) {
	const values = [...new Set(locales.map(normalizeLocale))].flatMap(
		(locale) => {
			const pack = getDetectionPresetPack(locale);
			return pack.entries.map((entry) => ({
				id: templateId({
					packKey: pack.packKey,
					version: pack.version,
					locale: pack.locale,
					key: entry.key,
				}),
				packKey: pack.packKey,
				version: pack.version,
				sourceCommit: pack.sourceCommit,
				license: pack.license,
				locale: pack.locale,
				intent: entry.intent,
				decisionStage: entry.stage,
				brandExposure: entry.brandExposure,
				promptTemplate: entry.prompt,
				metadata: { key: entry.key },
				active: true,
				updatedAt: new Date(),
			}));
		},
	);
	if (values.length === 0) return [];
	for (const value of values) {
		await db
			.insert(schema.promptTemplates)
			.values(value)
			.onConflictDoUpdate({
				target: schema.promptTemplates.id,
				set: {
					promptTemplate: value.promptTemplate,
					metadata: value.metadata,
					active: true,
					updatedAt: value.updatedAt,
				},
			});
	}
	return values;
}

export async function previewDetection(args: {
	workspaceId: string;
	suiteKey: Exclude<DetectionSuiteKey, "filtered">;
	samplingDepth: SamplingDepth;
	locales?: string[];
	filters?: Omit<DetectionDimensionFilter, "locales">;
	providerCount?: number;
}) {
	const profile = await loadProfile(args.workspaceId);
	const locales = [
		...new Set(
			(args.locales?.length
				? args.locales
				: (profile.locales ?? ["zh-CN"])
			).map(normalizeLocale),
		),
	];
	const plans = locales.map((locale) =>
		planDetectionPrompts(toBrandPromptProfile(profile, locale), {
			suiteKey: args.suiteKey,
			samplingDepth: args.samplingDepth,
			filters: args.filters,
		}),
	);
	const promptCount = plans.reduce(
		(total, plan) => total + plan.prompts.length,
		0,
	);
	const roundCount = samplingDepthRoundCount(args.samplingDepth);
	const providerCount = args.providerCount ?? DEFAULT_PROVIDERS.length;
	const profileCompleteness = getProfileCompleteness(profile);
	return {
		packKey: ALOOM_PACK_KEY,
		packVersion: ALOOM_PACK_VERSION,
		suiteKey: plans.some((plan) => plan.manifest.isFiltered)
			? "filtered"
			: args.suiteKey,
		requestedSuiteKey: args.suiteKey,
		samplingDepth: args.samplingDepth,
		filters: args.filters ?? {},
		locales,
		promptCount,
		roundCount,
		providerCount,
		plannedSamples: promptCount * roundCount * providerCount,
		estimatedMinimumDays: estimateSamplingMinimumDays(
			promptCount,
			args.samplingDepth,
		),
		complete: plans.every((plan) => plan.manifest.complete),
		profileCompleteness,
		suites: listDetectionSuites(),
		manifests: plans.map((plan) => plan.manifest),
		prompts: plans.flatMap((plan) => plan.prompts),
	};
}

export async function previewPresetPack(args: {
	workspaceId: string;
	tier: GeoDetectionTier;
	locales?: string[];
	providerCount?: number;
}) {
	const samplingDepth: SamplingDepth =
		args.tier === "quick"
			? "single"
			: args.tier === "standard"
				? "reliable"
				: "stability";
	return previewDetection({
		workspaceId: args.workspaceId,
		suiteKey: args.tier === "quick" ? "quick_scan" : "full_matrix",
		samplingDepth,
		locales: args.locales,
		providerCount: args.providerCount,
	}).then((preview) => ({ ...preview, tier: args.tier }));
}

async function upsertGeneratedWorkspacePrompts(args: {
	workspaceId: string;
	prompts: GeneratedMonitorPrompt[];
	profileVersion: number;
}) {
	const values = args.prompts.map((prompt) => ({
		workspaceId: args.workspaceId,
		templateId:
			prompt.origin === "system_preset"
				? `${prompt.templateKey.split(":")[0]}:${
						prompt.templateVersion
					}:${prompt.locale}:${prompt.templateKey.split(":").at(-1)}`
				: null,
		origin: prompt.origin,
		prompt: prompt.prompt,
		promptHash: prompt.promptHash,
		locale: prompt.locale,
		intent: prompt.promptGroup,
		decisionStage: prompt.decisionStage,
		brandExposure: prompt.brandExposure,
		dimensions: prompt.dimensions,
		rewrites: prompt.rewrites,
		version: 1,
		importSource: "preset",
		profileVersion: args.profileVersion,
		relevance: {
			status: "relevant",
			matchedEntities: [],
			reasons: [],
		},
		locked: true,
		active: true,
		updatedAt: new Date(),
	}));
	if (values.length > 0) {
		await db
			.insert(schema.workspacePrompts)
			.values(values)
			.onConflictDoNothing();
	}
	return db.query.workspacePrompts.findMany({
		where: and(
			eq(schema.workspacePrompts.workspaceId, args.workspaceId),
			inArray(
				schema.workspacePrompts.promptHash,
				args.prompts.map((prompt) => prompt.promptHash),
			),
			inArray(schema.workspacePrompts.origin, [
				"system_preset",
				"generated_expansion",
			]),
		),
	});
}

export async function createDetectionSet(args: {
	workspaceId: string;
	suiteKey: Exclude<DetectionSuiteKey, "filtered">;
	samplingDepth: SamplingDepth;
	runPlan?: DetectionRunPlan;
	locales?: string[];
	filters?: Omit<DetectionDimensionFilter, "locales">;
	name?: string;
}) {
	const profile = await loadProfile(args.workspaceId);
	const preview = await previewDetection(args);
	if (!preview.profileCompleteness.complete) {
		throw new ValidationError(
			`Complete the brand profile before creating a baseline: ${preview.profileCompleteness.missing.join(", ")}`,
		);
	}
	if (!preview.profileCompleteness.confirmed) {
		throw new ValidationError(
			"Confirm the scanned brand profile before creating a formal baseline",
		);
	}
	if (!preview.complete) {
		throw new ValidationError("The preset pack has unresolved coverage gaps");
	}
	await syncSystemPromptTemplates(preview.locales);
	const generated = preview.prompts;
	const generatedRows = await upsertGeneratedWorkspacePrompts({
		workspaceId: args.workspaceId,
		prompts: generated,
		profileVersion: profile.version,
	});
	const generatedByKey = new Map(
		generatedRows.map((row) => [`${row.origin}:${row.promptHash}`, row]),
	);
	const orderedGenerated = generated.flatMap((prompt) => {
		const row = generatedByKey.get(`${prompt.origin}:${prompt.promptHash}`);
		return row ? [row] : [];
	});
	if (orderedGenerated.length !== generated.length) {
		throw new ValidationError("Not all generated prompts were persisted");
	}
	const allRows = orderedGenerated;
	const manifest = {
		packKey: preview.packKey,
		packVersion: preview.packVersion,
		sourceCommit: getDetectionPresetPack(preview.locales[0]).sourceCommit,
		locales: preview.locales,
		suiteKey: preview.suiteKey,
		requestedSuiteKey: preview.requestedSuiteKey,
		samplingDepth: preview.samplingDepth,
		runPlan: args.runPlan ?? null,
		filters: preview.filters,
		profileVersion: profile.version,
		roundCount: args.runPlan?.totalRuns ?? preview.roundCount,
		coreAndExpansionCount: generated.length,
		customPromptCount: 0,
		expectedPromptHashes: allRows.map((row) => row.promptHash),
		coverage: preview.manifests,
		completePreset: true,
	};
	const legacyTier: GeoDetectionTier =
		preview.samplingDepth === "single"
			? "quick"
			: preview.samplingDepth === "reliable"
				? "standard"
				: "deep";
	return db.transaction(async (tx) => {
		const [promptSet] = await tx
			.insert(schema.promptSets)
			.values({
				workspaceId: args.workspaceId,
				name:
					args.name ??
					`${profile.brandName} ${
						preview.suites.find(
							(suite) => suite.key === preview.requestedSuiteKey,
						)?.label ?? "GEO Detection"
					}`,
				tier: legacyTier,
				status: "active",
				purpose: "baseline",
				packKey: preview.packKey,
				templateVersion: preview.packVersion,
				manifest,
			})
			.returning();
		if (!promptSet) throw new Error("Failed to create the prompt set");
		await tx.insert(schema.promptSetItems).values(
			allRows.map((row, position) => ({
				promptSetId: promptSet.id,
				workspacePromptId: row.id,
				position,
				enabled: true,
				role: row.brandExposure === "blind" ? "control" : "measurement",
			})),
		);
		const monitorRows = await tx
			.insert(schema.monitorPrompts)
			.values(
				allRows.map((row) => {
					const dimensions = row.dimensions ?? {};
					return {
						workspaceId: args.workspaceId,
						promptSetId: promptSet.id,
						workspacePromptId: row.id,
						prompt: row.prompt,
						promptGroup: row.intent,
						locale: row.locale,
						persona:
							typeof dimensions.targetAudience === "string"
								? dimensions.targetAudience
								: null,
						decisionStage: row.decisionStage,
						cohort: row.brandExposure === "blind" ? "control" : "treatment",
						origin: row.origin,
						templateKey:
							typeof dimensions.templateKey === "string"
								? dimensions.templateKey
								: null,
						templateVersion: preview.packVersion,
						promptHash: row.promptHash,
						brandExposure: row.brandExposure,
						dimensions,
						rewrites: row.rewrites,
						version: row.version,
						active: true,
					};
				}),
			)
			.returning();
		if (monitorRows.length !== allRows.length) {
			throw new Error("Prompt set checkpoint source is incomplete");
		}
		return { promptSet, prompts: monitorRows, manifest };
	});
}

export async function instantiatePresetPack(args: {
	workspaceId: string;
	tier: GeoDetectionTier;
	locales?: string[];
	name?: string;
	customPromptIds?: string[];
}) {
	if (args.customPromptIds?.length) {
		throw new ValidationError(
			"Custom prompts cannot be added to formal detection sets",
		);
	}
	return createDetectionSet({
		workspaceId: args.workspaceId,
		suiteKey: args.tier === "quick" ? "quick_scan" : "full_matrix",
		samplingDepth:
			args.tier === "quick"
				? "single"
				: args.tier === "standard"
					? "reliable"
					: "stability",
		locales: args.locales,
		name: args.name,
	});
}

export async function importCustomPrompts(args: {
	workspaceId: string;
	items: CustomPromptInput[];
	userId?: string;
	importSource?: "manual" | "csv";
}) {
	const profile = await loadProfile(args.workspaceId);
	const seen = new Set<string>();
	const values = args.items.flatMap((item, index) => {
		const prompt = normalizedText(item.prompt);
		if (!prompt) return [];
		const locale = normalizeLocale(item.locale ?? profile.locales?.[0]);
		const intent = item.intent ?? classifyIntent(prompt);
		const decisionStage = item.decisionStage ?? "evaluation";
		const brandExposure =
			item.brandExposure ?? inferExposure(prompt, profile.brandName);
		const dimensions = {
			templateKey: null,
			intent,
			decisionStage,
			locale,
			brandExposure,
			origin: "user_custom" as const,
			targetProduct: item.targetProduct ?? null,
			targetCompetitor: item.targetCompetitor ?? null,
			targetAudience: item.targetAudience ?? null,
			targetRegion: item.targetRegion ?? null,
			queryForm: "standalone" as const,
		};
		const relevance = evaluatePromptRelevance({
			prompt,
			brandExposure,
			profile,
		});
		const hash = promptHash({ prompt, locale, version: 1, dimensions });
		if (seen.has(hash)) return [];
		seen.add(hash);
		return [
			{
				workspaceId: args.workspaceId,
				origin: "user_custom" as const,
				prompt,
				promptHash: hash,
				locale,
				intent,
				decisionStage,
				brandExposure,
				dimensions,
				rewrites: {
					standaloneQuestion: prompt,
					retrievalQuery: prompt,
					evidenceQuery: `${profile.brandName} official evidence ${prompt}`,
					titleSeed: prompt.replace(/[？?。.]$/u, ""),
				},
				tags: [...new Set(item.tags ?? [])],
				version: 1,
				createdByUserId: args.userId ?? null,
				importSource: args.importSource ?? "manual",
				profileVersion: profile.version,
				relevance,
				locked: false,
				active: true,
			},
		];
	});
	if (values.length > 0) {
		await db
			.insert(schema.workspacePrompts)
			.values(values)
			.onConflictDoNothing();
	}
	return listWorkspacePromptLibrary(args.workspaceId);
}

type LegacyPromptRow = {
	id: string;
	user_id: string;
	workspace_id: string;
	prompt: string;
	created_at: string;
};

async function fetchLegacyClickHousePrompts(
	workspaceId: string,
): Promise<LegacyPromptRow[]> {
	const result = await clickhouse.query({
		query: `
			SELECT id, user_id, workspace_id, prompt, created_at
			FROM analytics.user_prompts
			WHERE workspace_id = {workspaceId:String}
		`,
		query_params: { workspaceId },
		format: "JSONEachRow",
	});
	return (await result.json()) as LegacyPromptRow[];
}

export async function migrateLegacyPrompts(workspaceId: string) {
	const archivedAt = new Date();
	const stalePresets = await db
		.update(schema.workspacePrompts)
		.set({
			active: false,
			locked: true,
			archivedAt,
			archivedReason:
				"Preset generated before brand-profile confirmation; excluded from formal baselines",
			updatedAt: archivedAt,
		})
		.where(
			and(
				eq(schema.workspacePrompts.workspaceId, workspaceId),
				inArray(schema.workspacePrompts.origin, [
					"system_preset",
					"yao_preset",
					"generated_expansion",
				]),
				isNull(schema.workspacePrompts.profileVersion),
				eq(schema.workspacePrompts.active, true),
			),
		)
		.returning({ id: schema.workspacePrompts.id });
	await db
		.update(schema.workspacePrompts)
		.set({
			active: false,
			locked: true,
			archivedAt,
			archivedReason: "Archived Aloom onboarding/test prompt",
			updatedAt: archivedAt,
		})
		.where(
			and(
				eq(schema.workspacePrompts.workspaceId, workspaceId),
				eq(schema.workspacePrompts.origin, "legacy"),
			),
		);

	const legacy = await fetchLegacyClickHousePrompts(workspaceId).catch(
		() => [],
	);
	if (legacy.length === 0)
		return {
			imported: 0,
			archived: stalePresets.length,
			total: stalePresets.length,
		};
	const existing = await db.query.workspacePrompts.findMany({
		where: eq(schema.workspacePrompts.workspaceId, workspaceId),
	});
	let imported = 0;
	let archived = 0;
	for (const legacyRow of legacy) {
		const candidate = existing.find(
			(row) =>
				row.id === legacyRow.id ||
				(row.origin === "user_custom" &&
					normalizedText(row.prompt) === normalizedText(legacyRow.prompt)),
		);
		if (candidate) {
			await db
				.update(schema.workspacePrompts)
				.set({
					origin: "legacy",
					active: false,
					locked: true,
					importSource: "legacy_clickhouse",
					legacySourceId: legacyRow.id,
					archivedAt,
					archivedReason:
						"Imported from analytics.user_prompts; excluded from formal GEO baselines",
					updatedAt: archivedAt,
				})
				.where(eq(schema.workspacePrompts.id, candidate.id));
			archived += 1;
			continue;
		}

		const prompt = normalizedText(legacyRow.prompt);
		const locale = normalizeLocale(
			/\p{Script=Han}/u.test(prompt) ? "zh-CN" : "en-US",
		);
		const intent = classifyIntent(prompt);
		const decisionStage = classifyStage(prompt);
		const brandExposure: "blind" | "aided" = "blind";
		const dimensions = {
			templateKey: null,
			intent,
			decisionStage,
			locale,
			brandExposure,
			origin: "legacy" as const,
			targetProduct: null,
			targetCompetitor: null,
			targetAudience: null,
			targetRegion: null,
			queryForm: "standalone" as const,
		};
		await db
			.insert(schema.workspacePrompts)
			.values({
				...(/^[0-9a-f-]{36}$/i.test(legacyRow.id) ? { id: legacyRow.id } : {}),
				workspaceId,
				origin: "legacy",
				prompt,
				promptHash: promptHash({ prompt, locale, version: 1, dimensions }),
				locale,
				intent,
				decisionStage,
				brandExposure,
				dimensions,
				rewrites: { standaloneQuestion: prompt },
				createdByUserId: null,
				importSource: "legacy_clickhouse",
				legacySourceId: legacyRow.id,
				relevance: {
					status: "needs_confirmation",
					matchedEntities: [],
					reasons: ["Legacy import is not part of the confirmed brand profile"],
				},
				locked: true,
				active: false,
				archivedAt,
				archivedReason:
					"Imported from analytics.user_prompts; excluded from formal GEO baselines",
			})
			.onConflictDoNothing();
		imported += 1;
	}
	return {
		imported,
		archived: archived + stalePresets.length,
		total: legacy.length + stalePresets.length,
	};
}

export async function listWorkspacePromptLibrary(workspaceId: string) {
	const profile = await db.query.brandProfiles.findFirst({
		where: eq(schema.brandProfiles.workspaceId, workspaceId),
	});
	if (profile) {
		const locales = [
			...new Set(
				(profile.locales?.length ? profile.locales : ["zh-CN"]).map(
					normalizeLocale,
				),
			),
		];
		await syncSystemPromptTemplates(locales);
	}
	return db.query.workspacePrompts.findMany({
		where: eq(schema.workspacePrompts.workspaceId, workspaceId),
		orderBy: [
			desc(schema.workspacePrompts.active),
			asc(schema.workspacePrompts.createdAt),
		],
	});
}

export async function listWorkspacePromptLibraryV2(workspaceId: string) {
	const profile = await db.query.brandProfiles.findFirst({
		where: eq(schema.brandProfiles.workspaceId, workspaceId),
	});
	const locales = profile?.locales?.length
		? [...new Set(profile.locales.map(normalizeLocale))]
		: ["zh-CN", "en-US"];
	await syncSystemPromptTemplates(locales);
	const [systemTemplates, rows] = await Promise.all([
		db.query.promptTemplates.findMany({
			where: and(
				eq(schema.promptTemplates.packKey, ALOOM_PACK_KEY),
				eq(schema.promptTemplates.version, ALOOM_PACK_VERSION),
				eq(schema.promptTemplates.active, true),
			),
			orderBy: [
				asc(schema.promptTemplates.locale),
				asc(schema.promptTemplates.intent),
				asc(schema.promptTemplates.decisionStage),
			],
		}),
		listWorkspacePromptLibrary(workspaceId),
	]);
	const isLegacyPreset = (row: (typeof rows)[number]) =>
		row.origin === "yao_preset" ||
		((row.origin === "system_preset" || row.origin === "generated_expansion") &&
			row.profileVersion == null);
	const workspacePrompts = rows.filter(
		(row) =>
			(row.origin === "system_preset" ||
				row.origin === "generated_expansion") &&
			!isLegacyPreset(row),
	);
	const customPrompts = rows.filter((row) => row.origin === "user_custom");
	const legacyPrompts = rows.filter(
		(row) => row.origin === "legacy" || isLegacyPreset(row),
	);
	return {
		systemTemplates,
		workspacePrompts,
		customPrompts,
		legacyPrompts,
		profileCompleteness: profile
			? getProfileCompleteness(profile)
			: {
					complete: false,
					confirmed: false,
					missing: [
						"brandName",
						"officialDomain",
						"category",
						"products",
						"audiences",
						"regions",
						"competitors",
					] satisfies ProfileCompleteness["missing"],
				},
		stats: {
			systemTemplates: systemTemplates.length,
			workspacePrompts: workspacePrompts.length,
			customPrompts: customPrompts.filter((row) => row.active).length,
			legacyPrompts: legacyPrompts.length,
		},
	};
}

export async function reviseCustomPrompt(args: {
	workspaceId: string;
	promptId: string;
	input: CustomPromptInput;
}) {
	const current = await db.query.workspacePrompts.findFirst({
		where: and(
			eq(schema.workspacePrompts.id, args.promptId),
			eq(schema.workspacePrompts.workspaceId, args.workspaceId),
		),
	});
	if (!current) throw new NotFoundError("Custom prompt not found");
	if (current.locked || current.origin !== "user_custom") {
		throw new ValidationError(
			"Preset prompts are read-only; duplicate one first",
		);
	}
	const profile = await loadProfile(args.workspaceId);
	const prompt = normalizedText(args.input.prompt);
	if (!prompt) throw new ValidationError("Prompt cannot be empty");
	const locale = normalizeLocale(args.input.locale ?? current.locale);
	const intent = args.input.intent ?? (current.intent as GeoIntent);
	const decisionStage =
		args.input.decisionStage ?? (current.decisionStage as GeoDecisionStage);
	const brandExposure =
		args.input.brandExposure ??
		(current.brandExposure as "blind" | "aided") ??
		inferExposure(prompt, profile.brandName);
	const version = current.version + 1;
	const relevance = evaluatePromptRelevance({
		prompt,
		brandExposure,
		profile,
	});
	const dimensions = {
		...current.dimensions,
		intent,
		decisionStage,
		locale,
		brandExposure,
		targetProduct:
			args.input.targetProduct === undefined
				? (current.dimensions?.targetProduct ?? null)
				: args.input.targetProduct,
		targetCompetitor:
			args.input.targetCompetitor === undefined
				? (current.dimensions?.targetCompetitor ?? null)
				: args.input.targetCompetitor,
		targetAudience:
			args.input.targetAudience === undefined
				? (current.dimensions?.targetAudience ?? null)
				: args.input.targetAudience,
		targetRegion:
			args.input.targetRegion === undefined
				? (current.dimensions?.targetRegion ?? null)
				: args.input.targetRegion,
	};
	const [next] = await db.transaction(async (tx) => {
		await tx
			.update(schema.workspacePrompts)
			.set({
				active: false,
				archivedAt: new Date(),
				archivedReason: "Superseded by a newer custom prompt version",
				updatedAt: new Date(),
			})
			.where(eq(schema.workspacePrompts.id, current.id));
		return tx
			.insert(schema.workspacePrompts)
			.values({
				workspaceId: args.workspaceId,
				origin: "user_custom",
				prompt,
				promptHash: promptHash({ prompt, locale, version, dimensions }),
				locale,
				intent,
				decisionStage,
				brandExposure,
				dimensions,
				rewrites: {
					standaloneQuestion: prompt,
					retrievalQuery: prompt,
					evidenceQuery: `${profile.brandName} official evidence ${prompt}`,
					titleSeed: prompt.replace(/[？?。.]$/u, ""),
				},
				tags: args.input.tags ?? current.tags,
				version,
				parentPromptId: current.id,
				createdByUserId: current.createdByUserId,
				importSource: current.importSource ?? "manual",
				profileVersion: profile.version,
				relevance,
				locked: false,
				active: true,
			})
			.returning();
	});
	return next;
}

export async function archiveWorkspacePrompt(args: {
	workspaceId: string;
	promptId: string;
}) {
	const [row] = await db
		.update(schema.workspacePrompts)
		.set({
			active: false,
			archivedAt: new Date(),
			archivedReason: "Archived by workspace user",
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(schema.workspacePrompts.id, args.promptId),
				eq(schema.workspacePrompts.workspaceId, args.workspaceId),
			),
		)
		.returning();
	if (!row) throw new NotFoundError("Prompt not found");
	return row;
}

export function getPromptLibraryTaxonomy() {
	return {
		intents: [...GEO_PROMPT_GROUPS],
		decisionStages: [...GEO_DECISION_STAGES],
		origins: [
			"system_preset",
			"user_custom",
			"generated_expansion",
			"legacy",
		] satisfies PromptOrigin[],
	};
}
