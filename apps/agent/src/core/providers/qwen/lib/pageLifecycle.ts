import { resetProviderPage } from "../../_shared/resetProviderPage.js";
import type { ProviderConfig } from "../../types.js";

export const QWEN_URL = "https://chat.qwen.ai/";

export async function resetQwenPage(
	page: Parameters<ProviderConfig["waitForResponse"]>[0],
): Promise<void> {
	await resetProviderPage(page, "qwen", QWEN_URL);
}
