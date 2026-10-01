-- Identidade da Meta por tenant. Username é mutável e não serve como chave de entrega.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS whatsapp_user_id text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS whatsapp_username text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_tenant_whatsapp_user_id_uniq
  ON contacts (tenant_id, whatsapp_user_id)
  WHERE whatsapp_user_id IS NOT NULL;
