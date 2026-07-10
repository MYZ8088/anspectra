import { createHash, randomUUID } from "node:crypto";
import { ValidationError } from "@answerloom/errors";
import type { Provider } from "@answerloom/types";
import {
	PROVIDER_EDITOR_SELECTORS,
	PROVIDER_MODEL_RESPONSE_SELECTORS,
	logger,
} from "@answerloom/utils";
import type { Page } from "playwright";
import { navigateWithRetry } from "../../../lib/browser/navigate.js";
import { waitForEditorReady } from "../../../lib/input/editor/waitForReady.js";
import { detectBotPage } from "../../../lib/input/response/detectBotPage.js";

const USER_MESSAGE_SELECTORS: Partial<Record<Provider, string[]>> = {
	deepseek: [
		'[data-role="user"]',
		'[data-message-author-role="user"]',
		'[class*="message"][class*="user"]',
	],
	doubao: [
		'[data-role="user"]',
		'[data-message-author-role="user"]',
		'[class*="user-message"]',
	],
	hunyuan: [
		'[data-role="user"]',
		'[data-message-author-role="user"]',
		'[class*="message"][class*="user"]',
	],
	qwen: [
		".qwen-chat-message-user",
		'[id^="qwen-chat-message-user-"]',
		'[data-message-author-role="user"]',
	],
};

const NEW_CONVERSATION_SELECTORS: Partial<Record<Provider, string[]>> = {
	deepseek: [
		'button[data-testid*="new-chat" i]',
		'a[data-testid*="new-chat" i]',
		'button[aria-label*="new chat" i]',
		'button[aria-label*="新对话" i]',
		'button:has-text("开启新对话")',
		'button:has-text("新对话")',
	],
	doubao: [
		'button[data-testid*="new-chat" i]',
		'a[data-testid*="new-chat" i]',
		'button[aria-label*="新对话" i]',
		'button[aria-label*="new chat" i]',
		'button:has-text("新对话")',
		'a:has-text("新对话")',
	],
	hunyuan: [
		'button[data-testid*="new-chat" i]',
		'a[data-testid*="new-chat" i]',
		'button[aria-label*="新建对话" i]',
		'button[aria-label*="new chat" i]',
		'button:has-text("新建对话")',
		'a:has-text("新建对话")',
	],
	qwen: [
		'button[data-testid*="new-chat" i]',
		'a[data-testid*="new-chat" i]',
		'button[aria-label*="new chat" i]',
		'button[aria-label*="新对话" i]',
		'button:has-text("New Chat")',
		'button:has-text("新对话")',
	],
};

async function hasVisibleMessage(page: Page, provider: Provider) {
	for (const selector of [
		...(USER_MESSAGE_SELECTORS[provider] ?? []),
		...(PROVIDER_MODEL_RESPONSE_SELECTORS[provider] ?? []),
	]) {
		const nodes = page.locator(selector);
		const count = await nodes.count().catch(() => 0);
		for (let index = 0; index < count; index += 1) {
			if (await nodes.nth(index).isVisible().catch(() => false)) return true;
		}
	}
	return false;
}

export async function startFreshProviderConversation(args: {
	page: Page;
	provider: Provider;
	homeUrl: string;
}): Promise<void> {
	await detectBotPage(args.page, args.provider);
	let clicked = false;
	for (const selector of NEW_CONVERSATION_SELECTORS[args.provider] ?? []) {
		const candidate = args.page.locator(selector).first();
		if (!(await candidate.isVisible().catch(() => false))) continue;
		if (!(await candidate.isEnabled().catch(() => false))) continue;
		await candidate.click({ timeout: 5_000 }).catch(() => null);
		clicked = true;
		await args.page.waitForTimeout(1_200);
		break;
	}

	if (!clicked || (await hasVisibleMessage(args.page, args.provider))) {
		await navigateWithRetry(args.page, args.homeUrl, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await args.page.waitForTimeout(1_000);
	}

	await detectBotPage(args.page, args.provider);
	await waitForEditorReady(args.page, args.provider);
	await assertFreshConversation(args.page, args.provider);
	// SPA providers may replace the editor once more after the route appears ready.
	// Re-check after that transition window so submit does not receive a detached editor.
	await args.page.waitForTimeout(900);
	await detectBotPage(args.page, args.provider);
	await waitForEditorReady(args.page, args.provider);
	await assertFreshConversation(args.page, args.provider);
	await args.page.evaluate((nonce) => {
		(
			window as Window & {
				__answerloomConversationNonce?: string;
			}
		).__answerloomConversationNonce = nonce;
	}, randomUUID());
	logger.log(
		`[${args.provider}] verified fresh conversation (${clicked ? "new-chat control" : "dedicated entry"})`,
	);
}

export async function assertFreshConversation(
	page: Page,
	provider: Provider,
): Promise<void> {
	for (const selector of USER_MESSAGE_SELECTORS[provider] ?? []) {
		const locator = page.locator(selector);
		const count = await locator.count().catch(() => 0);
		for (let index = 0; index < count; index += 1) {
			if (
				await locator
					.nth(index)
					.isVisible()
					.catch(() => false)
			) {
				throw new ValidationError(
					`[${provider}] fresh conversation contains an existing user message`,
					{ provider, reason: "conversation_not_fresh", selector },
				);
			}
		}
	}
}

export async function hasMatchingSubmittedPrompt(args: {
	page: Page;
	provider: Provider;
	prompt: string;
}): Promise<boolean> {
	return args.page
		.evaluate(
			({ selectors, prompt }) => {
				const normalize = (value: string) =>
					value
						.toLowerCase()
						.replace(/[\s`"'“”‘’.,!?，。！？:：;；()[\]{}<>《》、|\\/_-]+/g, "");
				const expected = normalize(prompt);
				if (!expected) return false;
				for (const selector of selectors) {
					for (const element of document.querySelectorAll(selector)) {
						const actual = normalize(
							(element as HTMLElement).innerText || element.textContent || "",
						);
						if (
							actual === expected ||
							(actual.length <= expected.length * 1.2 && actual.includes(expected))
						) {
							return true;
						}
					}
				}
				return false;
			},
			{
				selectors: USER_MESSAGE_SELECTORS[args.provider] ?? [],
				prompt: args.prompt,
			},
		)
		.catch(() => false);
}

export async function readConversationIdentity(
	page: Page,
	provider?: Provider,
): Promise<{
	conversationId: string | null;
	conversationUrl: string;
}> {
	const conversationUrl = page.url();
	try {
		const parsed = new URL(conversationUrl);
		for (const key of [
			"conversationId",
			"conversation_id",
			"chatId",
			"chat_id",
			"sessionId",
			"session_id",
		]) {
			const value = parsed.searchParams.get(key)?.trim();
			if (value) return { conversationId: value, conversationUrl };
		}
		const segments = parsed.pathname.split("/").filter(Boolean);
		const candidate = [...segments]
			.reverse()
			.find((segment) => /[a-z0-9_-]{8,}/i.test(segment)) ?? null;
		const ignored = new Set(["chat", "sign_in", "signin", "login", "new"]);
		if (candidate && !ignored.has(candidate.toLowerCase())) {
			return { conversationId: candidate, conversationUrl };
		}
	} catch {
		return { conversationId: null, conversationUrl };
	}

	const selectors = provider
		? [
				...(USER_MESSAGE_SELECTORS[provider] ?? []),
				...(PROVIDER_MODEL_RESPONSE_SELECTORS[provider] ?? []),
			]
		: [];
	const domIdentity = await page
		.evaluate((candidateSelectors) => {
			const values: string[] = [];
			const nonce = (
				window as Window & { __answerloomConversationNonce?: string }
			).__answerloomConversationNonce;
			if (nonce) values.push(`answerloom-session:${nonce}`);
			for (const selector of candidateSelectors) {
				for (const element of document.querySelectorAll(selector)) {
					for (const name of [
						"id",
						"data-message-id",
						"data-conversation-id",
						"data-chat-id",
					]) {
						const value = element.getAttribute(name)?.trim();
						if (value) values.push(`${name}:${value}`);
					}
				}
			}
			return values;
		}, selectors)
		.catch(() => [] as string[]);
	if (domIdentity.length > 0) {
		return {
			conversationId: `dom-${createHash("sha256")
				.update(`${provider ?? "provider"}\n${domIdentity.join("\n")}`)
				.digest("hex")
				.slice(0, 24)}`,
			conversationUrl,
		};
	}
	return { conversationId: null, conversationUrl };
}
