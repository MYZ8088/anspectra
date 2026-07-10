import { describe, expect, it } from "vitest";
import {
	buildMatchedPromptCohorts,
	calculateDifferenceInDifferences,
} from "./experimentCohorts.js";

const prompts = [
	{
		id: "aided-zh",
		promptGroup: "comparison",
		decisionStage: "evaluation",
		locale: "zh-CN",
		brandExposure: "aided",
		cohort: "treatment",
	},
	{
		id: "blind-zh",
		promptGroup: "comparison",
		decisionStage: "evaluation",
		locale: "zh-CN",
		brandExposure: "blind",
		cohort: "control",
	},
	{
		id: "blind-en",
		promptGroup: "comparison",
		decisionStage: "evaluation",
		locale: "en-US",
		brandExposure: "blind",
		cohort: "control",
	},
	{
		id: "blind-risk",
		promptGroup: "risk",
		decisionStage: "evaluation",
		locale: "zh-CN",
		brandExposure: "blind",
		cohort: "control",
	},
];

describe("buildMatchedPromptCohorts", () => {
	it("matches control prompts by intent, stage, and locale", () => {
		const result = buildMatchedPromptCohorts(prompts, ["aided-zh"]);
		expect(result.treatment.map((prompt) => prompt.id)).toEqual(["aided-zh"]);
		expect(result.control.map((prompt) => prompt.id)).toEqual(["blind-zh"]);
	});

	it("falls back to aided measurement prompts when an opportunity has no prompt cluster", () => {
		const result = buildMatchedPromptCohorts(prompts, []);
		expect(result.treatment.map((prompt) => prompt.id)).toEqual(["aided-zh"]);
	});

	it("refuses to calculate DiD without a real control denominator", () => {
		expect(
			calculateDifferenceInDifferences({
				baselineTreatment: { mentionRate: 20, denominator: 10 },
				baselineControl: { mentionRate: 0, denominator: 0 },
				afterTreatment: { mentionRate: 40, denominator: 10 },
				afterControl: { mentionRate: 0, denominator: 0 },
			}),
		).toBeNull();
	});
});
