import { describe, expect, it } from "vitest";
import { parseAnalysisOutput } from "./runAnalysis.js";

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

	it("rejects incomplete or truncated JSON", () => {
		expect(() => parseAnalysisOutput('{"geoScore":{"overall":72}')).toThrow(
			"Invalid JSON returned",
		);
	});
});
