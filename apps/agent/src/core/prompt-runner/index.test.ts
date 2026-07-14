import { HumanChallengeError } from "@aloom/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	startFreshConversation: vi.fn(),
	executePromptWithRetry: vi.fn(),
	saveRuntimeProviderAuthSession: vi.fn(),
}));

vi.mock("@aloom/services", () => ({
	saveRuntimeProviderAuthSession: mocks.saveRuntimeProviderAuthSession,
}));

vi.mock("../../lib/browser/providerDiagnostics.js", () => ({
	captureProviderDiagnostics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../providers/index.js", () => ({
	PROVIDER_CONFIGS: {
		doubao: {
			supportedModes: ["default"],
			startFreshConversation: mocks.startFreshConversation,
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
	env: { ALOOM_APP_MODE: "local" },
}));

import { runPrompts } from "./index.js";

describe("runPrompts terminal sample failures", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
});
