import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
	"postgresql://postgres:postgres@127.0.0.1:5432/aloom";

const { evaluatePromptRelevance, getProfileCompleteness } = await import(
	"./promptLibrary.js"
);

function profile(overrides: Record<string, unknown> = {}) {
	return {
		id: "profile-id",
		workspaceId: "workspace-id",
		brandName: "Aloom",
		officialDomain: "aloom.example",
		aliases: ["Answer Loom"],
		products: ["Aloom Monitor"],
		category: "GEO monitoring software",
		industry: "B2B software",
		market: "enterprise software",
		audiences: ["growth teams"],
		competitors: ["Competitor Atlas"],
		regions: ["APAC"],
		locales: ["en-US"],
		budget: null,
		teamSize: null,
		implementationPeriod: null,
		evidenceRequirement: null,
		version: 2,
		confirmationStatus: "confirmed",
		confirmedAt: new Date(),
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

describe("brand profile gates and custom prompt relevance", () => {
	it("requires every formal baseline identity field and confirmation", () => {
		expect(getProfileCompleteness(profile() as never)).toEqual({
			complete: true,
			confirmed: true,
			missing: [],
		});
		expect(
			getProfileCompleteness(
				profile({ products: [], competitors: [], confirmationStatus: "draft" }) as never,
			),
		).toEqual({
			complete: false,
			confirmed: false,
			missing: ["products", "competitors"],
		});
	});

	it("requires aided prompts to name the brand, alias, or product", () => {
		expect(
			evaluatePromptRelevance({
				prompt: "How does Aloom Monitor compare with alternatives?",
				brandExposure: "aided",
				profile: profile() as never,
			}).status,
		).toBe("relevant");
		expect(
			evaluatePromptRelevance({
				prompt: "What is the best CRM?",
				brandExposure: "aided",
				profile: profile() as never,
			}).status,
		).toBe("unrelated");
	});

	it("flags blind prompts without confirmed category context", () => {
		expect(
			evaluatePromptRelevance({
				prompt: "Which GEO monitoring software works for APAC growth teams?",
				brandExposure: "blind",
				profile: profile() as never,
			}).status,
		).toBe("relevant");
		expect(
			evaluatePromptRelevance({
				prompt: "Which accounting package is easiest to deploy?",
				brandExposure: "blind",
				profile: profile() as never,
			}).status,
		).toBe("needs_confirmation");
	});
});
