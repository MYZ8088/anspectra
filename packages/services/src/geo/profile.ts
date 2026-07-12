import { db, schema } from "@aloom/db";
import { ValidationError } from "@aloom/errors";
import { desc, eq } from "drizzle-orm";
import type { GeoDetectionTier } from "./promptEngine.js";
import {
	getProfileCompleteness,
	instantiatePresetPack,
} from "./promptLibrary.js";
import { auditWorkspaceSite } from "./siteAudit.js";

export type SaveBrandProfileInput = {
	workspaceId: string;
	brandName: string;
	officialDomain: string;
	aliases?: string[];
	products?: string[];
	category?: string;
	industry?: string;
	market?: string;
	audiences?: string[];
	competitors?: string[];
	regions?: string[];
	locales?: string[];
	budget?: string;
	teamSize?: string;
	implementationPeriod?: string;
	evidenceRequirement?: string;
};

export async function saveBrandProfile(input: SaveBrandProfileInput) {
	const existing = await getBrandProfile(input.workspaceId);
	const values = {
		workspaceId: input.workspaceId,
		brandName: input.brandName,
		officialDomain: input.officialDomain,
		aliases: input.aliases ?? [],
		products: input.products ?? [],
		category: input.category ?? null,
		industry: input.industry ?? null,
		market: input.market ?? null,
		audiences: input.audiences ?? [],
		competitors: input.competitors ?? [],
		regions: input.regions ?? [],
		locales: input.locales?.length ? input.locales : ["zh-CN"],
		budget: input.budget ?? null,
		teamSize: input.teamSize ?? null,
		implementationPeriod: input.implementationPeriod ?? null,
		evidenceRequirement: input.evidenceRequirement ?? null,
		version: (existing?.version ?? 0) + 1,
		confirmationStatus: "draft",
		confirmedAt: null,
		updatedAt: new Date(),
	};
	const [profile] = await db
		.insert(schema.brandProfiles)
		.values(values)
		.onConflictDoUpdate({
			target: schema.brandProfiles.workspaceId,
			set: values,
		})
		.returning();
	return profile;
}

export async function getBrandProfile(workspaceId: string) {
	return (
		(await db.query.brandProfiles.findFirst({
			where: eq(schema.brandProfiles.workspaceId, workspaceId),
		})) ?? null
	);
}

export async function confirmBrandProfile(workspaceId: string) {
	const profile = await getBrandProfile(workspaceId);
	if (!profile) throw new ValidationError("Create the brand profile first");
	const completeness = getProfileCompleteness(profile);
	if (!completeness.complete) {
		throw new ValidationError(
			`Complete the required brand fields: ${completeness.missing.join(", ")}`,
		);
	}
	const confirmedAt = new Date();
	const [confirmed] = await db
		.update(schema.brandProfiles)
		.set({
			confirmationStatus: "confirmed",
			confirmedAt,
			updatedAt: confirmedAt,
		})
		.where(eq(schema.brandProfiles.workspaceId, workspaceId))
		.returning();
	return {
		profile: confirmed,
		completeness: confirmed
			? getProfileCompleteness(confirmed)
			: completeness,
	};
}

function collectJsonLdEntities(value: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(value)) return value.flatMap(collectJsonLdEntities);
	if (!value || typeof value !== "object") return [];
	const record = value as Record<string, unknown>;
	const graph = collectJsonLdEntities(record["@graph"]);
	return [record, ...graph];
}

function cleanCandidate(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
	return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

export async function suggestProfileFromSite(args: {
	workspaceId: string;
	domain: string;
	maxPages?: number;
}) {
	const audit = await auditWorkspaceSite({
		workspaceId: args.workspaceId,
		domain: args.domain,
		maxPages: args.maxPages ?? 12,
	});
	const [existing, pages] = await Promise.all([
		getBrandProfile(args.workspaceId),
		db.query.sitePages.findMany({
			where: eq(schema.sitePages.workspaceId, args.workspaceId),
			orderBy: [desc(schema.sitePages.lastCrawledAt)],
		}),
	]);
	const entities = pages.flatMap((page) => {
		const jsonLd = Array.isArray(page.snapshot?.jsonLd)
			? page.snapshot.jsonLd
			: [];
		return jsonLd.flatMap(collectJsonLdEntities);
	});
	const organizationTypes = new Set([
		"Organization",
		"Corporation",
		"SoftwareApplication",
		"WebApplication",
	]);
	const productTypes = new Set([
		"Product",
		"SoftwareApplication",
		"WebApplication",
		"Service",
	]);
	const typeOf = (entity: Record<string, unknown>) =>
		Array.isArray(entity["@type"])
			? entity["@type"].map(String)
			: [String(entity["@type"] ?? "")];
	const brandNames = entities
		.filter((entity) => typeOf(entity).some((type) => organizationTypes.has(type)))
		.map((entity) => cleanCandidate(entity.name));
	const productNames = entities
		.filter((entity) => typeOf(entity).some((type) => productTypes.has(type)))
		.map((entity) => cleanCandidate(entity.name));
	const titleCandidates = pages
		.map((page) => page.title?.split(/[|\-–—]/u)[0]?.trim())
		.filter(Boolean);
	const hostname = new URL(
		/^https?:\/\//i.test(args.domain) ? args.domain : `https://${args.domain}`,
	).hostname;
	const brandName =
		existing?.brandName ||
		uniqueStrings([...brandNames, ...titleCandidates])[0] ||
		hostname.replace(/^www\./, "").split(".")[0] ||
		hostname;
	return {
		audit,
		candidate: {
			brandName,
			officialDomain: existing?.officialDomain || hostname,
			aliases: existing?.aliases ?? [],
			products: uniqueStrings([
				...(existing?.products ?? []),
				...productNames,
			]).filter((name) => name !== brandName),
			category: existing?.category ?? null,
			industry: existing?.industry ?? null,
			market: existing?.market ?? null,
			audiences: existing?.audiences ?? [],
			competitors: existing?.competitors ?? [],
			regions: existing?.regions ?? [],
			locales: existing?.locales?.length ? existing.locales : ["zh-CN"],
			budget: existing?.budget ?? null,
			teamSize: existing?.teamSize ?? null,
			implementationPeriod: existing?.implementationPeriod ?? null,
			evidenceRequirement: existing?.evidenceRequirement ?? null,
		},
		sources: pages.slice(0, 12).map((page) => ({
			url: page.url,
			title: page.title,
			contentHash: page.contentHash,
		})),
		requiresConfirmation: true,
	};
}

export async function createGeneratedPromptSet(args: {
	workspaceId: string;
	brandName: string;
	tier: GeoDetectionTier;
	locale?: string;
}) {
	const profile = await getBrandProfile(args.workspaceId);
	return instantiatePresetPack({
		workspaceId: args.workspaceId,
		tier: args.tier,
		locales: args.locale ? [args.locale] : (profile?.locales ?? ["zh-CN"]),
		name: `${args.brandName} ${args.tier} Yao GEO baseline`,
	});
}

export async function listWorkspacePromptSets(workspaceId: string) {
	const [sets, prompts] = await Promise.all([
		db.query.promptSets.findMany({
			where: eq(schema.promptSets.workspaceId, workspaceId),
			orderBy: [desc(schema.promptSets.createdAt)],
		}),
		db.query.monitorPrompts.findMany({
			where: eq(schema.monitorPrompts.workspaceId, workspaceId),
		}),
	]);
	return sets.map((set) => ({
		...set,
		prompts: prompts.filter((prompt) => prompt.promptSetId === set.id),
	}));
}

export async function createBrandFact(args: {
	workspaceId: string;
	subject: string;
	predicate: string;
	value: string;
	sourceUrl?: string;
	sourceType?: string;
	evidenceGrade?: "A" | "B" | "C" | "D";
	status?: "verified" | "unverified" | "rejected";
	retrievedAt?: Date;
	region?: string;
	validUntil?: Date;
	supportedClaims?: string[];
	confidence?: number;
}) {
	const status = args.status ?? (args.sourceUrl ? "verified" : "unverified");
	if (status === "verified" && !args.sourceUrl) {
		throw new Error("Verified facts require a source URL");
	}
	const [fact] = await db
		.insert(schema.brandFacts)
		.values({
			workspaceId: args.workspaceId,
			subject: args.subject,
			predicate: args.predicate,
			value: args.value,
			sourceUrl: args.sourceUrl ?? null,
			sourceType: args.sourceType ?? null,
			evidenceGrade: args.evidenceGrade ?? null,
			retrievedAt: args.retrievedAt ?? (args.sourceUrl ? new Date() : null),
			region: args.region ?? null,
			validUntil: args.validUntil ?? null,
			supportedClaims: args.supportedClaims ?? [],
			confidence: args.confidence ?? 70,
			status,
			verifiedAt: status === "verified" ? new Date() : null,
		})
		.returning();
	return fact;
}
