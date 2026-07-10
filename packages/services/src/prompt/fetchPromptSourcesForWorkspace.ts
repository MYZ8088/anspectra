import type {
	FetchPromptSourcesForWorkspaceArgs,
	FetchPromptSourcesForWorkspaceResult,
} from "@answerloom/types";
import { extractDomainStats, extractSourceStats } from "@answerloom/utils";
import { fetchPromptResponsesForWorkspace } from "./fetchPromptResponsesForWorkspace.js";

export async function fetchPromptSourcesForWorkspace(
	args: FetchPromptSourcesForWorkspaceArgs,
): Promise<FetchPromptSourcesForWorkspaceResult> {
	const { workspaceId } = args;

	const promptResponses = await fetchPromptResponsesForWorkspace({
		workspaceId,
	});
	const domainStats = extractDomainStats(promptResponses);
	const sourceStats = extractSourceStats(promptResponses);

	return {
		domain_stats: domainStats,
		sourceStats,
	};
}
