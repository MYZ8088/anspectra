import { storePromptResponses } from "@anspectra/services";
import type { AskPromptResult, ModelResult, Provider } from "@anspectra/types";
import { PROVIDER_LIST } from "@anspectra/types";
import { writePromptSampleToOutbox } from "./sampleOutbox.js";

function buildSingleSampleResult(
	provider: Provider,
	sample: AskPromptResult,
): ModelResult {
	const result = Object.fromEntries(
		PROVIDER_LIST.map((currentProvider) => [
			currentProvider,
			{ status: "rejected" as const, data: [] },
		]),
	) as unknown as ModelResult;
	result[provider] = { status: "fulfilled", data: [sample] };
	return result;
}

export async function persistSampleCheckpoint(args: {
	jobGroupId: string;
	provider: Provider;
	sample: AskPromptResult;
	userId: string;
	workspaceId: string;
	promptRunAt: string;
}): Promise<{ destination: "clickhouse" | "outbox"; sampleId?: string }> {
	try {
		const [sampleId] = await storePromptResponses({
			results: buildSingleSampleResult(args.provider, args.sample),
			userId: args.userId,
			workspaceId: args.workspaceId,
			promptRunAt: args.promptRunAt,
			runId: args.jobGroupId,
		});
		return { destination: "clickhouse", sampleId };
	} catch (error) {
		await writePromptSampleToOutbox(args, error);
		return { destination: "outbox" };
	}
}
