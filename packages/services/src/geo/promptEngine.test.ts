import { describe, expect, it } from "vitest";
import {
	GEO_DECISION_STAGES,
	GEO_PROMPT_GROUPS,
	generateMonitorPrompts,
	getYaoPresetPack,
	planMonitorPrompts,
} from "./promptEngine.js";

const profile = {
	brandName: "PostHog",
	category: "product analytics tools",
	competitors: ["Mixpanel", "Amplitude"],
	audiences: ["B2B SaaS teams"],
	locale: "zh-CN",
};

describe("Yao Full GEO Pack", () => {
	it.each(["zh-CN", "en-US"])(
		"ships all 54 intent-stage cells for %s",
		(locale) => {
			const pack = getYaoPresetPack(locale);
			expect(pack.version).toBe("1.1.0");
			expect(pack.entries).toHaveLength(54);
			expect(new Set(pack.entries.map((entry) => entry.key))).toHaveLength(54);
			expect(
				new Set(pack.entries.map((entry) => `${entry.intent}:${entry.stage}`)),
			).toHaveLength(54);
			expect(new Set(pack.entries.map((entry) => entry.intent))).toEqual(
				new Set(GEO_PROMPT_GROUPS),
			);
			expect(new Set(pack.entries.map((entry) => entry.stage))).toEqual(
				new Set(GEO_DECISION_STAGES),
			);
		},
	);

	it.each(["zh-CN", "en-US"])(
		"resolves every v1.1 variable without vague required-field fallbacks for %s",
		(locale) => {
			const plan = planMonitorPrompts(
				{
					brandName: "AnswerLoom",
					category: "GEO monitoring software",
					industry: "B2B software",
					products: ["AnswerLoom Monitor"],
					competitors: ["Competitor Atlas"],
					audiences: ["growth teams"],
					regions: ["APAC"],
					market: "enterprise software",
					budget: "USD 5,000-10,000 per year",
					teamSize: "20-50 people",
					implementationPeriod: "six weeks",
					evidenceRequirement:
						"cite dated official or independently verifiable sources",
					locale,
				},
				"standard",
			);
			expect(plan.prompts).toHaveLength(54);
		for (const item of plan.prompts) {
			expect(item.prompt).not.toMatch(/\{[a-zA-Z]+\}/);
			expect(item.prompt).not.toMatch(
				/同类产品|企业团队|其他主流方案|products in this category|business teams|a leading alternative/i,
			);
		}
		},
	);

	it.each([
		["quick", 18],
		["standard", 54],
		["deep", 54],
	] as const)("creates the %s tier with %s core prompts", (tier, count) => {
		const plan = planMonitorPrompts(profile, tier);
		expect(plan.manifest.corePromptCount).toBe(count);
		expect(plan.prompts).toHaveLength(count);
		expect(new Set(plan.prompts.map((prompt) => prompt.promptHash))).toHaveLength(
			count,
		);
		expect(plan.manifest.complete).toBe(true);
	});

	it("keeps the five rewrite fields separate from the sampled question", () => {
		const [prompt] = generateMonitorPrompts(profile, "quick");
		expect(prompt?.rewrites.standaloneQuestion).toBe(prompt?.prompt);
		expect(prompt?.rewrites.evidenceQuery).toContain("PostHog");
		expect(prompt?.rewrites.retrievalQuery).not.toBe(prompt?.prompt);
	});

	it.each(["zh-CN", "en-US"])(
		"avoids repeating the brand when the product has the same name for %s",
		(locale) => {
			const plan = planMonitorPrompts(
				{
					brandName: "PostHog",
					products: ["PostHog"],
					category: "product analytics software",
					industry: "B2B SaaS",
					competitors: ["Mixpanel"],
					audiences: ["product teams"],
					regions: ["APAC"],
					budget: "no fixed budget",
					teamSize: "20-50 people",
					implementationPeriod: "six weeks",
					locale,
				},
				"standard",
			);
			const sampled = plan.prompts.map((prompt) => prompt.prompt).join("\n");
			expect(sampled).not.toMatch(/PostHog的PostHog|PostHog's PostHog/i);
			expect(plan.manifest.coverage.products).toContain("PostHog");
		},
	);

	it("adds only deterministic prompts needed to close entity coverage gaps", () => {
		const largeProfile = {
			...profile,
			products: Array.from({ length: 8 }, (_, index) => `Product ${index + 1}`),
			competitors: Array.from(
				{ length: 8 },
				(_, index) => `Competitor ${index + 1}`,
			),
			audiences: Array.from(
				{ length: 13 },
				(_, index) => `Audience ${index + 1}`,
			),
			regions: Array.from({ length: 7 }, (_, index) => `Region ${index + 1}`),
		};
		const first = planMonitorPrompts(largeProfile, "standard");
		const second = planMonitorPrompts(largeProfile, "standard");
		expect(first.prompts.length).toBeGreaterThan(54);
		expect(first.manifest.complete).toBe(true);
		expect(first.manifest.missing).toEqual({
			productsInValidation: [],
			productsInDecision: [],
			competitorsInComparison: [],
			competitorsInAlternative: [],
			audiences: [],
			regions: [],
		});
		expect(first.manifest.expectedPromptHashes).toEqual(
			second.manifest.expectedPromptHashes,
		);
	});
});
