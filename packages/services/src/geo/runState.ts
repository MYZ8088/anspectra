import { ValidationError } from "@anspectra/errors";
import type { RunStatus } from "@anspectra/types";

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
	queued: ["waiting_runner", "running", "failed", "cancelled"],
	waiting_runner: ["queued", "running", "failed", "cancelled"],
	running: [
		"cooling_down",
		"waiting_human",
		"partial",
		"completed",
		"failed",
		"cancelled",
	],
	cooling_down: ["running", "waiting_human", "partial", "failed", "cancelled"],
	waiting_human: ["running", "partial", "failed", "cancelled"],
	partial: ["running", "completed", "failed", "cancelled"],
	completed: [],
	failed: [],
	cancelled: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
	return from === to || TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
	if (!canTransitionRun(from, to)) {
		throw new ValidationError(
			`Invalid collection run transition: ${from} -> ${to}`,
		);
	}
}

export function getNextRetestObservation(
	observationDays: readonly number[],
	completedDays: readonly number[],
): number | undefined {
	const completed = new Set(completedDays);
	return [...observationDays]
		.sort((left, right) => left - right)
		.find((day) => !completed.has(day));
}
