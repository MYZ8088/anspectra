import { GEO_PROVIDER_MODE_CAPABILITIES } from "@aloom/types";
import { PROVIDER_MODEL_RESPONSE_SELECTORS } from "@aloom/utils";
import { waitForAssistantToFinish } from "../../../lib/input/response/waitForFinish.js";
import {
	extractLatestChineseChatResponse,
	extractSourcesFromChineseChat,
} from "../_shared/chineseChat.js";
import { applyOfficialWebMode } from "../_shared/providerModes.js";
import {
	readConversationIdentity,
	startFreshProviderConversation,
} from "../_shared/freshConversation.js";
import type { ProviderConfig } from "../types.js";
import { DOUBAO_URL, resetDoubaoPage } from "./lib/pageLifecycle.js";

export const doubaoConfig: ProviderConfig = {
	url: DOUBAO_URL,
	label: "Doubao",
	displayName: "Doubao",
	supportedModes: GEO_PROVIDER_MODE_CAPABILITIES.doubao,
	applyMode: (page, mode) =>
		applyOfficialWebMode({ page, provider: "doubao", mode }),
	beforeRetryHook: resetDoubaoPage,
	betweenPromptsHook: resetDoubaoPage,
	startFreshConversation: async (page) => {
		await startFreshProviderConversation({
			page,
			provider: "doubao",
			homeUrl: DOUBAO_URL,
		});
	},
	getConversationIdentity: (page) => readConversationIdentity(page, "doubao"),
	waitForResponse: (page) => waitForAssistantToFinish(page, "doubao"),
	extractResponse: (page) =>
		extractLatestChineseChatResponse(
			page,
			"doubao",
			PROVIDER_MODEL_RESPONSE_SELECTORS.doubao,
		),
	extractSources: (page) =>
		extractSourcesFromChineseChat(
			page,
			"doubao",
			PROVIDER_MODEL_RESPONSE_SELECTORS.doubao,
		),
};
