-- ============================================================================
-- MIGRATION 0009: CRM Core Foundation (Fase 1)
-- Criação das tabelas centrais do CRM e relacionamento N:N com atendimentos.
-- 100% aditivo e seguro: todas as tabelas contêm tenant_id NOT NULL com cascade.
-- ============================================================================

-- 1. Contas de Compradores PF e PJ
CREATE TABLE IF NOT EXISTS "crm_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"trade_name" text,
	"document_type" text,
	"document" text,
	"email" text,
	"phone" text,
	"website" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"rd_organization_id" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_accounts_tenant_name" ON "crm_accounts" ("tenant_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_accounts_tenant_doc_uniq" ON "crm_accounts" ("tenant_id", "document")
WHERE "document" IS NOT NULL AND "document" != '';
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_accounts" ADD CONSTRAINT "crm_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 2. Vínculo de Cliente Principal em Contatos (contacts.account_id)
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "account_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_crm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."crm_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contacts_tenant_account" ON "contacts" ("tenant_id", "account_id");
--> statement-breakpoint

-- 3. Trilha de Histórico de Cliente/Conta do Contato
CREATE TABLE IF NOT EXISTS "crm_contact_account_history" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"account_id" text,
	"reason" text,
	"changed_by_operator_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_contact_acc_hist_tenant_contact" ON "crm_contact_account_history" ("tenant_id", "contact_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_contact_account_history" ADD CONSTRAINT "crm_contact_account_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_contact_account_history" ADD CONSTRAINT "crm_contact_account_history_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_contact_account_history" ADD CONSTRAINT "crm_contact_account_history_account_id_crm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."crm_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_contact_account_history" ADD CONSTRAINT "crm_contact_account_history_operator_fk" FOREIGN KEY ("changed_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 4. Contexto Conta ↔ Conversa (Atendimento contextualizado sem card)
CREATE TABLE IF NOT EXISTS "crm_account_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"account_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"context_note" text,
	"created_by_operator_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_acc_conv_tenant_acc_conv_uniq" ON "crm_account_conversations" ("tenant_id", "account_id", "conversation_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_account_conversations" ADD CONSTRAINT "crm_account_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_account_conversations" ADD CONSTRAINT "crm_account_conversations_account_id_crm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."crm_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_account_conversations" ADD CONSTRAINT "crm_account_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_account_conversations" ADD CONSTRAINT "crm_account_conversations_operator_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 5. Funis de Vendas (crm_pipelines)
CREATE TABLE IF NOT EXISTS "crm_pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"color" text DEFAULT '#0284c7' NOT NULL,
	"cooling_days" integer DEFAULT 10 NOT NULL,
	"rd_pipeline_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_pipelines_tenant_order" ON "crm_pipelines" ("tenant_id", "order_index");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 6. Etapas dos Funis (crm_stages)
CREATE TABLE IF NOT EXISTS "crm_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"name" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"is_win_stage" boolean DEFAULT false NOT NULL,
	"is_loss_stage" boolean DEFAULT false NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rd_stage_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_stages_tenant_pipeline_order" ON "crm_stages" ("tenant_id", "pipeline_id", "order_index");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_pipeline_id_crm_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 7. Negociações / Cards (crm_deals)
CREATE TABLE IF NOT EXISTS "crm_deals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"account_id" text,
	"pipeline_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"value" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"expected_close_date" timestamp,
	"operator_id" text,
	"source" text,
	"campaign" text,
	"rating" integer DEFAULT 0 NOT NULL,
	"loss_reason" text,
	"paused_reason" text,
	"rd_deal_id" text,
	"rd_deal_url" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_deals_tenant_pipeline_stage" ON "crm_deals" ("tenant_id", "pipeline_id", "stage_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_deals_tenant_status" ON "crm_deals" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_deals_tenant_operator" ON "crm_deals" ("tenant_id", "operator_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_deals_tenant_account" ON "crm_deals" ("tenant_id", "account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_deals_tenant_rd_deal" ON "crm_deals" ("tenant_id", "rd_deal_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_account_id_crm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."crm_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_pipeline_id_crm_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stage_id_crm_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."crm_stages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_operator_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 8. Contatos Participantes da Negociação (crm_deal_contacts)
CREATE TABLE IF NOT EXISTS "crm_deal_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" text DEFAULT 'buyer' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_deal_contacts_tenant_deal_contact_uniq" ON "crm_deal_contacts" ("tenant_id", "deal_id", "contact_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_contacts" ADD CONSTRAINT "crm_deal_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_contacts" ADD CONSTRAINT "crm_deal_contacts_deal_id_crm_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_contacts" ADD CONSTRAINT "crm_deal_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 9. Vínculo N:N Conversas ↔ Negociações (crm_conversation_deals)
CREATE TABLE IF NOT EXISTS "crm_conversation_deals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"origin" text DEFAULT 'chat' NOT NULL,
	"created_by_operator_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"unlinked_at" timestamp,
	"unlinked_by_operator_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_conv_deals_active_uniq" ON "crm_conversation_deals" ("tenant_id", "conversation_id", "deal_id")
WHERE "is_active" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_conv_deals_tenant_conv" ON "crm_conversation_deals" ("tenant_id", "conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_conv_deals_tenant_deal" ON "crm_conversation_deals" ("tenant_id", "deal_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_conversation_deals" ADD CONSTRAINT "crm_conversation_deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_conversation_deals" ADD CONSTRAINT "crm_conversation_deals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_conversation_deals" ADD CONSTRAINT "crm_conversation_deals_deal_id_crm_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_conversation_deals" ADD CONSTRAINT "crm_conversation_deals_created_by_operator_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_conversation_deals" ADD CONSTRAINT "crm_conversation_deals_unlinked_by_operator_fk" FOREIGN KEY ("unlinked_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 10. Atividades da Negociação (crm_deal_activities)
CREATE TABLE IF NOT EXISTS "crm_deal_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"conversation_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" timestamp,
	"completed_at" timestamp,
	"operator_id" text,
	"assigned_to_operator_id" text,
	"rd_task_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_deal_activities_tenant_deal" ON "crm_deal_activities" ("tenant_id", "deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_deal_activities_tenant_status_due" ON "crm_deal_activities" ("tenant_id", "status", "due_date");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_activities" ADD CONSTRAINT "crm_deal_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_activities" ADD CONSTRAINT "crm_deal_activities_deal_id_crm_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_activities" ADD CONSTRAINT "crm_deal_activities_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_activities" ADD CONSTRAINT "crm_deal_activities_creator_operator_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_activities" ADD CONSTRAINT "crm_deal_activities_assigned_operator_fk" FOREIGN KEY ("assigned_to_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 11. Evidências de Mensagens em Atividades/Cards (crm_activity_messages)
CREATE TABLE IF NOT EXISTS "crm_activity_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"activity_id" text,
	"message_id" text NOT NULL,
	"marked_by_operator_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_activity_msgs_tenant_deal" ON "crm_activity_messages" ("tenant_id", "deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_activity_msgs_tenant_msg" ON "crm_activity_messages" ("tenant_id", "message_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_activity_messages" ADD CONSTRAINT "crm_activity_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_activity_messages" ADD CONSTRAINT "crm_activity_messages_deal_id_crm_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_activity_messages" ADD CONSTRAINT "crm_activity_messages_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."crm_deal_activities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_activity_messages" ADD CONSTRAINT "crm_activity_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_activity_messages" ADD CONSTRAINT "crm_activity_messages_marked_by_operator_fk" FOREIGN KEY ("marked_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 12. Auditoria Imutável de Transições Comerciais (crm_deal_events)
CREATE TABLE IF NOT EXISTS "crm_deal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"event_type" text NOT NULL,
	"from_stage_id" text,
	"to_stage_id" text,
	"from_status" text,
	"to_status" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"operator_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_deal_events_tenant_deal_created" ON "crm_deal_events" ("tenant_id", "deal_id", "created_at");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_events" ADD CONSTRAINT "crm_deal_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_events" ADD CONSTRAINT "crm_deal_events_deal_id_crm_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_events" ADD CONSTRAINT "crm_deal_events_operator_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
