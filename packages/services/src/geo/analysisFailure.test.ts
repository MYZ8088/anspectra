import { describe, expect, it } from "vitest";
import { classifyAnalysisFailureCode } from "./analysisFailure.js";

describe("classifyAnalysisFailureCode", () => {
	it.each([
		["401 usage limit exhausted", "analysis_upstream_quota"],
		["401 unauthorized", "analysis_upstream_auth"],
		["429 too many requests", "analysis_upstream_rate_limit"],
		["Request timed out", "analysis_upstream_timeout"],
		["Invalid JSON returned from LLM", "analysis_invalid_json"],
		["Connection closed", "analysis_upstream_error"],
	] as const)("classifies %s", (message, expected) => {
		expect(classifyAnalysisFailureCode(message)).toBe(expected);
	});
});
