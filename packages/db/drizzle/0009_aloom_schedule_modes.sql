ALTER TABLE "detection_schedules"
	ADD COLUMN IF NOT EXISTS "provider_modes" jsonb DEFAULT '{}'::jsonb;
