import {
	GEO_WEB_PROVIDERS,
	auditWorkspaceSite,
	confirmBrandProfile,
	createDetectionSet,
	deleteDetectionSchedule,
	getBrandProfile,
	getCamoufoxDiagnostics,
	getDetectionPromptCatalog,
	getDetectionReport,
	getDetectionTrend,
	getGeoOverview,
	getGeoRunDetail,
	getLatestDetectionReport,
	listCollectorNodes,
	listDetectionSchedules,
	listGeoRuns,
	listOpenHumanChallenges,
	listWorkspaceFacts,
	listWorkspacePromptSets,
	listWorkspaceSitePages,
	pairCollectorNode,
	pauseDetectionSchedule,
	previewDetection,
	requestHumanChallengeWindow,
	resumeHumanChallenge,
	retryGeoAnalysis,
	retryGeoSamples,
	runProviderSmoke,
	saveBrandProfile,
	saveDetectionSchedule,
	startGeoCollectionRun,
	suggestProfileFromSite,
} from "@aloom/services";
import {
	DETECTION_SCHEDULE_CADENCE_LIST,
	GEO_DECISION_STAGE_LIST,
	GEO_INTENT_LIST,
	PROVIDER_MODE_LIST,
	SAMPLING_DEPTH_LIST,
} from "@aloom/types";
import { z } from "zod";
import { createRateLimiter } from "../../middleware/rateLimit";
import { authorizedWorkspaceProcedure } from "../../procedures";
import { createTRPCRouter } from "../../trpc";

const optionalStringArray = z.array(z.string().trim().min(1)).default([]);
const suiteSchema = z.enum([
	"quick_scan",
	"discovery",
	"competitive_position",
	"trust_risk",
	"buyer_journey",
	"full_matrix",
]);
const detectionFilterSchema = z
	.object({
		intents: z.array(z.enum(GEO_INTENT_LIST)).optional(),
		stages: z.array(z.enum(GEO_DECISION_STAGE_LIST)).optional(),
		brandExposures: z.array(z.enum(["blind", "aided"])).optional(),
		products: z.array(z.string().trim().min(1)).optional(),
		competitors: z.array(z.string().trim().min(1)).optional(),
		audiences: z.array(z.string().trim().min(1)).optional(),
		regions: z.array(z.string().trim().min(1)).optional(),
	})
	.optional();
const detectionRecurrenceSchema = z.object({
	cadence: z.enum(DETECTION_SCHEDULE_CADENCE_LIST),
	timezone: z.string().trim().min(1),
	localTime: z.string().regex(/^\d{2}:\d{2}$/),
	dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
	dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
});
const detectionRunPlanSchema = detectionRecurrenceSchema
	.extend({
		totalRuns: z.number().int().min(1).max(30),
	})
	.superRefine((plan, context) => {
		if (plan.totalRuns <= 1) return;
		if (plan.cadence === "weekly" && plan.dayOfWeek == null) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["dayOfWeek"],
				message: "Select a weekday",
			});
		}
		if (plan.cadence === "monthly" && plan.dayOfMonth == null) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["dayOfMonth"],
				message: "Select a day of month",
			});
		}
	});

export const geoRouter = createTRPCRouter({
	overview: authorizedWorkspaceProcedure.query(({ ctx }) =>
		getGeoOverview(ctx.workspaceId),
	),
	detectionReport: authorizedWorkspaceProcedure
		.input(z.object({ seriesId: z.string().uuid().optional() }))
		.query(({ ctx, input }) =>
			input.seriesId
				? getDetectionReport({
						workspaceId: ctx.workspaceId,
						seriesId: input.seriesId,
					})
				: getLatestDetectionReport(ctx.workspaceId),
		),
	detectionTrend: authorizedWorkspaceProcedure
		.input(
			z.object({
				seriesId: z.string().uuid().optional(),
				limit: z.number().int().min(2).max(24).default(12),
			}),
		)
		.query(({ ctx, input }) =>
			getDetectionTrend({
				workspaceId: ctx.workspaceId,
				seriesId: input.seriesId,
				limit: input.limit,
			}),
		),
	collectors: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listCollectorNodes(ctx.workspaceId),
	),
	camoufoxDiagnostics: authorizedWorkspaceProcedure.query(({ ctx }) =>
		getCamoufoxDiagnostics(ctx.workspaceId),
	),
	runProviderSmoke: authorizedWorkspaceProcedure
		.use(
			createRateLimiter("geo.runProviderSmoke", { limit: 2, windowSecs: 300 }),
		)
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
				...input,
				workspaceId: ctx.workspaceId,
			}),
		),
	suggestProfileFromSite: authorizedWorkspaceProcedure
		.use(
			createRateLimiter("geo.suggestProfileFromSite", {
				limit: 2,
				windowSecs: 60,
			}),
		)
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
	promptPacks: authorizedWorkspaceProcedure.query(() =>
		getDetectionPromptCatalog(),
	),
	promptSets: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listWorkspacePromptSets(ctx.workspaceId),
	),
	previewDetection: authorizedWorkspaceProcedure
		.input(
			z.object({
				suiteKey: suiteSchema,
				samplingDepth: z.enum(SAMPLING_DEPTH_LIST),
				locales: z.array(z.string().min(2)).optional(),
				filters: detectionFilterSchema,
				providerCount: z.number().int().min(1).max(4).optional(),
			}),
		)
		.query(({ ctx, input }) =>
			previewDetection({
				...input,
				workspaceId: ctx.workspaceId,
			}),
		),
	createDetectionSet: authorizedWorkspaceProcedure
		.input(
			z.object({
				suiteKey: suiteSchema,
				samplingDepth: z.enum(SAMPLING_DEPTH_LIST),
				locales: z.array(z.string().min(2)).optional(),
				filters: detectionFilterSchema,
				name: z.string().trim().min(1).max(200).optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			createDetectionSet({
				...input,
				workspaceId: ctx.workspaceId,
			}),
		),
	startDetection: authorizedWorkspaceProcedure
		.use(createRateLimiter("geo.startDetection", { limit: 4, windowSecs: 60 }))
		.input(
			z.object({
				suiteKey: suiteSchema,
				locales: z.array(z.enum(["zh-CN", "en-US"])).min(1),
				filters: detectionFilterSchema,
				providers: z.array(z.enum(GEO_WEB_PROVIDERS)).min(1),
				providerModes: z
					.object({
						doubao: z.enum(PROVIDER_MODE_LIST).optional(),
						deepseek: z.enum(PROVIDER_MODE_LIST).optional(),
						hunyuan: z.enum(PROVIDER_MODE_LIST).optional(),
						qwen: z.enum(PROVIDER_MODE_LIST).optional(),
					})
					.optional(),
				runPlan: detectionRunPlanSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const profile = await getBrandProfile(ctx.workspaceId);
			if (profile?.confirmationStatus !== "confirmed") {
				await confirmBrandProfile(ctx.workspaceId);
			}
			const promptSet = await createDetectionSet({
				workspaceId: ctx.workspaceId,
				suiteKey: input.suiteKey,
				samplingDepth: "single",
				runPlan: {
					...input.runPlan,
					dayOfWeek:
						input.runPlan.cadence === "weekly"
							? (input.runPlan.dayOfWeek ?? null)
							: null,
					dayOfMonth:
						input.runPlan.cadence === "monthly"
							? (input.runPlan.dayOfMonth ?? null)
							: null,
				},
				locales: input.locales,
				filters: input.filters,
			});
			return startGeoCollectionRun({
				workspaceId: ctx.workspaceId,
				userId: ctx.user.id,
				promptSetId: promptSet.promptSet.id,
				expectedLocales: promptSet.manifest.locales,
				providers: input.providers,
				providerModes: input.providerModes,
				requiredPurpose: "baseline",
			});
		}),
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
	retryAnalysis: authorizedWorkspaceProcedure
		.input(
			z.object({
				checkpointIds: z.array(z.string().uuid()).min(1).max(100),
			}),
		)
		.mutation(({ ctx, input }) =>
			retryGeoAnalysis({
				workspaceId: ctx.workspaceId,
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
				maxPages: z.number().int().min(1).max(30).default(12),
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
	detectionSchedules: authorizedWorkspaceProcedure.query(({ ctx }) =>
		listDetectionSchedules(ctx.workspaceId),
	),
	saveDetectionSchedule: authorizedWorkspaceProcedure
		.input(
			z.object({
				promptSetId: z.string().uuid(),
				providers: z.array(z.enum(GEO_WEB_PROVIDERS)).min(1),
				providerModes: z
					.object({
						doubao: z.enum(PROVIDER_MODE_LIST).optional(),
						deepseek: z.enum(PROVIDER_MODE_LIST).optional(),
						hunyuan: z.enum(PROVIDER_MODE_LIST).optional(),
						qwen: z.enum(PROVIDER_MODE_LIST).optional(),
					})
					.optional(),
				...detectionRecurrenceSchema.shape,
			}),
		)
		.mutation(({ ctx, input }) =>
			saveDetectionSchedule({
				...input,
				workspaceId: ctx.workspaceId,
				userId: ctx.user.id,
			}),
		),
	pauseDetectionSchedule: authorizedWorkspaceProcedure
		.input(
			z.object({
				scheduleId: z.string().uuid(),
				enabled: z.boolean(),
			}),
		)
		.mutation(({ ctx, input }) =>
			pauseDetectionSchedule({
				...input,
				workspaceId: ctx.workspaceId,
			}),
		),
	deleteDetectionSchedule: authorizedWorkspaceProcedure
		.input(z.object({ scheduleId: z.string().uuid() }))
		.mutation(({ ctx, input }) =>
			deleteDetectionSchedule({
				workspaceId: ctx.workspaceId,
				scheduleId: input.scheduleId,
			}),
		),
});
