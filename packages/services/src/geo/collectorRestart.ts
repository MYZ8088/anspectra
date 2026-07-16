export const COLLECTOR_RESTART_WARNING = "collector_restarted";

export function buildCollectorRestartCheckpointPatch(now: Date) {
	return {
		status: "queued" as const,
		phase: "queued",
		conversationId: null,
		conversationUrl: null,
		sourceExposure: null,
		actualMode: null,
		failureCategory: null,
		errorCode: null,
		errorMessage: null,
		retryable: null,
		warningCode: COLLECTOR_RESTART_WARNING,
		startedAt: null,
		completedAt: null,
		lastEventAt: now,
		updatedAt: now,
	};
}
