CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_token_hash" ON "auth_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_operator" ON "auth_sessions" ("operator_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_expires" ON "auth_sessions" ("expires_at");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN IF NOT EXISTS "active_provider" text DEFAULT 'baileys' NOT NULL;
--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN IF NOT EXISTS "connection_status" text DEFAULT 'disconnected' NOT NULL;
--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN IF NOT EXISTS "connection_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN IF NOT EXISTS "meta_app_secret" text;
--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint
UPDATE "channel_configs" cc
SET active_provider = COALESCE((SELECT t.connection_type FROM tenants t WHERE t.id = cc.tenant_id), 'baileys')
WHERE active_provider IS NULL OR active_provider = 'baileys';
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_tenant_queue_time" ON "conversations" ("tenant_id", "queue_state", "last_message_time" DESC, "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_tenant_operator" ON "conversations" ("tenant_id", "operator_id");
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'baileys';
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "direction" text DEFAULT 'inbound';
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'accepted' NOT NULL;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "error_message" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_tenant_conv_sent" ON "messages" ("tenant_id", "conversation_id", "sent_at" DESC, "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_tenant_idempotency" ON "messages" ("tenant_id", "idempotency_key");
--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN IF NOT EXISTS "tenant_id" text;
--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN IF NOT EXISTS "conversation_id" text;
--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN IF NOT EXISTS "file_size" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_files" ADD CONSTRAINT "media_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
UPDATE "media_files" mf
SET tenant_id = m.tenant_id,
    conversation_id = m.conversation_id
FROM "messages" m
WHERE mf.id = m.id AND mf.tenant_id IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_inbounds" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_inbounds_tenant_event" ON "pending_inbounds" ("tenant_id", "external_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_inbounds_status_retry" ON "pending_inbounds" ("status", "next_retry_at");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_inbounds" ADD CONSTRAINT "pending_inbounds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
