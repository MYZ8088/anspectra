import { createHash } from "node:crypto";
import type {
	DetectionDimensionFilter,
	DetectionSuiteKey,
	SamplingDepth,
} from "@anspectra/types";
import enPackJson from "./presets/anspectra-geo-detection-v1.2.en-US.json" with {
	type: "json",
};
import zhPackJson from "./presets/anspectra-geo-detection-v1.2.zh-CN.json" with {
	type: "json",
};

export const GEO_PROMPT_GROUPS = [
	"information",
	"recommendation",
	"comparison",
	"transaction",
	"risk",
	"price",
	"alternative",
	"scenario",
	"brand_validation",
] as const;

export const GEO_DECISION_STAGES = [
	"awareness",
	"screening",
	"evaluation",
	"purchase",
	"implementation",
	"review",
] as const;

export type GeoPromptGroup = (typeof GEO_PROMPT_GROUPS)[number];
export type GeoDecisionStage = (typeof GEO_DECISION_STAGES)[number];
export type GeoDetectionTier = "quick" | "standard" | "deep";
export type PromptOrigin =
	| "system_preset"
	| "user_custom"
	| "generated_expansion";
export type BrandExposure = "blind" | "aided";

export type BrandPromptProfile = {
	brandName: string;
	aliases?: string[];
	products?: string[];
	category?: string | null;
	market?: string | null;
	industry?: string | null;
	audiences?: string[];
	competitors?: string[];
	regions?: string[];
	locale?: string;
	budget?: string | null;
	teamSize?: string | null;
	implementationPeriod?: string | null;
	evidenceRequirement?: string | null;
};

export type PromptRewriteBundle = {
	standaloneQuestion: string;
	retrievalQuery: string;
	evidenceQuery: string;
	titleSeed: string;
};

export type PromptDimensions = {
	templateKey: string;
	intent: GeoPromptGroup;
	decisionStage: GeoDecisionStage;
	locale: string;
	brandExposure: BrandExposure;
	origin: PromptOrigin;
	targetProduct: string | null;
	targetCompetitor: string | null;
	targetAudience: string | null;
	targetRegion: string | null;
	queryForm: "standalone";
};

export type GeneratedMonitorPrompt = {
	prompt: string;
	promptGroup: GeoPromptGroup;
	locale: string;
	persona: string | null;
	decisionStage: GeoDecisionStage;
	cohort: "treatment" | "control";
	origin: PromptOrigin;
	templateKey: string;
	templateVersion: string;
	promptHash: string;
	brandExposure: BrandExposure;
	dimensions: PromptDimensions;
	rewrites: PromptRewriteBundle;
};

export type PresetEntry = {
	key: string;
	intent: GeoPromptGroup;
	stage: GeoDecisionStage;
	brandExposure: BrandExposure;
	prompt: string;
};

export type PresetPack = {
	packKey: string;
	version: string;
	locale: string;
	sourceCommit: string;
	license: string;
	entries: PresetEntry[];
};

export type PromptCoverageManifest = {
	packKey: string;
	packVersion: string;
	sourceCommit: string;
	tier: GeoDetectionTier;
	suiteKey: DetectionSuiteKey;
	samplingDepth: SamplingDepth;
	isFiltered: boolean;
	filters: DetectionDimensionFilter;
	locale: string;
	corePromptCount: number;
	expansionPromptCount: number;
	totalPromptCount: number;
	expectedPromptHashes: string[];
	complete: boolean;
	coverage: {
		intents: GeoPromptGroup[];
		stages: GeoDecisionStage[];
		products: string[];
		competitorsInComparison: string[];
		competitorsInAlternative: string[];
		audiences: string[];
		regions: string[];
	};
	missing: {
		productsInValidation: string[];
		productsInDecision: string[];
		competitorsInComparison: string[];
		competitorsInAlternative: string[];
		audiences: string[];
		regions: string[];
	};
};

export type MonitorPromptPlan = {
	prompts: GeneratedMonitorPrompt[];
	manifest: PromptCoverageManifest;
};

const REFERENCE_SOURCE_COMMIT = "136eb92c90946ea56ec63f912d5025bcbc884f39";

export const DETECTION_SUITES: Record<
	Exclude<DetectionSuiteKey, "filtered">,
	{
		label: string;
		description: string;
		intents: GeoPromptGroup[];
		stages: GeoDecisionStage[];
		corePromptCount: number;
	}
> = {
	quick_scan: {
		label: "Quick Scan",
		description:
			"A broad signal check across every intent at awareness and evaluation.",
		intents: [...GEO_PROMPT_GROUPS],
		stages: ["awareness", "evaluation"],
		corePromptCount: 18,
	},
	discovery: {
		label: "Discovery",
		description:
			"How buyers discover, shortlist, and contextualize products in the category.",
		intents: ["information", "recommendation", "scenario", "alternative"],
		stages: ["awareness", "screening", "evaluation"],
		corePromptCount: 12,
	},
	competitive_position: {
		label: "Competitive Position",
		description:
			"Recommendation, comparison, and alternative positioning near a buying decision.",
		intents: ["recommendation", "comparison", "alternative"],
		stages: ["screening", "evaluation", "purchase"],
		corePromptCount: 9,
	},
	trust_risk: {
		label: "Trust & Risk",
		description:
			"Risk, pricing, and brand verification signals used during evaluation.",
		intents: ["risk", "price", "brand_validation"],
		stages: ["screening", "evaluation", "purchase"],
		corePromptCount: 9,
	},
	buyer_journey: {
		label: "Buyer Journey",
		description: "All intents from first awareness through purchase.",
		intents: [...GEO_PROMPT_GROUPS],
		stages: ["awareness", "screening", "evaluation", "purchase"],
		corePromptCount: 36,
	},
	full_matrix: {
		label: "Full Matrix",
		description: "The complete nine-intent by six-stage detection matrix.",
		intents: [...GEO_PROMPT_GROUPS],
		stages: [...GEO_DECISION_STAGES],
		corePromptCount: 54,
	},
};

export function samplingDepthToLegacyTier(
	depth: SamplingDepth,
): GeoDetectionTier {
	return depth === "single"
		? "quick"
		: depth === "reliable"
			? "standard"
			: "deep";
}

export function samplingDepthRoundCount(depth: SamplingDepth): number {
	return depth === "single" ? 1 : depth === "reliable" ? 2 : 3;
}

export function estimateSamplingMinimumDays(
	promptCount: number,
	depth: SamplingDepth,
	dailyProviderLimit = 30,
): number {
	const roundCount = samplingDepthRoundCount(depth);
	const depthMinimumDays = depth === "stability" ? 3 : 1;
	return Math.max(
		depthMinimumDays,
		Math.ceil((promptCount * roundCount) / dailyProviderLimit),
	);
}

function asPresetPack(value: unknown): PresetPack {
	const pack = value as PresetPack;
	if (
		!pack ||
		pack.entries?.length !== 54 ||
		pack.sourceCommit !== REFERENCE_SOURCE_COMMIT
	) {
		throw new Error(
			"Anspectra GEO Detection Pack is incomplete or has an unexpected source",
		);
	}
	const cells = new Set(
		pack.entries.map((entry) => `${entry.intent}:${entry.stage}`),
	);
	if (cells.size !== GEO_PROMPT_GROUPS.length * GEO_DECISION_STAGES.length) {
		throw new Error(
			"Anspectra GEO Detection Pack must contain every intent-stage cell",
		);
	}
	return pack;
}

const zhPack = asPresetPack(zhPackJson);
const enPack = asPresetPack(enPackJson);

export function getDetectionPresetPack(locale = "zh-CN"): PresetPack {
	return locale.toLowerCase().startsWith("zh") ? zhPack : enPack;
}

function unique(values: Array<string | null | undefined>): string[] {
	return [
		...new Set(
			values.map((value) => value?.trim()).filter(Boolean) as string[],
		),
	];
}

function normalizedEntity(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function productTemplateValue(args: {
	brand: string;
	product: string;
	locale: string;
}): string {
	return normalizedEntity(args.brand) === normalizedEntity(args.product)
		? args.locale.toLowerCase().startsWith("zh")
			? "产品"
			: "product"
		: args.product;
}

function containsHanCharacters(value: string): boolean {
	return /\p{Script=Han}/u.test(value);
}

function localizedEvidenceRequirement(
	value: string | null | undefined,
	locale: string,
): string {
	const zh = locale.toLowerCase().startsWith("zh");
	const normalized = value?.trim();
	if (normalized && containsHanCharacters(normalized) === zh) return normalized;
	return zh
		? "引用注明日期且可核验的公开来源，并标记无法确认的信息"
		: "Cite dated, verifiable public sources and mark anything that cannot be confirmed.";
}

function withResponseLanguageInstruction(
	prompt: string,
	locale: string,
): string {
	const instruction = locale.toLowerCase().startsWith("zh")
		? "请使用简体中文完整回答；产品名和专有名词可保留原文。"
		: "Answer fully in English; product names and proper nouns may remain in their original form.";
	return `${prompt.trim()}\n\n${instruction}`;
}

function localizedDefaults(profile: BrandPromptProfile, locale: string) {
	const zh = locale.toLowerCase().startsWith("zh");
	return {
		brand: profile.brandName,
		category:
			profile.category || (zh ? "未填写品类" : "an unspecified category"),
		product: profile.products?.[0] || profile.brandName,
		competitor:
			profile.competitors?.[0] ||
			(zh ? "未填写竞品" : "an unspecified competitor"),
		audience:
			profile.audiences?.[0] ||
			(zh ? "未填写目标受众" : "an unspecified audience"),
		region:
			profile.regions?.[0] ||
			profile.market ||
			(zh ? "未填写地区" : "an unspecified region"),
		market:
			profile.market ||
			profile.regions?.[0] ||
			(zh ? "未填写市场" : "an unspecified market"),
		industry:
			profile.industry ||
			profile.category ||
			(zh ? "未填写行业" : "an unspecified industry"),
		budget: profile.budget || (zh ? "未限定预算" : "no fixed budget"),
		teamSize:
			profile.teamSize || (zh ? "未限定团队规模" : "no fixed team size"),
		implementationPeriod:
			profile.implementationPeriod ||
			(zh ? "未限定实施周期" : "no fixed implementation period"),
		evidenceRequirement: localizedEvidenceRequirement(
			profile.evidenceRequirement,
			locale,
		),
	};
}

function renderTemplate(
	template: string,
	values: Record<string, string>,
): string {
	const rendered = template.replace(
		/\{([a-zA-Z]+)\}/g,
		(_, key: string) => values[key] ?? `{${key}}`,
	);
	if (/\{[a-zA-Z]+\}/.test(rendered)) {
		throw new Error(
			`Prompt template contains unresolved variables: ${rendered}`,
		);
	}
	return rendered;
}

function hashPrompt(
	locale: string,
	templateVersion: string,
	prompt: string,
): string {
	return createHash("sha256")
		.update(
			`${locale}\n${templateVersion}\n${prompt.trim().replace(/\s+/g, " ")}`,
		)
		.digest("hex");
}

function buildRewrites(args: {
	prompt: string;
	profile: BrandPromptProfile;
	intent: GeoPromptGroup;
	stage: GeoDecisionStage;
	product: string;
	competitor: string;
	locale: string;
}): PromptRewriteBundle {
	const zh = args.locale.toLowerCase().startsWith("zh");
	const compactIntent = args.intent.replace("_", " ");
	return {
		standaloneQuestion: args.prompt,
		retrievalQuery: zh
			? `${args.profile.brandName} ${args.product} ${compactIntent} ${args.stage}`
			: `${args.profile.brandName} ${args.product} ${compactIntent} ${args.stage}`,
		evidenceQuery: zh
			? `${args.profile.brandName} ${args.product} 官方资料 价格 安全 合规 案例 ${args.competitor}`
			: `${args.profile.brandName} ${args.product} official documentation pricing security compliance case study ${args.competitor}`,
		titleSeed: args.prompt.replace(/[？?。.]$/u, ""),
	};
}

function createPrompt(args: {
	entry: PresetEntry;
	profile: BrandPromptProfile;
	pack: PresetPack;
	origin: PromptOrigin;
	product: string;
	competitor: string;
	audience: string;
	region: string;
	promptOverride?: string;
}): GeneratedMonitorPrompt {
	const defaults = localizedDefaults(args.profile, args.pack.locale);
	const values = {
		...defaults,
		product: productTemplateValue({
			brand: args.profile.brandName,
			product: args.product,
			locale: args.pack.locale,
		}),
		competitor: args.competitor,
		audience: args.audience,
		region: args.region,
	};
	const prompt = withResponseLanguageInstruction(
		args.promptOverride ?? renderTemplate(args.entry.prompt, values),
		args.pack.locale,
	);
	const templateKey = `${args.pack.packKey}:${args.entry.key}${
		args.origin === "generated_expansion" ? ":expansion" : ""
	}`;
	const dimensions: PromptDimensions = {
		templateKey,
		intent: args.entry.intent,
		decisionStage: args.entry.stage,
		locale: args.pack.locale,
		brandExposure: args.entry.brandExposure,
		origin: args.origin,
		targetProduct: args.product || null,
		targetCompetitor: args.competitor || null,
		targetAudience: args.audience || null,
		targetRegion: args.region || null,
		queryForm: "standalone",
	};
	return {
		prompt,
		promptGroup: args.entry.intent,
		locale: args.pack.locale,
		persona: args.audience || null,
		decisionStage: args.entry.stage,
		cohort: args.entry.brandExposure === "blind" ? "control" : "treatment",
		origin: args.origin,
		templateKey,
		templateVersion: args.pack.version,
		promptHash: hashPrompt(args.pack.locale, args.pack.version, prompt),
		brandExposure: args.entry.brandExposure,
		dimensions,
		rewrites: buildRewrites({
			prompt,
			profile: args.profile,
			intent: args.entry.intent,
			stage: args.entry.stage,
			product: args.product,
			competitor: args.competitor,
			locale: args.pack.locale,
		}),
	};
}

function missingCoverage(
	prompts: GeneratedMonitorPrompt[],
	profile: BrandPromptProfile,
) {
	const products = unique(profile.products ?? []);
	const competitors = unique(profile.competitors ?? []);
	const audiences = unique(profile.audiences ?? []);
	const regions = unique(profile.regions ?? []);
	const hasProduct = (product: string, intents: GeoPromptGroup[]) =>
		prompts.some(
			(prompt) =>
				prompt.dimensions.targetProduct === product &&
				intents.includes(prompt.promptGroup),
		);
	const hasCompetitor = (competitor: string, intent: GeoPromptGroup) =>
		prompts.some(
			(prompt) =>
				prompt.dimensions.targetCompetitor === competitor &&
				prompt.promptGroup === intent,
		);
	return {
		productsInValidation: products.filter(
			(product) => !hasProduct(product, ["brand_validation"]),
		),
		productsInDecision: products.filter(
			(product) => !hasProduct(product, ["comparison", "price", "risk"]),
		),
		competitorsInComparison: competitors.filter(
			(competitor) => !hasCompetitor(competitor, "comparison"),
		),
		competitorsInAlternative: competitors.filter(
			(competitor) => !hasCompetitor(competitor, "alternative"),
		),
		audiences: audiences.filter(
			(audience) =>
				!prompts.some(
					(prompt) =>
						prompt.dimensions.targetAudience === audience &&
						["recommendation", "scenario"].includes(prompt.promptGroup),
				),
		),
		regions: regions.filter(
			(region) =>
				!prompts.some(
					(prompt) =>
						prompt.dimensions.targetRegion === region &&
						prompt.promptGroup === "scenario",
				),
		),
	};
}

function addExpansionPrompts(args: {
	prompts: GeneratedMonitorPrompt[];
	profile: BrandPromptProfile;
	pack: PresetPack;
}): GeneratedMonitorPrompt[] {
	const additions: GeneratedMonitorPrompt[] = [];
	const defaults = localizedDefaults(args.profile, args.pack.locale);
	const initialMissing = missingCoverage(args.prompts, args.profile);
	const entry = (
		intent: GeoPromptGroup,
		stage: GeoDecisionStage,
	): PresetEntry => {
		const found = args.pack.entries.find(
			(item) => item.intent === intent && item.stage === stage,
		);
		if (!found) throw new Error(`Missing preset entry ${intent}:${stage}`);
		return found;
	};
	const add = (options: {
		entry: PresetEntry;
		product?: string;
		competitor?: string;
		audience?: string;
		region?: string;
		prompt: string;
	}) => {
		additions.push(
			createPrompt({
				entry: options.entry,
				profile: args.profile,
				pack: args.pack,
				origin: "generated_expansion",
				product: options.product ?? defaults.product,
				competitor: options.competitor ?? defaults.competitor,
				audience: options.audience ?? defaults.audience,
				region: options.region ?? defaults.region,
				promptOverride: options.prompt,
			}),
		);
	};
	const zh = args.pack.locale.toLowerCase().startsWith("zh");
	for (const product of initialMissing.productsInValidation) {
		const displayProduct = productTemplateValue({
			brand: args.profile.brandName,
			product,
			locale: args.pack.locale,
		});
		add({
			entry: entry("brand_validation", "evaluation"),
			product,
			prompt: zh
				? `${args.profile.brandName}的${displayProduct}是什么，哪些能力、边界和公开来源可以验证？`
				: `What is ${args.profile.brandName}'s ${displayProduct}, and which capabilities, boundaries, and public sources can verify it?`,
		});
	}
	for (const product of initialMissing.productsInDecision) {
		const displayProduct = productTemplateValue({
			brand: args.profile.brandName,
			product,
			locale: args.pack.locale,
		});
		add({
			entry: entry("risk", "evaluation"),
			product,
			prompt: zh
				? `选择${args.profile.brandName}的${displayProduct}前，应该评估哪些价格、风险和实施成本？`
				: `Which pricing, risk, and implementation costs should a buyer assess before choosing ${args.profile.brandName}'s ${displayProduct}?`,
		});
	}
	for (const competitor of initialMissing.competitorsInComparison) {
		add({
			entry: entry("comparison", "evaluation"),
			competitor,
			prompt: zh
				? `${args.profile.brandName}和${competitor}分别适合什么场景？请公平比较功能、成本和限制。`
				: `Which scenarios fit ${args.profile.brandName} and ${competitor}? Compare their capabilities, costs, and limits fairly.`,
		});
	}
	for (const competitor of initialMissing.competitorsInAlternative) {
		add({
			entry: entry("alternative", "evaluation"),
			competitor,
			prompt: zh
				? `${competitor}有哪些替代方案，${args.profile.brandName}在什么情况下值得考虑？`
				: `What are the alternatives to ${competitor}, and when is ${args.profile.brandName} worth considering?`,
		});
	}
	for (const audience of initialMissing.audiences) {
		add({
			entry: entry("scenario", "screening"),
			audience,
			prompt: zh
				? `${audience}选择${defaults.category}时，应该重点考虑哪些需求、证据和限制？`
				: `Which needs, evidence, and constraints should ${audience} prioritize when choosing ${defaults.category}?`,
		});
	}
	for (const region of initialMissing.regions) {
		add({
			entry: entry("scenario", "evaluation"),
			region,
			prompt: zh
				? `${args.profile.brandName}是否适合${region}市场？请说明本地化条件、证据和限制。`
				: `Is ${args.profile.brandName} suitable for ${region}? Explain the localization conditions, evidence, and limitations.`,
		});
	}
	return additions;
}

function buildManifest(args: {
	prompts: GeneratedMonitorPrompt[];
	corePromptCount: number;
	profile: BrandPromptProfile;
	pack: PresetPack;
	tier: GeoDetectionTier;
	suiteKey: DetectionSuiteKey;
	samplingDepth: SamplingDepth;
	isFiltered: boolean;
	filters: DetectionDimensionFilter;
}): PromptCoverageManifest {
	const missing = missingCoverage(args.prompts, args.profile);
	const complete = Object.values(missing).every((items) => items.length === 0);
	return {
		packKey: args.pack.packKey,
		packVersion: args.pack.version,
		sourceCommit: args.pack.sourceCommit,
		tier: args.tier,
		suiteKey: args.suiteKey,
		samplingDepth: args.samplingDepth,
		isFiltered: args.isFiltered,
		filters: args.filters,
		locale: args.pack.locale,
		corePromptCount: args.corePromptCount,
		expansionPromptCount: args.prompts.length - args.corePromptCount,
		totalPromptCount: args.prompts.length,
		expectedPromptHashes: args.prompts.map((prompt) => prompt.promptHash),
		complete,
		coverage: {
			intents: unique(
				args.prompts.map((prompt) => prompt.promptGroup),
			) as GeoPromptGroup[],
			stages: unique(
				args.prompts.map((prompt) => prompt.decisionStage),
			) as GeoDecisionStage[],
			products: unique(
				args.prompts.map((prompt) => prompt.dimensions.targetProduct),
			),
			competitorsInComparison: unique(
				args.prompts
					.filter((prompt) => prompt.promptGroup === "comparison")
					.map((prompt) => prompt.dimensions.targetCompetitor),
			),
			competitorsInAlternative: unique(
				args.prompts
					.filter((prompt) => prompt.promptGroup === "alternative")
					.map((prompt) => prompt.dimensions.targetCompetitor),
			),
			audiences: unique(
				args.prompts.map((prompt) => prompt.dimensions.targetAudience),
			),
			regions: unique(
				args.prompts.map((prompt) => prompt.dimensions.targetRegion),
			),
		},
		missing,
	};
}

function checkedFilterValues(
	label: string,
	selected: string[] | undefined,
	available: string[],
): string[] {
	if (!selected?.length) return available;
	const normalizedAvailable = new Map(
		available.map((value) => [normalizedEntity(value), value]),
	);
	const resolved = unique(
		selected.map((value) => normalizedAvailable.get(normalizedEntity(value))),
	);
	if (resolved.length !== unique(selected).length) {
		throw new Error(
			`${label} filters must reference confirmed brand profile values`,
		);
	}
	return resolved;
}

function sameValues(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length && left.every((value) => right.includes(value))
	);
}

export function listDetectionSuites() {
	return Object.entries(DETECTION_SUITES).map(([key, suite]) => ({
		key: key as Exclude<DetectionSuiteKey, "filtered">,
		...suite,
	}));
}

export function getDetectionPromptCatalog() {
	return {
		name: "Anspectra GEO Detection Pack",
		version: "1.2.0",
		suites: listDetectionSuites(),
		locales: [zhPack, enPack].map((pack) => ({
			locale: pack.locale,
			entries: pack.entries,
		})),
	};
}

export function planDetectionPrompts(
	profile: BrandPromptProfile,
	options: {
		suiteKey: Exclude<DetectionSuiteKey, "filtered">;
		samplingDepth: SamplingDepth;
		filters?: DetectionDimensionFilter;
	},
): MonitorPromptPlan {
	const pack = getDetectionPresetPack(profile.locale);
	const suite = DETECTION_SUITES[options.suiteKey];
	if (!suite) throw new Error(`Unknown detection suite: ${options.suiteKey}`);
	const filters = options.filters ?? {};
	const intents = filters.intents?.length
		? (unique(filters.intents) as GeoPromptGroup[])
		: suite.intents;
	const stages = filters.stages?.length
		? (unique(filters.stages) as GeoDecisionStage[])
		: suite.stages;
	const exposures = filters.brandExposures?.length
		? unique(filters.brandExposures)
		: ["blind", "aided"];
	const selectedEntries = pack.entries.filter(
		(entry) =>
			intents.includes(entry.intent) &&
			stages.includes(entry.stage) &&
			exposures.includes(entry.brandExposure),
	);
	if (selectedEntries.length === 0) {
		throw new Error("Detection filters selected no preset prompts");
	}
	const products = checkedFilterValues(
		"Product",
		filters.products,
		unique(profile.products ?? []),
	);
	const competitors = checkedFilterValues(
		"Competitor",
		filters.competitors,
		unique(profile.competitors ?? []),
	);
	const audiences = checkedFilterValues(
		"Audience",
		filters.audiences,
		unique(profile.audiences ?? []),
	);
	const regions = checkedFilterValues(
		"Region",
		filters.regions,
		unique(profile.regions ?? []),
	);
	const effectiveProfile: BrandPromptProfile = {
		...profile,
		products,
		competitors,
		audiences,
		regions,
	};
	const defaults = localizedDefaults(effectiveProfile, pack.locale);
	const perIntentOrdinal = new Map<GeoPromptGroup, number>();
	const corePrompts = selectedEntries.map((entry) => {
		const ordinal = perIntentOrdinal.get(entry.intent) ?? 0;
		perIntentOrdinal.set(entry.intent, ordinal + 1);
		return createPrompt({
			entry,
			profile: effectiveProfile,
			pack,
			origin: "system_preset",
			product:
				products[ordinal % Math.max(products.length, 1)] ?? defaults.product,
			competitor:
				competitors[ordinal % Math.max(competitors.length, 1)] ??
				defaults.competitor,
			audience:
				audiences[ordinal % Math.max(audiences.length, 1)] ?? defaults.audience,
			region: regions[ordinal % Math.max(regions.length, 1)] ?? defaults.region,
		});
	});
	const prompts = [
		...corePrompts,
		...addExpansionPrompts({
			prompts: corePrompts,
			profile: effectiveProfile,
			pack,
		}),
	];
	const deduped = [
		...new Map(prompts.map((prompt) => [prompt.promptHash, prompt])).values(),
	];
	const isFiltered =
		!sameValues(intents, suite.intents) ||
		!sameValues(stages, suite.stages) ||
		!sameValues(exposures, ["blind", "aided"]) ||
		Boolean(
			filters.products?.length ||
				filters.competitors?.length ||
				filters.audiences?.length ||
				filters.regions?.length,
		);
	return {
		prompts: deduped,
		manifest: buildManifest({
			prompts: deduped,
			corePromptCount: corePrompts.length,
			profile: effectiveProfile,
			pack,
			tier: samplingDepthToLegacyTier(options.samplingDepth),
			suiteKey: isFiltered ? "filtered" : options.suiteKey,
			samplingDepth: options.samplingDepth,
			isFiltered,
			filters: {
				...filters,
				intents,
				stages,
				brandExposures: exposures as Array<"blind" | "aided">,
				products,
				competitors,
				audiences,
				regions,
			},
		}),
	};
}

export function planMonitorPrompts(
	profile: BrandPromptProfile,
	tier: GeoDetectionTier,
): MonitorPromptPlan {
	return planDetectionPrompts(profile, {
		suiteKey: tier === "quick" ? "quick_scan" : "full_matrix",
		samplingDepth:
			tier === "quick"
				? "single"
				: tier === "standard"
					? "reliable"
					: "stability",
	});
}

export function generateMonitorPrompts(
	profile: BrandPromptProfile,
	tier: GeoDetectionTier,
): GeneratedMonitorPrompt[] {
	return planMonitorPrompts(profile, tier).prompts;
}
