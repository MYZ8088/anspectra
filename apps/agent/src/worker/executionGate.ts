import type { Provider } from "@aloom/types";
import { logger } from "@aloom/utils";
import { env } from "../env.js";
import { createConcurrencyGate } from "./concurrency.js";
import {
	readCollectorResourceSnapshot,
	resolveProviderConcurrency,
} from "./resourceCapacity.js";

// Bounded random jitter applied before each provider starts so that concurrent
// jobs do not all spin up browsers simultaneously and spike CPU/memory.
const STARTUP_JITTER_MAX_MS = 3_000;

export const providerConcurrencyDecision = resolveProviderConcurrency(
	env.COLLECTOR_PROVIDER_CONCURRENCY,
	readCollectorResourceSnapshot(),
);
const providerExecutionGate = createConcurrencyGate(
	providerConcurrencyDecision.effective,
);

export async function runWithProviderExecutionGate<T>(
	provider: Provider,
	task: () => Promise<T>,
): Promise<T> {
	const jitter = Math.floor(Math.random() * STARTUP_JITTER_MAX_MS);
	if (jitter > 0) {
		await new Promise<void>((resolve) => setTimeout(resolve, jitter));
	}

	return providerExecutionGate.run(async () => {
		logger.log(
			`[${provider}] execution started (${providerExecutionGate.activeCount}/${providerExecutionGate.limit} provider slots active)`,
		);
		return task();
	});
}
