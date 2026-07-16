import type { Provider } from "@aloom/types";
import {
	PROVIDER_MODEL_RESPONSE_SELECTORS,
	normalizeProviderMarkdown,
} from "@aloom/utils";
import type { Page } from "playwright";
import { turndown } from "./converter.js";

export async function extractAssistantMarkdown(
	page: Page,
	provider: Provider,
): Promise<string> {
	const html = await page.runDomOp<string>("response-html", {
		provider,
		selectors: PROVIDER_MODEL_RESPONSE_SELECTORS[provider] || [],
	});
	if (!html) return "";

	return normalizeProviderMarkdown(turndown.turndown(html));
}
