import { ExternalServiceError, toErrorMessage } from "@anspectra/errors";
import type { Provider, SearchSourceCoverage, Source } from "@anspectra/types";
import { logger } from "@anspectra/utils";
import type { Page } from "playwright";
import {
	buildSources,
	extractVisibleUrlCandidates,
} from "../../lib/extraction/sourceUtils.js";
import { PROVIDER_CONFIGS } from "../providers/index.js";

function shouldRetrySourceExtraction(err: unknown): boolean {
	const message = toErrorMessage(err);

	return (
		/execution context was destroyed/i.test(message) ||
		/target page, context or browser has been closed/i.test(message) ||
		/most likely because of a navigation/i.test(message) ||
		/protocol error/i.test(message)
	);
}

export async function checkAndExtractSources(
	page: Page,
	provider: Provider,
	responseText = "",
): Promise<{
	sources: Source[];
	reportedSearchSourceCount: number | null;
	searchSourceCoverage: SearchSourceCoverage;
}> {
	let sources: Source[] = [];

	try {
		sources = await extractSourcesFromPanel(page, provider);
	} catch (err) {
		if (shouldRetrySourceExtraction(err)) {
			throw new ExternalServiceError(
				provider,
				`Source extraction failed due to navigation/context loss — retrying prompt. ${toErrorMessage(err)}`,
			);
		}

		logger.warn("source extraction failed, continuing:", err);
		sources = [];
	}

	const responseSources = buildSources(
		extractVisibleUrlCandidates(responseText),
		{
			provider,
		},
	);
	const seenSources = new Set(
		sources.map(
			(source) => `${source.source_kind ?? "legacy_unknown"}:${source.url}`,
		),
	);
	const combined = [
		...sources,
		...responseSources.filter((source) => {
			const key = `${source.source_kind ?? "answer_link"}:${source.url}`;
			if (seenSources.has(key)) return false;
			seenSources.add(key);
			return true;
		}),
	];
	const reportedSearchSourceCount = await readReportedSearchSourceCount(
		page,
		provider,
	);
	const extractedSearchSourceCount = new Set(
		combined
			.filter((source) => source.source_kind === "search_source")
			.map((source) => source.url),
	).size;
	const searchSourceCoverage: SearchSourceCoverage = reportedSearchSourceCount
		? extractedSearchSourceCount >= reportedSearchSourceCount
			? "complete"
			: "partial"
		: extractedSearchSourceCount > 0
			? "count_not_exposed"
			: "not_exposed";
	return { sources: combined, reportedSearchSourceCount, searchSourceCoverage };
}

export function parseReportedSearchSourceCount(text: string): number | null {
	const values: number[] = [];
	const patterns = [
		/搜索\s*\d+\s*个关键词[，,\s]*(?:并)?参考\s*(\d+)\s*篇资料/giu,
		/(?:参考|检索|搜索|阅读|浏览)(?:了)?\s*(\d+)\s*(?:篇资料|个网页|个页面|条来源|条结果)/giu,
		/(\d+)\s*(?:sources?|citations?|references?|web pages?)/giu,
	];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			const value = Number(match[1]);
			if (Number.isInteger(value) && value > 0 && value <= 5_000) {
				values.push(value);
			}
		}
	}
	return values.length ? Math.max(...values) : null;
}

async function readReportedSearchSourceCount(
	page: Page,
	provider: Provider,
): Promise<number | null> {
	const relevantText = await page
		.evaluate((currentProvider) => {
			function isVisible(element: Element | null): element is HTMLElement {
				if (!(element instanceof HTMLElement)) return false;
				const style = window.getComputedStyle(element);
				const rect = element.getBoundingClientRect();
				return (
					rect.width > 1 &&
					rect.height > 1 &&
					style.display !== "none" &&
					style.visibility !== "hidden"
				);
			}

			const rootSelectors: Partial<Record<Provider, string[]>> = {
				deepseek: [".assistant", ".ds-message--assistant", "article"],
				doubao: ['[data-message-id]:not([class*="justify-end"])'],
				hunyuan: ['[data-conv-speaker="ai"]', "#chat-content"],
				qwen: [".qwen-chat-message-assistant"],
			};
			const roots = (rootSelectors[currentProvider] ?? [])
				.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
				.filter(isVisible);
			const latestRoot = roots.at(-1);
			const pieces = latestRoot
				? [latestRoot.innerText || latestRoot.textContent || ""]
				: [];
			const countPattern =
				/搜索\s*\d+.*(?:参考|来源)\s*\d+|(?:参考|检索|搜索|阅读|浏览)(?:了)?\s*\d+\s*(?:篇资料|个网页|个页面|条来源|条结果)|\d+\s*(?:sources?|citations?|references?|web pages?)/i;
			for (const element of document.querySelectorAll(
				'button, [role="button"], [role="dialog"], [class*="popover" i], [class*="drawer" i], [class*="citation" i], [class*="reference" i], [class*="source" i]',
			)) {
				if (!isVisible(element)) continue;
				const text = (element.textContent || "").replace(/\s+/g, " ").trim();
				if (text && text.length <= 2_000 && countPattern.test(text)) {
					pieces.push(text);
				}
			}
			return pieces.join("\n");
		}, provider)
		.catch(() => "");
	return parseReportedSearchSourceCount(relevantText);
}

async function extractSourcesFromPanel(
	page: Page,
	provider: Provider,
): Promise<Source[]> {
	const sources = await PROVIDER_CONFIGS[provider].extractSources(page);

	if (sources.length > 0) {
		logger.debug(`extracted ${sources.length} sources`);
	}

	return sources;
}
