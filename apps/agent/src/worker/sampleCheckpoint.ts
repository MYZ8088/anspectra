import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { toErrorMessage } from "@answerloom/errors";
import {
	getAgentAuthRootDir,
	storePromptResponses,
} from "@answerloom/services";
import type { AskPromptResult, ModelResult, Provider } from "@answerloom/types";
import { PROVIDER_LIST } from "@answerloom/types";

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
		const storageRoot = path.dirname(getAgentAuthRootDir());
		const outboxDir = path.join(storageRoot, "outbox", "prompt-samples");
		await mkdir(outboxDir, { recursive: true });
		const filePath = path.join(
			outboxDir,
			`${args.jobGroupId}-${args.provider}-${args.sample.promptId}-${randomUUID()}.json`,
		);
		await writeFile(
			filePath,
			JSON.stringify(
				{
					...args,
					storageError: toErrorMessage(error),
					queuedAt: new Date().toISOString(),
				},
				null,
				2,
			),
		);
		return { destination: "outbox" };
	}
}
