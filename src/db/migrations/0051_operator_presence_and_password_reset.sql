-- Migração 0051: Telemetria de presença diária, visto por último e redefinição obrigatória de senha em operators
ALTER TABLE operators ADD COLUMN IF NOT EXISTS last_seen_at timestamp;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS usage_date text;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS usage_seconds_today integer NOT NULL DEFAULT 0;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Backfill de last_seen_at a partir de sessões, onboarding e eventos de atendimento existentes
WITH activity AS (
  SELECT
    o.id AS operator_id,
    o.tenant_id,
    GREATEST(
      (SELECT MAX(s.created_at) FROM auth_sessions s WHERE s.operator_id = o.id AND s.tenant_id = o.tenant_id),
      (SELECT MAX(ob.updated_at) FROM operator_onboarding ob WHERE ob.operator_id = o.id AND ob.tenant_id = o.tenant_id),
      (SELECT MAX(ae.created_at) FROM attendance_events ae WHERE ae.operator_id = o.id AND ae.tenant_id = o.tenant_id)
    ) AS last_activity_at
  FROM operators o
)
UPDATE operators o
SET
  last_seen_at = COALESCE(o.last_seen_at, a.last_activity_at),
  is_online = CASE
    WHEN a.last_activity_at IS NOT NULL AND a.last_activity_at >= (NOW() - INTERVAL '5 minutes') THEN true
    ELSE false
  END
FROM activity a
WHERE o.id = a.operator_id
  AND o.tenant_id = a.tenant_id;
