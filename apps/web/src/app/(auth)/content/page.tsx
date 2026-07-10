"use client";

import {
	formDialogContentClassName,
	formPrimaryButtonClassName,
	formSecondaryButtonClassName,
} from "@/components/forms/auth-form-chrome";
import { useSafeSearchParams } from "@/lib/navigation/use-safe-search-params";
import { api } from "@/trpc/react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
	toast,
} from "@answerloom/ui";
import { cn } from "@answerloom/utils";
import {
	Check,
	ExternalLink,
	Loader2,
	Plus,
	Save,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type PublisherType = "wordpress" | "geoflow" | "github";
type QualityReport = {
	passed?: boolean;
	blockingFailures?: number;
	verifiedFactCount?: number;
	evidenceGapCount?: number;
	gates?: Array<{
		key: string;
		status: "pass" | "warn" | "fail";
		message: string;
	}>;
};

export default function ContentPage() {
	const workspaceId = useSafeSearchParams().get("workspace") ?? "";
	const utils = api.useUtils();
	const content = api.geo.content.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId },
	);
	const publishers = api.geo.publishers.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId },
	);
	const runs = api.geo.runs.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId },
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [publisherId, setPublisherId] = useState("");
	const [baselineSeriesId, setBaselineSeriesId] = useState("");
	const [editedMarkdown, setEditedMarkdown] = useState("");
	const [publisherDialogOpen, setPublisherDialogOpen] = useState(false);
	const [publisherType, setPublisherType] =
		useState<PublisherType>("wordpress");
	const [publisherName, setPublisherName] = useState("");
	const [publisherBaseUrl, setPublisherBaseUrl] = useState("");
	const [publisherUsername, setPublisherUsername] = useState("");
	const [publisherSecret, setPublisherSecret] = useState("");
	const [githubOwner, setGithubOwner] = useState("");
	const [githubRepo, setGithubRepo] = useState("");
	const [githubBranch, setGithubBranch] = useState("main");
	const [githubPath, setGithubPath] = useState("content");
	useEffect(() => {
		if (!selectedId && content.data?.[0]) setSelectedId(content.data[0].id);
	}, [content.data, selectedId]);
	const selected = useMemo(
		() => content.data?.find((item) => item.id === selectedId) ?? null,
		[content.data, selectedId],
	);
	const revision = selected?.revisions[0];
	const qualityReport = (revision?.qualityReport ?? {}) as QualityReport;
	const formalBaselines = (runs.data ?? []).filter(
		(series) => series.promptSet?.purpose === "baseline",
	);
	useEffect(() => {
		setEditedMarkdown(revision?.markdown ?? "");
	}, [revision?.markdown]);
	const revise = api.geo.reviseContent.useMutation({
		onSuccess: async () => {
			await utils.geo.content.invalidate();
			toast.success("Changes saved as a new revision");
		},
		onError: (error) => toast.error(error.message),
	});
	const approve = api.geo.approveContent.useMutation({
		onSuccess: async () => {
			await utils.geo.content.invalidate();
			toast.success("Revision approved");
		},
		onError: (error) => toast.error(error.message),
	});
	const validate = api.geo.validateRevision.useMutation({
		onSuccess: async (report) => {
			await utils.geo.content.invalidate();
			if (report.passed) toast.success("All blocking quality gates passed");
			else
				toast.error(`${report.blockingFailures} blocking quality gates remain`);
		},
		onError: (error) => toast.error(error.message),
	});
	const publish = api.geo.publish.useMutation({
		onSuccess: async (result) => {
			await Promise.all([
				utils.geo.content.invalidate(),
				utils.geo.experiments.invalidate(),
			]);
			if (result.pageAudit.status === "failed") {
				toast.warning(
					`Published, but the immediate page audit failed: ${result.pageAudit.message ?? "unknown error"}`,
				);
			} else {
				toast.success("Published; page audited and T+7 retest scheduled");
			}
		},
		onError: (error) => toast.error(error.message),
	});
	const savePublisher = api.geo.savePublisher.useMutation({
		onSuccess: async (connection) => {
			await utils.geo.publishers.invalidate();
			setPublisherId(connection.id);
			setPublisherDialogOpen(false);
			setPublisherSecret("");
			toast.success("Publisher connected");
		},
		onError: (error) => toast.error(error.message),
	});

	const connectPublisher = () => {
		if (publisherType === "wordpress") {
			savePublisher.mutate({
				workspaceId,
				name: publisherName,
				config: {
					type: "wordpress",
					baseUrl: publisherBaseUrl,
					username: publisherUsername,
					applicationPassword: publisherSecret,
				},
			});
			return;
		}
		if (publisherType === "geoflow") {
			savePublisher.mutate({
				workspaceId,
				name: publisherName,
				config: {
					type: "geoflow",
					baseUrl: publisherBaseUrl,
					apiToken: publisherSecret,
				},
			});
			return;
		}
		savePublisher.mutate({
			workspaceId,
			name: publisherName,
			config: {
				type: "github",
				owner: githubOwner,
				repo: githubRepo,
				token: publisherSecret,
				baseBranch: githubBranch,
				contentPath: githubPath || undefined,
			},
		});
	};

	const publisherReady =
		publisherName.trim().length > 0 &&
		publisherSecret.trim().length > 0 &&
		(publisherType === "github"
			? githubOwner.trim().length > 0 && githubRepo.trim().length > 0
			: publisherBaseUrl.trim().length > 0) &&
		(publisherType !== "wordpress" || publisherUsername.trim().length > 0);
	const contentChanged =
		!!revision && editedMarkdown.trim() !== revision.markdown.trim();
	return (
		<div className="grid min-h-[calc(100svh-3.5rem)] lg:grid-cols-[300px_minmax(0,1fr)]">
			<aside className="border-b border-stone-200 p-4 lg:border-b-0 lg:border-r dark:border-neutral-800">
				<h2 className="mb-4 text-sm font-semibold">Content assets</h2>
				<div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
					{(content.data ?? []).map((asset) => (
						<button
							type="button"
							key={asset.id}
							onClick={() => setSelectedId(asset.id)}
							className={`block w-full px-2 py-3 text-left ${selectedId === asset.id ? "bg-stone-100 dark:bg-neutral-900" : "hover:bg-stone-50 dark:hover:bg-neutral-950"}`}
						>
							<span className="block truncate text-sm font-medium">
								{asset.title}
							</span>
							<span className="mt-1 block text-xs capitalize text-stone-500">
								{asset.kind} · {asset.status}
							</span>
						</button>
					))}
					{!content.data?.length && (
						<p className="py-10 text-center text-xs text-stone-500">
							No drafts yet.
						</p>
					)}
				</div>
			</aside>
			<main className="min-w-0 p-4 sm:p-6 lg:p-8">
				{revision && selected ? (
					<>
						<div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 pb-5 dark:border-neutral-800">
							<div className="min-w-0">
								<p className="text-xs font-medium uppercase text-stone-500">
									Revision {revision.version} · {revision.status}
								</p>
								<h2 className="mt-1 text-xl font-semibold">{selected.title}</h2>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button
									className={formSecondaryButtonClassName}
									disabled={
										!contentChanged ||
										editedMarkdown.trim().length < 100 ||
										revise.isPending
									}
									onClick={() =>
										revise.mutate({
											workspaceId,
											revisionId: revision.id,
											markdown: editedMarkdown,
										})
									}
								>
									{revise.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Save className="size-4" />
									)}{" "}
									Save changes
								</Button>
								{revision.status !== "approved" && (
									<>
										<Button
											className={formSecondaryButtonClassName}
											disabled={contentChanged || validate.isPending}
											onClick={() =>
												validate.mutate({
													workspaceId,
													revisionId: revision.id,
												})
											}
										>
											{validate.isPending ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<ShieldCheck className="size-4" />
											)}{" "}
											Validate
										</Button>
										<Button
											className={formSecondaryButtonClassName}
											disabled={contentChanged || approve.isPending}
											onClick={() =>
												approve.mutate({ workspaceId, revisionId: revision.id })
											}
										>
											{approve.isPending ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<Check className="size-4" />
											)}{" "}
											Approve
										</Button>
									</>
								)}
								<Select
									value={baselineSeriesId}
									onValueChange={setBaselineSeriesId}
								>
									<SelectTrigger className="w-[220px]">
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
								<Select value={publisherId} onValueChange={setPublisherId}>
									<SelectTrigger className="w-[180px]">
										<SelectValue placeholder="Select publisher" />
									</SelectTrigger>
									<SelectContent>
										{publishers.data?.map((item) => (
											<SelectItem key={item.id} value={item.id}>
												{item.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Dialog
									open={publisherDialogOpen}
									onOpenChange={setPublisherDialogOpen}
								>
									<DialogTrigger asChild>
										<Button
											aria-label="Add publisher"
											className={formSecondaryButtonClassName}
										>
											<Plus className="size-4" />
										</Button>
									</DialogTrigger>
									<DialogContent className={formDialogContentClassName}>
										<DialogHeader>
											<DialogTitle>Connect a publisher</DialogTitle>
											<DialogDescription>
												Credentials are encrypted at rest and never returned to
												the browser.
											</DialogDescription>
										</DialogHeader>
										<div className="grid max-h-[65vh] gap-4 overflow-y-auto py-2">
											<label className="grid gap-1.5 text-sm font-medium">
												Publisher type
												<select
													value={publisherType}
													onChange={(event) =>
														setPublisherType(
															event.target.value as PublisherType,
														)
													}
													className="h-10 border border-stone-200 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-950"
												>
													<option value="wordpress">WordPress</option>
													<option value="geoflow">GEOFlow</option>
													<option value="github">GitHub pull request</option>
												</select>
											</label>
											<label
												htmlFor="publisher-name"
												className="grid gap-1.5 text-sm font-medium"
											>
												Connection name
												<Input
													id="publisher-name"
													value={publisherName}
													onChange={(event) =>
														setPublisherName(event.target.value)
													}
													placeholder="Production website"
												/>
											</label>
											{publisherType !== "github" ? (
												<label
													htmlFor="publisher-base-url"
													className="grid gap-1.5 text-sm font-medium"
												>
													Base URL
													<Input
														id="publisher-base-url"
														value={publisherBaseUrl}
														onChange={(event) =>
															setPublisherBaseUrl(event.target.value)
														}
														placeholder="https://example.com"
													/>
												</label>
											) : (
												<div className="grid gap-4 sm:grid-cols-2">
													<label
														htmlFor="github-owner"
														className="grid gap-1.5 text-sm font-medium"
													>
														Owner
														<Input
															id="github-owner"
															value={githubOwner}
															onChange={(event) =>
																setGithubOwner(event.target.value)
															}
														/>
													</label>
													<label
														htmlFor="github-repo"
														className="grid gap-1.5 text-sm font-medium"
													>
														Repository
														<Input
															id="github-repo"
															value={githubRepo}
															onChange={(event) =>
																setGithubRepo(event.target.value)
															}
														/>
													</label>
													<label
														htmlFor="github-branch"
														className="grid gap-1.5 text-sm font-medium"
													>
														Base branch
														<Input
															id="github-branch"
															value={githubBranch}
															onChange={(event) =>
																setGithubBranch(event.target.value)
															}
														/>
													</label>
													<label
														htmlFor="github-path"
														className="grid gap-1.5 text-sm font-medium"
													>
														Content path
														<Input
															id="github-path"
															value={githubPath}
															onChange={(event) =>
																setGithubPath(event.target.value)
															}
														/>
													</label>
												</div>
											)}
											{publisherType === "wordpress" && (
												<label
													htmlFor="wordpress-username"
													className="grid gap-1.5 text-sm font-medium"
												>
													Username
													<Input
														id="wordpress-username"
														value={publisherUsername}
														onChange={(event) =>
															setPublisherUsername(event.target.value)
														}
													/>
												</label>
											)}
											<label
												htmlFor="publisher-secret"
												className="grid gap-1.5 text-sm font-medium"
											>
												{publisherType === "wordpress"
													? "Application password"
													: publisherType === "github"
														? "Personal access token"
														: "API token"}
												<Input
													id="publisher-secret"
													type="password"
													value={publisherSecret}
													onChange={(event) =>
														setPublisherSecret(event.target.value)
													}
												/>
											</label>
										</div>
										<DialogFooter>
											<Button
												className={formPrimaryButtonClassName}
												disabled={!publisherReady || savePublisher.isPending}
												onClick={connectPublisher}
											>
												{savePublisher.isPending && (
													<Loader2 className="size-4 animate-spin" />
												)}
												Connect
											</Button>
										</DialogFooter>
									</DialogContent>
								</Dialog>
								<Button
									className={cn(formPrimaryButtonClassName, "w-auto")}
									disabled={
										revision.status !== "approved" ||
										!publisherId ||
										!baselineSeriesId ||
										publish.isPending
									}
									onClick={() =>
										publish.mutate({
											workspaceId,
											revisionId: revision.id,
											connectionId: publisherId,
											baselineSeriesId,
										})
									}
								>
									{publish.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<ExternalLink className="size-4" />
									)}{" "}
									Publish
								</Button>
							</div>
						</div>
						<div className="grid gap-8 py-6 xl:grid-cols-[minmax(0,1fr)_300px]">
							<div className="min-w-0">
								{revision.sourceContent && (
									<div className="mb-6 grid gap-5 lg:grid-cols-2">
										<section className="min-w-0">
											<h3 className="mb-2 text-xs font-semibold uppercase text-stone-500">
												Previous version
											</h3>
											<pre className="max-h-[560px] overflow-auto whitespace-pre-wrap border border-stone-200 bg-stone-50 p-4 text-sm leading-6 dark:border-neutral-800 dark:bg-neutral-900">
												{revision.sourceContent}
											</pre>
										</section>
										<section className="min-w-0">
											<h3 className="mb-2 text-xs font-semibold uppercase text-stone-500">
												Current revision
											</h3>
											<Textarea
												aria-label="Current content revision"
												value={editedMarkdown}
												onChange={(event) =>
													setEditedMarkdown(event.target.value)
												}
												className="min-h-[560px] resize-y rounded-none font-mono text-sm leading-6"
											/>
										</section>
									</div>
								)}
								{!revision.sourceContent && (
									<Textarea
										aria-label="Content revision"
										value={editedMarkdown}
										onChange={(event) => setEditedMarkdown(event.target.value)}
										className="min-h-[620px] resize-y rounded-none font-mono text-sm leading-6"
									/>
								)}
							</div>
							<aside className="space-y-6 border-t border-stone-200 pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0 dark:border-neutral-800">
								<section>
									<div className="flex items-center justify-between gap-3">
										<h3 className="text-sm font-semibold">Quality gates</h3>
										<span
											className={
												qualityReport.passed
													? "text-xs font-medium text-emerald-700"
													: "text-xs font-medium text-amber-700"
											}
										>
											{qualityReport.passed
												? "Passed"
												: `${qualityReport.blockingFailures ?? 0} blocking`}
										</span>
									</div>
									<div className="mt-3 divide-y divide-stone-200 border-y border-stone-200 text-xs dark:divide-neutral-800 dark:border-neutral-800">
										{(qualityReport.gates ?? []).map((gate) => (
											<div key={gate.key} className="py-2.5">
												<div className="flex items-center justify-between gap-2">
													<span className="font-medium capitalize">
														{gate.key.replaceAll("_", " ")}
													</span>
													<span
														className={
															gate.status === "pass"
																? "text-emerald-700"
																: gate.status === "fail"
																	? "text-red-700"
																	: "text-amber-700"
														}
													>
														{gate.status}
													</span>
												</div>
												<p className="mt-1 leading-5 text-stone-500">
													{gate.message}
												</p>
											</div>
										))}
									</div>
								</section>
								{revision.directAnswer ? (
									<section>
										<h3 className="text-sm font-semibold">Direct answer</h3>
										<p className="mt-3 text-xs leading-5 text-stone-600 dark:text-stone-400">
											{revision.directAnswer}
										</p>
									</section>
								) : null}
								{(revision.claimMap ?? []).length > 0 ? (
									<section>
										<h3 className="text-sm font-semibold">Claim sources</h3>
										<div className="mt-3 space-y-3 text-xs">
											{(revision.claimMap ?? []).map((entry, index) => (
												<div key={`${String(entry.claim)}-${index}`}>
													<p className="leading-5">{String(entry.claim)}</p>
													<p className="mt-1 text-stone-500">
														{String(entry.status)} ·{" "}
														{Array.isArray(entry.factIds)
															? entry.factIds.length
															: 0}{" "}
														fact references
													</p>
												</div>
											))}
										</div>
									</section>
								) : null}
								<section>
									<h3 className="text-sm font-semibold">Atomic facts</h3>
									<ul className="mt-3 space-y-3 text-xs text-stone-600 dark:text-stone-400">
										{(revision.atomicFacts ?? []).map((fact, index) => (
											<li key={`${fact.fact}-${index}`}>
												<span className="font-medium text-stone-900 dark:text-stone-100">
													{fact.status}
												</span>
												<br />
												{fact.fact}
											</li>
										))}
									</ul>
								</section>
								<section>
									<h3 className="text-sm font-semibold">Evidence gaps</h3>
									<ul className="mt-3 list-disc space-y-2 pl-4 text-xs text-amber-800 dark:text-amber-300">
										{(revision.evidenceGaps ?? []).map((gap) => (
											<li key={gap}>{gap}</li>
										))}
									</ul>
								</section>
							</aside>
						</div>
					</>
				) : (
					<div className="flex min-h-[420px] items-center justify-center text-sm text-stone-500">
						Select a content asset to review.
					</div>
				)}
			</main>
		</div>
	);
}
