"use client";

import {
	formPrimaryButtonClassName,
	formSecondaryButtonClassName,
} from "@/components/forms/auth-form-chrome";
import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import { type ProviderMode, getProviderModeLabel } from "@anspectra/types";
import {
	Button,
	Checkbox,
	ProviderLogo,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	toast,
} from "@anspectra/ui";
import { cn } from "@anspectra/utils";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	Loader2,
	RotateCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const WEB_PROVIDERS = ["doubao", "deepseek", "hunyuan", "qwen"] as const;

const PROVIDER_LABELS: Record<string, string> = {
	doubao: "Doubao",
	deepseek: "DeepSeek",
	hunyuan: "Yuanbao",
	qwen: "Qwen",
};

const statusTone: Record<string, string> = {
	completed:
		"bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
	running: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",
	retrying: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",
	waiting_human:
		"bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
	partial:
		"bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300",
	not_attempted:
		"bg-stone-100 text-stone-700 dark:bg-neutral-900 dark:text-stone-300",
	failed: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
};

function StatusPill({ status }: { status: string }) {
	return (
		<span
			className={cn(
				"inline-flex px-2 py-1 text-[11px] font-medium",
				statusTone[status] ??
					"bg-stone-100 text-stone-700 dark:bg-neutral-900 dark:text-stone-300",
			)}
		>
			{status.replaceAll("_", " ")}
		</span>
	);
}

function compactDate(value: Date | string | null | undefined) {
	return value ? new Date(value).toLocaleString() : "Not started";
}

function purposeLabel(purpose: string | null | undefined) {
	if (purpose === "baseline") return "Formal detection";
	if (purpose === "diagnostic") return "Provider diagnostic";
	if (purpose === "smoke") return "Legacy smoke test";
	if (purpose === "retest") return "Scheduled retest";
	return "Legacy collection";
}

function promptSetLocales(
	promptSet: {
		manifest: unknown;
		locales: string[];
	} | null,
): string[] {
	if (!promptSet) return [];
	const manifest = (promptSet.manifest ?? {}) as { locales?: string[] };
	return [
		...new Set(
			(manifest.locales?.length ? manifest.locales : promptSet.locales).filter(
				Boolean,
			),
		),
	].sort();
}

function localeLabel(locales: readonly string[]) {
	if (locales.length === 0) return "Unknown language";
	return locales
		.map((locale) => (locale === "zh-CN" ? "Chinese" : "English"))
		.join(" + ");
}

export default function RunsPage() {
	const searchParams = useSafeSearchParams();
	const workspaceId = searchParams.get("workspace") ?? "";
	const requestedSeriesId = searchParams.get("series") ?? "";
	const utils = api.useUtils();
	const [seriesId, setSeriesId] = useState(requestedSeriesId);
	const [providerFilter, setProviderFilter] = useState("all");
	const [statusFilter, setStatusFilter] = useState("all");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const runs = api.geo.runs.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId, refetchInterval: 5000 },
	);
	useEffect(() => {
		if (!runs.data?.length) return;
		if (seriesId && runs.data.some((series) => series.id === seriesId)) return;
		setSelected(new Set());
		setExpanded(new Set());
		setSeriesId(runs.data[0]?.id ?? "");
	}, [runs.data, seriesId]);
	const detail = api.geo.runDetail.useQuery(
		{ workspaceId, seriesId },
		{ enabled: !!workspaceId && !!seriesId, refetchInterval: 5000 },
	);
	const challenges = api.geo.challenges.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId, refetchInterval: 5000 },
	);
	const openWindow = api.geo.openChallenge.useMutation({
		onError: (error) => toast.error(error.message),
	});
	const resume = api.geo.resumeChallenge.useMutation({
		onSuccess: async () => {
			await Promise.all([
				utils.geo.runs.invalidate(),
				utils.geo.runDetail.invalidate(),
				utils.geo.challenges.invalidate(),
			]);
			toast.success("Verification resolved; unfinished samples requeued");
		},
		onError: (error) => toast.error(error.message),
	});
	const retry = api.geo.retrySamples.useMutation({
		onSuccess: async (result) => {
			setSelected(new Set());
			await Promise.all([
				utils.geo.runs.invalidate(),
				utils.geo.runDetail.invalidate(),
			]);
			toast.success(
				`${result.requeued} sample${result.requeued === 1 ? "" : "s"} requeued`,
			);
		},
		onError: (error) => toast.error(error.message),
	});
	const retryAnalysis = api.geo.retryAnalysis.useMutation({
		onSuccess: async (result) => {
			await utils.geo.runDetail.invalidate();
			toast.success(
				`${result.requeued} analysis ${result.requeued === 1 ? "retry" : "retries"} queued`,
			);
		},
		onError: (error) => toast.error(error.message),
	});

	const samples = useMemo(() => {
		return (detail.data?.samples ?? []).filter((sample) => {
			if (providerFilter !== "all" && sample.provider !== providerFilter)
				return false;
			if (statusFilter !== "all" && sample.status !== statusFilter)
				return false;
			return true;
		});
	}, [detail.data?.samples, providerFilter, statusFilter]);
	const selectedSeries = useMemo(
		() => runs.data?.find((series) => series.id === seriesId) ?? null,
		[runs.data, seriesId],
	);
	const retryableIds = useMemo(
		() =>
			samples
				.filter((sample) =>
					["failed", "not_attempted", "cancelled"].includes(sample.status),
				)
				.map((sample) => sample.id),
		[samples],
	);
	const allRetryableSelected =
		retryableIds.length > 0 && retryableIds.every((id) => selected.has(id));
	const selectedRunIds = useMemo(
		() => new Set((detail.data?.runs ?? []).map((run) => run.id)),
		[detail.data?.runs],
	);
	const currentChallenges = useMemo(
		() =>
			(challenges.data ?? []).filter((challenge) =>
				selectedRunIds.has(challenge.runId),
			),
		[challenges.data, selectedRunIds],
	);
	const otherChallenges = useMemo(
		() =>
			(challenges.data ?? []).filter(
				(challenge) => !selectedRunIds.has(challenge.runId),
			),
		[challenges.data, selectedRunIds],
	);

	const toggleSelected = (id: string) => {
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};
	const toggleExpanded = (id: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};
	const challengeRow = (
		challenge: NonNullable<typeof challenges.data>[number],
	) => (
		<div
			key={challenge.id}
			className="flex flex-wrap items-center justify-between gap-4 py-3"
		>
			<div>
				<p className="inline-flex items-center gap-2 font-medium">
					<ProviderLogo provider={challenge.provider} className="size-4" />
					{PROVIDER_LABELS[challenge.provider] ?? challenge.provider} ·{" "}
					{challenge.kind.replaceAll("_", " ")}
				</p>
				<p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/70">
					Run {challenge.runId.slice(0, 8)} · expires{" "}
					{new Date(challenge.expiresAt).toLocaleString()}
				</p>
			</div>
			<div className="flex gap-2">
				<Button
					className={formSecondaryButtonClassName}
					onClick={() =>
						openWindow.mutate({
							workspaceId,
							challengeId: challenge.id,
						})
					}
				>
					<ExternalLink className="size-4" /> Open window
				</Button>
				<Button
					className={cn(formPrimaryButtonClassName, "w-auto")}
					disabled={resume.isPending}
					onClick={() =>
						resume.mutate({ workspaceId, challengeId: challenge.id })
					}
				>
					{resume.isPending ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<RotateCw className="size-4" />
					)}{" "}
					I completed it
				</Button>
			</div>
		</div>
	);

	return (
		<div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
			{currentChallenges.length > 0 || otherChallenges.length > 0 ? (
				<section className="mb-7 border-y border-amber-200 bg-amber-50/70 px-4 py-5 dark:border-amber-900/60 dark:bg-amber-950/20">
					<div className="flex items-center gap-2">
						<AlertTriangle className="size-5 text-amber-700" />
						<h2 className="font-semibold text-amber-950 dark:text-amber-100">
							{currentChallenges.length > 0
								? "Verification for this baseline"
								: "Verification in other runs"}
						</h2>
					</div>
					{currentChallenges.length > 0 ? (
						<div className="mt-4 divide-y divide-amber-200 dark:divide-amber-900/50">
							{currentChallenges.map(challengeRow)}
						</div>
					) : null}
					{otherChallenges.length > 0 ? (
						<details className="mt-4 border-t border-amber-200 pt-3 dark:border-amber-900/50">
							<summary className="cursor-pointer text-sm font-medium text-amber-900 dark:text-amber-100">
								Other runs ({otherChallenges.length})
							</summary>
							<div className="mt-2 divide-y divide-amber-200 dark:divide-amber-900/50">
								{otherChallenges.map(challengeRow)}
							</div>
						</details>
					) : null}
				</section>
			) : null}

			<div className="flex flex-col gap-3 border-b border-stone-200 pb-5 dark:border-neutral-800 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h2 className="text-lg font-semibold">Collection series</h2>
					<p className="mt-1 text-sm text-stone-500">
						{selectedSeries
							? `${purposeLabel(selectedSeries.purpose)} · ${selectedSeries.promptSet?.name ?? "Deleted prompt set"} · ${localeLabel(promptSetLocales(selectedSeries.promptSet))}`
							: `${runs.data?.length ?? 0} versioned collection series`}
					</p>
				</div>
				<Select
					value={seriesId}
					onValueChange={(value) => {
						setSeriesId(value);
						setSelected(new Set());
						setExpanded(new Set());
					}}
				>
					<SelectTrigger className="w-full lg:w-[430px]">
						<SelectValue placeholder="Select a baseline series" />
					</SelectTrigger>
					<SelectContent>
						{runs.data?.map((series) => (
							<SelectItem key={series.id} value={series.id}>
								{compactDate(series.createdAt)} · {purposeLabel(series.purpose)}
								{" · "}
								{localeLabel(promptSetLocales(series.promptSet))} ·{" "}
								{series.status.replaceAll("_", " ")}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{detail.data ? (
				<>
					<section className="grid gap-px border-b border-stone-200 bg-stone-200 py-px dark:border-neutral-800 dark:bg-neutral-800 sm:grid-cols-2 lg:grid-cols-4">
						<div className="bg-white px-4 py-4 dark:bg-neutral-950">
							<p className="text-xs text-stone-500">Status</p>
							<div className="mt-2">
								<StatusPill status={detail.data.series.status} />
							</div>
						</div>
						<div className="bg-white px-4 py-4 dark:bg-neutral-950">
							<p className="text-xs text-stone-500">Completed</p>
							<p className="mt-1 text-xl font-semibold tabular-nums">
								{detail.data.series.completedSamples}/
								{detail.data.series.plannedSamples}
							</p>
						</div>
						<div className="bg-white px-4 py-4 dark:bg-neutral-950">
							<p className="text-xs text-stone-500">Collection failures</p>
							<p className="mt-1 text-xl font-semibold tabular-nums">
								{detail.data.series.failedSamples}
							</p>
						</div>
						<div className="bg-white px-4 py-4 dark:bg-neutral-950">
							<p className="text-xs text-stone-500">Planned runs</p>
							<p className="mt-1 text-xl font-semibold tabular-nums">
								{detail.data.series.roundCount}
							</p>
						</div>
					</section>

					<section className="py-6">
						<h3 className="text-sm font-semibold">Provider completion</h3>
						<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							{WEB_PROVIDERS.map((provider) => {
								const summary = detail.data.providerSummary[provider] ?? {
									total: 0,
									completed: 0,
									failed: 0,
									waitingHuman: 0,
									notAttempted: 0,
								};
								return (
									<button
										type="button"
										key={provider}
										onClick={() =>
											setProviderFilter(
												providerFilter === provider ? "all" : provider,
											)
										}
										className={cn(
											"border border-stone-200 p-3 text-left dark:border-neutral-800",
											providerFilter === provider &&
												"border-stone-950 dark:border-white",
										)}
									>
										<p className="inline-flex items-center gap-2 font-medium">
											<ProviderLogo provider={provider} className="size-4" />
											{PROVIDER_LABELS[provider]}
										</p>
										<p className="mt-3 text-lg font-semibold tabular-nums">
											{summary.completed}/{summary.total}
										</p>
										<p className="mt-1 text-xs text-stone-500">
											{summary.failed} failed · {summary.notAttempted} not
											attempted · {summary.waitingHuman} waiting
										</p>
									</button>
								);
							})}
						</div>
					</section>

					{detail.data.failureSummary.length > 0 ? (
						<section className="border-y border-stone-200 py-5 dark:border-neutral-800">
							<h3 className="text-sm font-semibold">Failure breakdown</h3>
							<div className="mt-3 flex flex-wrap gap-2">
								{detail.data.failureSummary.map((failure) => (
									<button
										type="button"
										key={`${failure.category}:${failure.code}`}
										onClick={() => setStatusFilter("failed")}
										className="border border-stone-200 px-3 py-2 text-left text-xs dark:border-neutral-800"
									>
										<span className="font-medium">{failure.category}</span>
										<span className="text-stone-400"> / </span>
										{failure.code?.replaceAll("_", " ")}
										<span className="ml-2 font-semibold tabular-nums">
											{failure.count}
										</span>
									</button>
								))}
							</div>
						</section>
					) : null}

					<section className="pt-6">
						<div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
							<div>
								<h3 className="text-sm font-semibold">Prompt checkpoints</h3>
								<p className="mt-1 text-xs text-stone-500">
									Select terminal collection failures to retry only those
									checkpoints. Completed samples are never repeated.
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Select
									value={providerFilter}
									onValueChange={setProviderFilter}
								>
									<SelectTrigger className="w-[140px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All providers</SelectItem>
										{WEB_PROVIDERS.map((provider) => (
											<SelectItem key={provider} value={provider}>
												<span className="inline-flex items-center gap-2">
													<ProviderLogo
														provider={provider}
														className="size-4"
													/>
													{PROVIDER_LABELS[provider]}
												</span>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Select value={statusFilter} onValueChange={setStatusFilter}>
									<SelectTrigger className="w-[150px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All statuses</SelectItem>
										{[
											"queued",
											"running",
											"waiting_human",
											"completed",
											"failed",
											"not_attempted",
											"cancelled",
										].map((status) => (
											<SelectItem key={status} value={status}>
												{status.replaceAll("_", " ")}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									className={cn(formPrimaryButtonClassName, "w-auto")}
									disabled={selected.size === 0 || retry.isPending}
									onClick={() =>
										retry.mutate({
											workspaceId,
											seriesId,
											checkpointIds: [...selected],
										})
									}
								>
									{retry.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<RotateCw className="size-4" />
									)}{" "}
									Retry collection · {selected.size || "selected"}
								</Button>
							</div>
						</div>

						<div className="overflow-x-auto border-y border-stone-200 dark:border-neutral-800">
							<table className="w-full min-w-[1280px] table-fixed text-left text-sm">
								<thead className="border-b border-stone-200 text-xs text-stone-500 dark:border-neutral-800">
									<tr>
										<th className="w-11 px-3 py-3">
											<Checkbox
												checked={allRetryableSelected}
												onCheckedChange={() =>
													setSelected(
														allRetryableSelected
															? new Set()
															: new Set(retryableIds),
													)
												}
												aria-label="Select retryable samples"
											/>
										</th>
										<th className="w-[34%] px-3 py-3 font-medium">Prompt</th>
										<th className="w-[9%] px-3 py-3 font-medium">Provider</th>
										<th className="w-[10%] px-3 py-3 font-medium">Stage</th>
										<th className="w-[10%] px-3 py-3 font-medium">
											Collection
										</th>
										<th className="w-[9%] px-3 py-3 font-medium">Phase</th>
										<th className="w-[10%] px-3 py-3 font-medium">Analysis</th>
										<th className="w-[14%] px-3 py-3 font-medium">Failure</th>
										<th className="w-24 px-3 py-3" />
									</tr>
								</thead>
								<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
									{samples.map((sample) => {
										const retryable = [
											"failed",
											"not_attempted",
											"cancelled",
										].includes(sample.status);
										const analysisRetryable =
											sample.status === "completed" &&
											sample.analysisStatus === "failed";
										const isExpanded = expanded.has(sample.id);
										return [
											<tr key={sample.id}>
												<td className="px-3 py-4 align-top">
													<Checkbox
														checked={selected.has(sample.id)}
														disabled={!retryable}
														onCheckedChange={() => toggleSelected(sample.id)}
														aria-label={`Select ${sample.provider} sample`}
													/>
												</td>
												<td className="px-3 py-4 align-top">
													<p className="line-clamp-3 leading-5">
														{sample.prompt?.prompt ?? "Deleted prompt"}
													</p>
													<p className="mt-2 text-[11px] text-stone-500">
														round {sample.repeatIndex + 1} ·{" "}
														{sample.prompt?.locale ?? "unknown"} ·{" "}
														{getProviderModeLabel(
															sample.provider,
															sample.requestedMode as ProviderMode,
														)}
													</p>
												</td>
												<td className="px-3 py-4 align-top">
													<span className="inline-flex items-center gap-2">
														<ProviderLogo
															provider={sample.provider}
															className="size-4"
														/>
														{PROVIDER_LABELS[sample.provider] ??
															sample.provider}
													</span>
												</td>
												<td className="px-3 py-4 align-top text-xs capitalize">
													{sample.prompt?.decisionStage ?? "unknown"}
												</td>
												<td className="px-3 py-4 align-top">
													<StatusPill status={sample.status} />
												</td>
												<td className="px-3 py-4 align-top text-xs capitalize">
													{sample.phase.replaceAll("_", " ")}
												</td>
												<td className="px-3 py-4 align-top">
													<StatusPill status={sample.analysisStatus} />
													{sample.analysisErrorCode ? (
														<p className="mt-2 text-[11px] text-red-600">
															{sample.analysisErrorCode.replaceAll("_", " ")}
														</p>
													) : null}
												</td>
												<td className="px-3 py-4 align-top text-xs">
													<p className="font-medium">
														{sample.failureCategory ?? "-"}
													</p>
													<p className="mt-1 break-words text-stone-500">
														{sample.errorCode?.replaceAll("_", " ") ?? "-"}
													</p>
												</td>
												<td className="px-3 py-4 align-top">
													<div className="flex items-center gap-1">
														{retryable ? (
															<Button
																variant="ghost"
																size="icon"
																title="Retry only this failed prompt collection"
																disabled={retry.isPending}
																onClick={() =>
																	retry.mutate({
																		workspaceId,
																		seriesId,
																		checkpointIds: [sample.id],
																	})
																}
															>
																<RotateCw className="size-4" />
															</Button>
														) : null}
														{analysisRetryable ? (
															<Button
																variant="ghost"
																size="icon"
																title="Retry analysis without collecting the prompt again"
																disabled={retryAnalysis.isPending}
																onClick={() =>
																	retryAnalysis.mutate({
																		workspaceId,
																		checkpointIds: [sample.id],
																	})
																}
															>
																{retryAnalysis.isPending ? (
																	<Loader2 className="size-4 animate-spin" />
																) : (
																	<RotateCw className="size-4" />
																)}
															</Button>
														) : null}
														<Button
															variant="ghost"
															size="icon"
															title="Attempt details"
															disabled={sample.attempts.length === 0}
															onClick={() => toggleExpanded(sample.id)}
														>
															{isExpanded ? (
																<ChevronDown className="size-4" />
															) : (
																<ChevronRight className="size-4" />
															)}
														</Button>
													</div>
												</td>
											</tr>,
											isExpanded ? (
												<tr
													key={`${sample.id}:attempts`}
													className="bg-stone-50/70 dark:bg-neutral-900/40"
												>
													<td />
													<td colSpan={8} className="px-3 py-4">
														<div className="grid gap-2">
															{sample.attempts.map((attempt) => (
																<div
																	key={attempt.id}
																	className="grid gap-2 border-l-2 border-stone-300 pl-3 text-xs dark:border-neutral-700 sm:grid-cols-[90px_120px_150px_minmax(0,1fr)]"
																>
																	<span>Attempt {attempt.attemptIndex}</span>
																	<span className="capitalize">
																		{attempt.phase.replaceAll("_", " ")}
																	</span>
																	<span>
																		{attempt.failureCode?.replaceAll(
																			"_",
																			" ",
																		) ?? attempt.status}
																	</span>
																	<span className="text-stone-500">
																		{attempt.failureMessage ??
																			attempt.pageUrl ??
																			compactDate(attempt.createdAt)}
																	</span>
																</div>
															))}
														</div>
													</td>
												</tr>
											) : null,
										];
									})}
									{samples.length === 0 ? (
										<tr>
											<td
												colSpan={9}
												className="px-3 py-14 text-center text-stone-500"
											>
												No samples match these filters.
											</td>
										</tr>
									) : null}
								</tbody>
							</table>
						</div>
					</section>
				</>
			) : detail.isLoading ? (
				<div className="flex h-64 items-center justify-center">
					<Loader2 className="size-5 animate-spin text-stone-500" />
				</div>
			) : (
				<div className="py-20 text-center text-sm text-stone-500">
					No GEO collection series yet.
				</div>
			)}
		</div>
	);
}
