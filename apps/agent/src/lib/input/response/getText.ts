import type { Provider } from "@answerloom/types";
import { PROVIDER_MODEL_RESPONSE_SELECTORS } from "@answerloom/utils";
import type { Page } from "playwright";

export async function getText(page: Page, provider: Provider): Promise<string> {
	return await page.runDomOp<string>("response-text", {
		provider,
		selectors: PROVIDER_MODEL_RESPONSE_SELECTORS[provider] || [],
	});
}
