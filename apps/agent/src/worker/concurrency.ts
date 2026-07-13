export type ConcurrencyGate = {
	readonly limit: number;
	readonly activeCount: number;
	readonly pendingCount: number;
	run<T>(task: () => Promise<T>): Promise<T>;
};

export function createConcurrencyGate(limit: number): ConcurrencyGate {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("Concurrency limit must be a positive integer");
	}

	let activeCount = 0;
	const waiters: Array<() => void> = [];

	const acquire = async () => {
		if (activeCount < limit) {
			activeCount += 1;
			return;
		}
		await new Promise<void>((resolve) => waiters.push(resolve));
	};

	const release = () => {
		const next = waiters.shift();
		if (next) {
			next();
			return;
		}
		activeCount = Math.max(0, activeCount - 1);
	};

	return {
		limit,
		get activeCount() {
			return activeCount;
		},
		get pendingCount() {
			return waiters.length;
		},
		async run<T>(task: () => Promise<T>): Promise<T> {
			await acquire();
			try {
				return await task();
			} finally {
				release();
			}
		},
	};
}
