import { EnvError } from "@aloom/errors";
import Anthropic from "@anthropic-ai/sdk";
import ChatGptClient from "openai";
import { env } from "../env.js";

let openaiClient: ChatGptClient | null = null;
let anthropicClient: Anthropic | null = null;
let aihubmixClient: ChatGptClient | null = null;

function initOpenai(): ChatGptClient {
	if (openaiClient) return openaiClient;

	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new EnvError(
			"OPENAI_API_KEY",
			"Missing ChatGPT API key. Please set OPENAI_API_KEY in your environment.",
		);
	}

	openaiClient = new ChatGptClient({ apiKey });
	return openaiClient;
}

function initAnthropic(): Anthropic {
	if (anthropicClient) return anthropicClient;

	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new EnvError(
			"ANTHROPIC_API_KEY",
			"Missing Anthropic API key. Please set ANTHROPIC_API_KEY in your environment.",
		);
	}

	anthropicClient = new Anthropic({ apiKey });
	return anthropicClient;
}

function initAihubmix(): ChatGptClient {
	if (aihubmixClient) return aihubmixClient;

	const apiKey = env.AIHUBMIX_API_KEY ?? env.aihubmix_api_key;
	if (!apiKey) {
		throw new EnvError(
			"AIHUBMIX_API_KEY",
			"Missing AIHubMix API key. Please set AIHUBMIX_API_KEY or aihubmix_api_key in your environment.",
		);
	}

	aihubmixClient = new ChatGptClient({
		apiKey,
		baseURL: env.AIHUBMIX_BASE_URL,
	});
	return aihubmixClient;
}

/**
 * Proxy defers client creation until first actual usage
 */
export const chatgpt = new Proxy({} as ChatGptClient, {
	get(_target, prop) {
		const instance = initOpenai();
		// @ts-expect-error – dynamic proxy passthrough
		return instance[prop];
	},
});

export const claude = new Proxy({} as Anthropic, {
	get(_target, prop) {
		const instance = initAnthropic();
		// @ts-expect-error – dynamic proxy passthrough
		return instance[prop];
	},
});

export const aihubmix = new Proxy({} as ChatGptClient, {
	get(_target, prop) {
		const instance = initAihubmix();
		// @ts-expect-error – dynamic proxy passthrough
		return instance[prop];
	},
});

export * from "./structuredOutput.js";
