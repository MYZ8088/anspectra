"use client";

import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import { Input } from "@anspectra/ui";
import { BookOpenText, Search } from "lucide-react";
import { useMemo, useState } from "react";

const INTENT_LABELS: Record<string, string> = {
	information: "Information",
	recommendation: "Recommendation",
	comparison: "Comparison",
	transaction: "Action",
	risk: "Risk",
	price: "Price",
	alternative: "Alternative",
	scenario: "Scenario",
	brand_validation: "Brand Validation",
};

export default function PromptPacksPage() {
	const workspaceId = useSafeSearchParams().get("workspace") ?? "";
	const [locale, setLocale] = useState("en-US");
	const [query, setQuery] = useState("");
	const [intent, setIntent] = useState("all");
	const catalog = api.geo.promptPacks.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId), staleTime: Number.POSITIVE_INFINITY },
	);
	const entries = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		return (
			catalog.data?.locales.find((pack) => pack.locale === locale)?.entries ??
			[]
		).filter(
			(entry) =>
				(intent === "all" || entry.intent === intent) &&
				(!normalized ||
					entry.prompt.toLocaleLowerCase().includes(normalized) ||
					entry.stage.includes(normalized)),
		);
	}, [catalog.data?.locales, intent, locale, query]);

	return (
		<div className="web-page-wide">
			<div className="web-page-wide-inner space-y-8 py-6 sm:py-8">
				<header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-neutral-800">
					<div>
						<p className="text-xs font-semibold uppercase text-cyan-700 dark:text-cyan-300">
							Prompt Packs
						</p>
						<h1 className="mt-2 text-2xl font-semibold">
							{catalog.data?.name ?? "Anspectra GEO Detection Pack"}
						</h1>
						<p className="mt-2 text-sm text-stone-500">
							Version {catalog.data?.version ?? "1.2.0"} · fixed and read-only
						</p>
					</div>
					<BookOpenText className="size-6 text-stone-400" />
				</header>

				<section>
					<h2 className="text-base font-semibold">Detection suites</h2>
					<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{catalog.data?.suites.map((suite) => (
							<div
								key={suite.key}
								className="rounded-md border border-stone-200 p-4 dark:border-neutral-800"
							>
								<div className="flex items-start justify-between gap-3">
									<p className="font-medium">{suite.label}</p>
									<span className="text-xs tabular-nums text-stone-500">
										{suite.corePromptCount}
									</span>
								</div>
								<p className="mt-3 text-xs leading-5 text-stone-500">
									{suite.intents.length} intents · {suite.stages.length} stages
								</p>
							</div>
						))}
					</div>
				</section>

				<section className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h2 className="text-base font-semibold">System templates</h2>
						<div className="flex gap-2">
							<select
								value={locale}
								onChange={(event) => setLocale(event.target.value)}
								className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-950"
							>
								<option value="en-US">English</option>
								<option value="zh-CN">Chinese</option>
							</select>
							<select
								value={intent}
								onChange={(event) => setIntent(event.target.value)}
								className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-950"
							>
								<option value="all">All intents</option>
								{Object.entries(INTENT_LABELS).map(([key, label]) => (
									<option key={key} value={key}>
										{label}
									</option>
								))}
							</select>
						</div>
					</div>
					<div className="flex items-center gap-2 border-y border-stone-200 p-3 dark:border-neutral-800">
						<Search className="size-4 text-stone-400" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search templates"
							className="border-0 shadow-none"
						/>
					</div>
					<div className="overflow-auto border-b border-stone-200 dark:border-neutral-800">
						<table className="w-full min-w-[760px] table-fixed text-left text-sm">
							<thead className="text-xs text-stone-500">
								<tr>
									<th className="w-36 px-3 py-3">Intent</th>
									<th className="w-32 px-3 py-3">Stage</th>
									<th className="w-24 px-3 py-3">Exposure</th>
									<th className="px-3 py-3">Template</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
								{entries.map((entry) => (
									<tr key={entry.key} className="align-top">
										<td className="px-3 py-3 text-xs font-medium">
											{INTENT_LABELS[entry.intent]}
										</td>
										<td className="px-3 py-3 text-xs capitalize text-stone-500">
											{entry.stage}
										</td>
										<td className="px-3 py-3 text-xs capitalize text-stone-500">
											{entry.brandExposure}
										</td>
										<td className="break-words px-3 py-3 leading-6">
											{entry.prompt}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			</div>
		</div>
	);
}
