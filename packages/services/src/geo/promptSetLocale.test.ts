import { describe, expect, it } from "vitest";
import {
	assertPromptSetLocales,
	normalizePromptLocales,
} from "./promptSetLocale.js";

describe("prompt set locale validation", () => {
	it("normalizes locale order and duplicates", () => {
		expect(normalizePromptLocales(["zh-CN", "en-US", "zh-CN"])).toEqual([
			"en-US",
			"zh-CN",
		]);
	});

	it("accepts a selection that matches the frozen prompts", () => {
		expect(
			assertPromptSetLocales({
				expectedLocales: ["zh-CN", "en-US"],
				manifestLocales: ["en-US", "zh-CN"],
				promptLocales: ["zh-CN", "en-US", "zh-CN"],
			}),
		).toEqual(["en-US", "zh-CN"]);
	});

	it("rejects running an English set from a Chinese selection", () => {
		expect(() =>
			assertPromptSetLocales({
				expectedLocales: ["zh-CN"],
				manifestLocales: ["en-US"],
				promptLocales: ["en-US"],
			}),
		).toThrow(/do not match the frozen set/i);
	});

	it("rejects a stale language manifest", () => {
		expect(() =>
			assertPromptSetLocales({
				manifestLocales: ["zh-CN"],
				promptLocales: ["en-US"],
			}),
		).toThrow(/manifest does not match/i);
	});
});
