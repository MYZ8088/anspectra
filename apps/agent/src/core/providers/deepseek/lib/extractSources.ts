import type { Page } from "playwright";
import { type RawSource, buildSources } from "../../_shared/sourceUtils.js";

export async function extractSourcesFromDeepseek(
	page: Page,
): Promise<ReturnType<typeof buildSources>> {
	const rawSources = (await page.evaluate(() => {
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
						(element.innerText || "").trim().length > 40 &&
						!element.closest(".ds-think-content"),
				)
				.pop() ?? null;

		if (!response) return [];

		return Array.from(response.querySelectorAll('a[href^="http"]'))
			.map((anchor) => {
				const link = anchor as HTMLAnchorElement;
				const text = (link.textContent || "").replace(/\s+/g, " ").trim();
				const label = link.getAttribute("aria-label") || link.title || "";
				return {
					rawHref: link.href,
					title: text || label || link.href,
					citedText: "",
				};
			})
			.filter((source) => source.rawHref);
	}, undefined)) as RawSource[];

	return buildSources(rawSources, { provider: "deepseek" });
}
