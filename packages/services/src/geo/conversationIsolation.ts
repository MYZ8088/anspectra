export interface CompletedConversationSample {
	promptId: string | null;
}

export function findConflictingConversationPrompt(args: {
	promptId: string;
	completedSamples: CompletedConversationSample[];
}): string | null {
	const conflict = args.completedSamples.find(
		(sample) => sample.promptId !== null && sample.promptId !== args.promptId,
	);
	return conflict?.promptId ?? null;
}
