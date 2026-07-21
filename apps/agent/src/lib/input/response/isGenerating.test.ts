import { JSDOM } from "jsdom";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import {
	getResponseStateSignature,
	hasVisibleGenerationIndicator,
} from "./isGenerating.js";

function pageFor(html: string): Page {
	return {
		evaluate: async (callback: (arg: unknown) => unknown, arg: unknown) => {
			const dom = new JSDOM(html);
			const globals = ["window", "document", "HTMLElement", "Element"] as const;
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

describe("Doubao generation state", () => {
	it("does not treat the echoed user prompt as an assistant response", async () => {
		const page = pageFor(`
			<div data-message-id="user" class="flex justify-end">
				<div class="md-box-root" data-streaming="false">
					In three concise points, explain what a B2B team should evaluate.
				</div>
			</div>
		`);
		await expect(getResponseStateSignature(page, "doubao")).resolves.toEqual({
			signature: "",
			textLength: 0,
			provisional: false,
		});
	});

	it("tracks the assistant streaming marker until generation finishes", async () => {
		const streamingPage = pageFor(`
			<div data-message-id="assistant" class="relative grid">
				<div class="md-box-root" data-streaming="true">
					<h2>Three evaluation points</h2><p>First point is still streaming.</p>
				</div>
			</div>
		`);
		const completedPage = pageFor(`
			<div data-message-id="assistant" class="relative grid">
				<div class="md-box-root" data-streaming="false">
					<h2>Three evaluation points</h2><p>All three points are complete.</p>
				</div>
			</div>
		`);

		expect(
			(await getResponseStateSignature(streamingPage, "doubao")).textLength,
		).toBeGreaterThan(20);
		await expect(
			hasVisibleGenerationIndicator(streamingPage, "doubao"),
		).resolves.toBe(true);
		await expect(
			hasVisibleGenerationIndicator(completedPage, "doubao"),
		).resolves.toBe(false);
	});

	it("marks a Qwen search plan as provisional instead of a final answer", async () => {
		const page = pageFor(`
			<article class="qwen-chat-message-assistant">
				<div class="response-message-content phase-answer custom-qwen-markdown">
					我将使用网页搜索来查找 PostHog 官方网站及其产品定位信息。
				</div>
			</article>
		`);
		const state = await getResponseStateSignature(page, "qwen");
		expect(state.textLength).toBeGreaterThan(20);
		expect(state.provisional).toBe(true);
	});

	it("tracks the complete Doubao assistant root after a planning block", async () => {
		const page = pageFor(`
			<div data-message-id="assistant" class="relative grid">
				<div class="md-box-root" data-streaming="false">
					我将先整理公开资料，再输出完整对比并标注来源。
				</div>
				<div class="flow-answer-content">
					<h2>完整对比</h2><p>${"这是最终回答内容。".repeat(30)}</p>
				</div>
			</div>
		`);
		const state = await getResponseStateSignature(page, "doubao");
		expect(state.textLength).toBeGreaterThan(200);
		expect(state.provisional).toBe(false);
	});

	it("accepts a finished Doubao document artifact as ready for extraction", async () => {
		const page = pageFor(`
			<div data-message-id="assistant" class="relative grid">
				<div class="md-box-root">
					我将从功能、成本、数据、集成、实施难度五个维度系统对比 Anspectra 与 Profound。
				</div>
				<div data-plugin-identifier="block_type:10030 | artifact_block.resource_type:10">
					<div data-status="finished">
						<div data-feishu-office-current-doc-old-card="true">
							Anspectra与Profound平台五维度对比分析 创建时间：23:04
						</div>
					</div>
				</div>
			</div>
		`);
		const state = await getResponseStateSignature(page, "doubao");
		expect(state.textLength).toBeGreaterThan(20);
		expect(state.provisional).toBe(false);
	});

	it("keeps waiting while Qwen announces the next search step", async () => {
		const page = pageFor(`
			<article class="qwen-chat-message-assistant">
				<div class="response-message-content phase-answer custom-qwen-markdown">
					根据搜索结果，我来访问 PostHog 官方网站获取更准确的产品定位信息。
				</div>
			</article>
		`);
		const state = await getResponseStateSignature(page, "qwen");
		expect(state.provisional).toBe(true);
	});
});
