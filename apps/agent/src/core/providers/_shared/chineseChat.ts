import type { Provider } from "@aloom/types";
import type { Page } from "playwright";
import { turndown } from "../../../lib/input/markdown/converter.js";
import {
	type RawSource,
	buildSources,
	extractVisibleUrlCandidates,
} from "./sourceUtils.js";

export { extractVisibleUrlCandidates } from "./sourceUtils.js";

function normalizeMarkdown(markdown: string): string {
	return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractLatestChineseChatResponse(
	page: Page,
	provider: Provider,
	selectors: string[],
): Promise<string> {
	const html = await page.evaluate(
		({ provider: currentProvider, responseSelectors }) => {
			function isVisible(element: Element | null): element is HTMLElement {
				if (!(element instanceof HTMLElement)) return false;
				const style = window.getComputedStyle(element);
				const rect = element.getBoundingClientRect();
				return (
					rect.width > 1 &&
					rect.height > 1 &&
					style.visibility !== "hidden" &&
					style.display !== "none" &&
					style.opacity !== "0"
				);
			}

			function cleanResponseElement(element: HTMLElement): string {
				const clone = element.cloneNode(true) as HTMLElement;
				for (const removable of clone.querySelectorAll(
					[
						"button",
						"[role='button']",
						"svg",
						"script",
						"style",
						"noscript",
						"iframe",
						"input",
						"textarea",
						"sup",
						"[aria-live]",
						"[aria-hidden='true']",
						"[class*='think' i]",
						"[class*='reason' i]",
						"[class*='toolbar' i]",
						"[class*='actions' i]",
						"[class*='footer' i]",
						"[class*='g-send-msg' i]",
						"[class*='send-msg' i]",
						"[class*='user-message' i]",
						"[class*='suggest' i]",
						"[class*='recommend' i]",
						"[class*='follow-up' i]",
					].join(", "),
				)) {
					removable.remove();
				}
				return clone.innerHTML.trim();
			}

			function ancestrySignature(element: HTMLElement): string {
				const parts: string[] = [];
				let current: HTMLElement | null = element;
				for (let depth = 0; current && depth < 5; depth++) {
					parts.push(
						[
							current.tagName,
							current.id,
							current.className,
							current.getAttribute("role"),
							current.getAttribute("data-testid"),
							current.getAttribute("data-message-author-role"),
							current.getAttribute("data-conv-speaker"),
						]
							.filter(Boolean)
							.join(" "),
					);
					current = current.parentElement;
				}
				return parts.join(" ").toLowerCase();
			}

			function isUserMessage(element: HTMLElement): boolean {
				const signature = ancestrySignature(element);
				return /qwen-chat-message-user|chat-user-message|user-message|send-msg|send_msg|g-send-msg|message-send|human-message|list__item--human|\bhuman\b/.test(
					signature,
				);
			}

			function isNonResponseSurface(element: HTMLElement): boolean {
				const signature = ancestrySignature(element);
				if (element.closest("form, header, nav, footer, aside")) return true;
				return /message-input|input-container|sidebar|history|toolbar|actions|login|no-auth|sign-in|wechat|captcha|verify|modal|popover/.test(
					signature,
				);
			}

			function providerPreferredSelectors(providerName: string): string[] {
				if (providerName === "qwen") {
					return [
						".qwen-chat-message-assistant .response-message-content.phase-answer",
						".qwen-chat-message-assistant .custom-qwen-markdown",
						".qwen-chat-message-assistant .qwen-markdown",
						".qwen-chat-message-assistant .chat-response-message",
						".qwen-chat-message-assistant",
					];
				}

				if (providerName === "doubao") {
					return [
						'[data-message-id]:not([class*="justify-end"]) .md-box-root',
						".md-box-root",
						'[class*="message-list" i] [class*="markdown" i]',
						'[class*="message-list" i] [class*="answer" i]',
						'[class*="message-list" i] [class*="assistant" i]',
						'[class*="message-list" i] [class*="bot" i]',
						'[class*="message-list" i] [class*="content" i]',
					];
				}

				if (providerName === "hunyuan") {
					return [
						"#chat-content .hyc-common-markdown",
						'#chat-content [class*="markdown" i]',
						'#chat-content [class*="answer" i]',
						'#chat-content [class*="assistant" i]',
						".hyc-common-markdown",
					];
				}

				return [];
			}

			function candidateScore(element: HTMLElement, priority: number): number {
				const text = (element.innerText || element.textContent || "")
					.replace(/\s+/g, " ")
					.trim();
				if (text.length < 20) return -1;
				if (isUserMessage(element) || isNonResponseSurface(element)) return -1;

				const signature = ancestrySignature(element);
				const rect = element.getBoundingClientRect();
				let score = priority + Math.min(text.length, 2000) + rect.y / 10;
				if (
					/assistant|response-message|phase-answer|answer|bot|agent/.test(
						signature,
					)
				) {
					score += 2500;
				}
				if (/markdown|hyc-common-markdown|qwen-markdown/.test(signature)) {
					score += 1200;
				}
				if (element.matches("article, [role='article']")) {
					score += 500;
				}
				if (text.length > 8000) {
					score -= 2500;
				}
				return score;
			}

			type Candidate = { element: HTMLElement; score: number };
			const candidates: Candidate[] = [];
			const seen = new Set<HTMLElement>();
			function collect(selector: string, priority: number): void {
				try {
					for (const element of document.querySelectorAll(selector)) {
						if (!(element instanceof HTMLElement) || seen.has(element))
							continue;
						seen.add(element);
						if (!isVisible(element)) continue;
						const score = candidateScore(element, priority);
						if (score >= 0) candidates.push({ element, score });
					}
				} catch {
					// Ignore provider DOM selector drift. Later selectors/fallbacks may work.
				}
			}

			providerPreferredSelectors(currentProvider).forEach((selector, index) => {
				collect(selector, 20_000 - index * 500);
			});
			for (const selector of responseSelectors) collect(selector, 5_000);

			if (candidates.length === 0) {
				for (const selector of [
					"article",
					"[role='article']",
					"[class*='answer' i]",
					"[class*='assistant' i]",
					"[class*='markdown' i]",
					"[class*='response' i]",
				]) {
					collect(selector, 1_000);
				}
			}

			const response =
				candidates.sort((left, right) => left.score - right.score).at(-1)
					?.element ?? null;
			return response ? cleanResponseElement(response) : "";
		},
		{ provider, responseSelectors: selectors },
	);

	return html ? normalizeMarkdown(turndown.turndown(html)) : "";
}

export async function extractSourcesFromChineseChat(
	page: Page,
	provider: Provider,
	selectors: string[],
): Promise<ReturnType<typeof buildSources>> {
	// Search-backed answers often keep their full source list behind a compact
	// "searched N pages" control. Reveal that surface before reading the DOM.
	try {
		const revealedTextControl = await page.evaluate(() => {
			const pattern =
				/搜索\s*\d+.*(?:参考|来源)\s*\d+|参考来源|信息来源|查看来源|sources?\s*\d*|citations?\s*\d*|references?\s*\d*/i;
			const candidates = Array.from(
				document.querySelectorAll(
					'button, [role="button"], [class*="cursor-pointer"], [data-plugin-identifier*="search"]',
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
		const revealSelectors: Partial<Record<Provider, string[]>> = {
			doubao: [
				'[data-plugin-identifier*="search_query_result_block"]',
				'[data-plugin-identifier*="search_result"]',
			],
			qwen: [
				'.qwen-chat-message-assistant [class*="search" i][class*="source" i]',
				'.qwen-chat-message-assistant [class*="reference" i]',
			],
			hunyuan: [
				'[data-conv-speaker="ai"] [class*="deepsearch" i] [class*="source" i]',
				'[data-conv-speaker="ai"] [class*="reference" i]',
			],
		};
		for (const selector of revealSelectors[provider] ?? []) {
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
		// The answer body may still expose links even when a provider changes its
		// source-panel control. Extraction below remains useful and deterministic.
	}

	const extraction = await page.evaluate(
		({ provider: currentProvider, responseSelectors }) => {
			function isVisible(element: Element | null): element is HTMLElement {
				if (!(element instanceof HTMLElement)) return false;
				const style = window.getComputedStyle(element);
				const rect = element.getBoundingClientRect();
				return (
					rect.width > 1 &&
					rect.height > 1 &&
					style.visibility !== "hidden" &&
					style.display !== "none" &&
					style.opacity !== "0"
				);
			}

			function ancestrySignature(element: HTMLElement): string {
				const parts: string[] = [];
				let current: HTMLElement | null = element;
				for (let depth = 0; current && depth < 5; depth++) {
					parts.push(
						`${current.id || ""} ${current.className || ""} ${current.getAttribute("data-conv-speaker") || ""}`,
					);
					current = current.parentElement;
				}
				return parts.join(" ").toLowerCase();
			}

			function providerPreferredSelectors(providerName: string): string[] {
				if (providerName === "qwen") {
					return [
						".qwen-chat-message-assistant .response-message-content.phase-answer",
						".qwen-chat-message-assistant .custom-qwen-markdown",
						".qwen-chat-message-assistant .qwen-markdown",
						".qwen-chat-message-assistant .chat-response-message",
					];
				}
				if (providerName === "doubao") {
					return [
						'[data-message-id]:not([class*="justify-end"]) .md-box-root',
						".md-box-root",
						'[class*="message-list" i] [class*="markdown" i]',
						'[class*="message-list" i] [class*="answer" i]',
						'[class*="message-list" i] [class*="assistant" i]',
					];
				}
				if (providerName === "hunyuan") {
					return [
						"#chat-content .hyc-common-markdown",
						'#chat-content [class*="markdown" i]',
						'#chat-content [class*="answer" i]',
						'#chat-content [class*="assistant" i]',
					];
				}
				return [];
			}

			function isBadCandidate(element: HTMLElement): boolean {
				const signature = ancestrySignature(element);
				if (element.closest("form, header, nav, footer, aside")) return true;
				return /qwen-chat-message-user|chat-user-message|user-message|send-msg|message-input|list__item--human|\bhuman\b|sidebar|history|toolbar|actions|login|no-auth|sign-in|wechat|captcha|verify|modal|popover/.test(
					signature,
				);
			}

			type Candidate = { element: HTMLElement; score: number };
			const candidates: Candidate[] = [];
			const seen = new Set<HTMLElement>();
			function collect(selector: string, priority: number): void {
				try {
					for (const element of document.querySelectorAll(selector)) {
						if (!(element instanceof HTMLElement) || seen.has(element))
							continue;
						seen.add(element);
						if (
							isVisible(element) &&
							(element.textContent || "").trim().length > 20 &&
							!isBadCandidate(element)
						) {
							const rect = element.getBoundingClientRect();
							candidates.push({ element, score: priority + rect.y / 10 });
						}
					}
				} catch {
					// Ignore selector drift.
				}
			}

			providerPreferredSelectors(currentProvider).forEach((selector, index) => {
				collect(selector, 20_000 - index * 500);
			});
			for (const selector of responseSelectors) collect(selector, 5_000);

			const response =
				candidates.sort((left, right) => left.score - right.score).at(-1)
					?.element ?? null;
			if (!response) return { rawSources: [], visibleText: "" };

			function assistantRoot(element: HTMLElement): HTMLElement {
				const rootSelectors: Partial<Record<string, string>> = {
					qwen: ".qwen-chat-message-assistant",
					doubao: '[data-message-id]:not([class*="justify-end"])',
					hunyuan: '[data-conv-speaker="ai"]',
				};
				const selector = rootSelectors[currentProvider];
				return (
					((selector ? element.closest(selector) : null) as HTMLElement) ||
					element
				);
			}

			function isSearchSurface(element: Element): boolean {
				let current: Element | null = element;
				for (let depth = 0; current && depth < 7; depth += 1) {
					const signature = [
						current.id,
						current.className,
						current.getAttribute("role"),
						current.getAttribute("aria-label"),
						current.getAttribute("data-testid"),
						current.getAttribute("data-plugin-identifier"),
					]
						.filter(Boolean)
						.join(" ")
						.toLowerCase();
					if (
						/citation|reference|source-list|source-card|search-result|search_result|web-search|web_search|deepsearch/.test(
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
					for (const key of [
						"url",
						"target",
						"target_url",
						"redirect",
						"redirect_url",
					]) {
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
						'[class*="citation" i], [class*="reference" i], [class*="source-list" i], [class*="source-card" i], [class*="search-result" i], [class*="search_result" i], [data-plugin-identifier*="search"]',
					),
				);
			}

			const rawSources: Array<{
				rawHref: string;
				title: string;
				citedText: string;
				sourceKind: "answer_link" | "search_source";
			}> = [];
			const seenElements = new Set<Element>();
			function collectFrom(root: ParentNode, forceSearchSource = false): void {
				const linkSelector = "a[href], [data-url], [data-href]";
				const elements = [
					...(root instanceof Element && root.matches(linkSelector)
						? [root]
						: []),
					...root.querySelectorAll(linkSelector),
				];
				for (const element of elements) {
					if (seenElements.has(element)) continue;
					seenElements.add(element);
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

			collectFrom(response);
			const root = assistantRoot(response);
			for (const surface of root.querySelectorAll(
				'[class*="citation" i], [class*="reference" i], [class*="source" i], [class*="search-result" i], [class*="search_result" i], [data-plugin-identifier*="search"]',
			)) {
				collectFrom(surface, true);
			}
			for (const surface of document.querySelectorAll(
				'[role="dialog"], [role="listbox"], [class*="popover" i], [class*="drawer" i]',
			)) {
				if (isVisible(surface) && isSearchSurface(surface)) {
					collectFrom(surface, true);
				}
			}
			return {
				rawSources,
				visibleText: (response.innerText || response.textContent || "").trim(),
			};
		},
		{ provider, responseSelectors: selectors },
	);
	const rawSources = [
		...((extraction.rawSources ?? []) as RawSource[]),
		...extractVisibleUrlCandidates(extraction.visibleText ?? "", "answer_link"),
	];

	return buildSources(rawSources, { provider });
}
