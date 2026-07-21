import { randomUUID } from "node:crypto";
import {
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { toErrorMessage } from "@anspectra/errors";
import {
	getAgentAuthRootDir,
	persistGeoSampleCheckpoint,
	storePromptResponses,
} from "@anspectra/services";
import type { AskPromptResult, ModelResult, Provider } from "@anspectra/types";
import { PROVIDER_LIST } from "@anspectra/types";
import { logger } from "@anspectra/utils";
import { runAnalysisInBackground } from "./analysis.js";

type PromptSampleOutboxRecord = {
	jobGroupId: string;
	provider: Provider;
	sample: AskPromptResult;
	userId: string;
	workspaceId: string;
	promptRunAt: string;
	storageError: string;
	queuedAt: string;
};

function promptSampleOutboxDir(): string {
	return path.join(
		path.dirname(getAgentAuthRootDir()),
		"outbox",
		"prompt-samples",
	);
}

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

function parseOutboxRecord(raw: string): PromptSampleOutboxRecord {
	const value = JSON.parse(raw) as Partial<PromptSampleOutboxRecord>;
	if (
		typeof value.jobGroupId !== "string" ||
		typeof value.provider !== "string" ||
		!PROVIDER_LIST.includes(value.provider as Provider) ||
		typeof value.sample !== "object" ||
		value.sample === null ||
		typeof value.sample.promptId !== "string" ||
		typeof value.sample.response !== "string" ||
		typeof value.userId !== "string" ||
		typeof value.workspaceId !== "string" ||
		typeof value.promptRunAt !== "string"
	) {
		throw new Error("Invalid prompt sample outbox record");
	}
	return value as PromptSampleOutboxRecord;
}

export async function writePromptSampleToOutbox(
	args: Omit<PromptSampleOutboxRecord, "storageError" | "queuedAt">,
	error: unknown,
): Promise<string> {
	const outboxDir = promptSampleOutboxDir();
	await mkdir(outboxDir, { recursive: true });
	const fileName = `${args.jobGroupId}-${args.provider}-${args.sample.promptId}-${randomUUID()}.json`;
	const filePath = path.join(outboxDir, fileName);
	const temporaryPath = `${filePath}.tmp`;
	await writeFile(
		temporaryPath,
		JSON.stringify(
			{
				...args,
				storageError: toErrorMessage(error),
				queuedAt: new Date().toISOString(),
			} satisfies PromptSampleOutboxRecord,
			null,
			2,
		),
	);
	await rename(temporaryPath, filePath);
	return filePath;
}

let replayPromise: Promise<number> | null = null;

export async function replayPromptSampleOutbox(): Promise<number> {
	if (replayPromise) return replayPromise;
	replayPromise = (async () => {
		const outboxDir = promptSampleOutboxDir();
		await mkdir(outboxDir, { recursive: true });
		const files = (await readdir(outboxDir))
			.filter((file) => file.endsWith(".json"))
			.sort();
		let replayed = 0;
		for (const file of files) {
			const filePath = path.join(outboxDir, file);
			try {
				const record = parseOutboxRecord(await readFile(filePath, "utf8"));
				const [sampleId] = await storePromptResponses({
					results: buildSingleSampleResult(record.provider, record.sample),
					userId: record.userId,
					workspaceId: record.workspaceId,
					promptRunAt: record.promptRunAt,
					runId: record.jobGroupId,
				});
				if (!sampleId) throw new Error("Outbox replay produced no sample ID");
				await persistGeoSampleCheckpoint({
					collectionRunId: record.jobGroupId,
					provider: record.provider,
					sample: record.sample,
					analyticsSampleId: sampleId,
				});
				runAnalysisInBackground({
					workspaceId: record.workspaceId,
					userId: record.userId,
					provider: record.provider,
					jobGroupId: record.jobGroupId,
					collectionRunId: record.jobGroupId,
				});
				await rm(filePath);
				replayed += 1;
			} catch (error) {
				logger.warn(
					`[agent] prompt sample outbox replay paused at ${file}: ${toErrorMessage(error)}`,
				);
				break;
			}
		}
		if (replayed > 0) {
			logger.log(`[agent] replayed ${replayed} prompt sample(s) from outbox`);
		}
		return replayed;
	})().finally(() => {
		replayPromise = null;
	});
	return replayPromise;
}

export function startPromptSampleOutboxReplay(intervalMs = 60_000): () => void {
	void replayPromptSampleOutbox();
	const timer = setInterval(() => void replayPromptSampleOutbox(), intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}
