import type { Provider } from "@anspectra/types";
import {
	PROVIDER_MODEL_RESPONSE_SELECTORS,
	PROVIDER_RESPONSE_GENERATION_SELECTORS,
} from "@anspectra/utils";
import type { Page } from "playwright";
import { isProvisionalResponse } from "./provisionalResponse.js";

const STRICT_RESPONSE_STATE_SELECTORS: Partial<Record<Provider, string[]>> = {
	deepseek: [".ds-markdown:not(.ds-think-content *)"],
	doubao: [
		'[data-message-id]:not([class*="justify-end"])',
		'[data-message-id]:not([class*="justify-end"]) .md-box-root',
	],
	hunyuan: ["#chat-content .hyc-common-markdown", ".hyc-common-markdown"],
	qwen: [
		".qwen-chat-message-assistant .response-message-content.phase-answer",
		".qwen-chat-message-assistant .custom-qwen-markdown",
		".qwen-chat-message-assistant .qwen-markdown",
	],
};

export async function getGenerationStateSignature(
	page: Page,
	provider: Provider,
): Promise<string> {
	return await page.evaluate(
		(selectors) =>
			(selectors || [])
				.map((selector) => {
					const parts = Array.from(document.querySelectorAll(selector)).map(
						(node) => {
							const element = node as HTMLElement;
							const style = window.getComputedStyle(element);
							const visible =
								element.offsetParent !== null &&
								style.visibility !== "hidden" &&
								style.display !== "none";
							const text = (element.textContent || "").trim();
							const ariaLabel = element.getAttribute("aria-label") || "";
							const disabled = element.getAttribute("disabled") ? "1" : "0";
							return `${visible ? 1 : 0}:${text}:${ariaLabel}:${disabled}`;
						},
					);
					return `${selector}=>${parts.join("|")}`;
				})
				.join("||"),
		PROVIDER_RESPONSE_GENERATION_SELECTORS[provider] || [],
	);
}

export async function hasVisibleGenerationIndicator(
	page: Page,
	provider: Provider,
): Promise<boolean> {
	return await page.evaluate(
		(selectors) =>
			(selectors || []).some((selector) =>
				Array.from(document.querySelectorAll(selector)).some((node) => {
					const element = node as HTMLElement;
					const style = window.getComputedStyle(element);
					return (
						element.offsetParent !== null &&
						style.visibility !== "hidden" &&
						style.display !== "none"
					);
				}),
			),
		PROVIDER_RESPONSE_GENERATION_SELECTORS[provider] || [],
	);
}

export async function getResponseStateSignature(
	page: Page,
	provider: Provider,
): Promise<{ signature: string; textLength: number; provisional: boolean }> {
	const state = await page.evaluate(
		(selectors) => {
			const visible = (element: Element | null): element is HTMLElement => {
				if (!(element instanceof HTMLElement)) return false;
				const style = window.getComputedStyle(element);
				return (
					element.offsetParent !== null &&
					style.visibility !== "hidden" &&
					style.display !== "none"
				);
			};

			let latest: HTMLElement | null = null;
			for (const selector of selectors || []) {
				const candidates = Array.from(
					document.querySelectorAll(selector),
				).filter(
					(el): el is HTMLElement =>
						visible(el) && (el.innerText || "").trim().length >= 20,
				);
				if (candidates.length > 0) {
					latest = candidates.at(-1) ?? null;
					break;
				}
			}
			if (!latest) {
				return {
					signature: "",
					textLength: 0,
					text: "",
					artifactReady: false,
				};
			}

			const text = (latest.innerText || "").replace(/\s+/g, " ").trim();
			return {
				signature: `${text.length}:${latest.innerHTML.length}:${latest.childElementCount}:${text.slice(-120)}`,
				textLength: text.length,
				text,
				artifactReady: Boolean(
					latest.querySelector(
						'[data-plugin-identifier*="artifact_block"] [data-status="finished"] [data-feishu-office-current-doc-old-card="true"]',
					),
				),
			};
		},
		STRICT_RESPONSE_STATE_SELECTORS[provider] ??
			PROVIDER_MODEL_RESPONSE_SELECTORS[provider] ??
			[],
	);
	return {
		signature: state.signature,
		textLength: state.textLength,
		provisional: !state.artifactReady && isProvisionalResponse(state.text),
	};
}
