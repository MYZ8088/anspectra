import { HumanChallengeError } from "@anspectra/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	startFreshConversation: vi.fn(),
	applyMode: vi.fn(),
	executePromptWithRetry: vi.fn(),
	saveRuntimeProviderAuthSession: vi.fn(),
}));

vi.mock("@anspectra/services", () => ({
	saveRuntimeProviderAuthSession: mocks.saveRuntimeProviderAuthSession,
}));

vi.mock("../../lib/browser/providerDiagnostics.js", () => ({
	captureProviderDiagnostics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../providers/index.js", () => ({
	PROVIDER_CONFIGS: {
		doubao: {
			supportedModes: ["default", "web_search"],
			startFreshConversation: mocks.startFreshConversation,
			applyMode: mocks.applyMode,
		},
	},
}));

vi.mock("../providers/_shared/freshConversation.js", () => ({
	hasMatchingSubmittedPrompt: vi.fn().mockResolvedValue(false),
}));

vi.mock("../providers/_shared/providerModes.js", () => ({
	expectedOfficialWebMode: vi.fn((_provider, mode) => mode),
}));

vi.mock("./executePrompt.js", () => ({
	recoverSubmittedPrompt: vi.fn(),
}));

vi.mock("./retryPolicy.js", () => ({
	executePromptWithRetry: mocks.executePromptWithRetry,
}));

vi.mock("../../env.js", () => ({
	env: { ANSPECTRA_APP_MODE: "local" },
}));

import { runPrompts } from "./index.js";

describe("runPrompts terminal sample failures", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.applyMode.mockImplementation(async (_page, mode) => mode);
	});

	it("records a CAPTCHA failure and continues with the next prompt", async () => {
		mocks.startFreshConversation
			.mockRejectedValueOnce(
				new HumanChallengeError({
					provider: "doubao",
					kind: "captcha",
					pageUrl: "https://www.doubao.com/chat/blocked",
					message: "human challenge: image captcha",
				}),
			)
			.mockResolvedValueOnce(undefined);
		mocks.executePromptWithRetry.mockResolvedValueOnce({
			result: {
				userId: "user-1",
				workspaceId: "workspace-1",
				promptId: "prompt-2",
				prompt: "Prompt two",
				response: "A complete answer for prompt two.",
				sources: [],
			},
			proxyNowProven: false,
		});
		const updates: Array<Record<string, unknown>> = [];
		const page = {
			context: () => ({
				storageState: vi.fn().mockResolvedValue({ cookies: [], origins: [] }),
			}),
			url: () => "https://www.doubao.com/chat/current",
			waitForLoadState: vi.fn().mockResolvedValue(undefined),
			waitForTimeout: vi.fn().mockResolvedValue(undefined),
		};

		const results = await runPrompts(
			{
				user_id: "user-1",
				workspace_id: "workspace-1",
				created_at: new Date(0).toISOString(),
				prompts: [
					{ id: "prompt-1", prompt: "Prompt one" },
					{ id: "prompt-2", prompt: "Prompt two" },
				],
			},
			page as never,
			"doubao",
			undefined,
			undefined,
			async (update) => {
				updates.push(update);
			},
		);

		expect(results.map((result) => result.promptId)).toEqual(["prompt-2"]);
		expect(mocks.startFreshConversation).toHaveBeenCalledTimes(2);
		expect(mocks.executePromptWithRetry).toHaveBeenCalledTimes(1);
		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					promptId: "prompt-1",
					status: "failed",
					failureCode: "captcha",
					retryable: false,
				}),
			]),
		);
	});

	it("records transient fresh-conversation navigation failures as retryable", async () => {
		mocks.startFreshConversation
			.mockRejectedValueOnce(new Error("page.goto: NS_ERROR_FAILURE"))
			.mockResolvedValueOnce(undefined);
		mocks.executePromptWithRetry.mockResolvedValueOnce({
			result: {
				userId: "user-1",
				workspaceId: "workspace-1",
				promptId: "prompt-2",
				prompt: "Prompt two",
				response: "A complete answer for prompt two.",
				sources: [],
			},
			proxyNowProven: false,
		});
		const updates: Array<Record<string, unknown>> = [];
		const page = {
			context: () => ({
				storageState: vi.fn().mockResolvedValue({ cookies: [], origins: [] }),
			}),
			url: () => "https://www.doubao.com/chat/current",
			waitForLoadState: vi.fn().mockResolvedValue(undefined),
			waitForTimeout: vi.fn().mockResolvedValue(undefined),
		};

		const results = await runPrompts(
			{
				user_id: "user-1",
				workspace_id: "workspace-1",
				created_at: new Date(0).toISOString(),
				prompts: [
					{ id: "prompt-1", prompt: "Prompt one" },
					{ id: "prompt-2", prompt: "Prompt two" },
				],
			},
			page as never,
			"doubao",
			undefined,
			undefined,
			async (update) => {
				updates.push(update);
			},
		);

		expect(results.map((result) => result.promptId)).toEqual(["prompt-2"]);
		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					promptId: "prompt-1",
					status: "failed",
					failureCode: "network_error",
					retryable: true,
				}),
			]),
		);
	});

	it("reapplies the requested provider mode before a fresh-conversation resubmission", async () => {
		mocks.startFreshConversation.mockResolvedValue(undefined);
		mocks.executePromptWithRetry.mockImplementationOnce(async (...args) => {
			const freshConversationRetry = args[11] as
				| (() => Promise<void>)
				| undefined;
			await freshConversationRetry?.();
			return {
				result: {
					userId: "user-1",
					workspaceId: "workspace-1",
					promptId: "prompt-1",
					prompt: "Prompt one",
					response: "A complete answer after one controlled resubmission.",
					sources: [],
				},
				proxyNowProven: false,
			};
		});
		const page = {
			context: () => ({
				storageState: vi.fn().mockResolvedValue({ cookies: [], origins: [] }),
			}),
			url: () => "https://www.doubao.com/chat/current",
			waitForLoadState: vi.fn().mockResolvedValue(undefined),
			waitForTimeout: vi.fn().mockResolvedValue(undefined),
		};

		const [result] = await runPrompts(
			{
				user_id: "user-1",
				workspace_id: "workspace-1",
				created_at: new Date(0).toISOString(),
				providerMode: "web_search",
				prompts: [{ id: "prompt-1", prompt: "Prompt one" }],
			},
			page as never,
			"doubao",
		);

		expect(mocks.startFreshConversation).toHaveBeenCalledTimes(2);
		expect(mocks.applyMode).toHaveBeenCalledTimes(2);
		expect(mocks.applyMode).toHaveBeenNthCalledWith(1, page, "web_search");
		expect(mocks.applyMode).toHaveBeenNthCalledWith(2, page, "web_search");
		expect(result?.actualMode).toBe("web_search");
	});
});
