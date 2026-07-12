import type {
	FetchPromptSourcesForWorkspaceArgs,
	FetchPromptSourcesForWorkspaceResult,
} from "@aloom/types";
import { extractDomainStats, extractSourceStats } from "@aloom/utils";
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
