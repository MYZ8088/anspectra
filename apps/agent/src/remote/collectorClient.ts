import { HumanChallengeError, toErrorMessage } from "@aloom/errors";
import { readAuthenticatedRuntimeProviders } from "@aloom/services/agent-auth";
import type {
	AskPromptResult,
	PromptPayload,
	Provider,
	ProviderMode,
} from "@aloom/types";
import { createProviderLogger, logger } from "@aloom/utils";
import { agentHandler } from "../core/agentHandler.js";
import { createAgent } from "../core/createAgent.js";
import { PROVIDER_CONFIGS } from "../core/providers/index.js";
import { env } from "../env.js";
import {
	focusProviderSession,
	releaseProviderHumanHold,
} from "../lib/browser/providerSessionManager.js";
import { offsetPromptAttempt } from "../worker/attemptIndex.js";

type CollectorTask = {
	taskId: string;
	runId: string;
	workspaceId: string;
	userId: string;
	provider: Provider;
	prompts: Array<{ id: string; prompt: string }>;
	minPromptDelayMs: number;
	maxPromptDelayMs: number;
	providerMode: ProviderMode;
	attemptIndexOffsets?: Record<string, number>;
};

const WEB_PROVIDERS: Provider[] = ["doubao", "deepseek", "hunyuan", "qwen"];

function collectorConfig(): { baseUrl: string; token: string } {
	if (!env.COLLECTOR_API_URL || !env.COLLECTOR_DEVICE_TOKEN) {
		throw new Error(
			"COLLECTOR_API_URL and COLLECTOR_DEVICE_TOKEN are required together",
		);
	}
	return {
		baseUrl: env.COLLECTOR_API_URL.replace(/\/+$/, ""),
		token: env.COLLECTOR_DEVICE_TOKEN,
	};
}

async function request<T>(
	action: string,
	body: Record<string, unknown> = {},
): Promise<T> {
	const config = collectorConfig();
	const response = await fetch(`${config.baseUrl}/api/runner/${action}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(action === "sample" ? 60_000 : 30_000),
	});
	const result = (await response.json()) as T & { error?: string };
	if (!response.ok)
		throw new Error(result.error || `Collector API ${action} failed`);
	return result;
}

async function executeTask(task: CollectorTask): Promise<void> {
	const plog = createProviderLogger(task.provider);
	const browserTaskId = `remote-collection:${task.taskId}:${task.provider}`;
	releaseProviderHumanHold(task.provider, browserTaskId);
	const promptRunAt = new Date().toISOString();
	const payload: PromptPayload = {
		user_id: task.userId,
		workspace_id: task.workspaceId,
		prompts: task.prompts,
		created_at: promptRunAt,
		providerMode: task.providerMode,
		sampling: {
			minPromptDelayMs: task.minPromptDelayMs,
			maxPromptDelayMs: task.maxPromptDelayMs,
		},
	};
	let completed = 0;
	try {
		const results = await agentHandler(
			PROVIDER_CONFIGS[task.provider].label,
			() =>
				createAgent(task.provider, {
					taskId: browserTaskId,
					visibility: "headless",
				}),
			payload,
			task.provider,
			{
				onAttemptUpdate: async (update) => {
					const indexedUpdate = offsetPromptAttempt(
						update,
						task.attemptIndexOffsets,
					);
					await request("attempt", {
						...indexedUpdate,
						runId: task.runId,
						provider: task.provider,
						requestedMode: indexedUpdate.requestedMode ?? task.providerMode,
						actualMode: indexedUpdate.actualMode,
					});
				},
				onSampleComplete: async (sample: AskPromptResult) => {
					await request("sample", {
						runId: task.runId,
						provider: task.provider,
						promptRunAt,
						sample,
					});
					completed += 1;
				},
			},
		);
		void results;
		await request("complete", {
			runId: task.runId,
			provider: task.provider,
			status:
				completed === task.prompts.length
					? "completed"
					: completed > 0
						? "partial"
						: "failed",
		});
	} catch (error) {
		if (error instanceof HumanChallengeError) {
			await request("complete", {
				runId: task.runId,
				provider: task.provider,
				status: completed > 0 ? "partial" : "failed",
				errorMessage: toErrorMessage(error),
			});
			plog.warn(
				"provider setup was blocked by human verification; recorded as a terminal failure without waiting",
			);
			return;
		}
		await request("complete", {
			runId: task.runId,
			provider: task.provider,
			status: completed > 0 ? "partial" : "failed",
			errorMessage: toErrorMessage(error),
		}).catch(() => null);
		throw error;
	}
}

export function startRemoteCollector(): { stop: () => void } {
	let stopped = false;
	const heartbeat = async () => {
		const connected = await readAuthenticatedRuntimeProviders(WEB_PROVIDERS);
		await request("heartbeat", {
			metadata: {
				platform: process.platform,
				arch: process.arch,
				protocolVersion: 1,
				cookieStorage: "local_only",
			},
			providerHealth: WEB_PROVIDERS.map((provider) => ({
				provider,
				status: connected.includes(provider) ? "connected" : "disconnected",
			})),
		});
	};
	const loop = async () => {
		logger.log("[collector] remote HTTPS polling started");
		let lastHeartbeat = 0;
		while (!stopped) {
			try {
				if (Date.now() - lastHeartbeat > 30_000) {
					await heartbeat();
					lastHeartbeat = Date.now();
				}
				const commandResult = await request<{
					command: { provider?: Provider; type: string } | null;
				}>("commands");
				if (
					commandResult.command?.type === "focus_challenge_window" &&
					commandResult.command.provider
				) {
					await focusProviderSession(commandResult.command.provider);
				}
				const { task } = await request<{ task: CollectorTask | null }>("claim");
				if (task) await executeTask(task);
			} catch (error) {
				logger.error(`[collector] ${toErrorMessage(error)}`);
			}
			if (!stopped) await new Promise((resolve) => setTimeout(resolve, 5_000));
		}
	};
	void loop();
	return {
		stop: () => {
			stopped = true;
		},
	};
}
