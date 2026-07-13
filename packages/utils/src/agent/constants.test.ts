import { describe, expect, it } from "vitest";
import { PROVIDER_SUBMIT_BTN_SELECTORS } from "./constants.js";

describe("provider submit button selectors", () => {
	it("tracks Doubao's current icon-only send button", () => {
		expect(PROVIDER_SUBMIT_BTN_SELECTORS.doubao).toContain(
			"button#flow-end-msg-send",
		);
	});
});
