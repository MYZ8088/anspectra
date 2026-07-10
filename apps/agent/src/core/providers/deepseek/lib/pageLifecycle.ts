import { resetProviderPage } from "../../_shared/resetProviderPage.js";
import type { ProviderConfig } from "../../types.js";

export const DEEPSEEK_URL = "https://chat.deepseek.com/";

export async function resetDeepseekPage(
	page: Parameters<ProviderConfig["waitForResponse"]>[0],
): Promise<void> {
	await resetProviderPage(page, "deepseek", DEEPSEEK_URL);
}
