"use client";

import { formPrimaryButtonClassName } from "@/components/forms/auth-form-chrome";
import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
} from "@answerloom/ui";
import {
	AlertTriangle,
	ArrowRight,
	Bot,
	ExternalLink,
	Loader2,
	Radar,
	Search,
	Server,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const PROVIDER_LABELS: Record<string, string> = {
	doubao: "Doubao",
	deepseek: "DeepSeek",
	hunyuan: "Yuanbao",
	qwen: "Qwen",
};

function metricValue(value: number | null, suffix = "%") {
	return value === null ? "—" : `${value}${suffix}`;
}

function Metric(props: { label: string; value: string; detail?: string }) {
	return (
		<div className="min-w-0 border-r border-b border-stone-200 p-4 last:border-r-0 dark:border-neutral-800">
			<p className="text-xs font-medium text-stone-500">{props.label}</p>
			<p className="mt-2 text-2xl font-semibold tabular-nums">{props.value}</p>
			{props.detail ? (
				<p className="mt-1 truncate text-xs text-stone-500">{props.detail}</p>
			) : null}
		</div>
	);
}

export default function Dashboard() {
	const searchParams = useSafeSearchParams();
	const workspaceId = searchParams.get("workspace") ?? "";
	const requestedSeries = searchParams.get("series") ?? "";
	const [selectedSeries, setSelectedSeries] = useState(requestedSeries);
	const [sampleQuery, setSampleQuery] = useState("");
	const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
	const overview = api.geo.overview.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId), refetchInterval: 15_000 },
	);
	const runs = api.geo.runs.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId), refetchInterval: 15_000 },
	);
	const formalRuns = useMemo(
		() =>
			(runs.data ?? []).filter(
				(run) =>
					run.purpose === "baseline" && run.promptSet?.purpose === "baseline",
			),
		[runs.data],
	);
	useEffect(() => {
		if (!selectedSeries && formalRuns[0]) setSelectedSeries(formalRuns[0].id);
	}, [formalRuns, selectedSeries]);
	const report = api.geo.detectionReport.useQuery(
		{ workspaceId, seriesId: selectedSeries || undefined },
		{ enabled: Boolean(workspaceId), refetchInterval: 20_000, retry: false },
	);
	const trend = api.geo.detectionTrend.useQuery(
		{ workspaceId, seriesId: selectedSeries || undefined, limit: 12 },
		{ enabled: Boolean(workspaceId && selectedSeries), retry: false },
	);
	const selectedSample =
		report.data?.samples.find(
			(sample) => sample.checkpointId === selectedSampleId,
		) ?? null;
	const filteredSamples = useMemo(() => {
		const query = sampleQuery.trim().toLocaleLowerCase();
		return (report.data?.samples ?? []).filter(
			(sample) =>
				!query ||
				sample.prompt.toLocaleLowerCase().includes(query) ||
				sample.provider.includes(query) ||
				sample.intent.includes(query) ||
				(sample.errorCode ?? "").includes(query),
		);
	}, [report.data?.samples, sampleQuery]);

	if (!workspaceId)
		return (
			<div className="web-centered-state">
				Select a workspace to view detection results.
			</div>
		);
	if (overview.isLoading || runs.isLoading || report.isLoading) {
		return (
			<div className="web-centered-state">
				<Loader2 className="size-6 animate-spin text-stone-400" />
			</div>
		);
	}
	if (overview.error || runs.error || report.error) {
		return (
			<div className="web-centered-state">
				<div className="web-empty-state">
					<AlertTriangle className="mx-auto size-6 text-amber-500" />
					<h2 className="mt-3 text-lg font-semibold">
						Detection data could not be loaded
					</h2>
					<p className="mt-2 text-sm text-stone-500">
						{overview.error?.message ??
							runs.error?.message ??
							report.error?.message}
					</p>
				</div>
			</div>
		);
	}
	if (!report.data) {
		return (
			<div className="web-centered-state">
				<div className="web-empty-state">
					<Radar className="mx-auto size-7 text-cyan-600" />
					<h1 className="mt-4 text-xl font-semibold">
						No formal detection series yet
					</h1>
					<Link
						href={`/monitor?workspace=${workspaceId}`}
						className={`${formPrimaryButtonClassName} mt-5 inline-flex items-center gap-2`}
					>
						<Radar className="size-4" /> New Detection
					</Link>
				</div>
			</div>
		);
	}

	const overall = report.data.slices.overall[0];
	const providerRows = report.data.slices.provider;
	const exposureRows = report.data.slices.brand_exposure;
	const heatmap = new Map(
		report.data.slices.intent_stage.map((row) => [row.key, row]),
	);
	const intents = [
		...new Set(
			report.data.samples
				.map((sample) => sample.intent)
				.filter((value) => value !== "unknown"),
		),
	];
	const stages = [
		...new Set(
			report.data.samples
				.map((sample) => sample.decisionStage)
				.filter((value): value is string => Boolean(value)),
		),
	];

	return (
		<div className="web-page-wide">
			<div className="web-page-wide-inner space-y-7 py-6 sm:py-8">
				<header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-neutral-800">
					<div>
						<p className="text-xs font-semibold uppercase text-cyan-700 dark:text-cyan-300">
							Overview
						</p>
						<h1 className="mt-2 text-2xl font-semibold">
							GEO detection report
						</h1>
					</div>
					<select
						value={selectedSeries}
						onChange={(event) => setSelectedSeries(event.target.value)}
						className="h-10 max-w-full rounded-md border border-stone-200 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-950"
					>
						{formalRuns.map((run) => (
							<option key={run.id} value={run.id}>
								{new Date(run.createdAt).toLocaleString()} ·{" "}
								{run.promptSet?.name ?? "Detection"}
							</option>
						))}
					</select>
				</header>

				<section className="grid gap-3 sm:grid-cols-3">
					<div className="flex items-center gap-3 rounded-md border border-stone-200 p-4 dark:border-neutral-800">
						<Server
							className={`size-5 ${overview.data?.runnerOnline ? "text-emerald-600" : "text-amber-500"}`}
						/>
						<div>
							<p className="text-sm font-medium">Collector</p>
							<p className="text-xs text-stone-500">
								{overview.data?.runnerOnline ? "Online" : "Offline"}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-3 rounded-md border border-stone-200 p-4 dark:border-neutral-800">
						<Bot className="size-5 text-stone-500" />
						<div>
							<p className="text-sm font-medium">Series status</p>
							<p className="text-xs capitalize text-stone-500">
								{report.data.seriesStatus.replaceAll("_", " ")}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-3 rounded-md border border-stone-200 p-4 dark:border-neutral-800">
						<AlertTriangle
							className={`size-5 ${overview.data?.openChallenges ? "text-amber-500" : "text-stone-400"}`}
						/>
						<div>
							<p className="text-sm font-medium">Human checks</p>
							<p className="text-xs text-stone-500">
								{overview.data?.openChallenges ?? 0} open
							</p>
						</div>
					</div>
				</section>

				{report.data.provisional ? (
					<div className="flex items-center gap-2 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
						<AlertTriangle className="size-4" /> Provisional report: fewer than
						90% of planned samples are complete.
					</div>
				) : null}

				<section className="grid overflow-hidden rounded-md border border-stone-200 sm:grid-cols-3 xl:grid-cols-6 dark:border-neutral-800">
					<Metric
						label="Completion"
						value={metricValue(overall?.completionRate ?? 0)}
						detail={`${overall?.completed ?? 0}/${overall?.planned ?? 0} samples`}
					/>
					<Metric
						label="Mention rate"
						value={metricValue(overall?.mentionRate.value ?? 0)}
					/>
					<Metric
						label="Recommendation"
						value={metricValue(overall?.recommendationRate.value ?? 0)}
					/>
					<Metric
						label="Average rank"
						value={
							overall?.averageRank === null ||
							overall?.averageRank === undefined
								? "—"
								: overall.averageRank.toString()
						}
					/>
					<Metric
						label="Source exposure"
						value={metricValue(overall?.sourceExposureRate.value ?? 0)}
					/>
					<Metric
						label="Stability"
						value={metricValue(overall?.stability ?? null)}
						detail={`${report.data.samplingDepth} sampling`}
					/>
				</section>

				<section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
					<div className="min-w-0">
						<h2 className="text-base font-semibold">Intent × stage</h2>
						<div className="mt-4 overflow-auto border-y border-stone-200 dark:border-neutral-800">
							<table className="w-full min-w-[720px] text-center text-xs">
								<thead>
									<tr>
										<th className="px-3 py-3 text-left">Intent</th>
										{stages.map((stage) => (
											<th
												key={stage}
												className="px-3 py-3 capitalize text-stone-500"
											>
												{stage}
											</th>
										))}
									</tr>
								</thead>
								<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
									{intents.map((intent) => (
										<tr key={intent}>
											<th className="px-3 py-3 text-left font-medium capitalize">
												{intent.replaceAll("_", " ")}
											</th>
											{stages.map((stage) => {
												const cell = heatmap.get(`${intent}:${stage}`);
												const value = cell?.mentionRate.value ?? null;
												return (
													<td key={stage} className="px-2 py-2">
														<div
															className="rounded p-2 tabular-nums"
															style={{
																backgroundColor:
																	value === null
																		? "transparent"
																		: `color-mix(in srgb, #0891b2 ${Math.max(8, value)}%, transparent)`,
															}}
														>
															{value === null ? "—" : `${value}%`}
														</div>
													</td>
												);
											})}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
					<div>
						<h2 className="text-base font-semibold">Provider comparison</h2>
						<div className="mt-4 divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
							{providerRows.map((row) => (
								<div key={row.key} className="py-3">
									<div className="flex items-center justify-between text-sm">
										<span className="font-medium">
											{PROVIDER_LABELS[row.key] ?? row.label}
										</span>
										<span className="tabular-nums">
											{row.mentionRate.value}%
										</span>
									</div>
									<div className="mt-2 h-1.5 overflow-hidden rounded bg-stone-100 dark:bg-neutral-900">
										<div
											className="h-full bg-cyan-600"
											style={{ width: `${row.mentionRate.value}%` }}
										/>
									</div>
									<p className="mt-2 text-xs text-stone-500">
										{row.completed}/{row.planned} complete ·{" "}
										{row.recommendationRate.value}% recommended
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="grid gap-6 lg:grid-cols-2">
					<div>
						<h2 className="text-base font-semibold">Blind vs aided</h2>
						<div className="mt-4 grid grid-cols-2 gap-3">
							{exposureRows.map((row) => (
								<div
									key={row.key}
									className="rounded-md border border-stone-200 p-4 dark:border-neutral-800"
								>
									<p className="text-sm font-medium capitalize">{row.label}</p>
									<p className="mt-3 text-2xl font-semibold">
										{row.mentionRate.value}%
									</p>
									<p className="mt-1 text-xs text-stone-500">
										{row.recommendationRate.value}% recommended
									</p>
								</div>
							))}
						</div>
					</div>
					<div>
						<h2 className="text-base font-semibold">Comparable trend</h2>
						<div className="mt-4 divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
							{trend.data?.points.map((point) => (
								<div
									key={point.seriesId}
									className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 py-3 text-sm"
								>
									<span className="truncate text-stone-500">
										{new Date(point.createdAt).toLocaleDateString()}
									</span>
									<span className="tabular-nums">
										{point.mentionRate}% mention
									</span>
									<span className="tabular-nums">
										{point.recommendationRate}% recommend
									</span>
								</div>
							))}
							{!trend.data?.points.length ? (
								<p className="py-8 text-center text-sm text-stone-500">
									No comparable history.
								</p>
							) : null}
						</div>
					</div>
				</section>

				<section>
					<h2 className="text-base font-semibold">Competitor presence</h2>
					<div className="mt-4 overflow-auto border-y border-stone-200 dark:border-neutral-800">
						<table className="w-full min-w-[520px] text-left text-sm">
							<thead className="text-xs text-stone-500">
								<tr>
									<th className="px-3 py-3">Competitor</th>
									<th className="px-3 py-3">Mentions</th>
									<th className="px-3 py-3">Recommendations</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
								{report.data.competitors.map((competitor) => (
									<tr key={competitor.name}>
										<td className="px-3 py-3 font-medium">{competitor.name}</td>
										<td className="px-3 py-3 tabular-nums">
											{competitor.mentions}
										</td>
										<td className="px-3 py-3 tabular-nums">
											{competitor.recommendations}
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{!report.data.competitors.length ? (
							<p className="py-8 text-center text-sm text-stone-500">
								No analysed competitor mentions.
							</p>
						) : null}
					</div>
				</section>

				<section className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h2 className="text-base font-semibold">Sample evidence</h2>
						<Link
							href={`/runs?workspace=${workspaceId}&series=${report.data.seriesId}`}
							className="inline-flex items-center gap-1 text-sm text-cyan-700"
						>
							Operational details <ArrowRight className="size-4" />
						</Link>
					</div>
					<div className="flex items-center gap-2 border-y border-stone-200 p-3 dark:border-neutral-800">
						<Search className="size-4 text-stone-400" />
						<Input
							value={sampleQuery}
							onChange={(event) => setSampleQuery(event.target.value)}
							placeholder="Filter prompts, providers, or errors"
							className="border-0 shadow-none"
						/>
					</div>
					<div className="overflow-auto border-b border-stone-200 dark:border-neutral-800">
						<table className="w-full min-w-[800px] table-fixed text-left text-sm">
							<thead className="text-xs text-stone-500">
								<tr>
									<th className="w-28 px-3 py-3">Provider</th>
									<th className="w-28 px-3 py-3">Status</th>
									<th className="w-36 px-3 py-3">Dimension</th>
									<th className="px-3 py-3">Prompt</th>
									<th className="w-20 px-3 py-3" />
								</tr>
							</thead>
							<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
								{filteredSamples.map((sample) => (
									<tr key={sample.checkpointId}>
										<td className="px-3 py-3 font-medium">
											{PROVIDER_LABELS[sample.provider] ?? sample.provider}
										</td>
										<td className="px-3 py-3 text-xs">
											<span
												className={
													sample.status === "completed"
														? "text-emerald-700"
														: sample.status === "waiting_human"
															? "text-amber-700"
															: "text-red-700"
												}
											>
												{sample.status.replaceAll("_", " ")}
											</span>
											<br />
											<span className="text-stone-500">
												{sample.analysisStatus} analysis
											</span>
										</td>
										<td className="px-3 py-3 text-xs capitalize text-stone-500">
											{sample.intent.replaceAll("_", " ")}
											<br />
											{sample.decisionStage}
										</td>
										<td className="truncate px-3 py-3">{sample.prompt}</td>
										<td className="px-3 py-3">
											<Button
												variant="ghost"
												size="icon"
												aria-label="Open sample"
												onClick={() => setSelectedSampleId(sample.checkpointId)}
											>
												<ExternalLink className="size-4" />
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			</div>

			<Dialog
				open={Boolean(selectedSample)}
				onOpenChange={(open) => !open && setSelectedSampleId(null)}
			>
				<DialogContent className="max-h-[88vh] max-w-3xl overflow-auto">
					<DialogHeader>
						<DialogTitle>Sample evidence</DialogTitle>
						<DialogDescription>
							{selectedSample
								? `${PROVIDER_LABELS[selectedSample.provider] ?? selectedSample.provider} · ${selectedSample.locale} · ${selectedSample.status}`
								: ""}
						</DialogDescription>
					</DialogHeader>
					{selectedSample ? (
						<div className="space-y-5 text-sm">
							<div>
								<p className="text-xs font-semibold uppercase text-stone-500">
									Prompt
								</p>
								<p className="mt-2 leading-6">{selectedSample.prompt}</p>
							</div>
							<div>
								<p className="text-xs font-semibold uppercase text-stone-500">
									Answer
								</p>
								<div className="mt-2 whitespace-pre-wrap rounded-md bg-stone-50 p-4 leading-6 dark:bg-neutral-900">
									{selectedSample.response ??
										selectedSample.errorMessage ??
										"No answer was captured."}
								</div>
							</div>
							<div>
								<p className="text-xs font-semibold uppercase text-stone-500">
									Visible sources
								</p>
								<div className="mt-2 space-y-2">
									{selectedSample.sources.map((source) => (
										<a
											key={source.url}
											href={source.url}
											target="_blank"
											rel="noreferrer"
											className="block rounded-md border border-stone-200 p-3 hover:border-cyan-500 dark:border-neutral-800"
										>
											<span className="font-medium">{source.title}</span>
											<span className="mt-1 block truncate text-xs text-stone-500">
												{source.url}
											</span>
										</a>
									))}
									{!selectedSample.sources.length ? (
										<p className="text-stone-500">
											The Web page did not expose extractable links.
										</p>
									) : null}
								</div>
							</div>
							<dl className="grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-2 dark:border-neutral-800">
								<div>
									<dt className="text-xs text-stone-500">Conversation ID</dt>
									<dd className="mt-1 break-all">
										{selectedSample.conversationId ?? "Not captured"}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-stone-500">Conversation URL</dt>
									<dd className="mt-1 break-all">
										{selectedSample.conversationUrl ?? "Not captured"}
									</dd>
								</div>
							</dl>
						</div>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
}
