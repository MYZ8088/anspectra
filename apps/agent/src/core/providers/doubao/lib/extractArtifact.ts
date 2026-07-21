import type { Frame, Page } from "playwright";
import { turndown } from "../../../../lib/input/markdown/converter.js";
import type { RawSource } from "../../_shared/sourceUtils.js";

const ARTIFACT_CARD_SELECTOR = [
	'[data-message-id]:not([class*="justify-end"])',
	'[data-plugin-identifier*="artifact_block"]',
	'[data-status="finished"]',
	'[data-feishu-office-current-doc-old-card="true"]',
].join(" ");

const ARTIFACT_ROOT_SELECTOR = ".page-block.root-block";
const ARTIFACT_SCROLLER_SELECTOR = ".bear-web-x-container";
const ARTIFACT_FRAME_PATTERN =
	/\/partner\/ccm-docx\/docx\/[^/?]+\?[^#]*\bdocId=/i;

type ArtifactBlock = {
	id: string;
	className: string;
	html: string;
	text: string;
};

export type DoubaoArtifactSnapshot = {
	conversationUrl: string;
	markdown: string;
	rawSources: RawSource[];
};

const snapshots = new WeakMap<Page, DoubaoArtifactSnapshot>();

function normalizeText(value: string): string {
	return value
		.replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeMarkdown(value: string): string {
	return value
		.replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function renderBlock(block: ArtifactBlock): string {
	const converted =
		normalizeMarkdown(turndown.turndown(block.html)) || block.text;
	const heading = block.className.match(/docx-heading([1-6])-block/i)?.[1];
	if (heading) return `${"#".repeat(Number(heading))} ${converted}`;
	if (/docx-(?:bullet|unordered)-block/i.test(block.className)) {
		return `- ${converted.replace(/^[-*+]\s+/, "")}`;
	}
	if (/docx-(?:ordered|number)-block/i.test(block.className)) {
		return `1. ${converted.replace(/^\d+[.)]\s+/, "")}`;
	}
	return converted;
}

function findLoadedArtifactFrame(page: Page): Frame | null {
	if (typeof page.frames !== "function") return null;
	return (
		page.frames().find((frame) => ARTIFACT_FRAME_PATTERN.test(frame.url())) ??
		null
	);
}

async function openLatestArtifact(page: Page): Promise<Frame | null> {
	let frame = findLoadedArtifactFrame(page);
	if (frame) return frame;

	try {
		if (typeof page.locator !== "function") return null;
		const cards = page.locator(ARTIFACT_CARD_SELECTOR);
		if ((await cards.count()) === 0) return null;
		const card = cards.last();
		if (!(await card.isVisible().catch(() => false))) return null;
		await card.scrollIntoViewIfNeeded().catch(() => undefined);
		await card.click({ timeout: 8_000 });
	} catch {
		return null;
	}

	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		frame = findLoadedArtifactFrame(page);
		if (frame) {
			const ready = await frame
				.evaluate(
					(selector) => Boolean(document.querySelector(selector)),
					ARTIFACT_ROOT_SELECTOR,
				)
				.catch(() => false);
			if (ready) return frame;
		}
		await page.waitForTimeout(250);
	}
	return null;
}

async function readArtifact(frame: Frame): Promise<{
	markdown: string;
	rawSources: RawSource[];
}> {
	const hasScroller = await frame.evaluate(
		(selector) => Boolean(document.querySelector(selector)),
		ARTIFACT_SCROLLER_SELECTOR,
	);
	if (!hasScroller) return { markdown: "", rawSources: [] };

	const blocks = new Map<string, ArtifactBlock>();
	const sources = new Map<string, RawSource>();
	let scrollTop = 0;
	await frame.evaluate(
		(selector) => {
			const element = document.querySelector(selector);
			if (element instanceof HTMLElement) element.scrollTop = 0;
		},
		ARTIFACT_SCROLLER_SELECTOR,
	);
	// The document canvas is virtualized. Give it one full render cycle after
	// resetting a previously viewed document from its persisted scroll position.
	await frame.waitForTimeout(1_000);

	for (let iteration = 0; iteration < 24; iteration += 1) {
		await frame.evaluate(
			({ selector, top }) => {
				const element = document.querySelector(selector);
				if (element instanceof HTMLElement) element.scrollTop = top;
			},
			{ selector: ARTIFACT_SCROLLER_SELECTOR, top: scrollTop },
		);
		await frame.waitForTimeout(iteration === 0 ? 500 : 350);

		const snapshot = await frame.evaluate(
			({ rootSelector, scrollerSelector }) => {
				const normalize = (value: string): string =>
					value
						.replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
						.replace(/\s+/g, " ")
						.trim();
				const root = document.querySelector(rootSelector);
				const scroller = document.querySelector(scrollerSelector);
				if (
					!(root instanceof HTMLElement) ||
					!(scroller instanceof HTMLElement)
				) {
					return {
						blocks: [],
						sources: [],
						dimensions: { scrollTop: 0, scrollHeight: 0, clientHeight: 0 },
					};
				}

				const extractedBlocks = Array.from(
					root.querySelectorAll(
						'.zone-container.text-editor[contenteditable="true"]',
					),
				).flatMap((node, index) => {
					if (!(node instanceof HTMLElement)) return [];
					const text = normalize(node.innerText || node.textContent || "");
					if (!text) return [];
					const parent = node.closest(".block") as HTMLElement | null;
					const className = parent?.className || node.className;
					const stableId =
						parent?.getAttribute("data-block-id") ||
						parent?.id ||
						node.getAttribute("data-block-id") ||
						`${className}:${text}:${index}`;
					return [
						{
							id: stableId,
							className,
							html: node.innerHTML,
							text,
						},
					];
				});

				const extractedSources = Array.from(
					root.querySelectorAll("a[href]"),
				).flatMap((node) => {
					if (!(node instanceof HTMLAnchorElement)) return [];
					const rawHref = node.href;
					if (!/^https?:\/\//i.test(rawHref)) return [];
					return [
						{
							rawHref,
							title:
								normalize(node.innerText || node.textContent || "") || rawHref,
							citedText: "",
							sourceKind: "answer_link" as const,
						},
					];
				});

				return {
					blocks: extractedBlocks,
					sources: extractedSources,
					dimensions: {
						scrollTop: scroller.scrollTop,
						scrollHeight: scroller.scrollHeight,
						clientHeight: scroller.clientHeight,
					},
				};
			},
			{
				rootSelector: ARTIFACT_ROOT_SELECTOR,
				scrollerSelector: ARTIFACT_SCROLLER_SELECTOR,
			},
		);

		for (const block of snapshot.blocks) {
			const id = `${block.id}:${block.className}:${normalizeText(block.text)}`;
			if (!blocks.has(id)) {
				blocks.set(id, block);
			}
		}
		for (const source of snapshot.sources) {
			sources.set(`${source.sourceKind}:${source.rawHref}`, source);
		}

		const dimensions = snapshot.dimensions;
		const maxScrollTop = Math.max(
			0,
			dimensions.scrollHeight - dimensions.clientHeight,
		);
		if (dimensions.scrollTop >= maxScrollTop - 2) break;
		const next = Math.min(
			maxScrollTop,
			dimensions.scrollTop + Math.max(250, dimensions.clientHeight * 0.65),
		);
		if (next <= dimensions.scrollTop) break;
		scrollTop = next;
	}

	return {
		markdown: normalizeMarkdown(
			Array.from(blocks.values()).map(renderBlock).filter(Boolean).join("\n\n"),
		),
		rawSources: Array.from(sources.values()),
	};
}

export async function extractLatestDoubaoArtifact(
	page: Page,
): Promise<DoubaoArtifactSnapshot | null> {
	const conversationUrl = page.url();
	const cached = snapshots.get(page);
	if (cached?.conversationUrl === conversationUrl) return cached;

	const frame = await openLatestArtifact(page);
	if (!frame) return null;
	const result = await readArtifact(frame);
	if (normalizeText(result.markdown).length < 80) return null;

	const snapshot = { conversationUrl, ...result };
	snapshots.set(page, snapshot);
	return snapshot;
}
