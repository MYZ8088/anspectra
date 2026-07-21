import { db, schema } from "@anspectra/db";
import type {
	FetchUserPromptsForWorkspaceArgs,
	UserPrompt,
} from "@anspectra/types";
import { and, asc, eq } from "drizzle-orm";

/** PostgreSQL compatibility facade. ClickHouse user_prompts remains read-only history. */
export async function fetchUserPromptsForWorkspace(
	args: FetchUserPromptsForWorkspaceArgs,
): Promise<UserPrompt[]> {
	const rows = await db.query.workspacePrompts.findMany({
		where: and(
			eq(schema.workspacePrompts.workspaceId, args.workspaceId),
			eq(schema.workspacePrompts.origin, "user_custom"),
			eq(schema.workspacePrompts.active, true),
		),
		orderBy: [asc(schema.workspacePrompts.createdAt)],
	});
	return rows.map((row) => ({
		id: row.id,
		user_id: row.createdByUserId ?? "",
		workspace_id: row.workspaceId,
		prompt: row.prompt,
		created_at: row.createdAt.toISOString(),
	}));
}
