CREATE TABLE IF NOT EXISTS operator_onboarding (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_id text NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  tour_key text NOT NULL DEFAULT 'operator_fagner_v1',
  content_version integer NOT NULL DEFAULT 1,
  run_id text NOT NULL,
  status text NOT NULL DEFAULT 'not_started',
  current_step_id text,
  visited_step_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_step_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  unavailable_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamp,
  paused_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  last_completed_version integer,
  last_completed_at timestamp,
  deferred_until timestamp,
  revision integer NOT NULL DEFAULT 1,
  CONSTRAINT operator_onboarding_status_check CHECK (
    status IN ('not_started', 'in_progress', 'paused', 'completed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_onboarding_tenant_operator_tour
  ON operator_onboarding(tenant_id, operator_id, tour_key);

CREATE INDEX IF NOT EXISTS idx_operator_onboarding_tenant_status
  ON operator_onboarding(tenant_id, status);
