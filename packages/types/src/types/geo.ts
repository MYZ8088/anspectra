import type { Provider } from "./agent.js";

export const GEO_INTENT_LIST = [
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
export type GeoIntent = (typeof GEO_INTENT_LIST)[number];

export const GEO_DECISION_STAGE_LIST = [
	"awareness",
	"screening",
	"evaluation",
	"purchase",
	"implementation",
	"review",
] as const;
export type GeoDecisionStage = (typeof GEO_DECISION_STAGE_LIST)[number];

export const DETECTION_SUITE_LIST = [
	"quick_scan",
	"discovery",
	"competitive_position",
	"trust_risk",
	"buyer_journey",
	"full_matrix",
	"filtered",
] as const;
export type DetectionSuiteKey = (typeof DETECTION_SUITE_LIST)[number];

export const SAMPLING_DEPTH_LIST = ["single", "reliable", "stability"] as const;
export type SamplingDepth = (typeof SAMPLING_DEPTH_LIST)[number];

export type DetectionDimensionFilter = {
	locales?: string[];
	intents?: GeoIntent[];
	stages?: GeoDecisionStage[];
	brandExposures?: Array<"blind" | "aided">;
	products?: string[];
	competitors?: string[];
	audiences?: string[];
	regions?: string[];
};

export const DETECTION_SLICE_LIST = [
	"overall",
	"provider",
	"locale",
	"intent",
	"decision_stage",
	"brand_exposure",
	"product",
	"competitor",
	"audience",
	"region",
	"provider_mode",
	"prompt",
	"intent_stage",
] as const;
export type DetectionSliceKey = (typeof DETECTION_SLICE_LIST)[number];

export type DetectionMetricRate = {
	numerator: number;
	denominator: number;
	value: number;
};

export type DetectionSliceMetrics = {
	key: string;
	label: string;
	planned: number;
	completed: number;
	analysed: number;
	failed: number;
	completionRate: number;
	analysisRate: number;
	confidence: "low" | "medium" | "high";
	mentionRate: DetectionMetricRate;
	candidateRate: DetectionMetricRate;
	recommendationRate: DetectionMetricRate;
	averageRank: number | null;
	averageSentiment: number | null;
	sourceExposureRate: DetectionMetricRate;
	stability: number | null;
	targetShare: number;
	competitorShare: number;
};

export type DetectionReport = {
	seriesId: string;
	promptSetId: string;
	seriesStatus: string;
	provisional: boolean;
	suiteKey: DetectionSuiteKey;
	samplingDepth: SamplingDepth;
	createdAt: Date;
	methodology: {
		analysisUnit: "single_answer";
		answersPerAnalysisCall: 1;
		aggregation: "deterministic_structured_rollup";
		plannedSamples: number;
		checkpointSamples: number;
		uniquePromptHashes: number;
		totalResponseCharacters: number;
		largestResponseCharacters: number;
	};
	executiveSummary: string[];
	failures: Array<{
		kind: "collection" | "analysis";
		code: string;
		count: number;
	}>;
	slices: Record<DetectionSliceKey, DetectionSliceMetrics[]>;
	competitors: Array<{
		name: string;
		mentions: number;
		recommendations: number;
	}>;
	samples: Array<{
		checkpointId: string;
		provider: string;
		status: string;
		analysisStatus: string;
		analysisErrorCode: string | null;
		analysisErrorMessage: string | null;
		prompt: string;
		promptHash: string | null;
		intent: string;
		decisionStage: string | null;
		locale: string;
		brandExposure: string | null;
		requestedMode: ProviderMode;
		actualMode: ProviderMode | null;
		response: string | null;
		responseLength: number;
		sources: Array<{
			title: string;
			url: string;
			citedText: string;
			domain: string | null;
		}>;
		sourceExposure: string | null;
		conversationId: string | null;
		conversationUrl: string | null;
		errorCode: string | null;
		errorMessage: string | null;
		dimensions: Record<string, unknown>;
	}>;
};

export type DetectionSchedule = {
	id: string;
	workspaceId: string;
	promptSetId: string;
	providers: string[];
	providerModes: Partial<Record<Provider, ProviderMode>>;
	cadence: "weekly" | "monthly";
	timezone: string;
	localTime: string;
	dayOfWeek: number | null;
	dayOfMonth: number | null;
	enabled: boolean;
	nextRunAt: Date | null;
	lastRunAt: Date | null;
	lastSeriesId: string | null;
	lastError: string | null;
};

export const PROMPT_ORIGIN_LIST = [
	"yao_preset",
	"user_custom",
	"generated_expansion",
	"legacy",
] as const;
export type PromptOrigin = (typeof PROMPT_ORIGIN_LIST)[number];

export const PROVIDER_MODE_LIST = [
	"default",
	"auto",
	"fast",
	"expert",
	"reasoning",
	"web_search",
	"expert_web_search",
	"reasoning_web_search",
	"auto_search",
] as const;
export type ProviderMode = (typeof PROVIDER_MODE_LIST)[number];

export const GEO_PROVIDER_MODE_CAPABILITIES = {
	doubao: ["default", "fast", "expert"],
	deepseek: ["default", "fast", "expert", "reasoning", "web_search"],
	hunyuan: ["default", "reasoning", "auto_search", "reasoning_web_search"],
	qwen: [
		"default",
		"auto",
		"fast",
		"reasoning",
		"web_search",
		"reasoning_web_search",
		"auto_search",
	],
} as const satisfies Record<
	"doubao" | "deepseek" | "hunyuan" | "qwen",
	readonly ProviderMode[]
>;

export const PROVIDER_MODE_LABELS: Record<ProviderMode, string> = {
	default: "Provider default",
	auto: "Auto",
	fast: "Fast",
	expert: "Expert",
	reasoning: "Reasoning",
	web_search: "Web search",
	expert_web_search: "Expert + web search",
	reasoning_web_search: "Reasoning + web search",
	auto_search: "Auto + web search",
};

export function getProviderModeLabel(
	provider: Provider | string,
	mode: ProviderMode,
): string {
	if (provider === "deepseek") {
		if (mode === "fast") return "Instant / Fast";
		if (mode === "reasoning") return "DeepThink";
		if (mode === "web_search") return "Instant + Search";
	}
	if (provider === "hunyuan") {
		if (mode === "reasoning") return "Deep Thinking";
		if (mode === "auto_search") return "Tool > Search";
		if (mode === "reasoning_web_search") {
			return "Deep Thinking + Tool > Search";
		}
	}
	if (provider === "qwen") {
		if (mode === "default") return "Provider default (Auto + Tools)";
		if (mode === "auto") return "Auto (Tools off)";
		if (mode === "fast") return "Fast (Tools off)";
		if (mode === "reasoning") return "Thinking (Tools off)";
		if (mode === "web_search") return "Fast + Tools";
		if (mode === "reasoning_web_search") return "Thinking + Tools";
		if (mode === "auto_search") return "Auto + Tools";
	}
	return PROVIDER_MODE_LABELS[mode];
}

export const COLLECTION_PHASE_LIST = [
	"queued",
	"session",
	"navigation",
	"fresh_conversation",
	"editor",
	"input",
	"submission",
	"generation",
	"extraction",
	"validation",
	"persistence",
	"completed",
] as const;
export type CollectionPhase = (typeof COLLECTION_PHASE_LIST)[number];

export const SAMPLE_COLLECTION_STATUS_LIST = [
	"queued",
	"running",
	"retrying",
	"cooling_down",
	"waiting_human",
	"completed",
	"failed",
	"not_attempted",
	"cancelled",
] as const;
export type SampleCollectionStatus =
	(typeof SAMPLE_COLLECTION_STATUS_LIST)[number];

export const ANALYSIS_STATUS_LIST = [
	"pending",
	"running",
	"completed",
	"failed",
	"not_applicable",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUS_LIST)[number];

export const FAILURE_CATEGORY_LIST = [
	"account",
	"provider_access",
	"browser_session",
	"interaction",
	"generation",
	"extraction",
	"persistence",
	"analysis",
	"legacy",
	"unknown",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORY_LIST)[number];

export const FAILURE_CODE_LIST = [
	"login_required",
	"captcha",
	"slider",
	"qr_login",
	"security_confirmation",
	"region_blocked",
	"rate_limited",
	"mode_unavailable",
	"network_error",
	"browser_crash",
	"navigation_failed",
	"fresh_conversation_failed",
	"editor_missing",
	"input_failed",
	"submission_failed",
	"response_timeout",
	"provider_error",
	"generation_interrupted",
	"assistant_not_found",
	"empty_response",
	"prompt_echo",
	"incomplete_response",
	"invalid_response",
	"selector_changed",
	"persistence_failed",
	"analysis_invalid_json",
	"analysis_upstream_error",
	"provider_aborted",
	"legacy_unclassified",
	"unknown",
] as const;
export type FailureCode = (typeof FAILURE_CODE_LIST)[number];

export const RUN_SERIES_STATUS_LIST = [
	"queued",
	"scheduled",
	"waiting_runner",
	"running",
	"cooling_down",
	"waiting_human",
	"partial",
	"completed",
	"failed",
	"cancelled",
] as const;
export type RunSeriesStatus = (typeof RUN_SERIES_STATUS_LIST)[number];

export type CamoufoxRuntimeManifest = {
	schemaVersion: 1;
	pipSpec: string;
	browserChannel: string;
	platform: string;
	arch: string;
	basePython: string;
	pythonVersion: string;
	packageVersion: string;
	executablePath: string;
	installedAt: string;
};

export type ProviderIdentityManifest = {
	schemaVersion: 1;
	provider: Provider;
	profileDir: string;
	createdAt: string;
	lastUsedAt: string;
	fingerprintHash: string;
	firstNetworkFingerprint: string;
	lastNetworkFingerprint: string;
	launchOptions: Record<string, unknown>;
	windowGeometry?: {
		width: number;
		height: number;
		x: number;
		y: number;
		appliedAt: string;
	};
};

export type PromptProvenance = {
	origin: PromptOrigin;
	createdByUserId: string | null;
	importSource: "manual" | "csv" | "legacy_clickhouse" | "preset" | null;
	legacySourceId: string | null;
	profileVersion: number | null;
};

export type PromptRelevance = {
	status: "relevant" | "needs_confirmation" | "unrelated";
	matchedEntities: string[];
	reasons: string[];
};

export type ProfileCompleteness = {
	complete: boolean;
	confirmed: boolean;
	missing: Array<
		| "brandName"
		| "officialDomain"
		| "category"
		| "products"
		| "audiences"
		| "regions"
		| "competitors"
	>;
};

export type PromptDimensions = {
	templateKey: string | null;
	intent: GeoIntent;
	decisionStage: GeoDecisionStage;
	locale: string;
	brandExposure: "blind" | "aided";
	origin: PromptOrigin;
	targetProduct: string | null;
	targetCompetitor: string | null;
	targetAudience: string | null;
	targetRegion: string | null;
	queryForm: "standalone";
};

export type SampleAttemptEvent = {
	runId: string;
	promptId: string;
	provider: Provider;
	attemptIndex: number;
	status: "started" | "progress" | "completed" | "failed";
	phase: CollectionPhase;
	requestedMode?: ProviderMode;
	actualMode?: ProviderMode;
	failureCategory?: FailureCategory;
	failureCode?: FailureCode;
	failureMessage?: string;
	retryable?: boolean;
	pageUrl?: string;
	conversationId?: string;
	diagnostics?: Record<string, unknown>;
};

export type PromptAttemptUpdate = {
	promptId: string;
	attemptIndex: number;
	status: "started" | "progress" | "completed" | "failed";
	phase: CollectionPhase;
	failureCategory?: FailureCategory;
	failureCode?: FailureCode;
	failureMessage?: string;
	retryable?: boolean;
	pageUrl?: string;
	conversationId?: string;
	requestedMode?: ProviderMode;
	actualMode?: ProviderMode;
	diagnostics?: Record<string, unknown>;
};
