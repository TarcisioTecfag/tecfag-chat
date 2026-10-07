-- Fundação aditiva do Commercial War Room. Nenhum tenant recebe dados ou configuração automaticamente.
CREATE TABLE IF NOT EXISTS commercial_consultant_profiles (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_id text NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  division text CHECK (division IS NULL OR division IN ('personnalite', 'maquinas')),
  active_on_tv boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_profiles_tenant_operator ON commercial_consultant_profiles (tenant_id, operator_id);
CREATE INDEX IF NOT EXISTS idx_commercial_profiles_tenant_division ON commercial_consultant_profiles (tenant_id, division);

CREATE TABLE IF NOT EXISTS commercial_goals (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  operator_id text NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  target_value numeric(15,2) NOT NULL DEFAULT 0 CHECK (target_value >= 0),
  conversion_rate numeric(5,2) NOT NULL DEFAULT 10 CHECK (conversion_rate >= 0 AND conversion_rate <= 100),
  created_by_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_goals_tenant_month_operator ON commercial_goals (tenant_id, month, operator_id);

CREATE TABLE IF NOT EXISTS commercial_calendar_days (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date text NOT NULL CHECK (date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  type text NOT NULL CHECK (type IN ('holiday', 'bridge', 'extra_work', 'suspension')),
  scope text NOT NULL DEFAULT 'internal',
  description text NOT NULL,
  affects_goal boolean NOT NULL DEFAULT true,
  created_by_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_calendar_tenant_date ON commercial_calendar_days (tenant_id, date);

CREATE TABLE IF NOT EXISTS commercial_directives (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id text NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  assigned_to_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  assigned_by_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  assigned_date text NOT NULL CHECK (assigned_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  due_at timestamp,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),
  instruction text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  completion_note text,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_directives_tenant_deal_date ON commercial_directives (tenant_id, deal_id, assigned_date);
CREATE INDEX IF NOT EXISTS idx_commercial_directives_tenant_assignee_date ON commercial_directives (tenant_id, assigned_to_operator_id, assigned_date);

CREATE TABLE IF NOT EXISTS commercial_evidence (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  directive_id text NOT NULL REFERENCES commercial_directives(id) ON DELETE RESTRICT,
  deal_id text NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('call', 'whatsapp', 'email')),
  source text NOT NULL CHECK (source IN ('internal_record', 'manual_report')),
  status text NOT NULL DEFAULT 'completed',
  summary text,
  email_content text,
  call_id text,
  email_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commercial_evidence_tenant_directive ON commercial_evidence (tenant_id, directive_id);
CREATE INDEX IF NOT EXISTS idx_commercial_evidence_tenant_deal ON commercial_evidence (tenant_id, deal_id);

CREATE TABLE IF NOT EXISTS commercial_evidence_messages (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evidence_id text NOT NULL REFERENCES commercial_evidence(id) ON DELETE CASCADE,
  message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_evidence_message_unique ON commercial_evidence_messages (tenant_id, evidence_id, message_id);

CREATE TABLE IF NOT EXISTS commercial_settings (
  tenant_id text PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  maturity_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_stage_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  sla_limit_minutes integer NOT NULL DEFAULT 15 CHECK (sla_limit_minutes > 0),
  sla_buckets jsonb NOT NULL DEFAULT '[5,15,30]'::jsonb,
  tv_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE commercial_settings ADD COLUMN IF NOT EXISTS excluded_stage_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS commercial_transfer_response_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  transferred_at timestamp NOT NULL,
  first_response_message_id text REFERENCES messages(id) ON DELETE SET NULL,
  first_responded_at timestamp,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'responded', 'cancelled')),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commercial_transfer_tenant_operator_at ON commercial_transfer_response_events (tenant_id, operator_id, transferred_at);
CREATE INDEX IF NOT EXISTS idx_commercial_transfer_tenant_conversation_status ON commercial_transfer_response_events (tenant_id, conversation_id, status);
