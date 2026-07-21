import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	GEO_PROVIDER_MODE_CAPABILITIES,
	getProviderModeLabel,
} from "@anspectra/types";
import { JSDOM } from "jsdom";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import {
	applyOfficialWebMode,
	expectedOfficialWebMode,
	readProviderModeControls,
} from "./providerModes.js";

async function modeFixturePage(provider: string): Promise<{
	page: Page;
	close: () => void;
}> {
	const html = await readFile(
		path.resolve(
			process.cwd(),
			"apps/agent/test-fixtures/providers",
			`${provider}-modes.html`,
		),
		"utf8",
	);
	const dom = new JSDOM(html, {
		url: `https://example.test/${provider}`,
		runScripts: "dangerously",
	});
	Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
		configurable: true,
		get() {
			return this.textContent ?? "";
		},
	});
	dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
		const hidden = Array.from(
			(function* (element: HTMLElement | null) {
				let current = element;
				while (current) {
					yield current;
					current = current.parentElement;
				}
			})(this),
		).some(
			(element) => dom.window.getComputedStyle(element).display === "none",
		);
		return {
			x: 0,
			y: 0,
			width: hidden ? 0 : 120,
			height: hidden ? 0 : 36,
			top: 0,
			right: hidden ? 0 : 120,
			bottom: hidden ? 0 : 36,
			left: 0,
			toJSON: () => ({}),
		};
	};

	const page = {
		evaluate: async (callback: (arg: unknown) => unknown, arg: unknown) => {
			const globals = ["window", "document", "HTMLElement", "Element"] as const;
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
		},
		locator: (selector: string) => {
			const createLocator = (elements: Element[]) => ({
				count: async () => elements.length,
				first: () => createLocator(elements.slice(0, 1)),
				nth: (index: number) => createLocator(elements.slice(index, index + 1)),
				isVisible: async () => {
					const element = elements[0];
					if (!(element instanceof dom.window.HTMLElement)) return false;
					const rect = element.getBoundingClientRect();
					return rect.width > 1 && rect.height > 1;
				},
				isEnabled: async () => true,
				readInputValue: async () => elements[0]?.textContent ?? "",
				click: async () => {
					const element = elements[0];
					if (element instanceof dom.window.HTMLElement) element.click();
				},
			});
			return createLocator(
				Array.from(dom.window.document.querySelectorAll(selector)),
			);
		},
		waitForTimeout: async () => {},
		keyboard: { press: async () => {} },
	} as unknown as Page;
	return { page, close: () => dom.window.close() };
}

describe("official Web provider mode adapters", () => {
	it("publishes only valid provider search combinations", () => {
		expect(GEO_PROVIDER_MODE_CAPABILITIES.deepseek).toContain("web_search");
		expect(GEO_PROVIDER_MODE_CAPABILITIES.deepseek).not.toContain(
			"reasoning_web_search",
		);
		expect(getProviderModeLabel("hunyuan", "auto_search")).toBe(
			"Tool > Search",
		);
		expect(getProviderModeLabel("qwen", "reasoning_web_search")).toBe(
			"Thinking + Web Search",
		);
	});

	it("normalizes each provider default into the mode that can be verified", () => {
		expect(expectedOfficialWebMode("deepseek", "default")).toBe("fast");
		expect(expectedOfficialWebMode("doubao", "default")).toBe("fast");
		expect(expectedOfficialWebMode("hunyuan", "default")).toBe("default");
		expect(expectedOfficialWebMode("qwen", "default")).toBe("auto");
	});

	it.each([
		["deepseek", "default", "fast"],
		["deepseek", "fast", "fast"],
		["deepseek", "expert", "expert"],
		["deepseek", "reasoning", "reasoning"],
		["deepseek", "web_search", "web_search"],
		["doubao", "default", "fast"],
		["doubao", "fast", "fast"],
		["doubao", "expert", "expert"],
		["hunyuan", "default", "default"],
		["hunyuan", "reasoning", "reasoning"],
		["hunyuan", "auto_search", "auto_search"],
		["hunyuan", "reasoning_web_search", "reasoning_web_search"],
		["qwen", "default", "auto"],
		["qwen", "auto", "auto"],
		["qwen", "fast", "fast"],
		["qwen", "reasoning", "reasoning"],
		["qwen", "web_search", "web_search"],
		["qwen", "reasoning_web_search", "reasoning_web_search"],
		["qwen", "auto_search", "auto_search"],
	] as const)(
		"sets and verifies %s mode %s",
		async (provider, requested, expected) => {
			const fixture = await modeFixturePage(provider);
			try {
				await expect(
					applyOfficialWebMode({
						page: fixture.page,
						provider,
						mode: requested,
					}),
				).resolves.toBe(expected);
				if (provider === "qwen") {
					const currentMode = await fixture.page.evaluate(
						() =>
							document
								.querySelector(".qwen-select-thinking-label-text")
								?.textContent?.trim() ?? "",
						undefined,
					);
					expect(currentMode.length).toBeGreaterThan(0);
				} else {
					const controls = await readProviderModeControls(fixture.page);
					expect(controls.length).toBeGreaterThan(0);
				}
			} finally {
				fixture.close();
			}
		},
	);

	it("rejects the impossible DeepSeek DeepThink plus Search combination", async () => {
		const fixture = await modeFixturePage("deepseek");
		try {
			await expect(
				applyOfficialWebMode({
					page: fixture.page,
					provider: "deepseek",
					mode: "reasoning_web_search",
				}),
			).rejects.toThrow(/only available with Instant/i);
		} finally {
			fixture.close();
		}
	});

	it("never labels a Yuanbao sample as non-search while Search stays selected", async () => {
		const fixture = await modeFixturePage("hunyuan");
		try {
			await expect(
				applyOfficialWebMode({
					page: fixture.page,
					provider: "hunyuan",
					mode: "auto_search",
				}),
			).resolves.toBe("auto_search");
			await expect(
				applyOfficialWebMode({
					page: fixture.page,
					provider: "hunyuan",
					mode: "default",
				}),
			).rejects.toThrow(/selected in a non-search cohort/i);
		} finally {
			fixture.close();
		}
	});

	it("selects Qwen Web Search through + then More and verifies the composer marker", async () => {
		const fixture = await modeFixturePage("qwen");
		try {
			await expect(
				applyOfficialWebMode({
					page: fixture.page,
					provider: "qwen",
					mode: "web_search",
				}),
			).resolves.toBe("web_search");
			const selected = await fixture.page.evaluate(() => {
				const marker = document.querySelector<HTMLElement>(
					".mode-select-current-mode",
				);
				return {
					text: marker?.textContent?.trim(),
					visible: marker?.style.display !== "none",
					toolsEnabled:
						document
							.querySelector("[data-menu-id$='-tools'] [role='switch']")
							?.getAttribute("aria-checked") === "true",
				};
			}, undefined);
			expect(selected).toEqual({
				text: "Web Search",
				visible: true,
				toolsEnabled: true,
			});
		} finally {
			fixture.close();
		}
	});

	it("does not mistake Qwen's general Tools switch for Web Search", async () => {
		const fixture = await modeFixturePage("qwen");
		try {
			await expect(
				applyOfficialWebMode({
					page: fixture.page,
					provider: "qwen",
					mode: "fast",
				}),
			).resolves.toBe("fast");
			const toolsEnabled = await fixture.page.evaluate(() => {
				return (
					document
						.querySelector("[data-menu-id$='-tools'] [role='switch']")
						?.getAttribute("aria-checked") === "true"
				);
			}, undefined);
			expect(toolsEnabled).toBe(false);
			const selectedSearch = await fixture.page.evaluate(() => {
				const marker = document.querySelector<HTMLElement>(
					".mode-select-current-mode",
				);
				return marker?.style.display !== "none";
			}, undefined);
			expect(selectedSearch).toBe(false);
		} finally {
			fixture.close();
		}
	});

	it("accepts Qwen anonymous default mode when the Tools control is absent", async () => {
		const fixture = await modeFixturePage("qwen");
		try {
			await fixture.page.evaluate(() => {
				document.querySelector("[data-menu-id$='-tools']")?.remove();
			}, undefined);
			await expect(
				applyOfficialWebMode({
					page: fixture.page,
					provider: "qwen",
					mode: "default",
				}),
			).resolves.toBe("auto");
		} finally {
			fixture.close();
		}
	});

	it("still requires Qwen Tools for Web Search", async () => {
		const fixture = await modeFixturePage("qwen");
		try {
			await fixture.page.evaluate(() => {
				document.querySelector("[data-menu-id$='-tools']")?.remove();
			}, undefined);
			await expect(
				applyOfficialWebMode({
					page: fixture.page,
					provider: "qwen",
					mode: "web_search",
				}),
			).rejects.toThrow(/Tools switch is not available/i);
		} finally {
			fixture.close();
		}
	});
});
