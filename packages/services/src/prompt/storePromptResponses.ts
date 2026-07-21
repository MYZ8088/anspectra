import { db, schema } from "@anspectra/db";
import { toErrorMessage } from "@anspectra/errors";
import type {
	ModelResult,
	Provider,
	Source,
	StorePromptResponsesArgs,
} from "@anspectra/types";
import { formatDateToClickHouse } from "@anspectra/utils";
import { and, eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { ensureSourceKindSchema } from "./lib/ensureSourceKindSchema.js";
import { insertClickHouseWithFallback } from "./lib/insertClickHouseWithFallback.js";

export async function storePromptResponses(
	args: StorePromptResponsesArgs,
): Promise<string[]> {
	const { results, userId, workspaceId, promptRunAt } = args;

	const values: Array<{
		id: string;
		prompt_id: string;
		prompt: string;
		user_id: string;
		workspace_id: string;
		model: string;
		model_provider: string;
		response: string;
		sources: Source[];
		prompt_run_at: string;
	}> = [];
	const extractedSourcesByResponseId = new Map<string, Source[]>();

	for (const [provider, result] of Object.entries(results) as [
		Provider,
		ModelResult[Provider],
	][]) {
		if (result.status !== "fulfilled") continue;

		for (const item of result.data) {
			const responseId = uuidv4();
			extractedSourcesByResponseId.set(responseId, item.sources);
			values.push({
				id: responseId,
				prompt_id: item.promptId,
				prompt: item.prompt,
				user_id: userId,
				workspace_id: workspaceId,
				model: provider,
				model_provider: provider,
				response: item.response,
				sources: item.sources.map((s) => ({
					title: s.title ?? "",
					cited_text: s.cited_text ?? "",
					url: s.url ?? "",
					domain: s.domain ?? null,
					favicon: s.favicon ?? null,
				})),
				prompt_run_at: formatDateToClickHouse(new Date(promptRunAt)),
			});
		}
	}

	if (values.length === 0) return [];

	await insertClickHouseWithFallback("analytics.prompt_responses", values, {
		throwOnAllFailed: true,
		onRecordFailed: (value, err) => {
			console.error(
				`Failed to insert record (prompt: "${value.prompt.slice(0, 50)}..."):`,
				toErrorMessage(err),
			);
			console.error("Problematic data:", {
				id: value.id,
				prompt_id: value.prompt_id,
				prompt: value.prompt.slice(0, 100),
				prompt_run_at: value.prompt_run_at,
				response_length: value.response.length,
				sources_count: value.sources.length,
			});
		},
	});

	const promptIds = [...new Set(values.map((value) => value.prompt_id))];
	const [run, promptRows, checkpointRows] = await Promise.all([
		args.runId
			? db.query.collectionRuns.findFirst({
					where: eq(schema.collectionRuns.id, args.runId),
				})
			: null,
		promptIds.length
			? db.query.monitorPrompts.findMany({
					where: inArray(schema.monitorPrompts.id, promptIds),
				})
			: [],
		args.runId && promptIds.length
			? db.query.sampleCheckpoints.findMany({
					where: and(
						eq(schema.sampleCheckpoints.runId, args.runId),
						inArray(schema.sampleCheckpoints.promptId, promptIds),
					),
				})
			: [],
	]);
	const promptById = new Map(promptRows.map((prompt) => [prompt.id, prompt]));
	const checkpointByKey = new Map(
		checkpointRows.map((checkpoint) => [
			`${checkpoint.provider}:${checkpoint.promptId}`,
			checkpoint,
		]),
	);
	const v2Values = values.map((value) => {
		const sourceResult = (
			Object.entries(results) as [Provider, ModelResult[Provider]][]
		)
			.flatMap(([provider, result]) =>
				result.status === "fulfilled"
					? result.data.map((item) => ({ provider, item }))
					: [],
			)
			.find(
				(entry) =>
					entry.provider === value.model_provider &&
					entry.item.promptId === value.prompt_id,
			);
		const promptMetadata = promptById.get(value.prompt_id);
		const checkpoint = checkpointByKey.get(
			`${value.model_provider}:${value.prompt_id}`,
		);
		return {
			...value,
			legacy_response_id: value.id,
			run_id: args.runId ?? null,
			checkpoint_id: args.checkpointId ?? checkpoint?.id ?? null,
			prompt_set_id: args.promptSetId ?? run?.promptSetId ?? null,
			series_id: run?.seriesId ?? null,
			prompt_group: promptMetadata?.promptGroup ?? "",
			prompt_hash: promptMetadata?.promptHash ?? "",
			prompt_origin: promptMetadata?.origin ?? "legacy",
			decision_stage: promptMetadata?.decisionStage ?? "",
			locale: promptMetadata?.locale ?? "",
			brand_exposure: promptMetadata?.brandExposure ?? "",
			repeat_index: args.repeatIndex ?? 0,
			source_exposure:
				sourceResult?.item.sourceExposure ??
				(value.sources.length > 0 ? "exposed" : "not_exposed"),
			reported_search_source_count:
				sourceResult?.item.reportedSearchSourceCount ?? null,
			search_source_coverage:
				sourceResult?.item.searchSourceCoverage ?? "not_exposed",
			requested_mode:
				sourceResult?.item.requestedMode ??
				checkpoint?.requestedMode ??
				"default",
			actual_mode:
				sourceResult?.item.actualMode ??
				checkpoint?.actualMode ??
				checkpoint?.requestedMode ??
				"default",
			conversation_id: sourceResult?.item.conversationId ?? null,
			conversation_url: sourceResult?.item.conversationUrl ?? null,
			conversation_isolation:
				sourceResult?.item.conversationIsolation ?? "fresh",
			evidence_level: "live_web",
			account_state: "authenticated",
			region: "",
			network_fingerprint: "",
			status: "completed",
			error_code: null,
			error_message: null,
		};
	});
	await ensureSourceKindSchema();
	await insertClickHouseWithFallback("analytics.answer_samples_v2", v2Values, {
		throwOnAllFailed: false,
	});
	const citations = v2Values.flatMap((value) =>
		(extractedSourcesByResponseId.get(value.id) ?? value.sources).map(
			(source, sourceIndex) => ({
				id: uuidv4(),
				sample_id: value.id,
				workspace_id: value.workspace_id,
				model_provider: value.model_provider,
				source_index: sourceIndex,
				title: source.title,
				cited_text: source.cited_text,
				url: source.url,
				domain: source.domain,
				source_kind: source.source_kind ?? "legacy_unknown",
				support_level: "unreviewed",
			}),
		),
	);
	if (citations.length > 0) {
		await insertClickHouseWithFallback(
			"analytics.sample_citations",
			citations,
			{
				throwOnAllFailed: false,
			},
		);
	}
	return values.map((value) => value.id);
}
