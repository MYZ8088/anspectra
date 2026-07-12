import { NotFoundError } from "@aloom/errors";
import type { Provider } from "@aloom/types";
import { PROVIDER_EDITOR_SELECTORS } from "@aloom/utils";
import type { Locator, Page } from "playwright";

export type EditorCandidate = {
	locator: Locator;
	selector: string;
};

const EDITOR_PROBE_TIMEOUT_MS = 1_500;

export async function findActiveEditorCandidateFromSelectors(
	page: Page,
	selectors: string[],
): Promise<EditorCandidate> {
	for (const selector of selectors) {
		const nodes = page.locator(selector);

		const count = await nodes.count();
		for (let i = 0; i < count; i++) {
			const el = nodes.nth(i);

			try {
				const visible = await el
					.isVisible({ timeout: EDITOR_PROBE_TIMEOUT_MS })
					.catch(() => false);
				if (!visible) {
					continue;
				}

				const box = await el
					.boundingBox({ timeout: EDITOR_PROBE_TIMEOUT_MS })
					.catch(() => null);
				if (!box || box.width < 8 || box.height < 8) {
					continue;
				}

				const state = await el
					.getEditableState({ timeout: EDITOR_PROBE_TIMEOUT_MS })
					.catch(() => null);
				if (
					!(
						state?.connected &&
						state.visible &&
						state.editable &&
						state.enabled
					)
				) {
					continue;
				}

				return { locator: el, selector };
			} catch (_error) {}
		}
	}

	throw new NotFoundError("active prompt editor");
}

async function findActiveEditorFromSelectors(
	page: Page,
	selectors: string[],
): Promise<Locator> {
	const candidate = await findActiveEditorCandidateFromSelectors(
		page,
		selectors,
	);
	return candidate.locator;
}

async function findActiveEditor(
	page: Page,
	provider?: Provider,
): Promise<Locator> {
	const candidate = await findActiveEditorCandidate(page, provider);
	return candidate.locator;
}

export async function findActiveEditorCandidate(
	page: Page,
	provider?: Provider,
): Promise<EditorCandidate> {
	const fallbackSelectors = [
		...new Set(Object.values(PROVIDER_EDITOR_SELECTORS).flat()),
	];
	const selectors = provider
		? PROVIDER_EDITOR_SELECTORS[provider] || fallbackSelectors
		: fallbackSelectors;

	return findActiveEditorCandidateFromSelectors(page, selectors);
}
