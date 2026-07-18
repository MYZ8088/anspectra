import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { workspaces } from "./workspace.js";

const timestamps = {
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
};

export const brandProfiles = pgTable(
	"brand_profiles",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		brandName: text("brand_name").notNull(),
		officialDomain: text("official_domain").notNull(),
		aliases: jsonb("aliases").$type<string[]>().default([]),
		products: jsonb("products").$type<string[]>().default([]),
		category: text("category"),
		industry: text("industry"),
		market: text("market"),
		audiences: jsonb("audiences").$type<string[]>().default([]),
		competitors: jsonb("competitors").$type<string[]>().default([]),
		regions: jsonb("regions").$type<string[]>().default([]),
		locales: jsonb("locales").$type<string[]>().default(["zh-CN"]),
		budget: text("budget"),
		teamSize: text("team_size"),
		implementationPeriod: text("implementation_period"),
		evidenceRequirement: text("evidence_requirement"),
		version: integer("version").notNull().default(1),
		confirmationStatus: varchar("confirmation_status", { length: 24 })
			.notNull()
			.default("draft"),
		confirmedAt: timestamp("confirmed_at"),
		...timestamps,
	},
	(table) => ({
		uniqueWorkspace: uniqueIndex("brand_profiles_workspace_unique").on(
			table.workspaceId,
		),
	}),
);

export const collectorNodes = pgTable(
	"collector_nodes",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 160 }).notNull(),
		platform: varchar("platform", { length: 32 }).notNull(),
		status: varchar("status", { length: 32 }).notNull().default("offline"),
		deviceTokenHash: text("device_token_hash"),
		lastHeartbeatAt: timestamp("last_heartbeat_at"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("collector_nodes_workspace_idx").on(table.workspaceId),
	}),
);

export const providerProfiles = pgTable(
	"provider_profiles",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		collectorNodeId: uuid("collector_node_id")
			.notNull()
			.references(() => collectorNodes.id, { onDelete: "cascade" }),
		provider: varchar("provider", { length: 32 }).notNull(),
		profileKey: varchar("profile_key", { length: 256 }).notNull(),
		status: varchar("status", { length: 32 }).notNull().default("disconnected"),
		lastSessionCheckAt: timestamp("last_session_check_at"),
		lastNetworkFingerprint: text("last_network_fingerprint"),
		...timestamps,
	},
	(table) => ({
		uniqueCollectorProvider: uniqueIndex(
			"provider_profiles_collector_provider_unique",
		).on(table.collectorNodeId, table.provider),
		workspaceIdx: index("provider_profiles_workspace_idx").on(
			table.workspaceId,
		),
	}),
);

export const collectorCommands = pgTable(
	"collector_commands",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		collectorNodeId: uuid("collector_node_id")
			.notNull()
			.references(() => collectorNodes.id, { onDelete: "cascade" }),
		provider: varchar("provider", { length: 32 }),
		type: varchar("type", { length: 40 }).notNull(),
		status: varchar("status", { length: 24 }).notNull().default("queued"),
		payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
		expiresAt: timestamp("expires_at").notNull(),
		deliveredAt: timestamp("delivered_at"),
		...timestamps,
	},
	(table) => ({
		collectorIdx: index("collector_commands_collector_idx").on(
			table.collectorNodeId,
		),
	}),
);

export const promptTemplates = pgTable(
	"prompt_templates",
	{
		id: varchar("id", { length: 200 }).primaryKey(),
		packKey: varchar("pack_key", { length: 120 }).notNull(),
		version: varchar("version", { length: 40 }).notNull(),
		sourceCommit: varchar("source_commit", { length: 64 }),
		license: varchar("license", { length: 32 }).notNull().default("MIT"),
		locale: varchar("locale", { length: 16 }).notNull(),
		intent: varchar("intent", { length: 32 }).notNull(),
		decisionStage: varchar("decision_stage", { length: 32 }).notNull(),
		brandExposure: varchar("brand_exposure", { length: 16 }).notNull(),
		promptTemplate: text("prompt_template").notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
		active: boolean("active").notNull().default(true),
		...timestamps,
	},
	(table) => ({
		packIdx: index("prompt_templates_pack_idx").on(
			table.packKey,
			table.version,
			table.locale,
		),
	}),
);

export const workspacePrompts = pgTable(
	"workspace_prompts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		templateId: varchar("template_id", { length: 200 }).references(
			() => promptTemplates.id,
			{ onDelete: "set null" },
		),
		origin: varchar("origin", { length: 32 }).notNull(),
		prompt: text("prompt").notNull(),
		promptHash: varchar("prompt_hash", { length: 64 }).notNull(),
		locale: varchar("locale", { length: 16 }).notNull().default("zh-CN"),
		intent: varchar("intent", { length: 32 }).notNull(),
		decisionStage: varchar("decision_stage", { length: 32 }).notNull(),
		brandExposure: varchar("brand_exposure", { length: 16 }).notNull(),
		dimensions: jsonb("dimensions")
			.$type<Record<string, unknown>>()
			.default({}),
		rewrites: jsonb("rewrites").$type<Record<string, string>>().default({}),
		tags: jsonb("tags").$type<string[]>().default([]),
		version: integer("version").notNull().default(1),
		parentPromptId: uuid("parent_prompt_id"),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		importSource: varchar("import_source", { length: 40 }),
		legacySourceId: text("legacy_source_id"),
		profileVersion: integer("profile_version"),
		relevance: jsonb("relevance").$type<Record<string, unknown>>().default({}),
		archivedAt: timestamp("archived_at"),
		archivedReason: text("archived_reason"),
		locked: boolean("locked").notNull().default(false),
		active: boolean("active").notNull().default(true),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("workspace_prompts_workspace_idx").on(
			table.workspaceId,
		),
		uniqueOriginHash: uniqueIndex("workspace_prompts_origin_hash_unique").on(
			table.workspaceId,
			table.origin,
			table.promptHash,
		),
	}),
);

export const promptSets = pgTable(
	"prompt_sets",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 200 }).notNull(),
		tier: varchar("tier", { length: 24 }).notNull(),
		version: integer("version").notNull().default(1),
		status: varchar("status", { length: 24 }).notNull().default("draft"),
		purpose: varchar("purpose", { length: 24 }).notNull().default("baseline"),
		packKey: varchar("pack_key", { length: 120 }),
		templateVersion: varchar("template_version", { length: 40 }),
		manifest: jsonb("manifest").$type<Record<string, unknown>>().default({}),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("prompt_sets_workspace_idx").on(table.workspaceId),
	}),
);

export const promptSetItems = pgTable(
	"prompt_set_items",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		promptSetId: uuid("prompt_set_id")
			.notNull()
			.references(() => promptSets.id, { onDelete: "cascade" }),
		workspacePromptId: uuid("workspace_prompt_id")
			.notNull()
			.references(() => workspacePrompts.id, { onDelete: "cascade" }),
		position: integer("position").notNull().default(0),
		enabled: boolean("enabled").notNull().default(true),
		role: varchar("role", { length: 24 }).notNull().default("measurement"),
		...timestamps,
	},
	(table) => ({
		setIdx: index("prompt_set_items_set_idx").on(table.promptSetId),
		uniqueSetPrompt: uniqueIndex("prompt_set_items_set_prompt_unique").on(
			table.promptSetId,
			table.workspacePromptId,
		),
	}),
);

export const monitorPrompts = pgTable(
	"monitor_prompts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		promptSetId: uuid("prompt_set_id")
			.notNull()
			.references(() => promptSets.id, { onDelete: "cascade" }),
		prompt: text("prompt").notNull(),
		workspacePromptId: uuid("workspace_prompt_id").references(
			() => workspacePrompts.id,
			{ onDelete: "set null" },
		),
		promptGroup: varchar("prompt_group", { length: 32 }).notNull(),
		locale: varchar("locale", { length: 16 }).notNull().default("zh-CN"),
		persona: varchar("persona", { length: 120 }),
		decisionStage: varchar("decision_stage", { length: 32 }),
		cohort: varchar("cohort", { length: 16 }).notNull().default("treatment"),
		origin: varchar("origin", { length: 32 }).notNull().default("user_custom"),
		templateKey: varchar("template_key", { length: 200 }),
		templateVersion: varchar("template_version", { length: 40 }),
		promptHash: varchar("prompt_hash", { length: 64 }),
		brandExposure: varchar("brand_exposure", { length: 16 }),
		dimensions: jsonb("dimensions")
			.$type<Record<string, unknown>>()
			.default({}),
		rewrites: jsonb("rewrites").$type<Record<string, string>>().default({}),
		version: integer("version").notNull().default(1),
		active: boolean("active").notNull().default(true),
		...timestamps,
	},
	(table) => ({
		setIdx: index("monitor_prompts_set_idx").on(table.promptSetId),
		workspaceIdx: index("monitor_prompts_workspace_idx").on(table.workspaceId),
	}),
);

export const collectionSeries = pgTable(
	"collection_series",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		promptSetId: uuid("prompt_set_id").references(() => promptSets.id, {
			onDelete: "set null",
		}),
		purpose: varchar("purpose", { length: 24 }).notNull().default("baseline"),
		status: varchar("status", { length: 32 }).notNull().default("queued"),
		tier: varchar("tier", { length: 24 }).notNull(),
		requiredProviders: jsonb("required_providers")
			.$type<string[]>()
			.default([]),
		providerModes: jsonb("provider_modes")
			.$type<Record<string, string[]>>()
			.default({}),
		roundCount: integer("round_count").notNull().default(1),
		plannedSamples: integer("planned_samples").notNull().default(0),
		completedSamples: integer("completed_samples").notNull().default(0),
		failedSamples: integer("failed_samples").notNull().default(0),
		waitingSamples: integer("waiting_samples").notNull().default(0),
		manifest: jsonb("manifest").$type<Record<string, unknown>>().default({}),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("collection_series_workspace_idx").on(
			table.workspaceId,
		),
	}),
);

export const collectionRuns = pgTable(
	"collection_runs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		promptSetId: uuid("prompt_set_id").references(() => promptSets.id, {
			onDelete: "set null",
		}),
		seriesId: uuid("series_id").references(() => collectionSeries.id, {
			onDelete: "set null",
		}),
		collectorNodeId: uuid("collector_node_id").references(
			() => collectorNodes.id,
			{
				onDelete: "set null",
			},
		),
		status: varchar("status", { length: 32 }).notNull().default("queued"),
		tier: varchar("tier", { length: 24 }).notNull(),
		totalSamples: integer("total_samples").notNull().default(0),
		completedSamples: integer("completed_samples").notNull().default(0),
		failedSamples: integer("failed_samples").notNull().default(0),
		roundIndex: integer("round_index").notNull().default(1),
		scheduledAt: timestamp("scheduled_at"),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("collection_runs_workspace_idx").on(table.workspaceId),
	}),
);

export const detectionSchedules = pgTable(
	"detection_schedules",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		promptSetId: uuid("prompt_set_id")
			.notNull()
			.references(() => promptSets.id, { onDelete: "cascade" }),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		providers: jsonb("providers").$type<string[]>().default([]),
		providerModes: jsonb("provider_modes")
			.$type<Record<string, string>>()
			.default({}),
		cadence: varchar("cadence", { length: 16 }).notNull(),
		timezone: varchar("timezone", { length: 80 }).notNull().default("UTC"),
		localTime: varchar("local_time", { length: 5 }).notNull().default("09:00"),
		dayOfWeek: integer("day_of_week"),
		dayOfMonth: integer("day_of_month"),
		enabled: boolean("enabled").notNull().default(true),
		nextRunAt: timestamp("next_run_at"),
		lastRunAt: timestamp("last_run_at"),
		lastSeriesId: uuid("last_series_id").references(() => collectionSeries.id, {
			onDelete: "set null",
		}),
		lastError: text("last_error"),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("detection_schedules_workspace_idx").on(
			table.workspaceId,
		),
		dueIdx: index("detection_schedules_due_idx").on(
			table.enabled,
			table.nextRunAt,
		),
		uniqueWorkspaceSet: uniqueIndex(
			"detection_schedules_workspace_prompt_set_unique",
		).on(table.workspaceId, table.promptSetId),
	}),
);

export const sampleCheckpoints = pgTable(
	"sample_checkpoints",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		runId: uuid("run_id")
			.notNull()
			.references(() => collectionRuns.id, { onDelete: "cascade" }),
		promptId: uuid("prompt_id").references(() => monitorPrompts.id, {
			onDelete: "set null",
		}),
		workspacePromptId: uuid("workspace_prompt_id").references(
			() => workspacePrompts.id,
			{ onDelete: "set null" },
		),
		provider: varchar("provider", { length: 32 }).notNull(),
		repeatIndex: integer("repeat_index").notNull().default(0),
		status: varchar("status", { length: 32 }).notNull().default("queued"),
		phase: varchar("phase", { length: 32 }).notNull().default("queued"),
		requestedMode: varchar("requested_mode", { length: 32 })
			.notNull()
			.default("default"),
		actualMode: varchar("actual_mode", { length: 32 }),
		analysisStatus: varchar("analysis_status", { length: 24 })
			.notNull()
			.default("pending"),
		analysisErrorCode: varchar("analysis_error_code", { length: 64 }),
		analysisErrorMessage: text("analysis_error_message"),
		attemptCount: integer("attempt_count").notNull().default(0),
		failureCategory: varchar("failure_category", { length: 40 }),
		retryable: boolean("retryable"),
		warningCode: varchar("warning_code", { length: 64 }),
		conversationId: text("conversation_id"),
		conversationUrl: text("conversation_url"),
		sourceExposure: varchar("source_exposure", { length: 24 }),
		analyticsSampleId: text("analytics_sample_id"),
		errorCode: varchar("error_code", { length: 64 }),
		errorMessage: text("error_message"),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		lastEventAt: timestamp("last_event_at"),
		...timestamps,
	},
	(table) => ({
		runIdx: index("sample_checkpoints_run_idx").on(table.runId),
		uniqueSample: uniqueIndex(
			"sample_checkpoints_run_prompt_provider_repeat_unique",
		).on(table.runId, table.promptId, table.provider, table.repeatIndex),
	}),
);

export const sampleAttempts = pgTable(
	"sample_attempts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		checkpointId: uuid("checkpoint_id")
			.notNull()
			.references(() => sampleCheckpoints.id, { onDelete: "cascade" }),
		attemptIndex: integer("attempt_index").notNull(),
		status: varchar("status", { length: 24 }).notNull(),
		phase: varchar("phase", { length: 32 }).notNull(),
		failureCategory: varchar("failure_category", { length: 40 }),
		failureCode: varchar("failure_code", { length: 64 }),
		failureMessage: text("failure_message"),
		retryable: boolean("retryable"),
		pageUrl: text("page_url"),
		conversationId: text("conversation_id"),
		diagnostics: jsonb("diagnostics")
			.$type<Record<string, unknown>>()
			.default({}),
		startedAt: timestamp("started_at").defaultNow().notNull(),
		completedAt: timestamp("completed_at"),
		...timestamps,
	},
	(table) => ({
		checkpointIdx: index("sample_attempts_checkpoint_idx").on(
			table.checkpointId,
		),
		uniqueAttempt: uniqueIndex("sample_attempts_checkpoint_attempt_unique").on(
			table.checkpointId,
			table.attemptIndex,
		),
	}),
);

export const humanChallenges = pgTable(
	"human_challenges",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		runId: uuid("run_id")
			.notNull()
			.references(() => collectionRuns.id, { onDelete: "cascade" }),
		checkpointId: uuid("checkpoint_id").references(() => sampleCheckpoints.id, {
			onDelete: "set null",
		}),
		provider: varchar("provider", { length: 32 }).notNull(),
		kind: varchar("kind", { length: 32 }).notNull(),
		status: varchar("status", { length: 24 }).notNull().default("open"),
		pageUrl: text("page_url").notNull(),
		message: text("message").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		resolvedAt: timestamp("resolved_at"),
		...timestamps,
	},
	(table) => ({ runIdx: index("human_challenges_run_idx").on(table.runId) }),
);

export const sitePages = pgTable(
	"site_pages",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		pageType: varchar("page_type", { length: 32 }).notNull().default("page"),
		title: text("title"),
		canonicalUrl: text("canonical_url"),
		contentHash: varchar("content_hash", { length: 64 }),
		httpStatus: integer("http_status"),
		snapshot: jsonb("snapshot").$type<Record<string, unknown>>().default({}),
		lastCrawledAt: timestamp("last_crawled_at"),
		...timestamps,
	},
	(table) => ({
		uniqueWorkspaceUrl: uniqueIndex("site_pages_workspace_url_unique").on(
			table.workspaceId,
			table.url,
		),
	}),
);

export const pageSnapshots = pgTable(
	"page_snapshots",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		pageId: uuid("page_id")
			.notNull()
			.references(() => sitePages.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		trigger: varchar("trigger", { length: 32 }).notNull().default("audit"),
		contentHash: varchar("content_hash", { length: 64 }),
		httpStatus: integer("http_status"),
		snapshot: jsonb("snapshot").$type<Record<string, unknown>>().default({}),
		capturedAt: timestamp("captured_at").defaultNow().notNull(),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("page_snapshots_workspace_idx").on(
			table.workspaceId,
			table.capturedAt,
		),
		pageIdx: index("page_snapshots_page_idx").on(
			table.pageId,
			table.capturedAt,
		),
	}),
);

export const brandFacts = pgTable(
	"brand_facts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		subject: text("subject").notNull(),
		predicate: text("predicate").notNull(),
		value: text("value").notNull(),
		sourceUrl: text("source_url"),
		sourceType: varchar("source_type", { length: 32 }),
		evidenceGrade: varchar("evidence_grade", { length: 4 }),
		retrievedAt: timestamp("retrieved_at"),
		region: varchar("region", { length: 64 }),
		validUntil: timestamp("valid_until"),
		supportedClaims: jsonb("supported_claims").$type<string[]>().default([]),
		confidence: integer("confidence").notNull().default(50),
		status: varchar("status", { length: 24 }).notNull().default("unverified"),
		verifiedAt: timestamp("verified_at"),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("brand_facts_workspace_idx").on(table.workspaceId),
	}),
);

export const opportunities = pgTable(
	"geo_opportunities",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		type: varchar("type", { length: 40 }).notNull(),
		priority: varchar("priority", { length: 8 }).notNull().default("P1"),
		status: varchar("status", { length: 24 }).notNull().default("open"),
		title: text("title").notNull(),
		description: text("description").notNull(),
		targetPageId: uuid("target_page_id").references(() => sitePages.id, {
			onDelete: "set null",
		}),
		evidenceSampleIds: jsonb("evidence_sample_ids")
			.$type<string[]>()
			.default([]),
		acceptanceMetric: text("acceptance_metric"),
		baselineSeriesId: uuid("baseline_series_id").references(
			() => collectionSeries.id,
			{ onDelete: "set null" },
		),
		promptIds: jsonb("prompt_ids").$type<string[]>().default([]),
		reason: text("reason"),
		effort: varchar("effort", { length: 16 }),
		owner: text("owner"),
		confidence: integer("confidence").notNull().default(50),
		retestScope: jsonb("retest_scope")
			.$type<Record<string, unknown>>()
			.default({}),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("geo_opportunities_workspace_idx").on(
			table.workspaceId,
		),
	}),
);

export const externalEvidenceTasks = pgTable(
	"external_evidence_tasks",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
			onDelete: "set null",
		}),
		channel: varchar("channel", { length: 32 }).notNull(),
		title: text("title").notNull(),
		description: text("description").notNull(),
		targetPublisher: text("target_publisher"),
		owner: text("owner"),
		status: varchar("status", { length: 24 }).notNull().default("open"),
		acceptanceMetric: text("acceptance_metric"),
		dueAt: timestamp("due_at"),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("external_evidence_tasks_workspace_idx").on(
			table.workspaceId,
		),
	}),
);

export const contentAssets = pgTable(
	"content_assets",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
			onDelete: "set null",
		}),
		kind: varchar("kind", { length: 40 }).notNull(),
		title: text("title").notNull(),
		targetUrl: text("target_url"),
		status: varchar("status", { length: 24 }).notNull().default("draft"),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("content_assets_workspace_idx").on(table.workspaceId),
	}),
);

export const contentRevisions = pgTable(
	"content_revisions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		assetId: uuid("asset_id")
			.notNull()
			.references(() => contentAssets.id, { onDelete: "cascade" }),
		version: integer("version").notNull(),
		status: varchar("status", { length: 24 }).notNull().default("draft"),
		sourceContent: text("source_content"),
		markdown: text("markdown").notNull(),
		html: text("html"),
		jsonLd: jsonb("json_ld").$type<Record<string, unknown> | null>(),
		factIds: jsonb("fact_ids").$type<string[]>().default([]),
		atomicFacts: jsonb("atomic_facts")
			.$type<Array<{ fact: string; sourceUrl?: string; status: string }>>()
			.default([]),
		evidenceGaps: jsonb("evidence_gaps").$type<string[]>().default([]),
		faq: jsonb("faq")
			.$type<Array<{ question: string; answer: string }>>()
			.default([]),
		directAnswer: text("direct_answer"),
		structuredSummary: text("structured_summary"),
		claimMap: jsonb("claim_map")
			.$type<Array<Record<string, unknown>>>()
			.default([]),
		qualityReport: jsonb("quality_report")
			.$type<Record<string, unknown>>()
			.default({}),
		model: varchar("model", { length: 120 }),
		templateVersion: varchar("template_version", { length: 40 }),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		...timestamps,
	},
	(table) => ({
		uniqueAssetVersion: uniqueIndex(
			"content_revisions_asset_version_unique",
		).on(table.assetId, table.version),
	}),
);

export const publisherConnections = pgTable(
	"publisher_connections",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		type: varchar("type", { length: 24 }).notNull(),
		name: varchar("name", { length: 160 }).notNull(),
		status: varchar("status", { length: 24 }).notNull().default("disconnected"),
		encryptedConfig: text("encrypted_config").notNull(),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("publisher_connections_workspace_idx").on(
			table.workspaceId,
		),
	}),
);

export const analysisModelConfigs = pgTable(
	"analysis_model_configs",
	{
		workspaceId: text("workspace_id")
			.primaryKey()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		baseUrl: text("base_url").notNull(),
		model: varchar("model", { length: 200 }).notNull(),
		encryptedApiKey: text("encrypted_api_key").notNull(),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("analysis_model_configs_workspace_idx").on(
			table.workspaceId,
		),
	}),
);

export const interventions = pgTable(
	"geo_interventions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		assetId: uuid("asset_id").references(() => contentAssets.id, {
			onDelete: "set null",
		}),
		revisionId: uuid("revision_id").references(() => contentRevisions.id, {
			onDelete: "set null",
		}),
		publisherConnectionId: uuid("publisher_connection_id").references(
			() => publisherConnections.id,
			{ onDelete: "set null" },
		),
		status: varchar("status", { length: 24 }).notNull().default("approved"),
		publishedUrl: text("published_url"),
		baselineSeriesId: uuid("baseline_series_id").references(
			() => collectionSeries.id,
			{ onDelete: "set null" },
		),
		beforeHash: varchar("before_hash", { length: 64 }),
		afterHash: varchar("after_hash", { length: 64 }),
		beforeSnapshot: jsonb("before_snapshot")
			.$type<Record<string, unknown>>()
			.default({}),
		environmentSnapshot: jsonb("environment_snapshot")
			.$type<Record<string, unknown>>()
			.default({}),
		rollbackData: jsonb("rollback_data")
			.$type<Record<string, unknown>>()
			.default({}),
		publishedAt: timestamp("published_at"),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("geo_interventions_workspace_idx").on(
			table.workspaceId,
		),
	}),
);

export const retestExperiments = pgTable(
	"retest_experiments",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		interventionId: uuid("intervention_id")
			.notNull()
			.references(() => interventions.id, { onDelete: "cascade" }),
		status: varchar("status", { length: 24 }).notNull().default("scheduled"),
		baselineRunId: uuid("baseline_run_id").references(() => collectionRuns.id, {
			onDelete: "set null",
		}),
		baselineSeriesId: uuid("baseline_series_id").references(
			() => collectionSeries.id,
			{ onDelete: "set null" },
		),
		treatmentPromptIds: jsonb("treatment_prompt_ids")
			.$type<string[]>()
			.default([]),
		controlPromptIds: jsonb("control_prompt_ids").$type<string[]>().default([]),
		promptHashes: jsonb("prompt_hashes").$type<string[]>().default([]),
		environmentSnapshot: jsonb("environment_snapshot")
			.$type<Record<string, unknown>>()
			.default({}),
		observationDays: jsonb("observation_days")
			.$type<number[]>()
			.default([7, 14, 30]),
		completedObservationDays: jsonb("completed_observation_days")
			.$type<number[]>()
			.default([]),
		currentObservationDay: integer("current_observation_day"),
		latestRunId: uuid("latest_run_id").references(() => collectionRuns.id, {
			onDelete: "set null",
		}),
		nextRunAt: timestamp("next_run_at"),
		...timestamps,
	},
	(table) => ({
		workspaceIdx: index("retest_experiments_workspace_idx").on(
			table.workspaceId,
		),
	}),
);

export const experimentObservations = pgTable(
	"experiment_observations",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		experimentId: uuid("experiment_id")
			.notNull()
			.references(() => retestExperiments.id, { onDelete: "cascade" }),
		runId: uuid("run_id").references(() => collectionRuns.id, {
			onDelete: "set null",
		}),
		observationDay: integer("observation_day").notNull(),
		status: varchar("status", { length: 24 }).notNull().default("scheduled"),
		metrics: jsonb("metrics").$type<Record<string, unknown>>().default({}),
		confidence: varchar("confidence", { length: 16 }).notNull().default("low"),
		externalEvents: jsonb("external_events")
			.$type<Array<Record<string, unknown>>>()
			.default([]),
		...timestamps,
	},
	(table) => ({
		experimentIdx: index("experiment_observations_experiment_idx").on(
			table.experimentId,
		),
		uniqueObservation: uniqueIndex(
			"experiment_observations_experiment_day_unique",
		).on(table.experimentId, table.observationDay),
	}),
);
