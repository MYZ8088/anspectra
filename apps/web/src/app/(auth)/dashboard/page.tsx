"use client";

import { formPrimaryButtonClassName } from "@/components/forms/auth-form-chrome";
import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/react";
import {
	type DetectionWeightedScore,
	type ProviderMode,
	getProviderModeLabel,
} from "@aloom/types";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
} from "@aloom/ui";
import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	ChevronDown,
	ExternalLink,
	Languages,
	Link2,
	Loader2,
	Radar,
	Search,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ReportData = NonNullable<RouterOutputs["geo"]["detectionReport"]>;
type ReportSlice = ReportData["slices"]["overall"][number];
type ReportSource = ReportData["samples"][number]["sources"][number];

const PROVIDER_LABELS: Record<string, string> = {
	doubao: "Doubao",
	deepseek: "DeepSeek",
	hunyuan: "Yuanbao",
	qwen: "Qwen",
};

const STAGE_SHORT_LABELS: Record<string, string> = {
	awareness: "Aware",
	screening: "Screen",
	evaluation: "Eval",
	purchase: "Buy",
	implementation: "Impl",
	review: "Review",
};

const SUITE_LABELS: Record<string, string> = {
	quick_scan: "Quick Scan",
	discovery: "Discovery",
	competitive_position: "Competitive Position",
	trust_risk: "Trust & Risk",
	buyer_journey: "Buyer Journey",
	full_matrix: "Full Matrix",
	filtered: "Filtered Preset",
};

function formatLabel(value: string) {
	return value.replaceAll("_", " ");
}

function percentage(value: number | null | undefined) {
	return value === null || value === undefined ? "Not assessed" : `${value}%`;
}

function Metric(props: {
	label: string;
	value: string;
	detail: string;
	accent?: boolean;
}) {
	return (
		<div className="min-w-0 py-2 sm:py-0">
			<p className="text-xs font-medium text-stone-500">{props.label}</p>
			<p
				className={`mt-2 text-3xl font-semibold tabular-nums ${props.accent ? "text-cyan-700 dark:text-cyan-300" : ""}`}
			>
				{props.value}
			</p>
			<p className="mt-1 text-xs text-stone-500">{props.detail}</p>
		</div>
	);
}

function ScoreLayers(props: { score: DetectionWeightedScore }) {
	return (
		<div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
			{props.score.layers.map((layer) => (
				<div key={layer.key} className="min-w-0">
					<div className="flex items-center justify-between gap-4 text-xs">
						<span className="text-stone-600 dark:text-stone-300">
							{layer.label}
						</span>
						<span className="font-medium tabular-nums text-stone-500">
							{layer.score === null ? "Not assessed" : `${layer.score}/100`}
						</span>
					</div>
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-neutral-900">
						<div
							className="h-full rounded-full bg-cyan-600"
							style={{ width: `${layer.score ?? 0}%` }}
						/>
					</div>
					<p className="mt-1 text-[11px] text-stone-400">
						{layer.weight}% of the weighted score
					</p>
				</div>
			))}
		</div>
	);
}

type ChartSeries = {
	label: string;
	color: string;
	values: number[];
};

function smoothPath(points: Array<{ x: number; y: number }>) {
	if (!points.length) return "";
	return points.slice(1).reduce(
		(path, point, index) => {
			const previous = points[index];
			if (!previous) return path;
			const middleX = (previous.x + point.x) / 2;
			return `${path} C ${middleX} ${previous.y}, ${middleX} ${point.y}, ${point.x} ${point.y}`;
		},
		`M ${points[0]?.x ?? 0} ${points[0]?.y ?? 0}`,
	);
}

function LineChart(props: {
	ariaLabel: string;
	labels: string[];
	series: ChartSeries[];
	emptyMessage: string;
}) {
	if (
		!props.labels.length ||
		!props.series.some((item) => item.values.length)
	) {
		return (
			<div className="flex aspect-[16/7] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-neutral-800">
				{props.emptyMessage}
			</div>
		);
	}

	const width = 720;
	const height = 280;
	const left = 42;
	const right = 18;
	const top = 18;
	const bottom = 44;
	const plotWidth = width - left - right;
	const plotHeight = height - top - bottom;
	const xFor = (index: number) =>
		props.labels.length === 1
			? left + plotWidth / 2
			: left + (index / (props.labels.length - 1)) * plotWidth;
	const yFor = (value: number) =>
		top + (1 - Math.max(0, Math.min(100, value)) / 100) * plotHeight;
	const yTicks = [0, 25, 50, 75, 100];

	return (
		<div>
			<div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-stone-500">
				{props.series.map((item) => (
					<span key={item.label} className="inline-flex items-center gap-2">
						<span
							className="h-0.5 w-5"
							style={{ backgroundColor: item.color }}
						/>
						{item.label}
					</span>
				))}
			</div>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				role="img"
				aria-label={props.ariaLabel}
				className="aspect-[16/7] w-full"
			>
				{yTicks.map((tick) => {
					const y = yFor(tick);
					return (
						<g key={tick}>
							<line
								x1={left}
								x2={width - right}
								y1={y}
								y2={y}
								stroke="currentColor"
								className="text-stone-200 dark:text-neutral-800"
								strokeWidth="1"
							/>
							<text
								x={left - 10}
								y={y + 4}
								textAnchor="end"
								className="fill-stone-400 text-[10px]"
							>
								{tick}%
							</text>
						</g>
					);
				})}
				{props.series.map((item) => {
					const points = item.values.map((value, index) => ({
						x: xFor(index),
						y: yFor(value),
					}));
					return (
						<g key={item.label}>
							<path
								d={smoothPath(points)}
								fill="none"
								stroke={item.color}
								strokeWidth="3"
								strokeLinecap="round"
							/>
							{points.map((point, index) => (
								<circle
									key={`${item.label}:${props.labels[index]}`}
									cx={point.x}
									cy={point.y}
									r="4"
									fill="white"
									stroke={item.color}
									strokeWidth="2.5"
								>
									<title>{`${props.labels[index]}: ${item.label} ${item.values[index]}%`}</title>
								</circle>
							))}
						</g>
					);
				})}
				{props.labels.map((label, index) => (
					<text
						key={label}
						x={xFor(index)}
						y={height - 14}
						textAnchor="middle"
						className="fill-stone-500 text-[10px]"
					>
						{label.length > 15 ? `${label.slice(0, 13)}...` : label}
					</text>
				))}
			</svg>
		</div>
	);
}

function ProviderReport(props: { rows: ReportData["slices"]["provider"] }) {
	return (
		<div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
			{props.rows.map((row) => (
				<div
					key={row.key}
					className="grid gap-5 py-5 md:grid-cols-[minmax(150px,1fr)_90px_minmax(0,2fr)] md:items-center"
				>
					<div>
						<p className="font-semibold">
							{PROVIDER_LABELS[row.key] ?? row.label}
						</p>
						<p className="mt-1 text-xs text-stone-500">
							{row.completed}/{row.planned} collected, {row.analysed} analysed
						</p>
					</div>
					<div>
						<p className="text-3xl font-semibold tabular-nums">
							{row.weightedScore.overall}
						</p>
						<p className="text-xs text-stone-500">GEO score</p>
					</div>
					<div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
						{[
							["Mention", row.mentionRate.value],
							["Recommend", row.recommendationRate.value],
							["Search", row.searchSourceExposureRate.value],
							["Answer links", row.answerLinkExposureRate.value],
							["Language", row.answerLanguageMatchRate.value],
						].map(([label, value]) => (
							<div key={String(label)}>
								<div className="flex items-center justify-between gap-2 text-xs">
									<span className="text-stone-500">{label}</span>
									<span className="font-medium tabular-nums">{value}%</span>
								</div>
								<div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-100 dark:bg-neutral-900">
									<div
										className="h-full rounded-full bg-cyan-600"
										style={{ width: `${value}%` }}
									/>
								</div>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function IntentStageHeatmap(props: {
	intents: string[];
	stages: string[];
	heatmap: Map<string, ReportSlice>;
}) {
	return (
		<div className="border-y border-stone-200 dark:border-neutral-800">
			<div
				className="grid items-center text-center text-[10px] sm:text-xs"
				style={{
					gridTemplateColumns: `minmax(82px, 1.45fr) repeat(${props.stages.length}, minmax(0, 1fr))`,
				}}
			>
				<div className="px-2 py-3 text-left font-medium">Intent</div>
				{props.stages.map((stage) => (
					<div
						key={stage}
						className="min-w-0 px-0.5 py-3 text-stone-500"
						title={formatLabel(stage)}
					>
						<span className="md:hidden">
							{STAGE_SHORT_LABELS[stage] ?? stage.slice(0, 5)}
						</span>
						<span className="hidden capitalize md:inline">
							{formatLabel(stage)}
						</span>
					</div>
				))}
				{props.intents.map((intent) => (
					<div key={intent} className="contents">
						<div className="border-t border-stone-100 px-2 py-2.5 text-left font-medium capitalize leading-tight dark:border-neutral-900">
							{formatLabel(intent)}
						</div>
						{props.stages.map((stage) => {
							const value = props.heatmap.get(`${intent}:${stage}`)?.mentionRate
								.value;
							return (
								<div
									key={`${intent}:${stage}`}
									className="border-t border-stone-100 p-1 dark:border-neutral-900"
								>
									<div
										className="flex h-8 items-center justify-center rounded-[4px] tabular-nums"
										style={{
											backgroundColor:
												value === undefined
													? "transparent"
													: `color-mix(in srgb, #0891b2 ${Math.max(8, value)}%, transparent)`,
										}}
									>
										{value === undefined ? "-" : `${value}%`}
									</div>
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}

function SampleLanguage(props: {
	responseLanguage: string;
	languageMatch: boolean | null;
	promptLocale: string;
}) {
	if (props.languageMatch === null) {
		return <span className="text-xs text-stone-400">Unknown language</span>;
	}
	return (
		<span
			className={`inline-flex items-center gap-1 text-xs font-medium ${props.languageMatch ? "text-cyan-700 dark:text-cyan-300" : "text-red-700 dark:text-red-300"}`}
		>
			{props.languageMatch ? (
				<CheckCircle2 className="size-3.5" />
			) : (
				<AlertTriangle className="size-3.5" />
			)}
			{props.languageMatch
				? `${props.responseLanguage} response`
				: `${props.responseLanguage} response / expected ${props.promptLocale}`}
		</span>
	);
}

function sourceCount(
	sources: ReportSource[],
	kind: ReportSource["sourceKind"],
) {
	return new Set(
		sources
			.filter((source) => source.sourceKind === kind)
			.map((source) => source.url),
	).size;
}

function SampleSourceSummary(props: {
	sources: ReportSource[];
	reportedSearchSourceCount: number | null;
}) {
	const searchSources = sourceCount(props.sources, "search_source");
	const answerLinks = sourceCount(props.sources, "answer_link");
	const legacySources = sourceCount(props.sources, "legacy_unknown");
	return (
		<span>
			{searchSources}
			{props.reportedSearchSourceCount
				? `/${props.reportedSearchSourceCount}`
				: ""}{" "}
			search sources / {answerLinks} answer links
			{legacySources ? ` / ${legacySources} legacy` : ""}
		</span>
	);
}

function SourceList(props: {
	title: string;
	description: string;
	sources: ReportSource[];
	emptyMessage: string;
}) {
	return (
		<div>
			<p className="text-xs font-semibold text-stone-500">{props.title}</p>
			<p className="mt-1 text-xs leading-5 text-stone-400">
				{props.description}
			</p>
			<div className="mt-3 divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
				{props.sources.map((source) => (
					<a
						key={`${source.sourceKind}:${source.url}`}
						href={source.url}
						target="_blank"
						rel="noreferrer"
						className="block py-3 hover:text-cyan-700"
					>
						<span className="font-medium">{source.title}</span>
						<span className="mt-1 block truncate text-xs text-stone-500">
							{source.url}
						</span>
					</a>
				))}
				{!props.sources.length ? (
					<p className="py-4 text-stone-500">{props.emptyMessage}</p>
				) : null}
			</div>
		</div>
	);
}

export default function Dashboard() {
	const searchParams = useSafeSearchParams();
	const workspaceId = searchParams.get("workspace") ?? "";
	const requestedSeries = searchParams.get("series") ?? "";
	const [selectedSeries, setSelectedSeries] = useState(requestedSeries);
	const [sampleQuery, setSampleQuery] = useState("");
	const [showAllSamples, setShowAllSamples] = useState(false);
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
	const selectedRun = formalRuns.find((run) => run.id === selectedSeries);
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
				sample.response?.toLocaleLowerCase().includes(query) ||
				sample.provider.includes(query) ||
				sample.intent.includes(query) ||
				sample.requestedMode.includes(query) ||
				(sample.errorCode ?? "").includes(query),
		);
	}, [report.data?.samples, sampleQuery]);
	const visibleSamples =
		showAllSamples || sampleQuery.trim()
			? filteredSamples
			: filteredSamples.slice(0, 12);

	if (!workspaceId) {
		return (
			<div className="web-centered-state">
				Select a workspace to view detection results.
			</div>
		);
	}
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
	const providerChartLabels = providerRows.map(
		(row) => PROVIDER_LABELS[row.key] ?? row.label,
	);
	const trendPoints = trend.data?.points ?? [];
	const trendLabels = trendPoints.map((point) =>
		new Date(point.createdAt).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		}),
	);
	const blind = exposureRows.find((row) => row.key === "blind");
	const aided = exposureRows.find((row) => row.key === "aided");

	return (
		<div className="web-page-wide bg-white dark:bg-neutral-950">
			<div className="mx-auto w-full max-w-[1240px] space-y-12 px-4 py-7 sm:px-7 sm:py-9 lg:px-10">
				<header className="flex flex-wrap items-end justify-between gap-5 border-b border-stone-200 pb-6 dark:border-neutral-800">
					<div>
						<p className="text-xs font-medium text-stone-500">
							{SUITE_LABELS[report.data.suiteKey]} / {report.data.samplingDepth}
						</p>
						<h1 className="mt-2 text-2xl font-semibold">
							{selectedRun?.promptSet?.name ?? "GEO detection report"}
						</h1>
						<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
							<span>{new Date(report.data.createdAt).toLocaleString()}</span>
							<span className="capitalize">
								{formatLabel(report.data.seriesStatus)}
							</span>
							<span>
								{overview.data?.runnerOnline
									? "Collector online"
									: "Collector offline"}
							</span>
						</div>
					</div>
					<select
						value={selectedSeries}
						onChange={(event) => setSelectedSeries(event.target.value)}
						className="h-10 max-w-full rounded-md border border-stone-200 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-950"
						aria-label="Detection series"
					>
						{formalRuns.map((run) => (
							<option key={run.id} value={run.id}>
								{new Date(run.createdAt).toLocaleString()} /{" "}
								{run.promptSet?.name ?? "Detection"}
							</option>
						))}
					</select>
				</header>

				{report.data.provisional ? (
					<div className="flex items-start gap-3 border-l-2 border-amber-500 px-4 py-1 text-sm text-stone-600 dark:text-stone-300">
						<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
						<p>
							This report is provisional because collection is incomplete or
							some score layers cannot yet be assessed.
						</p>
					</div>
				) : null}

				{overall ? (
					<section className="grid gap-10 border-y border-stone-200 py-8 lg:grid-cols-[220px_minmax(0,1fr)] dark:border-neutral-800">
						<div>
							<p className="text-xs font-medium text-stone-500">
								Aloom GEO Score v1
							</p>
							<div className="mt-3 flex items-end gap-2">
								<span className="text-6xl font-semibold tabular-nums text-cyan-700 dark:text-cyan-300">
									{overall.weightedScore.overall}
								</span>
								<span className="pb-2 text-sm text-stone-500">/ 100</span>
							</div>
							<p className="mt-3 text-xs leading-5 text-stone-500">
								{overall.weightedScore.coverage}% scoring coverage.{" "}
								{overall.weightedScore.provisional
									? "Use as a directional signal."
									: "All required score layers are available."}
							</p>
						</div>
						<div className="grid gap-x-8 gap-y-7 sm:grid-cols-2 xl:grid-cols-4">
							<Metric
								label="Completion"
								value={percentage(overall.completionRate)}
								detail={`${overall.completed} of ${overall.planned} planned samples`}
							/>
							<Metric
								label="Mention rate"
								value={percentage(overall.mentionRate.value)}
								detail={`${overall.mentionRate.numerator} observed mentions`}
								accent
							/>
							<Metric
								label="Recommendation"
								value={percentage(overall.recommendationRate.value)}
								detail={`${overall.recommendationRate.numerator} recommendation signals`}
							/>
							<Metric
								label="Average rank"
								value={
									overall.averageRank === null
										? "Not assessed"
										: overall.averageRank.toString()
								}
								detail="Absolute rank when the target appears"
							/>
						</div>
					</section>
				) : null}

				<section className="grid gap-10 xl:grid-cols-2">
					<div className="min-w-0">
						<div className="mb-6">
							<h2 className="text-lg font-semibold">Provider visibility</h2>
							<p className="mt-1 text-sm text-stone-500">
								Mention and recommendation rates across the selected official
								Web providers.
							</p>
						</div>
						<LineChart
							ariaLabel="Provider mention and recommendation rate chart"
							labels={providerChartLabels}
							series={[
								{
									label: "Mention rate",
									color: "#0891b2",
									values: providerRows.map((row) => row.mentionRate.value),
								},
								{
									label: "Recommendation rate",
									color: "#f97360",
									values: providerRows.map(
										(row) => row.recommendationRate.value,
									),
								},
							]}
							emptyMessage="No provider metrics are available."
						/>
					</div>
					<div className="min-w-0">
						<div className="mb-6">
							<h2 className="text-lg font-semibold">Comparable trend</h2>
							<p className="mt-1 text-sm text-stone-500">
								Only series with the same frozen detection configuration are
								compared.
							</p>
						</div>
						<LineChart
							ariaLabel="Comparable detection trend chart"
							labels={trendPoints.length > 1 ? trendLabels : []}
							series={[
								{
									label: "Mention rate",
									color: "#0891b2",
									values: trendPoints.map((point) => point.mentionRate),
								},
								{
									label: "Recommendation rate",
									color: "#f97360",
									values: trendPoints.map((point) => point.recommendationRate),
								},
							]}
							emptyMessage="Run the same detection set again to create a comparable trend."
						/>
					</div>
				</section>

				<section>
					<div className="mb-6 flex flex-wrap items-end justify-between gap-3">
						<div>
							<h2 className="text-lg font-semibold">AI provider reports</h2>
							<p className="mt-1 text-sm text-stone-500">
								Each provider is measured against its own planned samples.
							</p>
						</div>
						<p className="text-xs text-stone-500">
							Failures remain in the denominator.
						</p>
					</div>
					<ProviderReport rows={providerRows} />
					<details className="mt-5 border-b border-stone-200 pb-4 dark:border-neutral-800">
						<summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
							Detailed score composition <ChevronDown className="size-4" />
						</summary>
						<div className="mt-6 grid gap-8 lg:grid-cols-2">
							{providerRows.map((row) => (
								<div key={row.key}>
									<p className="mb-4 text-sm font-semibold">
										{PROVIDER_LABELS[row.key] ?? row.label}
									</p>
									<ScoreLayers score={row.weightedScore} />
								</div>
							))}
						</div>
					</details>
				</section>

				<section className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(270px,0.7fr)]">
					<div className="min-w-0">
						<div className="mb-6">
							<h2 className="text-lg font-semibold">Intent x decision stage</h2>
							<p className="mt-1 text-sm text-stone-500">
								Mention rate for every tested intent-stage cell.
							</p>
						</div>
						<IntentStageHeatmap
							intents={intents}
							stages={stages}
							heatmap={heatmap}
						/>
					</div>
					<div>
						<h2 className="text-lg font-semibold">Score composition</h2>
						<p className="mt-1 text-sm text-stone-500">
							Unavailable dimensions stay visible instead of becoming zero.
						</p>
						{overall ? (
							<div className="mt-6">
								<ScoreLayers score={overall.weightedScore} />
							</div>
						) : null}
					</div>
				</section>

				{overall ? (
					<section>
						<div className="mb-6">
							<h2 className="text-lg font-semibold">Evidence quality</h2>
							<p className="mt-1 text-sm text-stone-500">
								Language compliance and visible citations are measured
								separately from brand visibility.
							</p>
						</div>
						<div className="grid gap-8 border-y border-stone-200 py-7 md:grid-cols-2 xl:grid-cols-4 dark:border-neutral-800">
							<div className="flex gap-4">
								<Languages className="mt-1 size-5 shrink-0 text-cyan-700" />
								<div>
									<p className="text-sm font-medium">Answer language match</p>
									<p className="mt-2 text-3xl font-semibold tabular-nums">
										{overall.answerLanguageMatchRate.value}%
									</p>
									<p className="mt-1 text-xs text-stone-500">
										{overall.answerLanguageMatchRate.numerator} of{" "}
										{overall.answerLanguageMatchRate.denominator} collected
										answers
									</p>
								</div>
							</div>
							<div className="flex gap-4">
								<Search className="mt-1 size-5 shrink-0 text-cyan-700" />
								<div>
									<p className="text-sm font-medium">Search-source exposure</p>
									<p className="mt-2 text-3xl font-semibold tabular-nums">
										{overall.searchSourceExposureRate.value}%
									</p>
									<p className="mt-1 text-xs text-stone-500">
										Provider search cards, citation panels, and reference lists
										{overall.searchSourceUrlCoverageRate.denominator > 0
											? `; ${overall.searchSourceUrlCoverageRate.numerator}/${overall.searchSourceUrlCoverageRate.denominator} reported URLs extracted`
											: ""}
									</p>
								</div>
							</div>
							<div className="flex gap-4">
								<Link2 className="mt-1 size-5 shrink-0 text-cyan-700" />
								<div>
									<p className="text-sm font-medium">Answer-link exposure</p>
									<p className="mt-2 text-3xl font-semibold tabular-nums">
										{overall.answerLinkExposureRate.value}%
									</p>
									<p className="mt-1 text-xs text-stone-500">
										URLs or links rendered directly inside the generated answer
									</p>
								</div>
							</div>
							<div>
								<p className="text-sm font-medium">Blind to aided lift</p>
								<p className="mt-2 text-3xl font-semibold tabular-nums">
									{blind && aided
										? `${Math.round((aided.mentionRate.value - blind.mentionRate.value) * 100) / 100} pp`
										: "Not assessed"}
								</p>
								<p className="mt-1 text-xs text-stone-500">
									{blind && aided
										? `${blind.mentionRate.value}% blind vs ${aided.mentionRate.value}% aided`
										: "Both exposure cohorts are required"}
								</p>
							</div>
						</div>
					</section>
				) : null}

				<section className="grid gap-10 lg:grid-cols-2">
					<div>
						<h2 className="text-lg font-semibold">Executive readout</h2>
						<ul className="mt-5 space-y-4 text-sm leading-6 text-stone-600 dark:text-stone-300">
							{report.data.executiveSummary.map((statement) => (
								<li key={statement} className="flex gap-3">
									<span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-cyan-600" />
									<span>{statement}</span>
								</li>
							))}
						</ul>
					</div>
					<div>
						<h2 className="text-lg font-semibold">Competitor presence</h2>
						<div className="mt-5 divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
							{report.data.competitors.slice(0, 6).map((competitor) => (
								<div
									key={competitor.name}
									className="flex items-center justify-between gap-5 py-3 text-sm"
								>
									<span className="font-medium">{competitor.name}</span>
									<span className="text-right text-xs text-stone-500">
										{competitor.mentions} mentions /{" "}
										{competitor.recommendations} recommendations
									</span>
								</div>
							))}
							{!report.data.competitors.length ? (
								<p className="py-8 text-center text-sm text-stone-500">
									No analysed competitor mentions.
								</p>
							) : null}
						</div>
					</div>
				</section>

				{report.data.failures.length ? (
					<section>
						<div className="mb-5">
							<h2 className="text-lg font-semibold">Failures</h2>
							<p className="mt-1 text-sm text-stone-500">
								Collection and analysis failures are listed separately.
							</p>
						</div>
						<div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
							{report.data.failures.map((failure) => (
								<div
									key={`${failure.kind}:${failure.code}`}
									className="grid grid-cols-[110px_minmax(0,1fr)_auto] gap-4 py-3 text-sm"
								>
									<span className="capitalize text-stone-500">
										{failure.kind}
									</span>
									<span className="font-medium">
										{formatLabel(failure.code)}
									</span>
									<span className="tabular-nums text-red-700 dark:text-red-300">
										{failure.count}
									</span>
								</div>
							))}
						</div>
					</section>
				) : null}

				<section>
					<div className="flex flex-wrap items-end justify-between gap-4">
						<div>
							<h2 className="text-lg font-semibold">Sample evidence</h2>
							<p className="mt-1 text-sm text-stone-500">
								Open any answer to inspect the original text, sources, language,
								and conversation identity.
							</p>
						</div>
						<Link
							href={`/runs?workspace=${workspaceId}&series=${report.data.seriesId}`}
							className="inline-flex items-center gap-1 text-sm text-cyan-700"
						>
							Operational details <ArrowRight className="size-4" />
						</Link>
					</div>
					<div className="mt-6 flex items-center gap-2 border-y border-stone-200 px-1 py-3 dark:border-neutral-800">
						<Search className="size-4 text-stone-400" />
						<Input
							value={sampleQuery}
							onChange={(event) => setSampleQuery(event.target.value)}
							placeholder="Filter prompts, answers, providers, or errors"
							className="border-0 shadow-none"
						/>
					</div>
					<div className="divide-y divide-stone-200 dark:divide-neutral-800">
						{visibleSamples.map((sample) => (
							<button
								key={sample.checkpointId}
								type="button"
								onClick={() => setSelectedSampleId(sample.checkpointId)}
								className="grid w-full gap-3 py-4 text-left transition-colors hover:bg-stone-50 sm:grid-cols-[130px_minmax(0,1fr)_150px_32px] sm:items-center dark:hover:bg-neutral-900/50"
							>
								<div>
									<p className="text-sm font-medium">
										{PROVIDER_LABELS[sample.provider] ?? sample.provider}
									</p>
									<p className="mt-1 text-xs text-stone-500">
										{getProviderModeLabel(
											sample.provider,
											sample.actualMode ?? sample.requestedMode,
										)}
									</p>
								</div>
								<div className="min-w-0">
									<p className="line-clamp-2 text-sm leading-6">
										{sample.prompt}
									</p>
									<p className="mt-1 text-xs capitalize text-stone-500">
										{formatLabel(sample.intent)} /{" "}
										{sample.decisionStage
											? formatLabel(sample.decisionStage)
											: "Unknown stage"}
									</p>
								</div>
								<div className="flex items-center justify-between gap-4 sm:block">
									<SampleLanguage
										responseLanguage={sample.responseLanguage}
										languageMatch={sample.languageMatch}
										promptLocale={sample.locale}
									/>
									<p className="mt-1 text-xs text-stone-500">
										<SampleSourceSummary
											sources={sample.sources}
											reportedSearchSourceCount={
												sample.reportedSearchSourceCount
											}
										/>{" "}
										/ {formatLabel(sample.status)}
									</p>
								</div>
								<ExternalLink className="hidden size-4 text-stone-400 sm:block" />
							</button>
						))}
						{!visibleSamples.length ? (
							<p className="py-10 text-center text-sm text-stone-500">
								No matching samples.
							</p>
						) : null}
					</div>
					{!sampleQuery.trim() && filteredSamples.length > 12 ? (
						<Button
							variant="ghost"
							className="mt-4"
							onClick={() => setShowAllSamples((current) => !current)}
						>
							{showAllSamples
								? "Show fewer samples"
								: `Show all ${filteredSamples.length} samples`}
						</Button>
					) : null}
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
								? `${PROVIDER_LABELS[selectedSample.provider] ?? selectedSample.provider} / ${selectedSample.locale} / ${selectedSample.status}`
								: ""}
						</DialogDescription>
					</DialogHeader>
					{selectedSample ? (
						<div className="space-y-6 text-sm">
							<div>
								<p className="text-xs font-semibold text-stone-500">Prompt</p>
								<p className="mt-2 whitespace-pre-wrap leading-6">
									{selectedSample.prompt}
								</p>
							</div>
							<div>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<p className="text-xs font-semibold text-stone-500">Answer</p>
									<SampleLanguage
										responseLanguage={selectedSample.responseLanguage}
										languageMatch={selectedSample.languageMatch}
										promptLocale={selectedSample.locale}
									/>
								</div>
								<div className="mt-2 whitespace-pre-wrap rounded-md bg-stone-50 p-4 leading-6 dark:bg-neutral-900">
									{selectedSample.response ??
										selectedSample.errorMessage ??
										"No answer was captured."}
								</div>
							</div>
							{selectedSample.analysisStatus === "failed" ? (
								<div className="border-l-2 border-red-500 px-4 py-1">
									<p className="text-xs font-semibold text-red-700 dark:text-red-300">
										Analysis failed
									</p>
									<p className="mt-1 text-sm">
										{selectedSample.analysisErrorCode ?? "analysis_failed"}
										{selectedSample.analysisErrorMessage
											? `: ${selectedSample.analysisErrorMessage}`
											: ""}
									</p>
								</div>
							) : null}
							<SourceList
								title="Search sources"
								description={
									selectedSample.reportedSearchSourceCount
										? `URLs exposed by provider search cards, citation panels, or reference lists. ${sourceCount(selectedSample.sources, "search_source")} of ${selectedSample.reportedSearchSourceCount} provider-reported sources had extractable URLs.`
										: "URLs exposed by provider search cards, citation panels, or reference lists. The provider did not expose a numeric source total."
								}
								sources={selectedSample.sources.filter(
									(source) => source.sourceKind === "search_source",
								)}
								emptyMessage="The provider did not expose extractable search-source URLs. This does not mean no sources were consulted."
							/>
							<SourceList
								title="Answer links"
								description="URLs rendered directly in the generated answer body."
								sources={selectedSample.sources.filter(
									(source) => source.sourceKind === "answer_link",
								)}
								emptyMessage="The generated answer did not contain a directly extractable URL."
							/>
							{selectedSample.sources.some(
								(source) => source.sourceKind === "legacy_unknown",
							) ? (
								<SourceList
									title="Legacy unclassified sources"
									description="Captured before source-surface provenance was recorded."
									sources={selectedSample.sources.filter(
										(source) => source.sourceKind === "legacy_unknown",
									)}
									emptyMessage="No legacy sources."
								/>
							) : null}
							<dl className="grid gap-4 border-t border-stone-200 pt-5 sm:grid-cols-2 dark:border-neutral-800">
								<div>
									<dt className="text-xs text-stone-500">Official Web mode</dt>
									<dd className="mt-1">
										{getProviderModeLabel(
											selectedSample.provider,
											selectedSample.actualMode ?? selectedSample.requestedMode,
										)}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-stone-500">Answer size</dt>
									<dd className="mt-1 tabular-nums">
										{selectedSample.responseLength.toLocaleString()} characters
									</dd>
								</div>
								<div>
									<dt className="text-xs text-stone-500">
										Search-source coverage
									</dt>
									<dd className="mt-1 capitalize">
										{formatLabel(selectedSample.searchSourceCoverage)}
										{selectedSample.reportedSearchSourceCount
											? ` (${sourceCount(selectedSample.sources, "search_source")}/${selectedSample.reportedSearchSourceCount})`
											: ""}
									</dd>
								</div>
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
