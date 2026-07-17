import { describe, expect, it } from "vitest";

import {
	createSoakObservations,
	getStateIntervalMinutes,
	resolveReliabilitySoakPlan,
	summarizeSoakOutcome,
} from "./reliability-soak-plan.mjs";

describe("reliability soak plans", () => {
	it("uses a same-day scheduled rerun by default", () => {
		expect(resolveReliabilitySoakPlan()).toEqual({
			profile: "same-day",
			roundCount: 2,
			intervalMinutes: 60,
		});
	});

	it("keeps the legacy 72-hour profile available", () => {
		expect(resolveReliabilitySoakPlan({ profile: "72h" })).toEqual({
			profile: "72h",
			roundCount: 4,
			intervalMinutes: 1440,
		});
	});

	it("supports short acceptance intervals without changing the profile", () => {
		expect(
			resolveReliabilitySoakPlan({ rounds: "2", intervalMinutes: "5" }),
		).toEqual({
			profile: "same-day",
			roundCount: 2,
			intervalMinutes: 5,
		});
	});

	it("schedules the default verification inside one day", () => {
		const observations = createSoakObservations({
			startedAt: new Date("2026-07-17T01:00:00.000Z"),
			roundCount: 2,
			intervalMinutes: 60,
		});
		expect(observations.map((item) => item.dueAt)).toEqual([
			"2026-07-17T01:00:00.000Z",
			"2026-07-17T02:00:00.000Z",
		]);
	});

	it("reads version-one hour-based state files", () => {
		expect(getStateIntervalMinutes({ intervalHours: 24 })).toBe(1440);
	});

	it("separates a successful timer from provider sample failures", () => {
		expect(
			summarizeSoakOutcome([
				{ runId: "run-1", startedAt: "start-1", status: "completed" },
				{ runId: "run-2", startedAt: "start-2", status: "partial" },
			]),
		).toEqual({
			scheduleOutcome: "passed",
			collectionOutcome: "completed_with_failures",
			outcome: "completed_with_failures",
		});
	});
});
