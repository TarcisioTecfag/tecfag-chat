ALTER TABLE "access_groups" ADD COLUMN IF NOT EXISTS "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL;
