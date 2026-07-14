import type { PromptPayload } from "@aloom/types";

type ProviderCheckpointState = {
	totalCount: number;
	completedCount: number;
	runnablePromptIds: string[];
};

export function resolveProviderJobResume(args: {
	requestedPrompts: PromptPayload["prompts"];
	requestedTotalPromptCount: number;
	initialCompletedCount: number;
	checkpointState: ProviderCheckpointState | null;
}) {
	const { checkpointState, requestedPrompts } = args;
	const runnablePromptIds = checkpointState
		? new Set(checkpointState.runnablePromptIds)
		: null;
	const prompts =
		checkpointState && checkpointState.totalCount > 0
			? requestedPrompts.filter((prompt) => runnablePromptIds?.has(prompt.id))
			: requestedPrompts;

	return {
		prompts,
		completedAtStart:
			checkpointState?.completedCount ?? args.initialCompletedCount,
		totalPromptCount: Math.max(
			args.requestedTotalPromptCount,
			checkpointState?.totalCount ?? 0,
		),
		filteredPromptCount: requestedPrompts.length - prompts.length,
	};
}
