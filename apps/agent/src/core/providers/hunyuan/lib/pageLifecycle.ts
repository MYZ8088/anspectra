import { resetProviderPage } from "../../_shared/resetProviderPage.js";
import type { ProviderConfig } from "../../types.js";

export const HUNYUAN_URL = "https://yuanbao.tencent.com/";

export async function resetHunyuanPage(
	page: Parameters<ProviderConfig["waitForResponse"]>[0],
): Promise<void> {
	await resetProviderPage(page, "hunyuan", HUNYUAN_URL);
}
