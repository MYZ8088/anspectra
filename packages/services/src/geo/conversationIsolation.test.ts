import { describe, expect, it } from "vitest";
import { findConflictingConversationPrompt } from "./conversationIsolation.js";

describe("findConflictingConversationPrompt", () => {
	it("rejects a conversation already completed for another prompt", () => {
		expect(
			findConflictingConversationPrompt({
				promptId: "prompt-b",
				completedSamples: [{ promptId: "prompt-a" }],
			}),
		).toBe("prompt-a");
	});

	it("allows a conversation associated only with the current prompt", () => {
		expect(
			findConflictingConversationPrompt({
				promptId: "prompt-a",
				completedSamples: [{ promptId: "prompt-a" }, { promptId: null }],
			}),
		).toBeNull();
	});

	it("allows the first use of a conversation", () => {
		expect(
			findConflictingConversationPrompt({
				promptId: "prompt-a",
				completedSamples: [],
			}),
		).toBeNull();
	});
});
