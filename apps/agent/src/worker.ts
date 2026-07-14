import {
	GEO_WEB_PROVIDERS,
	dispatchDueDetectionSchedules,
	dispatchScheduledGeoRuns,
	getQueueName,
	redis,
	waitForRedis,
} from "@aloom/services";
import type { Provider } from "@aloom/types";
import { logger } from "@aloom/utils";
import { Worker } from "bullmq";
import { env } from "./env.js";
import { focusProviderSession } from "./lib/browser/providerSessionManager.js";
import {
	providerConcurrencyDecision,
	runWithProviderExecutionGate,
} from "./worker/executionGate.js";
import { handleJob, stopActiveProviderRun } from "./worker/jobHandler.js";

// Exported so index.ts can call worker.close() during graceful shutdown.
export let workers: Worker[] = [];
// BullMQ renews live locks automatically. A shorter lock lets another local
// collector recover promptly after an ungraceful process or machine shutdown.
const WORKER_LOCK_DURATION_MS = 5 * 60 * 1000;
const PROVIDER_STOP_CHANNEL = "aloom:agent:provider-stop";
const PROVIDER_WINDOW_CHANNEL = "aloom:agent:provider-window";

async function startWorkers() {
	await waitForRedis();
	const writeHeartbeat = async () => {
		await redis.set(
			"aloom:agent:heartbeat",
			new Date().toISOString(),
			"EX",
			90,
		);
	};
	await writeHeartbeat();
	setInterval(() => void writeHeartbeat().catch(() => null), 30_000).unref();
	await dispatchDueDetectionSchedules().catch(() => 0);
	await dispatchScheduledGeoRuns().catch(() => 0);
	setInterval(() => {
		void dispatchDueDetectionSchedules()
			.catch(() => 0)
			.then(() => dispatchScheduledGeoRuns())
			.catch(() => 0);
	}, 60_000).unref();
	const stopSubscriber = redis.duplicate();
	await stopSubscriber.connect();
	await stopSubscriber.subscribe(PROVIDER_STOP_CHANNEL);
	await stopSubscriber.subscribe(PROVIDER_WINDOW_CHANNEL);
	stopSubscriber.on("message", (channel, message) => {
		void (async () => {
			try {
				const payload = JSON.parse(message) as {
					jobGroupId?: string;
					provider?: Provider;
				};
				if (!payload.provider) {
					return;
				}
				if (channel === PROVIDER_WINDOW_CHANNEL) {
					await focusProviderSession(payload.provider);
					return;
				}
				if (channel !== PROVIDER_STOP_CHANNEL || !payload.jobGroupId) return;
				await stopActiveProviderRun({
					jobGroupId: payload.jobGroupId,
					provider: payload.provider,
				});
			} catch (error) {
				logger.error("[agent] failed to process provider stop request", error);
			}
		})();
	});

	const connection = {
		host: env.REDIS_HOST,
		port: env.REDIS_PORT,
		password: env.REDIS_PASSWORD,
	};
	logger.log(
		`[agent] provider scheduling: per_provider=1, requested_global=${providerConcurrencyDecision.requested}, effective_global=${providerConcurrencyDecision.effective}`,
	);
	if (providerConcurrencyDecision.resourceLimited) {
		logger.warn(
			`[agent] provider concurrency reduced to ${providerConcurrencyDecision.effective}: ${providerConcurrencyDecision.reasons.join("; ")}`,
		);
	}

	workers = GEO_WEB_PROVIDERS.map((provider) => {
		const queueName = getQueueName(provider);
		const worker = new Worker(
			queueName,
			(job) => runWithProviderExecutionGate(provider, () => handleJob(job)),
			{
				connection,
				concurrency: 1,
				lockDuration: WORKER_LOCK_DURATION_MS,
				stalledInterval: 30 * 1000,
				maxStalledCount: 5,
			},
		);

		worker.on("active", (job) => {
			// BullMQ fires "active" when the job is dequeued — before the stagger
			// delay and execution gate run. Real execution start is logged inside
			// runWithProviderExecutionGate after all gates are acquired.
			logger.debug(`[provider:${provider}] job queued ${job.id}`);
		});

		worker.on("completed", (job) => {
			logger.log(`[provider:${provider}] job completed ${job.id}`);
		});

		worker.on("failed", (job, err) => {
			logger.error(`[provider:${provider}] job failed ${job?.id}`, err);
		});

		logger.log(
			`[agent] provider worker started → queue: ${queueName} (concurrency=1)`,
		);
		return worker;
	});
}

startWorkers().catch((err) => {
	logger.error("Workers failed to start:", err);
	process.exit(1);
});
