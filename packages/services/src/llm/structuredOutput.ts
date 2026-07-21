import {
	ExternalServiceError,
	ValidationError,
	toErrorMessage,
} from "@anspectra/errors";
import { jsonrepair } from "jsonrepair";
import type OpenAI from "openai";
import type { ZodTypeAny, output } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const MAX_REPAIR_INPUT_LENGTH = 50_000;
const MAX_RECORDED_ERROR_LENGTH = 2_000;

export type StructuredParseMode =
	| "strict_json"
	| "extracted_json"
	| "repaired_json";

export type StructuredResponseFormat = "json_schema" | "json_object" | "tool";

export type StructuredOutputAttempt = {
	stage: "generate" | "repair";
	provider: string;
	model: string;
	responseFormat: StructuredResponseFormat;
	rawOutput: string;
	finishReason?: string | null;
	reasoningLength?: number;
	parseMode?: StructuredParseMode;
	error?: string;
};

export type StructuredModelGenerator = {
	provider: string;
	model: string;
	strictSchema: boolean;
	generate(request: {
		systemPrompt: string;
		userPrompt: string;
		schemaName: string;
		jsonSchema: Record<string, unknown>;
		responseFormat: "json_schema" | "json_object";
		stage: "generate" | "repair";
	}): Promise<{
		text: string;
		finishReason?: string | null;
		reasoningLength?: number;
		responseFormat?: StructuredResponseFormat;
	}>;
};

export type StructuredOutputResult<T> = {
	data: T;
	model: string;
	rawOutputs: string[];
	attemptCount: number;
	attempts: StructuredOutputAttempt[];
	parseMode: StructuredParseMode;
};

type Candidate = {
	value: string;
	source: "full" | "fence" | "balanced";
};

type ParseDiagnostic = {
	source: Candidate["source"];
	mode: "json_parse" | "schema_validation" | "json_repair";
	error: string;
};

function compactError(error: unknown): string {
	return toErrorMessage(error).slice(0, MAX_RECORDED_ERROR_LENGTH);
}

function errorStatus(error: unknown): number {
	if (typeof error !== "object" || !error || !("status" in error)) return 502;
	const status = Number((error as { status?: unknown }).status);
	return Number.isInteger(status) && status >= 400 && status <= 599
		? status
		: 502;
}

function zodErrorMessage(error: {
	issues: Array<{ path: Array<string | number>; message: string }>;
}): string {
	return error.issues
		.slice(0, 20)
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join(".") : "root";
			return `${path}: ${issue.message}`;
		})
		.join("; ")
		.slice(0, MAX_RECORDED_ERROR_LENGTH);
}

function extractBalancedJson(text: string): string[] {
	const results: string[] = [];
	let start = -1;
	let quote: '"' | "'" | null = null;
	let escaped = false;
	const stack: string[] = [];

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (quote) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) quote = null;
			continue;
		}
		if (stack.length === 0 && character !== "{" && character !== "[") {
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === "{" || character === "[") {
			if (stack.length === 0) start = index;
			stack.push(character);
			continue;
		}
		if (character !== "}" && character !== "]") continue;
		const expected = character === "}" ? "{" : "[";
		if (stack.at(-1) !== expected) {
			stack.length = 0;
			start = -1;
			continue;
		}
		stack.pop();
		if (stack.length === 0 && start >= 0) {
			results.push(text.slice(start, index + 1));
			start = -1;
		}
	}
	return results;
}

function collectJsonCandidates(rawOutput: string): Candidate[] {
	const trimmed = rawOutput.replace(/^\uFEFF/, "").trim();
	const candidates: Candidate[] = [];
	const seen = new Set<string>();
	const add = (value: string, source: Candidate["source"]) => {
		const normalized = value.trim();
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		candidates.push({ value: normalized, source });
	};

	add(trimmed, "full");
	for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
		if (match[1]) add(match[1], "fence");
	}
	for (const value of extractBalancedJson(trimmed)) add(value, "balanced");
	return candidates;
}

export function parseStructuredOutput<TSchema extends ZodTypeAny>(args: {
	rawOutput: string;
	schema: TSchema;
	errorMessage?: string;
}): { data: output<TSchema>; parseMode: StructuredParseMode } {
	const diagnostics: ParseDiagnostic[] = [];
	const candidates = collectJsonCandidates(args.rawOutput);

	for (const candidate of candidates) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(candidate.value);
		} catch (error) {
			diagnostics.push({
				source: candidate.source,
				mode: "json_parse",
				error: compactError(error),
			});
			try {
				const repaired = jsonrepair(candidate.value);
				parsed = JSON.parse(repaired);
				const validated = args.schema.safeParse(parsed);
				if (validated.success) {
					return { data: validated.data, parseMode: "repaired_json" };
				}
				diagnostics.push({
					source: candidate.source,
					mode: "schema_validation",
					error: zodErrorMessage(validated.error),
				});
			} catch (repairError) {
				diagnostics.push({
					source: candidate.source,
					mode: "json_repair",
					error: compactError(repairError),
				});
			}
			continue;
		}

		const validated = args.schema.safeParse(parsed);
		if (validated.success) {
			return {
				data: validated.data,
				parseMode:
					candidate.source === "full" ? "strict_json" : "extracted_json",
			};
		}
		diagnostics.push({
			source: candidate.source,
			mode: "schema_validation",
			error: zodErrorMessage(validated.error),
		});
	}

	throw new ValidationError(
		args.errorMessage ?? "Invalid structured JSON returned from LLM.",
		{
			rawOutput: args.rawOutput,
			diagnostics,
		},
	);
}

function removeUnsupportedSchemaKeywords(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(removeUnsupportedSchemaKeywords);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(([key]) => key !== "$schema" && key !== "default")
			.map(([key, nested]) => [key, removeUnsupportedSchemaKeywords(nested)]),
	);
}

function createJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
	const converted = zodToJsonSchema(schema, {
		target: "openAi",
		$refStrategy: "none",
	});
	const cleaned = removeUnsupportedSchemaKeywords(converted);
	if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
		throw new ValidationError("Structured output schema must be a JSON object");
	}
	return cleaned as Record<string, unknown>;
}

function isStrictSchemaUnsupported(error: unknown): boolean {
	const message = compactError(error).toLowerCase();
	const status =
		typeof error === "object" && error && "status" in error
			? Number((error as { status?: unknown }).status)
			: undefined;
	const mentionsSchema =
		/(json[_ -]?schema|response[_ -]?format|structured output|schema validation)/.test(
			message,
		);
	const unsupported =
		/(not supported|unsupported|unknown parameter|invalid parameter|invalid schema|not available)/.test(
			message,
		);
	return (
		mentionsSchema &&
		(unsupported || status === 400 || status === 404 || status === 422)
	);
}

function jsonObjectSystemPrompt(
	systemPrompt: string,
	jsonSchema: Record<string, unknown>,
): string {
	return `${systemPrompt}\n\nReturn exactly one JSON object that validates against this JSON Schema. Do not include markdown or commentary.\nJSON Schema:\n${JSON.stringify(jsonSchema)}`;
}

function repairPrompts(args: {
	rawOutput: string;
	jsonSchema: Record<string, unknown>;
	repairInstructions?: string;
}) {
	return {
		systemPrompt: `You repair a model response into one valid JSON object. Preserve the original meaning and values. Make only syntactic and schema-conformance changes. Never invent facts, evidence, prices, customers, certifications, rankings, metrics, or outcomes. If required information is absent, use a conservative empty, null, false, or zero value only when the schema permits it. Return JSON only.${args.repairInstructions ? `\n${args.repairInstructions}` : ""}`,
		userPrompt: JSON.stringify({
			jsonSchema: args.jsonSchema,
			invalidModelOutput: args.rawOutput.slice(0, MAX_REPAIR_INPUT_LENGTH),
		}),
	};
}

export async function generateStructuredOutput<
	TSchema extends ZodTypeAny,
>(args: {
	schema: TSchema;
	schemaName: string;
	systemPrompt: string;
	userPrompt: string;
	generators: StructuredModelGenerator[];
	repairGenerator?: StructuredModelGenerator;
	repairInstructions?: string;
	errorMessage?: string;
}): Promise<StructuredOutputResult<output<TSchema>>> {
	if (args.generators.length === 0) {
		throw new ValidationError(
			"At least one structured output model is required",
		);
	}
	const jsonSchema = createJsonSchema(args.schema);
	const attempts: StructuredOutputAttempt[] = [];
	const rawOutputs: string[] = [];
	let lastError: unknown;

	const execute = async (
		generator: StructuredModelGenerator,
		stage: "generate" | "repair",
		systemPrompt: string,
		userPrompt: string,
	): Promise<StructuredOutputResult<output<TSchema>> | null> => {
		const formats: Array<"json_schema" | "json_object"> = generator.strictSchema
			? ["json_schema"]
			: ["json_object"];

		for (let formatIndex = 0; formatIndex < formats.length; formatIndex += 1) {
			const responseFormat = formats[formatIndex];
			if (!responseFormat) continue;
			try {
				const response = await generator.generate({
					systemPrompt:
						responseFormat === "json_object"
							? jsonObjectSystemPrompt(systemPrompt, jsonSchema)
							: systemPrompt,
					userPrompt,
					schemaName: args.schemaName,
					jsonSchema,
					responseFormat,
					stage,
				});
				const rawOutput = response.text.trim();
				if (rawOutput) rawOutputs.push(rawOutput);
				const attempt: StructuredOutputAttempt = {
					stage,
					provider: generator.provider,
					model: generator.model,
					responseFormat: response.responseFormat ?? responseFormat,
					rawOutput,
					finishReason: response.finishReason,
					reasoningLength: response.reasoningLength,
				};
				attempts.push(attempt);
				try {
					const parsed = parseStructuredOutput({
						rawOutput,
						schema: args.schema,
						errorMessage: args.errorMessage,
					});
					attempt.parseMode = parsed.parseMode;
					return {
						data: parsed.data,
						model: generator.model,
						rawOutputs,
						attemptCount: attempts.length,
						attempts,
						parseMode: parsed.parseMode,
					};
				} catch (error) {
					lastError = error;
					attempt.error = compactError(error);
					return null;
				}
			} catch (error) {
				lastError = error;
				attempts.push({
					stage,
					provider: generator.provider,
					model: generator.model,
					responseFormat,
					rawOutput: "",
					error: compactError(error),
				});
				if (
					responseFormat === "json_schema" &&
					isStrictSchemaUnsupported(error)
				) {
					formats.push("json_object");
					continue;
				}
				return null;
			}
		}
		return null;
	};

	for (const generator of args.generators) {
		const result = await execute(
			generator,
			"generate",
			args.systemPrompt,
			args.userPrompt,
		);
		if (result) return result;
	}

	const invalidOutput = rawOutputs.at(-1);
	const repairGenerator = args.repairGenerator ?? args.generators.at(-1);
	if (invalidOutput && repairGenerator) {
		const prompts = repairPrompts({
			rawOutput: invalidOutput,
			jsonSchema,
			repairInstructions: args.repairInstructions,
		});
		const repaired = await execute(
			repairGenerator,
			"repair",
			prompts.systemPrompt,
			prompts.userPrompt,
		);
		if (repaired) return repaired;
	}

	const failureMetadata = {
		rawOutputs,
		models: [...new Set(attempts.map((attempt) => attempt.model))],
		attemptCount: attempts.length,
		attempts,
	};
	if (rawOutputs.length === 0 && lastError) {
		throw new ExternalServiceError(
			attempts.at(-1)?.provider ?? "Structured output provider",
			compactError(lastError),
			errorStatus(lastError),
			failureMetadata,
			lastError,
		);
	}

	throw new ValidationError(
		args.errorMessage ??
			"The model could not produce a response matching the required JSON schema.",
		failureMetadata,
		lastError,
	);
}

export function createOpenAiCompatibleGenerator(args: {
	client: OpenAI;
	provider: string;
	model: string;
	maxTokens?: number;
	timeoutMs?: number;
	strictSchema?: boolean;
	extraBody?: Record<string, unknown>;
}): StructuredModelGenerator {
	return {
		provider: args.provider,
		model: args.model,
		strictSchema: args.strictSchema ?? true,
		async generate(request) {
			const controller = new AbortController();
			const timeoutMs = args.timeoutMs ?? 180_000;
			const timeout = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const responseFormat =
					request.responseFormat === "json_schema"
						? {
								type: "json_schema" as const,
								json_schema: {
									name: request.schemaName
										.replace(/[^a-zA-Z0-9_-]/g, "_")
										.slice(0, 64),
									strict: true,
									schema: request.jsonSchema,
								},
							}
						: { type: "json_object" as const };
				const requestBody = {
						model: args.model,
						temperature: 0,
						max_tokens: args.maxTokens ?? 8192,
						response_format: responseFormat,
						messages: [
							{ role: "system", content: request.systemPrompt },
							{ role: "user", content: request.userPrompt },
						],
						...args.extraBody,
					} as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
				const response = await args.client.chat.completions.create(
					requestBody,
					{ signal: controller.signal, timeout: timeoutMs },
				);
				const choice = response.choices[0];
				const message = choice?.message as
					| {
							content?: string | null;
							reasoning_content?: string | null;
					  }
					| undefined;
				return {
					text: message?.content ?? "",
					finishReason: choice?.finish_reason,
					reasoningLength: message?.reasoning_content?.length ?? 0,
					responseFormat: request.responseFormat,
				};
			} finally {
				clearTimeout(timeout);
			}
		},
	};
}
