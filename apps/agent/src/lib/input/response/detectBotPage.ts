import { HumanChallengeError } from "@aloom/errors";
import {
	CHALLENGE_KIND_LIST,
	type ChallengeKind,
	type Provider,
} from "@aloom/types";
import type { Page } from "playwright";

type BotPageState = {
	botDetected: boolean;
	reason: string | null;
	kind: string | null;
};

export async function detectBotPage(
	page: Page,
	provider: Provider,
): Promise<void> {
	const state = await page
		.runDomOp<BotPageState>("detect-bot-page")
		.catch(() => ({ botDetected: false, reason: null, kind: null }));

	if (state.botDetected) {
		const kind = CHALLENGE_KIND_LIST.includes(state.kind as ChallengeKind)
			? (state.kind as ChallengeKind)
			: "security_check";
		throw new HumanChallengeError({
			provider,
			kind,
			pageUrl: page.url(),
			message: state.reason ?? "human verification required",
		});
	}
}
