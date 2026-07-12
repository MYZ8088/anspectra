import { describe, expect, it } from "vitest";
import {
	applyPersistentVisibility,
	assertBrowserTaskId,
} from "./providerSessionManager.js";

describe("task-bound persistent provider sessions", () => {
	it("rejects browser launches without a task ID", () => {
		expect(() => assertBrowserTaskId("   ")).toThrow(/task ID/i);
	});

	it("normalizes task IDs without changing their identity", () => {
		expect(assertBrowserTaskId(" collection:run-1:qwen ")).toBe(
			"collection:run-1:qwen",
		);
	});

	it("keeps headless diagnostics isolated from headful collection", () => {
		const base = { env: { LANG: "en_US.UTF-8" }, headless: false };
		const headless = applyPersistentVisibility(base, "headless");
		expect(headless.headless).toBe(true);
		expect(headless.env).toMatchObject({ MOZ_HEADLESS: "1" });

		const headful = applyPersistentVisibility(headless, "headful");
		expect(headful.headless).toBe(false);
		expect(headful.env).not.toHaveProperty("MOZ_HEADLESS");
	});
});
