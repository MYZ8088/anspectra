import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
	getGeoRunDetail,
	runProviderSmoke,
} from "../packages/services/dist/index.js";

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
	roundCount,
	intervalHours,
	seedRunId,
	seedSeriesId,
}) {
	const startedAt = new Date();
	const observations = Array.from({ length: roundCount }, (_, index) => ({
		round: index + 1,
		dueAt: new Date(
			startedAt.getTime() + index * intervalHours * 60 * 60 * 1000,
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
	return {
		version: 1,
		workspaceId,
		userId,
		providers,
		startedAt: startedAt.toISOString(),
		intervalHours,
		roundCount,
		observations,
	};
}

function validateState(state, expected) {
	if (
		state.workspaceId !== expected.workspaceId ||
		state.userId !== expected.userId ||
		state.roundCount !== expected.roundCount ||
		state.intervalHours !== expected.intervalHours ||
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
			"Usage: pnpm test:soak:72h -- --workspace=<id> --user=<id> [--providers=doubao,deepseek,hunyuan,qwen]",
		);
	}

	const providers = (readArg("providers") ?? DEFAULT_PROVIDERS.join(","))
		.split(",")
		.map((provider) => provider.trim())
		.filter(Boolean);
	if (providers.length === 0)
		throw new Error("At least one provider is required");
	const roundCount = positiveNumber(readArg("rounds"), 4, "rounds");
	const intervalHours = positiveNumber(
		readArg("interval-hours"),
		24,
		"interval-hours",
	);
	const pollSeconds = positiveNumber(
		readArg("poll-seconds"),
		60,
		"poll-seconds",
	);
	const singlePass = process.argv.includes("--single-pass");
	const statePath = path.resolve(
		readArg("state") ??
			`.aloom-storage/soak/reliability-72h-${workspaceId}.json`,
	);
	const expected = {
		workspaceId,
		userId,
		providers,
		roundCount,
		intervalHours,
	};
	let state = await readState(statePath);
	if (state) {
		validateState(state, expected);
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
		`[soak] ${roundCount} rounds, ${intervalHours}h interval, providers: ${providers.join(", ")}`,
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
				Object.assign(due, {
					startedAt: nowIso(),
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
			state.outcome = state.observations.every(
				(observation) => observation.status === "completed",
			)
				? "passed"
				: "completed_with_failures";
			console.log(`[soak] finished: ${state.outcome}`);
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

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
