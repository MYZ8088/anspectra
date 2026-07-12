import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	executePrompt: vi.fn(),
	recoverSubmittedPrompt: vi.fn(),
	beforeRetryHook: vi.fn(),
}));

vi.mock("./executePrompt.js", () => ({
	executePrompt: mocks.executePrompt,
	recoverSubmittedPrompt: mocks.recoverSubmittedPrompt,
}));

vi.mock("../providers/index.js", () => ({
	PROVIDER_CONFIGS: {
		hunyuan: {
			beforeRetryHook: mocks.beforeRetryHook,
		},
	},
}));

vi.mock("../../env.js", () => ({
	env: { ALOOM_APP_MODE: "local" },
}));

import { executePromptWithRetry } from "./retryPolicy.js";

describe("executePromptWithRetry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("re-extracts an already submitted answer without sending the prompt again", async () => {
		mocks.executePrompt.mockRejectedValueOnce(
			new Error("hunyuan: Markdown response extraction failed after 2 retries"),
		);
		mocks.recoverSubmittedPrompt.mockResolvedValueOnce({
			response: "A complete provider answer with enough detail to be valid.",
			sources: [],
		});
		const updates: Array<{ phase?: string; status: string }> = [];
		const page = {
			url: () => "https://yuanbao.tencent.com/chat/conversation",
			waitForTimeout: vi.fn().mockResolvedValue(undefined),
		};

		const result = await executePromptWithRetry(
			page as never,
			{ id: "prompt-1", prompt: "Which product should a team evaluate?" },
			"hunyuan",
			"user-1",
			"workspace-1",
			0,
			1,
			[],
			[],
			false,
			async (update) => {
				updates.push({ phase: update.phase, status: update.status });
			},
		);

		expect(result.result.response).toContain("complete provider answer");
		expect(mocks.executePrompt).toHaveBeenCalledTimes(1);
		expect(mocks.recoverSubmittedPrompt).toHaveBeenCalledTimes(1);
		expect(mocks.beforeRetryHook).not.toHaveBeenCalled();
		expect(updates).toEqual(
			expect.arrayContaining([
				{ phase: "submission", status: "started" },
				{ phase: "extraction", status: "started" },
			]),
		);
	});
});
