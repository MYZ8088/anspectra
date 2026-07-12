import type { BrowserContext as RawBrowserContext } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { PlaywrightBrowserContextCompat } from "./playwrightCompat.js";

describe("PlaywrightBrowserContextCompat", () => {
	it("leases the persistent context's initial page instead of opening an orphan blank tab", async () => {
		const initialPage = {
			url: () => "about:blank",
			isClosed: () => false,
			mouse: {},
			keyboard: {},
		} as never;
		const openAnotherPage = vi.fn();
		const rawContext = {
			pages: () => [initialPage],
			newPage: openAnotherPage,
			browser: () => null,
		} as unknown as RawBrowserContext;
		const context = new PlaywrightBrowserContextCompat(rawContext);

		const leased = await context.newPage();

		expect(leased.url()).toBe("about:blank");
		expect(openAnotherPage).not.toHaveBeenCalled();
	});

	it("never leases the same browser-created blank page twice", async () => {
		const blankPage = {
			url: () => "about:blank",
			isClosed: () => false,
			mouse: {},
			keyboard: {},
		} as never;
		const secondPage = {
			url: () => "about:blank",
			isClosed: () => false,
			mouse: {},
			keyboard: {},
		} as never;
		const openAnotherPage = vi.fn().mockResolvedValue(secondPage);
		const rawContext = {
			pages: () => [
				blankPage,
				{ url: () => "https://closed.test", isClosed: () => true },
			],
			newPage: openAnotherPage,
			browser: () => null,
		} as unknown as RawBrowserContext;
		const context = new PlaywrightBrowserContextCompat(rawContext);

		await context.newPage();
		await context.newPage();

		expect(openAnotherPage).toHaveBeenCalledTimes(1);
	});
});
