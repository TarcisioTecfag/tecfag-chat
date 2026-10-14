CREATE TABLE IF NOT EXISTS rd_marketing_journey_links (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  connection_version text NOT NULL,
  rd_uuid text NOT NULL,
  snapshot_id text NOT NULL,
  synced_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rd_journey_contact ON rd_marketing_journey_links(tenant_id, contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rd_journey_uuid ON rd_marketing_journey_links(tenant_id, connection_version, rd_uuid);
CREATE TABLE IF NOT EXISTS rd_marketing_journey_pages (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  link_id text NOT NULL REFERENCES rd_marketing_journey_links(id) ON DELETE CASCADE,
  snapshot_id text NOT NULL,
  event_type text NOT NULL,
  page integer NOT NULL,
  data jsonb NOT NULL,
  synced_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rd_journey_page ON rd_marketing_journey_pages(tenant_id, link_id, snapshot_id, event_type, page);
