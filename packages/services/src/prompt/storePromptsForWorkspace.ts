import { db, schema } from "@answerloom/db";
import type { StorePromptsForWorkspaceArgs } from "@answerloom/types";
import { and, eq, inArray } from "drizzle-orm";
import { importCustomPrompts } from "../geo/promptLibrary.js";

/**
 * Compatibility facade for the original Prompt settings screen.
 * New prompt writes live in PostgreSQL; ClickHouse user_prompts is historical only.
 */
export async function storePromptsForWorkspace(
	args: StorePromptsForWorkspaceArgs,
): Promise<string[]> {
	const normalizedPrompts = [
		...new Set(args.prompts.map((prompt) => prompt.trim()).filter(Boolean)),
	];
	const existing = await db.query.workspacePrompts.findMany({
		where: and(
			eq(schema.workspacePrompts.workspaceId, args.workspaceId),
			eq(schema.workspacePrompts.origin, "user_custom"),
			eq(schema.workspacePrompts.active, true),
		),
	});
	const existingText = new Set(existing.map((row) => row.prompt.trim()));
	const additions = normalizedPrompts.filter((prompt) => !existingText.has(prompt));
	if (additions.length > 0) {
		await importCustomPrompts({
			workspaceId: args.workspaceId,
			userId: args.userId,
			importSource: "manual",
			items: additions.map((prompt) => ({ prompt })),
		});
	}
	const removedIds = existing
		.filter((row) => !normalizedPrompts.includes(row.prompt.trim()))
		.map((row) => row.id);
	if (removedIds.length > 0) {
		const now = new Date();
		await db
			.update(schema.workspacePrompts)
			.set({
				active: false,
				archivedAt: now,
				archivedReason: "Removed through legacy Prompt settings facade",
				updatedAt: now,
			})
			.where(inArray(schema.workspacePrompts.id, removedIds));
	}
	return normalizedPrompts;
}
