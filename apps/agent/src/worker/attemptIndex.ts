import type { PromptAttemptUpdate } from "@aloom/types";

export function offsetPromptAttempt(
	update: PromptAttemptUpdate,
	offsets?: Record<string, number>,
): PromptAttemptUpdate {
	const offset = Math.max(0, offsets?.[update.promptId] ?? 0);
	return {
		...update,
		attemptIndex: offset + update.attemptIndex,
	};
}
