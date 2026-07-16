import { toErrorMessage } from "@aloom/errors";
import {
	analysePromptsForWorkspace,
	completeGeoAnalysis,
	listRecoverableGeoAnalysisRuns,
	markGeoAnalysisRunning,
} from "@aloom/services";
import type { Provider } from "@aloom/types";
import { createProviderLogger, logger } from "@aloom/utils";
import { env } from "../env.js";
import { createConcurrencyGate } from "./concurrency.js";

const analysisQueues = new Map<string, Promise<void>>();
const analysisExecutionGate = createConcurrencyGate(
	env.COLLECTOR_ANALYSIS_CONCURRENCY,
);

export function runAnalysisInBackground(args: {
	workspaceId: string;
	userId: string;
	provider: Provider;
	jobGroupId: string;
	collectionRunId?: string;
}): boolean {
	const { workspaceId, provider, jobGroupId, collectionRunId } = args;
	const plog = createProviderLogger(provider);
	const queueKey = collectionRunId ?? `workspace:${workspaceId}`;
	if (analysisQueues.has(queueKey)) return false;
	const queued = analysisExecutionGate.run(async () => {
		try {
			plog.log(
				`starting bounded background analysis for job group ${jobGroupId} (${analysisExecutionGate.activeCount}/${analysisExecutionGate.limit} slots active)`,
			);
			if (collectionRunId) await markGeoAnalysisRunning(collectionRunId);
			const result = await analysePromptsForWorkspace({
				workspaceId,
				analyzeAll: true,
				runId: collectionRunId,
			});
			if (collectionRunId) {
				await completeGeoAnalysis({
					runId: collectionRunId,
					processedResponseIds: result.processedResponseIds,
					errors: result.errors.map((error) => ({
						responseId: error.responseId,
						error: error.error,
					})),
				});
			}
			plog.success(`Background analysis completed for job group ${jobGroupId}`);
		} catch (err) {
			if (collectionRunId) {
				await completeGeoAnalysis({
					runId: collectionRunId,
					fatalError: toErrorMessage(err),
				}).catch(() => {});
			}
			plog.error(
				`Background analysis failed for job group ${jobGroupId}:`,
				toErrorMessage(err),
			);
		}
	});
	analysisQueues.set(queueKey, queued);
	void queued.finally(() => {
		if (analysisQueues.get(queueKey) === queued)
			analysisQueues.delete(queueKey);
	});
	return true;
}

let recoveryPromise: Promise<number> | null = null;

export async function recoverPendingGeoAnalyses(): Promise<number> {
	if (recoveryPromise) return recoveryPromise;
	recoveryPromise = (async () => {
		const recoverable = await listRecoverableGeoAnalysisRuns();
		let queued = 0;
		for (const item of recoverable) {
			if (
				runAnalysisInBackground({
					workspaceId: item.workspaceId,
					userId: item.userId,
					provider: item.provider,
					jobGroupId: item.collectionRunId,
					collectionRunId: item.collectionRunId,
				})
			) {
				queued += 1;
			}
		}
		return queued;
	})().finally(() => {
		recoveryPromise = null;
	});
	return recoveryPromise;
}

export function startGeoAnalysisRecovery(intervalMs = 60_000): () => void {
	void recoverPendingGeoAnalyses().catch((error) => {
		logger.error(`[agent] analysis recovery failed: ${toErrorMessage(error)}`);
	});
	const timer = setInterval(() => {
		void recoverPendingGeoAnalyses().catch((error) => {
			logger.error(
				`[agent] analysis recovery failed: ${toErrorMessage(error)}`,
			);
		});
	}, intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}
