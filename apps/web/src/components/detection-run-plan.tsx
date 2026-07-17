"use client";

import type { DetectionRunPlan } from "@aloom/types";
import { Input } from "@aloom/ui";
import { cn } from "@aloom/utils";
import { CalendarClock, Minus, Plus } from "lucide-react";

const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

const CADENCE_OPTIONS = [
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
] as const;

const MIN_RUNS = 1;
const MAX_RUNS = 30;

export type DetectionRunPlanDraft = DetectionRunPlan;

function clampRunCount(value: number): number {
	return Math.min(MAX_RUNS, Math.max(MIN_RUNS, Math.round(value)));
}

export function DetectionRunPlanEditor(props: {
	value: DetectionRunPlanDraft;
	onChange: (value: DetectionRunPlanDraft) => void;
}) {
	const update = (change: Partial<DetectionRunPlanDraft>) =>
		props.onChange({ ...props.value, ...change });
	const setRunCount = (totalRuns: number) =>
		update({ totalRuns: clampRunCount(totalRuns) });
	const hasFutureRuns = props.value.totalRuns > 1;
	const remainingRuns = Math.max(0, props.value.totalRuns - 1);

	return (
		<div className="mt-5 border-t border-stone-200 pt-5 dark:border-neutral-800">
			<div className="flex items-start justify-between gap-4">
				<div>
					<p className="text-sm font-medium">Run plan</p>
					<p className="mt-1 text-xs leading-5 text-stone-500">
						The first run is queued immediately.
					</p>
				</div>
				<span className="shrink-0 text-xs font-medium text-stone-500">
					1-{MAX_RUNS} runs
				</span>
			</div>

			<div className="mt-4 grid gap-4">
				<div className="grid gap-1.5 text-xs">
					<label htmlFor="detection-total-runs" className="font-medium">
						Total runs
					</label>
					<div className="grid h-10 grid-cols-[40px_minmax(0,1fr)_40px] overflow-hidden rounded-md border border-stone-200 dark:border-neutral-800">
						<button
							type="button"
							aria-label="Decrease total runs"
							title="Decrease total runs"
							disabled={props.value.totalRuns <= MIN_RUNS}
							onClick={() => setRunCount(props.value.totalRuns - 1)}
							className="grid size-10 place-items-center border-r border-stone-200 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-600 disabled:cursor-not-allowed disabled:opacity-35 dark:border-neutral-800 dark:hover:bg-neutral-900"
						>
							<Minus className="size-4" />
						</button>
						<Input
							id="detection-total-runs"
							type="number"
							min={MIN_RUNS}
							max={MAX_RUNS}
							value={props.value.totalRuns}
							onChange={(event) => setRunCount(Number(event.target.value))}
							className="h-10 rounded-none border-0 text-center font-semibold tabular-nums shadow-none focus-visible:ring-0"
						/>
						<button
							type="button"
							aria-label="Increase total runs"
							title="Increase total runs"
							disabled={props.value.totalRuns >= MAX_RUNS}
							onClick={() => setRunCount(props.value.totalRuns + 1)}
							className="grid size-10 place-items-center border-l border-stone-200 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-600 disabled:cursor-not-allowed disabled:opacity-35 dark:border-neutral-800 dark:hover:bg-neutral-900"
						>
							<Plus className="size-4" />
						</button>
					</div>
				</div>

				{hasFutureRuns ? (
					<>
						<fieldset className="grid gap-1.5 text-xs">
							<legend className="font-medium">Frequency</legend>
							<div className="grid grid-cols-3 overflow-hidden rounded-md border border-stone-200 dark:border-neutral-800">
								{CADENCE_OPTIONS.map((option) => (
									<button
										key={option.value}
										type="button"
										aria-pressed={props.value.cadence === option.value}
										onClick={() => update({ cadence: option.value })}
										className={cn(
											"h-9 border-r border-stone-200 text-xs font-medium transition-colors last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-600 dark:border-neutral-800",
											props.value.cadence === option.value
												? "bg-stone-900 text-white dark:bg-white dark:text-black"
												: "hover:bg-stone-50 dark:hover:bg-neutral-900",
										)}
									>
										{option.label}
									</button>
								))}
							</div>
						</fieldset>

						<label
							htmlFor="detection-repeat-time"
							className="grid gap-1.5 text-xs"
						>
							<span className="font-medium">Local time</span>
							<Input
								id="detection-repeat-time"
								type="time"
								value={props.value.localTime}
								onChange={(event) => update({ localTime: event.target.value })}
							/>
						</label>

						{props.value.cadence === "weekly" ? (
							<label className="grid gap-1.5 text-xs">
								<span className="font-medium">Weekday</span>
								<select
									value={props.value.dayOfWeek ?? 1}
									onChange={(event) =>
										update({ dayOfWeek: Number(event.target.value) })
									}
									className="h-10 rounded-md border border-stone-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950"
								>
									{WEEKDAYS.map((label, index) => (
										<option key={label} value={index}>
											{label}
										</option>
									))}
								</select>
							</label>
						) : props.value.cadence === "monthly" ? (
							<label
								htmlFor="detection-repeat-day"
								className="grid gap-1.5 text-xs"
							>
								<span className="font-medium">Day of month</span>
								<Input
									id="detection-repeat-day"
									type="number"
									min={1}
									max={28}
									value={props.value.dayOfMonth ?? 1}
									onChange={(event) =>
										update({ dayOfMonth: Number(event.target.value) })
									}
								/>
							</label>
						) : null}

						<label
							htmlFor="detection-repeat-timezone"
							className="grid gap-1.5 text-xs"
						>
							<span className="font-medium">Timezone</span>
							<Input
								id="detection-repeat-timezone"
								value={props.value.timezone}
								onChange={(event) => update({ timezone: event.target.value })}
								placeholder="Asia/Shanghai"
							/>
						</label>
					</>
				) : null}
			</div>

			<div className="mt-4 flex gap-3 border-l-2 border-cyan-600 pl-3 text-xs leading-5 text-stone-600 dark:text-stone-400">
				<CalendarClock className="mt-0.5 size-4 shrink-0 text-cyan-700 dark:text-cyan-300" />
				<p>
					{hasFutureRuns
						? `The first run queues now. ${remainingRuns} more ${remainingRuns === 1 ? "run follows" : "runs follow"} ${props.value.cadence} at ${props.value.localTime}.`
						: "One complete detection run will be queued now."}
				</p>
			</div>
		</div>
	);
}
