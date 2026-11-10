-- Persistência durável em banco (em blocos de até 2MB) para binários de arquivos e mídias anexados no CRM.
-- Impede a perda de fotos, vídeos e documentos em cards e anotações quando o container do Railway é recriado.

CREATE TABLE IF NOT EXISTS crm_deal_file_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES crm_deal_files(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_base64 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_deal_file_chunks_file_idx
  ON crm_deal_file_chunks(file_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_crm_deal_file_chunks_tenant_file
  ON crm_deal_file_chunks(tenant_id, file_id);
