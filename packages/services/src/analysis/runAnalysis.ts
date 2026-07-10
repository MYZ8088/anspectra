import { ExternalServiceError, ValidationError } from "@answerloom/errors";
import type {
	AnalysisInputSingle,
	BrandAnalysisResult,
} from "@answerloom/types";
import { z } from "zod";
import { env } from "../env.js";
import { aihubmix, chatgpt, claude } from "../llm/index.js";
import { analysisPrompt } from "./analysisPrompt.js";

const systemPrompt =
	"You are an expert brand intelligence analyst. " +
	"You respond ONLY with valid JSON — no markdown, no code fences, no commentary. " +
	"Return only valid JSON matching the requested schema. " +
	"Be precise, evidence-based, and conservative in your scoring. " +
	"If the brand is not mentioned in the response, return zeroed-out scores and empty arrays rather than fabricating data.";

const AIHUBMIX_ANALYSIS_TIMEOUT_MS = 180_000;
const AIHUBMIX_ANALYSIS_MAX_TOKENS = 8192;
const AIHUBMIX_FALLBACK_TIMEOUT_MS = 180_000;

type AihubmixAttemptResult = {
	text: string;
	model: string;
	finishReason?: string | null;
	reasoningLength: number;
};

export type AnalysisExecution = {
	result: BrandAnalysisResult;
	rawOutputs: string[];
	model: string;
	attemptCount: number;
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

function extractBalancedJsonObject(text: string): string | null {
	const start = text.indexOf("{");
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < text.length; index += 1) {
		const character = text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') {
			inString = true;
			continue;
		}
		if (character === "{") depth += 1;
		if (character === "}") {
			depth -= 1;
			if (depth === 0) return text.slice(start, index + 1);
		}
	}
	return null;
}

export function parseAnalysisOutput(text: string): BrandAnalysisResult {
	const trimmed = text.trim().replace(/^\uFEFF/, "");
	const candidates = [trimmed, extractBalancedJsonObject(trimmed)].filter(
		(value, index, values): value is string =>
			Boolean(value) && values.indexOf(value) === index,
	);
	let lastError: unknown;
	for (const candidate of candidates) {
		try {
			const parsed = analysisResultSchema.parse(JSON.parse(candidate));
			return parsed as BrandAnalysisResult;
		} catch (error) {
			lastError = error;
		}
	}
	throw new ValidationError(
		"Invalid JSON returned from LLM during analysis.",
		{
			rawOutput: text,
			parseError:
				lastError instanceof Error
					? lastError.message.slice(0, 1_000)
					: "unknown",
		},
		lastError,
	);
}

function shouldRetryAihubmixWithFallback(
	result: AihubmixAttemptResult,
): boolean {
	return (
		result.text.trim().length === 0 &&
		result.reasoningLength > 0 &&
		env.AIHUBMIX_ANALYSIS_FALLBACK_MODEL.trim().length > 0 &&
		env.AIHUBMIX_ANALYSIS_FALLBACK_MODEL !== result.model
	);
}

async function runWithOpenAI(
	prompt: string,
	responseLength: number,
): Promise<string> {
	try {
		const response = await chatgpt.responses.create({
			model: "gpt-4.1",
			temperature: 0,
			input: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: prompt },
			],
			text: { format: { type: "json_object" } },
		});
		return response.output_text?.trim() || "";
	} catch (err) {
		throw new ExternalServiceError(
			"ChatGPT",
			"Failed to analyze response.",
			502,
			{ responseLength },
			err,
		);
	}
}

async function runWithClaude(
	prompt: string,
	responseLength: number,
): Promise<string> {
	try {
		const response = await claude.messages.create({
			model: "claude-sonnet-4-6",
			max_tokens: 4096,
			temperature: 0,
			system: systemPrompt,
			messages: [{ role: "user", content: prompt }],
		});
		const block = response.content[0];
		return block?.type === "text" ? block.text.trim() : "";
	} catch (err) {
		throw new ExternalServiceError(
			"Claude",
			"Failed to analyze response.",
			502,
			{ responseLength },
			err,
		);
	}
}

async function runWithAihubmix(
	prompt: string,
	responseLength: number,
	forceFallback = false,
): Promise<AihubmixAttemptResult> {
	async function attempt(args: {
		model: string;
		timeoutMs: number;
		maxTokens: number;
	}): Promise<AihubmixAttemptResult> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

		try {
			const response = await aihubmix.chat.completions.create(
				{
					model: args.model,
					temperature: 0,
					max_tokens: args.maxTokens,
					response_format: { type: "json_object" },
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: prompt },
					],
				},
				{
					signal: controller.signal,
					timeout: args.timeoutMs,
				},
			);
			const choice = response.choices[0];
			const message = choice?.message as
				| {
						content?: string | null;
						reasoning_content?: string | null;
				  }
				| undefined;
			return {
				text: message?.content?.trim() || "",
				model: args.model,
				finishReason: choice?.finish_reason,
				reasoningLength: message?.reasoning_content?.length ?? 0,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	try {
		const primary = await attempt({
			model: forceFallback
				? env.AIHUBMIX_ANALYSIS_FALLBACK_MODEL
				: env.AIHUBMIX_ANALYSIS_MODEL,
			timeoutMs: AIHUBMIX_ANALYSIS_TIMEOUT_MS,
			maxTokens: AIHUBMIX_ANALYSIS_MAX_TOKENS,
		});
		if (forceFallback || !shouldRetryAihubmixWithFallback(primary)) {
			return primary;
		}

		const fallback = await attempt({
			model: env.AIHUBMIX_ANALYSIS_FALLBACK_MODEL,
			timeoutMs: AIHUBMIX_FALLBACK_TIMEOUT_MS,
			maxTokens: AIHUBMIX_ANALYSIS_MAX_TOKENS,
		});
		return fallback;
	} catch (err) {
		throw new ExternalServiceError(
			"AIHubMix",
			"Failed to analyze response.",
			502,
			{
				model: env.AIHUBMIX_ANALYSIS_MODEL,
				fallbackModel: env.AIHUBMIX_ANALYSIS_FALLBACK_MODEL,
				promptLength: prompt.length,
				responseLength,
				timeoutMs: AIHUBMIX_ANALYSIS_TIMEOUT_MS,
			},
			err,
		);
	}
}

export async function runAnalysisDetailed(
	input: AnalysisInputSingle,
): Promise<AnalysisExecution> {
	const prompt = analysisPrompt(input);

	let text: string;
	let model: string;
	switch (env.ANALYSIS_LLM_PROVIDER) {
		case "claude":
			text = await runWithClaude(prompt, input.response.length);
			model = "claude-sonnet-4-6";
			break;
		case "aihubmix": {
			const primary = await runWithAihubmix(prompt, input.response.length);
			text = primary.text;
			model = primary.model;
			try {
				return {
					result: parseAnalysisOutput(text),
					rawOutputs: [text],
					model,
					attemptCount: 1,
				};
			} catch (primaryError) {
				const fallbackModel = env.AIHUBMIX_ANALYSIS_FALLBACK_MODEL.trim();
				if (!fallbackModel || fallbackModel === primary.model)
					throw primaryError;
				const fallback = await runWithAihubmix(
					prompt,
					input.response.length,
					true,
				);
				try {
					return {
						result: parseAnalysisOutput(fallback.text),
						rawOutputs: [text, fallback.text],
						model: fallback.model,
						attemptCount: 2,
					};
				} catch (fallbackError) {
					throw new ValidationError(
						"Invalid JSON returned from both AIHubMix analysis attempts.",
						{
							rawOutputs: [text, fallback.text],
							models: [primary.model, fallback.model],
							attemptCount: 2,
						},
						fallbackError,
					);
				}
			}
		}
		default:
			text = await runWithOpenAI(prompt, input.response.length);
			model = "gpt-4.1";
			break;
	}
	return {
		result: parseAnalysisOutput(text),
		rawOutputs: [text],
		model,
		attemptCount: 1,
	};
}

export async function runAnalysis(
	input: AnalysisInputSingle,
): Promise<BrandAnalysisResult> {
	return (await runAnalysisDetailed(input)).result;
}
