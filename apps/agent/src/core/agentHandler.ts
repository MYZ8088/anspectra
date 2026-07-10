import type {
	AskPromptResult,
	PromptAttemptUpdate,
	PromptPayload,
	Provider,
} from "@answerloom/types";
import {
	type AgentFactory,
	type AttemptExecutor,
	type BrowserAttempt,
	runWithRetryCycles,
} from "../lib/browser/proxy/runner.js";
import { runWithProvider } from "../lib/providerContext.js";

export async function agentHandler(
	label: string,
	agentFactory: AgentFactory,
	payload: PromptPayload,
	provider: Provider,
	options?: {
		executor?: AttemptExecutor;
		signal?: AbortSignal;
		onAttemptStart?: (attempt: BrowserAttempt) => void | Promise<void>;
		onAttemptComplete?: () => void | Promise<void>;
		onPromptProgress?: (current: number, total: number) => Promise<void>;
		onSampleComplete?: (sample: AskPromptResult) => Promise<void>;
		onAttemptUpdate?: (update: PromptAttemptUpdate) => Promise<void>;
	},
): Promise<AskPromptResult[]> {
	return runWithProvider(provider, async () => {
		return runWithRetryCycles(label, agentFactory, payload, provider, {
			executor: options?.executor,
			signal: options?.signal,
			onAttemptStart: options?.onAttemptStart,
			onAttemptComplete: options?.onAttemptComplete,
			onPromptProgress: options?.onPromptProgress,
			onSampleComplete: options?.onSampleComplete,
			onAttemptUpdate: options?.onAttemptUpdate,
		});
	});
}
