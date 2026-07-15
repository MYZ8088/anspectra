import type { ProviderMode } from "./geo.js";
import type { Source } from "./sources.js";
import type { SearchSourceCoverage } from "./sources.js";

export interface AskPromptResult {
	userId: string;
	workspaceId: string;
	promptId: string;
	prompt: string;
	response: string;
	sources: Source[];
	conversationId?: string | null;
	conversationUrl?: string | null;
	conversationIsolation?: "fresh" | "multi_turn_experiment";
	sourceExposure?: "exposed" | "not_exposed";
	reportedSearchSourceCount?: number | null;
	searchSourceCoverage?: SearchSourceCoverage;
	requestedMode?: ProviderMode;
	actualMode?: ProviderMode;
}

export const PROVIDER_LIST = [
	"chatgpt",
	"perplexity",
	"gemini",
	"claude",
	"deepseek",
	"doubao",
	"hunyuan",
	"qwen",
	"ai-overview",
] as const;

export type Provider = (typeof PROVIDER_LIST)[number];

export const APP_MODE_LIST = ["self-host", "local"] as const;

export type AppMode = (typeof APP_MODE_LIST)[number];

export function resolveAppMode(rawMode?: string | null): AppMode {
	if (rawMode === "self-host" || rawMode === "local") {
		return rawMode;
	}

	return "self-host";
}

export function canAccessPeopleInMode(appMode: AppMode): boolean {
	return appMode !== "local";
}

export function canConfigureRecurringScheduleInMode(appMode: AppMode): boolean {
	return appMode !== "local";
}

export function shouldUseProxyInMode(_appMode: AppMode): boolean {
	return false;
}

export function isInteractiveAuthAllowedInMode(appMode: AppMode): boolean {
	return appMode === "local";
}

export const AUTH_PROVIDER_LIST = [
	"chatgpt",
	"perplexity",
	"gemini",
	"google",
	"claude",
	"deepseek",
	"doubao",
	"hunyuan",
	"qwen",
] as const;

export type AuthProvider = (typeof AUTH_PROVIDER_LIST)[number];

export interface ProviderAuthStatus {
	provider: AuthProvider;
	connected: boolean;
	connecting: boolean;
	synced: boolean;
	lastUpdatedAt: string | null;
	syncedAt: string | null;
	error: string | null;
}

export type AgentResult = {
	status: "fulfilled" | "rejected";
	data: AskPromptResult[];
};

export type ModelResult = Record<Provider, AgentResult>;
