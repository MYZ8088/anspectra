import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Provider } from "@aloom/types";
import { JSDOM } from "jsdom";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { extractResponseFromDeepseek } from "../deepseek/lib/extractResponse.js";
import { extractSourcesFromDeepseek } from "../deepseek/lib/extractSources.js";
import { extractLatestDoubaoArtifact } from "../doubao/lib/extractArtifact.js";
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

async function doubaoArtifactFixturePage(): Promise<Page> {
	const fixturePath = path.resolve(
		process.cwd(),
		"apps/agent/test-fixtures/providers/doubao-artifact.html",
	);
	const html = await readFile(fixturePath, "utf8");
	const dom = new JSDOM(html, { url: "https://www.doubao.com/" });
	const scroller = dom.window.document.querySelector(
		".bear-web-x-container",
	) as HTMLElement;
	Object.defineProperties(scroller, {
		scrollHeight: { configurable: true, value: 1_200 },
		clientHeight: { configurable: true, value: 600 },
		scrollTop: { configurable: true, value: 0, writable: true },
	});
	Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
		configurable: true,
		get() {
			return this.textContent ?? "";
		},
	});

	async function evaluateInFixture<T>(
		callback: (arg: unknown) => T,
		arg: unknown,
	): Promise<T> {
		const globals = [
			"window",
			"document",
			"HTMLElement",
			"HTMLAnchorElement",
			"Element",
			"Node",
		] as const;
		const previous = new Map<string, unknown>();
		for (const key of globals) {
			previous.set(key, (globalThis as Record<string, unknown>)[key]);
			(globalThis as Record<string, unknown>)[key] = dom.window[key];
		}
		try {
			return await callback(arg);
		} finally {
			for (const key of globals) {
				const value = previous.get(key);
				if (value === undefined)
					delete (globalThis as Record<string, unknown>)[key];
				else (globalThis as Record<string, unknown>)[key] = value;
			}
		}
	}

	let opened = false;
	const frame = {
		url: () => "https://www.doubao.com/partner/ccm-docx/docx/doc-1?docId=doc-1",
		waitForTimeout: async () => undefined,
		evaluate: evaluateInFixture,
	};
	const card = {
		count: async () => 1,
		last: () => card,
		isVisible: async () => true,
		scrollIntoViewIfNeeded: async () => undefined,
		click: async () => {
			opened = true;
		},
	};

	return {
		url: () => "https://www.doubao.com/chat/artifact-fixture",
		frames: () => (opened ? [frame] : []),
		locator: () => card,
		waitForTimeout: async () => undefined,
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
				expect(response).not.toContain("Product analytics source");
				expect(response).toContain("产品分析工具评估");
			}
			expect(sources).toHaveLength(2);
			expect(sources.map((source) => source.source_kind).sort()).toEqual([
				"answer_link",
				"search_source",
			]);
			expect(sources[0]?.url).toMatch(/^https:\/\/posthog\.com/);
		},
	);

	it("extracts DeepSeek answer while excluding the reasoning surface", async () => {
		const response = await extractResponseFromDeepseek(
			await fixturePage("deepseek"),
		);
		const sources = await extractSourcesFromDeepseek(
			await fixturePage("deepseek"),
		);
		expect(response).toContain("PostHog");
		expect(response).not.toContain("推理过程");
		expect(sources.map((source) => source.source_kind).sort()).toEqual([
			"answer_link",
			"search_source",
		]);
	});

	it("accepts Yuanbao submission when the sent bubble exists but the editor retains its text", async () => {
		const result = await hunyuanConfig.checkSubmitSuccess?.(
			await fixturePage("hunyuan", "hunyuan-submitting"),
			{
				preSubmitUrl: "https://example.test/hunyuan/conversation-1",
				preSubmitContent: "请用三点说明企业选择产品分析工具时应评估哪些因素。",
			},
		);
		expect(result).toBe(true);
	});

	it("opens and extracts a completed Doubao document artifact", async () => {
		const artifact = await extractLatestDoubaoArtifact(
			await doubaoArtifactFixturePage(),
		);
		expect(artifact?.markdown).toContain("# Aloom 与 Profound 五维度对比");
		expect(artifact?.markdown).toContain("明确标记无法核验的信息");
		expect(artifact?.rawSources).toEqual([
			expect.objectContaining({
				rawHref: "https://github.com/example/aloom",
				sourceKind: "answer_link",
			}),
		]);
	});
});
