"use client";

import {
	formPrimaryButtonClassName,
	formSecondaryButtonClassName,
} from "@/components/forms/auth-form-chrome";
import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import type {
	DetectionSuiteKey,
	GeoDecisionStage,
	GeoIntent,
	SamplingDepth,
} from "@answerloom/types";
import { GEO_DECISION_STAGE_LIST, GEO_INTENT_LIST } from "@answerloom/types";
import { Button, Checkbox, Input, toast } from "@answerloom/ui";
import { cn } from "@answerloom/utils";
import {
	CheckCircle2,
	ChevronDown,
	Globe2,
	Loader2,
	Play,
	Radar,
	Save,
	Search,
	ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type SelectableSuite = Exclude<DetectionSuiteKey, "filtered">;

const PROVIDERS = [
	["doubao", "Doubao"],
	["deepseek", "DeepSeek"],
	["hunyuan", "Yuanbao"],
	["qwen", "Qwen"],
] as const;

const INTENT_LABELS: Record<GeoIntent, string> = {
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

const STAGE_LABELS: Record<GeoDecisionStage, string> = {
	awareness: "Awareness",
	screening: "Screening",
	evaluation: "Evaluation",
	purchase: "Purchase",
	implementation: "Implementation",
	review: "Review",
};

function splitList(value: string): string[] {
	return [
		...new Set(
			value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
		),
	];
}

function Field(props: {
	id: string;
	label: string;
	value: string;
	placeholder: string;
	onChange: (value: string) => void;
}) {
	return (
		<label htmlFor={props.id} className="grid gap-1.5 text-sm">
			<span className="font-medium">{props.label}</span>
			<Input
				id={props.id}
				value={props.value}
				onChange={(event) => props.onChange(event.target.value)}
				placeholder={props.placeholder}
			/>
		</label>
	);
}

function ToggleGroup<T extends string>(props: {
	label: string;
	values: readonly T[];
	selected: T[];
	labelFor: (value: T) => string;
	onChange: (values: T[]) => void;
}) {
	return (
		<fieldset className="min-w-0">
			<legend className="mb-2 text-xs font-semibold uppercase text-stone-500">
				{props.label}
			</legend>
			<div className="flex flex-wrap gap-x-4 gap-y-2">
				{props.values.map((value) => {
					const inputId = `detection-filter-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${value}`;
					return (
						<label
							key={value}
							htmlFor={inputId}
							className="flex items-center gap-2 text-sm"
						>
							<Checkbox
								id={inputId}
								checked={props.selected.includes(value)}
								onCheckedChange={() =>
									props.onChange(
										props.selected.includes(value)
											? props.selected.filter((item) => item !== value)
											: [...props.selected, value],
									)
								}
							/>
							{props.labelFor(value)}
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}

export default function NewDetectionPage() {
	const router = useRouter();
	const workspaceId = useSafeSearchParams().get("workspace") ?? "";
	const utils = api.useUtils();
	const profileQuery = api.geo.profile.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const catalogQuery = api.geo.promptPacks.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId), staleTime: Number.POSITIVE_INFINITY },
	);
	const setsQuery = api.geo.promptSets.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const pagesQuery = api.geo.sitePages.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const factsQuery = api.geo.facts.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);

	const [brandName, setBrandName] = useState("");
	const [domain, setDomain] = useState("");
	const [category, setCategory] = useState("");
	const [products, setProducts] = useState("");
	const [competitors, setCompetitors] = useState("");
	const [audiences, setAudiences] = useState("");
	const [regions, setRegions] = useState("");
	const [aliases, setAliases] = useState("");
	const [industry, setIndustry] = useState("");
	const [market, setMarket] = useState("");
	const [budget, setBudget] = useState("");
	const [teamSize, setTeamSize] = useState("");
	const [implementationPeriod, setImplementationPeriod] = useState("");
	const [evidenceRequirement, setEvidenceRequirement] = useState("");
	const [locales, setLocales] = useState<Array<"zh-CN" | "en-US">>(["zh-CN"]);
	const [suiteKey, setSuiteKey] = useState<SelectableSuite>("quick_scan");
	const [samplingDepth, setSamplingDepth] = useState<SamplingDepth>("single");
	const [providers, setProviders] = useState<string[]>(
		PROVIDERS.map(([key]) => key),
	);
	const [intentFilter, setIntentFilter] = useState<GeoIntent[]>([]);
	const [stageFilter, setStageFilter] = useState<GeoDecisionStage[]>([]);
	const [exposureFilter, setExposureFilter] = useState<
		Array<"blind" | "aided">
	>([]);
	const [productFilter, setProductFilter] = useState<string[]>([]);
	const [competitorFilter, setCompetitorFilter] = useState<string[]>([]);
	const [audienceFilter, setAudienceFilter] = useState<string[]>([]);
	const [regionFilter, setRegionFilter] = useState<string[]>([]);
	const [promptSearch, setPromptSearch] = useState("");

	useEffect(() => {
		const profile = profileQuery.data;
		if (!profile) return;
		setBrandName(profile.brandName);
		setDomain(profile.officialDomain);
		setCategory(profile.category ?? "");
		setProducts((profile.products ?? []).join(", "));
		setCompetitors((profile.competitors ?? []).join(", "));
		setAudiences((profile.audiences ?? []).join(", "));
		setRegions((profile.regions ?? []).join(", "));
		setAliases((profile.aliases ?? []).join(", "));
		setIndustry(profile.industry ?? "");
		setMarket(profile.market ?? "");
		setBudget(profile.budget ?? "");
		setTeamSize(profile.teamSize ?? "");
		setImplementationPeriod(profile.implementationPeriod ?? "");
		setEvidenceRequirement(profile.evidenceRequirement ?? "");
		setLocales(
			(profile.locales ?? ["zh-CN"]).filter(
				(locale): locale is "zh-CN" | "en-US" =>
					locale === "zh-CN" || locale === "en-US",
			),
		);
	}, [profileQuery.data]);

	const activeSuite = catalogQuery.data?.suites.find(
		(suite) => suite.key === suiteKey,
	);
	const effectiveIntents = intentFilter.length
		? intentFilter
		: ((activeSuite?.intents ?? GEO_INTENT_LIST) as GeoIntent[]);
	const effectiveStages = stageFilter.length
		? stageFilter
		: ((activeSuite?.stages ?? GEO_DECISION_STAGE_LIST) as GeoDecisionStage[]);
	const effectiveExposures = exposureFilter.length
		? exposureFilter
		: (["blind", "aided"] as Array<"blind" | "aided">);
	const filterInput = {
		...(intentFilter.length ? { intents: intentFilter } : {}),
		...(stageFilter.length ? { stages: stageFilter } : {}),
		...(exposureFilter.length ? { brandExposures: exposureFilter } : {}),
		...(productFilter.length ? { products: productFilter } : {}),
		...(competitorFilter.length ? { competitors: competitorFilter } : {}),
		...(audienceFilter.length ? { audiences: audienceFilter } : {}),
		...(regionFilter.length ? { regions: regionFilter } : {}),
	};
	const previewQuery = api.geo.previewDetection.useQuery(
		{
			workspaceId,
			suiteKey,
			samplingDepth,
			locales,
			filters: filterInput,
			providerCount: providers.length || 1,
		},
		{
			enabled: Boolean(workspaceId && profileQuery.data && locales.length),
			retry: false,
		},
	);

	const scan = api.geo.suggestProfileFromSite.useMutation({
		onSuccess: async (suggestion) => {
			setBrandName(suggestion.candidate.brandName ?? brandName);
			setDomain(suggestion.candidate.officialDomain ?? domain);
			if (suggestion.candidate.products?.length)
				setProducts(suggestion.candidate.products.join(", "));
			await Promise.all([
				utils.geo.sitePages.invalidate(),
				utils.geo.facts.invalidate(),
			]);
			toast.success("Website scan completed");
		},
		onError: (error) => toast.error(error.message),
	});
	const save = api.geo.saveProfile.useMutation({
		onSuccess: async () => {
			await utils.geo.profile.invalidate();
			toast.success("Product profile saved");
		},
		onError: (error) => toast.error(error.message),
	});
	const confirm = api.geo.confirmBrandProfile.useMutation({
		onSuccess: async () => {
			await utils.geo.profile.invalidate();
			toast.success("Product profile confirmed");
		},
		onError: (error) => toast.error(error.message),
	});
	const createSet = api.geo.createDetectionSet.useMutation({
		onSuccess: async () => {
			await utils.geo.promptSets.invalidate();
			toast.success("Frozen detection set created");
		},
		onError: (error) => toast.error(error.message),
	});
	const start = api.geo.startDetection.useMutation({
		onSuccess: (result) => {
			toast.success("Detection series created");
			router.push(`/runs?workspace=${workspaceId}&series=${result.seriesId}`);
		},
		onError: (error) => toast.error(error.message),
	});

	const visiblePrompts = useMemo(() => {
		const query = promptSearch.trim().toLocaleLowerCase();
		return (previewQuery.data?.prompts ?? []).filter(
			(prompt) =>
				!query ||
				prompt.prompt.toLocaleLowerCase().includes(query) ||
				prompt.promptGroup.includes(query) ||
				prompt.decisionStage.includes(query),
		);
	}, [previewQuery.data?.prompts, promptSearch]);

	const saveProfile = () =>
		save.mutate({
			workspaceId,
			brandName: brandName.trim(),
			officialDomain: domain.trim(),
			aliases: splitList(aliases),
			products: splitList(products),
			category: category.trim(),
			industry: industry.trim(),
			market: market.trim(),
			audiences: splitList(audiences),
			competitors: splitList(competitors),
			regions: splitList(regions),
			locales,
			budget: budget.trim(),
			teamSize: teamSize.trim(),
			implementationPeriod: implementationPeriod.trim(),
			evidenceRequirement: evidenceRequirement.trim(),
		});

	if (!workspaceId) {
		return (
			<div className="web-centered-state">Select a workspace to begin.</div>
		);
	}

	return (
		<div className="web-page-wide">
			<div className="web-page-wide-inner space-y-10 py-6 sm:py-8">
				<header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-neutral-800">
					<div>
						<p className="text-xs font-semibold uppercase text-cyan-700 dark:text-cyan-300">
							New Detection
						</p>
						<h1 className="mt-2 text-2xl font-semibold">
							Measure product visibility
						</h1>
					</div>
					<div className="flex items-center gap-2 text-sm text-stone-500">
						<Radar className="size-4" /> Official Web sampling
					</div>
				</header>

				<section className="space-y-5 border-b border-stone-200 pb-10 dark:border-neutral-800">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h2 className="text-lg font-semibold">1. Product profile</h2>
						<span className="text-sm text-stone-500">
							{profileQuery.data?.confirmationStatus === "confirmed"
								? "Confirmed"
								: "Draft"}
						</span>
					</div>
					<div className="flex gap-2">
						<Input
							value={domain}
							onChange={(event) => setDomain(event.target.value)}
							placeholder="example.com"
						/>
						<Button
							className={formSecondaryButtonClassName}
							onClick={() => scan.mutate({ workspaceId, domain, maxPages: 12 })}
							disabled={!domain.trim() || scan.isPending}
						>
							{scan.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Globe2 className="size-4" />
							)}
							Scan
						</Button>
					</div>
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						<Field
							id="brand"
							label="Brand"
							value={brandName}
							onChange={setBrandName}
							placeholder="Brand name"
						/>
						<Field
							id="category"
							label="Category"
							value={category}
							onChange={setCategory}
							placeholder="Product category"
						/>
						<Field
							id="products"
							label="Products"
							value={products}
							onChange={setProducts}
							placeholder="Product A, Product B"
						/>
						<Field
							id="competitors"
							label="Competitors"
							value={competitors}
							onChange={setCompetitors}
							placeholder="Competitor A, Competitor B"
						/>
						<Field
							id="audiences"
							label="Audiences"
							value={audiences}
							onChange={setAudiences}
							placeholder="Product teams, buyers"
						/>
						<Field
							id="regions"
							label="Regions"
							value={regions}
							onChange={setRegions}
							placeholder="China, APAC"
						/>
						<Field
							id="aliases"
							label="Aliases"
							value={aliases}
							onChange={setAliases}
							placeholder="Brand aliases"
						/>
						<Field
							id="industry"
							label="Industry"
							value={industry}
							onChange={setIndustry}
							placeholder="B2B software"
						/>
						<Field
							id="market"
							label="Market"
							value={market}
							onChange={setMarket}
							placeholder="Enterprise software"
						/>
						<Field
							id="budget"
							label="Budget"
							value={budget}
							onChange={setBudget}
							placeholder="No fixed budget"
						/>
						<Field
							id="team"
							label="Team size"
							value={teamSize}
							onChange={setTeamSize}
							placeholder="20-50 people"
						/>
						<Field
							id="period"
							label="Implementation period"
							value={implementationPeriod}
							onChange={setImplementationPeriod}
							placeholder="Six weeks"
						/>
						<div className="md:col-span-2 xl:col-span-3">
							<Field
								id="evidence"
								label="Evidence requirement"
								value={evidenceRequirement}
								onChange={setEvidenceRequirement}
								placeholder="Cite dated, verifiable public sources"
							/>
						</div>
					</div>
					<ToggleGroup
						label="Prompt languages"
						values={["zh-CN", "en-US"] as const}
						selected={locales}
						labelFor={(value) => (value === "zh-CN" ? "Chinese" : "English")}
						onChange={(values) => values.length && setLocales(values)}
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							className={formPrimaryButtonClassName}
							onClick={saveProfile}
							disabled={save.isPending || !brandName || !domain}
						>
							{save.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Save className="size-4" />
							)}{" "}
							Save profile
						</Button>
						<Button
							className={formSecondaryButtonClassName}
							onClick={() => confirm.mutate({ workspaceId })}
							disabled={
								confirm.isPending ||
								profileQuery.data?.confirmationStatus === "confirmed"
							}
						>
							<ShieldCheck className="size-4" /> Confirm profile
						</Button>
					</div>
					<details className="border-y border-stone-200 py-3 dark:border-neutral-800">
						<summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
							Reference sources <ChevronDown className="size-4" />
						</summary>
						<div className="mt-4 grid gap-4 lg:grid-cols-2">
							<div className="space-y-2 text-sm">
								{(pagesQuery.data ?? []).slice(0, 8).map((page) => (
									<div
										key={page.id}
										className="min-w-0 border-b border-stone-100 pb-2 dark:border-neutral-900"
									>
										<p className="truncate font-medium">
											{page.title || page.url}
										</p>
										<p className="truncate text-xs text-stone-500">
											{page.url}
										</p>
									</div>
								))}
								{!pagesQuery.data?.length ? (
									<p className="text-stone-500">No scanned pages.</p>
								) : null}
							</div>
							<div className="space-y-2 text-sm">
								{(factsQuery.data ?? []).slice(0, 8).map((fact) => (
									<div
										key={fact.id}
										className="border-b border-stone-100 pb-2 dark:border-neutral-900"
									>
										<p className="font-medium">
											{fact.subject} · {fact.predicate}
										</p>
										<p className="text-xs text-stone-500">{fact.value}</p>
									</div>
								))}
								{!factsQuery.data?.length ? (
									<p className="text-stone-500">
										No extracted reference facts.
									</p>
								) : null}
							</div>
						</div>
					</details>
				</section>

				<section className="space-y-6 border-b border-stone-200 pb-10 dark:border-neutral-800">
					<h2 className="text-lg font-semibold">2. Detection design</h2>
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{catalogQuery.data?.suites.map((suite) => (
							<button
								key={suite.key}
								type="button"
								onClick={() => {
									setSuiteKey(suite.key);
									setIntentFilter([]);
									setStageFilter([]);
								}}
								className={cn(
									"rounded-md border p-4 text-left transition-colors",
									suiteKey === suite.key
										? "border-cyan-600 bg-cyan-50 dark:bg-cyan-950/20"
										: "border-stone-200 hover:border-stone-400 dark:border-neutral-800",
								)}
							>
								<span className="font-medium">{suite.label}</span>
								<span className="mt-2 block text-xs text-stone-500">
									{suite.corePromptCount} core prompts
								</span>
							</button>
						))}
					</div>
					<div className="grid gap-5 lg:grid-cols-2">
						<div>
							<p className="mb-2 text-xs font-semibold uppercase text-stone-500">
								Sampling depth
							</p>
							<div className="grid grid-cols-3 border border-stone-200 dark:border-neutral-800">
								{(["single", "reliable", "stability"] as SamplingDepth[]).map(
									(depth) => (
										<button
											key={depth}
											type="button"
											onClick={() => setSamplingDepth(depth)}
											className={cn(
												"h-10 border-r border-stone-200 text-sm capitalize last:border-r-0 dark:border-neutral-800",
												samplingDepth === depth
													? "bg-stone-900 text-white dark:bg-white dark:text-black"
													: "hover:bg-stone-50 dark:hover:bg-neutral-900",
											)}
										>
											{depth}
										</button>
									),
								)}
							</div>
						</div>
						<ToggleGroup
							label="Web providers"
							values={PROVIDERS.map(([key]) => key)}
							selected={providers}
							labelFor={(value) =>
								PROVIDERS.find(([key]) => key === value)?.[1] ?? value
							}
							onChange={(values) => values.length && setProviders(values)}
						/>
					</div>
					<details className="rounded-md border border-stone-200 p-4 dark:border-neutral-800">
						<summary className="flex cursor-pointer list-none items-center justify-between font-medium">
							Advanced dimensions <ChevronDown className="size-4" />
						</summary>
						<div className="mt-5 space-y-6">
							<ToggleGroup
								label="Intents"
								values={GEO_INTENT_LIST}
								selected={effectiveIntents}
								labelFor={(value) => INTENT_LABELS[value]}
								onChange={setIntentFilter}
							/>
							<ToggleGroup
								label="Decision stages"
								values={GEO_DECISION_STAGE_LIST}
								selected={effectiveStages}
								labelFor={(value) => STAGE_LABELS[value]}
								onChange={setStageFilter}
							/>
							<ToggleGroup
								label="Brand exposure"
								values={["blind", "aided"] as const}
								selected={effectiveExposures}
								labelFor={(value) => (value === "blind" ? "Blind" : "Aided")}
								onChange={setExposureFilter}
							/>
							{splitList(products).length ? (
								<ToggleGroup
									label="Products"
									values={splitList(products)}
									selected={
										productFilter.length ? productFilter : splitList(products)
									}
									labelFor={(value) => value}
									onChange={setProductFilter}
								/>
							) : null}
							{splitList(competitors).length ? (
								<ToggleGroup
									label="Competitors"
									values={splitList(competitors)}
									selected={
										competitorFilter.length
											? competitorFilter
											: splitList(competitors)
									}
									labelFor={(value) => value}
									onChange={setCompetitorFilter}
								/>
							) : null}
							{splitList(audiences).length ? (
								<ToggleGroup
									label="Audiences"
									values={splitList(audiences)}
									selected={
										audienceFilter.length
											? audienceFilter
											: splitList(audiences)
									}
									labelFor={(value) => value}
									onChange={setAudienceFilter}
								/>
							) : null}
							{splitList(regions).length ? (
								<ToggleGroup
									label="Regions"
									values={splitList(regions)}
									selected={
										regionFilter.length ? regionFilter : splitList(regions)
									}
									labelFor={(value) => value}
									onChange={setRegionFilter}
								/>
							) : null}
						</div>
					</details>

					<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
						<div className="min-w-0 overflow-hidden border-y border-stone-200 dark:border-neutral-800">
							<div className="flex items-center gap-2 border-b border-stone-200 p-3 dark:border-neutral-800">
								<Search className="size-4 text-stone-400" />
								<Input
									value={promptSearch}
									onChange={(event) => setPromptSearch(event.target.value)}
									placeholder="Filter the exact prompts"
									className="border-0 shadow-none"
								/>
							</div>
							<div className="max-h-[520px] overflow-auto">
								<table className="w-full min-w-[760px] table-fixed text-left text-sm">
									<thead className="sticky top-0 bg-white text-xs text-stone-500 dark:bg-neutral-950">
										<tr>
											<th className="w-32 px-3 py-3">Intent</th>
											<th className="w-28 px-3 py-3">Stage</th>
											<th className="w-20 px-3 py-3">Locale</th>
											<th className="w-20 px-3 py-3">Exposure</th>
											<th className="px-3 py-3">Prompt</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
										{visiblePrompts.map((prompt) => (
											<tr key={prompt.promptHash} className="align-top">
												<td className="px-3 py-3 text-xs font-medium">
													{INTENT_LABELS[prompt.promptGroup]}
												</td>
												<td className="px-3 py-3 text-xs text-stone-500">
													{STAGE_LABELS[prompt.decisionStage]}
												</td>
												<td className="px-3 py-3 text-xs text-stone-500">
													{prompt.locale}
												</td>
												<td className="px-3 py-3 text-xs capitalize text-stone-500">
													{prompt.brandExposure}
												</td>
												<td className="break-words px-3 py-3 leading-6">
													{prompt.prompt}
												</td>
											</tr>
										))}
									</tbody>
								</table>
								{previewQuery.isLoading ? (
									<div className="flex h-40 items-center justify-center">
										<Loader2 className="size-5 animate-spin" />
									</div>
								) : null}
							</div>
						</div>
						<aside className="self-start rounded-md border border-stone-200 p-4 dark:border-neutral-800">
							<p className="font-medium">Frozen set preview</p>
							<dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
								<div>
									<dt className="text-xs text-stone-500">Prompts</dt>
									<dd className="mt-1 font-semibold">
										{previewQuery.data?.promptCount ?? "-"}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-stone-500">Rounds</dt>
									<dd className="mt-1 font-semibold">
										{previewQuery.data?.roundCount ?? "-"}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-stone-500">Samples</dt>
									<dd className="mt-1 font-semibold">
										{previewQuery.data?.plannedSamples ?? "-"}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-stone-500">Minimum days</dt>
									<dd className="mt-1 font-semibold">
										{previewQuery.data?.estimatedMinimumDays ?? "-"}
									</dd>
								</div>
							</dl>
							{previewQuery.data?.complete ? (
								<p className="mt-4 flex items-center gap-2 text-xs text-emerald-700">
									<CheckCircle2 className="size-4" /> All entity coverage checks
									pass
								</p>
							) : null}
							<Button
								className={cn(formPrimaryButtonClassName, "mt-5 w-full")}
								disabled={
									!previewQuery.data?.complete ||
									!previewQuery.data.profileCompleteness.complete ||
									!previewQuery.data.profileCompleteness.confirmed ||
									createSet.isPending
								}
								onClick={() =>
									createSet.mutate({
										workspaceId,
										suiteKey,
										samplingDepth,
										locales,
										filters: filterInput,
									})
								}
							>
								{createSet.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Save className="size-4" />
								)}{" "}
								Create frozen set
							</Button>
						</aside>
					</div>
				</section>

				<section className="space-y-4">
					<h2 className="text-lg font-semibold">3. Run detection</h2>
					<div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
						{(setsQuery.data ?? [])
							.filter((set) => set.purpose === "baseline")
							.map((set) => {
								const manifest = set.manifest as {
									suiteKey?: string;
									samplingDepth?: string;
									expectedPromptHashes?: string[];
								};
								return (
									<div
										key={set.id}
										className="flex flex-wrap items-center justify-between gap-4 py-4"
									>
										<div className="min-w-0">
											<p className="truncate font-medium">{set.name}</p>
											<p className="mt-1 text-xs text-stone-500">
												{manifest.suiteKey?.replaceAll("_", " ") ??
													"legacy preset"}{" "}
												· {manifest.samplingDepth ?? set.tier} ·{" "}
												{set.prompts.length} prompts ·{" "}
												{manifest.expectedPromptHashes?.length ?? 0} hashes
											</p>
										</div>
										<Button
											className={formPrimaryButtonClassName}
											disabled={start.isPending || providers.length === 0}
											onClick={() =>
												start.mutate({
													workspaceId,
													promptSetId: set.id,
													providers: providers as Array<
														"doubao" | "deepseek" | "hunyuan" | "qwen"
													>,
												})
											}
										>
											{start.isPending ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<Play className="size-4" />
											)}{" "}
											Run
										</Button>
									</div>
								);
							})}
						{!setsQuery.data?.some((set) => set.purpose === "baseline") ? (
							<p className="py-10 text-center text-sm text-stone-500">
								No frozen detection sets yet.
							</p>
						) : null}
					</div>
				</section>
			</div>
		</div>
	);
}
