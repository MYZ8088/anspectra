import { describe, expect, it } from "vitest";
import {
	COLLECTOR_RESTART_WARNING,
	buildCollectorRestartCheckpointPatch,
} from "./collectorRestart.js";

describe("buildCollectorRestartCheckpointPatch", () => {
	it("returns an interrupted sample to a clean resumable checkpoint", () => {
		const now = new Date("2026-07-16T08:00:00.000Z");

		expect(buildCollectorRestartCheckpointPatch(now)).toEqual({
			status: "queued",
			phase: "queued",
			conversationId: null,
			conversationUrl: null,
			sourceExposure: null,
			actualMode: null,
			failureCategory: null,
			errorCode: null,
			errorMessage: null,
			retryable: null,
			warningCode: COLLECTOR_RESTART_WARNING,
			startedAt: null,
			completedAt: null,
			lastEventAt: now,
			updatedAt: now,
		});
	});
});
