import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.doUnmock("../env.js");
	vi.resetModules();
});

describe("configured model client", () => {
	it("reports a missing model name when model features are used", async () => {
		vi.doMock("../env.js", () => ({
			env: { LLM_BASE_URL: "https://example.com/v1", LLM_API_KEY: "key" },
		}));
		const { getLlmModel } = await import("./index.js");

		expect(() => getLlmModel()).toThrow(/LLM_MODEL/);
	});

	it("reports a missing base URL before creating the client", async () => {
		vi.doMock("../env.js", () => ({
			env: { LLM_API_KEY: "key", LLM_MODEL: "model" },
		}));
		const { llm } = await import("./index.js");

		expect(() => llm.chat).toThrow(/LLM_BASE_URL/);
	});

	it("reports a missing API key before creating the client", async () => {
		vi.doMock("../env.js", () => ({
			env: { LLM_BASE_URL: "https://example.com/v1", LLM_MODEL: "model" },
		}));
		const { llm } = await import("./index.js");

		expect(() => llm.chat).toThrow(/LLM_API_KEY/);
	});
});
