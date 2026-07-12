import { AuthError, ValidationError } from "@aloom/errors";
import {
	addMemberToWorkspaceByEmail,
	getWorkspaceById,
	getWorkspaceJoinInfo,
	getWorkspaceMembersWithUsers,
	removeMemberFromWorkspace,
	updateOrganizationName,
	updateWorkspaceDetails,
	updateWorkspaceEnabledProviders,
} from "@aloom/services";
import { authorizedWorkspaceProcedure } from "../../../procedures";
import {
	addMemberInputSchema,
	removeMemberInputSchema,
	setEnabledProvidersInputSchema,
	updateDetailsInputSchema,
	updateOrganizationNameInputSchema,
} from "../_schemas";

export const authorizedWorkspaceRoutes = {
	getById: authorizedWorkspaceProcedure.query(async ({ ctx }) => {
		return getWorkspaceById({ workspaceId: ctx.workspaceId });
	}),

	listMembers: authorizedWorkspaceProcedure.query(async ({ ctx }) => {
		return getWorkspaceMembersWithUsers({ workspaceId: ctx.workspaceId });
	}),

	updateDetails: authorizedWorkspaceProcedure
		.input(updateDetailsInputSchema)
		.mutation(async ({ input, ctx }) => {
			if (ctx.membership.role !== "owner") {
				throw new ValidationError(
					"Only workspace owners can update workspace details.",
				);
			}
			return updateWorkspaceDetails({
				workspaceId: input.workspaceId,
				name: input.name,
				domain: input.domain,
			});
		}),

	updateOrganizationName: authorizedWorkspaceProcedure
		.input(updateOrganizationNameInputSchema)
		.mutation(async ({ input, ctx }) => {
			if (ctx.membership.role !== "owner") {
				throw new ValidationError(
					"Only workspace owners can rename the organization.",
				);
			}
			return updateOrganizationName({
				workspaceId: input.workspaceId,
				organizationName: input.organizationName,
			});
		}),

	getJoinInfo: authorizedWorkspaceProcedure.query(async ({ ctx }) => {
		return getWorkspaceJoinInfo({ workspaceId: ctx.workspaceId });
	}),

	addMember: authorizedWorkspaceProcedure
		.input(addMemberInputSchema)
		.mutation(async ({ input, ctx }) => {
			return addMemberToWorkspaceByEmail({
				workspaceId: ctx.workspaceId,
				email: input.email,
				role: input.role,
			});
		}),

	removeMember: authorizedWorkspaceProcedure
		.input(removeMemberInputSchema)
		.mutation(async ({ input, ctx }) => {
			const { workspaceId, user, membership } = ctx;
			const { userId } = input;

			if (membership.role !== "owner") {
				throw new AuthError("Only workspace owners can remove members.");
			}
			if (userId === user.id) {
				throw new ValidationError("You cannot remove yourself.");
			}

			return removeMemberFromWorkspace({ workspaceId, userId });
		}),

	getEnabledProviders: authorizedWorkspaceProcedure.query(async ({ ctx }) => {
		const workspace = await getWorkspaceById({ workspaceId: ctx.workspaceId });
		return { enabledProviders: workspace.enabledProviders ?? null };
	}),

	setEnabledProviders: authorizedWorkspaceProcedure
		.input(setEnabledProvidersInputSchema)
		.mutation(async ({ ctx, input }) => {
			return updateWorkspaceEnabledProviders({
				workspaceId: ctx.workspaceId,
				enabledProviders: input.enabledProviders,
			});
		}),
};
