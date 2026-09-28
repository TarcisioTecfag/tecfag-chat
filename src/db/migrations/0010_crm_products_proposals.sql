-- ============================================================================
-- MIGRATION 0010: CRM Products & Proposals (Fase 4: Comercial Ampliado)
-- Catálogo de produtos, itens de negociação e orçamentos/propostas comerciais.
-- 100% aditivo e seguro: integridade estrita multi-tenant com FKs compostas.
-- ============================================================================

-- 0. Sequência Atômica Concorrente para Numeração de Propostas
CREATE SEQUENCE IF NOT EXISTS "crm_proposal_seq" START WITH 1001 INCREMENT BY 1;
--> statement-breakpoint

-- 1. Garante Índices Únicos Compostos em Deals e Produtos para Integridade Multi-Tenant
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_deals_tenant_id_uniq" ON "crm_deals" ("tenant_id", "id");
--> statement-breakpoint

-- 2. Catálogo de Produtos e Serviços
CREATE TABLE IF NOT EXISTS "crm_products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"description" text,
	"unit_price" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"unit" text DEFAULT 'UN' NOT NULL,
	"category" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_products_tenant_id_uniq" ON "crm_products" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_products_tenant_active" ON "crm_products" ("tenant_id", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_products_tenant_sku" ON "crm_products" ("tenant_id", "sku");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_products" ADD CONSTRAINT "crm_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 3. Itens / Produtos Vinculados à Negociação
CREATE TABLE IF NOT EXISTS "crm_deal_products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"product_id" text,
	"name" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1.000' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"total_price" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_deal_products_tenant_deal" ON "crm_deal_products" ("tenant_id", "deal_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_deal_products" ADD CONSTRAINT "crm_deal_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 -- Integridade composta estrita: deal_id DEVE pertencer ao mesmo tenant_id
 ALTER TABLE "crm_deal_products" ADD CONSTRAINT "crm_deal_products_tenant_deal_fk" FOREIGN KEY ("tenant_id", "deal_id") REFERENCES "public"."crm_deals"("tenant_id", "id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 -- Integridade composta estrita: product_id (quando preenchido) DEVE pertencer ao mesmo tenant_id
 ALTER TABLE "crm_deal_products" ADD CONSTRAINT "crm_deal_products_tenant_prod_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "public"."crm_products"("tenant_id", "id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 4. Propostas e Orçamentos Comerciais
CREATE TABLE IF NOT EXISTS "crm_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"proposal_number" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"payment_terms" text,
	"delivery_terms" text,
	"validity_days" integer DEFAULT 15 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_operator_id" text,
	"sent_at" timestamp,
	"accepted_at" timestamp,
	"rejected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crm_proposals_tenant_deal" ON "crm_proposals" ("tenant_id", "deal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_proposals_tenant_number_uniq" ON "crm_proposals" ("tenant_id", "proposal_number");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 -- Integridade composta estrita: deal_id da proposta DEVE pertencer ao mesmo tenant_id
 ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_tenant_deal_fk" FOREIGN KEY ("tenant_id", "deal_id") REFERENCES "public"."crm_deals"("tenant_id", "id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_created_operator_id_operators_id_fk" FOREIGN KEY ("created_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
