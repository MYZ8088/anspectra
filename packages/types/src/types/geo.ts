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

export const PROMPT_ORIGIN_LIST = [
	"yao_preset",
	"user_custom",
	"generated_expansion",
	"legacy",
] as const;
export type PromptOrigin = (typeof PROMPT_ORIGIN_LIST)[number];

export const PROVIDER_MODE_LIST = ["default", "web_search"] as const;
export type ProviderMode = (typeof PROVIDER_MODE_LIST)[number];

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
	diagnostics?: Record<string, unknown>;
};
