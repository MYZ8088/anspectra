import {
	IPRefreshNeededError,
	classifyError,
	toErrorMessage,
} from "@answerloom/errors";
import { saveRuntimeProviderAuthSession } from "@answerloom/services";
import {
	type AskPromptResult,
	type PromptAttemptUpdate,
	type PromptPayload,
	type Provider,
	resolveAppMode,
	shouldUseProxyInMode,
} from "@answerloom/types";
import { logger } from "@answerloom/utils";
import type { Page } from "playwright";
import { env } from "../../env.js";
import { captureProviderDiagnostics } from "../../lib/browser/providerDiagnostics.js";
import { PROVIDER_CONFIGS } from "../providers/index.js";
import { hasMatchingSubmittedPrompt } from "../providers/_shared/freshConversation.js";
import { recoverSubmittedPrompt } from "./executePrompt.js";
import { executePromptWithRetry } from "./retryPolicy.js";
import { describePromptFailure } from "./failureDetails.js";

/**
 * Loops over all prompts in the payload and runs each through the retry policy.
 * Propagates IPRefreshNeededError immediately so the outer job handler can rotate the proxy.
 */
export async function runPrompts(
	payload: PromptPayload,
	page: Page,
	provider: Provider,
	onPromptProgress?: (current: number, total: number) => Promise<void>,
	onSampleComplete?: (sample: AskPromptResult) => Promise<void>,
	onAttemptUpdate?: (update: PromptAttemptUpdate) => Promise<void>,
): Promise<AskPromptResult[]> {
	const {
		user_id: userId,
		workspace_id: workspaceId,
		prompts: promptsArray,
	} = payload;

	await page
		.waitForLoadState("domcontentloaded", { timeout: 30000 })
		.catch(() => {});

	const config = PROVIDER_CONFIGS[provider];
	const results: AskPromptResult[] = [];
	let lastTerminalError: unknown = null;
	const useProxy = shouldUseProxyInMode(
		resolveAppMode(env.ANSWERLOOM_APP_MODE),
	);
	let proxyProven = !useProxy;
	let persistentAuthCaptured = false;

	for (let i = 0; i < promptsArray.length; i++) {
		const promptEntry = promptsArray[i];
		if (!promptEntry) {
			logger.error(`Prompt at index ${i} is undefined.`);
			continue;
		}

		const preview =
			promptEntry.prompt.slice(0, 60) +
			(promptEntry.prompt.length > 60 ? "..." : "");
		logger.log(`prompt ${i + 1}/${promptsArray.length} — "${preview}"`);
		await onPromptProgress?.(i + 1, promptsArray.length).catch(() => {});
		if (i > 0 && payload.sampling) {
			const min = Math.max(0, payload.sampling.minPromptDelayMs);
			const max = Math.max(min, payload.sampling.maxPromptDelayMs);
			const delay = Math.round(min + Math.random() * (max - min));
			logger.log(
				`sampling cooldown ${Math.round(delay / 1000)}s before the next fresh conversation`,
			);
			await page.waitForTimeout(delay);
		}

		const submittedBeforePause = await hasMatchingSubmittedPrompt({
			page,
			provider,
			prompt: promptEntry.prompt,
		});
		if (submittedBeforePause) {
			await onAttemptUpdate?.({
				promptId: promptEntry.id,
				attemptIndex: 1,
				status: "progress",
				phase: "extraction",
				pageUrl: page.url(),
				diagnostics: { resumedAfterHumanChallenge: true },
			}).catch(() => {});
			const recovered = await recoverSubmittedPrompt(
				page,
				promptEntry.prompt,
				provider,
			);
			const recoveredResult: AskPromptResult = {
				userId,
				workspaceId,
				promptId: promptEntry.id,
				prompt: promptEntry.prompt,
				response: recovered.response,
				sources: recovered.sources,
			};
			const recoveredIdentity = await config.getConversationIdentity?.(page);
			if (recoveredIdentity) {
				recoveredResult.conversationId = recoveredIdentity.conversationId;
				recoveredResult.conversationUrl = recoveredIdentity.conversationUrl;
				recoveredResult.conversationIsolation = "fresh";
			}
			recoveredResult.sourceExposure =
				recovered.sources.length > 0 ? "exposed" : "not_exposed";
			results.push(recoveredResult);
			await onSampleComplete?.(recoveredResult);
			await onAttemptUpdate?.({
				promptId: promptEntry.id,
				attemptIndex: 1,
				status: "completed",
				phase: "completed",
				pageUrl: page.url(),
				conversationId: recoveredResult.conversationId ?? undefined,
				diagnostics: { resumedAfterHumanChallenge: true },
			}).catch(() => {});
			continue;
		}

		if (config.startFreshConversation) {
			try {
				await config.startFreshConversation(page);
				if (
					!persistentAuthCaptured &&
					["doubao", "deepseek", "hunyuan", "qwen"].includes(provider)
				) {
					persistentAuthCaptured = true;
					try {
						const storageState = await page.context().storageState();
						await saveRuntimeProviderAuthSession(provider, storageState);
					} catch (authCaptureError) {
						logger.warn(
							`[${provider}] authenticated page is usable, but its local session snapshot could not be refreshed: ${toErrorMessage(authCaptureError)}`,
						);
					}
				}
			} catch (err) {
				const details = describePromptFailure(err);
				await captureProviderDiagnostics({
					page,
					provider,
					phase: "fresh-conversation",
					promptId: promptEntry.id,
					error: toErrorMessage(err),
				}).catch(() => null);
				await onAttemptUpdate?.({
					promptId: promptEntry.id,
					attemptIndex: 1,
					status: "failed",
					phase: "fresh_conversation",
					failureCategory: details.category,
					failureCode:
						details.code === "unknown"
							? "fresh_conversation_failed"
							: details.code,
					failureMessage: toErrorMessage(err),
					retryable: false,
					pageUrl: page.url(),
				}).catch(() => {});
				if (classifyError(err) === "human_challenge") throw err;
				lastTerminalError = err;
				logger.error(
					`prompt ${i + 1}/${promptsArray.length} could not start a fresh conversation: ${toErrorMessage(err)}`,
				);
				continue;
			}
		}

		// IPRefreshNeededError propagates immediately for proxy rotation.
		// Any other terminal failure skips this prompt and preserves accumulated results.
		let executeResult: { result: AskPromptResult; proxyNowProven: boolean };
		try {
			executeResult = await executePromptWithRetry(
				page,
				promptEntry,
				provider,
				userId,
				workspaceId,
				i,
				promptsArray.length,
				results,
				promptsArray.slice(i),
				proxyProven,
				onAttemptUpdate,
			);
		} catch (err) {
			if (err instanceof IPRefreshNeededError) throw err;
			await captureProviderDiagnostics({
				page,
				provider,
				phase: classifyError(err) === "human_challenge" ? "challenge" : "prompt",
				promptId: promptEntry.id,
				error: toErrorMessage(err),
			}).catch(() => null);
			if (classifyError(err) === "human_challenge") throw err;
			if (describePromptFailure(err).category === "browser_session") throw err;
			lastTerminalError = err;
			logger.error(
				`prompt ${i + 1}/${promptsArray.length} failed permanently — skipping: ${toErrorMessage(err)}`,
			);
			continue;
		}
		const { result, proxyNowProven } = executeResult;
		const identity = await config.getConversationIdentity?.(page);
		if (identity) {
			result.conversationId = identity.conversationId;
			result.conversationUrl = identity.conversationUrl;
			result.conversationIsolation = "fresh";
		}
		result.sourceExposure =
			result.sources.length > 0 ? "exposed" : "not_exposed";

		results.push(result);
		await onSampleComplete?.(result);
		if (proxyNowProven) proxyProven = true;

		const hasMorePrompts = i < promptsArray.length - 1;
		if (
			!config.startFreshConversation &&
			config.betweenPromptsHook &&
			hasMorePrompts
		) {
			await config.betweenPromptsHook(page);
		}
	}
	if (results.length === 0 && lastTerminalError) {
		throw lastTerminalError;
	}

	logger.success(
		`all ${results.length}/${promptsArray.length} prompts completed`,
	);
	return results;
}
