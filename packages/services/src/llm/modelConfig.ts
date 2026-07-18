import { db, schema } from "@aloom/db";
import { NotFoundError, ValidationError } from "@aloom/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "../env.js";
import {
	type AnalysisModelConnection,
	createAnalysisModelGenerators,
} from "./modelClient.js";
import {
	decryptAnalysisApiKey,
	encryptAnalysisApiKey,
	normalizeAnalysisBaseUrl,
} from "./modelCredentials.js";
import { generateStructuredOutput } from "./structuredOutput.js";

export type { AnalysisModelConnection } from "./modelClient.js";
export {
	createAnalysisModelGenerators,
	analysisModelRequestOverrides,
	supportsStrictAnalysisSchema,
} from "./modelClient.js";
export {
	decryptAnalysisApiKey,
	encryptAnalysisApiKey,
	normalizeAnalysisBaseUrl,
} from "./modelCredentials.js";

export type PublicAnalysisModelConfig = {
	configured: boolean;
	baseUrl: string;
	model: string;
	hasApiKey: boolean;
	updatedAt: Date | null;
};

function modelCredentialSecret(): string {
	const secret =
		env.MODEL_CREDENTIAL_ENCRYPTION_KEY ??
		env.BETTER_AUTH_SECRET ??
		env.PUBLISHER_ENCRYPTION_KEY;
	if (!secret) {
		throw new ValidationError(
			"A server credential encryption key is required before model settings can be saved",
		);
	}
	return secret;
}

export async function getAnalysisModelConfig(
	workspaceId: string,
): Promise<PublicAnalysisModelConfig> {
	const config = await db.query.analysisModelConfigs.findFirst({
		where: eq(schema.analysisModelConfigs.workspaceId, workspaceId),
	});
	if (!config) {
		return {
			configured: false,
			baseUrl: "",
			model: "",
			hasApiKey: false,
			updatedAt: null,
		};
	}
	return {
		configured: true,
		baseUrl: config.baseUrl,
		model: config.model,
		hasApiKey: Boolean(config.encryptedApiKey),
		updatedAt: config.updatedAt,
	};
}

export async function saveAnalysisModelConfig(args: {
	workspaceId: string;
	baseUrl: string;
	model: string;
	apiKey?: string;
}): Promise<PublicAnalysisModelConfig> {
	const baseUrl = normalizeAnalysisBaseUrl(args.baseUrl);
	const model = args.model.trim();
	if (!model) throw new ValidationError("Enter a model ID");
	const existing = await db.query.analysisModelConfigs.findFirst({
		where: eq(schema.analysisModelConfigs.workspaceId, args.workspaceId),
	});
	const nextApiKey = args.apiKey?.trim();
	if (!nextApiKey && !existing?.encryptedApiKey) {
		throw new ValidationError("Enter an API key");
	}
	const encryptedApiKey = nextApiKey
		? encryptAnalysisApiKey({
				apiKey: nextApiKey,
				workspaceId: args.workspaceId,
				secret: modelCredentialSecret(),
			})
		: existing?.encryptedApiKey;
	if (!encryptedApiKey) throw new ValidationError("Enter an API key");

	await db
		.insert(schema.analysisModelConfigs)
		.values({
			workspaceId: args.workspaceId,
			baseUrl,
			model,
			encryptedApiKey,
		})
		.onConflictDoUpdate({
			target: schema.analysisModelConfigs.workspaceId,
			set: {
				baseUrl,
				model,
				encryptedApiKey,
				updatedAt: new Date(),
			},
		});
	return getAnalysisModelConfig(args.workspaceId);
}

export async function deleteAnalysisModelConfig(workspaceId: string) {
	await db
		.delete(schema.analysisModelConfigs)
		.where(eq(schema.analysisModelConfigs.workspaceId, workspaceId));
	return { configured: false } as const;
}

export async function loadAnalysisModelConnection(
	workspaceId: string,
): Promise<AnalysisModelConnection> {
	const config = await db.query.analysisModelConfigs.findFirst({
		where: eq(schema.analysisModelConfigs.workspaceId, workspaceId),
	});
	if (!config) {
		throw new NotFoundError(
			"Configure the analysis API base URL, model ID, and API key in Settings",
		);
	}
	return {
		baseUrl: config.baseUrl,
		model: config.model,
		apiKey: decryptAnalysisApiKey({
			encryptedApiKey: config.encryptedApiKey,
			workspaceId,
			secret: modelCredentialSecret(),
		}),
	};
}

const ConnectionTestSchema = z.object({ ok: z.literal(true) });

export async function testAnalysisModelConfig(workspaceId: string) {
	const connection = await loadAnalysisModelConnection(workspaceId);
	const generators = createAnalysisModelGenerators(connection, {
		maxTokens: 128,
		timeoutMs: 30_000,
	});
	const result = await generateStructuredOutput({
		schema: ConnectionTestSchema,
		schemaName: "connection_test",
		systemPrompt: "Return one JSON object matching the requested schema.",
		userPrompt: 'Return {"ok":true}.',
		generators,
		repairGenerator: generators[0],
		errorMessage: "The configured model did not return valid structured JSON",
	});
	return {
		ok: result.data.ok,
		model: result.model,
		attemptCount: result.attemptCount,
		parseMode: result.parseMode,
	};
}
