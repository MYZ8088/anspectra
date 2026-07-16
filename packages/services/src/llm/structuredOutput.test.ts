import { ExternalServiceError, ValidationError } from "@aloom/errors";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	type StructuredModelGenerator,
	generateStructuredOutput,
	parseStructuredOutput,
} from "./structuredOutput.js";

const ResultSchema = z.object({
	name: z.string(),
	score: z.number().int().min(0).max(100),
});

function model(args: {
	model: string;
	strictSchema?: boolean;
	generate: StructuredModelGenerator["generate"];
}): StructuredModelGenerator {
	return {
		provider: "test",
		model: args.model,
		strictSchema: args.strictSchema ?? true,
		generate: vi.fn(args.generate),
	};
}

const request = {
	schema: ResultSchema,
	schemaName: "test_result",
	systemPrompt: "Return a result.",
	userPrompt: "Analyze Aloom.",
};

describe("parseStructuredOutput", () => {
	it("extracts fenced JSON from commentary containing an apostrophe", () => {
		const result = parseStructuredOutput({
			rawOutput:
				'Here\'s the result:\n```json\n{"name":"Aloom","score":72}\n```\nDone.',
			schema: ResultSchema,
		});
		expect(result).toEqual({
			data: { name: "Aloom", score: 72 },
			parseMode: "extracted_json",
		});
	});

	it("repairs common JSON syntax defects locally", () => {
		const result = parseStructuredOutput({
			rawOutput: "{name:'Aloom',score:72,}",
			schema: ResultSchema,
		});
		expect(result.data).toEqual({ name: "Aloom", score: 72 });
		expect(result.parseMode).toBe("repaired_json");
	});

	it("rejects syntactically valid JSON that violates the schema", () => {
		expect(() =>
			parseStructuredOutput({
				rawOutput: '{"name":"Aloom","score":"high"}',
				schema: ResultSchema,
			}),
		).toThrow("Invalid structured JSON");
	});
});

describe("generateStructuredOutput", () => {
	it("uses a fallback model when the primary output is schema-invalid", async () => {
		const primary = model({
			model: "primary",
			generate: async () => ({
				text: '{"name":"Aloom","score":"high"}',
			}),
		});
		const fallback = model({
			model: "fallback",
			generate: async () => ({
				text: '{"name":"Aloom","score":81}',
			}),
		});
		const result = await generateStructuredOutput({
			...request,
			generators: [primary, fallback],
		});
		expect(result.data.score).toBe(81);
		expect(result.model).toBe("fallback");
		expect(result.attemptCount).toBe(2);
	});

	it("falls back to JSON object mode only when strict schema is unsupported", async () => {
		const generator = model({
			model: "compat-model",
			generate: async ({ responseFormat }) => {
				if (responseFormat === "json_schema") {
					throw new Error("response_format json_schema is not supported");
				}
				return { text: '{"name":"Aloom","score":77}' };
			},
		});
		const result = await generateStructuredOutput({
			...request,
			generators: [generator],
		});
		expect(result.data.score).toBe(77);
		expect(result.attempts.map((attempt) => attempt.responseFormat)).toEqual([
			"json_schema",
			"json_object",
		]);
	});

	it("runs one model repair stage after both generation models fail", async () => {
		const primary = model({
			model: "primary",
			generate: async () => ({ text: '{"name":"Aloom"}' }),
		});
		const fallback = model({
			model: "fallback",
			generate: async ({ stage }) => ({
				text:
					stage === "repair" ? '{"name":"Aloom","score":0}' : '{"score":42}',
			}),
		});
		const result = await generateStructuredOutput({
			...request,
			generators: [primary, fallback],
			repairGenerator: fallback,
		});
		expect(result.data).toEqual({ name: "Aloom", score: 0 });
		expect(result.attempts.map((attempt) => attempt.stage)).toEqual([
			"generate",
			"generate",
			"repair",
		]);
	});

	it("retains every raw output and attempt when recovery is exhausted", async () => {
		const primary = model({
			model: "primary",
			generate: async () => ({ text: '{"name":"Aloom"}' }),
		});
		const fallback = model({
			model: "fallback",
			generate: async () => ({ text: '{"score":42}' }),
		});
		let caught: unknown;
		try {
			await generateStructuredOutput({
				...request,
				generators: [primary, fallback],
				repairGenerator: fallback,
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ValidationError);
		const error = caught as ValidationError;
		expect(error.meta?.rawOutputs).toHaveLength(3);
		expect(error.meta?.models).toEqual(["primary", "fallback"]);
		expect(error.meta?.attemptCount).toBe(3);
		expect(error.meta?.attempts).toHaveLength(3);
	});

	it("preserves upstream quota failures instead of reporting invalid JSON", async () => {
		const quotaError = Object.assign(new Error("Usage limit exhausted"), {
			status: 401,
		});
		const primary = model({
			model: "primary",
			generate: async () => {
				throw quotaError;
			},
		});
		let caught: unknown;
		try {
			await generateStructuredOutput({ ...request, generators: [primary] });
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ExternalServiceError);
		expect((caught as Error).message).toContain("Usage limit exhausted");
		expect((caught as ExternalServiceError).status).toBe(401);
		expect((caught as ExternalServiceError).meta?.rawOutputs).toEqual([]);
	});
});
