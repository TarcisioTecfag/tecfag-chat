CREATE TABLE "operator_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"due_date" timestamp,
	"description" text,
	"deal_id" text,
	"deal_name" text,
	"client_name" text,
	"client_phone" text,
	"chat_contact_id" text,
	"chat_conversation_id" text,
	"operator_email" text,
	"created_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_operator_id_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "access_groups" ADD COLUMN "can_capture_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "access_groups" ADD COLUMN "can_transfer_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "access_groups" ADD COLUMN "can_finish_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "access_groups" ADD COLUMN "can_view_all_chats" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "access_groups" ADD COLUMN "can_override_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "report_daily_whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "report_daily_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "report_weekly_whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "report_weekly_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "report_whatsapp_numbers" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "report_email_addresses" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "smtp_user" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "smtp_pass" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "smtp_from" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "rd_crm_client_id" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "rd_crm_client_secret" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "rd_crm_access_token" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "rd_crm_refresh_token" text;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD COLUMN "rd_crm_token_expires_at" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wallet_operator_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sector_id" text;--> statement-breakpoint
ALTER TABLE "operator_templates" ADD CONSTRAINT "operator_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_templates" ADD CONSTRAINT "operator_templates_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_chat_contact_id_contacts_id_fk" FOREIGN KEY ("chat_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_chat_conversation_id_conversations_id_fk" FOREIGN KEY ("chat_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_wallet_operator_id_operators_id_fk" FOREIGN KEY ("wallet_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;