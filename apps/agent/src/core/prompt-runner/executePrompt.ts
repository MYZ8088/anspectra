import { ExternalServiceError, ValidationError } from "@anspectra/errors";
import type { Provider, Source } from "@anspectra/types";
import type { SearchSourceCoverage } from "@anspectra/types";
import { logger, validateResponse, withTimeout } from "@anspectra/utils";
import type { Page } from "playwright";
import { detectBotPage } from "../../lib/input/response/detectBotPage.js";
import { PROVIDER_CONFIGS } from "../providers/index.js";
import { askPrompt } from "../steps/askPrompt.js";
import { checkAndExtractSources } from "../steps/extractSources.js";
import { fetchPromptResponses } from "../steps/fetchPromptResponses.js";
import { getIncompleteResponseReason } from "./responseCompleteness.js";

function normalizeForEchoCheck(value: string): string {
	return value
		.toLowerCase()
		.replace(/[\s`"'“”‘’.,!?，。！？:：;；()[\]{}<>《》、|\\/_-]+/g, "");
}

function isPromptEcho(response: string, prompt: string): boolean {
	const normalizedResponse = normalizeForEchoCheck(response);
	const normalizedPrompt = normalizeForEchoCheck(prompt);

	if (!normalizedResponse || !normalizedPrompt) return false;
	if (normalizedResponse === normalizedPrompt) return true;

	const responseIsOnlySlightlyLonger =
		normalizedResponse.length <= Math.ceil(normalizedPrompt.length * 1.35);
	return (
		responseIsOnlySlightlyLonger &&
		(normalizedResponse.startsWith(normalizedPrompt) ||
			normalizedResponse.endsWith(normalizedPrompt) ||
			normalizedResponse.includes(normalizedPrompt))
	);
}

async function extractAndValidateAnswer(
	page: Page,
	prompt: string,
	provider: Provider,
): Promise<{
	response: string;
	sources: Source[];
	reportedSearchSourceCount: number | null;
	searchSourceCoverage: SearchSourceCoverage;
}> {
	let response: string;
	try {
		response = await withTimeout(
			`[${provider}] fetchPromptResponses`,
			async () => await fetchPromptResponses(page, provider),
			6 * 60 * 1000,
		);
	} catch (error) {
		await detectBotPage(page, provider);
		throw error;
	}
	await detectBotPage(page, provider);
	if (!response || response.trim().length === 0) {
		throw new ExternalServiceError(
			provider,
			"Empty response extracted; blocking source extraction and retrying prompt",
		);
	}

	if (isPromptEcho(response, prompt)) {
		throw new ValidationError(
			`[${provider}] Extracted response is prompt echo`,
			{
				provider,
				reason: "prompt_echo",
				responseLength: response.trim().length,
				promptLength: prompt.trim().length,
			},
		);
	}

	const incompleteReason = getIncompleteResponseReason(response, prompt);
	if (incompleteReason) {
		throw new ValidationError(
			`[${provider}] Extracted response is incomplete: ${incompleteReason}`,
			{
				provider,
				reason: "incomplete_response",
				incompleteReason,
				responseLength: response.trim().length,
			},
		);
	}

	const validation = validateResponse(response, provider);
	if (!validation.valid) {
		logger.warn(
			`invalid response (${response.trim().length} chars): ${validation.reason} — retrying`,
		);
		throw new ValidationError(
			`[${provider}] Invalid response: ${validation.reason}`,
			{
				provider,
				reason: validation.reason,
			},
		);
	}

	const sourceResult = await withTimeout(
		`[${provider}] extractSources`,
		async () => await checkAndExtractSources(page, provider, response),
		20_000,
	);
	return { response, ...sourceResult };
}

export async function recoverSubmittedPrompt(
	page: Page,
	prompt: string,
	provider: Provider,
): Promise<{
	response: string;
	sources: Source[];
	reportedSearchSourceCount: number | null;
	searchSourceCoverage: SearchSourceCoverage;
}> {
	logger.log(
		`[${provider}] recovering the submitted prompt after verification`,
	);
	return extractAndValidateAnswer(page, prompt, provider);
}

/**
 * Runs one full prompt cycle for a single prompt:
 *   1. Type and submit the prompt (or navigate directly if navigateToPrompt is set)
 *   2. Wait for the response to finish generating
 *   3. Extract and validate the response text
 *   4. Extract citation sources
 *
 * Has no knowledge of retries or backoff — throws on failure so the
 * caller's retry policy can decide whether to retry or escalate.
 */
export async function executePrompt(
	page: Page,
	prompt: string,
	provider: Provider,
): Promise<{
	response: string;
	sources: Source[];
	reportedSearchSourceCount: number | null;
	searchSourceCoverage: SearchSourceCoverage;
}> {
	const config = PROVIDER_CONFIGS[provider];
	try {
		if (config.navigateToPrompt) {
			await withTimeout(
				`[${provider}] navigateToPrompt`,
				async () => await config.navigateToPrompt?.(page, prompt),
				45_000,
			);
		} else {
			await withTimeout(
				`[${provider}] askPrompt`,
				async () => await askPrompt(page, prompt, provider),
				60_000,
			);
		}
	} catch (error) {
		await detectBotPage(page, provider);
		throw error;
	}

	return extractAndValidateAnswer(page, prompt, provider);
}
