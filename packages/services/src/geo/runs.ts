import { randomUUID } from "node:crypto";
import { clickhouse, db, schema } from "@aloom/db";
import { NotFoundError, ValidationError } from "@aloom/errors";
import type {
	AskPromptResult,
	BrandAnalysisResult,
	Provider,
	ProviderMode,
	SampleAttemptEvent,
	SamplingDepth,
	UserPrompt,
} from "@aloom/types";
import { GEO_PROVIDER_MODE_CAPABILITIES } from "@aloom/types";
import { formatDateToClickHouse } from "@aloom/utils";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lte,
	sql,
} from "drizzle-orm";
import { readAuthenticatedRuntimeProviders } from "../agent/auth.js";
import {
	buildProviderCancelKey,
	buildProviderJobId,
	enqueueProviderJobs,
	initializeAgentProgress,
} from "../agent/jobs.js";
import { clearProviderChallenge } from "../agent/progress.js";
import { getProviderQueue } from "../agent/queue.js";
import { redis, waitForRedis } from "../agent/redis.js";
import { parseAnalysisOutput } from "../analysis/runAnalysis.js";
import { classifyAnalysisFailureCode } from "./analysisFailure.js";
import { buildCollectorRestartCheckpointPatch } from "./collectorRestart.js";
import { findConflictingConversationPrompt } from "./conversationIsolation.js";
import { calculateDifferenceInDifferences } from "./experimentCohorts.js";
import { samplingDepthRoundCount } from "./promptEngine.js";
import { getProfileCompleteness } from "./promptLibrary.js";
import { assertPromptSetLocales } from "./promptSetLocale.js";
import { summarizeCollectionCheckpointStatuses } from "./runCounters.js";
import { STALE_RUN_DEFAULTS, decideStaleRunRecovery } from "./runRecovery.js";
import { getNextRetestObservation } from "./runState.js";

export const GEO_WEB_PROVIDERS = [
	"doubao",
	"deepseek",
	"hunyuan",
	"qwen",
] as const satisfies readonly Provider[];

const DAILY_PROVIDER_SAMPLE_LIMIT = 30;
const PROVIDER_WINDOW_CHANNEL = "aloom:agent:provider-window";

function promptSetSamplingDepth(promptSet: {
	tier: string;
	manifest: Record<string, unknown> | null;
}): SamplingDepth {
	const configured = promptSet.manifest?.samplingDepth;
	if (
		configured === "single" ||
		configured === "reliable" ||
		configured === "stability"
	) {
		return configured;
	}
	return promptSet.tier === "quick"
		? "single"
		: promptSet.tier === "standard"
			? "reliable"
			: "stability";
}

function percentageValue(numerator: number, denominator: number) {
	return denominator > 0
		? Math.round((numerator / denominator) * 10_000) / 100
		: 0;
}

function asUserPrompts(args: {
	rows: Array<{ id: string; prompt: string; createdAt: Date }>;
	workspaceId: string;
	userId: string;
}): UserPrompt[] {
	return args.rows.map((row) => ({
		id: row.id,
		prompt: row.prompt,
		workspace_id: args.workspaceId,
		user_id: args.userId,
		created_at: row.createdAt.toISOString(),
	}));
}

async function loadRunPromptRows(promptSetId: string, promptIds?: string[]) {
	return db.query.monitorPrompts.findMany({
		where: and(
			eq(schema.monitorPrompts.promptSetId, promptSetId),
			eq(schema.monitorPrompts.active, true),
			promptIds?.length
				? inArray(schema.monitorPrompts.id, promptIds)
				: undefined,
		),
		orderBy: [asc(schema.monitorPrompts.createdAt)],
	});
}

async function getCompletedToday(workspaceId: string, provider: Provider) {
	const start = new Date();
	start.setHours(0, 0, 0, 0);
	const [row] = await db
		.select({ value: count() })
		.from(schema.sampleCheckpoints)
		.innerJoin(
			schema.collectionRuns,
			eq(schema.sampleCheckpoints.runId, schema.collectionRuns.id),
		)
		.where(
			and(
				eq(schema.collectionRuns.workspaceId, workspaceId),
				eq(schema.sampleCheckpoints.provider, provider),
				eq(schema.sampleCheckpoints.status, "completed"),
				gte(schema.sampleCheckpoints.completedAt, start),
			),
		);
	return row?.value ?? 0;
}

function chunkRows<T>(
	rows: T[],
	firstCapacity: number,
	capacity: number,
): T[][] {
	if (rows.length === 0) return [];
	const chunks: T[][] = [];
	let cursor = 0;
	const safeFirstCapacity = Math.max(1, Math.min(firstCapacity, capacity));
	chunks.push(rows.slice(0, safeFirstCapacity));
	cursor = safeFirstCapacity;
	while (cursor < rows.length) {
		chunks.push(rows.slice(cursor, cursor + capacity));
		cursor += capacity;
	}
	return chunks.filter((chunk) => chunk.length > 0);
}

async function refreshCollectionSeries(seriesId?: string | null) {
	if (!seriesId) return;
	const runs = await db.query.collectionRuns.findMany({
		where: eq(schema.collectionRuns.seriesId, seriesId),
	});
	if (runs.length === 0) return;
	const runIds = runs.map((run) => run.id);
	const checkpoints = await db.query.sampleCheckpoints.findMany({
		where: inArray(schema.sampleCheckpoints.runId, runIds),
	});
	const completed = checkpoints.filter(
		(item) => item.status === "completed",
	).length;
	const failed = checkpoints.filter((item) =>
		["failed", "not_attempted", "cancelled"].includes(item.status),
	).length;
	const waiting = checkpoints.filter(
		(item) => item.status === "waiting_human",
	).length;
	const terminal = completed + failed;
	const allTerminal = checkpoints.length > 0 && terminal >= checkpoints.length;
	const anyRunning = runs.some((run) =>
		["running", "waiting_runner"].includes(run.status),
	);
	const anyQueued = runs.some((run) => run.status === "queued");
	const status = allTerminal
		? completed === checkpoints.length
			? "completed"
			: completed > 0
				? "partial"
				: "failed"
		: waiting > 0 && !anyRunning
			? "waiting_human"
			: anyRunning
				? "running"
				: anyQueued
					? "scheduled"
					: "queued";
	await db
		.update(schema.collectionSeries)
		.set({
			status,
			completedSamples: completed,
			failedSamples: failed,
			waitingSamples: waiting,
			completedAt: allTerminal ? new Date() : null,
			updatedAt: new Date(),
		})
		.where(eq(schema.collectionSeries.id, seriesId));
}

export async function refreshGeoCollectionRunCounters(
	runId: string,
	now = new Date(),
) {
	const checkpoints = await db.query.sampleCheckpoints.findMany({
		where: eq(schema.sampleCheckpoints.runId, runId),
		columns: { status: true },
	});
	const summary = summarizeCollectionCheckpointStatuses(
		checkpoints.map((checkpoint) => checkpoint.status),
	);
	await db
		.update(schema.collectionRuns)
		.set({
			completedSamples: summary.completed,
			failedSamples: summary.failed,
			updatedAt: now,
		})
		.where(eq(schema.collectionRuns.id, runId));
	return summary;
}

async function persistTerminalFailuresToAnalytics(args: {
	run: typeof schema.collectionRuns.$inferSelect;
	checkpoints: Array<typeof schema.sampleCheckpoints.$inferSelect>;
}) {
	const failures = args.checkpoints.filter((checkpoint) =>
		["failed", "not_attempted", "cancelled"].includes(checkpoint.status),
	);
	if (failures.length === 0) return;
	const promptIds = failures
		.map((checkpoint) => checkpoint.promptId)
		.filter((id): id is string => Boolean(id));
	const prompts = promptIds.length
		? await db.query.monitorPrompts.findMany({
				where: inArray(schema.monitorPrompts.id, [...new Set(promptIds)]),
			})
		: [];
	const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
	const metadata = (args.run.metadata ?? {}) as { userId?: string };
	const promptRunAt = formatDateToClickHouse(
		args.run.startedAt ?? args.run.scheduledAt ?? args.run.createdAt,
	);
	await clickhouse.insert({
		table: "analytics.answer_samples_v2",
		format: "JSONEachRow",
		values: failures.map((checkpoint) => {
			const prompt = checkpoint.promptId
				? promptById.get(checkpoint.promptId)
				: undefined;
			return {
				id: checkpoint.id,
				legacy_response_id: null,
				run_id: args.run.id,
				checkpoint_id: checkpoint.id,
				prompt_set_id: args.run.promptSetId,
				series_id: args.run.seriesId,
				prompt_id: checkpoint.promptId ?? "",
				prompt: prompt?.prompt ?? "",
				prompt_group: prompt?.promptGroup ?? "",
				prompt_hash: prompt?.promptHash ?? "",
				prompt_origin: prompt?.origin ?? "legacy",
				decision_stage: prompt?.decisionStage ?? "",
				locale: prompt?.locale ?? "",
				brand_exposure: prompt?.brandExposure ?? "",
				repeat_index: checkpoint.repeatIndex,
				user_id: metadata.userId ?? "collector",
				workspace_id: args.run.workspaceId,
				model: checkpoint.provider,
				model_provider: checkpoint.provider,
				response: "",
				sources: [],
				source_exposure: checkpoint.sourceExposure ?? "not_exposed",
				requested_mode: checkpoint.requestedMode,
				actual_mode: checkpoint.actualMode ?? checkpoint.requestedMode,
				conversation_id: checkpoint.conversationId,
				conversation_url: checkpoint.conversationUrl,
				conversation_isolation: "fresh",
				evidence_level: "live_web",
				account_state:
					checkpoint.failureCategory === "account"
						? "attention_required"
						: "unknown",
				region: "",
				network_fingerprint: "",
				status: checkpoint.status,
				error_code: checkpoint.errorCode,
				error_message: checkpoint.errorMessage,
				prompt_run_at: promptRunAt,
			};
		}),
	});
}

export async function recordGeoSampleAttempt(args: SampleAttemptEvent) {
	const checkpoint = await db.query.sampleCheckpoints.findFirst({
		where: and(
			eq(schema.sampleCheckpoints.runId, args.runId),
			eq(schema.sampleCheckpoints.promptId, args.promptId),
			eq(schema.sampleCheckpoints.provider, args.provider),
		),
	});
	if (!checkpoint) throw new NotFoundError("Sample checkpoint not found");
	if (checkpoint.status === "completed") {
		return { checkpointId: checkpoint.id, accepted: false };
	}
	const now = new Date();
	await db
		.insert(schema.sampleAttempts)
		.values({
			checkpointId: checkpoint.id,
			attemptIndex: args.attemptIndex,
			status: args.status,
			phase: args.phase,
			failureCategory: args.failureCategory ?? null,
			failureCode: args.failureCode ?? null,
			failureMessage: args.failureMessage ?? null,
			retryable: args.retryable ?? null,
			pageUrl: args.pageUrl ?? null,
			conversationId: args.conversationId ?? null,
			diagnostics: args.diagnostics ?? {},
			startedAt: now,
			completedAt:
				args.status === "completed" || args.status === "failed" ? now : null,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				schema.sampleAttempts.checkpointId,
				schema.sampleAttempts.attemptIndex,
			],
			set: {
				status: args.status,
				phase: args.phase,
				failureCategory: args.failureCategory ?? null,
				failureCode: args.failureCode ?? null,
				failureMessage: args.failureMessage ?? null,
				retryable: args.retryable ?? null,
				pageUrl: args.pageUrl ?? null,
				conversationId: args.conversationId ?? null,
				diagnostics: args.diagnostics ?? {},
				completedAt:
					args.status === "completed" || args.status === "failed" ? now : null,
				updatedAt: now,
			},
		});
	const collectionStatus =
		args.status === "failed"
			? args.retryable
				? "retrying"
				: "failed"
			: args.status === "completed"
				? "running"
				: "running";
	await db
		.update(schema.sampleCheckpoints)
		.set({
			status: collectionStatus,
			phase: args.phase,
			requestedMode: args.requestedMode ?? checkpoint.requestedMode,
			actualMode: args.actualMode ?? checkpoint.actualMode,
			attemptCount: sql`greatest(${schema.sampleCheckpoints.attemptCount}, ${args.attemptIndex})`,
			failureCategory: args.failureCategory ?? null,
			errorCode: args.failureCode ?? null,
			errorMessage: args.failureMessage ?? null,
			retryable: args.retryable ?? null,
			conversationId: args.conversationId ?? checkpoint.conversationId,
			startedAt: checkpoint.startedAt ?? now,
			completedAt: args.status === "failed" && !args.retryable ? now : null,
			lastEventAt: now,
			updatedAt: now,
		})
		.where(eq(schema.sampleCheckpoints.id, checkpoint.id));
	if (collectionStatus === "failed") {
		await refreshGeoCollectionRunCounters(args.runId, now);
	} else {
		await db
			.update(schema.collectionRuns)
			.set({ updatedAt: now })
			.where(eq(schema.collectionRuns.id, args.runId));
	}
	const run = await db.query.collectionRuns.findFirst({
		where: eq(schema.collectionRuns.id, args.runId),
	});
	await refreshCollectionSeries(run?.seriesId);
	return { checkpointId: checkpoint.id, accepted: true };
}

export async function markGeoAnalysisRunning(runId: string) {
	await db
		.update(schema.sampleCheckpoints)
		.set({
			analysisStatus: "running",
			analysisErrorCode: null,
			analysisErrorMessage: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(schema.sampleCheckpoints.runId, runId),
				eq(schema.sampleCheckpoints.status, "completed"),
				eq(schema.sampleCheckpoints.analysisStatus, "pending"),
			),
		);
}

export async function completeGeoAnalysis(args: {
	runId: string;
	errors?: Array<{ responseId: string; error: string }>;
	processedResponseIds?: string[];
	fatalError?: string;
}) {
	const checkpoints = await db.query.sampleCheckpoints.findMany({
		where: and(
			eq(schema.sampleCheckpoints.runId, args.runId),
			eq(schema.sampleCheckpoints.status, "completed"),
		),
	});
	const errors = new Map(
		(args.errors ?? []).map((error) => [error.responseId, error.error]),
	);
	const processed = args.processedResponseIds
		? new Set(args.processedResponseIds)
		: null;
	for (const checkpoint of checkpoints) {
		if (
			!args.fatalError &&
			processed &&
			(!checkpoint.analyticsSampleId ||
				!processed.has(checkpoint.analyticsSampleId))
		) {
			continue;
		}
		const error =
			args.fatalError ??
			(checkpoint.analyticsSampleId
				? errors.get(checkpoint.analyticsSampleId)
				: undefined);
		await db
			.update(schema.sampleCheckpoints)
			.set({
				analysisStatus: error ? "failed" : "completed",
				analysisErrorCode: error ? classifyAnalysisFailureCode(error) : null,
				analysisErrorMessage: error ?? null,
				updatedAt: new Date(),
			})
			.where(eq(schema.sampleCheckpoints.id, checkpoint.id));
	}
}

export async function retryGeoAnalysis(args: {
	workspaceId: string;
	checkpointIds: string[];
}) {
	const requestedIds = [...new Set(args.checkpointIds)];
	if (requestedIds.length === 0) return { requeued: 0, skipped: 0 };
	const checkpoints = await db.query.sampleCheckpoints.findMany({
		where: inArray(schema.sampleCheckpoints.id, requestedIds),
	});
	const runIds = [
		...new Set(checkpoints.map((checkpoint) => checkpoint.runId)),
	];
	const runs = runIds.length
		? await db.query.collectionRuns.findMany({
				where: and(
					inArray(schema.collectionRuns.id, runIds),
					eq(schema.collectionRuns.workspaceId, args.workspaceId),
				),
			})
		: [];
	const allowedRuns = new Set(runs.map((run) => run.id));
	const retryableIds = checkpoints
		.filter(
			(checkpoint) =>
				allowedRuns.has(checkpoint.runId) &&
				checkpoint.status === "completed" &&
				checkpoint.analysisStatus === "failed" &&
				Boolean(checkpoint.analyticsSampleId),
		)
		.map((checkpoint) => checkpoint.id);
	if (retryableIds.length > 0) {
		await db
			.update(schema.sampleCheckpoints)
			.set({
				analysisStatus: "pending",
				analysisErrorCode: null,
				analysisErrorMessage: null,
				updatedAt: new Date(),
			})
			.where(inArray(schema.sampleCheckpoints.id, retryableIds));
	}
	return {
		requeued: retryableIds.length,
		skipped: requestedIds.length - retryableIds.length,
	};
}

export type RecoverableGeoAnalysisRun = {
	collectionRunId: string;
	workspaceId: string;
	userId: string;
	provider: Provider;
};

export async function listRecoverableGeoAnalysisRuns(
	limit = 100,
): Promise<RecoverableGeoAnalysisRun[]> {
	const checkpoints = await db.query.sampleCheckpoints.findMany({
		where: and(
			eq(schema.sampleCheckpoints.status, "completed"),
			inArray(schema.sampleCheckpoints.analysisStatus, ["pending", "running"]),
		),
		orderBy: [asc(schema.sampleCheckpoints.updatedAt)],
		limit: Math.max(1, Math.min(limit, 500)),
	});
	const usable = checkpoints.filter(
		(checkpoint) => checkpoint.analyticsSampleId,
	);
	const runIds = [...new Set(usable.map((checkpoint) => checkpoint.runId))];
	if (runIds.length === 0) return [];
	const runs = await db.query.collectionRuns.findMany({
		where: inArray(schema.collectionRuns.id, runIds),
	});
	const runById = new Map(runs.map((run) => [run.id, run]));
	const queued = new Map<string, RecoverableGeoAnalysisRun>();
	for (const checkpoint of usable) {
		const run = runById.get(checkpoint.runId);
		const provider = checkpoint.provider as Provider;
		if (!run || !GEO_WEB_PROVIDERS.includes(provider as never)) continue;
		const metadata = (run.metadata ?? {}) as { userId?: string };
		queued.set(run.id, {
			collectionRunId: run.id,
			workspaceId: run.workspaceId,
			userId: metadata.userId ?? "analysis-recovery",
			provider,
		});
	}
	return [...queued.values()];
}

async function hasLiveQueueJob(
	runId: string,
	providers: Provider[],
): Promise<boolean> {
	try {
		for (const provider of providers) {
			const jobs = await getProviderQueue(provider).getJobs(
				["active", "waiting", "delayed", "paused"],
				0,
				1000,
				true,
			);
			if (
				jobs.some(
					(job) =>
						job.data?.collectionRunId === runId ||
						job.data?.jobGroupId === runId,
				)
			) {
				return true;
			}
		}
		return false;
	} catch {
		// Queue uncertainty must never cause a live collection to be expired.
		return true;
	}
}

export async function reconcileStaleGeoCollectionRuns(args?: {
	now?: Date;
	staleAfterMs?: number;
	expireAfterMs?: number;
	limit?: number;
}): Promise<{
	examined: number;
	requeued: number;
	expired: number;
	finalized: number;
	keptLive: number;
}> {
	const now = args?.now ?? new Date();
	const staleAfterMs = args?.staleAfterMs ?? STALE_RUN_DEFAULTS.staleAfterMs;
	const expireAfterMs = args?.expireAfterMs ?? STALE_RUN_DEFAULTS.expireAfterMs;
	const candidates = await db.query.collectionRuns.findMany({
		where: and(
			inArray(schema.collectionRuns.status, ["running", "waiting_runner"]),
			lte(
				schema.collectionRuns.updatedAt,
				new Date(now.getTime() - staleAfterMs),
			),
			isNull(schema.collectionRuns.collectorNodeId),
		),
		orderBy: [asc(schema.collectionRuns.updatedAt)],
		limit: Math.max(1, Math.min(args?.limit ?? 100, 500)),
	});
	const summary = {
		examined: candidates.length,
		requeued: 0,
		expired: 0,
		finalized: 0,
		keptLive: 0,
	};

	for (const run of candidates) {
		const checkpoints = await db.query.sampleCheckpoints.findMany({
			where: eq(schema.sampleCheckpoints.runId, run.id),
		});
		const open = checkpoints.filter((checkpoint) =>
			["queued", "running", "retrying"].includes(checkpoint.status),
		);
		const completed = checkpoints.filter(
			(checkpoint) => checkpoint.status === "completed",
		).length;
		const failed = checkpoints.filter((checkpoint) =>
			["failed", "not_attempted", "cancelled"].includes(checkpoint.status),
		).length;

		if (open.length === 0 && checkpoints.length > 0) {
			await db
				.update(schema.collectionRuns)
				.set({
					status:
						completed === checkpoints.length
							? "completed"
							: completed > 0
								? "partial"
								: "failed",
					completedSamples: completed,
					failedSamples: failed,
					completedAt: now,
					updatedAt: now,
				})
				.where(eq(schema.collectionRuns.id, run.id));
			await refreshCollectionSeries(run.seriesId);
			summary.finalized += 1;
			continue;
		}

		const providers = [
			...new Set(
				open
					.map((checkpoint) => checkpoint.provider as Provider)
					.filter((provider) => GEO_WEB_PROVIDERS.includes(provider as never)),
			),
		];
		const liveQueueJob = await hasLiveQueueJob(run.id, providers);
		const action = decideStaleRunRecovery({
			nowMs: now.getTime(),
			updatedAtMs: run.updatedAt.getTime(),
			hasOpenCheckpoints: open.length > 0,
			hasLiveQueueJob: liveQueueJob,
			staleAfterMs,
			expireAfterMs,
		});
		if (action === "keep_live") {
			await db
				.update(schema.collectionRuns)
				.set({ updatedAt: now })
				.where(eq(schema.collectionRuns.id, run.id));
			summary.keptLive += 1;
			continue;
		}
		if (action === "ignore") continue;

		if (action === "requeue") {
			await db.transaction(async (tx) => {
				await tx
					.update(schema.sampleCheckpoints)
					.set({
						status: "queued",
						phase: "queued",
						failureCategory: null,
						errorCode: null,
						errorMessage: null,
						retryable: null,
						warningCode: "runtime_recovered",
						completedAt: null,
						lastEventAt: now,
						updatedAt: now,
					})
					.where(
						inArray(
							schema.sampleCheckpoints.id,
							open.map((checkpoint) => checkpoint.id),
						),
					);
				await tx
					.update(schema.collectionRuns)
					.set({
						status: "queued",
						scheduledAt: now,
						completedAt: null,
						updatedAt: now,
					})
					.where(eq(schema.collectionRuns.id, run.id));
			});
			await refreshCollectionSeries(run.seriesId);
			summary.requeued += 1;
			continue;
		}

		await db
			.update(schema.sampleCheckpoints)
			.set({
				status: "failed",
				phase: "recovery",
				failureCategory: "runtime",
				errorCode: "stale_run_expired",
				errorMessage:
					"Collection did not report progress and no live provider job remained within the recovery window",
				retryable: true,
				completedAt: now,
				lastEventAt: now,
				updatedAt: now,
			})
			.where(
				inArray(
					schema.sampleCheckpoints.id,
					open.map((checkpoint) => checkpoint.id),
				),
			);
		const terminalCheckpoints = await db.query.sampleCheckpoints.findMany({
			where: eq(schema.sampleCheckpoints.runId, run.id),
		});
		const terminalCompleted = terminalCheckpoints.filter(
			(checkpoint) => checkpoint.status === "completed",
		).length;
		const terminalFailed = terminalCheckpoints.length - terminalCompleted;
		const terminalStatus = terminalCompleted > 0 ? "partial" : "failed";
		await db
			.update(schema.collectionRuns)
			.set({
				status: terminalStatus,
				completedSamples: terminalCompleted,
				failedSamples: terminalFailed,
				completedAt: now,
				updatedAt: now,
			})
			.where(eq(schema.collectionRuns.id, run.id));
		await refreshCollectionSeries(run.seriesId);
		await persistTerminalFailuresToAnalytics({
			run: { ...run, status: terminalStatus, updatedAt: now, completedAt: now },
			checkpoints: terminalCheckpoints,
		}).catch(() => {});
		summary.expired += 1;
	}

	return summary;
}

export async function startGeoCollectionRun(args: {
	workspaceId: string;
	userId: string;
	promptSetId: string;
	providers?: Provider[];
	providerModes?: Partial<Record<Provider, ProviderMode>>;
	minPromptDelayMs?: number;
	maxPromptDelayMs?: number;
	requiredPurpose?: "baseline" | "diagnostic" | "retest";
	expectedLocales?: string[];
}) {
	const promptSet = await db.query.promptSets.findFirst({
		where: and(
			eq(schema.promptSets.id, args.promptSetId),
			eq(schema.promptSets.workspaceId, args.workspaceId),
		),
	});
	if (!promptSet) throw new NotFoundError("Prompt set not found");
	if (args.requiredPurpose && promptSet.purpose !== args.requiredPurpose) {
		throw new ValidationError(
			`This action requires a ${args.requiredPurpose} prompt set`,
		);
	}
	if (promptSet.purpose === "baseline") {
		const profile = await db.query.brandProfiles.findFirst({
			where: eq(schema.brandProfiles.workspaceId, args.workspaceId),
		});
		if (!profile) throw new ValidationError("Create the brand profile first");
		const completeness = getProfileCompleteness(profile);
		if (!completeness.complete || !completeness.confirmed) {
			throw new ValidationError(
				"Confirm a complete brand profile before starting a formal baseline",
			);
		}
	}

	const promptRows = await db.query.monitorPrompts.findMany({
		where: and(
			eq(schema.monitorPrompts.promptSetId, promptSet.id),
			eq(schema.monitorPrompts.active, true),
		),
		orderBy: [asc(schema.monitorPrompts.createdAt)],
	});
	if (promptRows.length === 0) throw new ValidationError("Prompt set is empty");
	if (promptSet.purpose === "baseline") {
		const formalManifest = (promptSet.manifest ?? {}) as {
			completePreset?: boolean;
			customPromptCount?: number;
			expectedPromptHashes?: string[];
			locales?: string[];
		};
		if (
			!["aloom-geo-detection-v1", "yao-full-geo-v1"].includes(
				promptSet.packKey ?? "",
			) ||
			formalManifest.completePreset !== true ||
			(formalManifest.customPromptCount ?? 0) !== 0 ||
			!formalManifest.expectedPromptHashes?.length ||
			promptRows.some((prompt) =>
				["user_custom", "legacy"].includes(prompt.origin),
			)
		) {
			throw new ValidationError(
				"Formal detection requires a complete preset-only run configuration",
			);
		}
		assertPromptSetLocales({
			expectedLocales: args.expectedLocales,
			manifestLocales: formalManifest.locales,
			promptLocales: promptRows.map((prompt) => prompt.locale),
		});
	}

	const requestedProviders = (
		args.providers?.length ? args.providers : [...GEO_WEB_PROVIDERS]
	).filter((provider) => GEO_WEB_PROVIDERS.includes(provider as never));
	const [localHeartbeat, collectors, connectedProfiles] = await Promise.all([
		redis.get("aloom:agent:heartbeat").catch(() => null),
		db.query.collectorNodes.findMany({
			where: eq(schema.collectorNodes.workspaceId, args.workspaceId),
			orderBy: [desc(schema.collectorNodes.lastHeartbeatAt)],
		}),
		db.query.providerProfiles.findMany({
			where: and(
				eq(schema.providerProfiles.workspaceId, args.workspaceId),
				eq(schema.providerProfiles.status, "connected"),
			),
		}),
	]);
	const remoteCollector = localHeartbeat
		? null
		: (collectors.find((node) =>
				connectedProfiles.some(
					(profile) => profile.collectorNodeId === node.id,
				),
			) ?? null);
	const remoteProfiles = remoteCollector
		? connectedProfiles.filter(
				(profile) => profile.collectorNodeId === remoteCollector.id,
			)
		: [];
	const providers = remoteCollector
		? requestedProviders.filter((provider) =>
				remoteProfiles.some((profile) => profile.provider === provider),
			)
		: await readAuthenticatedRuntimeProviders(requestedProviders);
	if (providers.length === 0) {
		throw new ValidationError(
			"Connect at least one real Web provider before starting",
		);
	}
	const providerModes = Object.fromEntries(
		providers.map((provider) => {
			const requested = args.providerModes?.[provider] ?? "default";
			const supported =
				GEO_PROVIDER_MODE_CAPABILITIES[
					provider as keyof typeof GEO_PROVIDER_MODE_CAPABILITIES
				];
			if (!supported?.includes(requested as never)) {
				throw new ValidationError(
					`${provider} does not support official Web mode "${requested}"`,
				);
			}
			return [provider, requested];
		}),
	) as Partial<Record<Provider, ProviderMode>>;

	const setManifest = (promptSet.manifest ?? {}) as {
		expectedPromptHashes?: string[];
		completePreset?: boolean;
	};
	if (promptSet.packKey && setManifest.expectedPromptHashes?.length) {
		const actualHashes = promptRows
			.map((prompt) => prompt.promptHash)
			.filter((hash): hash is string => Boolean(hash));
		if (
			actualHashes.length !== promptRows.length ||
			new Set(actualHashes).size !==
				new Set(setManifest.expectedPromptHashes).size ||
			setManifest.expectedPromptHashes.some(
				(hash) => !actualHashes.includes(hash),
			)
		) {
			throw new ValidationError(
				"Prompt set manifest does not match all active prompts",
			);
		}
	}

	const completedToday = await Promise.all(
		providers.map((provider) => getCompletedToday(args.workspaceId, provider)),
	);
	const availableToday = Math.max(
		0,
		Math.min(
			...completedToday.map(
				(completed) => DAILY_PROVIDER_SAMPLE_LIMIT - completed,
			),
		),
	);
	const firstDayDelayHours = availableToday > 0 ? 0 : 24;
	const firstRoundChunks = chunkRows(
		promptRows,
		availableToday || DAILY_PROVIDER_SAMPLE_LIMIT,
		DAILY_PROVIDER_SAMPLE_LIMIT,
	);
	const regularRoundChunks = chunkRows(
		promptRows,
		DAILY_PROVIDER_SAMPLE_LIMIT,
		DAILY_PROVIDER_SAMPLE_LIMIT,
	);
	const samplingDepth = promptSetSamplingDepth(promptSet);
	const roundCount = samplingDepthRoundCount(samplingDepth);
	const now = new Date();
	const plannedSamples = promptRows.length * providers.length * roundCount;
	const created = await db.transaction(async (tx) => {
		const [series] = await tx
			.insert(schema.collectionSeries)
			.values({
				workspaceId: args.workspaceId,
				promptSetId: promptSet.id,
				purpose: promptSet.purpose,
				status: firstDayDelayHours > 0 ? "scheduled" : "queued",
				tier: promptSet.tier,
				requiredProviders: providers,
				providerModes: Object.fromEntries(
					providers.map((provider) => [
						provider,
						[providerModes[provider] ?? "default"],
					]),
				),
				roundCount,
				plannedSamples,
				manifest: {
					promptSetManifest: promptSet.manifest,
					samplingDepth,
					expectedPromptHashes: promptRows.map((prompt) => prompt.promptHash),
					conversationIsolation: "fresh",
					sampleSource: "official_web",
					dailyProviderLimit: DAILY_PROVIDER_SAMPLE_LIMIT,
				},
			})
			.returning();
		if (!series) throw new Error("Failed to create collection series");
		const runs: Array<
			typeof schema.collectionRuns.$inferSelect & {
				promptRows: typeof promptRows;
			}
		> = [];
		let scheduleOffsetHours = firstDayDelayHours;
		for (let roundIndex = 1; roundIndex <= roundCount; roundIndex++) {
			const chunks = roundIndex === 1 ? firstRoundChunks : regularRoundChunks;
			for (const [batchIndex, batchRows] of chunks.entries()) {
				const scheduledAt = new Date(
					now.getTime() +
						(scheduleOffsetHours + batchIndex * 24) * 60 * 60 * 1000,
				);
				const [run] = await tx
					.insert(schema.collectionRuns)
					.values({
						workspaceId: args.workspaceId,
						promptSetId: promptSet.id,
						seriesId: series.id,
						collectorNodeId: remoteCollector?.id ?? null,
						status: "queued",
						tier: promptSet.tier,
						roundIndex,
						totalSamples: batchRows.length * providers.length,
						scheduledAt,
						metadata: {
							seriesId: series.id,
							providers,
							providerModes,
							userId: args.userId,
							promptIds: batchRows.map((prompt) => prompt.id),
							roundIndex,
							roundCount,
							batchIndex: batchIndex + 1,
							batchCount: chunks.length,
							conversationIsolation: "fresh",
							sampleSource: "official_web",
						},
					})
					.returning();
				if (!run) throw new Error("Failed to create collection batch");
				await tx.insert(schema.sampleCheckpoints).values(
					providers.flatMap((provider) =>
						batchRows.map((prompt) => ({
							runId: run.id,
							promptId: prompt.id,
							workspacePromptId: prompt.workspacePromptId,
							provider,
							repeatIndex: roundIndex - 1,
							status: "queued",
							phase: "queued",
							requestedMode: providerModes[provider] ?? "default",
							analysisStatus: "pending",
						})),
					),
				);
				runs.push({ ...run, promptRows: batchRows });
			}
			const lastBatchOffset =
				scheduleOffsetHours + Math.max(0, chunks.length - 1) * 24;
			scheduleOffsetHours =
				lastBatchOffset + (samplingDepth === "reliable" ? 6 : 24);
		}
		return { series, runs };
	});
	const first = created.runs[0];
	if (!first) throw new Error("Collection series has no batches");
	let failedProviders: Provider[] = [];
	const firstIsDue =
		!first.scheduledAt || first.scheduledAt.getTime() <= Date.now() + 1_000;
	if (firstIsDue && !remoteCollector) {
		await initializeAgentProgress({
			jobGroupId: first.id,
			providers,
			totalPrompts: first.promptRows.length,
		});
		failedProviders = await enqueueProviderJobs({
			jobGroupId: first.id,
			collectionRunId: first.id,
			prompts: asUserPrompts({
				rows: first.promptRows,
				workspaceId: args.workspaceId,
				userId: args.userId,
			}),
			userId: args.userId,
			workspaceId: args.workspaceId,
			providers,
			providerModes,
			totalPromptCount: first.promptRows.length,
			minPromptDelayMs: args.minPromptDelayMs ?? 3 * 60_000,
			maxPromptDelayMs: args.maxPromptDelayMs ?? 8 * 60_000,
		});
	}
	const firstStatus = !firstIsDue
		? "queued"
		: remoteCollector
			? "waiting_runner"
			: failedProviders.length === providers.length
				? "failed"
				: "running";
	await Promise.all([
		db
			.update(schema.collectionRuns)
			.set({
				status: firstStatus,
				startedAt: firstStatus === "running" ? new Date() : null,
				updatedAt: new Date(),
			})
			.where(eq(schema.collectionRuns.id, first.id)),
		db
			.update(schema.collectionSeries)
			.set({
				status:
					firstStatus === "running"
						? "running"
						: firstStatus === "waiting_runner"
							? "waiting_runner"
							: "scheduled",
				startedAt: firstStatus === "running" ? new Date() : null,
				updatedAt: new Date(),
			})
			.where(eq(schema.collectionSeries.id, created.series.id)),
	]);
	return {
		...first,
		status: firstStatus,
		seriesId: created.series.id,
		series: created.series,
		providers,
		failedProviders,
		scheduledRuns: created.runs
			.slice(1)
			.map(({ promptRows: _, ...run }) => run),
	};
}

export async function dispatchDueRetestExperiments(): Promise<number> {
	const now = new Date();
	const dueExperiments = await db.query.retestExperiments.findMany({
		where: and(
			eq(schema.retestExperiments.status, "scheduled"),
			lte(schema.retestExperiments.nextRunAt, now),
		),
		orderBy: [asc(schema.retestExperiments.nextRunAt)],
		limit: 10,
	});
	let dispatched = 0;
	for (const experiment of dueExperiments) {
		const baseline = experiment.baselineRunId
			? await db.query.collectionRuns.findFirst({
					where: eq(schema.collectionRuns.id, experiment.baselineRunId),
				})
			: null;
		const metadata = (baseline?.metadata ?? {}) as {
			providers?: Provider[];
			userId?: string;
		};
		const providers = (metadata.providers ?? []).filter((provider) =>
			GEO_WEB_PROVIDERS.includes(provider as never),
		);
		const observationDays = experiment.observationDays ?? [7, 14, 30];
		const completedDays = experiment.completedObservationDays ?? [];
		const observationDay = getNextRetestObservation(
			observationDays,
			completedDays,
		);
		const selectedPromptIds = [
			...(experiment.treatmentPromptIds ?? []),
			...(experiment.controlPromptIds ?? []),
		];
		if (
			!baseline?.promptSetId ||
			!metadata.userId ||
			providers.length === 0 ||
			observationDay === undefined
		) {
			await db
				.update(schema.retestExperiments)
				.set({
					status:
						observationDay === undefined ? "completed" : "waiting_baseline",
					nextRunAt: null,
					updatedAt: now,
				})
				.where(eq(schema.retestExperiments.id, experiment.id));
			continue;
		}
		const promptRows = await loadRunPromptRows(
			baseline.promptSetId,
			selectedPromptIds,
		);
		if (promptRows.length === 0) {
			await db
				.update(schema.retestExperiments)
				.set({ status: "waiting_baseline", nextRunAt: null, updatedAt: now })
				.where(eq(schema.retestExperiments.id, experiment.id));
			continue;
		}
		const created = await db.transaction(async (tx) => {
			const [claimed] = await tx
				.update(schema.retestExperiments)
				.set({ status: "running", updatedAt: now })
				.where(
					and(
						eq(schema.retestExperiments.id, experiment.id),
						eq(schema.retestExperiments.status, "scheduled"),
					),
				)
				.returning();
			if (!claimed) return null;
			const [run] = await tx
				.insert(schema.collectionRuns)
				.values({
					workspaceId: experiment.workspaceId,
					promptSetId: baseline.promptSetId,
					collectorNodeId: baseline.collectorNodeId,
					status: "queued",
					tier: "retest",
					totalSamples: promptRows.length * providers.length,
					scheduledAt: now,
					metadata: {
						providers,
						userId: metadata.userId,
						promptIds: promptRows.map((prompt) => prompt.id),
						retestExperimentId: experiment.id,
						observationDay,
						conversationIsolation: "fresh",
						sampleSource: "official_web_retest",
					},
				})
				.returning();
			if (!run) throw new Error("Failed to create retest run");
			await tx.insert(schema.sampleCheckpoints).values(
				providers.flatMap((provider) =>
					promptRows.map((prompt) => ({
						runId: run.id,
						promptId: prompt.id,
						provider,
						status: "queued",
					})),
				),
			);
			await tx
				.update(schema.retestExperiments)
				.set({
					latestRunId: run.id,
					currentObservationDay: observationDay,
					nextRunAt: null,
					updatedAt: now,
				})
				.where(eq(schema.retestExperiments.id, experiment.id));
			await tx
				.update(schema.experimentObservations)
				.set({
					runId: run.id,
					status: "running",
					updatedAt: now,
				})
				.where(
					and(
						eq(schema.experimentObservations.experimentId, experiment.id),
						eq(schema.experimentObservations.observationDay, observationDay),
					),
				);
			return run;
		});
		if (created) dispatched += 1;
	}
	return dispatched;
}

export async function dispatchScheduledGeoRuns(): Promise<number> {
	const dueRuns = await db.query.collectionRuns.findMany({
		where: and(
			eq(schema.collectionRuns.status, "queued"),
			lte(schema.collectionRuns.scheduledAt, new Date()),
		),
		orderBy: [asc(schema.collectionRuns.scheduledAt)],
		limit: 10,
	});
	let dispatched = 0;
	for (const run of dueRuns) {
		const metadata = (run.metadata ?? {}) as {
			providers?: Provider[];
			providerModes?: Partial<Record<Provider, ProviderMode>>;
			userId?: string;
			roundIndex?: number;
			promptIds?: string[];
		};
		if (!run.promptSetId || !metadata.userId || !metadata.providers?.length)
			continue;
		const promptRows = await loadRunPromptRows(
			run.promptSetId,
			metadata.promptIds,
		);
		if (promptRows.length === 0) continue;
		if (run.seriesId) {
			const siblings = await db.query.collectionRuns.findMany({
				where: eq(schema.collectionRuns.seriesId, run.seriesId),
			});
			const blockedByEarlierBatch = siblings.some(
				(sibling) =>
					sibling.id !== run.id &&
					(sibling.scheduledAt?.getTime() ?? 0) <
						(run.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER) &&
					!["completed", "partial", "failed", "cancelled"].includes(
						sibling.status,
					),
			);
			if (blockedByEarlierBatch) {
				await db
					.update(schema.collectionRuns)
					.set({
						scheduledAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
						updatedAt: new Date(),
					})
					.where(eq(schema.collectionRuns.id, run.id));
				continue;
			}
		}
		const completedToday = await Promise.all(
			metadata.providers.map((provider) =>
				getCompletedToday(run.workspaceId, provider),
			),
		);
		if (
			completedToday.some(
				(completed) =>
					completed + promptRows.length > DAILY_PROVIDER_SAMPLE_LIMIT,
			)
		) {
			await db
				.update(schema.collectionRuns)
				.set({
					scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
					updatedAt: new Date(),
				})
				.where(eq(schema.collectionRuns.id, run.id));
			continue;
		}
		if (run.collectorNodeId) {
			await db
				.update(schema.collectionRuns)
				.set({ status: "waiting_runner", updatedAt: new Date() })
				.where(eq(schema.collectionRuns.id, run.id));
			await refreshCollectionSeries(run.seriesId);
			dispatched += 1;
			continue;
		}
		const [claimed] = await db
			.update(schema.collectionRuns)
			.set({ status: "waiting_runner", updatedAt: new Date() })
			.where(
				and(
					eq(schema.collectionRuns.id, run.id),
					eq(schema.collectionRuns.status, "queued"),
				),
			)
			.returning();
		if (!claimed) continue;
		await initializeAgentProgress({
			jobGroupId: run.id,
			providers: metadata.providers,
			totalPrompts: promptRows.length,
		});
		const failedProviders = await enqueueProviderJobs({
			jobGroupId: run.id,
			collectionRunId: run.id,
			prompts: asUserPrompts({
				rows: promptRows,
				workspaceId: run.workspaceId,
				userId: metadata.userId,
			}),
			userId: metadata.userId,
			workspaceId: run.workspaceId,
			providers: metadata.providers,
			providerModes: metadata.providerModes,
			totalPromptCount: promptRows.length,
			minPromptDelayMs: 3 * 60_000,
			maxPromptDelayMs: 8 * 60_000,
		});
		await db
			.update(schema.collectionRuns)
			.set({
				status:
					failedProviders.length === metadata.providers.length
						? "failed"
						: "running",
				startedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(schema.collectionRuns.id, run.id));
		await refreshCollectionSeries(run.seriesId);
		dispatched += 1;
	}
	return dispatched;
}

export async function persistGeoSampleCheckpoint(args: {
	collectionRunId?: string;
	provider: Provider;
	sample: AskPromptResult;
	analyticsSampleId?: string;
}): Promise<void> {
	if (!args.collectionRunId) return;
	const now = new Date();
	await db
		.update(schema.sampleCheckpoints)
		.set({
			status: "completed",
			phase: "completed",
			analysisStatus: "pending",
			requestedMode: args.sample.requestedMode ?? "default",
			actualMode:
				args.sample.actualMode ?? args.sample.requestedMode ?? "default",
			conversationId: args.sample.conversationId ?? null,
			conversationUrl: args.sample.conversationUrl ?? null,
			sourceExposure: args.sample.sourceExposure ?? "not_exposed",
			analyticsSampleId: args.analyticsSampleId ?? null,
			failureCategory: null,
			errorCode: null,
			errorMessage: null,
			retryable: null,
			completedAt: now,
			lastEventAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(schema.sampleCheckpoints.runId, args.collectionRunId),
				eq(schema.sampleCheckpoints.promptId, args.sample.promptId),
				eq(schema.sampleCheckpoints.provider, args.provider),
			),
		);
	await refreshGeoCollectionRunCounters(args.collectionRunId, now);
	const run = await db.query.collectionRuns.findFirst({
		where: eq(schema.collectionRuns.id, args.collectionRunId),
	});
	await refreshCollectionSeries(run?.seriesId);
}

export async function validateGeoConversationIsolation(args: {
	collectionRunId?: string;
	provider: Provider;
	promptId: string;
	conversationId?: string | null;
}): Promise<
	{ accepted: true } | { accepted: false; conflictingPromptId: string | null }
> {
	if (!args.collectionRunId || !args.conversationId) return { accepted: true };
	const existing = await db.query.sampleCheckpoints.findMany({
		where: and(
			eq(schema.sampleCheckpoints.runId, args.collectionRunId),
			eq(schema.sampleCheckpoints.provider, args.provider),
			eq(schema.sampleCheckpoints.status, "completed"),
			eq(schema.sampleCheckpoints.conversationId, args.conversationId),
		),
		columns: { promptId: true },
	});
	const conflictingPromptId = findConflictingConversationPrompt({
		promptId: args.promptId,
		completedSamples: existing,
	});
	if (!conflictingPromptId) return { accepted: true };

	const now = new Date();
	await db
		.update(schema.sampleCheckpoints)
		.set({
			status: "failed",
			phase: "fresh_conversation",
			failureCategory: "provider_ui",
			errorCode: "conversation_reused",
			errorMessage:
				"Provider reused a conversation that already belongs to another prompt",
			retryable: true,
			conversationId: args.conversationId,
			completedAt: now,
			lastEventAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(schema.sampleCheckpoints.runId, args.collectionRunId),
				eq(schema.sampleCheckpoints.provider, args.provider),
				eq(schema.sampleCheckpoints.promptId, args.promptId),
			),
		);
	await refreshGeoCollectionRunCounters(args.collectionRunId, now);
	const run = await db.query.collectionRuns.findFirst({
		where: eq(schema.collectionRuns.id, args.collectionRunId),
	});
	await refreshCollectionSeries(run?.seriesId);
	return {
		accepted: false,
		conflictingPromptId,
	};
}

export async function prepareGeoProviderForCollectorRestart(args: {
	collectionRunId?: string;
	provider: Provider;
}): Promise<void> {
	if (!args.collectionRunId) return;
	const runId = args.collectionRunId;
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx
			.update(schema.sampleCheckpoints)
			.set(buildCollectorRestartCheckpointPatch(now))
			.where(
				and(
					eq(schema.sampleCheckpoints.runId, runId),
					eq(schema.sampleCheckpoints.provider, args.provider),
					inArray(schema.sampleCheckpoints.status, ["running", "retrying"]),
				),
			);
		await tx
			.update(schema.collectionRuns)
			.set({
				status: "waiting_runner",
				completedAt: null,
				updatedAt: now,
			})
			.where(eq(schema.collectionRuns.id, runId));
	});
	await refreshGeoCollectionRunCounters(runId, now);
	const run = await db.query.collectionRuns.findFirst({
		where: eq(schema.collectionRuns.id, runId),
	});
	await refreshCollectionSeries(run?.seriesId);
}

export async function getGeoProviderCheckpointState(args: {
	collectionRunId: string;
	provider: Provider;
}) {
	const checkpoints = await db.query.sampleCheckpoints.findMany({
		where: and(
			eq(schema.sampleCheckpoints.runId, args.collectionRunId),
			eq(schema.sampleCheckpoints.provider, args.provider),
		),
		columns: {
			promptId: true,
			status: true,
		},
	});
	const completed = checkpoints.filter(
		(checkpoint) => checkpoint.status === "completed",
	);
	const runnableStatuses = new Set(["queued", "running", "retrying"]);
	const runnable = checkpoints.filter((checkpoint) =>
		runnableStatuses.has(checkpoint.status),
	);
	return {
		totalCount: checkpoints.length,
		completedCount: completed.length,
		terminalCount: checkpoints.length - runnable.length,
		completedPromptIds: completed.flatMap((checkpoint) =>
			checkpoint.promptId ? [checkpoint.promptId] : [],
		),
		runnablePromptIds: runnable.flatMap((checkpoint) =>
			checkpoint.promptId ? [checkpoint.promptId] : [],
		),
	};
}

export async function persistGeoHumanChallenge(args: {
	collectionRunId?: string;
	workspaceId: string;
	provider: Provider;
	promptId?: string;
	kind: string;
	pageUrl: string;
	message: string;
	expiresAt: Date;
}): Promise<void> {
	if (!args.collectionRunId) return;
	const runId = args.collectionRunId;
	const checkpoint = args.promptId
		? await db.query.sampleCheckpoints.findFirst({
				where: and(
					eq(schema.sampleCheckpoints.runId, runId),
					eq(schema.sampleCheckpoints.promptId, args.promptId),
					eq(schema.sampleCheckpoints.provider, args.provider),
				),
			})
		: null;
	await db.transaction(async (tx) => {
		if (checkpoint) {
			await tx
				.update(schema.sampleCheckpoints)
				.set({
					status: "waiting_human",
					phase: "session",
					failureCategory: "account",
					errorCode: args.kind,
					errorMessage: args.message,
					retryable: false,
					lastEventAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(schema.sampleCheckpoints.id, checkpoint.id));
		}
		await tx.insert(schema.humanChallenges).values({
			workspaceId: args.workspaceId,
			runId,
			checkpointId: checkpoint?.id ?? null,
			provider: args.provider,
			kind: args.kind,
			pageUrl: args.pageUrl,
			message: args.message,
			expiresAt: args.expiresAt,
		});
		await tx
			.update(schema.collectionRuns)
			.set({ status: "waiting_human", updatedAt: new Date() })
			.where(eq(schema.collectionRuns.id, runId));
	});
	const run = await db.query.collectionRuns.findFirst({
		where: eq(schema.collectionRuns.id, runId),
	});
	await refreshCollectionSeries(run?.seriesId);
}

export async function finalizeGeoProviderRun(args: {
	collectionRunId?: string;
	provider: Provider;
	status: "completed" | "partial" | "failed" | "cancelled";
	errorMessage?: string;
	activePromptId?: string;
	failureCategory?: string;
	failureCode?: string;
}): Promise<void> {
	if (!args.collectionRunId) return;
	const now = new Date();
	if (args.status !== "completed") {
		if (args.activePromptId) {
			await db
				.update(schema.sampleCheckpoints)
				.set({
					status: args.status === "cancelled" ? "cancelled" : "failed",
					phase: args.status === "cancelled" ? "queued" : "generation",
					failureCategory: args.failureCategory ?? "unknown",
					errorCode:
						args.failureCode ??
						(args.status === "cancelled" ? "provider_aborted" : "unknown"),
					errorMessage: args.errorMessage ?? null,
					retryable: false,
					completedAt: now,
					lastEventAt: now,
					updatedAt: now,
				})
				.where(
					and(
						eq(schema.sampleCheckpoints.runId, args.collectionRunId),
						eq(schema.sampleCheckpoints.provider, args.provider),
						eq(schema.sampleCheckpoints.promptId, args.activePromptId),
						inArray(schema.sampleCheckpoints.status, [
							"queued",
							"running",
							"retrying",
						]),
					),
				);
		}
		await db
			.update(schema.sampleCheckpoints)
			.set({
				status: args.status === "cancelled" ? "cancelled" : "not_attempted",
				phase: "queued",
				failureCategory: args.failureCategory ?? "provider_access",
				errorCode: args.failureCode ?? "provider_aborted",
				errorMessage:
					args.errorMessage ??
					"Provider ended before this prompt was attempted",
				retryable: args.status !== "cancelled",
				completedAt: now,
				lastEventAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(schema.sampleCheckpoints.runId, args.collectionRunId),
					eq(schema.sampleCheckpoints.provider, args.provider),
					inArray(schema.sampleCheckpoints.status, [
						"queued",
						"running",
						"retrying",
					]),
				),
			);
	}
	const checkpoints = await db.query.sampleCheckpoints.findMany({
		where: eq(schema.sampleCheckpoints.runId, args.collectionRunId),
	});
	const [openChallenge, collectionRun] = await Promise.all([
		db.query.humanChallenges.findFirst({
			where: and(
				eq(schema.humanChallenges.runId, args.collectionRunId),
				eq(schema.humanChallenges.status, "open"),
				gte(schema.humanChallenges.expiresAt, now),
			),
		}),
		db.query.collectionRuns.findFirst({
			where: eq(schema.collectionRuns.id, args.collectionRunId),
		}),
	]);
	const completed = checkpoints.filter(
		(item) => item.status === "completed",
	).length;
	const failed = checkpoints.filter((item) => item.status === "failed").length;
	const notAttempted = checkpoints.filter((item) =>
		["not_attempted", "cancelled"].includes(item.status),
	).length;
	const waitingHuman =
		Boolean(openChallenge) ||
		checkpoints.some((item) => item.status === "waiting_human");
	const allTerminal = completed + failed + notAttempted >= checkpoints.length;
	const runStatus = waitingHuman
		? "waiting_human"
		: allTerminal
			? completed === checkpoints.length
				? "completed"
				: completed > 0
					? "partial"
					: "failed"
			: "running";
	await db
		.update(schema.collectionRuns)
		.set({
			status: runStatus,
			completedSamples: completed,
			failedSamples: failed + notAttempted,
			completedAt: allTerminal ? now : null,
			updatedAt: now,
		})
		.where(eq(schema.collectionRuns.id, args.collectionRunId));
	await refreshCollectionSeries(collectionRun?.seriesId);
	if (collectionRun) {
		await persistTerminalFailuresToAnalytics({
			run: collectionRun,
			checkpoints,
		}).catch(() => {});
	}

	const runMetadata = (collectionRun?.metadata ?? {}) as {
		retestExperimentId?: string;
		observationDay?: number;
	};
	if (
		allTerminal &&
		runMetadata.retestExperimentId &&
		typeof runMetadata.observationDay === "number"
	) {
		const experiment = await db.query.retestExperiments.findFirst({
			where: eq(schema.retestExperiments.id, runMetadata.retestExperimentId),
		});
		if (experiment) {
			const observationDay = runMetadata.observationDay;
			const completedDays = [
				...new Set([
					...(experiment.completedObservationDays ?? []),
					observationDay,
				]),
			].sort((left, right) => left - right);
			const nextDay = getNextRetestObservation(
				experiment.observationDays ?? [7, 14, 30],
				completedDays,
			);
			const intervention = await db.query.interventions.findFirst({
				where: eq(schema.interventions.id, experiment.interventionId),
			});
			const publishedAt = intervention?.publishedAt ?? intervention?.createdAt;
			await db.transaction(async (tx) => {
				await tx
					.update(schema.retestExperiments)
					.set({
						status: nextDay === undefined ? "completed" : "scheduled",
						completedObservationDays: completedDays,
						currentObservationDay: null,
						nextRunAt:
							nextDay !== undefined && publishedAt
								? new Date(
										publishedAt.getTime() + nextDay * 24 * 60 * 60 * 1000,
									)
								: null,
						updatedAt: now,
					})
					.where(eq(schema.retestExperiments.id, experiment.id));
				const observationCompletion = percentageValue(
					completed,
					checkpoints.length,
				);
				await tx
					.update(schema.experimentObservations)
					.set({
						status: completed === checkpoints.length ? "completed" : "partial",
						confidence: observationCompletion >= 90 ? "medium" : "low",
						metrics: {
							totalSamples: checkpoints.length,
							completedSamples: completed,
							failedSamples: failed + notAttempted,
							completionRate: observationCompletion,
						},
						updatedAt: now,
					})
					.where(
						and(
							eq(schema.experimentObservations.experimentId, experiment.id),
							eq(schema.experimentObservations.observationDay, observationDay),
						),
					);
			});
		}
	}
}

export async function requestHumanChallengeWindow(args: {
	workspaceId: string;
	challengeId: string;
}) {
	const challenge = await db.query.humanChallenges.findFirst({
		where: and(
			eq(schema.humanChallenges.id, args.challengeId),
			eq(schema.humanChallenges.workspaceId, args.workspaceId),
			eq(schema.humanChallenges.status, "open"),
		),
	});
	if (!challenge)
		throw new NotFoundError("Open verification request not found");
	const run = await db.query.collectionRuns.findFirst({
		where: eq(schema.collectionRuns.id, challenge.runId),
	});
	if (run?.collectorNodeId) {
		await db.insert(schema.collectorCommands).values({
			workspaceId: args.workspaceId,
			collectorNodeId: run.collectorNodeId,
			provider: challenge.provider,
			type: "focus_challenge_window",
			payload: { challengeId: challenge.id, pageUrl: challenge.pageUrl },
			expiresAt: challenge.expiresAt,
		});
		return { accepted: true, pageUrl: challenge.pageUrl };
	}
	await waitForRedis();
	await redis.publish(
		PROVIDER_WINDOW_CHANNEL,
		JSON.stringify({ provider: challenge.provider, action: "focus" }),
	);
	return { accepted: true, pageUrl: challenge.pageUrl };
}

export async function resumeHumanChallenge(args: {
	workspaceId: string;
	userId: string;
	challengeId: string;
}) {
	const challenge = await db.query.humanChallenges.findFirst({
		where: and(
			eq(schema.humanChallenges.id, args.challengeId),
			eq(schema.humanChallenges.workspaceId, args.workspaceId),
			eq(schema.humanChallenges.status, "open"),
		),
	});
	if (!challenge)
		throw new NotFoundError("Open verification request not found");
	if (challenge.expiresAt.getTime() <= Date.now()) {
		await db
			.update(schema.humanChallenges)
			.set({ status: "expired", updatedAt: new Date() })
			.where(eq(schema.humanChallenges.id, challenge.id));
		throw new ValidationError("Verification request has expired");
	}
	const provider = challenge.provider as Provider;
	if (!GEO_WEB_PROVIDERS.includes(provider as never)) {
		throw new ValidationError("Unsupported GEO Web provider");
	}
	const run = await db.query.collectionRuns.findFirst({
		where: and(
			eq(schema.collectionRuns.id, challenge.runId),
			eq(schema.collectionRuns.workspaceId, args.workspaceId),
		),
	});
	if (!run?.promptSetId) throw new NotFoundError("Collection run not found");
	const runMetadata = (run.metadata ?? {}) as {
		promptIds?: string[];
		providerModes?: Partial<Record<Provider, ProviderMode>>;
	};
	const [prompts, completed] = await Promise.all([
		loadRunPromptRows(run.promptSetId, runMetadata.promptIds),
		db.query.sampleCheckpoints.findMany({
			where: and(
				eq(schema.sampleCheckpoints.runId, run.id),
				eq(schema.sampleCheckpoints.provider, provider),
				eq(schema.sampleCheckpoints.status, "completed"),
			),
		}),
	]);
	const completedIds = new Set(completed.map((item) => item.promptId));
	const remaining = prompts.filter((prompt) => !completedIds.has(prompt.id));
	if (remaining.length === 0) {
		throw new ValidationError("This provider has no remaining samples");
	}

	const queue = getProviderQueue(provider);
	const previous = await queue.getJob(buildProviderJobId(run.id, provider));
	if (previous) await previous.remove().catch(() => null);
	await waitForRedis();
	await redis.del(buildProviderCancelKey(run.id, provider));
	await clearProviderChallenge({ jobGroupId: run.id, provider });
	await db.transaction(async (tx) => {
		await tx
			.update(schema.humanChallenges)
			.set({
				status: "resolved",
				resolvedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(schema.humanChallenges.id, challenge.id));
		if (challenge.checkpointId) {
			await tx
				.update(schema.sampleCheckpoints)
				.set({
					status: "queued",
					phase: "queued",
					failureCategory: null,
					errorCode: null,
					errorMessage: null,
					retryable: null,
					completedAt: null,
					lastEventAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(schema.sampleCheckpoints.id, challenge.checkpointId));
		}
		await tx
			.update(schema.collectionRuns)
			.set({ status: "running", updatedAt: new Date() })
			.where(eq(schema.collectionRuns.id, run.id));
	});
	if (run.collectorNodeId) {
		await db.insert(schema.collectorCommands).values({
			workspaceId: args.workspaceId,
			collectorNodeId: run.collectorNodeId,
			provider,
			type: "resume_verification",
			payload: { challengeId: challenge.id, runId: run.id },
			expiresAt: new Date(Date.now() + 10 * 60 * 1000),
		});
		await db
			.update(schema.collectionRuns)
			.set({ status: "waiting_runner", updatedAt: new Date() })
			.where(eq(schema.collectionRuns.id, run.id));
		return { resumed: true, remainingSamples: remaining.length };
	}
	await enqueueProviderJobs({
		jobGroupId: run.id,
		collectionRunId: run.id,
		prompts: asUserPrompts({
			rows: remaining,
			workspaceId: args.workspaceId,
			userId: args.userId,
		}),
		userId: args.userId,
		workspaceId: args.workspaceId,
		providers: [provider],
		providerModes: {
			[provider]: runMetadata.providerModes?.[provider] ?? "default",
		},
		initialCompletedCount: completed.length,
		totalPromptCount: prompts.length,
		minPromptDelayMs: 3 * 60_000,
		maxPromptDelayMs: 8 * 60_000,
	});
	return { resumed: true, remainingSamples: remaining.length };
}

export async function listGeoRuns(workspaceId: string) {
	const series = await db.query.collectionSeries.findMany({
		where: eq(schema.collectionSeries.workspaceId, workspaceId),
		orderBy: [desc(schema.collectionSeries.createdAt)],
		limit: 50,
	});
	const promptSetIds = series.flatMap((item) =>
		item.promptSetId ? [item.promptSetId] : [],
	);
	const promptSets = promptSetIds.length
		? await db.query.promptSets.findMany({
				where: inArray(schema.promptSets.id, promptSetIds),
			})
		: [];
	const promptLocales = promptSetIds.length
		? await db.query.monitorPrompts.findMany({
				where: inArray(schema.monitorPrompts.promptSetId, promptSetIds),
				columns: { promptSetId: true, locale: true },
			})
		: [];
	const promptSetById = new Map(
		promptSets.map((promptSet) => [
			promptSet.id,
			{
				...promptSet,
				locales: [
					...new Set(
						promptLocales
							.filter((prompt) => prompt.promptSetId === promptSet.id)
							.map((prompt) => prompt.locale),
					),
				].sort(),
			},
		]),
	);
	return series.map((item) => ({
		...item,
		totalSamples: item.plannedSamples,
		promptSet: item.promptSetId
			? (promptSetById.get(item.promptSetId) ?? null)
			: null,
	}));
}

export async function getGeoRunDetail(args: {
	workspaceId: string;
	seriesId: string;
}) {
	const series = await db.query.collectionSeries.findFirst({
		where: and(
			eq(schema.collectionSeries.id, args.seriesId),
			eq(schema.collectionSeries.workspaceId, args.workspaceId),
		),
	});
	if (!series) throw new NotFoundError("Collection series not found");
	const runs = await db.query.collectionRuns.findMany({
		where: eq(schema.collectionRuns.seriesId, series.id),
		orderBy: [asc(schema.collectionRuns.scheduledAt)],
	});
	const runIds = runs.map((run) => run.id);
	const checkpoints = runIds.length
		? await db.query.sampleCheckpoints.findMany({
				where: inArray(schema.sampleCheckpoints.runId, runIds),
				orderBy: [asc(schema.sampleCheckpoints.createdAt)],
			})
		: [];
	const promptIds = checkpoints
		.map((checkpoint) => checkpoint.promptId)
		.filter((id): id is string => Boolean(id));
	const prompts = promptIds.length
		? await db.query.monitorPrompts.findMany({
				where: inArray(schema.monitorPrompts.id, [...new Set(promptIds)]),
			})
		: [];
	const checkpointIds = checkpoints.map((checkpoint) => checkpoint.id);
	const attempts = checkpointIds.length
		? await db.query.sampleAttempts.findMany({
				where: inArray(schema.sampleAttempts.checkpointId, checkpointIds),
				orderBy: [asc(schema.sampleAttempts.createdAt)],
			})
		: [];
	const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
	const samples = checkpoints.map((checkpoint) => ({
		...checkpoint,
		prompt: checkpoint.promptId
			? (promptById.get(checkpoint.promptId) ?? null)
			: null,
		attempts: attempts.filter(
			(attempt) => attempt.checkpointId === checkpoint.id,
		),
	}));
	const providerSummary = Object.fromEntries(
		GEO_WEB_PROVIDERS.map((provider) => {
			const rows = samples.filter((sample) => sample.provider === provider);
			return [
				provider,
				{
					total: rows.length,
					completed: rows.filter((row) => row.status === "completed").length,
					failed: rows.filter((row) => row.status === "failed").length,
					waitingHuman: rows.filter((row) => row.status === "waiting_human")
						.length,
					notAttempted: rows.filter((row) => row.status === "not_attempted")
						.length,
				},
			];
		}),
	);
	const failureSummary = Object.entries(
		samples.reduce<Record<string, number>>((summary, sample) => {
			if (!sample.errorCode) return summary;
			const key = `${sample.failureCategory ?? "unknown"}:${sample.errorCode}`;
			summary[key] = (summary[key] ?? 0) + 1;
			return summary;
		}, {}),
	)
		.map(([key, value]) => {
			const [category, code] = key.split(":");
			return { category, code, count: value };
		})
		.sort((left, right) => right.count - left.count);
	return { series, runs, samples, providerSummary, failureSummary };
}

export async function retryGeoSamples(args: {
	workspaceId: string;
	userId: string;
	seriesId: string;
	checkpointIds: string[];
}) {
	const series = await db.query.collectionSeries.findFirst({
		where: and(
			eq(schema.collectionSeries.id, args.seriesId),
			eq(schema.collectionSeries.workspaceId, args.workspaceId),
		),
	});
	if (!series) throw new NotFoundError("Collection series not found");
	if (args.checkpointIds.length === 0) {
		throw new ValidationError("Select at least one sample to retry");
	}
	const candidates = await db.query.sampleCheckpoints.findMany({
		where: inArray(schema.sampleCheckpoints.id, args.checkpointIds),
	});
	const runIds = [...new Set(candidates.map((checkpoint) => checkpoint.runId))];
	const runs = runIds.length
		? await db.query.collectionRuns.findMany({
				where: and(
					inArray(schema.collectionRuns.id, runIds),
					eq(schema.collectionRuns.seriesId, series.id),
					eq(schema.collectionRuns.workspaceId, args.workspaceId),
				),
			})
		: [];
	const runById = new Map(runs.map((run) => [run.id, run]));
	const retryable = candidates.filter(
		(checkpoint) =>
			runById.has(checkpoint.runId) &&
			["failed", "not_attempted", "cancelled"].includes(checkpoint.status),
	);
	if (retryable.length === 0) {
		throw new ValidationError("No selected samples are retryable");
	}
	const groups = new Map<string, typeof retryable>();
	for (const checkpoint of retryable) {
		const key = `${checkpoint.runId}:${checkpoint.provider}`;
		groups.set(key, [...(groups.get(key) ?? []), checkpoint]);
	}
	for (const group of groups.values()) {
		const run = runById.get(group[0]?.runId ?? "");
		const provider = group[0]?.provider as Provider | undefined;
		if (!run || !provider || !run.promptSetId) continue;
		const promptIds = group
			.map((checkpoint) => checkpoint.promptId)
			.filter((id): id is string => Boolean(id));
		const prompts = await loadRunPromptRows(run.promptSetId, promptIds);
		await db
			.update(schema.sampleCheckpoints)
			.set({
				status: "queued",
				phase: "queued",
				conversationId: null,
				conversationUrl: null,
				sourceExposure: null,
				analyticsSampleId: null,
				actualMode: null,
				analysisStatus: "pending",
				analysisErrorCode: null,
				analysisErrorMessage: null,
				failureCategory: null,
				errorCode: null,
				errorMessage: null,
				retryable: null,
				warningCode: null,
				startedAt: null,
				completedAt: null,
				lastEventAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				inArray(
					schema.sampleCheckpoints.id,
					group.map((item) => item.id),
				),
			);
		await refreshGeoCollectionRunCounters(run.id);
		if (run.collectorNodeId) {
			await db
				.update(schema.collectionRuns)
				.set({
					status: "waiting_runner",
					completedAt: null,
					updatedAt: new Date(),
				})
				.where(eq(schema.collectionRuns.id, run.id));
			continue;
		}
		const queue = getProviderQueue(provider);
		const previous = await queue.getJob(buildProviderJobId(run.id, provider));
		if (previous) {
			const state = await previous.getState();
			if (state === "completed" || state === "failed") {
				await previous.remove().catch(() => null);
			}
		}
		await waitForRedis();
		await redis.del(buildProviderCancelKey(run.id, provider));
		const completedCount = await db.query.sampleCheckpoints.findMany({
			where: and(
				eq(schema.sampleCheckpoints.runId, run.id),
				eq(schema.sampleCheckpoints.provider, provider),
				eq(schema.sampleCheckpoints.status, "completed"),
			),
		});
		await enqueueProviderJobs({
			jobGroupId: run.id,
			collectionRunId: run.id,
			prompts: asUserPrompts({
				rows: prompts,
				workspaceId: args.workspaceId,
				userId: args.userId,
			}),
			userId: args.userId,
			workspaceId: args.workspaceId,
			providers: [provider],
			providerModes: {
				[provider]: (group[0]?.requestedMode ?? "default") as ProviderMode,
			},
			attemptIndexOffsets: Object.fromEntries(
				group.flatMap((checkpoint) =>
					checkpoint.promptId
						? [[checkpoint.promptId, checkpoint.attemptCount] as const]
						: [],
				),
			),
			queueJobIdSuffix: `retry-${randomUUID()}`,
			initialCompletedCount: completedCount.length,
			totalPromptCount: completedCount.length + prompts.length,
			minPromptDelayMs: 3 * 60_000,
			maxPromptDelayMs: 8 * 60_000,
		});
		await db
			.update(schema.collectionRuns)
			.set({ status: "running", completedAt: null, updatedAt: new Date() })
			.where(eq(schema.collectionRuns.id, run.id));
	}
	await refreshCollectionSeries(series.id);
	return { requeued: retryable.length };
}

export async function listOpenHumanChallenges(workspaceId: string) {
	const expired = await db.query.humanChallenges.findMany({
		where: and(
			eq(schema.humanChallenges.workspaceId, workspaceId),
			eq(schema.humanChallenges.status, "open"),
		),
	});
	for (const challenge of expired.filter(
		(item) => item.expiresAt.getTime() <= Date.now(),
	)) {
		await db
			.update(schema.humanChallenges)
			.set({ status: "expired", updatedAt: new Date() })
			.where(eq(schema.humanChallenges.id, challenge.id));
		if (challenge.checkpointId) {
			await db
				.update(schema.sampleCheckpoints)
				.set({
					status: "failed",
					errorCode: "verification_expired",
					errorMessage: "Human verification expired after 24 hours",
					completedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(schema.sampleCheckpoints.id, challenge.checkpointId));
		}
		await finalizeGeoProviderRun({
			collectionRunId: challenge.runId,
			provider: challenge.provider as Provider,
			status: "partial",
			errorMessage: "Human verification expired after 24 hours",
		});
	}
	const openChallenges = await db.query.humanChallenges.findMany({
		where: and(
			eq(schema.humanChallenges.workspaceId, workspaceId),
			eq(schema.humanChallenges.status, "open"),
			gte(schema.humanChallenges.expiresAt, new Date()),
		),
		orderBy: [desc(schema.humanChallenges.createdAt)],
	});
	for (const challenge of openChallenges) {
		await db
			.update(schema.collectionRuns)
			.set({ status: "waiting_human", updatedAt: new Date() })
			.where(eq(schema.collectionRuns.id, challenge.runId));
	}
	return openChallenges;
}

export async function getGeoOverview(workspaceId: string) {
	const [runs, challenges, collectors, schedules, localHeartbeat] =
		await Promise.all([
			listGeoRuns(workspaceId),
			listOpenHumanChallenges(workspaceId),
			db.query.collectorNodes.findMany({
				where: eq(schema.collectorNodes.workspaceId, workspaceId),
			}),
			db.query.detectionSchedules.findMany({
				where: and(
					eq(schema.detectionSchedules.workspaceId, workspaceId),
					eq(schema.detectionSchedules.enabled, true),
				),
			}),
			redis.get("aloom:agent:heartbeat").catch(() => null),
		]);
	return {
		runnerOnline:
			Boolean(localHeartbeat) ||
			collectors.some(
				(node) =>
					node.lastHeartbeatAt &&
					Date.now() - node.lastHeartbeatAt.getTime() < 90_000,
			),
		openChallenges: challenges.length,
		activeSchedules: schedules.length,
		latestRun: runs[0] ?? null,
	};
}

export async function listRetestExperiments(workspaceId: string) {
	const experiments = await db.query.retestExperiments.findMany({
		where: eq(schema.retestExperiments.workspaceId, workspaceId),
		orderBy: [desc(schema.retestExperiments.createdAt)],
	});
	const experimentIds = experiments.map((experiment) => experiment.id);
	const interventionIds = experiments.map(
		(experiment) => experiment.interventionId,
	);
	const [observations, interventions] = await Promise.all([
		experimentIds.length
			? db.query.experimentObservations.findMany({
					where: inArray(
						schema.experimentObservations.experimentId,
						experimentIds,
					),
					orderBy: [asc(schema.experimentObservations.observationDay)],
				})
			: [],
		interventionIds.length
			? db.query.interventions.findMany({
					where: inArray(schema.interventions.id, interventionIds),
				})
			: [],
	]);
	const interventionById = new Map(
		interventions.map((intervention) => [intervention.id, intervention]),
	);
	return experiments.map((experiment) => ({
		...experiment,
		intervention: interventionById.get(experiment.interventionId) ?? null,
		observations: observations.filter(
			(observation) => observation.experimentId === experiment.id,
		),
	}));
}

type ExperimentAnswerRow = {
	id: string;
	run_id: string | null;
	series_id: string | null;
	prompt_id: string;
	prompt: string;
	prompt_hash: string;
	model_provider: string;
	response: string;
	source_exposure: string;
	status: string;
	prompt_run_at: string;
};

type ExperimentAnalysedRow = ExperimentAnswerRow & {
	analysis: BrandAnalysisResult | null;
};

function experimentMetricSet(
	rows: ExperimentAnalysedRow[],
	denominator: number,
) {
	const analysed = rows.filter((row) => row.analysis);
	const mentioned = analysed.filter((row) => row.analysis?.presence.mentioned);
	const recommended = analysed.filter((row) =>
		["top_pick", "strong_alternative", "conditional"].includes(
			row.analysis?.recommendation.type ?? "",
		),
	);
	const exposed = rows.filter(
		(row) => row.status === "completed" && row.source_exposure === "exposed",
	);
	const ranks = mentioned.flatMap((row) =>
		row.analysis?.position.rankPosition
			? [row.analysis.position.rankPosition]
			: [],
	);
	return {
		denominator,
		validAnswers: rows.filter((row) => row.status === "completed").length,
		analysedAnswers: analysed.length,
		mentionCount: mentioned.length,
		mentionRate: percentageValue(mentioned.length, denominator),
		recommendationCount: recommended.length,
		recommendationRate: percentageValue(recommended.length, denominator),
		sourceExposureCount: exposed.length,
		sourceExposureRate: percentageValue(exposed.length, denominator),
		averageRank:
			ranks.length > 0
				? Math.round(
						(ranks.reduce((total, rank) => total + rank, 0) / ranks.length) *
							100,
					) / 100
				: null,
	};
}

function differenceInterval(args: {
	beforeCount: number;
	beforeTotal: number;
	afterCount: number;
	afterTotal: number;
}) {
	if (args.beforeTotal === 0 || args.afterTotal === 0) return null;
	const before = args.beforeCount / args.beforeTotal;
	const after = args.afterCount / args.afterTotal;
	const standardError = Math.sqrt(
		(before * (1 - before)) / args.beforeTotal +
			(after * (1 - after)) / args.afterTotal,
	);
	const delta = (after - before) * 100;
	return {
		delta: Math.round(delta * 100) / 100,
		lower: Math.round((delta - 1.96 * standardError * 100) * 100) / 100,
		upper: Math.round((delta + 1.96 * standardError * 100) * 100) / 100,
	};
}

async function loadExperimentAnswers(args: {
	workspaceId: string;
	baselineSeriesId: string;
	observationRunIds: string[];
	promptIds: string[];
}) {
	const response = await clickhouse.query({
		query: `
			SELECT id, run_id, series_id, prompt_id, prompt, prompt_hash,
			       model_provider, response, source_exposure, status, prompt_run_at
			FROM analytics.answer_samples_v2 FINAL
			WHERE workspace_id = {workspaceId:String}
			  AND prompt_id IN ({promptIds:Array(String)})
			  AND (
			    series_id = toNullable({baselineSeriesId:String})
			    OR run_id IN ({observationRunIds:Array(String)})
			  )
			ORDER BY prompt_run_at
		`,
		query_params: {
			workspaceId: args.workspaceId,
			baselineSeriesId: args.baselineSeriesId,
			observationRunIds: args.observationRunIds,
			promptIds: args.promptIds,
		},
		format: "JSONEachRow",
	});
	const rows: ExperimentAnswerRow[] = await response.json();
	if (rows.length === 0) return [] as ExperimentAnalysedRow[];
	const analysisResponse = await clickhouse.query({
		query: `
			SELECT sample_id, argMax(analysis_json, created_at) AS analysis_json
			FROM analytics.sample_analysis_v2
			WHERE workspace_id = {workspaceId:String}
			  AND sample_id IN ({sampleIds:Array(String)})
			  AND status = 'completed'
			GROUP BY sample_id
		`,
		query_params: {
			workspaceId: args.workspaceId,
			sampleIds: rows.map((row) => row.id),
		},
		format: "JSONEachRow",
	});
	const analysisRows: Array<{ sample_id: string; analysis_json: string }> =
		await analysisResponse.json();
	const analysisById = new Map<string, BrandAnalysisResult>();
	for (const row of analysisRows) {
		try {
			analysisById.set(row.sample_id, parseAnalysisOutput(row.analysis_json));
		} catch {}
	}
	return rows.map((row) => ({
		...row,
		analysis: analysisById.get(row.id) ?? null,
	}));
}

export async function getExperimentResults(args: {
	workspaceId: string;
	experimentId: string;
}) {
	const experiment = await db.query.retestExperiments.findFirst({
		where: and(
			eq(schema.retestExperiments.id, args.experimentId),
			eq(schema.retestExperiments.workspaceId, args.workspaceId),
		),
	});
	if (!experiment || !experiment.baselineSeriesId) {
		throw new NotFoundError("Matched retest experiment not found");
	}
	const [intervention, observations, baselineRuns] = await Promise.all([
		db.query.interventions.findFirst({
			where: eq(schema.interventions.id, experiment.interventionId),
		}),
		db.query.experimentObservations.findMany({
			where: eq(schema.experimentObservations.experimentId, experiment.id),
			orderBy: [asc(schema.experimentObservations.observationDay)],
		}),
		db.query.collectionRuns.findMany({
			where: eq(schema.collectionRuns.seriesId, experiment.baselineSeriesId),
		}),
	]);
	const observationRunIds = observations.flatMap((observation) =>
		observation.runId ? [observation.runId] : [],
	);
	const promptIds = [
		...new Set([
			...(experiment.treatmentPromptIds ?? []),
			...(experiment.controlPromptIds ?? []),
		]),
	];
	const rows = await loadExperimentAnswers({
		workspaceId: args.workspaceId,
		baselineSeriesId: experiment.baselineSeriesId,
		observationRunIds,
		promptIds,
	});
	const baselineRunIds = new Set(baselineRuns.map((run) => run.id));
	const baselineRows = rows.filter(
		(row) => row.run_id && baselineRunIds.has(row.run_id),
	);
	const treatmentPromptIds = new Set(experiment.treatmentPromptIds ?? []);
	const controlPromptIds = new Set(experiment.controlPromptIds ?? []);
	const baselineCheckpoints = baselineRuns.length
		? await db.query.sampleCheckpoints.findMany({
				where: inArray(
					schema.sampleCheckpoints.runId,
					baselineRuns.map((run) => run.id),
				),
			})
		: [];
	const baselineTreatment = experimentMetricSet(
		baselineRows.filter((row) => treatmentPromptIds.has(row.prompt_id)),
		baselineCheckpoints.filter((checkpoint) =>
			treatmentPromptIds.has(checkpoint.promptId ?? ""),
		).length,
	);
	const baselineControl = experimentMetricSet(
		baselineRows.filter((row) => controlPromptIds.has(row.prompt_id)),
		baselineCheckpoints.filter((checkpoint) =>
			controlPromptIds.has(checkpoint.promptId ?? ""),
		).length,
	);
	const observationResults = await Promise.all(
		observations.map(async (observation) => {
			const observationRows = observation.runId
				? rows.filter((row) => row.run_id === observation.runId)
				: [];
			const checkpoints = observation.runId
				? await db.query.sampleCheckpoints.findMany({
						where: eq(schema.sampleCheckpoints.runId, observation.runId),
					})
				: [];
			const treatment = experimentMetricSet(
				observationRows.filter((row) => treatmentPromptIds.has(row.prompt_id)),
				checkpoints.filter((checkpoint) =>
					treatmentPromptIds.has(checkpoint.promptId ?? ""),
				).length,
			);
			const control = experimentMetricSet(
				observationRows.filter((row) => controlPromptIds.has(row.prompt_id)),
				checkpoints.filter((checkpoint) =>
					controlPromptIds.has(checkpoint.promptId ?? ""),
				).length,
			);
			return {
				...observation,
				treatment,
				control,
				pairedMentionChange: differenceInterval({
					beforeCount: baselineTreatment.mentionCount,
					beforeTotal: baselineTreatment.denominator,
					afterCount: treatment.mentionCount,
					afterTotal: treatment.denominator,
				}),
				differenceInDifferences: calculateDifferenceInDifferences({
					baselineTreatment,
					baselineControl,
					afterTreatment: treatment,
					afterControl: control,
				}),
			};
		}),
	);
	const pairs = promptIds.flatMap((promptId) => {
		const promptRows = rows.filter((row) => row.prompt_id === promptId);
		const providers = [...new Set(promptRows.map((row) => row.model_provider))];
		return providers.map((provider) => ({
			promptId,
			promptHash: promptRows[0]?.prompt_hash ?? "",
			prompt: promptRows[0]?.prompt ?? "",
			provider,
			role: treatmentPromptIds.has(promptId) ? "treatment" : "control",
			baseline: promptRows
				.filter(
					(row) =>
						row.model_provider === provider &&
						row.run_id &&
						baselineRunIds.has(row.run_id),
				)
				.map((row) => ({
					sampleId: row.id,
					response: row.response,
					status: row.status,
					mentioned: row.analysis?.presence.mentioned ?? null,
					recommendation: row.analysis?.recommendation.type ?? null,
					rank: row.analysis?.position.rankPosition ?? null,
				})),
			observations: observations.map((observation) => ({
				observationDay: observation.observationDay,
				answers: promptRows
					.filter(
						(row) =>
							row.model_provider === provider &&
							row.run_id === observation.runId,
					)
					.map((row) => ({
						sampleId: row.id,
						response: row.response,
						status: row.status,
						mentioned: row.analysis?.presence.mentioned ?? null,
						recommendation: row.analysis?.recommendation.type ?? null,
						rank: row.analysis?.position.rankPosition ?? null,
					})),
			})),
		}));
	});
	return {
		experiment,
		intervention,
		baseline: { treatment: baselineTreatment, control: baselineControl },
		observations: observationResults,
		pairs,
		promptHashes: experiment.promptHashes,
		environmentSnapshot: experiment.environmentSnapshot,
		conclusionMode: "observed_correlation" as const,
	};
}
