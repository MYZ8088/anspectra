import { db, schema } from "@aloom/db";
import { NotFoundError, ValidationError } from "@aloom/errors";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "../env.js";
import { aihubmix } from "../llm/index.js";
import {
	type StructuredOutputResult,
	createOpenAiCompatibleGenerator,
	generateStructuredOutput,
} from "../llm/structuredOutput.js";

const ClaimMapEntrySchema = z.object({
	claim: z.string().min(1),
	factIds: z.array(z.string()).default([]),
	evidenceGrade: z.enum(["A", "B", "C", "D"]).nullable().default(null),
	status: z.enum(["verified", "evidence_gap"]).default("evidence_gap"),
	sourceUrls: z.array(z.string()).default([]),
});

const ContentDraftSchema = z.object({
	title: z.string().min(3),
	directAnswer: z.string().min(20),
	structuredSummary: z.string().min(20),
	markdown: z.string().min(100),
	html: z.string().default(""),
	jsonLd: z.record(z.unknown()).nullable().default(null),
	factIds: z.array(z.string()).default([]),
	claimMap: z.array(ClaimMapEntrySchema).default([]),
	atomicFacts: z
		.array(
			z.object({
				fact: z.string(),
				sourceUrl: z.string().optional(),
				status: z.string(),
			}),
		)
		.default([]),
	evidenceGaps: z.array(z.string()).default([]),
	faq: z
		.array(z.object({ question: z.string(), answer: z.string() }))
		.default([]),
	qualityReport: z.record(z.unknown()).default({}),
});

type ContentDraft = z.infer<typeof ContentDraftSchema>;
type BrandFact = typeof schema.brandFacts.$inferSelect;
type ContentRevision = typeof schema.contentRevisions.$inferSelect;

const SENSITIVE_CLAIM_PATTERN =
	/(价格|售价|费用|折扣|客户|案例|认证|资质|排名|第一|领先|提升|增长|降低|节省|效果|准确率|转化率|price|pricing|cost|customer|case study|certif|rank|#1|leading|increase|growth|reduce|save|accuracy|conversion)/i;
const UNFAIR_COMPARISON_PATTERN =
	/(垃圾|骗局|一无是处|完全不如|必然失败|scam|worthless|always worse|objectively inferior)/i;

export type ContentQualityGate = {
	key: string;
	status: "pass" | "warn" | "fail";
	message: string;
};

export type ContentQualityReport = {
	passed: boolean;
	blockingFailures: number;
	verifiedFactCount: number;
	evidenceGapCount: number;
	gates: ContentQualityGate[];
	checkedAt: string;
};

async function generateContentJson(
	prompt: string,
): Promise<StructuredOutputResult<ContentDraft>> {
	const models = [
		env.AIHUBMIX_ANALYSIS_MODEL,
		env.AIHUBMIX_ANALYSIS_FALLBACK_MODEL,
	]
		.map((model) => model.trim())
		.filter((model, index, values) => model && values.indexOf(model) === index);
	const generators = models.map((model) =>
		createOpenAiCompatibleGenerator({
			client: aihubmix,
			provider: "AIHubMix",
			model,
			maxTokens: 8192,
			timeoutMs: 180_000,
		}),
	);
	return generateStructuredOutput({
		schema: ContentDraftSchema,
		schemaName: "geo_content_draft",
		systemPrompt:
			"You are a conservative GEO content editor. Use only supplied verified facts. Return one content draft matching the required schema. Never invent prices, customers, certifications, rankings, case studies, metrics, or outcomes. Unsupported material belongs only in evidenceGaps and must not appear in markdown, HTML, FAQ, or JSON-LD. Comparisons must state genuine competitor strengths without unsupported disparagement.",
		userPrompt: prompt,
		generators,
		repairGenerator: generators.at(-1),
		repairInstructions:
			"Do not add publishable claims while repairing. Any unsupported material must remain only in evidenceGaps.",
		errorMessage: "Content model returned invalid structured JSON",
	});
}

function eligibleFact(fact: BrandFact, now = new Date()) {
	return (
		fact.status === "verified" &&
		(!fact.validUntil || fact.validUntil.getTime() >= now.getTime())
	);
}

function collectJsonLdStrings(value: unknown): string[] {
	if (typeof value === "string") return value.trim() ? [value.trim()] : [];
	if (Array.isArray(value)) return value.flatMap(collectJsonLdStrings);
	if (value && typeof value === "object") {
		return Object.values(value as Record<string, unknown>).flatMap(
			collectJsonLdStrings,
		);
	}
	return [];
}

export function buildContentQualityReport(args: {
	revision: Pick<
		ContentRevision,
		| "markdown"
		| "html"
		| "jsonLd"
		| "factIds"
		| "claimMap"
		| "atomicFacts"
		| "evidenceGaps"
		| "faq"
		| "directAnswer"
		| "structuredSummary"
	>;
	facts: BrandFact[];
	now?: Date;
}): ContentQualityReport {
	const now = args.now ?? new Date();
	const factsById = new Map(args.facts.map((fact) => [fact.id, fact]));
	const referencedFacts = (args.revision.factIds ?? []).flatMap((id) => {
		const fact = factsById.get(id);
		return fact ? [fact] : [];
	});
	const validFacts = referencedFacts.filter((fact) => eligibleFact(fact, now));
	const invalidFactIds = (args.revision.factIds ?? []).filter((id) => {
		const fact = factsById.get(id);
		return !fact || !eligibleFact(fact, now);
	});
	const claimMap = args.revision.claimMap ?? [];
	const unsupportedMappedClaims = claimMap.filter((entry) => {
		const factIds = Array.isArray(entry.factIds)
			? entry.factIds.filter((id): id is string => typeof id === "string")
			: [];
		return (
			entry.status !== "verified" ||
			factIds.length === 0 ||
			factIds.some((id) => {
				const fact = factsById.get(id);
				return !fact || !eligibleFact(fact, now);
			})
		);
	});
	const sensitiveLines = args.revision.markdown
		.split(/\n|(?<=[。！？.!?])\s*/u)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && SENSITIVE_CLAIM_PATTERN.test(line));
	const verifiedSensitiveClaims = claimMap.filter(
		(entry) =>
			entry.status === "verified" &&
			SENSITIVE_CLAIM_PATTERN.test(String(entry.claim ?? "")),
	);
	const jsonLdOnlyValues = collectJsonLdStrings(args.revision.jsonLd).filter(
		(value) => value.length >= 12 && !args.revision.markdown.includes(value),
	);
	const gates: ContentQualityGate[] = [
		{
			key: "direct_answer",
			status:
				(args.revision.directAnswer?.trim().length ?? 0) >= 20
					? "pass"
					: "fail",
			message: "Direct answer is present and substantial.",
		},
		{
			key: "structured_summary",
			status:
				(args.revision.structuredSummary?.trim().length ?? 0) >= 20
					? "pass"
					: "fail",
			message: "Structured summary is present and substantial.",
		},
		{
			key: "fact_references",
			status: invalidFactIds.length === 0 ? "pass" : "fail",
			message:
				invalidFactIds.length === 0
					? `${validFacts.length} referenced facts are verified and current.`
					: `${invalidFactIds.length} referenced facts are missing, unverified, or expired.`,
		},
		{
			key: "claim_mapping",
			status: unsupportedMappedClaims.length === 0 ? "pass" : "fail",
			message:
				unsupportedMappedClaims.length === 0
					? "Every published claim maps to current verified facts."
					: `${unsupportedMappedClaims.length} claim mappings lack current verified facts.`,
		},
		{
			key: "sensitive_claims",
			status:
				sensitiveLines.length === 0 || verifiedSensitiveClaims.length > 0
					? "pass"
					: "fail",
			message:
				sensitiveLines.length === 0
					? "No sensitive commercial or performance claims detected."
					: `${sensitiveLines.length} sensitive claim lines require verified claim mappings.`,
		},
		{
			key: "json_ld_parity",
			status: jsonLdOnlyValues.length === 0 ? "pass" : "fail",
			message:
				jsonLdOnlyValues.length === 0
					? "JSON-LD does not add material claims absent from the article."
					: `${jsonLdOnlyValues.length} JSON-LD values are not visible in the article.`,
		},
		{
			key: "comparison_fairness",
			status: UNFAIR_COMPARISON_PATTERN.test(args.revision.markdown)
				? "fail"
				: "pass",
			message:
				"Comparison language avoids unsupported competitor disparagement.",
		},
		{
			key: "faq",
			status: (args.revision.faq?.length ?? 0) > 0 ? "pass" : "warn",
			message: "FAQ coverage supports extractable follow-up answers.",
		},
		{
			key: "evidence_gaps",
			status: (args.revision.evidenceGaps?.length ?? 0) > 0 ? "warn" : "pass",
			message:
				(args.revision.evidenceGaps?.length ?? 0) > 0
					? "Evidence gaps remain recorded outside the publishable body."
					: "No unresolved evidence gaps were reported.",
		},
	];
	const blockingFailures = gates.filter(
		(gate) => gate.status === "fail",
	).length;
	return {
		passed: blockingFailures === 0,
		blockingFailures,
		verifiedFactCount: validFacts.length,
		evidenceGapCount: args.revision.evidenceGaps?.length ?? 0,
		gates,
		checkedAt: now.toISOString(),
	};
}

function normalizeGeneratedDraft(generated: ContentDraft, facts: BrandFact[]) {
	const factsById = new Map(facts.map((fact) => [fact.id, fact]));
	const factIds = dedupe(
		generated.factIds.filter((id) => {
			const fact = factsById.get(id);
			return fact && eligibleFact(fact);
		}),
	);
	const claimMap = generated.claimMap.map((entry) => {
		const eligibleIds = dedupe(
			entry.factIds.filter((id) => {
				const fact = factsById.get(id);
				return fact && eligibleFact(fact);
			}),
		);
		const sourceUrls = dedupe(
			eligibleIds.flatMap((id) => {
				const url = factsById.get(id)?.sourceUrl;
				return url ? [url] : [];
			}),
		);
		return {
			...entry,
			factIds: eligibleIds,
			sourceUrls,
			status:
				eligibleIds.length > 0
					? ("verified" as const)
					: ("evidence_gap" as const),
		};
	});
	const evidenceGaps = dedupe([
		...generated.evidenceGaps,
		...claimMap
			.filter((entry) => entry.status === "evidence_gap")
			.map((entry) => entry.claim),
	]);
	return { ...generated, factIds, claimMap, evidenceGaps };
}

function dedupe<T>(values: T[]): T[] {
	return [...new Set(values)];
}

export async function createContentDraft(args: {
	workspaceId: string;
	opportunityId: string;
	kind: string;
	sourceContent?: string;
	createdBy?: string;
}) {
	const [opportunity, facts] = await Promise.all([
		db.query.opportunities.findFirst({
			where: and(
				eq(schema.opportunities.id, args.opportunityId),
				eq(schema.opportunities.workspaceId, args.workspaceId),
			),
		}),
		db.query.brandFacts.findMany({
			where: eq(schema.brandFacts.workspaceId, args.workspaceId),
		}),
	]);
	if (!opportunity) throw new NotFoundError("GEO opportunity not found");
	const verifiedFacts = facts.filter((fact) => eligibleFact(fact));
	const factLedger = verifiedFacts.map((fact) => ({
		id: fact.id,
		fact: `${fact.subject} — ${fact.predicate}: ${fact.value}`,
		sourceUrl: fact.sourceUrl,
		sourceType: fact.sourceType,
		evidenceGrade: fact.evidenceGrade,
		region: fact.region,
		validUntil: fact.validUntil,
		supportedClaims: fact.supportedClaims,
	}));
	const prohibitedFacts = facts
		.filter((fact) => !eligibleFact(fact))
		.map((fact) => `${fact.subject} — ${fact.predicate}: ${fact.value}`);
	const generation = await generateContentJson(
		JSON.stringify({
			opportunity: {
				type: opportunity.type,
				title: opportunity.title,
				description: opportunity.description,
				reason: opportunity.reason,
				acceptanceMetric: opportunity.acceptanceMetric,
				retestScope: opportunity.retestScope,
			},
			kind: args.kind,
			sourceContent: args.sourceContent ?? "",
			verifiedFactLedger: factLedger,
			prohibitedUnverifiedOrExpiredFacts: prohibitedFacts,
			twelveAspectAnalysis: [
				"intent fit",
				"direct answer",
				"information architecture",
				"entity clarity",
				"atomic facts",
				"source quality",
				"claim support",
				"comparison fairness",
				"risk boundaries",
				"extractability",
				"freshness",
				"actionability",
			],
			eightGeoDimensions: [
				"relevance",
				"clarity",
				"authority",
				"evidence",
				"structure",
				"entity coverage",
				"citation readiness",
				"technical extractability",
			],
			requirements: [
				"Lead with a direct answer and a concise structured summary.",
				"Use semantic headings, atomic facts, comparison tables or steps where useful.",
				"Put unsupported claims only in evidenceGaps; exclude them from all publishable fields.",
				"JSON-LD may contain only facts visible in markdown and mapped to verified fact IDs.",
				"For comparisons, state genuine competitor strengths and do not use unsupported disparagement.",
			],
		}),
	);
	const generated = normalizeGeneratedDraft(generation.data, verifiedFacts);
	const draftRevision = {
		markdown: generated.markdown,
		html: generated.html,
		jsonLd: generated.jsonLd,
		factIds: generated.factIds,
		claimMap: generated.claimMap,
		atomicFacts: generated.atomicFacts,
		evidenceGaps: generated.evidenceGaps,
		faq: generated.faq,
		directAnswer: generated.directAnswer,
		structuredSummary: generated.structuredSummary,
	};
	const qualityReport = buildContentQualityReport({
		revision: draftRevision,
		facts,
	});

	return db.transaction(async (tx) => {
		const [asset] = await tx
			.insert(schema.contentAssets)
			.values({
				workspaceId: args.workspaceId,
				opportunityId: opportunity.id,
				kind: args.kind,
				title: generated.title,
				targetUrl: null,
			})
			.returning();
		if (!asset) throw new Error("Failed to create content asset");
		const [revision] = await tx
			.insert(schema.contentRevisions)
			.values({
				assetId: asset.id,
				version: 1,
				sourceContent: args.sourceContent ?? null,
				...draftRevision,
				qualityReport,
				model: generation.model,
				templateVersion: "aloom-12x8-content-refiner-v1",
				createdBy: args.createdBy ?? null,
			})
			.returning();
		return { asset, revision, qualityReport };
	});
}

async function loadRevisionContext(args: {
	workspaceId: string;
	revisionId: string;
}) {
	const revision = await db.query.contentRevisions.findFirst({
		where: eq(schema.contentRevisions.id, args.revisionId),
	});
	const asset = revision
		? await db.query.contentAssets.findFirst({
				where: and(
					eq(schema.contentAssets.id, revision.assetId),
					eq(schema.contentAssets.workspaceId, args.workspaceId),
				),
			})
		: null;
	if (!revision || !asset)
		throw new NotFoundError("Content revision not found");
	const facts = await db.query.brandFacts.findMany({
		where: eq(schema.brandFacts.workspaceId, args.workspaceId),
	});
	return { revision, asset, facts };
}

export async function validateContentRevision(args: {
	workspaceId: string;
	revisionId: string;
}) {
	const context = await loadRevisionContext(args);
	const report = buildContentQualityReport({
		revision: context.revision,
		facts: context.facts,
	});
	await db
		.update(schema.contentRevisions)
		.set({ qualityReport: report, updatedAt: new Date() })
		.where(eq(schema.contentRevisions.id, context.revision.id));
	return report;
}

export async function approveContentRevision(args: {
	workspaceId: string;
	revisionId: string;
}) {
	const context = await loadRevisionContext(args);
	const qualityReport = buildContentQualityReport({
		revision: context.revision,
		facts: context.facts,
	});
	if (!qualityReport.passed) {
		throw new ValidationError(
			"Content quality gates must pass before approval",
			{ qualityReport },
		);
	}
	await db.transaction(async (tx) => {
		await tx
			.update(schema.contentRevisions)
			.set({ status: "approved", qualityReport, updatedAt: new Date() })
			.where(eq(schema.contentRevisions.id, context.revision.id));
		await tx
			.update(schema.contentAssets)
			.set({ status: "approved", updatedAt: new Date() })
			.where(eq(schema.contentAssets.id, context.revision.assetId));
	});
	return { approved: true, qualityReport };
}

export async function reviseContentAsset(args: {
	workspaceId: string;
	revisionId: string;
	markdown: string;
	createdBy?: string;
}) {
	if (args.markdown.trim().length < 100) {
		throw new ValidationError(
			"Content revision must contain at least 100 characters",
		);
	}
	const context = await loadRevisionContext(args);
	if (context.revision.markdown.trim() === args.markdown.trim())
		return { asset: context.asset, revision: context.revision };
	return db.transaction(async (tx) => {
		const [nextRevision] = await tx
			.insert(schema.contentRevisions)
			.values({
				assetId: context.asset.id,
				version: context.revision.version + 1,
				status: "draft",
				sourceContent: context.revision.markdown,
				markdown: args.markdown.trim(),
				html: null,
				jsonLd: context.revision.jsonLd,
				factIds: context.revision.factIds,
				atomicFacts: context.revision.atomicFacts,
				evidenceGaps: context.revision.evidenceGaps,
				faq: context.revision.faq,
				directAnswer: context.revision.directAnswer,
				structuredSummary: context.revision.structuredSummary,
				claimMap: context.revision.claimMap,
				qualityReport: {
					passed: false,
					blockingFailures: 1,
					gates: [
						{
							key: "human_edit",
							status: "fail",
							message: "Run validation after editing.",
						},
					],
				},
				model: "human",
				templateVersion: "human-edit-v1",
				createdBy: args.createdBy ?? null,
			})
			.returning();
		await tx
			.update(schema.contentAssets)
			.set({ status: "draft", updatedAt: new Date() })
			.where(eq(schema.contentAssets.id, context.asset.id));
		return { asset: context.asset, revision: nextRevision };
	});
}

export async function listWorkspaceContent(workspaceId: string) {
	const assets = await db.query.contentAssets.findMany({
		where: eq(schema.contentAssets.workspaceId, workspaceId),
		orderBy: [desc(schema.contentAssets.createdAt)],
	});
	const revisions = await db.query.contentRevisions.findMany({
		orderBy: [desc(schema.contentRevisions.version)],
	});
	return assets.map((asset) => ({
		...asset,
		revisions: revisions.filter((revision) => revision.assetId === asset.id),
	}));
}
