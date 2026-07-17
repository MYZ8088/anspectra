export const RELIABILITY_SOAK_PROFILES = Object.freeze({
	"same-day": Object.freeze({
		roundCount: 2,
		intervalMinutes: 60,
	}),
	"72h": Object.freeze({
		roundCount: 4,
		intervalMinutes: 24 * 60,
	}),
});

function positiveNumber(value, fallback, label) {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive number`);
	}
	return parsed;
}

export function resolveReliabilitySoakPlan({
	profile = "same-day",
	rounds,
	intervalMinutes,
	intervalHours,
} = {}) {
	const preset = RELIABILITY_SOAK_PROFILES[profile];
	if (!preset) {
		throw new Error(
			`profile must be one of: ${Object.keys(RELIABILITY_SOAK_PROFILES).join(", ")}`,
		);
	}
	if (intervalMinutes !== undefined && intervalHours !== undefined) {
		throw new Error("Use either interval-minutes or interval-hours, not both");
	}

	return {
		profile,
		roundCount: positiveNumber(rounds, preset.roundCount, "rounds"),
		intervalMinutes:
			intervalMinutes !== undefined
				? positiveNumber(
						intervalMinutes,
						preset.intervalMinutes,
						"interval-minutes",
					)
				: positiveNumber(
						intervalHours,
						preset.intervalMinutes / 60,
						"interval-hours",
					) * 60,
	};
}

export function createSoakObservations({
	startedAt,
	roundCount,
	intervalMinutes,
	seedRunId,
	seedSeriesId,
}) {
	const observations = Array.from({ length: roundCount }, (_, index) => ({
		round: index + 1,
		dueAt: new Date(
			startedAt.getTime() + index * intervalMinutes * 60 * 1000,
		).toISOString(),
		status: "scheduled",
	}));
	if (seedRunId && seedSeriesId) {
		observations[0] = {
			...observations[0],
			startedAt: startedAt.toISOString(),
			runId: seedRunId,
			seriesId: seedSeriesId,
			status: "running",
		};
	}
	return observations;
}

export function getStateIntervalMinutes(state) {
	if (Number.isFinite(state.intervalMinutes)) return state.intervalMinutes;
	if (Number.isFinite(state.intervalHours)) return state.intervalHours * 60;
	return null;
}

export function summarizeSoakOutcome(observations) {
	const scheduleOutcome = observations.every(
		(observation) => observation.runId && observation.startedAt,
	)
		? "passed"
		: "failed";
	const collectionOutcome = observations.every(
		(observation) => observation.status === "completed",
	)
		? "passed"
		: "completed_with_failures";
	return {
		scheduleOutcome,
		collectionOutcome,
		// Keep the original field for state-file compatibility.
		outcome: collectionOutcome,
	};
}
