const TERMINAL_FAILURE_STATUSES = new Set([
	"failed",
	"not_attempted",
	"cancelled",
]);

export function summarizeCollectionCheckpointStatuses(statuses: string[]) {
	return statuses.reduce(
		(summary, status) => {
			if (status === "completed") summary.completed += 1;
			if (TERMINAL_FAILURE_STATUSES.has(status)) summary.failed += 1;
			return summary;
		},
		{ completed: 0, failed: 0 },
	);
}
