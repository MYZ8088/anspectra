import { waitForAssistantToFinish } from "../../../lib/input/response/waitForFinish.js";
import {
	readConversationIdentity,
	startFreshProviderConversation,
} from "../_shared/freshConversation.js";
import type { ProviderConfig } from "../types.js";
import { extractResponseFromDeepseek } from "./lib/extractResponse.js";
import { extractSourcesFromDeepseek } from "./lib/extractSources.js";
import { DEEPSEEK_URL, resetDeepseekPage } from "./lib/pageLifecycle.js";

export const deepseekConfig: ProviderConfig = {
	url: DEEPSEEK_URL,
	label: "DeepSeek",
	displayName: "DeepSeek",
	beforeRetryHook: resetDeepseekPage,
	betweenPromptsHook: resetDeepseekPage,
	startFreshConversation: async (page) => {
		await startFreshProviderConversation({
			page,
			provider: "deepseek",
			homeUrl: DEEPSEEK_URL,
		});
	},
	getConversationIdentity: (page) => readConversationIdentity(page, "deepseek"),
	waitForResponse: (page) => waitForAssistantToFinish(page, "deepseek"),
	extractResponse: (page) => extractResponseFromDeepseek(page),
	extractSources: (page) => extractSourcesFromDeepseek(page),
};
