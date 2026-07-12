import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, schema } from "@aloom/db";
import type {
	CamoufoxRuntimeManifest,
	Provider,
	ProviderIdentityManifest,
} from "@aloom/types";
import { and, asc, eq } from "drizzle-orm";
import { getProviderProfileDir } from "../agent/auth.js";
import { GEO_WEB_PROVIDERS, startGeoCollectionRun } from "./runs.js";

const DIAGNOSTIC_PACK_KEY = "aloom-provider-diagnostic";
const DIAGNOSTIC_VERSION = "1.0.0";

const DIAGNOSTIC_PROMPTS = [
	{
		locale: "zh-CN",
		prompt:
			"请用三点说明企业选择产品分析工具时应评估哪些因素；如果当前页面提供联网来源，请保留可见引用。",
	},
	{
		locale: "en-US",
		prompt:
			"In three concise points, explain what a B2B team should evaluate when choosing product analytics software. Preserve any visible web citations the interface provides.",
	},
] as const;

function diagnosticHash(locale: string, prompt: string) {
	return createHash("sha256")
		.update(`${DIAGNOSTIC_PACK_KEY}\n${DIAGNOSTIC_VERSION}\n${locale}\n${prompt}`)
		.digest("hex");
}

export async function ensureProviderDiagnosticPromptSet(workspaceId: string) {
	const existing = await db.query.promptSets.findFirst({
		where: and(
			eq(schema.promptSets.workspaceId, workspaceId),
			eq(schema.promptSets.purpose, "diagnostic"),
			eq(schema.promptSets.packKey, DIAGNOSTIC_PACK_KEY),
			eq(schema.promptSets.templateVersion, DIAGNOSTIC_VERSION),
		),
	});
	if (existing) {
		const prompts = await db.query.monitorPrompts.findMany({
			where: and(
				eq(schema.monitorPrompts.promptSetId, existing.id),
				eq(schema.monitorPrompts.active, true),
			),
			orderBy: [asc(schema.monitorPrompts.createdAt)],
		});
		if (prompts.length === DIAGNOSTIC_PROMPTS.length) {
			return { promptSet: existing, prompts };
		}
	}

	return db.transaction(async (tx) => {
		const expectedPromptHashes = DIAGNOSTIC_PROMPTS.map((item) =>
			diagnosticHash(item.locale, item.prompt),
		);
		const [promptSet] = await tx
			.insert(schema.promptSets)
			.values({
				workspaceId,
				name: "Official Web provider diagnostic",
				tier: "quick",
				status: "active",
				purpose: "diagnostic",
				packKey: DIAGNOSTIC_PACK_KEY,
				templateVersion: DIAGNOSTIC_VERSION,
				manifest: {
					expectedPromptHashes,
					excludedFromGeoScore: true,
					conversationIsolation: "fresh",
				},
			})
			.returning();
		if (!promptSet) throw new Error("Failed to create diagnostic prompt set");
		const prompts = await tx
			.insert(schema.monitorPrompts)
			.values(
				DIAGNOSTIC_PROMPTS.map((item) => {
					const promptHash = diagnosticHash(item.locale, item.prompt);
					return {
						workspaceId,
						promptSetId: promptSet.id,
						prompt: item.prompt,
						promptGroup: "information",
						locale: item.locale,
						decisionStage: "evaluation",
						cohort: "diagnostic",
						origin: "diagnostic",
						templateKey: `${DIAGNOSTIC_PACK_KEY}:${item.locale}`,
						templateVersion: DIAGNOSTIC_VERSION,
						promptHash,
						brandExposure: "blind",
						dimensions: {
							origin: "diagnostic",
							excludedFromGeoScore: true,
						},
						rewrites: { standaloneQuestion: item.prompt },
						active: true,
					};
				}),
			)
			.returning();
		return { promptSet, prompts };
	});
}

export async function runProviderSmoke(args: {
	workspaceId: string;
	userId: string;
	providers?: Provider[];
}) {
	const { promptSet, prompts } = await ensureProviderDiagnosticPromptSet(
		args.workspaceId,
	);
	const run = await startGeoCollectionRun({
		workspaceId: args.workspaceId,
		userId: args.userId,
		promptSetId: promptSet.id,
		providers: args.providers?.length
			? args.providers
			: [...GEO_WEB_PROVIDERS],
		requiredPurpose: "diagnostic",
	});
	return {
		...run,
		diagnostic: true,
		promptCount: prompts.length,
		excludedFromGeoScore: true,
	};
}

function resolveWorkspaceRoot(startDir = process.cwd()) {
	let current = path.resolve(startDir);
	while (true) {
		if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return path.resolve(startDir);
		current = parent;
	}
}

async function readJson<T>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(filePath, "utf8")) as T;
	} catch {
		return null;
	}
}

export async function getCamoufoxDiagnostics(workspaceId: string) {
	const workspaceRoot = resolveWorkspaceRoot();
	const manifestPath = path.join(
		workspaceRoot,
		".aloom-storage",
		"camoufox-venv",
		"aloom-runtime.json",
	);
	const runtime = await readJson<CamoufoxRuntimeManifest>(manifestPath);
	const identities = await Promise.all(
		GEO_WEB_PROVIDERS.map(async (provider) => {
			const profileDir = getProviderProfileDir(provider);
			const identityPath = path.join(path.dirname(profileDir), "identity.json");
			const identity = await readJson<ProviderIdentityManifest>(identityPath);
			return {
				provider,
				profileDir,
				profileExists: existsSync(profileDir),
				identityPath,
				identity,
			};
		}),
	);
	const [collectors, providerProfiles, openChallenges] = await Promise.all([
		db.query.collectorNodes.findMany({
			where: eq(schema.collectorNodes.workspaceId, workspaceId),
		}),
		db.query.providerProfiles.findMany({
			where: eq(schema.providerProfiles.workspaceId, workspaceId),
		}),
		db.query.humanChallenges.findMany({
			where: and(
				eq(schema.humanChallenges.workspaceId, workspaceId),
				eq(schema.humanChallenges.status, "open"),
			),
		}),
	]);
	return {
		runtime: {
			available: Boolean(runtime && existsSync(runtime.executablePath)),
			manifestPath,
			manifest: runtime,
		},
		identities,
		collectors,
		providerProfiles,
		openChallengeCount: openChallenges.length,
	};
}
