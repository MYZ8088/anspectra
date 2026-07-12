import {
	claimCollectorCommand,
	claimCollectorTask,
	completeCollectorTask,
	heartbeatCollector,
	recordCollectorSampleAttempt,
	reportCollectorChallenge,
	uploadCollectorSample,
} from "@aloom/services";
import { GEO_WEB_PROVIDERS } from "@aloom/services";
import {
	COLLECTION_PHASE_LIST,
	FAILURE_CATEGORY_LIST,
	FAILURE_CODE_LIST,
	PROVIDER_MODE_LIST,
} from "@aloom/types";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sourceSchema = z.object({
	title: z.string(),
	cited_text: z.string(),
	url: z.string(),
	domain: z.string().nullable(),
	favicon: z.string().nullable(),
});
const providerSchema = z.enum(GEO_WEB_PROVIDERS);

function bearerToken(request: Request): string {
	const value = request.headers.get("authorization") ?? "";
	if (!value.startsWith("Bearer "))
		throw new Error("Collector bearer token is required");
	return value.slice(7).trim();
}

export async function POST(
	request: Request,
	context: { params: Promise<{ action: string }> },
) {
	try {
		const { action } = await context.params;
		const deviceToken = bearerToken(request);
		const body = await request.json().catch(() => ({}));
		if (action === "heartbeat") {
			const input = z
				.object({
					metadata: z.record(z.unknown()).optional(),
					providerHealth: z
						.array(
							z.object({ provider: providerSchema, status: z.string().min(1) }),
						)
						.optional(),
				})
				.parse(body);
			return NextResponse.json(
				await heartbeatCollector({ deviceToken, ...input }),
			);
		}
		if (action === "claim") {
			return NextResponse.json({ task: await claimCollectorTask(deviceToken) });
		}
		if (action === "commands") {
			return NextResponse.json({
				command: await claimCollectorCommand(deviceToken),
			});
		}
		if (action === "sample") {
			const input = z
				.object({
					runId: z.string().uuid(),
					provider: providerSchema,
					promptRunAt: z.string().datetime(),
					sample: z.object({
						userId: z.string().min(1),
						workspaceId: z.string().min(1),
						promptId: z.string().uuid(),
						prompt: z.string().min(1),
						response: z.string().min(20),
						sources: z.array(sourceSchema),
						conversationId: z.string().nullable().optional(),
						conversationUrl: z.string().nullable().optional(),
						conversationIsolation: z
							.enum(["fresh", "multi_turn_experiment"])
							.optional(),
							sourceExposure: z.enum(["exposed", "not_exposed"]).optional(),
							requestedMode: z.enum(PROVIDER_MODE_LIST).optional(),
							actualMode: z.enum(PROVIDER_MODE_LIST).optional(),
					}),
				})
				.parse(body);
			return NextResponse.json(
				await uploadCollectorSample({ deviceToken, ...input }),
			);
		}
		if (action === "attempt") {
			const input = z
				.object({
					runId: z.string().uuid(),
					provider: providerSchema,
					promptId: z.string().uuid(),
					attemptIndex: z.number().int().min(1),
					status: z.enum(["started", "progress", "completed", "failed"]),
					phase: z.enum(COLLECTION_PHASE_LIST),
					requestedMode: z.enum(PROVIDER_MODE_LIST).optional(),
					actualMode: z.enum(PROVIDER_MODE_LIST).optional(),
					failureCategory: z.enum(FAILURE_CATEGORY_LIST).optional(),
					failureCode: z.enum(FAILURE_CODE_LIST).optional(),
					failureMessage: z.string().optional(),
					retryable: z.boolean().optional(),
					pageUrl: z.string().url().optional(),
					conversationId: z.string().optional(),
					diagnostics: z.record(z.unknown()).optional(),
				})
				.parse(body);
			const { runId, provider, requestedMode, actualMode, ...update } = input;
			return NextResponse.json(
				await recordCollectorSampleAttempt({
					deviceToken,
					runId,
					provider,
					requestedMode,
					actualMode,
					update,
				}),
			);
		}
		if (action === "event") {
			const input = z
				.object({
					runId: z.string().uuid(),
					provider: providerSchema,
					promptId: z.string().uuid().optional(),
					kind: z.string().min(1),
					pageUrl: z.string().url(),
					message: z.string().min(1),
				})
				.parse(body);
			return NextResponse.json(
				await reportCollectorChallenge({ deviceToken, ...input }),
			);
		}
		if (action === "complete") {
			const input = z
				.object({
					runId: z.string().uuid(),
					provider: providerSchema,
					status: z.enum(["completed", "partial", "failed", "cancelled"]),
					errorMessage: z.string().optional(),
				})
				.parse(body);
			return NextResponse.json(
				await completeCollectorTask({ deviceToken, ...input }),
			);
		}
		return NextResponse.json(
			{ error: "Unknown runner action" },
			{ status: 404 },
		);
	} catch (error) {
		return NextResponse.json(
			{
				error: error instanceof Error ? error.message : "Runner request failed",
			},
			{ status: 400 },
		);
	}
}
