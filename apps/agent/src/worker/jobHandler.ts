import {
	HumanChallengeError,
	ValidationError,
	classifyError,
	toErrorMessage,
} from "@aloom/errors";
import {
	buildProviderCancelKey,
	buildProviderJobId,
	finalizeGeoProviderRun,
	hasRuntimeProviderAuth,
	persistGeoHumanChallenge,
	persistGeoSampleCheckpoint,
	recordGeoSampleAttempt,
	recordProviderChallenge,
	redis,
	updateProviderProgress,
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

function normalizeRunProviders(
	provider: Provider,
	runProviders?: Provider[],
): Provider[] {
	const providers = (runProviders?.length ? runProviders : [provider]).filter(
		(currentProvider, index, values): currentProvider is Provider =>
			PROVIDER_LIST.includes(currentProvider) &&
			values.indexOf(currentProvider) === index,
	);
	return providers.length > 0 ? providers : [provider];
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
	activeProviderStops.delete(buildProviderJobId(jobGroupId, provider));
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

export async function handleJob(job: Job<ProviderJobData>): Promise<boolean> {
	const {
		provider,
		jobGroupId,
		collectionRunId,
		prompts,
		runProviders,
		user_id,
		workspace_id,
		initialCompletedCount = 0,
		totalPromptCount = prompts.length,
		minPromptDelayMs,
		maxPromptDelayMs,
		providerMode = "default",
		attemptIndexOffsets,
	} = job.data;
	const plog = createProviderLogger(provider);
	releaseProviderHumanHold(provider);
	const ownedProviders = normalizeRunProviders(provider, runProviders);

	if (!PROVIDER_LIST.includes(provider)) {
		throw new ValidationError(`Unknown provider: ${provider}`, { provider });
	}

	if (!prompts || prompts.length === 0) {
		throw new ValidationError("Agent job received no prompts", {
			provider,
			jobGroupId,
		});
	}

	const progressKey = `job:${jobGroupId}:result`;
	await ensureProgressSeed(progressKey, ownedProviders, prompts.length);
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
	let persistedSampleCount = initialCompletedCount;
	let clickhouseSampleCount = 0;
	let activePromptId: string | undefined;
	let terminalFailure: ReturnType<typeof describePromptFailure> | undefined;
	let terminalFailureMessage: string | undefined;

	registerActiveProviderStop(jobGroupId, provider, async () => {
		stopController.abort();
		await activeAttemptCleanup?.().catch(() => {});
	});

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
						taskId: `collection:${collectionRunId ?? jobGroupId}:${provider}`,
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
				throw new StopProviderRunError(provider);
			}

			providerResults[provider] = {
				status: result.length > 0 ? "fulfilled" : "rejected",
				data: result,
			};
		} catch (err) {
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
				const createdAt = new Date();
				const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
				if (
					err.challengeKind === "login_required" &&
					(AUTH_PROVIDER_LIST as readonly string[]).includes(provider)
				) {
					await writeProviderAuthStatus(provider as AuthProvider, {
						connecting: false,
						lastUpdatedAt: createdAt.toISOString(),
						syncedAt: null,
						error: "Session expired — please re-authenticate",
						launcherPid: null,
					}).catch(() => {});
				}
				await recordProviderChallenge({
					jobGroupId,
					provider,
					challenge: {
						kind: err.challengeKind,
						pageUrl: err.pageUrl,
						message: err.message,
						createdAt: createdAt.toISOString(),
						expiresAt: expiresAt.toISOString(),
					},
				});
				await persistGeoHumanChallenge({
					collectionRunId,
					workspaceId: workspace_id,
					provider,
					promptId: activePromptId,
					kind: err.challengeKind,
					pageUrl: err.pageUrl,
					message: err.message,
					expiresAt,
				});
				plog.warn(
					`paused for human verification (${err.challengeKind}); ${persistedSampleCount} sample(s) checkpointed`,
				);
				if (clickhouseSampleCount > 0) {
					runAnalysisInBackground({
						workspaceId: workspace_id,
						userId: user_id,
						provider,
						jobGroupId,
						collectionRunId,
					});
				}
				return true;
			}
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
