-- 0068: Tabela dedicada de logs de auditoria do Conector MCP (remove contenção de lock serial em agent_configs)

CREATE TABLE IF NOT EXISTS mcp_audit_logs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_id text NOT NULL DEFAULT 'primary',
  key_label text NOT NULL DEFAULT 'Link Principal',
  tool_name text NOT NULL,
  tool_label text NOT NULL,
  arguments_summary text NOT NULL DEFAULT '',
  arguments_raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'success',
  latency_ms integer NOT NULL DEFAULT 0,
  event_type text NOT NULL DEFAULT 'query',
  transport text,
  client_name text,
  client_ip text,
  response_bytes integer,
  response_preview text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_tenant_created
  ON mcp_audit_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_tenant_key_created
  ON mcp_audit_logs (tenant_id, key_id, created_at DESC);
