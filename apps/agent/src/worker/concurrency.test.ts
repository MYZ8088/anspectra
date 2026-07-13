import { describe, expect, it } from "vitest";
import { createConcurrencyGate } from "./concurrency.js";

describe("createConcurrencyGate", () => {
	it("never runs more than the configured number of tasks", async () => {
		const gate = createConcurrencyGate(2);
		let active = 0;
		let maximumActive = 0;
		let releaseFirstWave: (() => void) | undefined;
		const firstWave = new Promise<void>((resolve) => {
			releaseFirstWave = resolve;
		});

		const tasks = Array.from({ length: 4 }, (_, index) =>
			gate.run(async () => {
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				if (index < 2) await firstWave;
				active -= 1;
			}),
		);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(gate.activeCount).toBe(2);
		expect(gate.pendingCount).toBe(2);
		releaseFirstWave?.();
		await Promise.all(tasks);
		expect(maximumActive).toBe(2);
		expect(gate.activeCount).toBe(0);
	});

	it("releases a slot when a task rejects", async () => {
		const gate = createConcurrencyGate(1);
		await expect(
			gate.run(async () => {
				throw new Error("failed");
			}),
		).rejects.toThrow("failed");
		await expect(gate.run(async () => "next")).resolves.toBe("next");
	});
});
