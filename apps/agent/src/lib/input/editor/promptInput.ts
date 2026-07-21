import { ExternalServiceError } from "@anspectra/errors";
import type { Provider } from "@anspectra/types";
import { logger } from "@anspectra/utils";
import type { Locator, Page } from "playwright";
import {
	clickLocatorLikeUser,
	pastePrompt,
	randomBetween,
} from "../../browser/humanBehavior.js";
import { clearEditorInput } from "./clearInput.js";
import { findActiveEditorCandidate } from "./findEditor.js";

export function normalizePromptValue(text: string): string {
	return text
		.replace(/\r\n?|\u2028|\u2029/g, "\n")
		.replace(/\u00a0/g, " ")
		.replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
		.replace(/[\t ]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

async function focusEditorTarget(page: Page, input: Locator): Promise<void> {
	await input.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => null);
	await clickLocatorLikeUser(page, input, {
		timeout: 3000,
		delay: randomBetween(25, 80),
	}).catch(() => null);
	await page.waitForTimeout(randomBetween(40, 120));
	await input.focus({ timeout: 3_000 }).catch(() => null);
	await page.waitForTimeout(randomBetween(30, 90));
}

async function prepareEditorForPrompt(
	page: Page,
	input: Locator,
	provider: Provider,
): Promise<Locator> {
	let activeInput = input;
	const count = await activeInput.count().catch(() => 0);
	if (count === 0) {
		activeInput = (
			await findActiveEditorCandidate(page, provider).catch(() => null)
		)?.locator as Locator;
		if (!activeInput || (await activeInput.count().catch(() => 0)) === 0) {
			throw new ExternalServiceError(
				provider,
				`Editor not ready for ${provider}: input locator is missing`,
			);
		}
	}

	const state = await activeInput
		.getEditableState({ timeout: 3_000 })
		.catch(() => null);
	if (
		!(
			state?.connected &&
			state.editable &&
			state.enabled &&
			state.acceptsTextInput
		)
	) {
		throw new ExternalServiceError(
			provider,
			`Editor not ready for ${provider}: input is not editable`,
		);
	}

	await focusEditorTarget(page, activeInput);

	const existingValue = await activeInput
		.readInputValue({ timeout: 3_000 })
		.catch(() => "");
	if (normalizePromptValue(existingValue).length === 0) {
		await focusEditorTarget(page, activeInput);
		return activeInput;
	}

	const cleared = await clearEditorInput(page, activeInput, {
		clickTimeoutMs: 3000,
		waitAfterMs: randomBetween(40, 120),
	});
	if (!cleared) {
		throw new ExternalServiceError(
			provider,
			`Editor not ready for ${provider}: could not clear existing input`,
		);
	}

	const remainingValue = await activeInput
		.readInputValue({ timeout: 3_000 })
		.catch(() => "");
	if (normalizePromptValue(remainingValue).length > 0) {
		throw new ExternalServiceError(
			provider,
			`Editor not ready for ${provider}: input retained content after clear`,
		);
	}

	await focusEditorTarget(page, activeInput);
	return activeInput;
}

async function insertPromptOnce(
	page: Page,
	input: Locator,
	prompt: string,
	strategy: "directSet" | "pacedPaste",
): Promise<void> {
	if (strategy === "directSet") {
		await input.setInputValue(prompt, { timeout: 3_000 });
		await page.waitForTimeout(randomBetween(40, 120));
		return;
	}

	await pastePrompt(page, prompt);
}

async function waitForPromptValue(
	page: Page,
	input: Locator,
	expectedValue: string,
	timeoutMs: number,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let lastValue = await input
		.readInputValue({ timeout: 3_000 })
		.catch(() => "");

	while (Date.now() < deadline) {
		if (normalizePromptValue(lastValue) === expectedValue) {
			return lastValue;
		}

		await page.waitForTimeout(randomBetween(80, 140));
		lastValue = await input.readInputValue({ timeout: 3_000 }).catch(() => "");
	}

	return lastValue;
}

export async function insertPromptIntoEditor(
	page: Page,
	input: Locator,
	prompt: string,
	provider: Provider,
): Promise<{ rawValue: string; strategy: "directSet" | "pacedPaste" }> {
	const expectedValue = normalizePromptValue(prompt);
	const strategies: Array<"directSet" | "pacedPaste"> = [
		...(provider === "perplexity" ? [] : (["directSet"] as const)),
		"pacedPaste",
	];
	let activeInput = input;

	for (const strategy of strategies) {
		for (let attempt = 1; attempt <= 2; attempt++) {
			activeInput = await prepareEditorForPrompt(page, activeInput, provider);
			await insertPromptOnce(page, activeInput, prompt, strategy);
			const rawValue = await waitForPromptValue(
				page,
				activeInput,
				expectedValue,
				strategy === "directSet"
					? attempt === 1
						? 800
						: 1_400
					: attempt === 1
						? 1_800
						: 2_500,
			);
			if (normalizePromptValue(rawValue) === expectedValue) {
				return { rawValue, strategy };
			}

			if (attempt === 1) {
				logger.warn(
					`[${provider}] prompt verification mismatch after ${strategy} — retrying once`,
				);
			}
		}
	}

	const finalValue = await activeInput
		.readInputValue({ timeout: 3_000 })
		.catch(() => "");
	throw new ExternalServiceError(
		provider,
		`Typing failed: normalized input mismatch after local retry (expected ${expectedValue.length} chars, got ${normalizePromptValue(finalValue).length})`,
	);
}
