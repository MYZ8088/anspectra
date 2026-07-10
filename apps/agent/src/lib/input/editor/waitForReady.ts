import { NotFoundError } from "@answerloom/errors";
import { type Provider, resolveAppMode } from "@answerloom/types";
import { PROVIDER_EDITOR_SELECTORS, logger } from "@answerloom/utils";
import type { Locator, Page } from "playwright";
import { env } from "../../../env.js";
import { detectBotPage } from "../response/detectBotPage.js";
import {
	type EditorCandidate,
	findActiveEditorCandidate,
	findActiveEditorCandidateFromSelectors,
} from "./findEditor.js";

// Check for bot/login wall every N polls instead of every poll to avoid overhead.
const BOT_CHECK_EVERY_N_POLLS = 10; // ~2s intervals at 200ms per poll
const DEFAULT_EDITOR_READY_TIMEOUT_MS = 18_000;
// In local mode the user may need to complete an OAuth login flow before the
// editor appears. Give them up to 5 minutes rather than killing the browser.
const LOCAL_EDITOR_READY_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_PRIMARY_SELECTOR_GRACE_MS = 5_000;
const EDITOR_READY_TIMEOUT_MS: Partial<Record<Provider, number>> = {
	gemini: 20_000,
};
const PRIMARY_SELECTOR_GRACE_MS: Partial<Record<Provider, number>> = {
	gemini: 8_000,
};

const isLocalMode = resolveAppMode(env.ANSWERLOOM_APP_MODE) === "local";
const STABLE_POLLS_REQUIRED = 2;
const POLL_INTERVAL_MS = 200;
const EDITOR_PROBE_TIMEOUT_MS = 1_500;

async function waitForInitialDomSettle(page: Page): Promise<void> {
	await page
		.waitForLoadState("domcontentloaded", { timeout: 4_000 })
		.catch(() => {});
	await page
		.waitForLoadState("networkidle", { timeout: 2_500 })
		.catch(() => {});
	await page.waitForTimeout(150);
}

async function isEditorReady(
	input: Locator,
	provider: Provider,
): Promise<boolean> {
	const state = await input
		.getEditableState({ timeout: EDITOR_PROBE_TIMEOUT_MS })
		.catch(() => null);
	return Boolean(
		state?.connected &&
			state.visible &&
			state.editable &&
			state.enabled &&
			(state.acceptsTextInput || provider === "perplexity"),
	);
}

async function waitForStableEditorCandidate(
	page: Page,
	provider: Provider,
	resolveCandidate: () => Promise<EditorCandidate | null>,
): Promise<EditorCandidate | null> {
	let stablePolls = 0;
	let lastCandidate: EditorCandidate | null = null;

	while (stablePolls < STABLE_POLLS_REQUIRED) {
		const candidate = await resolveCandidate();
		if (!candidate) {
			stablePolls = 0;
			lastCandidate = null;
			return null;
		}

		const ready = await isEditorReady(candidate.locator, provider);
		if (!ready) {
			stablePolls = 0;
			lastCandidate = null;
			return null;
		}

		lastCandidate = candidate;
		stablePolls += 1;
		if (stablePolls >= STABLE_POLLS_REQUIRED) {
			return lastCandidate;
		}

		await page.waitForTimeout(POLL_INTERVAL_MS);
	}

	return lastCandidate;
}

export async function waitForEditorReady(
	page: Page,
	provider: Provider,
): Promise<Locator> {
	await waitForInitialDomSettle(page);

	const start = Date.now();
	const primarySelector = PROVIDER_EDITOR_SELECTORS[provider]?.[0];
	const readyTimeoutMs = isLocalMode
		? LOCAL_EDITOR_READY_TIMEOUT_MS
		: (EDITOR_READY_TIMEOUT_MS[provider] ?? DEFAULT_EDITOR_READY_TIMEOUT_MS);
	const primaryGraceMs =
		PRIMARY_SELECTOR_GRACE_MS[provider] ?? DEFAULT_PRIMARY_SELECTOR_GRACE_MS;
	let polls = 0;

	while (Date.now() - start < readyTimeoutMs) {
		const elapsedMs = Date.now() - start;
		const input =
			primarySelector && elapsedMs < primaryGraceMs
				? await waitForStableEditorCandidate(page, provider, () =>
						findActiveEditorCandidateFromSelectors(page, [
							primarySelector,
						]).catch(() => null),
					)
				: await waitForStableEditorCandidate(page, provider, () =>
						findActiveEditorCandidate(page, provider).catch(() => null),
					);

		if (!input) {
			polls += 1;
			if (polls % BOT_CHECK_EVERY_N_POLLS === 0) {
				await detectBotPage(page, provider);
			}
			await page.waitForTimeout(POLL_INTERVAL_MS);
			continue;
		}

		logger.debug(`found editor: ${input.selector}`);
		return input.locator;
	}

	await detectBotPage(page, provider);
	throw new NotFoundError(`editor for ${provider}`);
}
