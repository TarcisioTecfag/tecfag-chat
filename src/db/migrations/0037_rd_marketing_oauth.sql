CREATE TABLE IF NOT EXISTS rd_marketing_connections (
  tenant_id text PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  client_secret_encrypted text NOT NULL,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamp,
  version text NOT NULL,
  connected_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rd_marketing_oauth_states (
  state_hash text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_id text NOT NULL,
  session_hash text NOT NULL,
  connection_version text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rd_marketing_oauth_states_tenant_expiry
  ON rd_marketing_oauth_states(tenant_id, expires_at);
