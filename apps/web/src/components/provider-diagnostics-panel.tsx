"use client";

import { persistActiveProviderRun } from "@/components/provider-run-toast";
import { api } from "@/trpc/react";
import { Button, toast } from "@answerloom/ui";
import { cn } from "@answerloom/utils";
import { AlertTriangle, CheckCircle2, Loader2, Play, RefreshCw } from "lucide-react";
import Link from "next/link";

const PROVIDER_LABELS: Record<string, string> = {
	doubao: "Doubao",
	deepseek: "DeepSeek",
	hunyuan: "Yuanbao",
	qwen: "Qwen",
};

export function ProviderDiagnosticsPanel(props: { workspaceId: string }) {
	const utils = api.useUtils();
	const diagnostics = api.geo.camoufoxDiagnostics.useQuery({
		workspaceId: props.workspaceId,
	});
	const smoke = api.geo.runProviderSmoke.useMutation({
		onSuccess: async (run) => {
			persistActiveProviderRun({ workspaceId: props.workspaceId, jobId: run.id });
			await utils.geo.runs.invalidate();
			toast.success("Eight-sample Official Web diagnostic scheduled");
		},
		onError: (error) => toast.error(error.message),
	});

	return (
		<section className="mt-8 border-y border-stone-200 py-5 dark:border-neutral-800">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold">Camoufox diagnostics</h2>
					<p className="mt-1 text-xs text-stone-500">
						2 prompts × 4 Official Web providers
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="icon"
						title="Refresh diagnostics"
						onClick={() => diagnostics.refetch()}
						disabled={diagnostics.isFetching}
					>
						<RefreshCw
							className={cn("size-4", diagnostics.isFetching && "animate-spin")}
						/>
					</Button>
					<Button
						onClick={() => smoke.mutate({ workspaceId: props.workspaceId })}
						disabled={!diagnostics.data?.runtime.available || smoke.isPending}
					>
						{smoke.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Play className="size-4" />
						)}
						Run diagnostic
					</Button>
				</div>
			</div>

			<div className="mt-5 grid border border-stone-200 sm:grid-cols-2 lg:grid-cols-4 dark:border-neutral-800">
				{diagnostics.data?.identities.map((item, index) => {
					const ready = item.profileExists && Boolean(item.identity);
					return (
						<div
							key={item.provider}
							className={cn(
								"min-w-0 p-3",
								index > 0 && "border-t sm:border-t-0 sm:border-l",
								index === 2 && "sm:border-l-0 sm:border-t lg:border-l lg:border-t-0",
								"border-stone-200 dark:border-neutral-800",
							)}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-sm font-medium">
									{PROVIDER_LABELS[item.provider] ?? item.provider}
								</span>
								{ready ? (
									<CheckCircle2 className="size-4 text-emerald-600" />
								) : (
									<AlertTriangle className="size-4 text-amber-600" />
								)}
							</div>
							<p className="mt-2 truncate text-xs text-stone-500">
								{item.identity ? "Persistent identity" : item.profileExists ? "Profile ready" : "No profile"}
							</p>
						</div>
					);
				})}
			</div>

			<div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
				<span>
					Runtime {diagnostics.data?.runtime.available ? "ready" : "unavailable"}
					{" · "}
					{diagnostics.data?.openChallengeCount ?? 0} waiting for human
				</span>
				<Link
					href={`/runs?workspace=${props.workspaceId}`}
					className="font-medium text-stone-800 underline underline-offset-4 dark:text-stone-200"
				>
					Open run details
				</Link>
			</div>
		</section>
	);
}
