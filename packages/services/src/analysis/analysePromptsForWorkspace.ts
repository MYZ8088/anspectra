import { clickhouse, db, schema } from "@aloom/db";
import { BaseError, toErrorMessage } from "@aloom/errors";
import type { PromptAnalysis, PromptResponse } from "@aloom/types";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getWorkspaceById } from "../workspace/index.js";
import { type AnalysisExecution, runAnalysisDetailed } from "./runAnalysis.js";

async function analysePromptResponse(args: {
	brandDomain: string;
	brandName: string;
	response: string;
	prompt: string;
	sources?: PromptResponse["sources"];
	facts: Array<{
		claim: string;
		sourceUrl: string | null;
		evidenceGrade: "A" | "B" | "C" | "D" | null;
		status: string;
	}>;
}): Promise<AnalysisExecution> {
	const execution = await runAnalysisDetailed({
		brandDomain: args.brandDomain,
		brandName: args.brandName,
		response: args.response,
		prompt: args.prompt,
		sources: args.sources,
		facts: args.facts,
	});

	execution.result.metadata = {
		brandName: args.brandName,
		brandDomain: args.brandDomain,
	};

	return execution;
}

export async function analysePromptsForWorkspace(args: {
	workspaceId: string;
	batchSize?: number;
	analyzeAll?: boolean;
	runId?: string;
}): Promise<{
	analysedCount: number;
	failedCount: number;
	errors: Array<{ responseId: string; modelProvider: string; error: string }>;
	remainingCount: number;
	processedResponseIds: string[];
}> {
	const { workspaceId, batchSize = 50, analyzeAll = false, runId } = args;
	const [workspace, profile, ledger] = await Promise.all([
		getWorkspaceById({ workspaceId }),
		db.query.brandProfiles.findFirst({
			where: eq(schema.brandProfiles.workspaceId, workspaceId),
		}),
		db.query.brandFacts.findMany({
			where: eq(schema.brandFacts.workspaceId, workspaceId),
		}),
	]);
	const analysisContext = {
		brandName: profile?.brandName ?? workspace.name,
		brandDomain: profile?.officialDomain ?? workspace.domain,
		facts: ledger.map((fact) => ({
			claim: `${fact.subject} — ${fact.predicate}: ${fact.value}`,
			sourceUrl: fact.sourceUrl,
			evidenceGrade: fact.evidenceGrade as "A" | "B" | "C" | "D" | null,
			status: fact.status,
		})),
	};
	const scopedCheckpoints = runId
		? await db.query.sampleCheckpoints.findMany({
				where: and(
					eq(schema.sampleCheckpoints.runId, runId),
					eq(schema.sampleCheckpoints.status, "completed"),
					eq(schema.sampleCheckpoints.analysisStatus, "running"),
				),
			})
		: [];
	const scopedResponseIds = runId
		? scopedCheckpoints.flatMap((checkpoint) =>
				checkpoint.analyticsSampleId ? [checkpoint.analyticsSampleId] : [],
			)
		: null;
	if (runId && scopedResponseIds?.length === 0) {
		return {
			analysedCount: 0,
			failedCount: 0,
			errors: [],
			remainingCount: 0,
			processedResponseIds: [],
		};
	}

	let totalAnalyzed = 0;
	let totalFailed = 0;
	let allErrors: Array<{
		responseId: string;
		modelProvider: string;
		error: string;
	}> = [];
	const processedResponseIds = new Set<string>();

	// offset advances the cursor independently of ClickHouse mutation completion.
	// ALTER TABLE UPDATE is async — without OFFSET, the same rows are returned
	// every iteration until the background mutation finishes, causing duplicate
	// processing and a potential infinite loop.
	let offset = 0;
	let hasMore = true;
	while (hasMore) {
		const result = await clickhouse.query({
			query: `
                SELECT *
                FROM analytics.prompt_responses
                WHERE workspace_id = {workspaceId:String}
				  ${scopedResponseIds ? "AND id IN ({responseIds:Array(String)})" : "AND is_analysed = false"}
                LIMIT {batchSize:UInt32}
                OFFSET {offset:UInt32}
            `,
			query_params: {
				workspaceId,
				batchSize,
				offset,
				...(scopedResponseIds ? { responseIds: scopedResponseIds } : {}),
			},
			format: "JSONEachRow",
		});

		const responses: PromptResponse[] = await result.json();

		if (responses.length === 0) {
			break;
		}

		const analysisRows: PromptAnalysis[] = [];
		const analysisV2Rows: Array<Record<string, unknown>> = [];
		const responseIdsToMark: string[] = [];
		const errors: Array<{
			responseId: string;
			modelProvider: string;
			error: string;
		}> = [];

		// Analyze each response
		for (const resp of responses) {
			try {
				const execution = await analysePromptResponse({
					...analysisContext,
					response: resp.response,
					prompt: resp.prompt,
					sources: resp.sources,
				});

				const analysisId = uuidv4();
				const analysisJson = JSON.stringify(execution.result);
				analysisRows.push({
					id: analysisId,
					prompt_id: resp.prompt_id,
					workspace_id: resp.workspace_id,
					prompt: resp.prompt,
					user_id: resp.user_id,
					model_provider: resp.model_provider,
					brand_analysis: analysisJson,
					prompt_run_at: resp.prompt_run_at,
					created_at: resp.created_at,
				});
				analysisV2Rows.push({
					id: analysisId,
					sample_id: resp.id,
					prompt_id: resp.prompt_id,
					workspace_id: resp.workspace_id,
					user_id: resp.user_id,
					model_provider: resp.model_provider,
					analysis_json: analysisJson,
					analysis_model: execution.model,
					template_version: "aloom-six-layer-analysis-v1",
					raw_output: JSON.stringify({
						rawOutputs: execution.rawOutputs,
						attempts: execution.attempts,
						parseMode: execution.parseMode,
					}),
					status: "completed",
					error: "",
					attempt_count: execution.attemptCount,
					prompt_run_at: resp.prompt_run_at,
				});

				responseIdsToMark.push(resp.id);
			} catch (err) {
				const errorMessage = toErrorMessage(err);
				const metadata = err instanceof BaseError ? err.meta : undefined;
				const rawOutputs = Array.isArray(metadata?.rawOutputs)
					? metadata.rawOutputs
					: typeof metadata?.rawOutput === "string"
						? [metadata.rawOutput]
						: [];
				const models = Array.isArray(metadata?.models) ? metadata.models : [];
				const attempts = Array.isArray(metadata?.attempts)
					? metadata.attempts
					: [];
				analysisV2Rows.push({
					id: uuidv4(),
					sample_id: resp.id,
					prompt_id: resp.prompt_id,
					workspace_id: resp.workspace_id,
					user_id: resp.user_id,
					model_provider: resp.model_provider,
					analysis_json: "",
					analysis_model: String(models.at(-1) ?? ""),
					template_version: "aloom-six-layer-analysis-v1",
					raw_output: JSON.stringify({ rawOutputs, attempts }),
					status: "failed",
					error: errorMessage,
					attempt_count:
						typeof metadata?.attemptCount === "number"
							? metadata.attemptCount
							: 1,
					prompt_run_at: resp.prompt_run_at,
				});
				console.error(
					`Failed to analyze response ${resp.id} (${resp.model_provider}):`,
					errorMessage,
				);

				// Collect error details for frontend
				errors.push({
					responseId: resp.id,
					modelProvider: resp.model_provider,
					error: errorMessage,
				});
			} finally {
				processedResponseIds.add(resp.id);
			}
		}

		if (analysisRows.length > 0) {
			await clickhouse.insert({
				table: "analytics.prompt_analysis",
				values: analysisRows,
				format: "JSONEachRow",
			});
		}
		if (analysisV2Rows.length > 0) {
			await clickhouse.insert({
				table: "analytics.sample_analysis_v2",
				values: analysisV2Rows,
				format: "JSONEachRow",
			});
		}

		if (responseIdsToMark.length > 0) {
			await clickhouse.command({
				query: `
                    ALTER TABLE analytics.prompt_responses
                    UPDATE is_analysed = true
                    WHERE id IN ({ids:Array(String)})
                `,
				query_params: { ids: responseIdsToMark },
			});
		}

		totalAnalyzed += analysisRows.length;
		totalFailed += errors.length;
		allErrors = allErrors.concat(errors);
		offset += batchSize;

		// If not analyzing all, stop after first batch
		if (!analyzeAll) {
			hasMore = false;
		} else {
			// Check if there are more to process
			hasMore = responses.length === batchSize;
			// Give ClickHouse 100ms to process the async ALTER TABLE mutation
			// before the next SELECT. Without this, a narrow window exists where
			// the mutation hasn't landed yet and the OFFSET cursor is the only
			// safeguard against duplicate processing.
			if (hasMore) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
	}
	if (scopedResponseIds) {
		for (const responseId of scopedResponseIds) {
			if (processedResponseIds.has(responseId)) continue;
			processedResponseIds.add(responseId);
			allErrors.push({
				responseId,
				modelProvider: "unknown",
				error: "Captured answer could not be loaded for analysis",
			});
			totalFailed += 1;
		}
	}

	// Check remaining count
	const remainingResult = scopedResponseIds
		? null
		: await clickhouse.query({
			query: `
            SELECT count() as count
            FROM analytics.prompt_responses
            WHERE workspace_id = {workspaceId:String}
              AND is_analysed = false
        `,
			query_params: { workspaceId },
			format: "JSONEachRow",
		});

	const remainingData: Array<{ count: string }> = remainingResult
		? await remainingResult.json()
		: [];
	const remainingCount = scopedResponseIds
		? 0
		: Number(remainingData[0]?.count || 0);

	return {
		analysedCount: totalAnalyzed,
		failedCount: totalFailed,
		errors: allErrors,
		remainingCount,
		processedResponseIds: [...processedResponseIds],
	};
}
