import "server-only";

import { createTRPCRouter } from "@/server/api/trpc";
import { agentRouter } from "./routers/agent";
import { analysisRouter } from "./routers/analysis";
import { geoRouter } from "./routers/geo";
import { promptRouter } from "./routers/prompt";
import { workspaceRouter } from "./routers/workspace";

export const appRouter = createTRPCRouter({
	workspace: workspaceRouter,
	prompt: promptRouter,
	analysis: analysisRouter,
	agent: agentRouter,
	geo: geoRouter,
});

export type AppRouter = typeof appRouter;
