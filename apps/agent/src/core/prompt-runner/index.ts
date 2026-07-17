import {
	IPRefreshNeededError,
	classifyError,
	toErrorMessage,
} from "@aloom/errors";
import { saveRuntimeProviderAuthSession } from "@aloom/services";
import {
	type AskPromptResult,
	type PromptAttemptUpdate,
	type PromptPayload,
	type Provider,
	resolveAppMode,
	shouldUseProxyInMode,
} from "@aloom/types";
import { logger } from "@aloom/utils";
import type { Page } from "playwright";
import { env } from "../../env.js";
import { captureProviderDiagnostics } from "../../lib/browser/providerDiagnostics.js";
import { hasMatchingSubmittedPrompt } from "../providers/_shared/freshConversation.js";
import { expectedOfficialWebMode } from "../providers/_shared/providerModes.js";
import { PROVIDER_CONFIGS } from "../providers/index.js";
import { recoverSubmittedPrompt } from "./executePrompt.js";
import { describePromptFailure } from "./failureDetails.js";
import { executePromptWithRetry } from "./retryPolicy.js";

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
	resumedFromHumanChallenge = false,
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
	const requestedMode = payload.providerMode ?? "default";
	if (
		config.supportedModes?.length &&
		!config.supportedModes.includes(requestedMode)
	) {
		throw new Error(
			`${provider} does not support official Web mode "${requestedMode}"`,
		);
	}
	const results: AskPromptResult[] = [];
	let lastTerminalError: unknown = null;
	const useProxy = shouldUseProxyInMode(resolveAppMode(env.ALOOM_APP_MODE));
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

		const submittedBeforePause = resumedFromHumanChallenge
			? await hasMatchingSubmittedPrompt({
					page,
					provider,
					prompt: promptEntry.prompt,
				})
			: false;
		if (submittedBeforePause) {
			await onAttemptUpdate?.({
				promptId: promptEntry.id,
				attemptIndex: 1,
				status: "progress",
				phase: "extraction",
				pageUrl: page.url(),
				requestedMode,
				actualMode: expectedOfficialWebMode(provider, requestedMode),
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
				requestedMode,
				actualMode: expectedOfficialWebMode(provider, requestedMode),
			};
			const recoveredIdentity = await config.getConversationIdentity?.(page);
			if (recoveredIdentity) {
				recoveredResult.conversationId = recoveredIdentity.conversationId;
				recoveredResult.conversationUrl = recoveredIdentity.conversationUrl;
				recoveredResult.conversationIsolation = "fresh";
			}
			recoveredResult.sourceExposure =
				recovered.sources.length > 0 ? "exposed" : "not_exposed";
			recoveredResult.reportedSearchSourceCount =
				recovered.reportedSearchSourceCount;
			recoveredResult.searchSourceCoverage = recovered.searchSourceCoverage;
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
				requestedMode,
				actualMode: expectedOfficialWebMode(provider, requestedMode),
			}).catch(() => {});
			continue;
		}

		let actualMode = requestedMode;
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
				if (config.applyMode) {
					actualMode = await config.applyMode(page, requestedMode);
				} else if (requestedMode !== "default") {
					throw new Error(
						`${provider} cannot apply official Web mode "${requestedMode}"`,
					);
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
					retryable: details.retryable,
					pageUrl: page.url(),
					requestedMode,
				}).catch(() => {});
				lastTerminalError = err;
				logger.error(
					`prompt ${i + 1}/${promptsArray.length} could not start a fresh conversation; recorded as a terminal sample failure and continuing: ${toErrorMessage(err)}`,
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
				onAttemptUpdate
					? (update) =>
							onAttemptUpdate({
								...update,
								requestedMode,
								actualMode,
							})
					: undefined,
				config.startFreshConversation
					? async () => {
							await config.startFreshConversation?.(page);
							if (config.applyMode) {
								actualMode = await config.applyMode(page, requestedMode);
							} else if (requestedMode !== "default") {
								throw new Error(
									`${provider} cannot apply official Web mode "${requestedMode}"`,
								);
							}
						}
					: undefined,
			);
		} catch (err) {
			if (err instanceof IPRefreshNeededError) throw err;
			await captureProviderDiagnostics({
				page,
				provider,
				phase:
					classifyError(err) === "human_challenge" ? "challenge" : "prompt",
				promptId: promptEntry.id,
				error: toErrorMessage(err),
			}).catch(() => null);
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
		result.requestedMode = requestedMode;
		result.actualMode = actualMode;

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
		logger.error(
			`0/${promptsArray.length} prompts completed; every prompt has its own terminal failure record`,
		);
	} else if (results.length < promptsArray.length) {
		logger.warn(
			`${results.length}/${promptsArray.length} prompts completed; failed prompts remain in the report denominator`,
		);
	} else {
		logger.success(`all ${results.length} prompts completed`);
	}
	return results;
}
