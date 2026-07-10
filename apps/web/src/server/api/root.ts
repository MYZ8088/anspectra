import "server-only";

import { createTRPCRouter } from "@/server/api/trpc";
import { agentRouter } from "./routers/agent";
import { analysisRouter } from "./routers/analysis";
import { geoRouter } from "./routers/geo";
import { internalRouter } from "./routers/internal";
import { promptRouter } from "./routers/prompt";
import { workspaceRouter } from "./routers/workspace";

export const appRouter = createTRPCRouter({
	workspace: workspaceRouter,
	prompt: promptRouter,
	analysis: analysisRouter,
	agent: agentRouter,
	internal: internalRouter,
	geo: geoRouter,
});

export type AppRouter = typeof appRouter;
