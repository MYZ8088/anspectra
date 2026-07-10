import { resetProviderPage } from "../../_shared/resetProviderPage.js";
import type { ProviderConfig } from "../../types.js";

export const CLAUDE_URL = "https://claude.ai/new";

export async function resetClaudePage(
	page: Parameters<ProviderConfig["waitForResponse"]>[0],
): Promise<void> {
	await resetProviderPage(page, "claude", CLAUDE_URL);
}
