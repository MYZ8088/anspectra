import "server-only";

import { createTRPCRouter } from "@/server/api/trpc";
import {
	fetchPromptSourcesForWorkspace,
	fetchUserPromptsForWorkspace,
} from "@answerloom/services";
import { authorizedWorkspaceProcedure } from "../../procedures";

export const promptRouter = createTRPCRouter({
	fetchPromptSources: authorizedWorkspaceProcedure.query(async ({ ctx }) => {
		const { workspaceId } = ctx;

		return fetchPromptSourcesForWorkspace({ workspaceId });
	}),

	fetchUserPrompts: authorizedWorkspaceProcedure.query(async ({ ctx }) => {
		const { workspaceId } = ctx;

		return fetchUserPromptsForWorkspace({
			workspaceId,
		});
	}),
});
