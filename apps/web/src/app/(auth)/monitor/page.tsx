"use client";

import {
	formPrimaryButtonClassName,
	formSecondaryButtonClassName,
} from "@/components/forms/auth-form-chrome";
import { persistActiveProviderRun } from "@/components/provider-run-toast";
import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import {
	Button,
	Checkbox,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	toast,
} from "@answerloom/ui";
import { cn } from "@answerloom/utils";
import {
	BookOpenText,
	CheckCircle2,
	Globe2,
	Library,
	Loader2,
	Play,
	Plus,
	Save,
	ScanSearch,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Tier = "quick" | "standard" | "deep";

const INTENT_LABELS: Record<string, string> = {
	information: "信息",
	recommendation: "推荐",
	comparison: "比较",
	transaction: "交易/行动",
	risk: "风险",
	price: "价格",
	alternative: "替代",
	scenario: "场景",
	brand_validation: "品牌验证",
};

function splitList(value: string): string[] {
	return [
		...new Set(
			value
				.split(/[,，\n]/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	];
}

function Field(props: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	className?: string;
}) {
	return (
		<label
			htmlFor={props.id}
			className={cn(
				"grid min-w-0 gap-1.5 text-sm font-medium",
				props.className,
			)}
		>
			{props.label}
			<Input
				id={props.id}
				value={props.value}
				onChange={(event) => props.onChange(event.target.value)}
				placeholder={props.placeholder}
			/>
		</label>
	);
}

export default function MonitorPage() {
	const workspaceId = useSafeSearchParams().get("workspace") ?? "";
	const utils = api.useUtils();
	const profileQuery = api.geo.profile.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const workspaceQuery = api.workspace.getById.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const setsQuery = api.geo.promptSets.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const libraryQuery = api.geo.promptLibraryV2.useQuery(
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
	const [industry, setIndustry] = useState("");
	const [market, setMarket] = useState("");
	const [aliases, setAliases] = useState("");
	const [products, setProducts] = useState("");
	const [competitors, setCompetitors] = useState("");
	const [audiences, setAudiences] = useState("");
	const [regions, setRegions] = useState("CN");
	const [budget, setBudget] = useState("");
	const [teamSize, setTeamSize] = useState("");
	const [implementationPeriod, setImplementationPeriod] = useState("");
	const [evidenceRequirement, setEvidenceRequirement] = useState("");
	const [locales, setLocales] = useState<string[]>(["zh-CN"]);
	const [tier, setTier] = useState<Tier>("standard");
	const [intentFilter, setIntentFilter] = useState("all");
	const [selectedCustom, setSelectedCustom] = useState<Set<string>>(new Set());
	const [factSubject, setFactSubject] = useState("");
	const [factPredicate, setFactPredicate] = useState("");
	const [factValue, setFactValue] = useState("");
	const [factSourceUrl, setFactSourceUrl] = useState("");
	const [factSourceType, setFactSourceType] = useState("official_website");
	const [factEvidenceGrade, setFactEvidenceGrade] = useState<
		"A" | "B" | "C" | "D"
	>("A");
	const [factStatus, setFactStatus] = useState<"verified" | "unverified">(
		"verified",
	);
	const [factRegion, setFactRegion] = useState("");
	const [factValidUntil, setFactValidUntil] = useState("");
	const [factClaims, setFactClaims] = useState("");

	useEffect(() => {
		const profile = profileQuery.data;
		if (!profile) {
			if (workspaceQuery.data) {
				setBrandName((current) => current || workspaceQuery.data.name || "");
				setDomain((current) => current || workspaceQuery.data.domain || "");
			}
			return;
		}
		setBrandName(profile.brandName);
		setDomain(profile.officialDomain);
		setCategory(profile.category ?? "");
		setIndustry(profile.industry ?? "");
		setMarket(profile.market ?? "");
		setAliases((profile.aliases ?? []).join(", "));
		setProducts((profile.products ?? []).join(", "));
		setCompetitors((profile.competitors ?? []).join(", "));
		setAudiences((profile.audiences ?? []).join(", "));
		setRegions((profile.regions ?? []).join(", "));
		setBudget(profile.budget ?? "");
		setTeamSize(profile.teamSize ?? "");
		setImplementationPeriod(profile.implementationPeriod ?? "");
		setEvidenceRequirement(profile.evidenceRequirement ?? "");
		setLocales(profile.locales?.length ? profile.locales : ["zh-CN"]);
	}, [profileQuery.data, workspaceQuery.data]);

	const previewQuery = api.geo.previewPresetPack.useQuery(
		{ workspaceId, tier, locales },
		{
			enabled: Boolean(workspaceId && profileQuery.data && locales.length),
			staleTime: 15_000,
		},
	);
	const customPrompts = useMemo(
		() =>
			(libraryQuery.data?.customPrompts ?? []).filter(
				(prompt) => prompt.active,
			),
		[libraryQuery.data],
	);
	const visiblePrompts = useMemo(() => {
		const prompts = previewQuery.data?.prompts ?? [];
		return intentFilter === "all"
			? prompts
			: prompts.filter((prompt) => prompt.promptGroup === intentFilter);
	}, [intentFilter, previewQuery.data]);

	const saveProfile = api.geo.saveProfile.useMutation({
		onSuccess: async () => {
			await Promise.all([
				utils.geo.profile.invalidate(),
				utils.geo.promptLibraryV2.invalidate(),
				utils.geo.previewPresetPack.invalidate(),
			]);
			toast.success("Brand profile saved");
		},
		onError: (error) => toast.error(error.message),
	});
	const suggestProfile = api.geo.suggestProfileFromSite.useMutation({
		onSuccess: async (result) => {
			const candidate = result.candidate;
			setBrandName(candidate.brandName);
			setDomain(candidate.officialDomain);
			setAliases(candidate.aliases.join(", "));
			setProducts(candidate.products.join(", "));
			setCategory(candidate.category ?? "");
			setIndustry(candidate.industry ?? "");
			setMarket(candidate.market ?? "");
			setAudiences(candidate.audiences.join(", "));
			setCompetitors(candidate.competitors.join(", "));
			setRegions(candidate.regions.join(", "));
			setLocales(candidate.locales);
			setBudget(candidate.budget ?? "");
			setTeamSize(candidate.teamSize ?? "");
			setImplementationPeriod(candidate.implementationPeriod ?? "");
			setEvidenceRequirement(candidate.evidenceRequirement ?? "");
			await Promise.all([
				utils.geo.sitePages.invalidate(),
				utils.geo.facts.invalidate(),
			]);
			toast.success(`Scanned ${result.audit.crawledCount} public pages`);
		},
		onError: (error) => toast.error(error.message),
	});
	const confirmProfile = api.geo.confirmBrandProfile.useMutation({
		onSuccess: async () => {
			await Promise.all([
				utils.geo.profile.invalidate(),
				utils.geo.promptLibraryV2.invalidate(),
				utils.geo.previewPresetPack.invalidate(),
			]);
			toast.success("Brand profile confirmed");
		},
		onError: (error) => toast.error(error.message),
	});
	const instantiate = api.geo.instantiatePresetPack.useMutation({
		onSuccess: async () => {
			await Promise.all([
				utils.geo.promptSets.invalidate(),
				utils.geo.promptLibraryV2.invalidate(),
				utils.geo.promptLibrary.invalidate(),
			]);
			toast.success("Versioned Yao GEO prompt set created");
		},
		onError: (error) => toast.error(error.message),
	});
	const start = api.geo.startBaselineSeries.useMutation({
		onSuccess: async (run) => {
			persistActiveProviderRun({ workspaceId, jobId: run.id });
			await utils.geo.runs.invalidate();
			toast.success("Complete Official Web baseline scheduled");
		},
		onError: (error) => toast.error(error.message),
	});
	const audit = api.geo.auditSite.useMutation({
		onSuccess: async (result) => {
			await Promise.all([
				utils.geo.sitePages.invalidate(),
				utils.geo.facts.invalidate(),
			]);
			toast.success(`Audited ${result.crawledCount} pages`);
		},
		onError: (error) => toast.error(error.message),
	});
	const createFact = api.geo.createFact.useMutation({
		onSuccess: async () => {
			await utils.geo.facts.invalidate();
			setFactSubject("");
			setFactPredicate("");
			setFactValue("");
			setFactSourceUrl("");
			setFactClaims("");
			toast.success("Evidence ledger entry added");
		},
		onError: (error) => toast.error(error.message),
	});

	const save = () =>
		saveProfile.mutate({
			workspaceId,
			brandName: brandName.trim(),
			officialDomain: domain.trim(),
			category: category.trim(),
			industry: industry.trim(),
			market: market.trim(),
			aliases: splitList(aliases),
			products: splitList(products),
			competitors: splitList(competitors),
			audiences: splitList(audiences),
			regions: splitList(regions),
			locales,
			budget: budget.trim(),
			teamSize: teamSize.trim(),
			implementationPeriod: implementationPeriod.trim(),
			evidenceRequirement: evidenceRequirement.trim(),
		});

	const toggleLocale = (locale: string) =>
		setLocales((current) =>
			current.includes(locale)
				? current.length > 1
					? current.filter((item) => item !== locale)
					: current
				: [...current, locale],
		);

	return (
		<div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
			<section className="border-b border-stone-200 pb-8 dark:border-neutral-800">
				<div className="mb-5 flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold">Brand coverage profile</h2>
						<p className="mt-1 text-sm text-stone-500">
							{profileQuery.data?.confirmationStatus === "confirmed"
								? `Confirmed profile v${profileQuery.data.version}`
								: "Draft profile"}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							className={formSecondaryButtonClassName}
							onClick={() =>
								suggestProfile.mutate({
									workspaceId,
									domain,
									maxPages: 12,
								})
							}
							disabled={!domain.trim() || suggestProfile.isPending}
						>
							{suggestProfile.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<ScanSearch className="size-4" />
							)}
							Scan site
						</Button>
						<Button
							className={formSecondaryButtonClassName}
							onClick={save}
							disabled={
								!brandName.trim() || !domain.trim() || saveProfile.isPending
							}
						>
							{saveProfile.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Save className="size-4" />
							)}
							Save draft
						</Button>
						<Button
							className={cn(formPrimaryButtonClassName, "w-auto")}
							onClick={() => confirmProfile.mutate({ workspaceId })}
							disabled={
								!libraryQuery.data?.profileCompleteness.complete ||
								confirmProfile.isPending ||
								profileQuery.data?.confirmationStatus === "confirmed"
							}
						>
							{confirmProfile.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<ShieldCheck className="size-4" />
							)}
							Confirm profile
						</Button>
					</div>
				</div>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					<Field
						id="geo-brand"
						label="Brand"
						value={brandName}
						onChange={setBrandName}
						placeholder="Brand name"
					/>
					<Field
						id="geo-domain"
						label="Official domain"
						value={domain}
						onChange={setDomain}
						placeholder="example.com"
					/>
					<Field
						id="geo-category"
						label="Category"
						value={category}
						onChange={setCategory}
						placeholder="Product category"
					/>
					<Field
						id="geo-products"
						label="Products"
						value={products}
						onChange={setProducts}
						placeholder="Primary product, secondary product"
					/>
					<Field
						id="geo-competitors"
						label="Competitors"
						value={competitors}
						onChange={setCompetitors}
						placeholder="Competitor A, competitor B"
					/>
					<Field
						id="geo-audiences"
						label="Audiences"
						value={audiences}
						onChange={setAudiences}
						placeholder="Primary audience, buying role"
					/>
					<Field
						id="geo-aliases"
						label="Aliases"
						value={aliases}
						onChange={setAliases}
						placeholder="Brand aliases"
					/>
					<Field
						id="geo-regions"
						label="Regions"
						value={regions}
						onChange={setRegions}
						placeholder="CN, APAC"
					/>
					<Field
						id="geo-market"
						label="Market"
						value={market}
						onChange={setMarket}
						placeholder="Enterprise software"
					/>
					<Field
						id="geo-industry"
						label="Industry"
						value={industry}
						onChange={setIndustry}
						placeholder="Target industry"
					/>
					<Field
						id="geo-budget"
						label="Budget"
						value={budget}
						onChange={setBudget}
						placeholder="No fixed budget / range"
					/>
					<Field
						id="geo-team-size"
						label="Team size"
						value={teamSize}
						onChange={setTeamSize}
						placeholder="10-50 people"
					/>
					<Field
						id="geo-implementation-period"
						label="Implementation period"
						value={implementationPeriod}
						onChange={setImplementationPeriod}
						placeholder="4-8 weeks"
					/>
					<Field
						id="geo-evidence"
						label="Evidence requirement"
						value={evidenceRequirement}
						onChange={setEvidenceRequirement}
						placeholder="Use dated, verifiable public sources"
					/>
				</div>
			</section>

			<section className="border-b border-stone-200 py-8 dark:border-neutral-800">
				<div className="mb-5 flex flex-wrap items-end justify-between gap-4">
					<div>
						<div className="flex items-center gap-2">
							<Library className="size-5 text-stone-500" />
							<h2 className="text-lg font-semibold">Yao Full GEO Pack v1.1</h2>
						</div>
						<p className="mt-1 text-sm text-stone-500">
							Nine intents across six decision stages, with deterministic entity
							expansion.
						</p>
					</div>
					<Link
						href={`/prompt-library?workspace=${workspaceId}`}
						className={cn(
							formSecondaryButtonClassName,
							"inline-flex items-center gap-2",
						)}
					>
						<BookOpenText className="size-4" /> Prompt Library
					</Link>
				</div>

				<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
					<div className="min-w-0 border-y border-stone-200 dark:border-neutral-800">
						<div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-3 py-3 dark:border-neutral-800">
							<select
								aria-label="Prompt intent filter"
								value={intentFilter}
								onChange={(event) => setIntentFilter(event.target.value)}
								className="h-9 border border-stone-200 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-950"
							>
								<option value="all">All nine intents</option>
								{Object.entries(INTENT_LABELS).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
							<span className="text-xs text-stone-500">
								{visiblePrompts.length} visible of{" "}
								{previewQuery.data?.promptCount ?? 0}
							</span>
							{previewQuery.data?.complete && (
								<span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
									<CheckCircle2 className="size-4" /> Complete coverage
								</span>
							)}
						</div>
						<div className="max-h-[560px] overflow-auto">
							<table className="w-full min-w-[780px] table-fixed text-left text-sm">
								<thead className="sticky top-0 z-10 border-b border-stone-200 bg-white text-xs text-stone-500 dark:border-neutral-800 dark:bg-neutral-950">
									<tr>
										<th className="w-24 px-3 py-3 font-medium">Intent</th>
										<th className="w-28 px-3 py-3 font-medium">Stage</th>
										<th className="w-20 px-3 py-3 font-medium">Locale</th>
										<th className="w-20 px-3 py-3 font-medium">Exposure</th>
										<th className="px-3 py-3 font-medium">
											Prompt sent to Web
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
									{visiblePrompts.map((prompt) => (
										<tr key={prompt.promptHash} className="align-top">
											<td className="px-3 py-3 text-xs font-medium">
												{INTENT_LABELS[prompt.promptGroup] ??
													prompt.promptGroup}
											</td>
											<td className="px-3 py-3 text-xs capitalize text-stone-500">
												{prompt.decisionStage}
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
							{previewQuery.isLoading && (
								<div className="flex h-40 items-center justify-center text-stone-500">
									<Loader2 className="size-5 animate-spin" />
								</div>
							)}
						</div>
					</div>

					<div className="self-start border border-stone-200 p-4 dark:border-neutral-800">
						<p className="text-sm font-semibold">Baseline configuration</p>
						<div className="mt-4 grid grid-cols-3 border border-stone-200 dark:border-neutral-800">
							{(["quick", "standard", "deep"] as Tier[]).map((item) => (
								<button
									key={item}
									type="button"
									onClick={() => setTier(item)}
									className={cn(
										"h-10 border-r border-stone-200 text-sm font-medium last:border-r-0 dark:border-neutral-800",
										tier === item
											? "bg-stone-900 text-white dark:bg-white dark:text-black"
											: "hover:bg-stone-50 dark:hover:bg-neutral-900",
									)}
								>
									{item}
								</button>
							))}
						</div>
						<div className="mt-4 grid gap-2">
							{(
								[
									["zh-CN", "中文"],
									["en-US", "English"],
								] as const
							).map(([locale, label]) => (
								<div key={locale} className="flex items-center gap-2 text-sm">
									<Checkbox
										id={`baseline-locale-${locale}`}
										checked={locales.includes(locale)}
										onCheckedChange={() => toggleLocale(locale)}
									/>
									<label htmlFor={`baseline-locale-${locale}`}>
										{label}{" "}
										<span className="text-xs text-stone-500">{locale}</span>
									</label>
								</div>
							))}
						</div>
						<dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 border-y border-stone-200 py-4 text-sm dark:border-neutral-800">
							<div>
								<dt className="text-xs text-stone-500">Prompts</dt>
								<dd className="mt-1 font-semibold tabular-nums">
									{previewQuery.data?.promptCount ?? "-"}
								</dd>
							</div>
							<div>
								<dt className="text-xs text-stone-500">Rounds</dt>
								<dd className="mt-1 font-semibold tabular-nums">
									{previewQuery.data?.roundCount ?? "-"}
								</dd>
							</div>
							<div>
								<dt className="text-xs text-stone-500">Web samples</dt>
								<dd className="mt-1 font-semibold tabular-nums">
									{previewQuery.data?.plannedSamples ?? "-"}
								</dd>
							</div>
							<div>
								<dt className="text-xs text-stone-500">Minimum days</dt>
								<dd className="mt-1 font-semibold tabular-nums">
									{previewQuery.data?.estimatedMinimumDays ?? "-"}
								</dd>
							</div>
						</dl>
						<div className="mt-4 flex items-center justify-between text-xs">
							<span className="text-stone-500">Brand profile</span>
							<span
								className={cn(
									"font-medium",
									previewQuery.data?.profileCompleteness.confirmed
										? "text-emerald-700 dark:text-emerald-300"
										: "text-amber-700 dark:text-amber-300",
								)}
							>
								{previewQuery.data?.profileCompleteness.confirmed
									? "Confirmed"
									: "Draft"}
							</span>
						</div>
						{customPrompts.length > 0 && (
							<div className="mt-4">
								<p className="text-xs font-medium text-stone-500">
									Custom prompts
								</p>
								<div className="mt-2 max-h-32 space-y-2 overflow-auto pr-1">
									{customPrompts.map((prompt) => (
										<div
											key={prompt.id}
											className="flex items-start gap-2 text-xs leading-5"
										>
											<Checkbox
												id={`custom-prompt-${prompt.id}`}
												checked={selectedCustom.has(prompt.id)}
												onCheckedChange={() =>
													setSelectedCustom((current) => {
														const next = new Set(current);
														next.has(prompt.id)
															? next.delete(prompt.id)
															: next.add(prompt.id);
														return next;
													})
												}
											/>
											<label
												htmlFor={`custom-prompt-${prompt.id}`}
												className="line-clamp-2"
											>
												{prompt.prompt}
											</label>
										</div>
									))}
								</div>
							</div>
						)}
						<Button
							className={cn(formPrimaryButtonClassName, "mt-5 w-full")}
							onClick={() =>
								instantiate.mutate({
									workspaceId,
									tier,
									locales,
									customPromptIds: [...selectedCustom],
								})
							}
							disabled={
								!previewQuery.data?.complete ||
								!previewQuery.data.profileCompleteness.complete ||
								!previewQuery.data.profileCompleteness.confirmed ||
								instantiate.isPending
							}
						>
							{instantiate.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Sparkles className="size-4" />
							)}
							Create versioned set
						</Button>
					</div>
				</div>
			</section>

			<section className="border-b border-stone-200 py-8 dark:border-neutral-800">
				<div className="mb-4">
					<h2 className="text-base font-semibold">Versioned prompt sets</h2>
					<p className="mt-1 text-sm text-stone-500">
						Starting a formal baseline always schedules every active prompt in
						the selected version.
					</p>
				</div>
				<div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
					{(setsQuery.data ?? [])
						.filter((set) => set.purpose === "baseline")
						.map((set) => (
						<div
							key={set.id}
							className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
						>
							<div className="min-w-0">
								<p className="truncate font-medium">{set.name}</p>
								<p className="mt-1 text-xs text-stone-500">
									{set.purpose} · v{set.version} · {set.prompts.length} prompts
									· {set.tier}
								</p>
							</div>
							<Button
								className={formPrimaryButtonClassName}
								onClick={() =>
									start.mutate({ workspaceId, promptSetId: set.id })
								}
								disabled={start.isPending || set.prompts.length === 0}
							>
								{start.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Play className="size-4" />
								)}
								Run all prompts
							</Button>
						</div>
						))}
					{!setsQuery.data?.some((set) => set.purpose === "baseline") && (
						<p className="py-10 text-center text-sm text-stone-500">
							Create the first formal baseline above.
						</p>
					)}
				</div>
			</section>

			<section className="py-8">
				<div className="mb-4 flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2 className="text-base font-semibold">Official site evidence</h2>
						<p className="mt-1 text-sm text-stone-500">
							Audit public pages before diagnosis and content optimization.
						</p>
					</div>
					<Button
						className={formSecondaryButtonClassName}
						onClick={() => audit.mutate({ workspaceId, domain, maxPages: 30 })}
						disabled={!domain || audit.isPending}
					>
						{audit.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Globe2 className="size-4" />
						)}
						Audit site
					</Button>
				</div>
				<div className="divide-y divide-stone-200 border-y border-stone-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
					{(pagesQuery.data ?? []).slice(0, 10).map((page) => (
						<div
							key={page.id}
							className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_100px]"
						>
							<div className="min-w-0">
								<p className="truncate font-medium">{page.title || page.url}</p>
								<p className="truncate text-xs text-stone-500">{page.url}</p>
							</div>
							<span className="text-xs text-stone-500 sm:text-right">
								{page.httpStatus ?? "-"} ·{" "}
								{page.lastCrawledAt
									? new Date(page.lastCrawledAt).toLocaleDateString()
									: "pending"}
							</span>
						</div>
					))}
					{!pagesQuery.data?.length && (
						<p className="py-8 text-center text-sm text-stone-500">
							No page snapshots yet.
						</p>
					)}
				</div>

				<div className="mt-8 grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
					<div className="border-y border-stone-200 py-4 dark:border-neutral-800">
						<h3 className="text-sm font-semibold">Add ledger fact</h3>
						<div className="mt-4 grid gap-3">
							<Input
								value={factSubject}
								onChange={(event) => setFactSubject(event.target.value)}
								placeholder="Subject"
							/>
							<Input
								value={factPredicate}
								onChange={(event) => setFactPredicate(event.target.value)}
								placeholder="Predicate, e.g. pricing"
							/>
							<Input
								value={factValue}
								onChange={(event) => setFactValue(event.target.value)}
								placeholder="Verified value"
							/>
							<Input
								value={factSourceUrl}
								onChange={(event) => setFactSourceUrl(event.target.value)}
								placeholder="Source URL"
							/>
							<div className="grid grid-cols-2 gap-2">
								<Select
									value={factSourceType}
									onValueChange={setFactSourceType}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="official_website">
											Official website
										</SelectItem>
										<SelectItem value="official_document">
											Official document
										</SelectItem>
										<SelectItem value="regulatory">Regulatory</SelectItem>
										<SelectItem value="partner">Partner</SelectItem>
										<SelectItem value="media">Media</SelectItem>
										<SelectItem value="community">Community</SelectItem>
									</SelectContent>
								</Select>
								<Select
									value={factEvidenceGrade}
									onValueChange={(value) =>
										setFactEvidenceGrade(value as "A" | "B" | "C" | "D")
									}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{["A", "B", "C", "D"].map((grade) => (
											<SelectItem key={grade} value={grade}>
												Grade {grade}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Select
									value={factStatus}
									onValueChange={(value) =>
										setFactStatus(value as "verified" | "unverified")
									}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="verified">Verified</SelectItem>
										<SelectItem value="unverified">Unverified</SelectItem>
									</SelectContent>
								</Select>
								<Input
									value={factRegion}
									onChange={(event) => setFactRegion(event.target.value)}
									placeholder="Region"
								/>
							</div>
							<Input
								type="date"
								value={factValidUntil}
								onChange={(event) => setFactValidUntil(event.target.value)}
								aria-label="Fact valid until"
							/>
							<Input
								value={factClaims}
								onChange={(event) => setFactClaims(event.target.value)}
								placeholder="Supported claims, comma separated"
							/>
							<Button
								className={formPrimaryButtonClassName}
								disabled={
									!factSubject.trim() ||
									!factPredicate.trim() ||
									!factValue.trim() ||
									(factStatus === "verified" && !factSourceUrl.trim()) ||
									createFact.isPending
								}
								onClick={() =>
									createFact.mutate({
										workspaceId,
										subject: factSubject.trim(),
										predicate: factPredicate.trim(),
										value: factValue.trim(),
										sourceUrl: factSourceUrl.trim() || undefined,
										sourceType: factSourceType,
										evidenceGrade: factEvidenceGrade,
										status: factStatus,
										retrievedAt: factSourceUrl ? new Date() : undefined,
										region: factRegion.trim() || undefined,
										validUntil: factValidUntil
											? new Date(`${factValidUntil}T23:59:59`)
											: undefined,
										supportedClaims: splitList(factClaims),
										confidence:
											factEvidenceGrade === "A"
												? 95
												: factEvidenceGrade === "B"
													? 85
													: factEvidenceGrade === "C"
														? 70
														: 55,
									})
								}
							>
								{createFact.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Plus className="size-4" />
								)}{" "}
								Add fact
							</Button>
						</div>
					</div>
					<div className="overflow-x-auto border-y border-stone-200 dark:border-neutral-800">
						<table className="w-full min-w-[760px] text-left text-sm">
							<thead className="border-b border-stone-200 text-xs text-stone-500 dark:border-neutral-800">
								<tr>
									<th className="px-3 py-3 font-medium">Fact</th>
									<th className="px-3 py-3 font-medium">Evidence</th>
									<th className="px-3 py-3 font-medium">Status</th>
									<th className="px-3 py-3 font-medium">Validity</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
								{factsQuery.data?.map((fact) => (
									<tr key={fact.id}>
										<td className="px-3 py-4">
											<p className="font-medium">
												{fact.subject} · {fact.predicate}
											</p>
											<p className="mt-1 text-xs text-stone-500">
												{fact.value}
											</p>
										</td>
										<td className="px-3 py-4 text-xs">
											<p>
												{fact.evidenceGrade
													? `Grade ${fact.evidenceGrade}`
													: "Ungraded"}
											</p>
											<p className="mt-1 text-stone-500">
												{fact.sourceType ?? "Unknown source"}
											</p>
										</td>
										<td className="px-3 py-4 text-xs capitalize">
											{fact.status}
										</td>
										<td className="px-3 py-4 text-xs text-stone-500">
											{fact.region ?? "All regions"}
											<br />
											{fact.validUntil
												? `until ${new Date(fact.validUntil).toLocaleDateString()}`
												: "no expiry"}
										</td>
									</tr>
								))}
								{!factsQuery.data?.length ? (
									<tr>
										<td
											colSpan={4}
											className="px-3 py-10 text-center text-stone-500"
										>
											No evidence ledger entries.
										</td>
									</tr>
								) : null}
							</tbody>
						</table>
					</div>
				</div>
			</section>
		</div>
	);
}
