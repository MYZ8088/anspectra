import { GEO_PROVIDER_MODE_CAPABILITIES } from "@aloom/types";
import { PROVIDER_MODEL_RESPONSE_SELECTORS } from "@aloom/utils";
import { waitForAssistantToFinish } from "../../../lib/input/response/waitForFinish.js";
import {
	extractLatestChineseChatResponse,
	extractSourcesFromChineseChat,
} from "../_shared/chineseChat.js";
import {
	readConversationIdentity,
	startFreshProviderConversation,
} from "../_shared/freshConversation.js";
import { applyOfficialWebMode } from "../_shared/providerModes.js";
import type { ProviderConfig } from "../types.js";
import { QWEN_URL, resetQwenPage } from "./lib/pageLifecycle.js";

export const qwenConfig: ProviderConfig = {
	url: QWEN_URL,
	label: "Qwen",
	displayName: "Qwen",
	supportedModes: GEO_PROVIDER_MODE_CAPABILITIES.qwen,
	applyMode: (page, mode) =>
		applyOfficialWebMode({ page, provider: "qwen", mode }),
	beforeRetryHook: resetQwenPage,
	betweenPromptsHook: resetQwenPage,
	startFreshConversation: async (page) => {
		await startFreshProviderConversation({
			page,
			provider: "qwen",
			homeUrl: QWEN_URL,
		});
	},
	getConversationIdentity: (page) => readConversationIdentity(page, "qwen"),
	waitForResponse: (page) => waitForAssistantToFinish(page, "qwen"),
	extractResponse: (page) =>
		extractLatestChineseChatResponse(
			page,
			"qwen",
			PROVIDER_MODEL_RESPONSE_SELECTORS.qwen,
		),
	extractSources: (page) =>
		extractSourcesFromChineseChat(
			page,
			"qwen",
			PROVIDER_MODEL_RESPONSE_SELECTORS.qwen,
		),
};
