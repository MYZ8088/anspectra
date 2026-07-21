import type { Provider } from "@anspectra/types";
import { PROVIDER_MODEL_RESPONSE_SELECTORS } from "@anspectra/utils";
import type { Page } from "playwright";

export async function getText(page: Page, provider: Provider): Promise<string> {
	return await page.runDomOp<string>("response-text", {
		provider,
		selectors: PROVIDER_MODEL_RESPONSE_SELECTORS[provider] || [],
	});
}
