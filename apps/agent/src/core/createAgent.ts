import {
	BaseError,
	ExternalServiceError,
	toErrorMessage,
} from "@aloom/errors";
import type { Provider } from "@aloom/types";
import { logger, withTimeout } from "@aloom/utils";
import type { Browser, BrowserContext, Page } from "playwright";
import { launchContext } from "../lib/browser/launch.js";
import { navigateWithRetry } from "../lib/browser/navigate.js";
import { PROVIDER_CONFIGS } from "./providers/index.js";

const DEFAULT_PAGE_TIMEOUT_MS = 30_000;
const DEFAULT_NAV_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 20_000;

export async function createAgent(
	provider: Provider,
	request: {
		taskId: string;
		visibility?: "headless" | "headful";
	},
): Promise<{
	browser: Browser;
	context: BrowserContext;
	page: Page;
	proxy: string | null;
	cleanup: () => Promise<void>;
	invalidateProxyHint: () => Promise<void>;
	preserveForHuman?: () => Promise<void>;
	resumedFromHumanChallenge: boolean;
}> {
	const config = PROVIDER_CONFIGS[provider];

	const {
		browser,
		context,
		proxy,
		cleanup,
		invalidateProxyHint,
		holdForHuman,
		resumePage,
		minimizeWindow,
		focusWindow,
		visibility: actualVisibility,
		page: leasedPage,
	} = await launchContext(provider, request);
	let phase = "new_page";
	let activePage: Page | null = null;

	try {
		const canResumeHeldPage = Boolean(
			resumePage && (await resumePage.ping().catch(() => false)),
		);
		const page =
			canResumeHeldPage && resumePage
				? resumePage
				: leasedPage ?? (await context.newPage());
		activePage = page;

		if (!canResumeHeldPage && !config.skipInitialNavigation) {
			if (config.preNavigationHook) {
				const preNavigationHook = config.preNavigationHook;
				phase = "pre_navigation_hook";
				await withTimeout(
					`[${provider}] preNavigationHook`,
					async () => preNavigationHook(page),
					HOOK_TIMEOUT_MS,
				);
			}

			phase = "navigate";
			logger.log(`navigating to ${config.url}`);
			await navigateWithRetry(page, config.url, {
				waitUntil: "domcontentloaded",
				timeout: 30000,
			});

			if (config.postNavigationHook) {
				const postNavigationHook = config.postNavigationHook;
				phase = "post_navigation_hook";
				await withTimeout(
					`[${provider}] postNavigationHook`,
					async () => postNavigationHook(page),
					HOOK_TIMEOUT_MS,
				);
			}

			logger.log(`page ready: ${page.url()}`);
		}

		// Keep finite defaults to prevent indefinite hangs in locator/actions.
		// Long-running response generation is handled separately via explicit waits.
		page.setDefaultTimeout(DEFAULT_PAGE_TIMEOUT_MS);
		page.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT_MS);
		await minimizeWindow?.().catch(() => null);

		let cleanedUp = false;
		let preservePageForHuman = false;
		const cleanupAgent = async () => {
			if (cleanedUp) return;
			cleanedUp = true;
			if (!preservePageForHuman && actualVisibility !== "headful") {
				await page.close().catch(() => null);
			}
			await cleanup();
		};

		return {
			browser,
			context,
			page,
			proxy,
			cleanup: cleanupAgent,
			invalidateProxyHint,
			resumedFromHumanChallenge: canResumeHeldPage,
			preserveForHuman: async () => {
				preservePageForHuman = true;
				await holdForHuman?.(page);
				void focusWindow?.();
			},
		};
	} catch (err) {
		await activePage?.close().catch(() => null);
		await cleanup();
		if (err instanceof BaseError) {
			throw err;
		}
		throw new ExternalServiceError(
			provider,
			`createAgent failed during ${phase}: ${toErrorMessage(err)}`,
			502,
			{
				phase,
				provider,
				url: config.url,
				proxy,
			},
			err,
		);
	}
}
