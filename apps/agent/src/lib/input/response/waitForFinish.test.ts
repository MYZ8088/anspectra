import { afterEach, describe, expect, it, vi } from "vitest";

let responseState = { signature: "", textLength: 0, provisional: false };

vi.mock("./isGenerating.js", () => ({
	getGenerationStateSignature: vi.fn(async () => "idle"),
	getResponseStateSignature: vi.fn(async () => responseState),
	hasVisibleGenerationIndicator: vi.fn(async () => false),
}));

import { waitForAssistantToFinish } from "./waitForFinish.js";

afterEach(() => {
	vi.useRealTimers();
	responseState = { signature: "", textLength: 0, provisional: false };
});

describe("waitForAssistantToFinish", () => {
	it("does not force-exit a stable page before any response appears", async () => {
		vi.useFakeTimers();
		let settled = false;
		const pending = waitForAssistantToFinish({} as never, "qwen").then(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(50_000);
		expect(settled).toBe(false);

		responseState = {
			signature: "120:180:2:done",
			textLength: 120,
			provisional: false,
		};
		await vi.advanceTimersByTimeAsync(5_000);
		await pending;
		expect(settled).toBe(true);
	});

	it("waits past a stable Qwen search plan until the substantive answer arrives", async () => {
		vi.useFakeTimers();
		responseState = {
			signature: "33:50:0:search-plan",
			textLength: 33,
			provisional: true,
		};
		let settled = false;
		const pending = waitForAssistantToFinish({} as never, "qwen").then(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(12_000);
		expect(settled).toBe(false);

		responseState = {
			signature: "260:420:6:final-answer",
			textLength: 260,
			provisional: false,
		};
		await vi.advanceTimersByTimeAsync(5_000);
		await pending;
		expect(settled).toBe(true);
	});
});
