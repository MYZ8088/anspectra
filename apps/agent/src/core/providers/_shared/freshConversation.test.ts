import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { readConversationIdentity } from "./freshConversation.js";

describe("readConversationIdentity", () => {
	it("records a real conversation id from a provider URL", async () => {
		const page = {
			url: () => "https://chat.deepseek.com/a/chat/s/abc12345",
		} as Page;
		await expect(readConversationIdentity(page)).resolves.toEqual({
			conversationId: "abc12345",
			conversationUrl: "https://chat.deepseek.com/a/chat/s/abc12345",
		});
	});

	it("does not treat a generic chat route as an isolated conversation", async () => {
		const page = {
			url: () => "https://www.doubao.com/chat/",
			evaluate: async () => [],
		} as unknown as Page;
		expect((await readConversationIdentity(page)).conversationId).toBeNull();
	});
});
