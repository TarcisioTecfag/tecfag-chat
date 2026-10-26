CREATE TABLE whatsapp_connection_group_access (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  group_id text NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  can_read boolean NOT NULL DEFAULT false,
  can_send boolean NOT NULL DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES whatsapp_connections(tenant_id, id) ON DELETE CASCADE,
  CHECK (NOT can_send OR can_read)
);
CREATE UNIQUE INDEX idx_whatsapp_connection_group_access ON whatsapp_connection_group_access(tenant_id, connection_id, group_id);
CREATE FUNCTION guard_whatsapp_group_access_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM access_groups WHERE id = NEW.group_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Access group belongs to another tenant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER whatsapp_group_access_tenant_guard BEFORE INSERT OR UPDATE ON whatsapp_connection_group_access FOR EACH ROW EXECUTE FUNCTION guard_whatsapp_group_access_tenant();
