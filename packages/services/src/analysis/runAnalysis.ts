import { ValidationError } from "@aloom/errors";
import type { AnalysisInputSingle, BrandAnalysisResult } from "@aloom/types";
import { z } from "zod";
import { env } from "../env.js";
import { aihubmix, chatgpt, claude } from "../llm/index.js";
import {
	type StructuredModelGenerator,
	type StructuredOutputAttempt,
	type StructuredParseMode,
	createOpenAiCompatibleGenerator,
	generateStructuredOutput,
	parseStructuredOutput,
} from "../llm/structuredOutput.js";
import { analysisPrompt } from "./analysisPrompt.js";
import { applyTargetEntitySafeguards } from "./targetEntities.js";

const systemPrompt =
	"You are an expert brand intelligence analyst. " +
	"You respond ONLY with valid JSON — no markdown, no code fences, no commentary. " +
	"Return only valid JSON matching the requested schema. " +
	"Be precise, evidence-based, and conservative in your scoring. " +
	"If the brand is not mentioned in the response, return zeroed-out scores and empty arrays rather than fabricating data.";

const AIHUBMIX_ANALYSIS_TIMEOUT_MS = 180_000;
const AIHUBMIX_ANALYSIS_MAX_TOKENS = 8192;

export type AnalysisExecution = {
	result: BrandAnalysisResult;
	rawOutputs: string[];
	model: string;
	attemptCount: number;
	attempts: StructuredOutputAttempt[];
	parseMode: StructuredParseMode;
};

const boundedScore = z.coerce.number().min(0).max(100);
const factualErrorSchema = z.object({
	claim: z.string(),
	severity: z.enum(["critical", "warning", "info"]),
	correction: z.string().nullable().default(null),
});
const defaultScorecard = {
	visibility: { score: 0, numerator: 0, denominator: 1 },
	factuality: {
		score: null,
		reviewedClaims: 0,
		accurateClaims: 0,
		errors: [],
	},
	evidence: {
		score: 0,
		visibleCitations: 0,
		supportedClaims: 0,
		unsupportedClaims: 0,
	},
	stability: {
		score: null,
		comparableSamples: 1,
		consistentSamples: 1,
		note: "Requires repeated samples",
	},
	competition: { score: 0, targetShare: 0, competitorShare: 0 },
	governanceAttribution: {
		score: 25,
		confidence: "low" as const,
		caveats: ["Single observed answer"],
	},
};
const analysisResultSchema = z.object({
	geoScore: z.object({ overall: boundedScore }),
	presence: z.object({ mentioned: z.boolean(), visibility: boundedScore }),
	position: z.object({
		rankPosition: z.coerce.number().int().min(1).nullable(),
	}),
	sentiment: z.object({ score: boundedScore }),
	recommendation: z.object({
		type: z.enum([
			"top_pick",
			"strong_alternative",
			"conditional",
			"mentioned_only",
			"discouraged",
			"not_mentioned",
		]),
	}),
	competitors: z.array(
		z.object({
			name: z.string(),
			domain: z
				.string()
				.nullable()
				.transform((value) => value ?? ""),
			visibility: boundedScore,
			sentiment: boundedScore,
			rankPosition: z.coerce.number().int().min(1).nullable(),
			isRecommended: z.boolean(),
		}),
	),
	perception: z.object({
		coreClaims: z.array(z.string()).max(5),
		differentiators: z.array(z.string()).max(5),
		bestKnownFor: z.string().nullable(),
		pricingPerception: z.enum([
			"premium",
			"mid_range",
			"budget",
			"free",
			"not_mentioned",
		]),
	}),
	risks: z.object({
		items: z.array(
			z.object({
				severity: z.enum(["critical", "warning", "info"]),
				type: z
					.enum([
						"outdated_info",
						"factual_error",
						"brand_confusion",
						"negative_association",
						"missing_from_response",
					])
					.optional(),
				claim: z.string().optional(),
				correction: z.string().nullable().optional(),
			}),
		),
	}),
	scorecard: z
		.object({
			visibility: z.object({
				score: boundedScore,
				numerator: z.coerce.number().int().min(0),
				denominator: z.coerce.number().int().min(1),
			}),
			factuality: z.object({
				score: boundedScore.nullable(),
				reviewedClaims: z.coerce.number().int().min(0),
				accurateClaims: z.coerce.number().int().min(0),
				errors: z.array(factualErrorSchema),
			}),
			evidence: z.object({
				score: boundedScore,
				visibleCitations: z.coerce.number().int().min(0),
				supportedClaims: z.coerce.number().int().min(0),
				unsupportedClaims: z.coerce.number().int().min(0),
			}),
			stability: z.object({
				score: boundedScore.nullable(),
				comparableSamples: z.coerce.number().int().min(0),
				consistentSamples: z.coerce.number().int().min(0),
				note: z.string(),
			}),
			competition: z.object({
				score: boundedScore,
				targetShare: boundedScore,
				competitorShare: boundedScore,
			}),
			governanceAttribution: z.object({
				score: boundedScore,
				confidence: z.enum(["low", "medium", "high"]),
				caveats: z.array(z.string()),
			}),
		})
		.default(defaultScorecard),
});

export function parseAnalysisOutput(text: string): BrandAnalysisResult {
	try {
		return parseStructuredOutput({
			rawOutput: text,
			schema: analysisResultSchema,
			errorMessage: "Invalid JSON returned from LLM during analysis.",
		}).data as BrandAnalysisResult;
	} catch (error) {
		if (error instanceof ValidationError) throw error;
		throw new ValidationError(
			"Invalid JSON returned from LLM during analysis.",
			{ rawOutput: text },
			error,
		);
	}
}

function createClaudeGenerator(): StructuredModelGenerator {
	return {
		provider: "Anthropic",
		model: "claude-sonnet-4-6",
		strictSchema: false,
		async generate(request) {
			const response = await claude.messages.create({
				model: "claude-sonnet-4-6",
				max_tokens: AIHUBMIX_ANALYSIS_MAX_TOKENS,
				temperature: 0,
				system: request.systemPrompt,
				messages: [{ role: "user", content: request.userPrompt }],
				tools: [
					{
						name: "submit_structured_analysis",
						description:
							"Return the completed brand analysis using the required schema.",
						input_schema: request.jsonSchema as {
							type: "object";
							properties?: unknown;
							required?: string[];
						},
						strict: true,
					},
				],
				tool_choice: { type: "tool", name: "submit_structured_analysis" },
			});
			const toolBlock = response.content.find(
				(block) =>
					block.type === "tool_use" &&
					block.name === "submit_structured_analysis",
			);
			const hasToolBlock = toolBlock?.type === "tool_use";
			const text = hasToolBlock
				? JSON.stringify(toolBlock.input)
				: response.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n");
			return {
				text,
				finishReason: response.stop_reason,
				responseFormat: hasToolBlock ? "tool" : "json_object",
			};
		},
	};
}

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

function analysisGenerators(): StructuredModelGenerator[] {
	switch (env.ANALYSIS_LLM_PROVIDER) {
		case "claude":
			return [createClaudeGenerator()];
		case "aihubmix":
			return [env.AIHUBMIX_ANALYSIS_MODEL, env.AIHUBMIX_ANALYSIS_FALLBACK_MODEL]
				.map((model) => model.trim())
				.filter(
					(model, index, models) => model && models.indexOf(model) === index,
				)
				.map((model) =>
					createOpenAiCompatibleGenerator({
						client: aihubmix,
						provider: "AIHubMix",
						model,
						maxTokens: AIHUBMIX_ANALYSIS_MAX_TOKENS,
						timeoutMs: AIHUBMIX_ANALYSIS_TIMEOUT_MS,
						strictSchema: supportsStrictAnalysisSchema(model),
						extraBody: analysisModelRequestOverrides(model),
					}),
				);
		default:
			return [
				createOpenAiCompatibleGenerator({
					client: chatgpt,
					provider: "OpenAI",
					model: "gpt-4.1",
					maxTokens: AIHUBMIX_ANALYSIS_MAX_TOKENS,
					timeoutMs: AIHUBMIX_ANALYSIS_TIMEOUT_MS,
				}),
			];
	}
}

export async function runAnalysisDetailed(
	input: AnalysisInputSingle,
): Promise<AnalysisExecution> {
	const prompt = analysisPrompt(input);
	const generators = analysisGenerators();
	const execution = await generateStructuredOutput({
		schema: analysisResultSchema,
		schemaName: "brand_analysis",
		systemPrompt,
		userPrompt: prompt,
		generators,
		repairGenerator: generators.at(-1),
		repairInstructions:
			"For an absent brand, use zero scores, empty arrays, not_mentioned, and null rank values. Do not infer claims that are not present in the source answer.",
		errorMessage: "Invalid JSON returned from LLM during analysis.",
	});
	return {
		result: applyTargetEntitySafeguards({
			input,
			result: execution.data as BrandAnalysisResult,
		}),
		rawOutputs: execution.rawOutputs,
		model: execution.model,
		attemptCount: execution.attemptCount,
		attempts: execution.attempts,
		parseMode: execution.parseMode,
	};
}

export async function runAnalysis(
	input: AnalysisInputSingle,
): Promise<BrandAnalysisResult> {
	return (await runAnalysisDetailed(input)).result;
}
