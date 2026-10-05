CREATE TABLE IF NOT EXISTS meta_message_templates (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meta_template_id text NOT NULL,
  name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  body_text text NOT NULL,
  components jsonb NOT NULL,
  bindings jsonb NOT NULL DEFAULT '{}'::jsonb,
  rejected_reason text,
  last_synced_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_message_templates_tenant_meta_id_unique
  ON meta_message_templates(tenant_id, meta_template_id);
