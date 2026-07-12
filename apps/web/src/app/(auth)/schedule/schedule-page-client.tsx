"use client";

import {
	formPrimaryButtonClassName,
	formSecondaryButtonClassName,
} from "@/components/forms/auth-form-chrome";
import { api } from "@/trpc/react";
import {
	GEO_PROVIDER_MODE_CAPABILITIES,
	type ProviderMode,
	getProviderModeLabel,
} from "@aloom/types";
import { Button, Checkbox, Input, toast } from "@aloom/ui";
import {
	CalendarClock,
	Loader2,
	Pause,
	Play,
	Save,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const PROVIDERS = [
	["doubao", "Doubao"],
	["deepseek", "DeepSeek"],
	["hunyuan", "Yuanbao"],
	["qwen", "Qwen"],
] as const;

export default function SchedulePageClient({
	workspaceId,
}: { workspaceId: string }) {
	const utils = api.useUtils();
	const sets = api.geo.promptSets.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId) },
	);
	const schedules = api.geo.detectionSchedules.useQuery(
		{ workspaceId },
		{ enabled: Boolean(workspaceId), refetchInterval: 30_000 },
	);
	const baselineSets = useMemo(
		() => (sets.data ?? []).filter((set) => set.purpose === "baseline"),
		[sets.data],
	);
	const [promptSetId, setPromptSetId] = useState("");
	const [providers, setProviders] = useState<string[]>(
		PROVIDERS.map(([key]) => key),
	);
	const [providerModes, setProviderModes] = useState<
		Record<(typeof PROVIDERS)[number][0], ProviderMode>
	>({
		doubao: "default",
		deepseek: "default",
		hunyuan: "default",
		qwen: "default",
	});
	const [cadence, setCadence] = useState<"weekly" | "monthly">("weekly");
	const [timezone, setTimezone] = useState(
		() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
	);
	const [localTime, setLocalTime] = useState("09:00");
	const [dayOfWeek, setDayOfWeek] = useState(1);
	const [dayOfMonth, setDayOfMonth] = useState(1);
	useEffect(() => {
		if (!promptSetId && baselineSets[0]) setPromptSetId(baselineSets[0].id);
	}, [baselineSets, promptSetId]);

	const save = api.geo.saveDetectionSchedule.useMutation({
		onSuccess: async () => {
			await utils.geo.detectionSchedules.invalidate();
			toast.success("Detection schedule saved");
		},
		onError: (error) => toast.error(error.message),
	});
	const pause = api.geo.pauseDetectionSchedule.useMutation({
		onSuccess: async () => {
			await utils.geo.detectionSchedules.invalidate();
			toast.success("Schedule status updated");
		},
		onError: (error) => toast.error(error.message),
	});
	const remove = api.geo.deleteDetectionSchedule.useMutation({
		onSuccess: async () => {
			await utils.geo.detectionSchedules.invalidate();
			toast.success("Schedule deleted");
		},
		onError: (error) => toast.error(error.message),
	});

	return (
		<div className="web-page-wide">
			<div className="web-page-wide-inner space-y-9 py-6 sm:py-8">
				<header className="flex items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-neutral-800">
					<div>
						<p className="text-xs font-semibold uppercase text-cyan-700 dark:text-cyan-300">
							Schedules
						</p>
						<h1 className="mt-2 text-2xl font-semibold">
							Recurring GEO detection
						</h1>
					</div>
					<CalendarClock className="size-6 text-stone-400" />
				</header>

				<section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
					<div className="space-y-5">
						<label className="grid gap-1.5 text-sm">
							<span className="font-medium">Frozen detection set</span>
							<select
								value={promptSetId}
								onChange={(event) => setPromptSetId(event.target.value)}
								className="h-10 rounded-md border border-stone-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950"
							>
								<option value="">Select a detection set</option>
								{baselineSets.map((set) => (
									<option key={set.id} value={set.id}>
										{set.name} · {set.prompts.length} prompts
									</option>
								))}
							</select>
						</label>
						<fieldset>
							<legend className="mb-2 text-sm font-medium">
								Web providers
							</legend>
							<div className="flex flex-wrap gap-4">
								{PROVIDERS.map(([key, label]) => (
									<label
										key={key}
										htmlFor={`schedule-provider-${key}`}
										className="flex items-center gap-2 text-sm"
									>
										<Checkbox
											id={`schedule-provider-${key}`}
											checked={providers.includes(key)}
											onCheckedChange={() =>
												setProviders((current) =>
													current.includes(key)
														? current.filter((provider) => provider !== key)
														: [...current, key],
												)
											}
										/>
										{label}
									</label>
								))}
							</div>
						</fieldset>
						<div className="grid gap-3 sm:grid-cols-2">
							{PROVIDERS.filter(([key]) => providers.includes(key)).map(
								([key, label]) => (
									<label key={key} className="grid gap-1.5 text-sm">
										<span className="font-medium">{label} mode</span>
										<select
											value={providerModes[key]}
											onChange={(event) =>
												setProviderModes((current) => ({
													...current,
													[key]: event.target.value as ProviderMode,
												}))
											}
											className="h-10 rounded-md border border-stone-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950"
										>
											{GEO_PROVIDER_MODE_CAPABILITIES[key].map((mode) => (
												<option key={mode} value={mode}>
													{getProviderModeLabel(key, mode)}
												</option>
											))}
										</select>
									</label>
								),
							)}
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<label className="grid gap-1.5 text-sm">
								<span className="font-medium">Cadence</span>
								<select
									value={cadence}
									onChange={(event) =>
										setCadence(event.target.value as "weekly" | "monthly")
									}
									className="h-10 rounded-md border border-stone-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950"
								>
									<option value="weekly">Weekly</option>
									<option value="monthly">Monthly</option>
								</select>
							</label>
							<label
								htmlFor="schedule-local-time"
								className="grid gap-1.5 text-sm"
							>
								<span className="font-medium">Local time</span>
								<Input
									id="schedule-local-time"
									type="time"
									value={localTime}
									onChange={(event) => setLocalTime(event.target.value)}
								/>
							</label>
							{cadence === "weekly" ? (
								<label className="grid gap-1.5 text-sm">
									<span className="font-medium">Weekday</span>
									<select
										value={dayOfWeek}
										onChange={(event) =>
											setDayOfWeek(Number(event.target.value))
										}
										className="h-10 rounded-md border border-stone-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950"
									>
										{[
											"Sunday",
											"Monday",
											"Tuesday",
											"Wednesday",
											"Thursday",
											"Friday",
											"Saturday",
										].map((label, index) => (
											<option key={label} value={index}>
												{label}
											</option>
										))}
									</select>
								</label>
							) : (
								<label
									htmlFor="schedule-day-of-month"
									className="grid gap-1.5 text-sm"
								>
									<span className="font-medium">Day of month</span>
									<Input
										id="schedule-day-of-month"
										type="number"
										min={1}
										max={28}
										value={dayOfMonth}
										onChange={(event) =>
											setDayOfMonth(Number(event.target.value))
										}
									/>
								</label>
							)}
							<label
								htmlFor="schedule-timezone"
								className="grid gap-1.5 text-sm"
							>
								<span className="font-medium">Timezone</span>
								<Input
									id="schedule-timezone"
									value={timezone}
									onChange={(event) => setTimezone(event.target.value)}
									placeholder="Asia/Shanghai"
								/>
							</label>
						</div>
					</div>
					<aside className="self-start rounded-md border border-stone-200 p-4 dark:border-neutral-800">
						<p className="font-medium">Next series</p>
						<dl className="mt-4 space-y-3 text-sm">
							<div className="flex justify-between gap-4">
								<dt className="text-stone-500">Cadence</dt>
								<dd className="capitalize">{cadence}</dd>
							</div>
							<div className="flex justify-between gap-4">
								<dt className="text-stone-500">Time</dt>
								<dd>{localTime}</dd>
							</div>
							<div className="flex justify-between gap-4">
								<dt className="text-stone-500">Providers</dt>
								<dd>{providers.length}</dd>
							</div>
						</dl>
						<Button
							className={`${formPrimaryButtonClassName} mt-5 w-full`}
							disabled={!promptSetId || !providers.length || save.isPending}
							onClick={() =>
								save.mutate({
									workspaceId,
									promptSetId,
									providers: providers as Array<
										"doubao" | "deepseek" | "hunyuan" | "qwen"
									>,
									providerModes: Object.fromEntries(
										providers.map((provider) => [
											provider,
											providerModes[provider as keyof typeof providerModes],
										]),
									),
									cadence,
									timezone,
									localTime,
									dayOfWeek: cadence === "weekly" ? dayOfWeek : null,
									dayOfMonth: cadence === "monthly" ? dayOfMonth : null,
								})
							}
						>
							{save.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Save className="size-4" />
							)}{" "}
							Save schedule
						</Button>
					</aside>
				</section>

				<section className="space-y-4">
					<h2 className="text-base font-semibold">
						Active and paused schedules
					</h2>
					<div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-neutral-800 dark:border-neutral-800">
						{schedules.data?.map((schedule) => (
							<div
								key={schedule.id}
								className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
							>
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<p className="truncate font-medium">
											{schedule.promptSet?.name ?? "Deleted detection set"}
										</p>
										<span
											className={`text-xs font-medium ${schedule.enabled ? "text-emerald-700" : "text-stone-500"}`}
										>
											{schedule.enabled ? "Active" : "Paused"}
										</span>
									</div>
									<p className="mt-1 text-xs text-stone-500">
										{schedule.cadence} · {schedule.localTime} ·{" "}
										{schedule.timezone} ·{" "}
										{(schedule.providers ?? [])
											.map(
												(provider) =>
													PROVIDERS.find(([key]) => key === provider)?.[1] ??
													provider,
											)
											.join(", ")}
									</p>
									<p className="mt-1 text-xs text-stone-500">
										Modes:{" "}
										{(schedule.providers ?? [])
											.map((provider) => {
												const mode = (schedule.providerModes?.[provider] ??
													"default") as ProviderMode;
												return `${provider}: ${getProviderModeLabel(provider, mode)}`;
											})
											.join(" · ")}
									</p>
									<p className="mt-1 text-xs text-stone-500">
										Next:{" "}
										{schedule.nextRunAt
											? new Date(schedule.nextRunAt).toLocaleString()
											: "Paused"}
										{schedule.lastError
											? ` · Last error: ${schedule.lastError}`
											: ""}
									</p>
								</div>
								<div className="flex gap-2">
									<Button
										className={formSecondaryButtonClassName}
										onClick={() =>
											pause.mutate({
												workspaceId,
												scheduleId: schedule.id,
												enabled: !schedule.enabled,
											})
										}
										disabled={pause.isPending}
									>
										{schedule.enabled ? (
											<Pause className="size-4" />
										) : (
											<Play className="size-4" />
										)}
										{schedule.enabled ? "Pause" : "Resume"}
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label="Delete schedule"
										onClick={() =>
											remove.mutate({ workspaceId, scheduleId: schedule.id })
										}
										disabled={remove.isPending}
									>
										<Trash2 className="size-4" />
									</Button>
								</div>
							</div>
						))}
						{!schedules.data?.length ? (
							<p className="py-10 text-center text-sm text-stone-500">
								No recurring schedules.
							</p>
						) : null}
					</div>
				</section>
			</div>
		</div>
	);
}
