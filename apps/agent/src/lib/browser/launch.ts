import { ExternalServiceError } from "@anspectra/errors";
import { type Provider, resolveAppMode } from "@anspectra/types";
import type { Browser, BrowserContext } from "playwright";
import { env } from "../../env.js";
import { acquireProviderSession } from "./providerSessionManager.js";
import type { ProviderSessionVisibility } from "./providerSessionManager.js";

export async function launchContext(
	provider: Provider,
	request: { taskId: string; visibility?: ProviderSessionVisibility },
): Promise<{
	browser: Browser;
	context: BrowserContext;
	page?: import("./runtimeTypes.js").Page;
	proxy: string | null;
	cleanup: () => Promise<void>;
	invalidateProxyHint: () => Promise<void>;
	holdForHuman?: (page: import("./runtimeTypes.js").Page) => Promise<void>;
	resumePage?: import("./runtimeTypes.js").Page | null;
	minimizeWindow?: () => Promise<void>;
	focusWindow?: () => Promise<void>;
	visibility?: ProviderSessionVisibility;
}> {
	if (resolveAppMode(env.ANSPECTRA_APP_MODE) !== "local") {
		throw new ExternalServiceError(
			"browser",
			"Official Web collection requires a paired local collector. Server-side browser collection is disabled.",
			409,
			{ provider },
		);
	}

	const lease = await acquireProviderSession(provider, {
		taskId: request.taskId,
		visibility: request.visibility ?? "headless",
	});
	return {
		browser: lease.browser as Browser,
		context: lease.context as BrowserContext,
		page: lease.page,
		proxy: null,
		cleanup: lease.release,
		invalidateProxyHint: lease.invalidate,
		holdForHuman: lease.holdForHuman,
		resumePage: lease.resumePage,
		minimizeWindow: lease.minimizeWindow,
		focusWindow: lease.focusWindow,
		visibility: lease.visibility,
	};
}
