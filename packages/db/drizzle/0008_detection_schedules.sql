CREATE TABLE IF NOT EXISTS "detection_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"prompt_set_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"providers" jsonb DEFAULT '[]'::jsonb,
	"cadence" varchar(16) NOT NULL,
	"timezone" varchar(80) DEFAULT 'UTC' NOT NULL,
	"local_time" varchar(5) DEFAULT '09:00' NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"last_series_id" uuid,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "detection_schedules" ADD CONSTRAINT "detection_schedules_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "detection_schedules" ADD CONSTRAINT "detection_schedules_prompt_set_id_prompt_sets_id_fk"
	FOREIGN KEY ("prompt_set_id") REFERENCES "public"."prompt_sets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "detection_schedules" ADD CONSTRAINT "detection_schedules_created_by_user_id_user_id_fk"
	FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "detection_schedules" ADD CONSTRAINT "detection_schedules_last_series_id_collection_series_id_fk"
	FOREIGN KEY ("last_series_id") REFERENCES "public"."collection_series"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "detection_schedules_workspace_idx" ON "detection_schedules" USING btree ("workspace_id");
CREATE INDEX IF NOT EXISTS "detection_schedules_due_idx" ON "detection_schedules" USING btree ("enabled", "next_run_at");
CREATE UNIQUE INDEX IF NOT EXISTS "detection_schedules_workspace_prompt_set_unique" ON "detection_schedules" USING btree ("workspace_id", "prompt_set_id");
