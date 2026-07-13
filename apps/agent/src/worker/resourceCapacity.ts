import os from "node:os";

const GIBIBYTE = 1024 ** 3;
const MAX_WEB_PROVIDER_COUNT = 4;
const LOW_RESOURCE_PROVIDER_LIMIT = 2;
const MIN_CPUS_FOR_FOUR_PROVIDERS = 4;
const MIN_MEMORY_FOR_FOUR_PROVIDERS = 12 * GIBIBYTE;

export type CollectorResourceSnapshot = {
	cpuCount: number;
	totalMemoryBytes: number;
};

export type ProviderConcurrencyDecision = {
	requested: number;
	effective: number;
	resourceLimited: boolean;
	reasons: string[];
};

export function readCollectorResourceSnapshot(): CollectorResourceSnapshot {
	return {
		cpuCount:
			typeof os.availableParallelism === "function"
				? os.availableParallelism()
				: os.cpus().length,
		totalMemoryBytes: os.totalmem(),
	};
}

export function resolveProviderConcurrency(
	requested: number,
	resources: CollectorResourceSnapshot,
): ProviderConcurrencyDecision {
	const normalizedRequested = Math.max(
		1,
		Math.min(MAX_WEB_PROVIDER_COUNT, Math.floor(requested)),
	);
	const reasons: string[] = [];
	if (resources.cpuCount < MIN_CPUS_FOR_FOUR_PROVIDERS) {
		reasons.push(
			`${resources.cpuCount} logical CPU(s) available; ${MIN_CPUS_FOR_FOUR_PROVIDERS} required for four-provider collection`,
		);
	}
	if (resources.totalMemoryBytes < MIN_MEMORY_FOR_FOUR_PROVIDERS) {
		reasons.push(
			`${(resources.totalMemoryBytes / GIBIBYTE).toFixed(1)} GiB memory available; 12 GiB required for four-provider collection`,
		);
	}
	const resourceLimited = reasons.length > 0 && normalizedRequested > 2;
	return {
		requested: normalizedRequested,
		effective: resourceLimited
			? Math.min(normalizedRequested, LOW_RESOURCE_PROVIDER_LIMIT)
			: normalizedRequested,
		resourceLimited,
		reasons,
	};
}
