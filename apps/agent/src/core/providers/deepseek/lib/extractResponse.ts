import type { Page } from "playwright";
import { turndown } from "../../../../lib/input/markdown/converter.js";

export async function extractResponseFromDeepseek(page: Page): Promise<string> {
	const html = await page.evaluate(() => {
		function isVisible(element: Element | null): element is HTMLElement {
			if (!(element instanceof HTMLElement)) return false;
			const style = window.getComputedStyle(element);
			return (
				element.offsetParent !== null &&
				style.visibility !== "hidden" &&
				style.display !== "none"
			);
		}

		const response =
			Array.from(document.querySelectorAll(".ds-markdown"))
				.filter(
					(element): element is HTMLElement =>
						isVisible(element) &&
						(element.innerText || "").trim().length > 0 &&
						!element.closest(".ds-think-content"),
				)
				.pop() ?? null;

		if (!response) return "";

		const clone = response.cloneNode(true) as HTMLElement;
		for (const element of clone.querySelectorAll(
			"button, [role='button'], svg, script, style, noscript, iframe, sup, [aria-live], [aria-hidden='true']",
		)) {
			element.remove();
		}

		return clone.innerHTML.trim();
	}, undefined);

	if (!html) return "";

	return turndown
		.turndown(html)
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
