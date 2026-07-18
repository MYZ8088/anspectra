import OpenAI from "openai";
import {
	type StructuredModelGenerator,
	createOpenAiCompatibleGenerator,
} from "./structuredOutput.js";

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_TOKENS = 8192;

export type AnalysisModelConnection = {
	baseUrl: string;
	model: string;
	apiKey: string;
};

export function supportsStrictAnalysisSchema(model: string): boolean {
	return !model.toLowerCase().includes("deepseek-v4");
}

export function analysisModelRequestOverrides(
	model: string,
): Record<string, unknown> | undefined {
	return model.toLowerCase().includes("deepseek-v4")
		? { thinking: { type: "disabled" } }
		: undefined;
}

export function createAnalysisModelGenerators(
	connection: AnalysisModelConnection,
	options: { maxTokens?: number; timeoutMs?: number } = {},
): StructuredModelGenerator[] {
	const client = new OpenAI({
		apiKey: connection.apiKey,
		baseURL: connection.baseUrl,
	});
	return [
		createOpenAiCompatibleGenerator({
			client,
			provider: "Configured API",
			model: connection.model,
			maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			strictSchema: supportsStrictAnalysisSchema(connection.model),
			extraBody: analysisModelRequestOverrides(connection.model),
		}),
	];
}
