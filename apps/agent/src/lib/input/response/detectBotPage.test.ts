import { HumanChallengeError } from "@aloom/errors";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { detectBotPage } from "./detectBotPage.js";

describe("detectBotPage", () => {
	it.each([
		["captcha", "Complete the image challenge"],
		["slider", "Complete the slider"],
		["qr_login", "Scan the login code"],
		["login_required", "Sign in again"],
		["security_check", "Confirm account access"],
	] as const)("pauses collection for a %s challenge", async (kind, reason) => {
		const page = {
			url: () => "https://example.test/challenge",
			runDomOp: async () => ({ botDetected: true, kind, reason }),
		} as unknown as Page;
		const error = await detectBotPage(page, "doubao").catch((caught) => caught);
		expect(error).toBeInstanceOf(HumanChallengeError);
		expect(error.challengeKind).toBe(kind);
		expect(error.pageUrl).toBe("https://example.test/challenge");
	});

	it("does not interrupt a healthy provider page", async () => {
		const page = {
			url: () => "https://example.test/chat",
			runDomOp: async () => ({ botDetected: false, kind: null, reason: null }),
		} as unknown as Page;
		await expect(detectBotPage(page, "qwen")).resolves.toBeUndefined();
	});
});
