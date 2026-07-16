export interface OpenProviderCheckpoint {
	id: string;
	promptId: string | null;
}

export function selectFinalizableCheckpointIds(args: {
	openCheckpoints: OpenProviderCheckpoint[];
	ownedPromptIds?: string[];
}): string[] {
	if (!args.ownedPromptIds) {
		return args.openCheckpoints.map((checkpoint) => checkpoint.id);
	}
	const owned = new Set(args.ownedPromptIds);
	return args.openCheckpoints.flatMap((checkpoint) =>
		checkpoint.promptId && owned.has(checkpoint.promptId)
			? [checkpoint.id]
			: [],
	);
}
