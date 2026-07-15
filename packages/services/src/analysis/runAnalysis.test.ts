import { describe, expect, it } from "vitest";
import { analysisPrompt } from "./analysisPrompt.js";
import { parseAnalysisOutput } from "./runAnalysis.js";
import {
	applyTargetEntitySafeguards,
	findMatchedTargetEntities,
} from "./targetEntities.js";

const validAnalysis = {
	geoScore: { overall: 72 },
	presence: { mentioned: true, visibility: 68 },
	position: { rankPosition: 1 },
	sentiment: { score: 74 },
	recommendation: { type: "strong_alternative" },
	competitors: [
		{
			name: "Mixpanel",
			domain: null,
			visibility: 54,
			sentiment: 60,
			rankPosition: 2,
			isRecommended: true,
		},
	],
	perception: {
		coreClaims: ["Open-source product analytics"],
		differentiators: ["Self-hosting"],
		bestKnownFor: "Product analytics",
		pricingPerception: "free",
	},
	risks: { items: [] },
};

describe("parseAnalysisOutput", () => {
	it("extracts a valid object from markdown fences and commentary", () => {
		const result = parseAnalysisOutput(
			`Result follows:\n\`\`\`json\n${JSON.stringify(validAnalysis)}\n\`\`\``,
		);
		expect(result.geoScore.overall).toBe(72);
		expect(result.competitors[0]?.domain).toBe("");
	});

	it("repairs common JSON syntax errors before schema validation", () => {
		const malformed = JSON.stringify(validAnalysis)
			.replace('"geoScore"', "geoScore")
			.replace(/}$/, ",}");
		const result = parseAnalysisOutput(malformed);
		expect(result.geoScore.overall).toBe(72);
	});

	it("rejects incomplete or truncated JSON", () => {
		expect(() => parseAnalysisOutput('{"geoScore":{"overall":72}')).toThrow(
			"Invalid JSON returned",
		);
	});
});

describe("configured target entity recognition", () => {
	it("passes aliases and products to the analysis instructions", () => {
		const prompt = analysisPrompt({
			brandName: "Aloom",
			brandDomain: "aloom.example",
			brandAliases: ["AnswerLoom"],
			products: ["Aloom Monitor"],
			prompt: "Which GEO tools are recommended?",
			response: "Aloom Monitor is worth considering.",
		});
		expect(prompt).toContain("Configured Brand Aliases:** AnswerLoom");
		expect(prompt).toContain(
			"Configured Products / Product Lines:** Aloom Monitor",
		);
		expect(prompt).toContain(
			'Canonical Target Entity Set:** "Aloom", "AnswerLoom", "Aloom Monitor"',
		);
	});

	it("recognizes a configured product and removes it from competitors", () => {
		const parsed = parseAnalysisOutput(JSON.stringify(validAnalysis));
		const result = applyTargetEntitySafeguards({
			input: {
				brandName: "Aloom",
				brandDomain: "aloom.example",
				brandAliases: ["AnswerLoom"],
				products: ["Aloom Monitor"],
				prompt: "Recommend GEO monitoring tools.",
				response:
					"Aloom Monitor is included as a GEO monitoring option for product teams.",
			},
			result: {
				...parsed,
				geoScore: { overall: 0 },
				presence: { mentioned: false, visibility: 0 },
				position: { rankPosition: null },
				sentiment: { score: 0 },
				recommendation: { type: "not_mentioned" },
				competitors: [
					...parsed.competitors,
					{
						name: "Aloom Monitor",
						domain: "aloom.example",
						visibility: 30,
						sentiment: 50,
						rankPosition: 1,
						isRecommended: true,
					},
				],
			},
		});

		expect(result.presence.mentioned).toBe(true);
		expect(result.metadata?.matchedTargetEntities).toEqual([
			"Aloom",
			"Aloom Monitor",
		]);
		expect(
			result.competitors.map((competitor) => competitor.name),
		).not.toContain("Aloom Monitor");
		expect(result.recommendation.type).toBe("mentioned_only");
	});

	it("does not count a target that appears only inside a raw URL", () => {
		expect(
			findMatchedTargetEntities(
				"Source: https://example.com/aloom-monitor-review",
				["Aloom Monitor"],
			),
		).toEqual([]);
	});
});
