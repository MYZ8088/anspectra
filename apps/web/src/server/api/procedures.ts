// Procedures
import "server-only";

import { schema } from "@answerloom/db";
import { errorMappingMiddleware } from "./middleware/errorMapping";
import { isAuthenticated } from "./middleware/isAuthenticated";
import { isInternal } from "./middleware/isInternal";
import { validWorkspace } from "./middleware/validWorkspace";
import { t } from "./trpc";

const baseProcedure = t.procedure.use(errorMappingMiddleware);
export const protectedProcedure = baseProcedure.use(isAuthenticated);
export const authorizedWorkspaceProcedure = baseProcedure
	.input(schema.workspaceInput)
	.use(validWorkspace);

export const internalProcedure = baseProcedure.use(isInternal);
