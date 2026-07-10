"use client";

import { api } from "@/trpc/react";
import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	Lightbulb,
	Radio,
} from "lucide-react";
import Link from "next/link";

export function GeoOverviewBand({ workspaceId }: { workspaceId: string }) {
	const query = api.geo.overview.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId, refetchInterval: 10_000 },
	);
	const scorecard = api.geo.scorecard.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId, refetchInterval: 30_000, retry: false },
	);
	const data = query.data;
	const baseline = scorecard.data;
	const layerRows = baseline
		? ([
				["Visibility", baseline.layers.visibility],
				["Factuality", baseline.layers.factuality],
				["Evidence", baseline.layers.evidence],
				["Stability", baseline.layers.stability],
				["Competition", baseline.layers.competition],
				["Governance", baseline.layers.governanceAttribution],
			] as const)
		: [];
	return (
		<section className="mb-6 border-y border-stone-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
			<div className="grid sm:grid-cols-2 xl:grid-cols-4">
				<div className="border-b border-stone-200 p-4 sm:border-r xl:border-b-0 dark:border-neutral-800">
					<div className="flex items-center gap-2 text-xs font-medium text-stone-500">
						<Radio className="size-4" /> Local runner
					</div>
					<p className="mt-2 text-sm font-semibold">
						{data?.runnerOnline ? "Online" : "Offline"}
					</p>
				</div>
				<Link
					href={`/runs?workspace=${workspaceId}`}
					className="group border-b border-stone-200 p-4 xl:border-b-0 xl:border-r dark:border-neutral-800"
				>
					<div className="flex items-center gap-2 text-xs font-medium text-stone-500">
						<AlertTriangle className="size-4" /> Verification tasks
					</div>
					<p className="mt-2 flex items-center justify-between text-sm font-semibold">
						<span>{data?.openChallenges ?? 0} open</span>
						<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
					</p>
				</Link>
				<Link
					href={`/opportunities?workspace=${workspaceId}`}
					className="group border-b border-stone-200 p-4 sm:border-r xl:border-b-0 dark:border-neutral-800"
				>
					<div className="flex items-center gap-2 text-xs font-medium text-stone-500">
						<Lightbulb className="size-4" /> Opportunities
					</div>
					<p className="mt-2 flex items-center justify-between text-sm font-semibold">
						<span>{data?.openOpportunities ?? 0} prioritized</span>
						<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
					</p>
				</Link>
				<Link href={`/content?workspace=${workspaceId}`} className="group p-4">
					<div className="flex items-center gap-2 text-xs font-medium text-stone-500">
						<CheckCircle2 className="size-4" /> Review queue
					</div>
					<p className="mt-2 flex items-center justify-between text-sm font-semibold">
						<span>{data?.contentAwaitingReview ?? 0} drafts</span>
						<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
					</p>
				</Link>
			</div>
			{baseline ? (
				<div className="border-t border-stone-200 dark:border-neutral-800">
					<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
						<div>
							<p className="text-xs font-semibold">Yao baseline scorecard</p>
							<p className="mt-1 text-[11px] text-stone-500">
								{baseline.completedSamples}/{baseline.denominator} samples ·{" "}
								{baseline.confidence} confidence
							</p>
						</div>
						<span
							className={
								baseline.complete
									? "text-xs font-medium text-emerald-700 dark:text-emerald-300"
									: "text-xs font-medium text-amber-700 dark:text-amber-300"
							}
						>
							{baseline.complete ? "Complete baseline" : "Provisional result"}
						</span>
					</div>
					<div className="grid border-t border-stone-200 dark:border-neutral-800 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
						{layerRows.map(([label, layer], index) => (
							<div
								key={label}
								className={`px-4 py-4 ${index < layerRows.length - 1 ? "border-b border-stone-200 sm:border-r xl:border-b-0 dark:border-neutral-800" : ""}`}
							>
								<p className="text-xs text-stone-500">{label}</p>
								<p className="mt-1 text-xl font-semibold tabular-nums">
									{layer.score === null ? "N/A" : `${layer.score}%`}
								</p>
								<p className="mt-1 text-[11px] text-stone-500 tabular-nums">
									{layer.numerator}/{layer.denominator}
								</p>
							</div>
						))}
					</div>
					{!baseline.complete ? (
						<p className="border-t border-stone-200 px-4 py-3 text-[11px] text-stone-500 dark:border-neutral-800">
							Missing:{" "}
							{[
								...baseline.missing.providers,
								...baseline.missing.intents,
								...baseline.missing.locales,
							].join(", ") ||
								`${Math.max(0, 90 - baseline.completionRate).toFixed(0)} points to the 90% completion gate`}
						</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}
