import { db, schema } from "@aloom/db";
import { NotFoundError, ValidationError } from "@aloom/errors";
import {
	GEO_PROVIDER_MODE_CAPABILITIES,
	type Provider,
	type ProviderMode,
} from "@aloom/types";
import { CronExpressionParser } from "cron-parser";
import { and, asc, eq, lte } from "drizzle-orm";
import { GEO_WEB_PROVIDERS, startGeoCollectionRun } from "./runs.js";

type ScheduleCadence = "weekly" | "monthly";

export function resolveDetectionScheduleModes(
	providers: Provider[],
	requested: Partial<Record<Provider, ProviderMode>> = {},
): Partial<Record<Provider, ProviderMode>> {
	return Object.fromEntries(
		providers.map((provider) => {
			const mode = requested[provider] ?? "default";
			const supported =
				GEO_PROVIDER_MODE_CAPABILITIES[
					provider as keyof typeof GEO_PROVIDER_MODE_CAPABILITIES
				];
			if (!supported?.includes(mode as never)) {
				throw new ValidationError(
					`${provider} does not support official Web mode "${mode}"`,
				);
			}
			return [provider, mode];
		}),
	) as Partial<Record<Provider, ProviderMode>>;
}

function validateTimezone(timezone: string): void {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
	} catch {
		throw new ValidationError("Select a valid IANA timezone");
	}
}

function scheduleExpression(args: {
	cadence: ScheduleCadence;
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
	if (args.cadence === "weekly") {
		const day = args.dayOfWeek ?? 1;
		if (!Number.isInteger(day) || day < 0 || day > 6) {
			throw new ValidationError("Weekly schedules require a weekday from 0 to 6");
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
	cadence: ScheduleCadence;
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
	}).next().toDate();
}

export async function listDetectionSchedules(workspaceId: string) {
	const schedules = await db.query.detectionSchedules.findMany({
		where: eq(schema.detectionSchedules.workspaceId, workspaceId),
		orderBy: [asc(schema.detectionSchedules.createdAt)],
	});
	const promptSetIds = [...new Set(schedules.map((item) => item.promptSetId))];
	const promptSets = await db.query.promptSets.findMany({
		where: promptSetIds.length
			? (table, { inArray }) => inArray(table.id, promptSetIds)
			: eq(schema.promptSets.id, "00000000-0000-0000-0000-000000000000"),
	});
	const promptSetById = new Map(promptSets.map((item) => [item.id, item]));
	return schedules.map((schedule) => ({
		...schedule,
		promptSet: promptSetById.get(schedule.promptSetId) ?? null,
	}));
}

export async function saveDetectionSchedule(args: {
	workspaceId: string;
	userId: string;
	promptSetId: string;
	providers: Provider[];
	providerModes?: Partial<Record<Provider, ProviderMode>>;
	cadence: ScheduleCadence;
	timezone: string;
	localTime: string;
	dayOfWeek?: number | null;
	dayOfMonth?: number | null;
}) {
	const promptSet = await db.query.promptSets.findFirst({
		where: and(
			eq(schema.promptSets.id, args.promptSetId),
			eq(schema.promptSets.workspaceId, args.workspaceId),
		),
	});
	if (!promptSet || promptSet.purpose !== "baseline") {
		throw new NotFoundError("Formal detection set not found");
	}
	const manifest = (promptSet.manifest ?? {}) as {
		expectedPromptHashes?: string[];
		completePreset?: boolean;
	};
	if (!manifest.completePreset || !manifest.expectedPromptHashes?.length) {
		throw new ValidationError("Only complete frozen detection sets can be scheduled");
	}
	const providers = [...new Set(args.providers)].filter((provider) =>
		GEO_WEB_PROVIDERS.includes(provider as never),
	);
	if (providers.length === 0) {
		throw new ValidationError("Select at least one supported Web provider");
	}
	const providerModes = resolveDetectionScheduleModes(
		providers,
		args.providerModes,
	);
	const nextRunAt = nextDetectionScheduleAt(args);
	const [schedule] = await db
		.insert(schema.detectionSchedules)
		.values({
			workspaceId: args.workspaceId,
			promptSetId: args.promptSetId,
			createdByUserId: args.userId,
			providers,
			providerModes,
			cadence: args.cadence,
			timezone: args.timezone,
			localTime: args.localTime,
			dayOfWeek: args.cadence === "weekly" ? (args.dayOfWeek ?? 1) : null,
			dayOfMonth: args.cadence === "monthly" ? (args.dayOfMonth ?? 1) : null,
			enabled: true,
			nextRunAt,
			lastError: null,
		})
		.onConflictDoUpdate({
			target: [
				schema.detectionSchedules.workspaceId,
				schema.detectionSchedules.promptSetId,
			],
			set: {
				createdByUserId: args.userId,
				providers,
				providerModes,
				cadence: args.cadence,
				timezone: args.timezone,
				localTime: args.localTime,
				dayOfWeek: args.cadence === "weekly" ? (args.dayOfWeek ?? 1) : null,
				dayOfMonth: args.cadence === "monthly" ? (args.dayOfMonth ?? 1) : null,
				enabled: true,
				nextRunAt,
				lastError: null,
				updatedAt: new Date(),
			},
		})
		.returning();
	if (!schedule) throw new Error("Failed to save the detection schedule");
	return schedule;
}

export async function pauseDetectionSchedule(args: {
	workspaceId: string;
	scheduleId: string;
	enabled: boolean;
}) {
	const current = await db.query.detectionSchedules.findFirst({
		where: and(
			eq(schema.detectionSchedules.id, args.scheduleId),
			eq(schema.detectionSchedules.workspaceId, args.workspaceId),
		),
	});
	if (!current) throw new NotFoundError("Detection schedule not found");
	const nextRunAt = args.enabled
		? nextDetectionScheduleAt({
				cadence: current.cadence as ScheduleCadence,
				timezone: current.timezone,
				localTime: current.localTime,
				dayOfWeek: current.dayOfWeek,
				dayOfMonth: current.dayOfMonth,
			})
		: null;
	const [updated] = await db
		.update(schema.detectionSchedules)
		.set({ enabled: args.enabled, nextRunAt, updatedAt: new Date() })
		.where(eq(schema.detectionSchedules.id, current.id))
		.returning();
	return updated;
}

export async function deleteDetectionSchedule(args: {
	workspaceId: string;
	scheduleId: string;
}) {
	const [deleted] = await db
		.delete(schema.detectionSchedules)
		.where(
			and(
				eq(schema.detectionSchedules.id, args.scheduleId),
				eq(schema.detectionSchedules.workspaceId, args.workspaceId),
			),
		)
		.returning({ id: schema.detectionSchedules.id });
	if (!deleted) throw new NotFoundError("Detection schedule not found");
	return deleted;
}

export async function dispatchDueDetectionSchedules(): Promise<number> {
	const now = new Date();
	const due = await db.query.detectionSchedules.findMany({
		where: and(
			eq(schema.detectionSchedules.enabled, true),
			lte(schema.detectionSchedules.nextRunAt, now),
		),
		orderBy: [asc(schema.detectionSchedules.nextRunAt)],
		limit: 10,
	});
	let dispatched = 0;
	for (const schedule of due) {
		const nextRunAt = nextDetectionScheduleAt({
			cadence: schedule.cadence as ScheduleCadence,
			timezone: schedule.timezone,
			localTime: schedule.localTime,
			dayOfWeek: schedule.dayOfWeek,
			dayOfMonth: schedule.dayOfMonth,
			from: now,
		});
		const [claimed] = await db
			.update(schema.detectionSchedules)
			.set({ nextRunAt, updatedAt: now })
			.where(
				and(
					eq(schema.detectionSchedules.id, schedule.id),
					eq(schema.detectionSchedules.enabled, true),
					lte(schema.detectionSchedules.nextRunAt, now),
				),
			)
			.returning();
		if (!claimed) continue;
		try {
			const result = await startGeoCollectionRun({
				workspaceId: schedule.workspaceId,
				userId: schedule.createdByUserId,
				promptSetId: schedule.promptSetId,
				providers: (schedule.providers ?? []) as Provider[],
				providerModes: (schedule.providerModes ?? {}) as Partial<
					Record<Provider, ProviderMode>
				>,
				requiredPurpose: "baseline",
			});
			await db
				.update(schema.detectionSchedules)
				.set({
					lastRunAt: now,
					lastSeriesId: result.seriesId,
					lastError: null,
					updatedAt: new Date(),
				})
				.where(eq(schema.detectionSchedules.id, schedule.id));
			dispatched += 1;
		} catch (error) {
			await db
				.update(schema.detectionSchedules)
				.set({
					lastError: error instanceof Error ? error.message : String(error),
					updatedAt: new Date(),
				})
				.where(eq(schema.detectionSchedules.id, schedule.id));
		}
	}
	return dispatched;
}
