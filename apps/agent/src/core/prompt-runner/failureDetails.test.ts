import { HumanChallengeError } from "@anspectra/errors";
import { describe, expect, it } from "vitest";
import { describePromptFailure } from "./failureDetails.js";

describe("describePromptFailure", () => {
	it.each([
		["editor for qwen not found", "editor", "editor_missing"],
		["submission failed", "submission", "submission_failed"],
		["response timed out", "generation", "response_timeout"],
		["empty response extraction failed", "extraction", "empty_response"],
		["prompt echo extraction failed", "validation", "prompt_echo"],
		[
			"Extracted response is incomplete: heading_only",
			"validation",
			"incomplete_response",
		],
		["browser has been closed", "session", "browser_crash"],
		["page.goto: NS_ERROR_FAILURE", "navigation", "network_error"],
	] as const)("maps %s to %s/%s", (message, phase, code) => {
		const details = describePromptFailure(new Error(message));
		expect(details.phase).toBe(phase);
		expect(details.code).toBe(code);
	});

	it("keeps login challenges separate from ordinary failures", () => {
		const details = describePromptFailure(
			new HumanChallengeError({
				provider: "deepseek",
				kind: "login_required",
				pageUrl: "https://chat.deepseek.com",
				message: "Please log in",
			}),
		);
		expect(details).toMatchObject({
			phase: "session",
			category: "account",
			code: "login_required",
			retryable: false,
		});
	});
});
