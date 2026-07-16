import { describe, expect, it } from "vitest";
import { summarizeCollectionCheckpointStatuses } from "./runCounters.js";

describe("summarizeCollectionCheckpointStatuses", () => {
	it("counts current checkpoint outcomes without retaining an earlier cancellation", () => {
		expect(
			summarizeCollectionCheckpointStatuses([
				"completed",
				"completed",
				"failed",
				"queued",
				"running",
				"retrying",
			]),
		).toEqual({ completed: 2, failed: 1 });
	});

	it("treats terminal unattempted states as failures in the run denominator", () => {
		expect(
			summarizeCollectionCheckpointStatuses([
				"not_attempted",
				"cancelled",
				"waiting_human",
			]),
		).toEqual({ completed: 0, failed: 2 });
	});
});
