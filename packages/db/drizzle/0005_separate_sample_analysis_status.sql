ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "analysis_error_code" varchar(64);
ALTER TABLE "sample_checkpoints" ADD COLUMN IF NOT EXISTS "analysis_error_message" text;
