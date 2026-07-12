"use client";

import {
	formFieldClassName,
	formHintClassName,
	formLabelClassName,
	formPanelClassName,
	formPrimaryButtonClassName,
	formSecondaryButtonClassName,
} from "@/components/forms/auth-form-chrome";
import { authClient } from "@/lib/auth/auth-client";
import { api } from "@/trpc/react";
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Input,
	Label,
	toast,
} from "@aloom/ui";
import { cn } from "@aloom/utils";
import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type JoinSelection = {
	organization: { id: string; name: string; slug: string | null };
	workspaces: { id: string; name: string; slug: string }[];
};

export default function WorkspaceGateway() {
	const router = useRouter();
	const [code, setCode] = useState("");
	const [selection, setSelection] = useState<JoinSelection | null>(null);

	const joinMutation = api.workspace.joinByCode.useMutation();

	const handleJoin = async (joinCode: string) => {
		if (!joinCode.trim()) {
			toast.error("Please enter a workspace code.");
			return;
		}

		setSelection(null);

		try {
			const result = await joinMutation.mutateAsync({ code: joinCode.trim() });
			if (result.status === "select-workspace") {
				setSelection({
					organization: result.organization,
					workspaces: result.workspaces,
				});
				return;
			}

			const { workspace, organization } = result;
			await authClient.organization.setActive({
				organizationId: organization.id,
				organizationSlug: organization.slug ?? undefined,
			});
			router.refresh();
			router.push(`/dashboard?workspace=${workspace.id}`);
		} catch (err) {
			console.error(err);
			toast.error("Unable to join workspace.");
		}
	};

	const handleSelectWorkspace = async (workspaceSlug: string) => {
		if (!selection) return;
		const orgCode = selection.organization.slug ?? selection.organization.id;
		await handleJoin(`${orgCode}/${workspaceSlug}`);
	};

	return (
		<div className="flex min-h-full min-w-0 items-center justify-center bg-stone-50 px-4 py-3 dark:bg-neutral-950 sm:px-6 sm:py-5 xl:px-10 xl:py-8">
			<div className="ui-stagger w-full max-w-3xl space-y-4 lg:max-w-[50rem] xl:max-w-[54rem] xl:space-y-5">
				<div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:gap-5">
					<Card className={cn(formPanelClassName, "flex h-full flex-col")}>
						<CardHeader className="space-y-1.5 px-5 pt-5 pb-0 sm:px-6 sm:pt-6 xl:px-7 xl:pt-7">
							<CardTitle className="text-[1.4rem] tracking-[-0.04em] xl:text-[1.65rem]">
								Join Workspace
							</CardTitle>
							<CardDescription className="xl:text-[14px] xl:leading-6">
								Enter the workspace code shared by your team to continue.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-1 flex-col space-y-3 px-5 py-4 sm:px-6 sm:py-5 xl:space-y-4 xl:px-7 xl:py-6">
							<div className="space-y-1.5 xl:space-y-2">
								<Label htmlFor="join-code" className={formLabelClassName}>
									Workspace Code
								</Label>
								<Input
									id="join-code"
									placeholder="acme/marketing"
									value={code}
									onChange={(e) => setCode(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && handleJoin(code)}
									className={formFieldClassName}
								/>
							</div>

							{selection && (
								<div className="space-y-2.5 rounded-[var(--app-radius)] border border-dashed border-gray-200/80 bg-stone-50/80 p-3.5 dark:border-gray-800 dark:bg-gray-900/60 xl:space-y-3 xl:p-4">
									<p className="text-sm text-gray-600 dark:text-gray-300 xl:text-[14px]">
										Select a workspace in{" "}
										<strong>{selection.organization.name}</strong>
									</p>
									<div className="flex flex-wrap gap-2">
										{selection.workspaces.map((ws) => (
											<Button
												key={ws.id}
												variant="outline"
												size="sm"
												onClick={() => handleSelectWorkspace(ws.slug)}
												className={cn(
													formSecondaryButtonClassName,
													"h-9 rounded-[var(--app-radius)] px-3 xl:h-10 xl:px-4",
												)}
											>
												{ws.name}
											</Button>
										))}
									</div>
								</div>
							)}
						</CardContent>
						<div className="px-5 pb-5 sm:px-6 sm:pb-6 xl:px-7 xl:pb-7">
							<Button
								onClick={() => handleJoin(code)}
								disabled={joinMutation.isPending || !code.trim()}
								className={cn(formPrimaryButtonClassName, "gap-2")}
							>
								{joinMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<>
										Join Workspace
										<ArrowRight className="h-4 w-4" />
									</>
								)}
							</Button>
						</div>
					</Card>

					<Card className={cn(formPanelClassName, "flex h-full flex-col")}>
						<CardHeader className="space-y-1.5 px-5 pt-5 pb-0 sm:px-6 sm:pt-6 xl:px-7 xl:pt-7">
							<CardTitle className="text-[1.4rem] tracking-[-0.04em] xl:text-[1.65rem]">
								Create Workspace
							</CardTitle>
							<CardDescription className="xl:text-[14px] xl:leading-6">
								Start fresh and create your first workspace. You can invite
								teammates later from the People tab.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-1 px-5 py-4 sm:px-6 sm:py-5 xl:px-7 xl:py-6" />
						<div className="px-5 pb-5 sm:px-6 sm:pb-6 xl:px-7 xl:pb-7">
							<Button
								onClick={() => router.push("/workspace/new")}
								className={formPrimaryButtonClassName}
							>
								Create New Workspace
							</Button>
						</div>
					</Card>
				</div>
			</div>
		</div>
	);
}
