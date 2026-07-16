import {
	HumanChallengeError,
	ValidationError,
	classifyError,
	toErrorMessage,
} from "@aloom/errors";
import {
	buildProviderCancelKey,
	buildProviderJobId,
	enqueueProviderJobs,
	finalizeGeoProviderRun,
	getGeoProviderCheckpointState,
	hasRuntimeProviderAuth,
	persistGeoSampleCheckpoint,
	prepareGeoProviderForCollectorRestart,
	recordGeoSampleAttempt,
	redis,
	updateProviderProgress,
	validateGeoConversationIsolation,
	writeProviderAuthStatus,
} from "@aloom/services";
import type {
	AgentResult,
	AuthProvider,
	ModelResult,
	PromptPayload,
	Provider,
	ProviderMode,
} from "@aloom/types";
import { AUTH_PROVIDER_LIST, PROVIDER_LIST } from "@aloom/types";
import { createProviderLogger, logger } from "@aloom/utils";
import type { Job } from "bullmq";
import { agentHandler } from "../core/agentHandler.js";
import { createAgent } from "../core/createAgent.js";
import { describePromptFailure } from "../core/prompt-runner/failureDetails.js";
import { PROVIDER_CONFIGS } from "../core/providers/index.js";
import { releaseProviderHumanHold } from "../lib/browser/providerSessionManager.js";
import { StopProviderRunError } from "../lib/browser/proxy/runner.js";
import { runAnalysisInBackground } from "./analysis.js";
import { offsetPromptAttempt } from "./attemptIndex.js";
import { resolveProviderJobResume } from "./jobResume.js";
import { persistSampleCheckpoint } from "./sampleCheckpoint.js";

type ProviderStatus =
	| "pending"
	| "running"
	| "waiting_human"
	| "partial"
	| "completed"
	| "failed"
	| "stopped";
type ProviderJobData = {
	jobGroupId: string;
	collectionRunId?: string;
	provider: Provider;
	runProviders?: Provider[];
	prompts: PromptPayload["prompts"];
	user_id: string;
	workspace_id: string;
	created_at?: string;
	initialCompletedCount?: number;
	totalPromptCount?: number;
	minPromptDelayMs?: number;
	maxPromptDelayMs?: number;
	providerMode?: ProviderMode;
	attemptIndexOffsets?: Record<string, number>;
};

const AGENT_PROGRESS_TTL_SECONDS = 24 * 60 * 60;
const activeProviderStops = new Map<string, () => Promise<void>>();
const activeProviderShutdowns = new Map<string, () => Promise<void>>();

class CollectorShutdownError extends Error {
	constructor(provider: Provider) {
		super(`Collector shutdown interrupted ${provider}`);
		this.name = "CollectorShutdownError";
	}
}

function buildProgressSeed(providers: Provider[], promptCount: number): string {
	return JSON.stringify({
		status: "pending" as const,
		updateId: 0,
		providers: Object.fromEntries(
			providers.map((provider) => [provider, "pending"]),
		) as Record<Provider, ProviderStatus>,
		results: Object.fromEntries(
			providers.map((provider) => [provider, 0]),
		) as Record<Provider, number>,
		stats: {
			totalPrompts: promptCount,
			expectedResponses: promptCount * providers.length,
			actualResponses: 0,
		},
	});
}

async function ensureProgressSeed(
	progressKey: string,
	providers: Provider[],
	promptCount: number,
): Promise<void> {
	await redis.set(
		progressKey,
		buildProgressSeed(providers, promptCount),
		"EX",
		AGENT_PROGRESS_TTL_SECONDS,
		"NX",
	);
}

function buildEmptyResults(): Record<Provider, AgentResult> {
	return Object.fromEntries(
		PROVIDER_LIST.map((currentProvider) => [
			currentProvider,
			{ status: "rejected" as const, data: [] },
		]),
	) as unknown as Record<Provider, AgentResult>;
}

function registerActiveProviderStop(
	jobGroupId: string,
	provider: Provider,
	stop: () => Promise<void>,
): void {
	activeProviderStops.set(buildProviderJobId(jobGroupId, provider), stop);
}

function unregisterActiveProviderStop(
	jobGroupId: string,
	provider: Provider,
): void {
	const key = buildProviderJobId(jobGroupId, provider);
	activeProviderStops.delete(key);
	activeProviderShutdowns.delete(key);
}

export async function stopActiveProviderRun(args: {
	jobGroupId: string;
	provider: Provider;
}): Promise<boolean> {
	const stop = activeProviderStops.get(
		buildProviderJobId(args.jobGroupId, args.provider),
	);
	if (!stop) return false;
	await stop();
	return true;
}

export async function interruptActiveProviderRunsForShutdown(): Promise<void> {
	await Promise.all(
		[...activeProviderShutdowns.values()].map((interrupt) => interrupt()),
	);
}

export async function handleJob(job: Job<ProviderJobData>): Promise<boolean> {
	const {
		provider,
		jobGroupId,
		collectionRunId,
		prompts: requestedPrompts,
		user_id,
		workspace_id,
		initialCompletedCount = 0,
		totalPromptCount: requestedTotalPromptCount = requestedPrompts.length,
		minPromptDelayMs,
		maxPromptDelayMs,
		providerMode = "default",
		attemptIndexOffsets,
	} = job.data;
	const plog = createProviderLogger(provider);
	const browserTaskId = `collection:${collectionRunId ?? jobGroupId}:${provider}`;
	releaseProviderHumanHold(provider, browserTaskId);
	// A queue job owns exactly one provider. Never let legacy payload metadata
	// propagate this provider's progress or failure state to another provider.
	const ownedProviders = [provider];

	if (!PROVIDER_LIST.includes(provider)) {
		throw new ValidationError(`Unknown provider: ${provider}`, { provider });
	}

	if (!requestedPrompts || requestedPrompts.length === 0) {
		throw new ValidationError("Agent job received no prompts", {
			provider,
			jobGroupId,
		});
	}

	const checkpointState = collectionRunId
		? await getGeoProviderCheckpointState({ collectionRunId, provider })
		: null;
	const { prompts, completedAtStart, totalPromptCount, filteredPromptCount } =
		resolveProviderJobResume({
			requestedPrompts,
			requestedTotalPromptCount,
			initialCompletedCount,
			checkpointState,
		});
	if (prompts.length !== requestedPrompts.length) {
		plog.log(
			`resume checkpoint filtered ${filteredPromptCount} terminal prompt(s); ${prompts.length} remain`,
		);
	}

	const progressKey = `job:${jobGroupId}:result`;
	await ensureProgressSeed(progressKey, ownedProviders, totalPromptCount);
	if (prompts.length === 0) {
		const providerStatus =
			completedAtStart >= totalPromptCount
				? "completed"
				: completedAtStart > 0
					? "partial"
					: "failed";
		await updateProviderProgress({
			jobGroupId,
			provider,
			status: providerStatus,
			resultCount: completedAtStart,
		});
		await finalizeGeoProviderRun({
			collectionRunId,
			provider,
			status: "completed",
		});
		plog.log(
			"resume checkpoint has no unfinished prompts; skipping browser launch",
		);
		return true;
	}
	const hasAuth = await hasRuntimeProviderAuth(provider);
	if (!hasAuth) {
		plog.warn("skipped (no authenticated session)");
		await Promise.all(
			ownedProviders.map((currentProvider) =>
				updateProviderProgress({
					jobGroupId,
					provider: currentProvider,
					status: "failed",
					resultCount: 0,
				}),
			),
		);
		await finalizeGeoProviderRun({
			collectionRunId,
			provider,
			status: "failed",
			errorMessage: "Provider session is not authenticated",
			failureCategory: "account",
			failureCode: "login_required",
		});
		return true;
	}

	if (
		ownedProviders.some(
			(currentProvider) => PROVIDER_CONFIGS[currentProvider].skip,
		)
	) {
		plog.warn("skipped (skip: true in providerRegistry)");
		await Promise.all(
			ownedProviders.map((currentProvider) =>
				updateProviderProgress({
					jobGroupId,
					provider: currentProvider,
					status: "failed",
					resultCount: 0,
				}),
			),
		);
		await finalizeGeoProviderRun({
			collectionRunId,
			provider,
			status: "failed",
			errorMessage: "Provider is disabled",
			failureCategory: "provider_access",
			failureCode: "mode_unavailable",
		});
		return true;
	}

	const stopController = new AbortController();
	let activeAttemptCleanup: (() => Promise<void>) | null = null;
	const executionTime = new Date().toISOString();
	const payload: PromptPayload = {
		user_id,
		workspace_id,
		prompts: prompts.map(({ id, prompt }) => ({
			id,
			prompt,
		})),
		created_at: executionTime,
		providerMode,
		...(minPromptDelayMs !== undefined && maxPromptDelayMs !== undefined
			? { sampling: { minPromptDelayMs, maxPromptDelayMs } }
			: {}),
	};
	const label = PROVIDER_CONFIGS[provider].label;
	const providerResults = buildEmptyResults();
	let persistedSampleCount = completedAtStart;
	let clickhouseSampleCount = 0;
	let activePromptId: string | undefined;
	let terminalFailure: ReturnType<typeof describePromptFailure> | undefined;
	let terminalFailureMessage: string | undefined;
	let collectorShutdownRequested = false;
	const interruptAttempt = async () => {
		stopController.abort();
		await activeAttemptCleanup?.().catch(() => {});
	};

	registerActiveProviderStop(jobGroupId, provider, interruptAttempt);
	activeProviderShutdowns.set(
		buildProviderJobId(jobGroupId, provider),
		async () => {
			collectorShutdownRequested = true;
			await interruptAttempt();
		},
	);

	try {
		try {
			await Promise.all(
				ownedProviders.map((currentProvider) =>
					updateProviderProgress({
						jobGroupId,
						provider: currentProvider,
						status: "running",
						resultCount: null,
					}),
				),
			);

			if (
				(await redis.get(buildProviderCancelKey(jobGroupId, provider))) === "1"
			) {
				throw new StopProviderRunError(provider);
			}

			const result = await agentHandler(
				label,
				() =>
					createAgent(provider, {
						taskId: browserTaskId,
						visibility: "headless",
					}),
				payload,
				provider,
				{
					signal: stopController.signal,
					onAttemptStart: (attempt) => {
						activeAttemptCleanup = async () => {
							if (attempt.cleanup) {
								await attempt.cleanup().catch(() => {});
							} else {
								await attempt.context.close().catch(() => {});
							}
						};
					},
					onAttemptComplete: () => {
						activeAttemptCleanup = null;
					},
					onPromptProgress: async (current) => {
						activePromptId = prompts[current - 1]?.id;
						await updateProviderProgress({
							jobGroupId,
							provider,
							status: "running",
							resultCount: persistedSampleCount,
						});
					},
					onAttemptUpdate: async (update) => {
						if (!collectionRunId || stopController.signal.aborted) return;
						const indexedUpdate = offsetPromptAttempt(
							update,
							attemptIndexOffsets,
						);
						await recordGeoSampleAttempt({
							...indexedUpdate,
							runId: collectionRunId,
							provider,
							requestedMode: indexedUpdate.requestedMode ?? providerMode,
							actualMode: indexedUpdate.actualMode,
						});
					},
					onSampleComplete: async (sample) => {
						if (stopController.signal.aborted) return;
						const isolation = await validateGeoConversationIsolation({
							collectionRunId,
							provider,
							promptId: sample.promptId,
							conversationId: sample.conversationId,
						});
						if (!isolation.accepted) {
							plog.warn(
								`rejected prompt ${sample.promptId}: conversation ${sample.conversationId ?? "unknown"} was already used by prompt ${isolation.conflictingPromptId ?? "unknown"}`,
							);
							return;
						}
						const checkpointResult = await persistSampleCheckpoint({
							jobGroupId,
							provider,
							sample,
							userId: user_id,
							workspaceId: workspace_id,
							promptRunAt: executionTime,
						});
						persistedSampleCount += 1;
						await persistGeoSampleCheckpoint({
							collectionRunId,
							provider,
							sample,
							analyticsSampleId: checkpointResult.sampleId,
						});
						await updateProviderProgress({
							jobGroupId,
							provider,
							status: "running",
							resultCount: persistedSampleCount,
						});
						if (checkpointResult.destination === "clickhouse") {
							clickhouseSampleCount += 1;
							runAnalysisInBackground({
								workspaceId: workspace_id,
								userId: user_id,
								provider,
								jobGroupId,
								collectionRunId,
							});
						}
					},
				},
			);

			// agentHandler handles StopProviderRunError internally and returns
			// partial/empty results — check signal here to still mark as stopped.
			if (stopController.signal.aborted) {
				throw collectorShutdownRequested
					? new CollectorShutdownError(provider)
					: new StopProviderRunError(provider);
			}

			providerResults[provider] = {
				status: result.length > 0 ? "fulfilled" : "rejected",
				data: result,
			};
		} catch (err) {
			if (collectorShutdownRequested || err instanceof CollectorShutdownError) {
				plog.warn(
					"collector is stopping; returning the active sample to the provider queue",
				);
				await prepareGeoProviderForCollectorRestart({
					collectionRunId,
					provider,
				});
				await enqueueProviderJobs({
					jobGroupId,
					collectionRunId,
					prompts: requestedPrompts.map((prompt) => ({
						...prompt,
						user_id,
						workspace_id,
						created_at: executionTime,
					})),
					userId: user_id,
					workspaceId: workspace_id,
					providers: [provider],
					initialCompletedCount: persistedSampleCount,
					totalPromptCount,
					minPromptDelayMs,
					maxPromptDelayMs,
					providerModes: { [provider]: providerMode },
					attemptIndexOffsets,
					queueJobIdSuffix: `collector-restart-${Date.now()}`,
				});
				await updateProviderProgress({
					jobGroupId,
					provider,
					status: "pending",
					resultCount: persistedSampleCount,
				});
				return true;
			}
			if (err instanceof StopProviderRunError) {
				plog.warn("stopped from UI");
				await Promise.all(
					ownedProviders.map((currentProvider) =>
						updateProviderProgress({
							jobGroupId,
							provider: currentProvider,
							status: "stopped",
							resultCount: 0,
						}),
					),
				);
				await finalizeGeoProviderRun({
					collectionRunId,
					provider,
					status: "cancelled",
					errorMessage: "Stopped by user",
					activePromptId,
					failureCategory: "provider_access",
					failureCode: "provider_aborted",
				});
				return true;
			}
			if (err instanceof HumanChallengeError) {
				if (
					err.challengeKind === "login_required" &&
					(AUTH_PROVIDER_LIST as readonly string[]).includes(provider)
				) {
					await writeProviderAuthStatus(provider as AuthProvider, {
						connecting: false,
						lastUpdatedAt: new Date().toISOString(),
						syncedAt: null,
						error: "Session expired — please re-authenticate",
						launcherPid: null,
					}).catch(() => {});
				}
				terminalFailure = describePromptFailure(err);
				terminalFailureMessage = toErrorMessage(err);
				plog.warn(
					`provider setup was blocked by ${err.challengeKind}; recording terminal failures without waiting for human input`,
				);
			} else {
				plog.error("failed:", toErrorMessage(err));
				terminalFailure = describePromptFailure(err);
				terminalFailureMessage = toErrorMessage(err);
				if (
					classifyError(err) === "logged_out" &&
					(AUTH_PROVIDER_LIST as readonly string[]).includes(provider)
				) {
					await writeProviderAuthStatus(provider as AuthProvider, {
						connecting: false,
						lastUpdatedAt: new Date().toISOString(),
						syncedAt: null,
						error: "Session expired — please re-authenticate",
						launcherPid: null,
					}).catch(() => {});
				}
			}
		}

		const fulfilledProviders = ownedProviders.filter(
			(currentProvider) =>
				providerResults[currentProvider].status === "fulfilled",
		);

		if (fulfilledProviders.length > 0) {
			const partialResults: ModelResult = providerResults;
			void partialResults;

			if (clickhouseSampleCount > 0)
				runAnalysisInBackground({
					workspaceId: workspace_id,
					userId: user_id,
					provider,
					jobGroupId,
					collectionRunId,
				});
		}

		await Promise.all(
			ownedProviders.map((currentProvider) =>
				updateProviderProgress({
					jobGroupId,
					provider: currentProvider,
					status:
						persistedSampleCount >= totalPromptCount
							? "completed"
							: persistedSampleCount > 0
								? "partial"
								: "failed",
					resultCount: persistedSampleCount,
				}),
			),
		);
		await finalizeGeoProviderRun({
			collectionRunId,
			provider,
			status:
				persistedSampleCount >= totalPromptCount
					? "completed"
					: persistedSampleCount > 0
						? "partial"
						: "failed",
			activePromptId: terminalFailure ? activePromptId : undefined,
			failureCategory: terminalFailure?.category,
			failureCode: terminalFailure?.code,
			errorMessage: terminalFailureMessage,
		});

		return true;
	} finally {
		unregisterActiveProviderStop(jobGroupId, provider);
	}
}
