import { EnvError } from "@anspectra/errors";
import ChatGptClient from "openai";
import { env } from "../env.js";

let client: ChatGptClient | null = null;

export function getLlmModel(): string {
	if (!env.LLM_MODEL) {
		throw new EnvError(
			"LLM_MODEL",
			"Missing model name. Please set LLM_MODEL in your environment.",
		);
	}
	return env.LLM_MODEL;
}

export function supportsStrictLlmSchema(model: string): boolean {
	return !model.toLowerCase().includes("deepseek-v4");
}

export function llmRequestOverrides(
	model: string,
): Record<string, unknown> | undefined {
	return model.toLowerCase().includes("deepseek-v4")
		? { thinking: { type: "disabled" } }
		: undefined;
}

function initClient(): ChatGptClient {
	if (client) return client;
	if (!env.LLM_BASE_URL) {
		throw new EnvError(
			"LLM_BASE_URL",
			"Missing API base URL. Please set LLM_BASE_URL in your environment.",
		);
	}
	if (!env.LLM_API_KEY) {
		throw new EnvError(
			"LLM_API_KEY",
			"Missing API key. Please set LLM_API_KEY in your environment.",
		);
	}

	client = new ChatGptClient({
		apiKey: env.LLM_API_KEY,
		baseURL: env.LLM_BASE_URL,
	});
	return client;
}

/** Defers client creation until the first model request. */
export const llm = new Proxy({} as ChatGptClient, {
	get(_target, prop) {
		const instance = initClient();
		// @ts-expect-error – dynamic proxy passthrough
		return instance[prop];
	},
});

export * from "./structuredOutput.js";
