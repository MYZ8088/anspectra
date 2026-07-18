CREATE TABLE IF NOT EXISTS "analysis_model_configs" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"model" varchar(200) NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "analysis_model_configs" ADD CONSTRAINT "analysis_model_configs_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "analysis_model_configs_workspace_idx"
	ON "analysis_model_configs" USING btree ("workspace_id");
