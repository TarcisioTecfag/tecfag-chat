-- Índices B-Tree para Base de Conhecimento (Catálogo de Imagens / RAG) e Arquivos de Mídia do Chat
-- Elimina Sequential Scans nas 447+ imagens do catálogo e na deduplicação de mídias

CREATE INDEX IF NOT EXISTS idx_knowledge_folders_tenant
  ON knowledge_folders (tenant_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_files_tenant_folder
  ON knowledge_files (tenant_id, folder_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_files_tenant_name
  ON knowledge_files (tenant_id, name);

CREATE INDEX IF NOT EXISTS idx_knowledge_files_tenant_format
  ON knowledge_files (tenant_id, format);

CREATE INDEX IF NOT EXISTS idx_media_files_tenant_conv
  ON media_files (tenant_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_media_files_tenant_name_size
  ON media_files (tenant_id, file_name, file_size);
