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

			const rawSources = Array.from(response.querySelectorAll("a[href]"))
				.map((anchor) => {
					const link = anchor as HTMLAnchorElement;
					const text = (link.textContent || "").replace(/\s+/g, " ").trim();
					const label = link.getAttribute("aria-label") || link.title || "";
					const candidate =
						link.getAttribute("data-url") ||
						link.getAttribute("data-href") ||
						link.getAttribute("href") ||
						"";
					let rawHref = "";
					try {
						rawHref = new URL(candidate, window.location.href).href;
						const redirect = new URL(rawHref);
						for (const key of ["url", "target", "target_url", "redirect"]) {
							const nested = redirect.searchParams.get(key);
							if (nested && /^https?:\/\//i.test(nested)) {
								rawHref = nested;
								break;
							}
						}
					} catch {
						rawHref = "";
					}
					return {
						rawHref,
						title: text || label || rawHref,
						citedText: "",
					};
				})
				.filter((source) => source.rawHref);
			return {
				rawSources,
				visibleText: (response.innerText || response.textContent || "").trim(),
			};
		},
		{ provider, responseSelectors: selectors },
	);
	const rawSources = [
		...((extraction.rawSources ?? []) as RawSource[]),
		...extractVisibleUrlCandidates(extraction.visibleText ?? ""),
	];

	return buildSources(rawSources, { provider });
}
