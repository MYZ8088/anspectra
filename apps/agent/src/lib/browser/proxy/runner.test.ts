import { HumanChallengeError } from "@aloom/errors";
import type { AskPromptResult, PromptPayload } from "@aloom/types";
import type { Browser, BrowserContext, Page } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAgentsMock } = vi.hoisted(() => ({ runAgentsMock: vi.fn() }));

vi.mock("../../../core/runAgents.js", () => ({
	runAgents: runAgentsMock,
}));

import { runWithRetryCycles } from "./runner.js";

function sample(promptId: string): AskPromptResult {
	return {
		userId: "user-1",
		workspaceId: "workspace-1",
		promptId,
		prompt: `Prompt ${promptId}`,
		response: `Answer ${promptId}`,
		sources: [],
	};
}

describe("persistent provider retry checkpoints", () => {
	beforeEach(() => {
		process.env.ALOOM_APP_MODE = "local";
		runAgentsMock.mockReset();
	});

	it("retries only unfinished prompts after a browser crash", async () => {
		const payload: PromptPayload = {
			user_id: "user-1",
			workspace_id: "workspace-1",
			created_at: new Date(0).toISOString(),
			prompts: [
				{ id: "prompt-1", prompt: "Prompt prompt-1" },
				{ id: "prompt-2", prompt: "Prompt prompt-2" },
			],
		};
		const persisted: string[] = [];
		const cleanup = vi.fn(async () => {});
		const agentFactory = vi.fn(async () => ({
			browser: {} as Browser,
			context: { close: vi.fn(async () => {}) } as unknown as BrowserContext,
			page: {} as Page,
			cleanup,
		}));

		runAgentsMock
			.mockImplementationOnce(
				async (
					_attemptPayload: PromptPayload,
					_page: Page,
					_provider: string,
					_progress: unknown,
					onSampleComplete: (value: AskPromptResult) => Promise<void>,
				) => {
					await onSampleComplete(sample("prompt-1"));
					throw new Error("Target page, context or browser has been closed");
				},
			)
			.mockImplementationOnce(
				async (
					attemptPayload: PromptPayload,
					_page: Page,
					_provider: string,
					_progress: unknown,
					onSampleComplete: (value: AskPromptResult) => Promise<void>,
				) => {
					expect(attemptPayload.prompts.map((prompt) => prompt.id)).toEqual([
						"prompt-2",
					]);
					const second = sample("prompt-2");
					await onSampleComplete(second);
					return [second];
				},
			);

		const result = await runWithRetryCycles(
			"Yuanbao",
			agentFactory,
			payload,
			"hunyuan",
			{
				onSampleComplete: async (value) => {
					persisted.push(value.promptId);
				},
			},
		);

		expect(runAgentsMock).toHaveBeenCalledTimes(2);
		expect(agentFactory).toHaveBeenCalledTimes(2);
		expect(persisted).toEqual(["prompt-1", "prompt-2"]);
		expect(result.map((value) => value.promptId)).toEqual([
			"prompt-1",
			"prompt-2",
		]);
	});

	it("returns persisted partial samples when unfinished retries are exhausted", async () => {
		const payload: PromptPayload = {
			user_id: "user-1",
			workspace_id: "workspace-1",
			created_at: new Date(0).toISOString(),
			prompts: [
				{ id: "prompt-1", prompt: "Prompt prompt-1" },
				{ id: "prompt-2", prompt: "Prompt prompt-2" },
			],
		};
		const persisted: string[] = [];
		const agentFactory = vi.fn(async () => ({
			browser: {} as Browser,
			context: { close: vi.fn(async () => {}) } as unknown as BrowserContext,
			page: {} as Page,
			cleanup: vi.fn(async () => {}),
		}));

		runAgentsMock
			.mockImplementationOnce(
				async (
					_attemptPayload: PromptPayload,
					_page: Page,
					_provider: string,
					_progress: unknown,
					onSampleComplete: (value: AskPromptResult) => Promise<void>,
				) => {
					await onSampleComplete(sample("prompt-1"));
					throw new Error("Target page, context or browser has been closed");
				},
			)
			.mockImplementationOnce(async (attemptPayload: PromptPayload) => {
				expect(attemptPayload.prompts.map((prompt) => prompt.id)).toEqual([
					"prompt-2",
				]);
				throw new Error("Extracted response is incomplete");
			});

		const result = await runWithRetryCycles(
			"Doubao",
			agentFactory,
			payload,
			"doubao",
			{
				onSampleComplete: async (value) => {
					persisted.push(value.promptId);
				},
			},
		);

		expect(persisted).toEqual(["prompt-1"]);
		expect(result.map((value) => value.promptId)).toEqual(["prompt-1"]);
	});

	it("does not open a visible handoff when provider setup hits a CAPTCHA", async () => {
		const preserveForHuman = vi.fn(async () => {});
		const cleanup = vi.fn(async () => {});
		const agentFactory = vi.fn(async () => ({
			browser: {} as Browser,
			context: { close: vi.fn(async () => {}) } as unknown as BrowserContext,
			page: {} as Page,
			cleanup,
			preserveForHuman,
		}));
		runAgentsMock.mockRejectedValueOnce(
			new HumanChallengeError({
				provider: "doubao",
				kind: "captcha",
				pageUrl: "https://www.doubao.com/chat/blocked",
				message: "human challenge: image captcha",
			}),
		);

		await expect(
			runWithRetryCycles(
				"Doubao",
				agentFactory,
				{
					user_id: "user-1",
					workspace_id: "workspace-1",
					created_at: new Date(0).toISOString(),
					prompts: [{ id: "prompt-1", prompt: "Prompt one" }],
				},
				"doubao",
			),
		).rejects.toBeInstanceOf(HumanChallengeError);
		expect(preserveForHuman).not.toHaveBeenCalled();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});
});
