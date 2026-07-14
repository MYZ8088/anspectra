import { createHash, randomBytes } from "node:crypto";
import { db, schema } from "@aloom/db";
import { NotFoundError, ValidationError } from "@aloom/errors";
import type {
	AskPromptResult,
	PromptAttemptUpdate,
	Provider,
	ProviderMode,
} from "@aloom/types";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { storePromptResponses } from "../prompt/storePromptResponses.js";
import {
	GEO_WEB_PROVIDERS,
	finalizeGeoProviderRun,
	persistGeoHumanChallenge,
	persistGeoSampleCheckpoint,
	recordGeoSampleAttempt,
} from "./runs.js";

const COLLECTOR_TOKEN_PREFIX = "aloom_collector_";
const LEGACY_COLLECTOR_TOKEN_PREFIX = "ogl_collector_";

function hashDeviceToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export async function pairCollectorNode(args: {
	workspaceId: string;
	name: string;
	platform: string;
}) {
	const token = `${COLLECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
	const [collector] = await db
		.insert(schema.collectorNodes)
		.values({
			workspaceId: args.workspaceId,
			name: args.name,
			platform: args.platform,
			status: "online",
			deviceTokenHash: hashDeviceToken(token),
			lastHeartbeatAt: new Date(),
			metadata: { cookieStorage: "local_only", protocolVersion: 1 },
		})
		.returning();
	if (!collector) throw new Error("Failed to pair collector");
	await db.insert(schema.providerProfiles).values(
		GEO_WEB_PROVIDERS.map((provider) => ({
			workspaceId: args.workspaceId,
			collectorNodeId: collector.id,
			provider,
			profileKey: `${collector.id}:${provider}`,
			status: "disconnected",
		})),
	);
	return { collector, deviceToken: token };
}

export async function authenticateCollector(deviceToken: string) {
	if (
		!deviceToken.startsWith(COLLECTOR_TOKEN_PREFIX) &&
		!deviceToken.startsWith(LEGACY_COLLECTOR_TOKEN_PREFIX)
	) {
		throw new ValidationError("Invalid collector token");
	}
	const collector = await db.query.collectorNodes.findFirst({
		where: eq(
			schema.collectorNodes.deviceTokenHash,
			hashDeviceToken(deviceToken),
		),
	});
	if (!collector)
		throw new ValidationError("Collector token is not recognized");
	return collector;
}

export async function heartbeatCollector(args: {
	deviceToken: string;
	metadata?: Record<string, unknown>;
	providerHealth?: Array<{ provider: Provider; status: string }>;
}) {
	const collector = await authenticateCollector(args.deviceToken);
	const now = new Date();
	await db
		.update(schema.collectorNodes)
		.set({
			status: "online",
			lastHeartbeatAt: now,
			metadata: { ...(collector.metadata ?? {}), ...(args.metadata ?? {}) },
			updatedAt: now,
		})
		.where(eq(schema.collectorNodes.id, collector.id));
	for (const health of args.providerHealth ?? []) {
		if (!GEO_WEB_PROVIDERS.includes(health.provider as never)) continue;
		await db
			.update(schema.providerProfiles)
			.set({
				status: health.status,
				lastSessionCheckAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(schema.providerProfiles.collectorNodeId, collector.id),
					eq(schema.providerProfiles.provider, health.provider),
				),
			);
	}
	return { collectorId: collector.id, serverTime: now.toISOString() };
}

export async function listCollectorNodes(workspaceId: string) {
	return db.query.collectorNodes.findMany({
		where: eq(schema.collectorNodes.workspaceId, workspaceId),
		orderBy: [desc(schema.collectorNodes.createdAt)],
	});
}

export async function claimCollectorTask(deviceToken: string) {
	const collector = await authenticateCollector(deviceToken);
	const runs = await db.query.collectionRuns.findMany({
		where: and(
			eq(schema.collectionRuns.collectorNodeId, collector.id),
			inArray(schema.collectionRuns.status, [
				"queued",
				"waiting_runner",
				"running",
			]),
			lte(schema.collectionRuns.scheduledAt, new Date()),
		),
		orderBy: [asc(schema.collectionRuns.scheduledAt)],
		limit: 10,
	});
	for (const run of runs) {
		const checkpoints = await db.query.sampleCheckpoints.findMany({
			where: and(
				eq(schema.sampleCheckpoints.runId, run.id),
				eq(schema.sampleCheckpoints.status, "queued"),
			),
			orderBy: [asc(schema.sampleCheckpoints.createdAt)],
		});
		const provider = checkpoints[0]?.provider as Provider | undefined;
		if (!provider || !GEO_WEB_PROVIDERS.includes(provider as never)) continue;
		const providerCheckpoints = checkpoints.filter(
			(item) => item.provider === provider,
		);
		const promptIds = providerCheckpoints
			.map((item) => item.promptId)
			.filter((id): id is string => Boolean(id));
		if (promptIds.length === 0) continue;
		const prompts = await db.query.monitorPrompts.findMany({
			where: inArray(schema.monitorPrompts.id, promptIds),
			orderBy: [asc(schema.monitorPrompts.createdAt)],
		});
		const now = new Date();
		await db.transaction(async (tx) => {
			await tx
				.update(schema.sampleCheckpoints)
				.set({ status: "running", startedAt: now, updatedAt: now })
				.where(
					inArray(
						schema.sampleCheckpoints.id,
						providerCheckpoints.map((item) => item.id),
					),
				);
			await tx
				.update(schema.collectionRuns)
				.set({
					status: "running",
					startedAt: run.startedAt ?? now,
					updatedAt: now,
				})
				.where(eq(schema.collectionRuns.id, run.id));
		});
		return {
			taskId: `${run.id}:${provider}`,
			runId: run.id,
			workspaceId: run.workspaceId,
			userId: String(
				((run.metadata ?? {}) as Record<string, unknown>).userId || "collector",
			),
			provider,
			providerMode: (providerCheckpoints[0]?.requestedMode ??
				"default") as ProviderMode,
			prompts: prompts.map((prompt) => ({
				id: prompt.id,
				prompt: prompt.prompt,
			})),
			attemptIndexOffsets: Object.fromEntries(
				providerCheckpoints.flatMap((checkpoint) =>
					checkpoint.promptId
						? [[checkpoint.promptId, checkpoint.attemptCount] as const]
						: [],
				),
			),
			conversationIsolation: "fresh" as const,
			minPromptDelayMs: 3 * 60_000,
			maxPromptDelayMs: 8 * 60_000,
		};
	}
	return null;
}

export async function uploadCollectorSample(args: {
	deviceToken: string;
	runId: string;
	provider: Provider;
	sample: AskPromptResult;
	promptRunAt: string;
}) {
	const collector = await authenticateCollector(args.deviceToken);
	const run = await db.query.collectionRuns.findFirst({
		where: and(
			eq(schema.collectionRuns.id, args.runId),
			eq(schema.collectionRuns.workspaceId, collector.workspaceId),
			eq(schema.collectionRuns.collectorNodeId, collector.id),
		),
	});
	if (!run) throw new NotFoundError("Collector task not found");
	const result = Object.fromEntries(
		GEO_WEB_PROVIDERS.map((provider) => [
			provider,
			provider === args.provider
				? { status: "fulfilled" as const, data: [args.sample] }
				: { status: "rejected" as const, data: [] },
		]),
	) as Parameters<typeof storePromptResponses>[0]["results"];
	const [sampleId] = await storePromptResponses({
		results: result,
		userId: args.sample.userId,
		workspaceId: collector.workspaceId,
		promptRunAt: args.promptRunAt,
		runId: run.id,
	});
	await persistGeoSampleCheckpoint({
		collectionRunId: run.id,
		provider: args.provider,
		sample: args.sample,
		analyticsSampleId: sampleId,
	});
	return { accepted: true, sampleId };
}

export async function recordCollectorSampleAttempt(args: {
	deviceToken: string;
	runId: string;
	provider: Provider;
	requestedMode?: ProviderMode;
	actualMode?: ProviderMode;
	update: PromptAttemptUpdate;
}) {
	const collector = await authenticateCollector(args.deviceToken);
	const run = await db.query.collectionRuns.findFirst({
		where: and(
			eq(schema.collectionRuns.id, args.runId),
			eq(schema.collectionRuns.workspaceId, collector.workspaceId),
			eq(schema.collectionRuns.collectorNodeId, collector.id),
		),
	});
	if (!run) throw new NotFoundError("Collector task not found");
	return recordGeoSampleAttempt({
		runId: run.id,
		provider: args.provider,
		requestedMode: args.requestedMode,
		actualMode: args.actualMode,
		...args.update,
	});
}

export async function reportCollectorChallenge(args: {
	deviceToken: string;
	runId: string;
	provider: Provider;
	promptId?: string;
	kind: string;
	pageUrl: string;
	message: string;
}) {
	const collector = await authenticateCollector(args.deviceToken);
	await persistGeoHumanChallenge({
		collectionRunId: args.runId,
		workspaceId: collector.workspaceId,
		provider: args.provider,
		promptId: args.promptId,
		kind: args.kind,
		pageUrl: args.pageUrl,
		message: args.message,
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
	});
	return { accepted: true };
}

export async function completeCollectorTask(args: {
	deviceToken: string;
	runId: string;
	provider: Provider;
	status: "completed" | "partial" | "failed" | "cancelled";
	errorMessage?: string;
}) {
	const collector = await authenticateCollector(args.deviceToken);
	const run = await db.query.collectionRuns.findFirst({
		where: and(
			eq(schema.collectionRuns.id, args.runId),
			eq(schema.collectionRuns.collectorNodeId, collector.id),
		),
	});
	if (!run) throw new NotFoundError("Collector task not found");
	await finalizeGeoProviderRun({
		collectionRunId: run.id,
		provider: args.provider,
		status: args.status,
		errorMessage: args.errorMessage,
	});
	return { accepted: true };
}

export async function claimCollectorCommand(deviceToken: string) {
	const collector = await authenticateCollector(deviceToken);
	const command = await db.query.collectorCommands.findFirst({
		where: and(
			eq(schema.collectorCommands.collectorNodeId, collector.id),
			eq(schema.collectorCommands.status, "queued"),
			gte(schema.collectorCommands.expiresAt, new Date()),
		),
		orderBy: [asc(schema.collectorCommands.createdAt)],
	});
	if (!command) return null;
	await db
		.update(schema.collectorCommands)
		.set({
			status: "delivered",
			deliveredAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(schema.collectorCommands.id, command.id));
	return command;
}
