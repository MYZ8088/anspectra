import { describe, expect, it } from "vitest";
import { decideStaleRunRecovery } from "./runRecovery.js";

const minute = 60 * 1000;
const hour = 60 * minute;

describe("stale collection recovery", () => {
	it("ignores a run that is still reporting progress", () => {
		expect(
			decideStaleRunRecovery({
				nowMs: 30 * minute,
				updatedAtMs: 15 * minute,
				hasOpenCheckpoints: true,
				hasLiveQueueJob: false,
			}),
		).toBe("ignore");
	});

	it("keeps a stale database row when BullMQ still owns the run", () => {
		expect(
			decideStaleRunRecovery({
				nowMs: 2 * hour,
				updatedAtMs: 0,
				hasOpenCheckpoints: true,
				hasLiveQueueJob: true,
			}),
		).toBe("keep_live");
	});

	it("requeues recent orphaned work", () => {
		expect(
			decideStaleRunRecovery({
				nowMs: 2 * hour,
				updatedAtMs: 0,
				hasOpenCheckpoints: true,
				hasLiveQueueJob: false,
			}),
		).toBe("requeue");
	});

	it("expires orphaned work after the recovery window", () => {
		expect(
			decideStaleRunRecovery({
				nowMs: 25 * hour,
				updatedAtMs: 0,
				hasOpenCheckpoints: true,
				hasLiveQueueJob: false,
			}),
		).toBe("expire");
	});
});
