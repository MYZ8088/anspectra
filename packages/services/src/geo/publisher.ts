import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { db, schema } from "@anspectra/db";
import { NotFoundError, ValidationError } from "@anspectra/errors";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { env } from "../env.js";
import { buildMatchedPromptCohorts } from "./experimentCohorts.js";
import { auditWorkspaceSite } from "./siteAudit.js";

type WordPressConfig = {
	type: "wordpress";
	baseUrl: string;
	username: string;
	applicationPassword: string;
};
type GeoFlowConfig = { type: "geoflow"; baseUrl: string; apiToken: string };
type GitHubConfig = {
	type: "github";
	owner: string;
	repo: string;
	token: string;
	baseBranch: string;
	contentPath?: string;
};
export type PublisherConfig = WordPressConfig | GeoFlowConfig | GitHubConfig;

function encryptionKey(): Buffer {
	if (!env.PUBLISHER_ENCRYPTION_KEY) {
		throw new ValidationError(
			"PUBLISHER_ENCRYPTION_KEY is required for publisher connections",
		);
	}
	return createHash("sha256").update(env.PUBLISHER_ENCRYPTION_KEY).digest();
}

function encryptConfig(config: PublisherConfig): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
	const encrypted = Buffer.concat([
		cipher.update(JSON.stringify(config), "utf8"),
		cipher.final(),
	]);
	return [iv, cipher.getAuthTag(), encrypted]
		.map((part) => part.toString("base64url"))
		.join(".");
}

function decryptConfig(raw: string): PublisherConfig {
	const [ivRaw, tagRaw, bodyRaw] = raw.split(".");
	if (!ivRaw || !tagRaw || !bodyRaw)
		throw new ValidationError("Publisher config is corrupted");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		encryptionKey(),
		Buffer.from(ivRaw, "base64url"),
	);
	decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(bodyRaw, "base64url")),
		decipher.final(),
	]).toString("utf8");
	return JSON.parse(decrypted) as PublisherConfig;
}

async function requestJson(
	url: string,
	init: RequestInit,
): Promise<Record<string, unknown>> {
	const response = await fetch(url, {
		...init,
		signal: AbortSignal.timeout(30_000),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`Publisher request failed (${response.status}): ${text.slice(0, 500)}`,
		);
	}
	return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export async function savePublisherConnection(args: {
	workspaceId: string;
	name: string;
	config: PublisherConfig;
}) {
	const [connection] = await db
		.insert(schema.publisherConnections)
		.values({
			workspaceId: args.workspaceId,
			name: args.name,
			type: args.config.type,
			status: "connected",
			encryptedConfig: encryptConfig(args.config),
		})
		.returning();
	if (!connection) {
		throw new Error("Publisher connection was not created");
	}
	return connection;
}

export async function listPublisherConnections(workspaceId: string) {
	const rows = await db.query.publisherConnections.findMany({
		where: eq(schema.publisherConnections.workspaceId, workspaceId),
		orderBy: [desc(schema.publisherConnections.createdAt)],
	});
	return rows.map(
		({ encryptedConfig: _encryptedConfig, ...connection }) => connection,
	);
}

export async function listPublishedInterventions(workspaceId: string) {
	return db.query.interventions.findMany({
		where: eq(schema.interventions.workspaceId, workspaceId),
		orderBy: [desc(schema.interventions.createdAt)],
	});
}

function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, "");
}

function dedupePromptRows<T extends { id: string }>(rows: T[]): T[] {
	return [...new Map(rows.map((row) => [row.id, row])).values()];
}

async function publishWordPress(
	config: WordPressConfig,
	title: string,
	content: string,
) {
	const auth = Buffer.from(
		`${config.username}:${config.applicationPassword}`,
	).toString("base64");
	const result = await requestJson(
		`${normalizeBaseUrl(config.baseUrl)}/wp-json/wp/v2/posts`,
		{
			method: "POST",
			headers: {
				Authorization: `Basic ${auth}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title, content, status: "publish" }),
		},
	);
	return {
		publishedUrl: String(result.link || ""),
		rollbackData: { postId: result.id },
	};
}

async function publishGeoFlow(
	config: GeoFlowConfig,
	title: string,
	content: string,
	key: string,
) {
	const base = `${normalizeBaseUrl(config.baseUrl)}/api/v1`;
	const headers = {
		Authorization: `Bearer ${config.apiToken}`,
		Accept: "application/json",
		"Content-Type": "application/json",
		"X-Idempotency-Key": key,
	};
	const created = await requestJson(`${base}/articles`, {
		method: "POST",
		headers,
		body: JSON.stringify({ title, content }),
	});
	const data = (created.data as Record<string, unknown> | undefined) ?? created;
	const articleId = String(data.id || "");
	if (!articleId)
		throw new Error("GEOFlow create response did not include an article id");
	await requestJson(`${base}/articles/${articleId}/review`, {
		method: "POST",
		headers: { ...headers, "X-Idempotency-Key": `${key}-review` },
		body: JSON.stringify({
			review_status: "approved",
			review_note: "Approved in Anspectra",
		}),
	});
	const published = await requestJson(`${base}/articles/${articleId}/publish`, {
		method: "POST",
		headers: { ...headers, "X-Idempotency-Key": `${key}-publish` },
	});
	const publishedData =
		(published.data as Record<string, unknown> | undefined) ?? published;
	const slug = String(publishedData.slug || data.slug || "");
	return {
		publishedUrl: slug
			? `${normalizeBaseUrl(config.baseUrl)}/article/${slug}`
			: "",
		rollbackData: { articleId },
	};
}

async function githubRequest(
	config: GitHubConfig,
	path: string,
	init: RequestInit = {},
) {
	return requestJson(`https://api.github.com${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${config.token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

async function publishGitHub(
	config: GitHubConfig,
	title: string,
	content: string,
	assetId: string,
) {
	const ref = await githubRequest(
		config,
		`/repos/${config.owner}/${config.repo}/git/ref/heads/${config.baseBranch}`,
	);
	const object = ref.object as Record<string, unknown> | undefined;
	const sha = String(object?.sha || "");
	if (!sha) throw new Error("GitHub base branch SHA was not returned");
	const branch = `anspectra/geo-${assetId.slice(0, 8)}`;
	await githubRequest(
		config,
		`/repos/${config.owner}/${config.repo}/git/refs`,
		{
			method: "POST",
			body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
		},
	);
	const filePath =
		config.contentPath || `content/geo-${assetId.slice(0, 8)}.md`;
	await githubRequest(
		config,
		`/repos/${config.owner}/${config.repo}/contents/${filePath}`,
		{
			method: "PUT",
			body: JSON.stringify({
				message: `Add GEO content: ${title}`,
				content: Buffer.from(content).toString("base64"),
				branch,
			}),
		},
	);
	const pull = await githubRequest(
		config,
		`/repos/${config.owner}/${config.repo}/pulls`,
		{
			method: "POST",
			body: JSON.stringify({
				title: `GEO: ${title}`,
				head: branch,
				base: config.baseBranch,
			}),
		},
	);
	return {
		publishedUrl: String(pull.html_url || ""),
		rollbackData: { pullNumber: pull.number, branch, filePath },
	};
}

export async function publishApprovedRevision(args: {
	workspaceId: string;
	revisionId: string;
	connectionId: string;
	baselineSeriesId: string;
}) {
	const [revision, connection, baselineSeries] = await Promise.all([
		db.query.contentRevisions.findFirst({
			where: eq(schema.contentRevisions.id, args.revisionId),
		}),
		db.query.publisherConnections.findFirst({
			where: and(
				eq(schema.publisherConnections.id, args.connectionId),
				eq(schema.publisherConnections.workspaceId, args.workspaceId),
			),
		}),
		db.query.collectionSeries.findFirst({
			where: and(
				eq(schema.collectionSeries.id, args.baselineSeriesId),
				eq(schema.collectionSeries.workspaceId, args.workspaceId),
				eq(schema.collectionSeries.purpose, "baseline"),
			),
		}),
	]);
	const asset = revision
		? await db.query.contentAssets.findFirst({
				where: and(
					eq(schema.contentAssets.id, revision.assetId),
					eq(schema.contentAssets.workspaceId, args.workspaceId),
				),
			})
		: null;
	if (!revision || !asset || !connection || !baselineSeries)
		throw new NotFoundError(
			"Approved content, publisher connection, or formal baseline not found",
		);
	if (revision.status !== "approved")
		throw new ValidationError(
			"Content revision must be approved before publishing",
		);

	if (!baselineSeries.promptSetId) {
		throw new ValidationError(
			"The selected baseline has no saved prompt configuration",
		);
	}
	const promptSet = await db.query.promptSets.findFirst({
		where: and(
			eq(schema.promptSets.id, baselineSeries.promptSetId),
			eq(schema.promptSets.workspaceId, args.workspaceId),
			eq(schema.promptSets.purpose, "baseline"),
		),
	});
	if (!promptSet) {
		throw new ValidationError(
			"Smoke and legacy prompt sets cannot be published as a baseline",
		);
	}
	const [
		baselineRuns,
		baselinePrompts,
		opportunity,
		storedPage,
		profile,
		providerProfiles,
	] = await Promise.all([
		db.query.collectionRuns.findMany({
			where: eq(schema.collectionRuns.seriesId, baselineSeries.id),
			orderBy: [asc(schema.collectionRuns.scheduledAt)],
		}),
		db.query.monitorPrompts.findMany({
			where: and(
				eq(schema.monitorPrompts.promptSetId, promptSet.id),
				eq(schema.monitorPrompts.active, true),
			),
		}),
		asset.opportunityId
			? db.query.opportunities.findFirst({
					where: and(
						eq(schema.opportunities.id, asset.opportunityId),
						eq(schema.opportunities.workspaceId, args.workspaceId),
					),
				})
			: null,
		asset.targetUrl
			? db.query.sitePages.findFirst({
					where: and(
						eq(schema.sitePages.workspaceId, args.workspaceId),
						eq(schema.sitePages.url, asset.targetUrl),
					),
				})
			: null,
		db.query.brandProfiles.findFirst({
			where: eq(schema.brandProfiles.workspaceId, args.workspaceId),
		}),
		db.query.providerProfiles.findMany({
			where: eq(schema.providerProfiles.workspaceId, args.workspaceId),
		}),
	]);
	const representativeRun =
		baselineRuns.find((run) =>
			["completed", "partial", "running"].includes(run.status),
		) ?? baselineRuns[0];
	if (!representativeRun) {
		throw new ValidationError("The selected baseline has no collection runs");
	}
	const matchedCohorts = buildMatchedPromptCohorts(
		baselinePrompts,
		opportunity?.promptIds ?? [],
	);
	const treatmentPrompts = matchedCohorts.treatment;
	if (treatmentPrompts.length === 0) {
		throw new ValidationError(
			"No treatment prompts are linked to this optimization",
		);
	}
	const controlPrompts = matchedCohorts.control;
	const frozenPrompts = dedupePromptRows([
		...treatmentPrompts,
		...controlPrompts,
	]);
	const baselineRunIds = baselineRuns.map((run) => run.id);
	const baselineSamples = baselineRunIds.length
		? await db.query.sampleCheckpoints.findMany({
				where: inArray(schema.sampleCheckpoints.runId, baselineRunIds),
			})
		: [];
	const beforeContent =
		revision.sourceContent ??
		(typeof storedPage?.snapshot?.mainText === "string"
			? storedPage.snapshot.mainText
			: "");
	const beforeHash = createHash("sha256").update(beforeContent).digest("hex");
	const beforeSnapshot = {
		capturedAt: new Date().toISOString(),
		targetUrl: asset.targetUrl,
		existed: Boolean(beforeContent || storedPage),
		content: beforeContent,
		page: storedPage
			? {
					url: storedPage.url,
					title: storedPage.title,
					canonicalUrl: storedPage.canonicalUrl,
					httpStatus: storedPage.httpStatus,
					contentHash: storedPage.contentHash,
					snapshot: storedPage.snapshot,
				}
			: null,
	};
	const environmentSnapshot = {
		baselineSeriesId: baselineSeries.id,
		promptSetId: promptSet.id,
		promptSetVersion: promptSet.version,
		packKey: promptSet.packKey,
		templateVersion: promptSet.templateVersion,
		requiredProviders: baselineSeries.requiredProviders,
		providerModes: baselineSeries.providerModes,
		locales: profile?.locales ?? [],
		regions: profile?.regions ?? [],
		providerProfiles: providerProfiles.map((providerProfile) => ({
			id: providerProfile.id,
			provider: providerProfile.provider,
			status: providerProfile.status,
			networkFingerprint: providerProfile.lastNetworkFingerprint,
		})),
		baselineSampleIds: baselineSamples.map((sample) => sample.id),
		conversationIsolation: "fresh",
		sampleSource: "official_web",
	};
	const config = decryptConfig(connection.encryptedConfig);
	const content = revision.html || revision.markdown;
	const result =
		config.type === "wordpress"
			? await publishWordPress(config, asset.title, content)
			: config.type === "geoflow"
				? await publishGeoFlow(
						config,
						asset.title,
						revision.markdown,
						`anspectra-${revision.id}`,
					)
				: await publishGitHub(config, asset.title, revision.markdown, asset.id);
	const now = new Date();
	const afterHash = createHash("sha256")
		.update(revision.markdown)
		.digest("hex");
	const publication = await db.transaction(async (tx) => {
		const [intervention] = await tx
			.insert(schema.interventions)
			.values({
				workspaceId: args.workspaceId,
				assetId: asset.id,
				revisionId: revision.id,
				publisherConnectionId: connection.id,
				status: "published",
				publishedUrl: result.publishedUrl,
				baselineSeriesId: baselineSeries.id,
				beforeHash,
				afterHash,
				beforeSnapshot,
				environmentSnapshot,
				rollbackData: { type: config.type, ...result.rollbackData },
				publishedAt: now,
			})
			.returning();
		if (!intervention) throw new Error("Failed to create intervention");
		await tx
			.update(schema.contentAssets)
			.set({
				status: "published",
				targetUrl: result.publishedUrl,
				updatedAt: now,
			})
			.where(eq(schema.contentAssets.id, asset.id));
		const [experiment] = await tx
			.insert(schema.retestExperiments)
			.values({
				workspaceId: args.workspaceId,
				interventionId: intervention.id,
				status: "scheduled",
				baselineRunId: representativeRun.id,
				baselineSeriesId: baselineSeries.id,
				treatmentPromptIds: treatmentPrompts.map((prompt) => prompt.id),
				controlPromptIds: controlPrompts.map((prompt) => prompt.id),
				promptHashes: frozenPrompts.flatMap((prompt) =>
					prompt.promptHash ? [prompt.promptHash] : [],
				),
				environmentSnapshot,
				nextRunAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
			})
			.returning();
		if (!experiment) throw new Error("Failed to create retest experiment");
		await tx.insert(schema.experimentObservations).values(
			[7, 14, 30].map((observationDay) => ({
				experimentId: experiment.id,
				observationDay,
				status: "scheduled",
				confidence: "low",
				metrics: {
					baselineSeriesId: baselineSeries.id,
					treatmentPromptCount: treatmentPrompts.length,
					controlPromptCount: controlPrompts.length,
				},
			})),
		);
		return { intervention, experiment };
	});
	let pageAudit: { status: "completed" | "failed"; message?: string } = {
		status: "completed",
	};
	if (config.type !== "github" && result.publishedUrl) {
		try {
			await auditWorkspaceSite({
				workspaceId: args.workspaceId,
				domain: result.publishedUrl,
				seedUrl: result.publishedUrl,
				maxPages: 1,
			});
		} catch (error) {
			pageAudit = {
				status: "failed",
				message: error instanceof Error ? error.message : "Page audit failed",
			};
		}
	}
	return { ...publication, pageAudit };
}

export async function createRetestExperiment(args: {
	workspaceId: string;
	interventionId: string;
}) {
	const existing = await db.query.retestExperiments.findFirst({
		where: and(
			eq(schema.retestExperiments.workspaceId, args.workspaceId),
			eq(schema.retestExperiments.interventionId, args.interventionId),
		),
	});
	if (existing) return existing;
	const intervention = await db.query.interventions.findFirst({
		where: and(
			eq(schema.interventions.id, args.interventionId),
			eq(schema.interventions.workspaceId, args.workspaceId),
		),
	});
	if (!intervention?.baselineSeriesId) {
		throw new ValidationError(
			"The intervention has no versioned baseline series",
		);
	}
	const series = await db.query.collectionSeries.findFirst({
		where: and(
			eq(schema.collectionSeries.id, intervention.baselineSeriesId),
			eq(schema.collectionSeries.purpose, "baseline"),
		),
	});
	if (!series?.promptSetId) {
		throw new ValidationError(
			"The baseline prompt configuration is unavailable",
		);
	}
	const [runs, prompts, asset] = await Promise.all([
		db.query.collectionRuns.findMany({
			where: eq(schema.collectionRuns.seriesId, series.id),
			orderBy: [asc(schema.collectionRuns.scheduledAt)],
		}),
		db.query.monitorPrompts.findMany({
			where: eq(schema.monitorPrompts.promptSetId, series.promptSetId),
		}),
		intervention.assetId
			? db.query.contentAssets.findFirst({
					where: eq(schema.contentAssets.id, intervention.assetId),
				})
			: null,
	]);
	const opportunity = asset?.opportunityId
		? await db.query.opportunities.findFirst({
				where: eq(schema.opportunities.id, asset.opportunityId),
			})
		: null;
	const matchedCohorts = buildMatchedPromptCohorts(
		prompts,
		opportunity?.promptIds ?? [],
	);
	const treatment = matchedCohorts.treatment;
	const controls = matchedCohorts.control;
	const baselineRun = runs[0];
	if (!baselineRun || treatment.length === 0) {
		throw new ValidationError("No matched treatment prompts are available");
	}
	const now = new Date();
	return db.transaction(async (tx) => {
		const [experiment] = await tx
			.insert(schema.retestExperiments)
			.values({
				workspaceId: args.workspaceId,
				interventionId: intervention.id,
				status: "scheduled",
				baselineRunId: baselineRun.id,
				baselineSeriesId: series.id,
				treatmentPromptIds: treatment.map((prompt) => prompt.id),
				controlPromptIds: controls.map((prompt) => prompt.id),
				promptHashes: dedupePromptRows([...treatment, ...controls]).flatMap(
					(prompt) => (prompt.promptHash ? [prompt.promptHash] : []),
				),
				environmentSnapshot: intervention.environmentSnapshot,
				nextRunAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
			})
			.returning();
		if (!experiment) throw new Error("Failed to create retest experiment");
		await tx.insert(schema.experimentObservations).values(
			[7, 14, 30].map((observationDay) => ({
				experimentId: experiment.id,
				observationDay,
				status: "scheduled",
				confidence: "low",
				metrics: { baselineSeriesId: series.id },
			})),
		);
		return experiment;
	});
}

export async function rollbackPublishedIntervention(args: {
	workspaceId: string;
	interventionId: string;
}) {
	const intervention = await db.query.interventions.findFirst({
		where: and(
			eq(schema.interventions.id, args.interventionId),
			eq(schema.interventions.workspaceId, args.workspaceId),
		),
	});
	if (!intervention?.publisherConnectionId) {
		throw new NotFoundError("Published intervention not found");
	}
	if (intervention.status !== "published") {
		throw new ValidationError(
			"Only published interventions can be rolled back",
		);
	}
	const connection = await db.query.publisherConnections.findFirst({
		where: and(
			eq(schema.publisherConnections.id, intervention.publisherConnectionId),
			eq(schema.publisherConnections.workspaceId, args.workspaceId),
		),
	});
	if (!connection) throw new NotFoundError("Publisher connection not found");
	const config = decryptConfig(connection.encryptedConfig);
	const rollbackData = intervention.rollbackData ?? {};
	if (config.type === "wordpress") {
		const postId = String(rollbackData.postId || "");
		if (!postId)
			throw new ValidationError("WordPress rollback data is missing");
		const auth = Buffer.from(
			`${config.username}:${config.applicationPassword}`,
		).toString("base64");
		await requestJson(
			`${normalizeBaseUrl(config.baseUrl)}/wp-json/wp/v2/posts/${postId}?force=true`,
			{ method: "DELETE", headers: { Authorization: `Basic ${auth}` } },
		);
	} else if (config.type === "geoflow") {
		const articleId = String(rollbackData.articleId || "");
		if (!articleId)
			throw new ValidationError("GEOFlow rollback data is missing");
		await requestJson(
			`${normalizeBaseUrl(config.baseUrl)}/api/v1/articles/${articleId}`,
			{
				method: "DELETE",
				headers: { Authorization: `Bearer ${config.apiToken}` },
			},
		);
	} else {
		const pullNumber = String(rollbackData.pullNumber || "");
		const branch = String(rollbackData.branch || "");
		if (!pullNumber || !branch)
			throw new ValidationError("GitHub rollback data is missing");
		await githubRequest(
			config,
			`/repos/${config.owner}/${config.repo}/pulls/${pullNumber}`,
			{
				method: "PATCH",
				body: JSON.stringify({ state: "closed" }),
			},
		);
		await githubRequest(
			config,
			`/repos/${config.owner}/${config.repo}/git/refs/heads/${encodeURIComponent(branch)}`,
			{ method: "DELETE" },
		);
	}
	await db.transaction(async (tx) => {
		await tx
			.update(schema.interventions)
			.set({ status: "rolled_back", updatedAt: new Date() })
			.where(eq(schema.interventions.id, intervention.id));
		await tx
			.update(schema.retestExperiments)
			.set({ status: "cancelled", updatedAt: new Date() })
			.where(eq(schema.retestExperiments.interventionId, intervention.id));
		if (intervention.assetId) {
			await tx
				.update(schema.contentAssets)
				.set({ status: "approved", updatedAt: new Date() })
				.where(eq(schema.contentAssets.id, intervention.assetId));
		}
	});
	return { rolledBack: true };
}
