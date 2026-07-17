import { ValidationError } from "@aloom/errors";
import type { DetectionRunPlan, DetectionScheduleCadence } from "@aloom/types";
import { CronExpressionParser } from "cron-parser";

export function parseDetectionRunPlan(value: unknown): DetectionRunPlan | null {
	if (value == null) return null;
	if (typeof value !== "object") {
		throw new ValidationError("Detection run plan is invalid");
	}
	const candidate = value as Partial<DetectionRunPlan>;
	if (
		!Number.isInteger(candidate.totalRuns) ||
		(candidate.totalRuns ?? 0) < 1 ||
		(candidate.totalRuns ?? 0) > 30 ||
		!candidate.cadence ||
		!["daily", "weekly", "monthly"].includes(candidate.cadence) ||
		typeof candidate.timezone !== "string" ||
		!candidate.timezone ||
		typeof candidate.localTime !== "string" ||
		!/^\d{2}:\d{2}$/.test(candidate.localTime) ||
		(candidate.cadence === "weekly" &&
			(!Number.isInteger(candidate.dayOfWeek) ||
				(candidate.dayOfWeek ?? -1) < 0 ||
				(candidate.dayOfWeek ?? 7) > 6)) ||
		(candidate.cadence === "monthly" &&
			(!Number.isInteger(candidate.dayOfMonth) ||
				(candidate.dayOfMonth ?? 0) < 1 ||
				(candidate.dayOfMonth ?? 29) > 28))
	) {
		throw new ValidationError("Detection run plan is invalid");
	}
	return {
		totalRuns: candidate.totalRuns as number,
		cadence: candidate.cadence,
		timezone: candidate.timezone,
		localTime: candidate.localTime,
		dayOfWeek:
			typeof candidate.dayOfWeek === "number" ? candidate.dayOfWeek : null,
		dayOfMonth:
			typeof candidate.dayOfMonth === "number" ? candidate.dayOfMonth : null,
	};
}

function validateTimezone(timezone: string): void {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
	} catch {
		throw new ValidationError("Select a valid IANA timezone");
	}
}

function scheduleExpression(args: {
	cadence: DetectionScheduleCadence;
	localTime: string;
	dayOfWeek?: number | null;
	dayOfMonth?: number | null;
}): string {
	const match = /^(\d{2}):(\d{2})$/.exec(args.localTime);
	const hour = Number(match?.[1]);
	const minute = Number(match?.[2]);
	if (!match || hour > 23 || minute > 59) {
		throw new ValidationError("Local time must use the HH:mm format");
	}
	if (args.cadence === "daily") {
		return `${minute} ${hour} * * *`;
	}
	if (args.cadence === "weekly") {
		const day = args.dayOfWeek ?? 1;
		if (!Number.isInteger(day) || day < 0 || day > 6) {
			throw new ValidationError(
				"Weekly schedules require a weekday from 0 to 6",
			);
		}
		return `${minute} ${hour} * * ${day}`;
	}
	const day = args.dayOfMonth ?? 1;
	if (!Number.isInteger(day) || day < 1 || day > 28) {
		throw new ValidationError("Monthly schedules require a day from 1 to 28");
	}
	return `${minute} ${hour} ${day} * *`;
}

export function nextDetectionScheduleAt(args: {
	cadence: DetectionScheduleCadence;
	timezone: string;
	localTime: string;
	dayOfWeek?: number | null;
	dayOfMonth?: number | null;
	from?: Date;
}): Date {
	validateTimezone(args.timezone);
	const expression = scheduleExpression(args);
	return CronExpressionParser.parse(expression, {
		currentDate: args.from ?? new Date(),
		tz: args.timezone,
	})
		.next()
		.toDate();
}

function localDateKey(value: Date, timezone: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(value);
}

export function nextDetectionScheduleAfterInitialRun(args: {
	cadence: DetectionScheduleCadence;
	timezone: string;
	localTime: string;
	dayOfWeek?: number | null;
	dayOfMonth?: number | null;
	from?: Date;
}): Date {
	const from = args.from ?? new Date();
	const next = nextDetectionScheduleAt({ ...args, from });
	if (localDateKey(next, args.timezone) !== localDateKey(from, args.timezone)) {
		return next;
	}
	return nextDetectionScheduleAt({ ...args, from: next });
}

export function nextDetectionRunAt(plan: DetectionRunPlan, from: Date): Date {
	return nextDetectionScheduleAfterInitialRun({
		cadence: plan.cadence,
		timezone: plan.timezone,
		localTime: plan.localTime,
		dayOfWeek: plan.cadence === "weekly" ? plan.dayOfWeek : null,
		dayOfMonth: plan.cadence === "monthly" ? plan.dayOfMonth : null,
		from,
	});
}
