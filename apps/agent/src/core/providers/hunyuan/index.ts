import { PROVIDER_MODEL_RESPONSE_SELECTORS } from "@answerloom/utils";
import { waitForAssistantToFinish } from "../../../lib/input/response/waitForFinish.js";
import {
	extractLatestChineseChatResponse,
	extractSourcesFromChineseChat,
} from "../_shared/chineseChat.js";
import {
	readConversationIdentity,
	startFreshProviderConversation,
} from "../_shared/freshConversation.js";
import type { ProviderConfig } from "../types.js";
import { HUNYUAN_URL, resetHunyuanPage } from "./lib/pageLifecycle.js";

export const hunyuanConfig: ProviderConfig = {
	url: HUNYUAN_URL,
	label: "Tencent Hunyuan",
	displayName: "Tencent Hunyuan",
	beforeRetryHook: resetHunyuanPage,
	betweenPromptsHook: resetHunyuanPage,
	startFreshConversation: async (page) => {
		await startFreshProviderConversation({
			page,
			provider: "hunyuan",
			homeUrl: HUNYUAN_URL,
		});
	},
	getConversationIdentity: (page) => readConversationIdentity(page, "hunyuan"),
	waitForResponse: (page) => waitForAssistantToFinish(page, "hunyuan"),
	extractResponse: (page) =>
		extractLatestChineseChatResponse(
			page,
			"hunyuan",
			PROVIDER_MODEL_RESPONSE_SELECTORS.hunyuan,
		),
	extractSources: (page) =>
		extractSourcesFromChineseChat(
			page,
			"hunyuan",
			PROVIDER_MODEL_RESPONSE_SELECTORS.hunyuan,
		),
};
