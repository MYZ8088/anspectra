CREATE TABLE IF NOT EXISTS "prompt_templates" (
  "id" varchar(200) PRIMARY KEY,
  "pack_key" varchar(120) NOT NULL,
  "version" varchar(40) NOT NULL,
  "source_commit" varchar(64),
  "license" varchar(32) NOT NULL DEFAULT 'MIT',
  "locale" varchar(16) NOT NULL,
  "intent" varchar(32) NOT NULL,
  "decision_stage" varchar(32) NOT NULL,
  "brand_exposure" varchar(16) NOT NULL,
  "prompt_template" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "prompt_templates_pack_idx" ON "prompt_templates" ("pack_key", "version", "locale");

CREATE TABLE IF NOT EXISTS "workspace_prompts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "template_id" varchar(200) REFERENCES "prompt_templates"("id") ON DELETE SET NULL,
  "origin" varchar(32) NOT NULL,
  "prompt" text NOT NULL,
  "prompt_hash" varchar(64) NOT NULL,
  "locale" varchar(16) NOT NULL DEFAULT 'zh-CN',
  "intent" varchar(32) NOT NULL,
  "decision_stage" varchar(32) NOT NULL,
  "brand_exposure" varchar(16) NOT NULL,
  "dimensions" jsonb DEFAULT '{}'::jsonb,
  "rewrites" jsonb DEFAULT '{}'::jsonb,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "parent_prompt_id" uuid,
  "locked" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "workspace_prompts_workspace_idx" ON "workspace_prompts" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_prompts_origin_hash_unique" ON "workspace_prompts" ("workspace_id", "origin", "prompt_hash");

ALTER TABLE "prompt_sets" ADD COLUMN IF NOT EXISTS "purpose" varchar(24) NOT NULL DEFAULT 'baseline';
ALTER TABLE "prompt_sets" ADD COLUMN IF NOT EXISTS "pack_key" varchar(120);
ALTER TABLE "prompt_sets" ADD COLUMN IF NOT EXISTS "template_version" varchar(40);
ALTER TABLE "prompt_sets" ADD COLUMN IF NOT EXISTS "manifest" jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "prompt_set_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "prompt_set_id" uuid NOT NULL REFERENCES "prompt_sets"("id") ON DELETE CASCADE,
  "workspace_prompt_id" uuid NOT NULL REFERENCES "workspace_prompts"("id") ON DELETE CASCADE,
  "position" integer NOT NULL DEFAULT 0,
  "enabled" boolean NOT NULL DEFAULT true,
  "role" varchar(24) NOT NULL DEFAULT 'measurement',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "prompt_set_items_set_idx" ON "prompt_set_items" ("prompt_set_id");
CREATE UNIQUE INDEX IF NOT EXISTS "prompt_set_items_set_prompt_unique" ON "prompt_set_items" ("prompt_set_id", "workspace_prompt_id");

ALTER TABLE "monitor_prompts" ADD COLUMN IF NOT EXISTS "workspace_prompt_id" uuid REFERENCES "workspace_prompts"("id") ON DELETE SET NULL;
ALTER TABLE "monitor_prompts" ADD COLUMN IF NOT EXISTS "origin" varchar(32) NOT NULL DEFAULT 'user_custom';
ALTER TABLE "monitor_prompts" ADD COLUMN IF NOT EXISTS "template_key" varchar(200);
ALTER TABLE "monitor_prompts" ADD COLUMN IF NOT EXISTS "template_version" varchar(40);
ALTER TABLE "monitor_prompts" ADD COLUMN IF NOT EXISTS "prompt_hash" varchar(64);
ALTER TABLE "monitor_prompts" ADD COLUMN IF NOT EXISTS "brand_exposure" varchar(16);
ALTER TABLE "monitor_prompts" ADD COLUMN IF NOT EXISTS "dimensions" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "monitor_prompts" ADD COLUMN IF NOT EXISTS "rewrites" jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "collection_series" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "prompt_set_id" uuid REFERENCES "prompt_sets"("id") ON DELETE SET NULL,
  "purpose" varchar(24) NOT NULL DEFAULT 'baseline',
  "status" varchar(32) NOT NULL DEFAULT 'queued',
  "tier" varchar(24) NOT NULL,
  "required_providers" jsonb DEFAULT '[]'::jsonb,
  "provider_modes" jsonb DEFAULT '{}'::jsonb,
  "round_count" integer NOT NULL DEFAULT 1,
  "planned_samples" integer NOT NULL DEFAULT 0,
  "completed_samples" integer NOT NULL DEFAULT 0,
  "failed_samples" integer NOT NULL DEFAULT 0,
  "waiting_samples" integer NOT NULL DEFAULT 0,
  "manifest" jsonb DEFAULT '{}'::jsonb,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "collection_series_workspace_idx" ON "collection_series" ("workspace_id");

ALTER TABLE "collection_runs" ADD COLUMN IF NOT EXISTS "series_id" uuid REFERENCES "collection_series"("id") ON DELETE SET NULL;
ALTER TABLE "collection_runs" ADD COLUMN IF NOT EXISTS "round_index" integer NOT NULL DEFAULT 1;

ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "workspace_prompt_id" uuid REFERENCES "workspace_prompts"("id") ON DELETE SET NULL;
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "phase" varchar(32) NOT NULL DEFAULT 'queued';
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "requested_mode" varchar(32) NOT NULL DEFAULT 'default';
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "actual_mode" varchar(32);
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "analysis_status" varchar(24) NOT NULL DEFAULT 'pending';
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "failure_category" varchar(40);
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "retryable" boolean;
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "warning_code" varchar(64);
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "last_event_at" timestamp;

CREATE TABLE IF NOT EXISTS "sample_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "checkpoint_id" uuid NOT NULL REFERENCES "sample_checkpoints"("id") ON DELETE CASCADE,
  "attempt_index" integer NOT NULL,
  "status" varchar(24) NOT NULL,
  "phase" varchar(32) NOT NULL,
  "failure_category" varchar(40),
  "failure_code" varchar(64),
  "failure_message" text,
  "retryable" boolean,
  "page_url" text,
  "conversation_id" text,
  "diagnostics" jsonb DEFAULT '{}'::jsonb,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sample_attempts_checkpoint_idx" ON "sample_attempts" ("checkpoint_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sample_attempts_checkpoint_attempt_unique" ON "sample_attempts" ("checkpoint_id", "attempt_index");

ALTER TABLE "brand_facts" ADD COLUMN IF NOT EXISTS "source_type" varchar(32);
ALTER TABLE "brand_facts" ADD COLUMN IF NOT EXISTS "evidence_grade" varchar(4);
ALTER TABLE "brand_facts" ADD COLUMN IF NOT EXISTS "retrieved_at" timestamp;
ALTER TABLE "brand_facts" ADD COLUMN IF NOT EXISTS "region" varchar(64);
ALTER TABLE "brand_facts" ADD COLUMN IF NOT EXISTS "valid_until" timestamp;
ALTER TABLE "brand_facts" ADD COLUMN IF NOT EXISTS "supported_claims" jsonb DEFAULT '[]'::jsonb;

ALTER TABLE "geo_opportunities" ADD COLUMN IF NOT EXISTS "baseline_series_id" uuid REFERENCES "collection_series"("id") ON DELETE SET NULL;
ALTER TABLE "geo_opportunities" ADD COLUMN IF NOT EXISTS "prompt_ids" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "geo_opportunities" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "geo_opportunities" ADD COLUMN IF NOT EXISTS "effort" varchar(16);
ALTER TABLE "geo_opportunities" ADD COLUMN IF NOT EXISTS "owner" text;
ALTER TABLE "geo_opportunities" ADD COLUMN IF NOT EXISTS "confidence" integer NOT NULL DEFAULT 50;
ALTER TABLE "geo_opportunities" ADD COLUMN IF NOT EXISTS "retest_scope" jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "external_evidence_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "opportunity_id" uuid REFERENCES "geo_opportunities"("id") ON DELETE SET NULL,
  "channel" varchar(32) NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "target_publisher" text,
  "owner" text,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "acceptance_metric" text,
  "due_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "external_evidence_tasks_workspace_idx" ON "external_evidence_tasks" ("workspace_id");

ALTER TABLE "content_revisions" ADD COLUMN IF NOT EXISTS "direct_answer" text;
ALTER TABLE "content_revisions" ADD COLUMN IF NOT EXISTS "structured_summary" text;
ALTER TABLE "content_revisions" ADD COLUMN IF NOT EXISTS "claim_map" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "content_revisions" ADD COLUMN IF NOT EXISTS "quality_report" jsonb DEFAULT '{}'::jsonb;

ALTER TABLE "geo_interventions" ADD COLUMN IF NOT EXISTS "baseline_series_id" uuid REFERENCES "collection_series"("id") ON DELETE SET NULL;
ALTER TABLE "geo_interventions" ADD COLUMN IF NOT EXISTS "before_snapshot" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "geo_interventions" ADD COLUMN IF NOT EXISTS "environment_snapshot" jsonb DEFAULT '{}'::jsonb;

ALTER TABLE "retest_experiments" ADD COLUMN IF NOT EXISTS "baseline_series_id" uuid REFERENCES "collection_series"("id") ON DELETE SET NULL;
ALTER TABLE "retest_experiments" ADD COLUMN IF NOT EXISTS "prompt_hashes" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "retest_experiments" ADD COLUMN IF NOT EXISTS "environment_snapshot" jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "experiment_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "experiment_id" uuid NOT NULL REFERENCES "retest_experiments"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "collection_runs"("id") ON DELETE SET NULL,
  "observation_day" integer NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'scheduled',
  "metrics" jsonb DEFAULT '{}'::jsonb,
  "confidence" varchar(16) NOT NULL DEFAULT 'low',
  "external_events" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "experiment_observations_experiment_idx" ON "experiment_observations" ("experiment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "experiment_observations_experiment_day_unique" ON "experiment_observations" ("experiment_id", "observation_day");

-- Preserve legacy prompt and run identifiers so old response links remain usable.
INSERT INTO "workspace_prompts" (
  "id", "workspace_id", "origin", "prompt", "prompt_hash", "locale",
  "intent", "decision_stage", "brand_exposure", "dimensions", "rewrites",
  "version", "locked", "active", "created_at", "updated_at"
)
SELECT
  mp."id", mp."workspace_id", 'legacy', mp."prompt",
  encode(digest(mp."locale" || E'\nlegacy\n' || regexp_replace(trim(mp."prompt"), '\s+', ' ', 'g'), 'sha256'), 'hex'),
  mp."locale", mp."prompt_group", COALESCE(mp."decision_stage", 'awareness'),
  CASE WHEN mp."cohort" = 'control' THEN 'blind' ELSE 'aided' END,
  jsonb_build_object('origin', 'legacy', 'promptGroup', mp."prompt_group"),
  '{}'::jsonb, mp."version", true, mp."active", mp."created_at", mp."updated_at"
FROM "monitor_prompts" mp
ON CONFLICT DO NOTHING;

UPDATE "monitor_prompts" mp
SET
  "workspace_prompt_id" = wp."id",
  "origin" = 'legacy',
  "prompt_hash" = wp."prompt_hash",
  "brand_exposure" = wp."brand_exposure",
  "dimensions" = wp."dimensions"
FROM "workspace_prompts" wp
WHERE
  wp."workspace_id" = mp."workspace_id"
  AND wp."origin" = 'legacy'
  AND wp."prompt_hash" = encode(
    digest(mp."locale" || E'\nlegacy\n' || regexp_replace(trim(mp."prompt"), '\s+', ' ', 'g'), 'sha256'),
    'hex'
  )
  AND mp."workspace_prompt_id" IS NULL;

INSERT INTO "prompt_set_items" ("prompt_set_id", "workspace_prompt_id", "position", "enabled", "role", "created_at", "updated_at")
SELECT mp."prompt_set_id", mp."workspace_prompt_id",
  row_number() OVER (PARTITION BY mp."prompt_set_id" ORDER BY mp."created_at") - 1,
  mp."active", CASE WHEN mp."cohort" = 'control' THEN 'control' ELSE 'measurement' END,
  mp."created_at", mp."updated_at"
FROM "monitor_prompts" mp
WHERE mp."workspace_prompt_id" IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE "prompt_sets"
SET "purpose" = CASE WHEN lower("name") LIKE '%smoke%' THEN 'smoke' ELSE 'legacy' END
WHERE "pack_key" IS NULL;

INSERT INTO "collection_series" (
  "id", "workspace_id", "prompt_set_id", "purpose", "status", "tier",
  "round_count", "planned_samples", "completed_samples", "failed_samples",
  "manifest", "started_at", "completed_at", "created_at", "updated_at"
)
SELECT
  cr."id", cr."workspace_id", cr."prompt_set_id",
  CASE WHEN ps."purpose" = 'smoke' THEN 'smoke' ELSE 'legacy' END,
  cr."status", cr."tier", 1, cr."total_samples", cr."completed_samples",
  cr."failed_samples", jsonb_build_object('legacy', true), cr."started_at",
  cr."completed_at", cr."created_at", cr."updated_at"
FROM "collection_runs" cr
LEFT JOIN "prompt_sets" ps ON ps."id" = cr."prompt_set_id"
ON CONFLICT DO NOTHING;

UPDATE "collection_runs" SET "series_id" = "id" WHERE "series_id" IS NULL;

UPDATE "sample_checkpoints" sc
SET "workspace_prompt_id" = mp."workspace_prompt_id"
FROM "monitor_prompts" mp
WHERE sc."prompt_id" = mp."id" AND sc."workspace_prompt_id" IS NULL;

UPDATE "sample_checkpoints"
SET
  "phase" = CASE WHEN "status" = 'completed' THEN 'completed' ELSE "status" END,
  "analysis_status" = CASE WHEN "status" = 'completed' THEN 'pending' ELSE 'not_applicable' END,
  "failure_category" = CASE WHEN "status" = 'failed' THEN 'legacy' ELSE "failure_category" END,
  "error_message" = CASE
    WHEN "status" = 'failed' AND "error_code" IS NOT NULL
      THEN concat('[legacy_code=', "error_code", '] ', COALESCE("error_message", ''))
    ELSE "error_message"
  END,
  "error_code" = CASE WHEN "status" = 'failed' THEN 'legacy_unclassified' ELSE "error_code" END
WHERE "workspace_prompt_id" IS NULL OR "failure_category" IS NULL;

UPDATE "retest_experiments" re
SET "baseline_series_id" = cr."series_id"
FROM "collection_runs" cr
WHERE re."baseline_run_id" = cr."id" AND re."baseline_series_id" IS NULL;
