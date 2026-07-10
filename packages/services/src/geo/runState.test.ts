import { describe, expect, it } from "vitest";
import {
	assertRunTransition,
	canTransitionRun,
	getNextRetestObservation,
} from "./runState.js";

describe("collection run state machine", () => {
	it("pauses and resumes a human verification without terminal failure", () => {
		expect(canTransitionRun("running", "waiting_human")).toBe(true);
		expect(canTransitionRun("waiting_human", "running")).toBe(true);
	});

	it("does not reopen a completed run", () => {
		expect(canTransitionRun("completed", "running")).toBe(false);
		expect(() => assertRunTransition("completed", "running")).toThrow(
			"Invalid collection run transition",
		);
	});

	it("advances paired retests through T+7, T+14 and T+30", () => {
		expect(getNextRetestObservation([7, 14, 30], [])).toBe(7);
		expect(getNextRetestObservation([7, 14, 30], [7])).toBe(14);
		expect(getNextRetestObservation([7, 14, 30], [14, 7])).toBe(30);
		expect(getNextRetestObservation([7, 14, 30], [7, 14, 30])).toBeUndefined();
	});
});
