import { JSDOM } from "jsdom";
import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { runPageDomOp } from "./domOps.js";

type BotPageState = {
	botDetected: boolean;
	reason: string | null;
	kind: string | null;
};

type PageDomCallback = (input: {
	operation: string;
	params: Record<string, unknown>;
}) => unknown;

async function detectState(html: string): Promise<BotPageState> {
	const dom = new JSDOM(html, { url: "https://chat.qwen.ai/c/test" });
	const runtime = globalThis as unknown as Record<string, unknown>;
	const globals = [
		"window",
		"document",
		"navigator",
		"HTMLElement",
		"HTMLInputElement",
		"Element",
		"Node",
	] as const;
	const previous = new Map(
		globals.map((key) => [key, Object.getOwnPropertyDescriptor(runtime, key)]),
	);

	Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
		configurable: true,
		get() {
			return this.textContent ?? "";
		},
	});
	Object.defineProperty(
		dom.window.HTMLElement.prototype,
		"getBoundingClientRect",
		{
			configurable: true,
			value() {
				return {
					bottom: 40,
					height: 40,
					left: 0,
					right: 640,
					top: 0,
					width: 640,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				};
			},
		},
	);

	const replacements: Record<(typeof globals)[number], unknown> = {
		window: dom.window,
		document: dom.window.document,
		navigator: dom.window.navigator,
		HTMLElement: dom.window.HTMLElement,
		HTMLInputElement: dom.window.HTMLInputElement,
		Element: dom.window.Element,
		Node: dom.window.Node,
	};
	for (const key of globals) {
		Object.defineProperty(runtime, key, {
			configurable: true,
			value: replacements[key],
			writable: true,
		});
	}

	const page = {
		evaluate: async (
			callback: PageDomCallback,
			input: Parameters<PageDomCallback>[0],
		) => callback(input),
	} as unknown as Page;

	try {
		return await runPageDomOp<BotPageState>(page, "detect-bot-page");
	} finally {
		for (const key of globals) {
			const descriptor = previous.get(key);
			if (descriptor) Object.defineProperty(runtime, key, descriptor);
			else Reflect.deleteProperty(runtime, key);
		}
		dom.window.close();
	}
}

describe("detect-bot-page DOM operation", () => {
	it("does not treat login terminology inside a completed answer as a challenge", async () => {
		const state = await detectState(`
			<main>
				<article>支持企业微信、钉钉和飞书扫码登录的二次开发。</article>
				<textarea placeholder="How can I help you today?"></textarea>
			</main>
			<div style="display: none">Press and hold to scan the QR code</div>
			<iframe style="display: none" src="https://example.test/captcha"></iframe>
		`);

		expect(state).toEqual({
			botDetected: false,
			reason: null,
			kind: null,
		});
	});

	it("detects a visible QR login dialog even when the composer remains mounted", async () => {
		const state = await detectState(`
			<textarea placeholder="How can I help you today?"></textarea>
			<div role="dialog">请使用微信扫码登录</div>
		`);

		expect(state).toMatchObject({
			botDetected: true,
			kind: "qr_login",
		});
	});

	it("detects a page-level login wall when no chat composer is available", async () => {
		const state = await detectState("<main>请先登录后继续使用</main>");

		expect(state).toMatchObject({
			botDetected: true,
			kind: "login_required",
		});
	});
});
