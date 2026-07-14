import { describe, expect, it } from "vitest";
import { resolveProviderJobResume } from "./jobResume.js";

const prompts = [
	{ id: "prompt-1", prompt: "First" },
	{ id: "prompt-2", prompt: "Second" },
	{ id: "prompt-3", prompt: "Third" },
];

describe("resolveProviderJobResume", () => {
	it("keeps the original payload for jobs without collection checkpoints", () => {
		expect(
			resolveProviderJobResume({
				requestedPrompts: prompts,
				requestedTotalPromptCount: 3,
				initialCompletedCount: 0,
				checkpointState: null,
			}),
		).toMatchObject({
			prompts,
			completedAtStart: 0,
			totalPromptCount: 3,
			filteredPromptCount: 0,
		});
	});

	it("removes prompts that became terminal before a stalled job restarts", () => {
		const result = resolveProviderJobResume({
			requestedPrompts: prompts,
			requestedTotalPromptCount: 3,
			initialCompletedCount: 0,
			checkpointState: {
				totalCount: 4,
				completedCount: 2,
				runnablePromptIds: ["prompt-2"],
			},
		});

		expect(result.prompts).toEqual([prompts[1]]);
		expect(result.completedAtStart).toBe(2);
		expect(result.totalPromptCount).toBe(4);
		expect(result.filteredPromptCount).toBe(2);
	});

	it("returns an empty payload when another recovery job already finished it", () => {
		const result = resolveProviderJobResume({
			requestedPrompts: prompts,
			requestedTotalPromptCount: 3,
			initialCompletedCount: 1,
			checkpointState: {
				totalCount: 3,
				completedCount: 3,
				runnablePromptIds: [],
			},
		});

		expect(result.prompts).toEqual([]);
		expect(result.completedAtStart).toBe(3);
		expect(result.filteredPromptCount).toBe(3);
	});
});
