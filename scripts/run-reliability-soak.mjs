import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
	getGeoRunDetail,
	runProviderSmoke,
} from "../packages/services/dist/index.js";
import {
	createSoakObservations,
	getStateIntervalMinutes,
	resolveReliabilitySoakPlan,
	summarizeSoakOutcome,
} from "./lib/reliability-soak-plan.mjs";

const DEFAULT_PROVIDERS = ["doubao", "deepseek", "hunyuan", "qwen"];
const TERMINAL_STATUSES = new Set([
	"completed",
	"partial",
	"failed",
	"cancelled",
]);

function readArg(name) {
	const prefix = `--${name}=`;
	return process.argv
		.find((value) => value.startsWith(prefix))
		?.slice(prefix.length);
}

function positiveNumber(value, fallback, label) {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive number`);
	}
	return parsed;
}

function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function nowIso() {
	return new Date().toISOString();
}

async function readState(statePath) {
	try {
		return JSON.parse(await readFile(statePath, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

async function writeState(statePath, state) {
	await mkdir(path.dirname(statePath), { recursive: true });
	const temporaryPath = `${statePath}.${process.pid}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	await rename(temporaryPath, statePath);
}

function createState({
	workspaceId,
	userId,
	providers,
	profile,
	roundCount,
	intervalMinutes,
	seedRunId,
	seedSeriesId,
}) {
	const startedAt = new Date();
	const observations = createSoakObservations({
		startedAt,
		roundCount,
		intervalMinutes,
		seedRunId,
		seedSeriesId,
	});
	return {
		version: 2,
		workspaceId,
		userId,
		providers,
		profile,
		startedAt: startedAt.toISOString(),
		intervalMinutes,
		roundCount,
		observations,
	};
}

function validateState(state, expected) {
	if (
		state.workspaceId !== expected.workspaceId ||
		state.userId !== expected.userId ||
		state.roundCount !== expected.roundCount ||
		getStateIntervalMinutes(state) !== expected.intervalMinutes ||
		JSON.stringify(state.providers) !== JSON.stringify(expected.providers)
	) {
		throw new Error(
			"The existing soak state does not match this invocation. Use a different --state path.",
		);
	}
}

async function refreshObservation(workspaceId, observation) {
	if (!observation.seriesId || TERMINAL_STATUSES.has(observation.status)) {
		return observation;
	}
	const detail = await getGeoRunDetail({
		workspaceId,
		seriesId: observation.seriesId,
	});
	const status = detail.series.status;
	return {
		...observation,
		status,
		completedSamples: detail.series.completedSamples,
		failedSamples: detail.series.failedSamples,
		lastCheckedAt: nowIso(),
		...(TERMINAL_STATUSES.has(status) ? { completedAt: nowIso() } : {}),
	};
}

async function main() {
	const workspaceId = readArg("workspace");
	const userId = readArg("user");
	if (!workspaceId || !userId) {
		throw new Error(
			"Usage: pnpm test:soak:same-day -- --workspace=<id> --user=<id> [--providers=doubao,deepseek,hunyuan,qwen]",
		);
	}

	const providers = (readArg("providers") ?? DEFAULT_PROVIDERS.join(","))
		.split(",")
		.map((provider) => provider.trim())
		.filter(Boolean);
	if (providers.length === 0)
		throw new Error("At least one provider is required");
	const plan = resolveReliabilitySoakPlan({
		profile: readArg("profile"),
		rounds: readArg("rounds"),
		intervalMinutes: readArg("interval-minutes"),
		intervalHours: readArg("interval-hours"),
	});
	const { profile, roundCount, intervalMinutes } = plan;
	const pollSeconds = positiveNumber(
		readArg("poll-seconds"),
		60,
		"poll-seconds",
	);
	const singlePass = process.argv.includes("--single-pass");
	const statePath = path.resolve(
		readArg("state") ??
			`.aloom-storage/soak/reliability-${profile}-${workspaceId}.json`,
	);
	const expected = {
		workspaceId,
		userId,
		providers,
		profile,
		roundCount,
		intervalMinutes,
	};
	let state = await readState(statePath);
	if (state) {
		validateState(state, expected);
		if (
			state.completedAt &&
			(!state.scheduleOutcome || !state.collectionOutcome)
		) {
			Object.assign(state, summarizeSoakOutcome(state.observations));
			await writeState(statePath, state);
		}
	} else {
		state = createState({
			...expected,
			seedRunId: readArg("seed-run"),
			seedSeriesId: readArg("seed-series"),
		});
		await writeState(statePath, state);
	}

	console.log(`[soak] state: ${statePath}`);
	console.log(
		`[soak] ${profile} profile: ${roundCount} rounds, ${intervalMinutes}m interval, providers: ${providers.join(", ")}`,
	);

	while (!state.completedAt) {
		for (let index = 0; index < state.observations.length; index += 1) {
			const observation = state.observations[index];
			if (!observation) continue;
			try {
				state.observations[index] = await refreshObservation(
					workspaceId,
					observation,
				);
			} catch (error) {
				state.observations[index] = {
					...observation,
					lastCheckedAt: nowIso(),
					lastCheckError:
						error instanceof Error ? error.message : String(error),
				};
			}
		}

		const due = state.observations.find(
			(observation) =>
				!observation.runId && Date.parse(observation.dueAt) <= Date.now(),
		);
		if (due) {
			try {
				console.log(`[soak] starting round ${due.round}/${roundCount}`);
				const run = await runProviderSmoke({ workspaceId, userId, providers });
				const startedAt = nowIso();
				Object.assign(due, {
					startedAt,
					triggerDelayMs: Math.max(
						0,
						Date.parse(startedAt) - Date.parse(due.dueAt),
					),
					runId: run.id,
					seriesId: run.seriesId,
					status: run.status,
				});
			} catch (error) {
				due.lastStartAttemptAt = nowIso();
				due.lastStartError =
					error instanceof Error ? error.message : String(error);
				console.error(
					`[soak] round ${due.round} could not start: ${due.lastStartError}`,
				);
			}
		}

		const terminal = state.observations.every(
			(observation) =>
				observation.runId && TERMINAL_STATUSES.has(observation.status),
		);
		if (terminal) {
			state.completedAt = nowIso();
			Object.assign(state, summarizeSoakOutcome(state.observations));
			console.log(
				`[soak] schedule: ${state.scheduleOutcome}; collection: ${state.collectionOutcome}`,
			);
		}
		await writeState(statePath, state);
		if (!state.completedAt && singlePass) {
			const hasActiveRound = state.observations.some(
				(observation) =>
					observation.runId && !TERMINAL_STATUSES.has(observation.status),
			);
			const hasDueRound = state.observations.some(
				(observation) =>
					!observation.runId && Date.parse(observation.dueAt) <= Date.now(),
			);
			if (!hasActiveRound && !hasDueRound) return;
		}
		if (!state.completedAt) await sleep(pollSeconds * 1000);
	}
}

main().then(
	() => process.exit(0),
	(error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	},
);
