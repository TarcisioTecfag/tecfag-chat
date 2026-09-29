CREATE TABLE IF NOT EXISTS "platform_access_groups" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "allowed_tenants" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "platform_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "home_tenant_id" text NOT NULL REFERENCES "tenants"("id"),
  "group_id" text REFERENCES "platform_access_groups"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "platform_access_managers" (
  "email" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
INSERT INTO "platform_access_managers" ("email", "tenant_id")
SELECT 'suporte2@tecfag.com.br', t."id" FROM "tenants" AS t
WHERE t."slug" = split_part(split_part('suporte2@tecfag.com.br', '@', 2), '.', 1)
ON CONFLICT DO NOTHING;

-- Primeiro administrador aprovado: promove apenas o operador da empresa cujo slug
-- corresponde ao domínio do e-mail autorizado. Nenhum operador de outro tenant é afetado.
UPDATE "operators" AS o SET "role" = 'admin'
FROM "platform_access_managers" AS manager
WHERE lower(o."email") = manager."email"
  AND o."tenant_id" = manager."tenant_id";

ALTER TABLE "operators" ADD COLUMN IF NOT EXISTS "account_id" text REFERENCES "platform_accounts"("id") ON DELETE set null;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_operators_account_tenant_unique"
  ON "operators" ("account_id", "tenant_id") WHERE "account_id" IS NOT NULL;
