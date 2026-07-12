"use client";

import {
	formPrimaryButtonClassName,
	formSecondaryButtonClassName,
} from "@/components/forms/auth-form-chrome";
import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import { Button, Input, toast } from "@answerloom/ui";
import { Database, ExternalLink, Loader2, Save, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function SettingsPage() {
	const workspaceId = useSafeSearchParams().get("workspace") ?? "";
	const utils = api.useUtils();
	const workspace = api.workspace.getById.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const sets = api.geo.promptSets.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const runs = api.geo.runs.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const schedules = api.geo.detectionSchedules.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const [name, setName] = useState("");
	const [domain, setDomain] = useState("");
	useEffect(() => {
		if (!workspace.data) return;
		setName(workspace.data.name);
		setDomain(workspace.data.domain ?? "");
	}, [workspace.data]);
	const update = api.workspace.updateDetails.useMutation({
		onSuccess: async () => {
			await Promise.all([
				utils.workspace.getById.invalidate({ workspaceId }),
				utils.workspace.listAllForUser.invalidate(),
			]);
			toast.success("Workspace settings saved");
		},
		onError: (error) => toast.error(error.message),
	});

	return (
		<div className="web-page-wide">
			<div className="web-page-wide-inner space-y-9 py-6 sm:py-8">
				<header className="flex items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-neutral-800">
					<div>
						<p className="text-xs font-semibold uppercase text-cyan-700 dark:text-cyan-300">
							Settings
						</p>
						<h1 className="mt-2 text-2xl font-semibold">
							Workspace configuration
						</h1>
					</div>
					<Settings className="size-6 text-stone-400" />
				</header>
				<section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
					<div className="space-y-4">
						<label htmlFor="workspace-name" className="grid gap-1.5 text-sm">
							<span className="font-medium">Workspace name</span>
							<Input
								id="workspace-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</label>
						<label htmlFor="official-domain" className="grid gap-1.5 text-sm">
							<span className="font-medium">Official domain</span>
							<Input
								id="official-domain"
								value={domain}
								onChange={(event) => setDomain(event.target.value)}
							/>
						</label>
						<Button
							className={formPrimaryButtonClassName}
							disabled={
								update.isPending ||
								name.trim().length < 2 ||
								domain.trim().length < 2
							}
							onClick={() =>
								update.mutate({
									workspaceId,
									name: name.trim(),
									domain: domain.trim(),
								})
							}
						>
							{update.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Save className="size-4" />
							)}{" "}
							Save workspace
						</Button>
					</div>
					<aside className="rounded-md border border-stone-200 p-4 dark:border-neutral-800">
						<div className="flex items-center gap-2">
							<Database className="size-4 text-stone-500" />
							<p className="font-medium">Detection data</p>
						</div>
						<dl className="mt-4 space-y-3 text-sm">
							<div className="flex justify-between">
								<dt className="text-stone-500">Frozen sets</dt>
								<dd>
									{
										(sets.data ?? []).filter(
											(set) => set.purpose === "baseline",
										).length
									}
								</dd>
							</div>
							<div className="flex justify-between">
								<dt className="text-stone-500">Formal series</dt>
								<dd>
									{
										(runs.data ?? []).filter(
											(run) => run.purpose === "baseline",
										).length
									}
								</dd>
							</div>
							<div className="flex justify-between">
								<dt className="text-stone-500">Schedules</dt>
								<dd>{schedules.data?.length ?? 0}</dd>
							</div>
						</dl>
					</aside>
				</section>
				<section className="border-t border-stone-200 pt-6 dark:border-neutral-800">
					<h2 className="text-base font-semibold">Collection controls</h2>
					<div className="mt-4 flex flex-wrap gap-2">
						<Link
							href={`/providers?workspace=${workspaceId}`}
							className={`${formSecondaryButtonClassName} inline-flex items-center gap-2`}
						>
							<ExternalLink className="size-4" /> Provider profiles
						</Link>
						<Link
							href={`/schedule?workspace=${workspaceId}`}
							className={`${formSecondaryButtonClassName} inline-flex items-center gap-2`}
						>
							<ExternalLink className="size-4" /> Detection schedules
						</Link>
					</div>
				</section>
			</div>
		</div>
	);
}
