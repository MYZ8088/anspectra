import {
	GEO_WEB_PROVIDERS,
	approveContentRevision,
	archiveWorkspacePrompt,
	auditWorkspaceSite,
	classifyCustomPromptDimensions,
	confirmBrandProfile,
	createBrandFact,
	createContentDraft,
	createGeneratedPromptSet,
	createRetestExperiment,
	getBaselineScorecard,
	getBrandProfile,
	getCamoufoxDiagnostics,
	getExperimentResults,
	getGeoOverview,
	getGeoRunDetail,
	getLatestFormalBaselineScorecard,
	getPromptLibraryTaxonomy,
	importCustomPrompts,
	instantiatePresetPack,
	listCollectorNodes,
	listExternalEvidenceTasks,
	listGeoRuns,
	listOpenHumanChallenges,
	listPublishedInterventions,
	listPublisherConnections,
	listRetestExperiments,
	listWorkspaceContent,
	listWorkspaceFacts,
	listWorkspaceOpportunities,
	listWorkspacePromptLibrary,
	listWorkspacePromptLibraryV2,
	listWorkspacePromptSets,
	listWorkspaceSitePages,
	pairCollectorNode,
	previewPresetPack,
	publishApprovedRevision,
	refreshWorkspaceOpportunities,
	requestHumanChallengeWindow,
	resumeHumanChallenge,
	retryGeoSamples,
	reviseContentAsset,
	reviseCustomPrompt,
	rollbackPublishedIntervention,
	saveBrandProfile,
	savePublisherConnection,
	startGeoCollectionRun,
	suggestProfileFromSite,
	migrateLegacyPrompts,
	runProviderSmoke,
	validateContentRevision,
} from "@answerloom/services";
import { GEO_DECISION_STAGE_LIST, GEO_INTENT_LIST } from "@answerloom/types";
import { z } from "zod";
import { createRateLimiter } from "../../middleware/rateLimit";
import { authorizedWorkspaceProcedure } from "../../procedures";
import { createTRPCRouter } from "../../trpc";

const optionalStringArray = z.array(z.string().trim().min(1)).default([]);
const publisherConfigSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("wordpress"),
		baseUrl: z.string().url(),
		username: z.string().min(1),
		applicationPassword: z.string().min(1),
	}),
	z.object({
		type: z.literal("geoflow"),
		baseUrl: z.string().url(),
		apiToken: z.string().min(1),
	}),
	z.object({
		type: z.literal("github"),
		owner: z.string().min(1),
		repo: z.string().min(1),
		token: z.string().min(1),
		baseBranch: z.string().min(1).default("main"),
		contentPath: z.string().optional(),
	}),
]);

export const geoRouter = createTRPCRouter({
	overview: authorizedWorkspaceProcedure.query(({ ctx }) =>
		getGeoOverview(ctx.workspaceId),
	),
	scorecard: authorizedWorkspaceProcedure
		.input(z.object({ seriesId: z.string().uuid().optional() }))
		.query(({ ctx, input }) =>
			input.seriesId
				? getBaselineScorecard({
						workspaceId: ctx.workspaceId,
						seriesId: input.seriesId,
					})
				: getLatestFormalBaselineScorecard(ctx.workspaceId),
		),
	collectors: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listCollectorNodes(ctx.workspaceId),
	),
	camoufoxDiagnostics: authorizedWorkspaceProcedure.query(({ ctx }) =>
		getCamoufoxDiagnostics(ctx.workspaceId),
	),
	runProviderSmoke: authorizedWorkspaceProcedure
		.use(createRateLimiter("geo.runProviderSmoke", { limit: 2, windowSecs: 300 }))
		.input(
			z.object({
				providers: z.array(z.enum(GEO_WEB_PROVIDERS)).optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			runProviderSmoke({
				workspaceId: ctx.workspaceId,
				userId: ctx.user.id,
				providers: input.providers,
			}),
		),
	pairCollector: authorizedWorkspaceProcedure
		.input(
			z.object({
				name: z.string().min(1),
				platform: z.enum(["darwin", "win32"]),
			}),
		)
		.mutation(({ ctx, input }) =>
			pairCollectorNode({
				workspaceId: ctx.workspaceId,
				name: input.name,
				platform: input.platform,
			}),
		),
	profile: authorizedWorkspaceProcedure.query(({ ctx }) =>
		getBrandProfile(ctx.workspaceId),
	),
	saveProfile: authorizedWorkspaceProcedure
		.input(
			z.object({
				brandName: z.string().trim().min(1),
				officialDomain: z.string().trim().min(3),
				aliases: optionalStringArray,
				products: optionalStringArray,
				category: z.string().optional(),
				industry: z.string().optional(),
				market: z.string().optional(),
				audiences: optionalStringArray,
				competitors: optionalStringArray,
				regions: optionalStringArray,
				locales: optionalStringArray,
				budget: z.string().optional(),
				teamSize: z.string().optional(),
				implementationPeriod: z.string().optional(),
				evidenceRequirement: z.string().optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			saveBrandProfile({
				workspaceId: ctx.workspaceId,
				brandName: input.brandName,
				officialDomain: input.officialDomain,
				aliases: input.aliases,
				products: input.products,
				category: input.category,
				industry: input.industry,
				market: input.market,
				audiences: input.audiences,
				competitors: input.competitors,
				regions: input.regions,
				locales: input.locales,
				budget: input.budget,
				teamSize: input.teamSize,
				implementationPeriod: input.implementationPeriod,
				evidenceRequirement: input.evidenceRequirement,
			}),
		),
	suggestProfileFromSite: authorizedWorkspaceProcedure
		.use(createRateLimiter("geo.suggestProfileFromSite", { limit: 2, windowSecs: 60 }))
		.input(
			z.object({
				domain: z.string().trim().min(3),
				maxPages: z.number().int().min(1).max(30).default(12),
			}),
		)
		.mutation(({ ctx, input }) =>
			suggestProfileFromSite({
				workspaceId: ctx.workspaceId,
				domain: input.domain,
				maxPages: input.maxPages,
			}),
		),
	confirmBrandProfile: authorizedWorkspaceProcedure.mutation(({ ctx }) =>
		confirmBrandProfile(ctx.workspaceId),
	),
	promptSets: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listWorkspacePromptSets(ctx.workspaceId),
	),
	promptTaxonomy: authorizedWorkspaceProcedure.query(() =>
		getPromptLibraryTaxonomy(),
	),
	promptLibrary: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listWorkspacePromptLibrary(ctx.workspaceId),
	),
	promptLibraryV2: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listWorkspacePromptLibraryV2(ctx.workspaceId),
	),
	migrateLegacyPrompts: authorizedWorkspaceProcedure.mutation(({ ctx }) =>
		migrateLegacyPrompts(ctx.workspaceId),
	),
	classifyCustomPrompts: authorizedWorkspaceProcedure
		.input(
			z.object({
				prompts: z.array(z.string().trim().min(1)).min(1).max(100),
			}),
		)
		.mutation(({ ctx, input }) =>
			classifyCustomPromptDimensions({
				workspaceId: ctx.workspaceId,
				prompts: input.prompts,
			}),
		),
	previewPresetPack: authorizedWorkspaceProcedure
		.input(
			z.object({
				tier: z.enum(["quick", "standard", "deep"]),
				locales: z.array(z.string().min(2)).optional(),
			}),
		)
		.query(({ ctx, input }) =>
			previewPresetPack({
				workspaceId: ctx.workspaceId,
				tier: input.tier,
				locales: input.locales,
			}),
		),
	instantiatePresetPack: authorizedWorkspaceProcedure
		.input(
			z.object({
				tier: z.enum(["quick", "standard", "deep"]),
				locales: z.array(z.string().min(2)).optional(),
				name: z.string().trim().min(1).max(200).optional(),
				customPromptIds: z.array(z.string().uuid()).optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			instantiatePresetPack({
				workspaceId: ctx.workspaceId,
				tier: input.tier,
				locales: input.locales,
				name: input.name,
				customPromptIds: input.customPromptIds,
			}),
		),
	importCustomPrompts: authorizedWorkspaceProcedure
		.input(
			z.object({
				importSource: z.enum(["manual", "csv"]).default("manual"),
				items: z
					.array(
						z.object({
							prompt: z.string().trim().min(1),
							locale: z.string().optional(),
							intent: z.enum(GEO_INTENT_LIST).optional(),
							decisionStage: z.enum(GEO_DECISION_STAGE_LIST).optional(),
							brandExposure: z.enum(["blind", "aided"]).optional(),
							targetProduct: z.string().nullable().optional(),
							targetCompetitor: z.string().nullable().optional(),
							targetAudience: z.string().nullable().optional(),
							targetRegion: z.string().nullable().optional(),
							tags: z.array(z.string().trim().min(1)).optional(),
						}),
					)
					.min(1)
					.max(500),
			}),
		)
		.mutation(({ ctx, input }) =>
			importCustomPrompts({
				workspaceId: ctx.workspaceId,
				items: input.items,
				userId: ctx.user.id,
				importSource: input.importSource,
			}),
		),
	reviseCustomPrompt: authorizedWorkspaceProcedure
		.input(
			z.object({
				promptId: z.string().uuid(),
				input: z.object({
					prompt: z.string().trim().min(1),
					locale: z.string().optional(),
					intent: z.enum(GEO_INTENT_LIST).optional(),
					decisionStage: z.enum(GEO_DECISION_STAGE_LIST).optional(),
					brandExposure: z.enum(["blind", "aided"]).optional(),
					targetProduct: z.string().nullable().optional(),
					targetCompetitor: z.string().nullable().optional(),
					targetAudience: z.string().nullable().optional(),
					targetRegion: z.string().nullable().optional(),
					tags: z.array(z.string().trim().min(1)).optional(),
				}),
			}),
		)
		.mutation(({ ctx, input }) =>
			reviseCustomPrompt({
				workspaceId: ctx.workspaceId,
				promptId: input.promptId,
				input: input.input,
			}),
		),
	archivePrompt: authorizedWorkspaceProcedure
		.input(z.object({ promptId: z.string().uuid() }))
		.mutation(({ ctx, input }) =>
			archiveWorkspacePrompt({
				workspaceId: ctx.workspaceId,
				promptId: input.promptId,
			}),
		),
	generatePromptSet: authorizedWorkspaceProcedure
		.input(
			z.object({
				brandName: z.string().trim().min(1),
				tier: z.enum(["quick", "standard", "deep"]),
				locale: z.string().default("zh-CN"),
			}),
		)
		.mutation(({ ctx, input }) =>
			createGeneratedPromptSet({
				workspaceId: ctx.workspaceId,
				brandName: input.brandName,
				tier: input.tier,
				locale: input.locale,
			}),
		),
	startRun: authorizedWorkspaceProcedure
		.use(createRateLimiter("geo.startRun", { limit: 4, windowSecs: 60 }))
		.input(
			z.object({
				promptSetId: z.string().uuid(),
				providers: z.array(z.enum(GEO_WEB_PROVIDERS)).optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			startGeoCollectionRun({
				workspaceId: ctx.workspaceId,
				userId: ctx.user.id,
				promptSetId: input.promptSetId,
				providers: input.providers,
			}),
		),
	startBaselineSeries: authorizedWorkspaceProcedure
		.use(
			createRateLimiter("geo.startBaselineSeries", {
				limit: 2,
				windowSecs: 60,
			}),
		)
		.input(
			z.object({
				promptSetId: z.string().uuid(),
				providers: z.array(z.enum(GEO_WEB_PROVIDERS)).optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			startGeoCollectionRun({
				workspaceId: ctx.workspaceId,
				userId: ctx.user.id,
				promptSetId: input.promptSetId,
				providers: input.providers,
				requiredPurpose: "baseline",
			}),
		),
	runs: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listGeoRuns(ctx.workspaceId),
	),
	runDetail: authorizedWorkspaceProcedure
		.input(z.object({ seriesId: z.string().uuid() }))
		.query(({ ctx, input }) =>
			getGeoRunDetail({
				workspaceId: ctx.workspaceId,
				seriesId: input.seriesId,
			}),
		),
	retrySamples: authorizedWorkspaceProcedure
		.input(
			z.object({
				seriesId: z.string().uuid(),
				checkpointIds: z.array(z.string().uuid()).min(1).max(100),
			}),
		)
		.mutation(({ ctx, input }) =>
			retryGeoSamples({
				workspaceId: ctx.workspaceId,
				userId: ctx.user.id,
				seriesId: input.seriesId,
				checkpointIds: input.checkpointIds,
			}),
		),
	challenges: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listOpenHumanChallenges(ctx.workspaceId),
	),
	openChallenge: authorizedWorkspaceProcedure
		.input(z.object({ challengeId: z.string().uuid() }))
		.mutation(({ ctx, input }) =>
			requestHumanChallengeWindow({
				workspaceId: ctx.workspaceId,
				challengeId: input.challengeId,
			}),
		),
	resumeChallenge: authorizedWorkspaceProcedure
		.input(z.object({ challengeId: z.string().uuid() }))
		.mutation(({ ctx, input }) =>
			resumeHumanChallenge({
				workspaceId: ctx.workspaceId,
				userId: ctx.user.id,
				challengeId: input.challengeId,
			}),
		),
	auditSite: authorizedWorkspaceProcedure
		.use(createRateLimiter("geo.auditSite", { limit: 2, windowSecs: 60 }))
		.input(
			z.object({
				domain: z.string().min(3),
				maxPages: z.number().int().min(1).max(100).default(30),
			}),
		)
		.mutation(({ ctx, input }) =>
			auditWorkspaceSite({
				workspaceId: ctx.workspaceId,
				domain: input.domain,
				maxPages: input.maxPages,
			}),
		),
	sitePages: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listWorkspaceSitePages(ctx.workspaceId),
	),
	facts: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listWorkspaceFacts(ctx.workspaceId),
	),
	createFact: authorizedWorkspaceProcedure
		.input(
			z.object({
				subject: z.string().min(1),
				predicate: z.string().min(1),
				value: z.string().min(1),
				sourceUrl: z.string().url().optional(),
				sourceType: z.string().trim().min(1).optional(),
				evidenceGrade: z.enum(["A", "B", "C", "D"]).optional(),
				status: z.enum(["verified", "unverified", "rejected"]).optional(),
				retrievedAt: z.coerce.date().optional(),
				region: z.string().trim().min(1).optional(),
				validUntil: z.coerce.date().optional(),
				supportedClaims: z.array(z.string().trim().min(1)).optional(),
				confidence: z.number().int().min(0).max(100).optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			createBrandFact({
				workspaceId: ctx.workspaceId,
				subject: input.subject,
				predicate: input.predicate,
				value: input.value,
				sourceUrl: input.sourceUrl,
				sourceType: input.sourceType,
				evidenceGrade: input.evidenceGrade,
				status: input.status,
				retrievedAt: input.retrievedAt,
				region: input.region,
				validUntil: input.validUntil,
				supportedClaims: input.supportedClaims,
				confidence: input.confidence,
			}),
		),
	opportunities: authorizedWorkspaceProcedure
		.input(z.object({ seriesId: z.string().uuid().optional() }))
		.query(({ ctx, input }) =>
			listWorkspaceOpportunities(ctx.workspaceId, input.seriesId),
		),
	externalEvidenceTasks: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listExternalEvidenceTasks(ctx.workspaceId),
	),
	refreshOpportunities: authorizedWorkspaceProcedure
		.input(z.object({ seriesId: z.string().uuid().optional() }))
		.mutation(({ ctx, input }) =>
			refreshWorkspaceOpportunities(ctx.workspaceId, input.seriesId),
		),
	content: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listWorkspaceContent(ctx.workspaceId),
	),
	createContentDraft: authorizedWorkspaceProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				kind: z.string().min(1),
				sourceContent: z.string().optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			createContentDraft({
				workspaceId: ctx.workspaceId,
				createdBy: ctx.user.id,
				opportunityId: input.opportunityId,
				kind: input.kind,
				sourceContent: input.sourceContent,
			}),
		),
	generateOptimization: authorizedWorkspaceProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				kind: z.string().min(1),
				sourceContent: z.string().optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			createContentDraft({
				workspaceId: ctx.workspaceId,
				createdBy: ctx.user.id,
				opportunityId: input.opportunityId,
				kind: input.kind,
				sourceContent: input.sourceContent,
			}),
		),
	validateRevision: authorizedWorkspaceProcedure
		.input(z.object({ revisionId: z.string().uuid() }))
		.mutation(({ ctx, input }) =>
			validateContentRevision({
				workspaceId: ctx.workspaceId,
				revisionId: input.revisionId,
			}),
		),
	approveContent: authorizedWorkspaceProcedure
		.input(z.object({ revisionId: z.string().uuid() }))
		.mutation(({ ctx, input }) =>
			approveContentRevision({
				workspaceId: ctx.workspaceId,
				revisionId: input.revisionId,
			}),
		),
	reviseContent: authorizedWorkspaceProcedure
		.input(
			z.object({
				revisionId: z.string().uuid(),
				markdown: z.string().min(100),
			}),
		)
		.mutation(({ ctx, input }) =>
			reviseContentAsset({
				workspaceId: ctx.workspaceId,
				revisionId: input.revisionId,
				markdown: input.markdown,
				createdBy: ctx.user.id,
			}),
		),
	publishers: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listPublisherConnections(ctx.workspaceId),
	),
	savePublisher: authorizedWorkspaceProcedure
		.input(z.object({ name: z.string().min(1), config: publisherConfigSchema }))
		.mutation(({ ctx, input }) =>
			savePublisherConnection({
				workspaceId: ctx.workspaceId,
				name: input.name,
				config: input.config,
			}),
		),
	publish: authorizedWorkspaceProcedure
		.input(
			z.object({
				revisionId: z.string().uuid(),
				connectionId: z.string().uuid(),
				baselineSeriesId: z.string().uuid(),
			}),
		)
		.mutation(({ ctx, input }) =>
			publishApprovedRevision({
				workspaceId: ctx.workspaceId,
				revisionId: input.revisionId,
				connectionId: input.connectionId,
				baselineSeriesId: input.baselineSeriesId,
			}),
		),
	experiments: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listRetestExperiments(ctx.workspaceId),
	),
	createExperiment: authorizedWorkspaceProcedure
		.input(z.object({ interventionId: z.string().uuid() }))
		.mutation(({ ctx, input }) =>
			createRetestExperiment({
				workspaceId: ctx.workspaceId,
				interventionId: input.interventionId,
			}),
		),
	experimentResults: authorizedWorkspaceProcedure
		.input(z.object({ experimentId: z.string().uuid() }))
		.query(({ ctx, input }) =>
			getExperimentResults({
				workspaceId: ctx.workspaceId,
				experimentId: input.experimentId,
			}),
		),
	interventions: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listPublishedInterventions(ctx.workspaceId),
	),
	rollback: authorizedWorkspaceProcedure
		.input(z.object({ interventionId: z.string().uuid() }))
		.mutation(({ ctx, input }) =>
			rollbackPublishedIntervention({
				workspaceId: ctx.workspaceId,
				interventionId: input.interventionId,
			}),
		),
});
