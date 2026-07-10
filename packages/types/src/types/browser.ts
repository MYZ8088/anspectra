export type FailureType =
	| "connection_error"
	| "human_challenge"
	| "bot_detection"
	| "logged_out"
	| "rate_limited"
	| "no_editor"
	| "submission_failed"
	| "extraction_failed"
	| "timeout"
	| "browser_crash"
	| "unknown";

export const CHALLENGE_KIND_LIST = [
	"captcha",
	"slider",
	"qr_login",
	"login_required",
	"security_check",
	"region_block",
	"ui_changed",
] as const;

export type ChallengeKind = (typeof CHALLENGE_KIND_LIST)[number];

export type RunStatus =
	| "queued"
	| "waiting_runner"
	| "running"
	| "cooling_down"
	| "waiting_human"
	| "partial"
	| "completed"
	| "failed"
	| "cancelled";

export type ConversationIsolation = "fresh" | "multi_turn_experiment";
export type SampleEvidenceLevel = "live_web" | "manual_import";
export type SourceExposure = "exposed" | "not_exposed";
export type CollectorHealth = "online" | "offline" | "degraded";

export type HealthCheckResult = {
	healthy: boolean;
	reason?: string;
	failureType?: FailureType;
	userMessage?: string; // User-friendly error message
};
