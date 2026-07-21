ALTER TABLE "brand_profiles" ADD COLUMN IF NOT EXISTS "industry" text;
ALTER TABLE "brand_profiles" ADD COLUMN IF NOT EXISTS "budget" text;
ALTER TABLE "brand_profiles" ADD COLUMN IF NOT EXISTS "team_size" text;
ALTER TABLE "brand_profiles" ADD COLUMN IF NOT EXISTS "implementation_period" text;
ALTER TABLE "brand_profiles" ADD COLUMN IF NOT EXISTS "evidence_requirement" text;
ALTER TABLE "brand_profiles" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "brand_profiles" ADD COLUMN IF NOT EXISTS "confirmation_status" varchar(24) NOT NULL DEFAULT 'draft';
ALTER TABLE "brand_profiles" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp;

ALTER TABLE "workspace_prompts" ADD COLUMN IF NOT EXISTS "created_by_user_id" text;
ALTER TABLE "workspace_prompts" ADD COLUMN IF NOT EXISTS "import_source" varchar(40);
ALTER TABLE "workspace_prompts" ADD COLUMN IF NOT EXISTS "legacy_source_id" text;
ALTER TABLE "workspace_prompts" ADD COLUMN IF NOT EXISTS "profile_version" integer;
ALTER TABLE "workspace_prompts" ADD COLUMN IF NOT EXISTS "relevance" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "workspace_prompts" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
ALTER TABLE "workspace_prompts" ADD COLUMN IF NOT EXISTS "archived_reason" text;

DO $$ BEGIN
 ALTER TABLE "workspace_prompts" ADD CONSTRAINT "workspace_prompts_created_by_user_id_user_id_fk"
 FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
