import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Provider } from "@aloom/types";
import { JSDOM } from "jsdom";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { extractResponseFromDeepseek } from "../deepseek/lib/extractResponse.js";
import { hunyuanConfig } from "../hunyuan/index.js";
import {
	extractLatestChineseChatResponse,
	extractSourcesFromChineseChat,
} from "./chineseChat.js";

async function fixturePage(
	provider: Provider,
	fixtureName = `${provider}-answer`,
): Promise<Page> {
	const fixturePath = path.resolve(
		process.cwd(),
		"apps/agent/test-fixtures/providers",
		`${fixtureName}.html`,
	);
	const html = await readFile(fixturePath, "utf8");
	return {
		url: () => `https://example.test/${provider}/conversation-1`,
		evaluate: async (callback: (arg: unknown) => unknown, arg: unknown) => {
			const dom = new JSDOM(html, {
				url: `https://example.test/${provider}/conversation-1`,
			});
			const globals = [
				"window",
				"document",
				"HTMLElement",
				"Element",
				"Node",
			] as const;
			const previous = new Map<string, unknown>();
			for (const key of globals) {
				previous.set(key, (globalThis as Record<string, unknown>)[key]);
				(globalThis as Record<string, unknown>)[key] = dom.window[key];
			}
			Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
				configurable: true,
				get() {
					return this.textContent ?? "";
				},
			});
			Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent", {
				configurable: true,
				get() {
					return dom.window.document.body;
				},
			});
			dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
				x: 0,
				y: 20,
				width: 600,
				height: 120,
				top: 20,
				right: 600,
				bottom: 140,
				left: 0,
				toJSON: () => ({}),
			});
			try {
				return await callback(arg);
			} finally {
				for (const key of globals) {
					const value = previous.get(key);
					if (value === undefined)
						delete (globalThis as Record<string, unknown>)[key];
					else (globalThis as Record<string, unknown>)[key] = value;
				}
				dom.window.close();
			}
		},
	} as unknown as Page;
}

describe("redacted China provider DOM fixtures", () => {
	it.each([
		["doubao", [".message-list .markdown"]],
		["hunyuan", ["#chat-content .hyc-common-markdown"]],
		["qwen", [".qwen-chat-message-assistant .phase-answer"]],
	] as const)(
		"extracts the assistant answer and visible sources for %s",
		async (provider, selectors) => {
			const page = await fixturePage(provider);
			const response = await extractLatestChineseChatResponse(page, provider, [
				...selectors,
			]);
			const sources = await extractSourcesFromChineseChat(page, provider, [
				...selectors,
			]);
			expect(response).toContain("PostHog");
			expect(response).not.toMatch(/^推荐 B2B|^请给出|怎么选/);
			if (provider === "doubao") {
				expect(response).not.toContain("PostHog、Mixpanel 和 Amplitude 怎么选");
				expect(response).not.toContain("还想了解部署模式吗");
			}
			expect(sources).toHaveLength(1);
			expect(sources[0]?.url).toMatch(/^https:\/\/posthog\.com/);
		},
	);

	it("extracts DeepSeek answer while excluding the reasoning surface", async () => {
		const response = await extractResponseFromDeepseek(
			await fixturePage("deepseek"),
		);
		expect(response).toContain("PostHog");
		expect(response).not.toContain("推理过程");
	});

	it("accepts Yuanbao submission when the sent bubble exists but the editor retains its text", async () => {
		const result = await hunyuanConfig.checkSubmitSuccess?.(
			await fixturePage("hunyuan", "hunyuan-submitting"),
			{
				preSubmitUrl: "https://example.test/hunyuan/conversation-1",
				preSubmitContent:
					"请用三点说明企业选择产品分析工具时应评估哪些因素。",
			},
		);
		expect(result).toBe(true);
	});
});
