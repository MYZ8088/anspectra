import { db, schema } from "@anspectra/db";
import { NotFoundError, ValidationError } from "@anspectra/errors";
import {
	type DetectionScheduleCadence,
	GEO_PROVIDER_MODE_CAPABILITIES,
	type Provider,
	type ProviderMode,
} from "@anspectra/types";
import { and, asc, eq, lte } from "drizzle-orm";
import {
	nextDetectionScheduleAfterInitialRun,
	nextDetectionScheduleAt,
} from "./detectionRunPlan.js";
import { GEO_WEB_PROVIDERS, startGeoCollectionRun } from "./runs.js";

export {
	nextDetectionScheduleAfterInitialRun,
	nextDetectionScheduleAt,
} from "./detectionRunPlan.js";

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
		cadence: schedule.cadence as DetectionScheduleCadence,
		promptSet: promptSetById.get(schedule.promptSetId) ?? null,
	}));
}

export async function saveDetectionSchedule(args: {
	workspaceId: string;
	userId: string;
	promptSetId: string;
	providers: Provider[];
	providerModes?: Partial<Record<Provider, ProviderMode>>;
	cadence: DetectionScheduleCadence;
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
		throw new ValidationError(
			"Only complete detection configurations can be scheduled",
		);
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
				cadence: current.cadence as DetectionScheduleCadence,
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
			cadence: schedule.cadence as DetectionScheduleCadence,
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
