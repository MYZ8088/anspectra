const DEFAULT_STALE_RUN_AFTER_MS = 20 * 60 * 1000;
const DEFAULT_STALE_RUN_EXPIRE_MS = 24 * 60 * 60 * 1000;

export type StaleRunRecoveryAction =
	| "ignore"
	| "keep_live"
	| "requeue"
	| "expire";

export function decideStaleRunRecovery(args: {
	nowMs: number;
	updatedAtMs: number;
	hasOpenCheckpoints: boolean;
	hasLiveQueueJob: boolean;
	staleAfterMs?: number;
	expireAfterMs?: number;
}): StaleRunRecoveryAction {
	const staleAfterMs = args.staleAfterMs ?? DEFAULT_STALE_RUN_AFTER_MS;
	const expireAfterMs = args.expireAfterMs ?? DEFAULT_STALE_RUN_EXPIRE_MS;
	const ageMs = Math.max(0, args.nowMs - args.updatedAtMs);
	if (ageMs < staleAfterMs || !args.hasOpenCheckpoints) return "ignore";
	if (args.hasLiveQueueJob) return "keep_live";
	return ageMs >= expireAfterMs ? "expire" : "requeue";
}

export const STALE_RUN_DEFAULTS = {
	staleAfterMs: DEFAULT_STALE_RUN_AFTER_MS,
	expireAfterMs: DEFAULT_STALE_RUN_EXPIRE_MS,
} as const;
