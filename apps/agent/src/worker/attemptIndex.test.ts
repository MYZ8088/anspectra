import type { PromptAttemptUpdate } from "@anspectra/types";
import { describe, expect, it } from "vitest";
import { offsetPromptAttempt } from "./attemptIndex.js";

const update: PromptAttemptUpdate = {
	promptId: "prompt-1",
	attemptIndex: 2,
	status: "failed",
	phase: "extraction",
};

describe("offsetPromptAttempt", () => {
	it("preserves normal run attempt indexes", () => {
		expect(offsetPromptAttempt(update).attemptIndex).toBe(2);
	});

	it("continues attempt history for a manually retried checkpoint", () => {
		expect(offsetPromptAttempt(update, { "prompt-1": 3 }).attemptIndex).toBe(5);
	});

	it("does not apply another prompt's offset", () => {
		expect(offsetPromptAttempt(update, { "prompt-2": 9 }).attemptIndex).toBe(2);
	});
});
