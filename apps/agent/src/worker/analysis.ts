import { toErrorMessage } from "@answerloom/errors";
import {
	analysePromptsForWorkspace,
	completeGeoAnalysis,
	markGeoAnalysisRunning,
} from "@answerloom/services";
import type { Provider } from "@answerloom/types";
import { createProviderLogger } from "@answerloom/utils";

export function runAnalysisInBackground(args: {
	workspaceId: string;
	userId: string;
	provider: Provider;
	jobGroupId: string;
}): void {
	const { workspaceId, provider, jobGroupId } = args;
	const plog = createProviderLogger(provider);
	void (async () => {
		try {
			plog.log(
				`done for job group ${jobGroupId}, starting analysis in background...`,
			);
			await markGeoAnalysisRunning(jobGroupId);
			const result = await analysePromptsForWorkspace({
				workspaceId,
				analyzeAll: true,
			});
			await completeGeoAnalysis({
				runId: jobGroupId,
				errors: result.errors.map((error) => ({
					responseId: error.responseId,
					error: error.error,
				})),
			});
			plog.success(`Background analysis completed for job group ${jobGroupId}`);
		} catch (err) {
			await completeGeoAnalysis({
				runId: jobGroupId,
				fatalError: toErrorMessage(err),
			}).catch(() => {});
			plog.error(
				`Background analysis failed for job group ${jobGroupId}:`,
				toErrorMessage(err),
			);
		}
	})();
}
