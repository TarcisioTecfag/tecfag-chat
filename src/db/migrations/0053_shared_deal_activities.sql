-- Suporte a múltiplos responsáveis compartilhados em uma única tarefa (crm_deal_activities)
ALTER TABLE crm_deal_activities
  ADD COLUMN IF NOT EXISTS assigned_to_operator_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill de registros existentes com 1 responsável
UPDATE crm_deal_activities
SET assigned_to_operator_ids = jsonb_build_array(assigned_to_operator_id)
WHERE assigned_to_operator_id IS NOT NULL
  AND (assigned_to_operator_ids IS NULL OR assigned_to_operator_ids = '[]'::jsonb);

-- Unificação retroativa de tarefas pendentes duplicadas pelo loop antigo de múltiplos responsáveis
WITH duplicate_groups AS (
  SELECT
    a.id AS primary_id,
    b.id AS duplicate_id,
    b.assigned_to_operator_id AS extra_operator_id
  FROM crm_deal_activities a
  JOIN crm_deal_activities b
    ON a.tenant_id = b.tenant_id
   AND a.deal_id = b.deal_id
   AND a.title = b.title
   AND a.type = b.type
   AND COALESCE(a.description, '') = COALESCE(b.description, '')
   AND a.status = 'pending'
   AND b.status = 'pending'
   AND a.type <> 'note'
   AND COALESCE(a.operator_id, '') = COALESCE(b.operator_id, '')
   AND a.due_date IS NOT DISTINCT FROM b.due_date
   AND ABS(EXTRACT(EPOCH FROM (a.created_at - b.created_at))) <= 10
   AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id))
  WHERE NOT EXISTS (
    SELECT 1
    FROM crm_deal_activities earlier
    WHERE earlier.tenant_id = a.tenant_id
      AND earlier.deal_id = a.deal_id
      AND earlier.title = a.title
      AND earlier.type = a.type
      AND COALESCE(earlier.description, '') = COALESCE(a.description, '')
      AND earlier.status = 'pending'
      AND earlier.type <> 'note'
      AND COALESCE(earlier.operator_id, '') = COALESCE(a.operator_id, '')
      AND earlier.due_date IS NOT DISTINCT FROM a.due_date
      AND ABS(EXTRACT(EPOCH FROM (earlier.created_at - a.created_at))) <= 10
      AND (earlier.created_at < a.created_at OR (earlier.created_at = a.created_at AND earlier.id < a.id))
  )
),
merged_assignees AS (
  SELECT
    dg.primary_id,
    (
      SELECT jsonb_agg(op_id)
      FROM (
        SELECT DISTINCT op_id
        FROM (
          SELECT jsonb_array_elements_text(p.assigned_to_operator_ids) AS op_id
          FROM crm_deal_activities p
          WHERE p.id = dg.primary_id
          UNION ALL
          SELECT p.assigned_to_operator_id AS op_id
          FROM crm_deal_activities p
          WHERE p.id = dg.primary_id AND p.assigned_to_operator_id IS NOT NULL
          UNION ALL
          SELECT dg2.extra_operator_id AS op_id
          FROM duplicate_groups dg2
          WHERE dg2.primary_id = dg.primary_id AND dg2.extra_operator_id IS NOT NULL
        ) all_ops
        WHERE op_id IS NOT NULL AND op_id <> ''
      ) distinct_ops
    ) AS combined_ids
  FROM (SELECT DISTINCT primary_id FROM duplicate_groups) dg
),
updated_primaries AS (
  UPDATE crm_deal_activities target
  SET assigned_to_operator_ids = COALESCE(ma.combined_ids, target.assigned_to_operator_ids),
      updated_at = NOW()
  FROM merged_assignees ma
  WHERE target.id = ma.primary_id
  RETURNING target.id
)
DELETE FROM crm_deal_activities d
USING duplicate_groups dg
WHERE d.id = dg.duplicate_id;
