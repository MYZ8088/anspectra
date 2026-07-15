import type { Page } from "playwright";
import {
	type RawSource,
	buildSources,
	extractVisibleUrlCandidates,
} from "../../_shared/sourceUtils.js";

export async function extractSourcesFromDeepseek(
	page: Page,
): Promise<ReturnType<typeof buildSources>> {
	try {
		const revealedTextControl = await page.evaluate(() => {
			const pattern =
				/已?搜索\s*\d+|参考来源|信息来源|查看来源|sources?\s*\d*|citations?\s*\d*/i;
			const candidates = Array.from(
				document.querySelectorAll(
					'button, [role="button"], [class*="cursor-pointer"], [class*="reference" i], [class*="source" i]',
				),
			).filter((element) => {
				const text = (element.textContent || "").replace(/\s+/g, " ").trim();
				if (!text || text.length > 240 || !pattern.test(text)) return false;
				const rect = element.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				return (
					rect.width > 1 &&
					rect.height > 1 &&
					style.display !== "none" &&
					style.visibility !== "hidden"
				);
			});
			const candidate = candidates.at(-1) as HTMLElement | undefined;
			candidate?.click();
			return Boolean(candidate);
		}, undefined);
		if (revealedTextControl) {
			await page.waitForTimeout(350);
		}
		for (const selector of [
			'.assistant [class*="reference" i]',
			'.assistant [class*="source" i]',
			'.assistant [class*="search" i][role="button"]',
		]) {
			const candidates = page.locator(selector);
			for (let index = (await candidates.count()) - 1; index >= 0; index -= 1) {
				const candidate = candidates.nth(index);
				if (!(await candidate.isVisible().catch(() => false))) continue;
				await candidate.click({ timeout: 1_500 }).catch(() => undefined);
				await page.waitForTimeout(350);
				break;
			}
		}
	} catch {
		// Continue with answer-body extraction when the source control drifts.
	}

	const extraction = await page.evaluate(() => {
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

		if (!response) return { rawSources: [], visibleText: "" };

		function isSearchSurface(element: Element): boolean {
			let current: Element | null = element;
			for (let depth = 0; current && depth < 7; depth += 1) {
				const signature = [
					current.id,
					current.className,
					current.getAttribute("role"),
					current.getAttribute("aria-label"),
					current.getAttribute("data-testid"),
				]
					.filter(Boolean)
					.join(" ")
					.toLowerCase();
				if (
					/citation|reference|source-list|source-card|search-result|web-search/.test(
						signature,
					)
				) {
					return true;
				}
				current = current.parentElement;
			}
			return false;
		}

		function rawHrefFrom(element: Element): string {
			const candidate =
				element.getAttribute("data-url") ||
				element.getAttribute("data-href") ||
				element.getAttribute("href") ||
				"";
			try {
				let rawHref = new URL(candidate, window.location.href).href;
				const redirect = new URL(rawHref);
				for (const key of ["url", "target", "target_url", "redirect"]) {
					const nested = redirect.searchParams.get(key);
					if (nested && /^https?:\/\//i.test(nested)) {
						rawHref = nested;
						break;
					}
				}
				return rawHref;
			} catch {
				return "";
			}
		}

		function isExplicitSourceElement(element: Element): boolean {
			return Boolean(
				element.closest(
					'[class*="citation" i], [class*="reference" i], [class*="source-list" i], [class*="source-card" i], [class*="search-result" i]',
				),
			);
		}

		const rawSources: Array<{
			rawHref: string;
			title: string;
			citedText: string;
			sourceKind: "answer_link" | "search_source";
		}> = [];
		const seen = new Set<Element>();
		function collect(root: ParentNode, forceSearchSource = false): void {
			const linkSelector = "a[href], [data-url], [data-href]";
			const elements = [
				...(root instanceof Element && root.matches(linkSelector)
					? [root]
					: []),
				...root.querySelectorAll(linkSelector),
			];
			for (const element of elements) {
				if (seen.has(element)) continue;
				seen.add(element);
				const rawHref = rawHrefFrom(element);
				if (!rawHref) continue;
				const text = (element.textContent || "").replace(/\s+/g, " ").trim();
				const label =
					element.getAttribute("aria-label") ||
					element.getAttribute("title") ||
					"";
				rawSources.push({
					rawHref,
					title: text || label || rawHref,
					citedText: "",
					sourceKind:
						forceSearchSource || isExplicitSourceElement(element)
							? "search_source"
							: "answer_link",
				});
			}
		}

		collect(response);
		const assistantRoot = response.closest(".assistant, article") ?? response;
		for (const surface of assistantRoot.querySelectorAll(
			'[class*="citation" i], [class*="reference" i], [class*="source" i], [class*="search-result" i]',
		)) {
			collect(surface, true);
		}
		for (const surface of document.querySelectorAll(
			'[role="dialog"], [class*="popover" i], [class*="drawer" i]',
		)) {
			if (isVisible(surface) && isSearchSurface(surface))
				collect(surface, true);
		}
		return {
			rawSources,
			visibleText: (response.innerText || response.textContent || "").trim(),
		};
	}, undefined);
	const rawSources = [
		...((extraction.rawSources ?? []) as RawSource[]),
		...extractVisibleUrlCandidates(extraction.visibleText ?? "", "answer_link"),
	];

	return buildSources(rawSources, { provider: "deepseek" });
}
