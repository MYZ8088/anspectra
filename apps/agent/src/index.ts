import { logger } from "@answerloom/utils";
import { env } from "./env.js";
import { closeAllProviderSessions } from "./lib/browser/providerSessionManager.js";

let stopRuntime: () => Promise<void> = async () => {};

async function startRuntime() {
	if (env.COLLECTOR_API_URL || env.COLLECTOR_DEVICE_TOKEN) {
		if (!env.COLLECTOR_API_URL || !env.COLLECTOR_DEVICE_TOKEN) {
			throw new Error(
				"COLLECTOR_API_URL and COLLECTOR_DEVICE_TOKEN must be set together",
			);
		}
		const { startRemoteCollector } = await import(
			"./remote/collectorClient.js"
		);
		const remote = startRemoteCollector();
		stopRuntime = async () => remote.stop();
		return;
	}

	await import("./api.js");
	const workerModule = await import("./worker.js");
	const { redis } = await import("@answerloom/services");
	stopRuntime = async () => {
		if (workerModule.workers.length > 0) {
			await Promise.all(workerModule.workers.map((worker) => worker.close()));
		}
		await redis.quit();
	};
}

await startRuntime();

let isExiting = false;
async function shutdown(signal: string) {
	if (isExiting) return;
	isExiting = true;
	logger.log(`[agent] received ${signal}; closing active work`);
	const forceExitTimer = setTimeout(() => process.exit(1), 15 * 60 * 1000);
	try {
		await stopRuntime();
		await closeAllProviderSessions();
		clearTimeout(forceExitTimer);
		process.exit(0);
	} catch (error) {
		logger.error("[agent] shutdown failed", error);
		clearTimeout(forceExitTimer);
		process.exit(1);
	}
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGQUIT", () => void shutdown("SIGQUIT"));
process.on("uncaughtException", (error) => {
	logger.error("[agent] uncaught exception", error);
	process.exit(1);
});
process.on("unhandledRejection", (reason) => {
	logger.error("[agent] unhandled rejection", reason);
});
