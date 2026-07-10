CREATE TABLE IF NOT EXISTS "page_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"url" text NOT NULL,
	"trigger" varchar(32) DEFAULT 'audit' NOT NULL,
	"content_hash" varchar(64),
	"http_status" integer,
	"snapshot" jsonb DEFAULT '{}'::jsonb,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_page_id_site_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "page_snapshots_workspace_idx" ON "page_snapshots" USING btree ("workspace_id", "captured_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "page_snapshots_page_idx" ON "page_snapshots" USING btree ("page_id", "captured_at");
