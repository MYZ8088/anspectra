"use client";

import {
	formDialogBodyClassName,
	formDialogContentClassName,
	formDialogFooterClassName,
	formDialogHeaderClassName,
	formFieldClassName,
	formPrimaryButtonClassName,
	formSecondaryButtonClassName,
	formTextareaClassName,
} from "@/components/forms/auth-form-chrome";
import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { type RouterOutputs, api } from "@/trpc/react";
import type { GeoDecisionStage, GeoIntent } from "@answerloom/types";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Tabs,
	TabsList,
	TabsTrigger,
	Textarea,
	toast,
} from "@answerloom/ui";
import { cn } from "@answerloom/utils";
import {
	Archive,
	Copy,
	FileUp,
	Loader2,
	Pencil,
	Plus,
	Search,
	WandSparkles,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

type PromptLibraryV2 = RouterOutputs["geo"]["promptLibraryV2"];
type LibraryPrompt = PromptLibraryV2["customPrompts"][number];
type LibraryView = "system" | "workspace" | "custom" | "legacy";
type DisplayPrompt = {
	id: string;
	kind: LibraryView;
	prompt: string;
	locale: string;
	intent: string;
	decisionStage: string;
	brandExposure: string;
	active: boolean;
	version: number | string;
	tags: string[];
	relevance: string | null;
	row: LibraryPrompt | null;
};

type PromptDraft = {
	prompt: string;
	locale: "zh-CN" | "en-US";
	intent: GeoIntent | "auto";
	decisionStage: GeoDecisionStage | "auto";
	brandExposure: "blind" | "aided" | "auto";
	targetProduct: string;
	targetCompetitor: string;
	targetAudience: string;
	targetRegion: string;
	tags: string;
};

const EMPTY_DRAFT: PromptDraft = {
	prompt: "",
	locale: "zh-CN",
	intent: "auto",
	decisionStage: "auto",
	brandExposure: "auto",
	targetProduct: "",
	targetCompetitor: "",
	targetAudience: "",
	targetRegion: "",
	tags: "",
};

const VIEW_LABELS: Record<LibraryView, string> = {
	system: "System Templates",
	workspace: "Workspace Prompts",
	custom: "My Custom",
	legacy: "Legacy Imports",
};

function relevanceStatus(value: Record<string, unknown> | null | undefined) {
	return typeof value?.status === "string" ? value.status : null;
}

function splitCsvRows(input: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < input.length; index += 1) {
		const character = input[index];
		if (character === '"') {
			if (quoted && input[index + 1] === '"') {
				field += '"';
				index += 1;
			} else {
				quoted = !quoted;
			}
		} else if (character === "," && !quoted) {
			row.push(field.trim());
			field = "";
		} else if ((character === "\n" || character === "\r") && !quoted) {
			if (character === "\r" && input[index + 1] === "\n") index += 1;
			row.push(field.trim());
			if (row.some(Boolean)) rows.push(row);
			row = [];
			field = "";
		} else {
			field += character;
		}
	}
	row.push(field.trim());
	if (row.some(Boolean)) rows.push(row);
	return rows;
}

function promptItemsFromFile(content: string, fileName: string) {
	if (!fileName.toLowerCase().endsWith(".csv")) {
		return content
			.split(/\r?\n/u)
			.map((prompt) => prompt.trim())
			.filter(Boolean)
			.map((prompt) => ({ prompt }));
	}
	const rows = splitCsvRows(content);
	if (rows.length === 0) return [];
	const normalizedHeader = rows[0]?.map((field) => field.toLowerCase()) ?? [];
	const promptIndex = normalizedHeader.findIndex((field) =>
		["prompt", "question", "提示词", "问题"].includes(field),
	);
	const localeIndex = normalizedHeader.findIndex((field) =>
		["locale", "language", "语言"].includes(field),
	);
	const hasHeader = promptIndex >= 0;
	return rows.slice(hasHeader ? 1 : 0).flatMap((row) => {
		const prompt = row[hasHeader ? promptIndex : 0]?.trim();
		if (!prompt) return [];
		const locale = localeIndex >= 0 ? row[localeIndex] : undefined;
		return [{ prompt, locale }];
	});
}

function draftFromPrompt(prompt: LibraryPrompt): PromptDraft {
	return {
		prompt: prompt.prompt,
		locale: prompt.locale === "en-US" ? "en-US" : "zh-CN",
		intent: prompt.intent as GeoIntent,
		decisionStage: prompt.decisionStage as GeoDecisionStage,
		brandExposure: prompt.brandExposure as "blind" | "aided",
		targetProduct:
			typeof prompt.dimensions?.targetProduct === "string"
				? prompt.dimensions.targetProduct
				: "",
		targetCompetitor:
			typeof prompt.dimensions?.targetCompetitor === "string"
				? prompt.dimensions.targetCompetitor
				: "",
		targetAudience:
			typeof prompt.dimensions?.targetAudience === "string"
				? prompt.dimensions.targetAudience
				: "",
		targetRegion:
			typeof prompt.dimensions?.targetRegion === "string"
				? prompt.dimensions.targetRegion
				: "",
		tags: (prompt.tags ?? []).join(", "),
	};
}

export default function PromptLibraryPage() {
	const workspaceId = useSafeSearchParams().get("workspace") ?? "";
	const utils = api.useUtils();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [search, setSearch] = useState("");
	const [view, setView] = useState<LibraryView>("system");
	const [status, setStatus] = useState("active");
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<LibraryPrompt | null>(null);
	const [draft, setDraft] = useState<PromptDraft>(EMPTY_DRAFT);

	const library = api.geo.promptLibraryV2.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId },
	);
	const taxonomy = api.geo.promptTaxonomy.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId, staleTime: Number.POSITIVE_INFINITY },
	);
	const refresh = async () => {
		await Promise.all([
			utils.geo.promptLibraryV2.invalidate(),
			utils.geo.promptLibrary.invalidate(),
			utils.geo.promptSets.invalidate(),
		]);
	};
	const importMutation = api.geo.importCustomPrompts.useMutation({
		onSuccess: async () => {
			await refresh();
			setDialogOpen(false);
			setDraft(EMPTY_DRAFT);
			toast.success("Custom prompt version added");
		},
		onError: (error) => toast.error(error.message),
	});
	const classifyMutation = api.geo.classifyCustomPrompts.useMutation({
		onSuccess: (result) => {
			const suggestion = result.items[0];
			if (!suggestion) return;
			setDraft((current) => ({
				...current,
				locale: suggestion.locale,
				intent: suggestion.intent,
				decisionStage: suggestion.decisionStage,
				brandExposure: suggestion.brandExposure,
			}));
			toast.success(
				result.mode === "aihubmix"
					? `AI classification ready (${suggestion.confidence}% confidence)`
					: "AI classification unavailable; deterministic suggestions applied",
			);
		},
		onError: (error) => toast.error(error.message),
	});
	const reviseMutation = api.geo.reviseCustomPrompt.useMutation({
		onSuccess: async () => {
			await refresh();
			setDialogOpen(false);
			setEditing(null);
			setDraft(EMPTY_DRAFT);
			toast.success("A new immutable prompt version was created");
		},
		onError: (error) => toast.error(error.message),
	});
	const archiveMutation = api.geo.archivePrompt.useMutation({
		onSuccess: async () => {
			await refresh();
			toast.success("Prompt archived");
		},
		onError: (error) => toast.error(error.message),
	});

	const filtered = useMemo(() => {
		const needle = search.trim().toLowerCase();
		const data = library.data;
		if (!data) return [];
		const rows: DisplayPrompt[] =
			view === "system"
				? data.systemTemplates.map((template) => ({
						id: template.id,
						kind: "system",
						prompt: template.promptTemplate,
						locale: template.locale,
						intent: template.intent,
						decisionStage: template.decisionStage,
						brandExposure: template.brandExposure,
						active: template.active,
						version: template.version,
						tags: [],
						relevance: null,
						row: null,
					}))
				: (view === "workspace"
						? data.workspacePrompts
						: view === "custom"
							? data.customPrompts
							: data.legacyPrompts
					).map((prompt) => ({
						id: prompt.id,
						kind: view,
						prompt: prompt.prompt,
						locale: prompt.locale,
						intent: prompt.intent,
						decisionStage: prompt.decisionStage,
						brandExposure: prompt.brandExposure,
						active: prompt.active,
						version: prompt.version,
						tags: prompt.tags ?? [],
						relevance: relevanceStatus(prompt.relevance),
						row: prompt,
					}));
		return rows.filter((prompt) => {
			if (status === "active" && !prompt.active) return false;
			if (status === "archived" && prompt.active) return false;
			return (
				!needle ||
				prompt.prompt.toLowerCase().includes(needle) ||
				prompt.intent.toLowerCase().includes(needle) ||
				(prompt.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
			);
		});
	}, [library.data, search, status, view]);

	const openCreate = () => {
		setEditing(null);
		setDraft(EMPTY_DRAFT);
		setDialogOpen(true);
	};
	const openEdit = (prompt: LibraryPrompt) => {
		setEditing(prompt);
		setDraft(draftFromPrompt(prompt));
		setDialogOpen(true);
	};
	const saveDraft = () => {
		const items = draft.prompt
			.split(/\r?\n/u)
			.map((prompt) => prompt.trim())
			.filter(Boolean)
			.map((prompt) => ({
				prompt,
				locale: draft.locale,
				...(draft.intent === "auto" ? {} : { intent: draft.intent }),
				...(draft.decisionStage === "auto"
					? {}
					: { decisionStage: draft.decisionStage }),
				...(draft.brandExposure === "auto"
					? {}
					: { brandExposure: draft.brandExposure }),
				targetProduct: draft.targetProduct.trim() || null,
				targetCompetitor: draft.targetCompetitor.trim() || null,
				targetAudience: draft.targetAudience.trim() || null,
				targetRegion: draft.targetRegion.trim() || null,
				tags: draft.tags
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean),
			}));
		if (items.length === 0) return;
		if (editing) {
			const firstItem = items[0];
			if (!firstItem) return;
			reviseMutation.mutate({
				workspaceId,
				promptId: editing.id,
				input: firstItem,
			});
		} else {
			importMutation.mutate({ workspaceId, importSource: "manual", items });
		}
	};

	const duplicatePrompt = (prompt: LibraryPrompt) => {
		importMutation.mutate({
			workspaceId,
			importSource: "manual",
			items: [
				{
					prompt: prompt.prompt,
					locale: prompt.locale,
					intent: prompt.intent as GeoIntent,
					decisionStage: prompt.decisionStage as GeoDecisionStage,
					brandExposure: prompt.brandExposure as "blind" | "aided",
					tags: [...(prompt.tags ?? []), "preset-copy"],
				},
			],
		});
	};

	const importFile = async (file: File) => {
		const items = promptItemsFromFile(await file.text(), file.name);
		if (items.length === 0) {
			toast.error("No prompt rows found in the file");
			return;
		}
		importMutation.mutate({ workspaceId, importSource: "csv", items });
	};

	const customCount = library.data?.stats.customPrompts ?? 0;
	const presetCount = library.data?.stats.systemTemplates ?? 0;
	const workspaceCount = library.data?.stats.workspacePrompts ?? 0;
	const legacyCount = library.data?.stats.legacyPrompts ?? 0;

	return (
		<div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
			<section className="grid gap-5 border-b border-stone-200 pb-6 dark:border-neutral-800 sm:grid-cols-2 lg:grid-cols-4">
				<div>
					<p className="text-xs text-stone-500">System templates</p>
					<p className="mt-1 text-2xl font-semibold tabular-nums">
						{presetCount}
					</p>
				</div>
				<div>
					<p className="text-xs text-stone-500">Workspace prompts</p>
					<p className="mt-1 text-2xl font-semibold tabular-nums">
						{workspaceCount}
					</p>
				</div>
				<div>
					<p className="text-xs text-stone-500">Active custom</p>
					<p className="mt-1 text-2xl font-semibold tabular-nums">
						{customCount}
					</p>
				</div>
				<div>
					<p className="text-xs text-stone-500">Legacy imports</p>
					<p className="mt-1 text-2xl font-semibold tabular-nums">
						{legacyCount}
					</p>
				</div>
			</section>

			<Tabs
				value={view}
				onValueChange={(value) => {
					const nextView = value as LibraryView;
					setView(nextView);
					setStatus(nextView === "legacy" ? "archived" : "active");
				}}
				className="pt-5"
			>
				<TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-b border-stone-200 bg-transparent p-0 dark:border-neutral-800">
					{(Object.keys(VIEW_LABELS) as LibraryView[]).map((key) => (
						<TabsTrigger
							key={key}
							value={key}
							className="rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-stone-950 data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:border-stone-50"
						>
							{VIEW_LABELS[key]}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

			<div className="flex flex-col gap-3 py-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
				<div className="flex min-w-0 flex-1 flex-wrap gap-2">
					<div className="relative min-w-[220px] flex-1 lg:max-w-md">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
						<Input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search prompts, intents, or tags"
							className={cn(formFieldClassName, "w-full pl-9")}
						/>
					</div>
					<Select value={status} onValueChange={setStatus}>
						<SelectTrigger className="w-[130px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All states</SelectItem>
							<SelectItem value="active">Active</SelectItem>
							<SelectItem value="archived">Archived</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="flex gap-2">
					<input
						ref={fileInputRef}
						type="file"
						accept=".csv,.txt,text/csv,text/plain"
						className="sr-only"
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) void importFile(file);
							event.target.value = "";
						}}
					/>
					<Button
						className={formSecondaryButtonClassName}
						onClick={() => fileInputRef.current?.click()}
						disabled={importMutation.isPending || view !== "custom"}
					>
						<FileUp className="size-4" /> Import
					</Button>
					<Button
						className={cn(
							formPrimaryButtonClassName,
							"w-auto whitespace-nowrap",
						)}
						onClick={openCreate}
						disabled={view !== "custom"}
					>
						<Plus className="size-4" /> Add prompts
					</Button>
				</div>
			</div>

			<div className="overflow-x-auto border-y border-stone-200 dark:border-neutral-800">
				<table className="w-full min-w-[1050px] table-fixed text-left text-sm">
					<thead className="border-b border-stone-200 text-xs text-stone-500 dark:border-neutral-800">
						<tr>
							<th className="w-[42%] px-3 py-3 font-medium">Prompt</th>
							<th className="w-[13%] px-3 py-3 font-medium">Source</th>
							<th className="w-[12%] px-3 py-3 font-medium">Intent</th>
							<th className="w-[12%] px-3 py-3 font-medium">Stage</th>
							<th className="w-[9%] px-3 py-3 font-medium">Version</th>
							<th className="w-[12%] px-3 py-3 text-right font-medium">
								Actions
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-stone-200 dark:divide-neutral-800">
						{filtered.map((prompt) => (
							<tr
								key={prompt.id}
								className={cn(!prompt.active && "opacity-55")}
							>
								<td className="px-3 py-4 align-top">
									<p className="line-clamp-3 leading-6">{prompt.prompt}</p>
									<div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-stone-500">
										<span>{prompt.locale}</span>
										<span>·</span>
										<span>{prompt.brandExposure}</span>
										{prompt.relevance ? (
											<>
												<span>·</span>
												<span>{prompt.relevance.replaceAll("_", " ")}</span>
											</>
										) : null}
										{(prompt.tags ?? []).map((tag) => (
											<span
												key={tag}
												className="border border-stone-200 px-1.5 dark:border-neutral-800"
											>
												{tag}
											</span>
										))}
									</div>
								</td>
								<td className="px-3 py-4 align-top text-xs">
									{VIEW_LABELS[prompt.kind]}
								</td>
								<td className="px-3 py-4 align-top text-xs capitalize">
									{prompt.intent.replaceAll("_", " ")}
								</td>
								<td className="px-3 py-4 align-top text-xs capitalize">
									{prompt.decisionStage}
								</td>
								<td className="px-3 py-4 align-top text-xs">
									v{prompt.version} · {prompt.active ? "active" : "archived"}
								</td>
								<td className="px-3 py-4 align-top">
									<div className="flex justify-end gap-1">
										{prompt.row ? (
											<Button
												variant="ghost"
												size="icon"
												title="Duplicate as custom prompt"
												onClick={() => duplicatePrompt(prompt.row as LibraryPrompt)}
												disabled={importMutation.isPending}
											>
												<Copy className="size-4" />
											</Button>
										) : null}
										{prompt.kind === "custom" && prompt.row && prompt.active ? (
											<>
												<Button
													variant="ghost"
													size="icon"
													title="Create a new version"
													onClick={() => openEdit(prompt.row as LibraryPrompt)}
												>
													<Pencil className="size-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													title="Archive prompt"
													onClick={() =>
														archiveMutation.mutate({
															workspaceId,
															promptId: prompt.id,
														})
													}
													disabled={archiveMutation.isPending}
												>
													<Archive className="size-4" />
												</Button>
											</>
										) : null}
									</div>
								</td>
							</tr>
						))}
						{library.isLoading ? (
							<tr>
								<td
									colSpan={6}
									className="px-3 py-14 text-center text-stone-500"
								>
									<Loader2 className="mx-auto size-5 animate-spin" />
								</td>
							</tr>
						) : null}
						{!library.isLoading && filtered.length === 0 ? (
							<tr>
								<td
									colSpan={6}
									className="px-3 py-14 text-center text-stone-500"
								>
									No prompts match these filters.
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>

			<Dialog
				open={dialogOpen}
				onOpenChange={(open) => {
					setDialogOpen(open);
					if (!open) setEditing(null);
				}}
			>
				<DialogContent className={formDialogContentClassName}>
					<DialogHeader className={formDialogHeaderClassName}>
						<DialogTitle>
							{editing ? "Create prompt version" : "Add custom prompts"}
						</DialogTitle>
						<DialogDescription>
							{editing
								? `Editing v${editing.version} creates v${editing.version + 1}; prior baselines keep the original hash.`
								: "Enter one prompt per line. Unspecified dimensions are classified deterministically."}
						</DialogDescription>
					</DialogHeader>
					<div className={formDialogBodyClassName}>
						<Textarea
							value={draft.prompt}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									prompt: event.target.value,
								}))
							}
							className={cn(formTextareaClassName, "min-h-36")}
							placeholder="Enter one prompt per line"
						/>
						<div className="flex justify-end">
							<Button
								className={formSecondaryButtonClassName}
								disabled={!draft.prompt.trim() || classifyMutation.isPending}
								onClick={() =>
									classifyMutation.mutate({
										workspaceId,
										prompts: [
											draft.prompt.split(/\r?\n/u)[0]?.trim() ?? "",
										].filter(Boolean),
									})
								}
							>
								{classifyMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<WandSparkles className="size-4" />
								)}{" "}
								AI classify first prompt
							</Button>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<Select
								value={draft.locale}
								onValueChange={(value) =>
									setDraft((current) => ({
										...current,
										locale: value as PromptDraft["locale"],
									}))
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="zh-CN">中文</SelectItem>
									<SelectItem value="en-US">English</SelectItem>
								</SelectContent>
							</Select>
							<Select
								value={draft.intent}
								onValueChange={(value) =>
									setDraft((current) => ({
										...current,
										intent: value as PromptDraft["intent"],
									}))
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Intent" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto intent</SelectItem>
									{taxonomy.data?.intents.map((item) => (
										<SelectItem key={item} value={item}>
											{item.replaceAll("_", " ")}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select
								value={draft.decisionStage}
								onValueChange={(value) =>
									setDraft((current) => ({
										...current,
										decisionStage: value as PromptDraft["decisionStage"],
									}))
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Stage" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto stage</SelectItem>
									{taxonomy.data?.decisionStages.map((item) => (
										<SelectItem key={item} value={item}>
											{item}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select
								value={draft.brandExposure}
								onValueChange={(value) =>
									setDraft((current) => ({
										...current,
										brandExposure: value as PromptDraft["brandExposure"],
									}))
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Brand exposure" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto exposure</SelectItem>
									<SelectItem value="blind">Blind</SelectItem>
									<SelectItem value="aided">Aided</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<Input
								value={draft.targetProduct}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										targetProduct: event.target.value,
									}))
								}
								className={formFieldClassName}
								placeholder="Target product"
							/>
							<Input
								value={draft.targetCompetitor}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										targetCompetitor: event.target.value,
									}))
								}
								className={formFieldClassName}
								placeholder="Target competitor"
							/>
							<Input
								value={draft.targetAudience}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										targetAudience: event.target.value,
									}))
								}
								className={formFieldClassName}
								placeholder="Target audience"
							/>
							<Input
								value={draft.targetRegion}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										targetRegion: event.target.value,
									}))
								}
								className={formFieldClassName}
								placeholder="Target region"
							/>
						</div>
						<Input
							value={draft.tags}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									tags: event.target.value,
								}))
							}
							className={formFieldClassName}
							placeholder="Tags, comma separated"
						/>
					</div>
					<DialogFooter className={formDialogFooterClassName}>
						<Button
							className={formSecondaryButtonClassName}
							onClick={() => setDialogOpen(false)}
						>
							Cancel
						</Button>
						<Button
							className={formPrimaryButtonClassName}
							onClick={saveDraft}
							disabled={
								!draft.prompt.trim() ||
								importMutation.isPending ||
								reviseMutation.isPending
							}
						>
							{importMutation.isPending || reviseMutation.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Plus className="size-4" />
							)}
							{editing ? "Create version" : "Add prompts"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
