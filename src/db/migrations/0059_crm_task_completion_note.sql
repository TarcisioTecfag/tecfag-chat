-- Migration 0059: Observação / anotação opcional registrada ao finalizar tarefa comercial no CRM
ALTER TABLE crm_deal_activities
  ADD COLUMN IF NOT EXISTS completion_note TEXT;
