CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "brand_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "brand_name" text NOT NULL,
  "official_domain" text NOT NULL,
  "aliases" jsonb DEFAULT '[]'::jsonb,
  "products" jsonb DEFAULT '[]'::jsonb,
  "category" text,
  "market" text,
  "audiences" jsonb DEFAULT '[]'::jsonb,
  "competitors" jsonb DEFAULT '[]'::jsonb,
  "regions" jsonb DEFAULT '[]'::jsonb,
  "locales" jsonb DEFAULT '["zh-CN"]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "brand_profiles_workspace_unique" ON "brand_profiles" ("workspace_id");

CREATE TABLE IF NOT EXISTS "collector_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" varchar(160) NOT NULL,
  "platform" varchar(32) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'offline',
  "device_token_hash" text,
  "last_heartbeat_at" timestamp,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "collector_nodes_workspace_idx" ON "collector_nodes" ("workspace_id");

CREATE TABLE IF NOT EXISTS "provider_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "collector_node_id" uuid NOT NULL REFERENCES "collector_nodes"("id") ON DELETE CASCADE,
  "provider" varchar(32) NOT NULL,
  "profile_key" varchar(256) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'disconnected',
  "last_session_check_at" timestamp,
  "last_network_fingerprint" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "provider_profiles_collector_provider_unique" ON "provider_profiles" ("collector_node_id", "provider");
CREATE INDEX IF NOT EXISTS "provider_profiles_workspace_idx" ON "provider_profiles" ("workspace_id");

CREATE TABLE IF NOT EXISTS "collector_commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "collector_node_id" uuid NOT NULL REFERENCES "collector_nodes"("id") ON DELETE CASCADE,
  "provider" varchar(32),
  "type" varchar(40) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'queued',
  "payload" jsonb DEFAULT '{}'::jsonb,
  "expires_at" timestamp NOT NULL,
  "delivered_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "collector_commands_collector_idx" ON "collector_commands" ("collector_node_id");

CREATE TABLE IF NOT EXISTS "prompt_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" varchar(200) NOT NULL,
  "tier" varchar(24) NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "status" varchar(24) NOT NULL DEFAULT 'draft',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "prompt_sets_workspace_idx" ON "prompt_sets" ("workspace_id");

CREATE TABLE IF NOT EXISTS "monitor_prompts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "prompt_set_id" uuid NOT NULL REFERENCES "prompt_sets"("id") ON DELETE CASCADE,
  "prompt" text NOT NULL,
  "prompt_group" varchar(32) NOT NULL,
  "locale" varchar(16) NOT NULL DEFAULT 'zh-CN',
  "persona" varchar(120),
  "decision_stage" varchar(32),
  "cohort" varchar(16) NOT NULL DEFAULT 'treatment',
  "version" integer NOT NULL DEFAULT 1,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "monitor_prompts_set_idx" ON "monitor_prompts" ("prompt_set_id");
CREATE INDEX IF NOT EXISTS "monitor_prompts_workspace_idx" ON "monitor_prompts" ("workspace_id");

CREATE TABLE IF NOT EXISTS "collection_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "prompt_set_id" uuid REFERENCES "prompt_sets"("id") ON DELETE SET NULL,
  "collector_node_id" uuid REFERENCES "collector_nodes"("id") ON DELETE SET NULL,
  "status" varchar(32) NOT NULL DEFAULT 'queued',
  "tier" varchar(24) NOT NULL,
  "total_samples" integer NOT NULL DEFAULT 0,
  "completed_samples" integer NOT NULL DEFAULT 0,
  "failed_samples" integer NOT NULL DEFAULT 0,
  "scheduled_at" timestamp,
  "started_at" timestamp,
  "completed_at" timestamp,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "collection_runs_workspace_idx" ON "collection_runs" ("workspace_id");

CREATE TABLE IF NOT EXISTS "sample_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "collection_runs"("id") ON DELETE CASCADE,
  "prompt_id" uuid REFERENCES "monitor_prompts"("id") ON DELETE SET NULL,
  "provider" varchar(32) NOT NULL,
  "repeat_index" integer NOT NULL DEFAULT 0,
  "status" varchar(32) NOT NULL DEFAULT 'queued',
  "conversation_id" text,
  "conversation_url" text,
  "source_exposure" varchar(24),
  "analytics_sample_id" text,
  "error_code" varchar(64),
  "error_message" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sample_checkpoints_run_idx" ON "sample_checkpoints" ("run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sample_checkpoints_run_prompt_provider_repeat_unique" ON "sample_checkpoints" ("run_id", "prompt_id", "provider", "repeat_index");

CREATE TABLE IF NOT EXISTS "human_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "run_id" uuid NOT NULL REFERENCES "collection_runs"("id") ON DELETE CASCADE,
  "checkpoint_id" uuid REFERENCES "sample_checkpoints"("id") ON DELETE SET NULL,
  "provider" varchar(32) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "page_url" text NOT NULL,
  "message" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "human_challenges_run_idx" ON "human_challenges" ("run_id");

CREATE TABLE IF NOT EXISTS "site_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "page_type" varchar(32) NOT NULL DEFAULT 'page',
  "title" text,
  "canonical_url" text,
  "content_hash" varchar(64),
  "http_status" integer,
  "snapshot" jsonb DEFAULT '{}'::jsonb,
  "last_crawled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "site_pages_workspace_url_unique" ON "site_pages" ("workspace_id", "url");

CREATE TABLE IF NOT EXISTS "brand_facts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "subject" text NOT NULL,
  "predicate" text NOT NULL,
  "value" text NOT NULL,
  "source_url" text,
  "confidence" integer NOT NULL DEFAULT 50,
  "status" varchar(24) NOT NULL DEFAULT 'unverified',
  "verified_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "brand_facts_workspace_idx" ON "brand_facts" ("workspace_id");

CREATE TABLE IF NOT EXISTS "geo_opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "type" varchar(40) NOT NULL,
  "priority" varchar(8) NOT NULL DEFAULT 'P1',
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "title" text NOT NULL,
  "description" text NOT NULL,
  "target_page_id" uuid REFERENCES "site_pages"("id") ON DELETE SET NULL,
  "evidence_sample_ids" jsonb DEFAULT '[]'::jsonb,
  "acceptance_metric" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "geo_opportunities_workspace_idx" ON "geo_opportunities" ("workspace_id");

CREATE TABLE IF NOT EXISTS "content_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "opportunity_id" uuid REFERENCES "geo_opportunities"("id") ON DELETE SET NULL,
  "kind" varchar(40) NOT NULL,
  "title" text NOT NULL,
  "target_url" text,
  "status" varchar(24) NOT NULL DEFAULT 'draft',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "content_assets_workspace_idx" ON "content_assets" ("workspace_id");

CREATE TABLE IF NOT EXISTS "content_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "content_assets"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'draft',
  "source_content" text,
  "markdown" text NOT NULL,
  "html" text,
  "json_ld" jsonb,
  "fact_ids" jsonb DEFAULT '[]'::jsonb,
  "atomic_facts" jsonb DEFAULT '[]'::jsonb,
  "evidence_gaps" jsonb DEFAULT '[]'::jsonb,
  "faq" jsonb DEFAULT '[]'::jsonb,
  "model" varchar(120),
  "template_version" varchar(40),
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "content_revisions_asset_version_unique" ON "content_revisions" ("asset_id", "version");

CREATE TABLE IF NOT EXISTS "publisher_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "type" varchar(24) NOT NULL,
  "name" varchar(160) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'disconnected',
  "encrypted_config" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "publisher_connections_workspace_idx" ON "publisher_connections" ("workspace_id");

CREATE TABLE IF NOT EXISTS "geo_interventions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "asset_id" uuid REFERENCES "content_assets"("id") ON DELETE SET NULL,
  "revision_id" uuid REFERENCES "content_revisions"("id") ON DELETE SET NULL,
  "publisher_connection_id" uuid REFERENCES "publisher_connections"("id") ON DELETE SET NULL,
  "status" varchar(24) NOT NULL DEFAULT 'approved',
  "published_url" text,
  "before_hash" varchar(64),
  "after_hash" varchar(64),
  "rollback_data" jsonb DEFAULT '{}'::jsonb,
  "published_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "geo_interventions_workspace_idx" ON "geo_interventions" ("workspace_id");

CREATE TABLE IF NOT EXISTS "retest_experiments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "intervention_id" uuid NOT NULL REFERENCES "geo_interventions"("id") ON DELETE CASCADE,
  "status" varchar(24) NOT NULL DEFAULT 'scheduled',
  "baseline_run_id" uuid REFERENCES "collection_runs"("id") ON DELETE SET NULL,
  "treatment_prompt_ids" jsonb DEFAULT '[]'::jsonb,
  "control_prompt_ids" jsonb DEFAULT '[]'::jsonb,
  "observation_days" jsonb DEFAULT '[7,14,30]'::jsonb,
	"completed_observation_days" jsonb DEFAULT '[]'::jsonb,
	"current_observation_day" integer,
	"latest_run_id" uuid REFERENCES "collection_runs"("id") ON DELETE SET NULL,
  "next_run_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "retest_experiments_workspace_idx" ON "retest_experiments" ("workspace_id");

ALTER TABLE "retest_experiments" ADD COLUMN IF NOT EXISTS "completed_observation_days" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "retest_experiments" ADD COLUMN IF NOT EXISTS "current_observation_day" integer;
ALTER TABLE "retest_experiments" ADD COLUMN IF NOT EXISTS "latest_run_id" uuid REFERENCES "collection_runs"("id") ON DELETE SET NULL;
