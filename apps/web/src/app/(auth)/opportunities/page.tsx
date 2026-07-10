"use client";

import {
	formPrimaryButtonClassName,
	formSecondaryButtonClassName,
} from "@/components/forms/auth-form-chrome";
import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import {
	Button,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	toast,
} from "@answerloom/ui";
import {
	FilePlus2,
	Loader2,
	RefreshCw,
	SquareArrowOutUpRight,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const OPTIMIZATION_KINDS = [
	["article", "Explainer article"],
	["product_page", "Product page"],
	["comparison_page", "Comparison page"],
	["alternative_page", "Alternative page"],
	["page_blueprint", "New page blueprint"],
	["faq", "FAQ"],
	["knowledge_base", "Knowledge base"],
	["listicle", "List article"],
	["title_optimization", "Title optimization"],
	["schema_html_fix", "Schema / HTML fix"],
] as const;

export default function OpportunitiesPage() {
	const workspaceId = useSafeSearchParams().get("workspace") ?? "";
	const utils = api.useUtils();
	const [seriesId, setSeriesId] = useState("");
	const [typeFilter, setTypeFilter] = useState("all");
	const [kindByOpportunity, setKindByOpportunity] = useState<
		Record<string, string>
	>({});
	const runs = api.geo.runs.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId },
	);
	const formalBaselines = (runs.data ?? []).filter(
		(series) => series.promptSet?.purpose === "baseline",
	);
	useEffect(() => {
		if (!seriesId && formalBaselines[0]?.id) setSeriesId(formalBaselines[0].id);
	}, [formalBaselines, seriesId]);
	const query = api.geo.opportunities.useQuery(
		{ workspaceId, seriesId: seriesId || undefined },
		{ enabled: !!workspaceId },
	);
	const externalTasks = api.geo.externalEvidenceTasks.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId },
	);
	const refresh = api.geo.refreshOpportunities.useMutation({
		onSuccess: async () => {
			await Promise.all([
				utils.geo.opportunities.invalidate(),
				utils.geo.externalEvidenceTasks.invalidate(),
			]);
			toast.success("Baseline diagnosis refreshed");
		},
		onError: (error) => toast.error(error.message),
	});
	const draft = api.geo.generateOptimization.useMutation({
		onSuccess: async () => {
			await utils.geo.content.invalidate();
			toast.success("Fact-constrained optimization created");
		},
		onError: (error) => toast.error(error.message),
	});
	const opportunities = (query.data ?? []).filter(
		(item) => typeFilter === "all" || item.type === typeFilter,
	);
	const opportunityTypes = [
		...new Set((query.data ?? []).map((item) => item.type)),
	];

	return (
		<div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
			<div className="flex flex-col gap-3 border-b border-stone-200 pb-5 dark:border-neutral-800 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h2 className="text-lg font-semibold">Baseline opportunities</h2>
					<p className="mt-1 text-sm text-stone-500">
						{query.data?.length ?? 0} traceable opportunities
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Select value={seriesId} onValueChange={setSeriesId}>
						<SelectTrigger className="w-[280px]">
							<SelectValue placeholder="Select formal baseline" />
						</SelectTrigger>
						<SelectContent>
							{formalBaselines.map((series) => (
								<SelectItem key={series.id} value={series.id}>
									{new Date(series.createdAt).toLocaleDateString()} ·{" "}
									{series.tier} · {series.completedSamples}/
									{series.plannedSamples}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={typeFilter} onValueChange={setTypeFilter}>
						<SelectTrigger className="w-[190px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All opportunity types</SelectItem>
							{opportunityTypes.map((type) => (
								<SelectItem key={type} value={type}>
									{type.replaceAll("_", " ")}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						className={formSecondaryButtonClassName}
						onClick={() =>
							refresh.mutate({ workspaceId, seriesId: seriesId || undefined })
						}
						disabled={!seriesId || refresh.isPending}
					>
						{refresh.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<RefreshCw className="size-4" />
						)}{" "}
						Diagnose
					</Button>
				</div>
			</div>

			<div className="divide-y divide-stone-200 border-b border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
				{opportunities.map((item) => {
					const kind = kindByOpportunity[item.id] ?? "article";
					const isExternal = item.type === "external_source_gap";
					return (
						<article
							key={item.id}
							className="grid gap-5 py-6 xl:grid-cols-[90px_minmax(0,1fr)_270px] xl:items-start"
						>
							<div>
								<span className="inline-flex bg-stone-950 px-2 py-1 text-xs font-semibold text-white dark:bg-white dark:text-black">
									{item.priority}
								</span>
								<p className="mt-2 text-[11px] text-stone-500">
									{item.effort ?? "medium"}
								</p>
								<p className="mt-1 text-[11px] text-stone-500">
									{item.confidence}% confidence
								</p>
							</div>
							<div className="min-w-0">
								<p className="text-xs font-medium uppercase text-stone-500">
									{item.type.replaceAll("_", " ")}
								</p>
								<h3 className="mt-1 font-semibold text-stone-950 dark:text-white">
									{item.title}
								</h3>
								<p className="mt-2 max-w-4xl text-sm leading-6 text-stone-600 dark:text-stone-400">
									{item.description}
								</p>
								{item.reason ? (
									<p className="mt-3 border-l-2 border-stone-300 pl-3 text-xs leading-5 text-stone-500 dark:border-neutral-700">
										{item.reason}
									</p>
								) : null}
								<div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-stone-500">
									<span>{(item.promptIds ?? []).length} prompts</span>
									<span>
										{(item.evidenceSampleIds ?? []).length} evidence samples
									</span>
									<span>
										baseline {item.baselineSeriesId?.slice(0, 8) ?? "unlinked"}
									</span>
								</div>
								{item.acceptanceMetric ? (
									<p className="mt-3 text-xs text-stone-500">
										<span className="font-medium text-stone-700 dark:text-stone-300">
											Acceptance:
										</span>{" "}
										{item.acceptanceMetric}
									</p>
								) : null}
							</div>
							<div className="grid gap-2">
								{isExternal ? (
									<Link
										href="#external-evidence"
										className={formSecondaryButtonClassName}
									>
										<SquareArrowOutUpRight className="size-4" /> View evidence
										tasks
									</Link>
								) : (
									<>
										<Select
											value={kind}
											onValueChange={(value) =>
												setKindByOpportunity((current) => ({
													...current,
													[item.id]: value,
												}))
											}
										>
											<SelectTrigger className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{OPTIMIZATION_KINDS.map(([value, label]) => (
													<SelectItem key={value} value={value}>
														{label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<Button
											className={formPrimaryButtonClassName}
											disabled={draft.isPending}
											onClick={() =>
												draft.mutate({
													workspaceId,
													opportunityId: item.id,
													kind,
												})
											}
										>
											{draft.isPending ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<FilePlus2 className="size-4" />
											)}{" "}
											Generate optimization
										</Button>
									</>
								)}
								<Link
									href={`/content?workspace=${workspaceId}`}
									className={formSecondaryButtonClassName}
								>
									Open content <SquareArrowOutUpRight className="size-4" />
								</Link>
							</div>
						</article>
					);
				})}
				{query.isLoading ? (
					<div className="py-14 text-center">
						<Loader2 className="mx-auto size-5 animate-spin text-stone-500" />
					</div>
				) : null}
				{!query.isLoading && opportunities.length === 0 ? (
					<div className="py-14 text-center text-sm text-stone-500">
						Select a formal baseline and run diagnosis.
					</div>
				) : null}
			</div>

			<section id="external-evidence" className="pt-8">
				<div className="mb-4">
					<h2 className="text-sm font-semibold">External evidence tasks</h2>
					<p className="mt-1 text-xs text-stone-500">
						Human-reviewed work only
					</p>
				</div>
				<div className="overflow-x-auto border-y border-stone-200 dark:border-neutral-800">
					<table className="w-full min-w-[760px] text-left text-sm">
						<thead className="border-b border-stone-200 text-xs text-stone-500 dark:border-neutral-800">
							<tr>
								<th className="px-3 py-3 font-medium">Channel</th>
								<th className="px-3 py-3 font-medium">Task</th>
								<th className="px-3 py-3 font-medium">Status</th>
								<th className="px-3 py-3 font-medium">Acceptance</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
							{externalTasks.data?.map((task) => (
								<tr key={task.id}>
									<td className="px-3 py-4 capitalize">
										{task.channel.replaceAll("_", " ")}
									</td>
									<td className="px-3 py-4">
										<p className="font-medium">{task.title}</p>
										<p className="mt-1 text-xs text-stone-500">
											{task.description}
										</p>
									</td>
									<td className="px-3 py-4 capitalize">{task.status}</td>
									<td className="px-3 py-4 text-xs text-stone-500">
										{task.acceptanceMetric ?? "-"}
									</td>
								</tr>
							))}
							{!externalTasks.data?.length ? (
								<tr>
									<td
										colSpan={4}
										className="px-3 py-10 text-center text-stone-500"
									>
										No external evidence tasks.
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
