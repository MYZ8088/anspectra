import "server-only";

import { createTRPCRouter } from "@/server/api/trpc";
import { ValidationError } from "@aloom/errors";
import {
	analysePromptsForWorkspace,
	deleteAnalysisModelConfig,
	fetchAnalysedPrompts,
	getAnalysisModelConfig,
	saveAnalysisModelConfig,
	testAnalysisModelConfig,
} from "@aloom/services";
import { z } from "zod";
import { createRateLimiter } from "../../middleware/rateLimit";
import { authorizedWorkspaceProcedure } from "../../procedures";

export const analysisRouter = createTRPCRouter({
	modelConfig: authorizedWorkspaceProcedure.query(({ ctx }) =>
		getAnalysisModelConfig(ctx.workspaceId),
	),

	saveModelConfig: authorizedWorkspaceProcedure
		.input(
			z.object({
				baseUrl: z.string().trim().url().max(2048),
				model: z.string().trim().min(1).max(200),
				apiKey: z.string().trim().max(10_000).optional(),
			}),
		)
		.mutation(({ ctx, input }) => {
			if (ctx.membership.role !== "owner") {
				throw new ValidationError(
					"Only workspace owners can update model credentials.",
				);
			}
			return saveAnalysisModelConfig({
				workspaceId: ctx.workspaceId,
				baseUrl: input.baseUrl,
				model: input.model,
				apiKey: input.apiKey || undefined,
			});
		}),

	testModelConfig: authorizedWorkspaceProcedure.mutation(({ ctx }) => {
		if (ctx.membership.role !== "owner") {
			throw new ValidationError(
				"Only workspace owners can test model credentials.",
			);
		}
		return testAnalysisModelConfig(ctx.workspaceId);
	}),

	deleteModelConfig: authorizedWorkspaceProcedure.mutation(({ ctx }) => {
		if (ctx.membership.role !== "owner") {
			throw new ValidationError(
				"Only workspace owners can remove model credentials.",
			);
		}
		return deleteAnalysisModelConfig(ctx.workspaceId);
	}),

	analyzeMetrics: authorizedWorkspaceProcedure
		.input(
			z.object({
				analyzeAll: z.boolean().optional().default(true),
			}),
		)
		.use(
			createRateLimiter("analysis.analyzeMetrics", {
				limit: 10,
				windowSecs: 60,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return analysePromptsForWorkspace({
				workspaceId: ctx.workspaceId,
				analyzeAll: input.analyzeAll ?? true,
			});
		}),

	fetchAnalysis: authorizedWorkspaceProcedure.query(async ({ ctx }) => {
		return fetchAnalysedPrompts({ workspaceId: ctx.workspaceId });
	}),
});
