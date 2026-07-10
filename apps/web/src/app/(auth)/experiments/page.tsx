"use client";

import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import { Button } from "@answerloom/ui";
import { cn } from "@answerloom/utils";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const statusTone: Record<string, string> = {
	completed: "text-emerald-700 dark:text-emerald-300",
	running: "text-sky-700 dark:text-sky-300",
	partial: "text-amber-700 dark:text-amber-300",
	scheduled: "text-stone-600 dark:text-stone-300",
	cancelled: "text-red-700 dark:text-red-300",
};

export default function ExperimentsPage() {
	const workspaceId = useSafeSearchParams().get("workspace") ?? "";
	const [selectedId, setSelectedId] = useState("");
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const experiments = api.geo.experiments.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId, refetchInterval: 10_000 },
	);
	useEffect(() => {
		if (!selectedId && experiments.data?.[0]?.id)
			setSelectedId(experiments.data[0].id);
	}, [experiments.data, selectedId]);
	const results = api.geo.experimentResults.useQuery(
		{ workspaceId, experimentId: selectedId },
		{
			enabled: !!workspaceId && !!selectedId,
			refetchInterval: 15_000,
			retry: false,
		},
	);
	const latestObservation = results.data?.observations
		.filter(
			(observation) =>
				observation.status === "completed" || observation.status === "partial",
		)
		.at(-1);
	const toggleExpanded = (key: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	return (
		<div className="grid min-h-[calc(100svh-3.5rem)] lg:grid-cols-[320px_minmax(0,1fr)]">
			<aside className="border-b border-stone-200 p-4 lg:border-b-0 lg:border-r dark:border-neutral-800">
				<h2 className="mb-4 text-sm font-semibold">Matched retests</h2>
				<div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
					{experiments.data?.map((experiment) => (
						<button
							type="button"
							key={experiment.id}
							onClick={() => setSelectedId(experiment.id)}
							className={cn(
								"block w-full px-3 py-4 text-left hover:bg-stone-50 dark:hover:bg-neutral-900",
								selectedId === experiment.id &&
									"bg-stone-100 dark:bg-neutral-900",
							)}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-sm font-medium">
									{new Date(experiment.createdAt).toLocaleDateString()}
								</span>
								<span
									className={cn(
										"text-xs capitalize",
										statusTone[experiment.status],
									)}
								>
									{experiment.status}
								</span>
							</div>
							<p className="mt-2 text-xs text-stone-500">
								{experiment.observations
									.map(
										(observation) =>
											`T+${observation.observationDay} ${observation.status}`,
									)
									.join(" · ")}
							</p>
							<p className="mt-1 font-mono text-[11px] text-stone-400">
								baseline {experiment.baselineSeriesId?.slice(0, 8) ?? "missing"}
							</p>
						</button>
					))}
					{!experiments.data?.length ? (
						<p className="py-12 text-center text-xs text-stone-500">
							No published interventions.
						</p>
					) : null}
				</div>
			</aside>

			<main className="min-w-0 p-4 sm:p-6 lg:p-8">
				{results.data ? (
					<>
						<div className="border-b border-stone-200 pb-5 dark:border-neutral-800">
							<p className="text-xs font-medium uppercase text-stone-500">
								Observed correlation
							</p>
							<h2 className="mt-1 text-xl font-semibold">
								Treatment and matched control
							</h2>
							<p className="mt-2 text-sm text-stone-500">
								{results.data.promptHashes?.length ?? 0} frozen prompt hashes ·
								fresh conversation per sample
							</p>
						</div>

						<section className="grid border-b border-stone-200 dark:border-neutral-800 sm:grid-cols-2 xl:grid-cols-4">
							<div className="border-b border-stone-200 px-3 py-5 sm:border-r xl:border-b-0 dark:border-neutral-800">
								<p className="text-xs text-stone-500">Baseline treatment</p>
								<p className="mt-1 text-2xl font-semibold tabular-nums">
									{results.data.baseline.treatment.mentionRate}%
								</p>
								<p className="mt-1 text-[11px] text-stone-500">
									{results.data.baseline.treatment.mentionCount}/
									{results.data.baseline.treatment.denominator} mentions
								</p>
							</div>
							<div className="border-b border-stone-200 px-3 py-5 xl:border-b-0 xl:border-r dark:border-neutral-800">
								<p className="text-xs text-stone-500">Baseline control</p>
								<p className="mt-1 text-2xl font-semibold tabular-nums">
									{results.data.baseline.control.mentionRate}%
								</p>
								<p className="mt-1 text-[11px] text-stone-500">
									{results.data.baseline.control.mentionCount}/
									{results.data.baseline.control.denominator} mentions
								</p>
							</div>
							<div className="border-b border-stone-200 px-3 py-5 sm:border-r sm:border-b-0 dark:border-neutral-800">
								<p className="text-xs text-stone-500">Latest treatment</p>
								<p className="mt-1 text-2xl font-semibold tabular-nums">
									{latestObservation
										? `${latestObservation.treatment.mentionRate}%`
										: "Pending"}
								</p>
								<p className="mt-1 text-[11px] text-stone-500">
									{latestObservation
										? `T+${latestObservation.observationDay}`
										: "Awaiting observation"}
								</p>
							</div>
							<div className="px-3 py-5">
								<p className="text-xs text-stone-500">
									Difference in differences
								</p>
								<p className="mt-1 text-2xl font-semibold tabular-nums">
									{latestObservation?.differenceInDifferences !== null &&
									latestObservation?.differenceInDifferences !== undefined
										? `${latestObservation.differenceInDifferences > 0 ? "+" : ""}${latestObservation.differenceInDifferences} pp`
										: latestObservation
											? "Insufficient control"
											: "Pending"}
								</p>
								<p className="mt-1 text-[11px] text-stone-500">
									Correlation, not causal proof
								</p>
							</div>
						</section>

						<section className="py-7">
							<h3 className="text-sm font-semibold">Observation windows</h3>
							<div className="mt-3 overflow-x-auto border-y border-stone-200 dark:border-neutral-800">
								<table className="w-full min-w-[900px] text-left text-sm">
									<thead className="border-b border-stone-200 text-xs text-stone-500 dark:border-neutral-800">
										<tr>
											<th className="px-3 py-3 font-medium">Window</th>
											<th className="px-3 py-3 font-medium">Status</th>
											<th className="px-3 py-3 font-medium">Treatment</th>
											<th className="px-3 py-3 font-medium">Control</th>
											<th className="px-3 py-3 font-medium">DiD</th>
											<th className="px-3 py-3 font-medium">95% interval</th>
											<th className="px-3 py-3 font-medium">Confidence</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
										{results.data.observations.map((observation) => (
											<tr key={observation.id}>
												<td className="px-3 py-4 font-medium">
													T+{observation.observationDay}
												</td>
												<td
													className={cn(
														"px-3 py-4 capitalize",
														statusTone[observation.status],
													)}
												>
													{observation.status}
												</td>
												<td className="px-3 py-4 tabular-nums">
													{observation.treatment.mentionRate}% (
													{observation.treatment.mentionCount}/
													{observation.treatment.denominator})
												</td>
												<td className="px-3 py-4 tabular-nums">
													{observation.control.mentionRate}% (
													{observation.control.mentionCount}/
													{observation.control.denominator})
												</td>
												<td className="px-3 py-4 tabular-nums">
													{observation.differenceInDifferences === null
														? "Insufficient control"
														: `${observation.differenceInDifferences > 0 ? "+" : ""}${observation.differenceInDifferences} pp`}
												</td>
												<td className="px-3 py-4 tabular-nums">
													{observation.pairedMentionChange
														? `${observation.pairedMentionChange.lower} to ${observation.pairedMentionChange.upper} pp`
														: "Insufficient samples"}
												</td>
												<td className="px-3 py-4 capitalize">
													{observation.confidence}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</section>

						<section>
							<div className="mb-3">
								<h3 className="text-sm font-semibold">
									Prompt-level answer comparison
								</h3>
								<p className="mt-1 text-xs text-stone-500">
									{results.data.pairs.length} prompt and provider pairs
								</p>
							</div>
							<div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
								{results.data.pairs.map((pair) => {
									const key = `${pair.promptId}:${pair.provider}`;
									const isExpanded = expanded.has(key);
									return (
										<div key={key}>
											<button
												type="button"
												onClick={() => toggleExpanded(key)}
												className="grid w-full gap-3 px-3 py-4 text-left sm:grid-cols-[90px_100px_minmax(0,1fr)_32px] sm:items-start"
											>
												<span className="text-xs font-medium capitalize">
													{pair.role}
												</span>
												<span className="text-xs capitalize text-stone-500">
													{pair.provider}
												</span>
												<span className="text-sm leading-5">{pair.prompt}</span>
												<span>
													{isExpanded ? (
														<ChevronDown className="size-4" />
													) : (
														<ChevronRight className="size-4" />
													)}
												</span>
											</button>
											{isExpanded ? (
												<div className="grid gap-5 bg-stone-50 px-3 py-5 dark:bg-neutral-900/40 lg:grid-cols-2">
													<div>
														<h4 className="text-xs font-semibold uppercase text-stone-500">
															Baseline answers
														</h4>
														<div className="mt-3 space-y-3">
															{pair.baseline.map((answer) => (
																<pre
																	key={answer.sampleId}
																	className="max-h-72 overflow-auto whitespace-pre-wrap border-l-2 border-stone-300 pl-3 text-xs leading-5 dark:border-neutral-700"
																>
																	{answer.response || `[${answer.status}]`}
																</pre>
															))}
															{pair.baseline.length === 0 ? (
																<p className="text-xs text-stone-500">
																	No valid baseline answer.
																</p>
															) : null}
														</div>
													</div>
													<div>
														<h4 className="text-xs font-semibold uppercase text-stone-500">
															Observation answers
														</h4>
														<div className="mt-3 space-y-4">
															{pair.observations.map((observation) => (
																<div key={observation.observationDay}>
																	<p className="mb-2 text-xs font-medium">
																		T+{observation.observationDay}
																	</p>
																	{observation.answers.map((answer) => (
																		<pre
																			key={answer.sampleId}
																			className="max-h-72 overflow-auto whitespace-pre-wrap border-l-2 border-stone-300 pl-3 text-xs leading-5 dark:border-neutral-700"
																		>
																			{answer.response || `[${answer.status}]`}
																		</pre>
																	))}
																	{observation.answers.length === 0 ? (
																		<p className="text-xs text-stone-500">
																			Pending or failed sample.
																		</p>
																	) : null}
																</div>
															))}
														</div>
													</div>
												</div>
											) : null}
										</div>
									);
								})}
							</div>
						</section>
					</>
				) : results.isLoading ? (
					<div className="flex min-h-[420px] items-center justify-center">
						<Loader2 className="size-5 animate-spin text-stone-500" />
					</div>
				) : (
					<div className="flex min-h-[420px] items-center justify-center text-sm text-stone-500">
						Select a matched retest.
					</div>
				)}
			</main>
		</div>
	);
}
