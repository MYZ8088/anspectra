import { clickhouse } from "@aloom/db";
import type {
	FetchPromptResponsesForWorkspaceArgs,
	PromptResponse,
} from "@aloom/types";

export async function fetchPromptResponsesForWorkspace(
	args: FetchPromptResponsesForWorkspaceArgs,
): Promise<PromptResponse[]> {
	const { workspaceId } = args;

	const result = await clickhouse.query({
		query: `
        SELECT *
        FROM analytics.prompt_responses
        WHERE workspace_id = {workspaceId:String}
      `,
		query_params: { workspaceId },
		format: "JSONEachRow",
	});

	const responses: PromptResponse[] = (await result.json()) as PromptResponse[];
	return responses;
}
