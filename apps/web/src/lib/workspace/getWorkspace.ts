import "server-only";

import { db } from "@anspectra/db";
import type { Workspace } from "@anspectra/db";
import { auth } from "@lib/auth/auth";
import { inArray } from "drizzle-orm";
import { headers } from "next/headers";

export async function getWorkspace(): Promise<Workspace | null> {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session) return null;

	const sessionWithOrg = session.session as typeof session.session & {
		activeOrganizationId?: string | null;
	};

	const orgId = sessionWithOrg.activeOrganizationId ?? null;

	if (orgId) {
		const workspace = await db.query.workspaces.findFirst({
			where: (table, { and, eq, isNull }) =>
				and(
					eq(table.tenantId, orgId),
					isNull(table.archivedAt),
					isNull(table.deletedAt),
				),
			orderBy: (table, { desc }) => [desc(table.createdAt)],
		});

		if (workspace) return workspace;
	}

	const memberships = await db.query.workspaceMembers.findMany({
		where: (wm, { and, eq, isNull }) =>
			and(eq(wm.userId, session.user.id), isNull(wm.deletedAt)),
		columns: {
			workspaceId: true,
		},
	});

	const workspaceIds = Array.from(
		new Set(
			memberships
				.map((membership) => membership.workspaceId)
				.filter((workspaceId): workspaceId is string => Boolean(workspaceId)),
		),
	);

	if (workspaceIds.length === 0) return null;

	const workspace = await db.query.workspaces.findFirst({
		where: (table, { and, isNull }) =>
			and(
				inArray(table.id, workspaceIds),
				isNull(table.archivedAt),
				isNull(table.deletedAt),
			),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
	});

	return workspace ?? null;
}
