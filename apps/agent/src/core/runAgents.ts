import type {
	AskPromptResult,
	PromptAttemptUpdate,
	PromptPayload,
	Provider,
} from "@answerloom/types";
import type { Page } from "playwright";
import { runPrompts } from "./prompt-runner/index.js";

export async function runAgents(
	prompts: PromptPayload,
	page: Page,
	provider: Provider,
	onPromptProgress?: (current: number, total: number) => Promise<void>,
	onSampleComplete?: (sample: AskPromptResult) => Promise<void>,
	onAttemptUpdate?: (update: PromptAttemptUpdate) => Promise<void>,
): Promise<AskPromptResult[]> {
	return runPrompts(
		prompts,
		page,
		provider,
		onPromptProgress,
		onSampleComplete,
		onAttemptUpdate,
	);
}
