-- Additive deployment. Existing corporate sessions/keys and message provenance stay intact.
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider text NOT NULL DEFAULT 'baileys' CHECK (provider = 'baileys'),
  owner_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  capture_policy text NOT NULL DEFAULT 'selected' CHECK (capture_policy IN ('selected', 'all')),
  connection_status text NOT NULL DEFAULT 'disconnected',
  paired_phone text,
  auth_encrypted text,
  qr_encrypted text,
  qr_expires_at timestamp,
  lease_token text,
  lease_until timestamp,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_connections_tenant_id ON whatsapp_connections(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_paired_phone ON whatsapp_connections(paired_phone) WHERE paired_phone IS NOT NULL;

-- Global number ownership is a database constraint, never a cross-tenant application data lookup.
CREATE OR REPLACE FUNCTION guard_whatsapp_number_ownership() RETURNS trigger AS $$
DECLARE claimed_phone text;
BEGIN
  IF TG_TABLE_NAME = 'whatsapp_connections' THEN claimed_phone := NEW.paired_phone;
  ELSE claimed_phone := NEW.baileys_paired_phone;
  END IF;
  IF claimed_phone IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('whatsapp-number-ownership'), hashtext(claimed_phone));
  END IF;
  IF TG_TABLE_NAME = 'whatsapp_connections' THEN
    IF NEW.paired_phone IS NOT NULL AND EXISTS (SELECT 1 FROM channel_configs WHERE baileys_paired_phone = NEW.paired_phone) THEN
      RAISE EXCEPTION 'Number already belongs to a corporate connection' USING ERRCODE = '23505';
    END IF;
  ELSIF NEW.baileys_paired_phone IS NOT NULL AND EXISTS (SELECT 1 FROM whatsapp_connections WHERE paired_phone = NEW.baileys_paired_phone) THEN
    RAISE EXCEPTION 'Number already belongs to an individual connection' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER whatsapp_number_ownership_guard BEFORE INSERT OR UPDATE OF paired_phone ON whatsapp_connections FOR EACH ROW EXECUTE FUNCTION guard_whatsapp_number_ownership();
CREATE TRIGGER corporate_number_ownership_guard BEFORE INSERT OR UPDATE OF baileys_paired_phone ON channel_configs FOR EACH ROW EXECUTE FUNCTION guard_whatsapp_number_ownership();

CREATE TABLE IF NOT EXISTS whatsapp_connection_contacts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  contact_id text NOT NULL REFERENCES contacts(id),
  created_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES whatsapp_connections(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_selected_contact ON whatsapp_connection_contacts(tenant_id, connection_id, contact_id);
CREATE TABLE IF NOT EXISTS contact_channel_identities (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  contact_id text NOT NULL REFERENCES contacts(id),
  external_id text NOT NULL,
  alias text,
  created_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES whatsapp_connections(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_connection_identity ON contact_channel_identities(tenant_id, connection_id, external_id);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS whatsapp_connection_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS whatsapp_connection_id text;
ALTER TABLE pending_inbounds ADD COLUMN IF NOT EXISTS whatsapp_connection_id text;

-- All old writers keep the NULL/corporate namespace. Never backfill historical numbers by guessing.
DROP INDEX IF EXISTS idx_conversations_tenant_contact_uniq;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM conversations WHERE whatsapp_connection_id IS NULL GROUP BY tenant_id, contact_id HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX idx_conversations_tenant_contact_uniq ON conversations(tenant_id, contact_id) WHERE whatsapp_connection_id IS NULL;
  ELSE
    RAISE WARNING 'Legacy duplicate conversations preserved; review before enforcing corporate uniqueness';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_connection_contact_uniq ON conversations(tenant_id, whatsapp_connection_id, contact_id) WHERE whatsapp_connection_id IS NOT NULL;
ALTER TABLE conversations ADD CONSTRAINT conversations_connection_tenant_fk FOREIGN KEY (tenant_id, whatsapp_connection_id) REFERENCES whatsapp_connections(tenant_id, id);
ALTER TABLE messages ADD CONSTRAINT messages_connection_tenant_fk FOREIGN KEY (tenant_id, whatsapp_connection_id) REFERENCES whatsapp_connections(tenant_id, id);
ALTER TABLE pending_inbounds ADD CONSTRAINT inbounds_connection_tenant_fk FOREIGN KEY (tenant_id, whatsapp_connection_id) REFERENCES whatsapp_connections(tenant_id, id);

-- Guard tenant consistency even when a caller supplies a valid ID from another tenant.
CREATE OR REPLACE FUNCTION guard_whatsapp_connection_links() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'whatsapp_connections' THEN
    IF NEW.owner_operator_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operators WHERE id = NEW.owner_operator_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Connection owner belongs to another tenant' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    IF NEW.whatsapp_connection_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND tenant_id = NEW.tenant_id AND whatsapp_connection_id = NEW.whatsapp_connection_id) THEN
      RAISE EXCEPTION 'Message connection differs from conversation' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = NEW.contact_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Contact belongs to another tenant' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER whatsapp_owner_tenant_guard BEFORE INSERT OR UPDATE ON whatsapp_connections FOR EACH ROW EXECUTE FUNCTION guard_whatsapp_connection_links();
CREATE TRIGGER whatsapp_selected_tenant_guard BEFORE INSERT OR UPDATE ON whatsapp_connection_contacts FOR EACH ROW EXECUTE FUNCTION guard_whatsapp_connection_links();
CREATE TRIGGER whatsapp_identity_tenant_guard BEFORE INSERT OR UPDATE ON contact_channel_identities FOR EACH ROW EXECUTE FUNCTION guard_whatsapp_connection_links();
CREATE TRIGGER whatsapp_conversation_tenant_guard BEFORE INSERT OR UPDATE OF contact_id, tenant_id, whatsapp_connection_id ON conversations FOR EACH ROW WHEN (NEW.whatsapp_connection_id IS NOT NULL) EXECUTE FUNCTION guard_whatsapp_connection_links();
CREATE TRIGGER whatsapp_message_connection_guard BEFORE INSERT OR UPDATE OF conversation_id, tenant_id, whatsapp_connection_id ON messages FOR EACH ROW WHEN (NEW.whatsapp_connection_id IS NOT NULL) EXECUTE FUNCTION guard_whatsapp_connection_links();
