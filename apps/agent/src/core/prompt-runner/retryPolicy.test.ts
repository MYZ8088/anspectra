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
	env: { ANSPECTRA_APP_MODE: "local" },
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

	it("uses one fresh conversation when the recovered answer is still incomplete", async () => {
		mocks.executePrompt
			.mockRejectedValueOnce(
				new Error(
					"[hunyuan] Extracted response is incomplete: requested_3_sections_received_1",
				),
			)
			.mockResolvedValueOnce({
				response: "First factor. Second factor. Third factor.",
				sources: [],
			});
		mocks.recoverSubmittedPrompt.mockRejectedValueOnce(
			new Error(
				"[hunyuan] Extracted response is incomplete: requested_3_sections_received_1",
			),
		);
		let pageUrl = "https://yuanbao.tencent.com/chat/partial";
		const page = {
			url: () => pageUrl,
			waitForTimeout: vi.fn().mockResolvedValue(undefined),
		};
		const startFreshConversation = vi.fn(async () => {
			pageUrl = "https://yuanbao.tencent.com/chat/retry";
		});
		const updates: Array<{
			attemptIndex: number;
			status: string;
			pageUrl?: string;
			diagnostics?: Record<string, unknown>;
		}> = [];

		const result = await executePromptWithRetry(
			page as never,
			{ id: "prompt-1", prompt: "List three evaluation factors." },
			"hunyuan",
			"user-1",
			"workspace-1",
			0,
			1,
			[],
			[],
			false,
			async (update) => {
				updates.push(update);
			},
			startFreshConversation,
		);

		expect(result.result.response).toContain("Third factor");
		expect(mocks.executePrompt).toHaveBeenCalledTimes(2);
		expect(mocks.recoverSubmittedPrompt).toHaveBeenCalledTimes(1);
		expect(startFreshConversation).toHaveBeenCalledTimes(1);
		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					attemptIndex: 3,
					status: "started",
					pageUrl: "https://yuanbao.tencent.com/chat/retry",
					diagnostics: {
						retryStrategy: "fresh_conversation_resubmission",
					},
				}),
			]),
		);
	});

	it("does not resubmit more than once when the fresh answer is also incomplete", async () => {
		const incomplete = new Error(
			"[hunyuan] Extracted response is incomplete: requested_3_sections_received_1",
		);
		mocks.executePrompt.mockRejectedValue(incomplete);
		mocks.recoverSubmittedPrompt.mockRejectedValueOnce(incomplete);
		const page = {
			url: () => "https://yuanbao.tencent.com/chat/conversation",
			waitForTimeout: vi.fn().mockResolvedValue(undefined),
		};
		const startFreshConversation = vi.fn().mockResolvedValue(undefined);

		await expect(
			executePromptWithRetry(
				page as never,
				{ id: "prompt-1", prompt: "List three evaluation factors." },
				"hunyuan",
				"user-1",
				"workspace-1",
				0,
				1,
				[],
				[],
				false,
				undefined,
				startFreshConversation,
			),
		).rejects.toThrow("incomplete");

		expect(mocks.executePrompt).toHaveBeenCalledTimes(2);
		expect(mocks.recoverSubmittedPrompt).toHaveBeenCalledTimes(1);
		expect(startFreshConversation).toHaveBeenCalledTimes(1);
	});
});
