import { resetProviderPage } from "../../_shared/resetProviderPage.js";
import type { ProviderConfig } from "../../types.js";

export const DOUBAO_URL = "https://www.doubao.com/chat/";

export async function resetDoubaoPage(
	page: Parameters<ProviderConfig["waitForResponse"]>[0],
): Promise<void> {
	await resetProviderPage(page, "doubao", DOUBAO_URL);
}
