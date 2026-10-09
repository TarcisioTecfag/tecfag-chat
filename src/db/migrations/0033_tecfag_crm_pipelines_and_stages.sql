-- ============================================================================
-- 0033_tecfag_crm_pipelines_and_stages.sql
-- Criação estruturada, adaptativa e idempotente dos funis e etapas da Tecfag.
--
-- 1. Remove qualquer funil temporário vazio ('Funil Teste').
-- 2. Detecta funis existentes por nome/slug (preserva IDs e negociações pré-existentes).
-- 3. Atualiza ou insere com consistência os 8 funis corporativos da Tecfag:
--    • FUNIL MÁQUINAS 2.0 (Equipe Máquinas / Default)
--    • FUNIL PERSONNALITÉ (Equipe Personnalité)
--    • FUNIL SDR
--    • FUNIL PEÇAS (Novo)
--    • FUNIL PROJETOS (Novo)
--    • FUNIL SUPORTE TÉCNICO (Novo)
--    • FUNIL FINANCEIRO
--    • FUNIL EXTERNO 2.0
-- 4. Sincroniza todas as etapas na ordem exata solicitada.
-- 5. Configura crm_stage_settings (estagnação/cooling de 10 dias).
-- 6. Mapeia divisões no commercial_settings.
-- ============================================================================

DO $$
DECLARE
  v_maq_id text;
  v_pers_id text;
  v_sdr_id text;
  v_pecas_id text;
  v_proj_id text;
  v_sup_id text;
  v_fin_id text;
  v_ext_id text;

  v_stage_names text[];
  v_stage_ids   text[];
  i int;
BEGIN
  -- 1. Remove qualquer funil de teste vazio (sem negociações associadas)
  DELETE FROM crm_pipelines
  WHERE tenant_id = 'tecfag'
    AND (LOWER(name) LIKE '%teste%')
    AND id NOT IN (SELECT DISTINCT pipeline_id FROM crm_deals WHERE pipeline_id IS NOT NULL);

  -- 2. FUNIL MÁQUINAS 2.0
  SELECT id INTO v_maq_id FROM crm_pipelines
  WHERE tenant_id = 'tecfag' AND (LOWER(name) = 'máquinas' OR LOWER(name) = 'maquinas' OR LOWER(name) LIKE '%máquinas 2.0%' OR LOWER(name) LIKE '%maquinas 2.0%')
  LIMIT 1;

  IF v_maq_id IS NOT NULL THEN
    UPDATE crm_pipelines
    SET name = 'FUNIL MÁQUINAS 2.0', order_index = 0, is_default = true, color = '#0284c7', updated_at = NOW()
    WHERE id = v_maq_id;
  ELSE
    v_maq_id := 'pipe-tecfag-maquinas-2-0';
    INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at)
    VALUES (v_maq_id, 'tecfag', 'FUNIL MÁQUINAS 2.0', 0, true, '#0284c7', 10, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_default = true, order_index = 0;
  END IF;

  -- 3. FUNIL PERSONNALITÉ
  SELECT id INTO v_pers_id FROM crm_pipelines
  WHERE tenant_id = 'tecfag' AND (LOWER(name) LIKE '%personnalit%')
  LIMIT 1;

  IF v_pers_id IS NOT NULL THEN
    UPDATE crm_pipelines
    SET name = 'FUNIL PERSONNALITÉ', order_index = 1, is_default = false, color = '#ec4899', updated_at = NOW()
    WHERE id = v_pers_id;
  ELSE
    v_pers_id := 'pipe-tecfag-personnalite';
    INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at)
    VALUES (v_pers_id, 'tecfag', 'FUNIL PERSONNALITÉ', 1, false, '#ec4899', 10, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_index = 1;
  END IF;

  -- 4. FUNIL SDR
  SELECT id INTO v_sdr_id FROM crm_pipelines
  WHERE tenant_id = 'tecfag' AND (LOWER(name) = 'sdr' OR LOWER(name) LIKE '%funil sdr%')
  LIMIT 1;

  IF v_sdr_id IS NOT NULL THEN
    UPDATE crm_pipelines
    SET name = 'FUNIL SDR', order_index = 2, is_default = false, color = '#f97316', updated_at = NOW()
    WHERE id = v_sdr_id;
  ELSE
    v_sdr_id := 'pipe-tecfag-sdr';
    INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at)
    VALUES (v_sdr_id, 'tecfag', 'FUNIL SDR', 2, false, '#f97316', 10, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_index = 2;
  END IF;

  -- 5. FUNIL PEÇAS
  SELECT id INTO v_pecas_id FROM crm_pipelines
  WHERE tenant_id = 'tecfag' AND (LOWER(name) = 'peças' OR LOWER(name) = 'pecas' OR LOWER(name) LIKE '%funil peças%' OR LOWER(name) LIKE '%funil pecas%')
  LIMIT 1;

  IF v_pecas_id IS NOT NULL THEN
    UPDATE crm_pipelines
    SET name = 'FUNIL PEÇAS', order_index = 3, is_default = false, color = '#f59e0b', updated_at = NOW()
    WHERE id = v_pecas_id;
  ELSE
    v_pecas_id := 'pipe-tecfag-pecas';
    INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at)
    VALUES (v_pecas_id, 'tecfag', 'FUNIL PEÇAS', 3, false, '#f59e0b', 10, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_index = 3;
  END IF;

  -- 6. FUNIL PROJETOS
  SELECT id INTO v_proj_id FROM crm_pipelines
  WHERE tenant_id = 'tecfag' AND (LOWER(name) = 'projetos' OR LOWER(name) LIKE '%funil projetos%')
  LIMIT 1;

  IF v_proj_id IS NOT NULL THEN
    UPDATE crm_pipelines
    SET name = 'FUNIL PROJETOS', order_index = 4, is_default = false, color = '#8b5cf6', updated_at = NOW()
    WHERE id = v_proj_id;
  ELSE
    v_proj_id := 'pipe-tecfag-projetos';
    INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at)
    VALUES (v_proj_id, 'tecfag', 'FUNIL PROJETOS', 4, false, '#8b5cf6', 10, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_index = 4;
  END IF;

  -- 7. FUNIL SUPORTE TÉCNICO
  SELECT id INTO v_sup_id FROM crm_pipelines
  WHERE tenant_id = 'tecfag' AND (LOWER(name) LIKE '%suporte%')
  LIMIT 1;

  IF v_sup_id IS NOT NULL THEN
    UPDATE crm_pipelines
    SET name = 'FUNIL SUPORTE TÉCNICO', order_index = 5, is_default = false, color = '#10b981', updated_at = NOW()
    WHERE id = v_sup_id;
  ELSE
    v_sup_id := 'pipe-tecfag-suporte-tecnico';
    INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at)
    VALUES (v_sup_id, 'tecfag', 'FUNIL SUPORTE TÉCNICO', 5, false, '#10b981', 10, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_index = 5;
  END IF;

  -- 8. FUNIL FINANCEIRO
  SELECT id INTO v_fin_id FROM crm_pipelines
  WHERE tenant_id = 'tecfag' AND (LOWER(name) LIKE '%financeiro%')
  LIMIT 1;

  IF v_fin_id IS NOT NULL THEN
    UPDATE crm_pipelines
    SET name = 'FUNIL FINANCEIRO', order_index = 6, is_default = false, color = '#0d9488', updated_at = NOW()
    WHERE id = v_fin_id;
  ELSE
    v_fin_id := 'pipe-tecfag-financeiro';
    INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at)
    VALUES (v_fin_id, 'tecfag', 'FUNIL FINANCEIRO', 6, false, '#0d9488', 10, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_index = 6;
  END IF;

  -- 9. FUNIL EXTERNO 2.0
  SELECT id INTO v_ext_id FROM crm_pipelines
  WHERE tenant_id = 'tecfag' AND (LOWER(name) LIKE '%externo%')
  LIMIT 1;

  IF v_ext_id IS NOT NULL THEN
    UPDATE crm_pipelines
    SET name = 'FUNIL EXTERNO 2.0', order_index = 7, is_default = false, color = '#6366f1', updated_at = NOW()
    WHERE id = v_ext_id;
  ELSE
    v_ext_id := 'pipe-tecfag-externo-2-0';
    INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at)
    VALUES (v_ext_id, 'tecfag', 'FUNIL EXTERNO 2.0', 7, false, '#6366f1', 10, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_index = 7;
  END IF;

  -- Garante que apenas MÁQUINAS 2.0 seja is_default
  UPDATE crm_pipelines
  SET is_default = false
  WHERE tenant_id = 'tecfag' AND id <> v_maq_id AND is_default = true;

  -- ==========================================================================
  -- SINCRONIZAÇÃO DE ETAPAS
  -- ==========================================================================

  -- FUNIL PEÇAS (7 etapas)
  v_stage_names := ARRAY['LEADS RECEBIDOS', 'ABORDAGEM COMERCIAL', 'PENDÊNCIA TÉCNICA', 'PROPOSTA ENVIADA', 'AGUARDANDO IMPORTAÇÃO', 'FECHAMENTO', 'REQUALIFICAÇÃO'];
  v_stage_ids   := ARRAY['stg-tf-pecas-leads-recebidos', 'stg-tf-pecas-abordagem-comercial', 'stg-tf-pecas-pendencia-tecnica', 'stg-tf-pecas-proposta-enviada', 'stg-tf-pecas-aguardando-importacao', 'stg-tf-pecas-fechamento', 'stg-tf-pecas-requalificacao'];
  FOR i IN 1..array_length(v_stage_names, 1) LOOP
    UPDATE crm_stages SET order_index = i - 1, name = v_stage_names[i], updated_at = NOW()
    WHERE pipeline_id = v_pecas_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_stage_names[i]));
    IF NOT FOUND THEN
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at)
      VALUES (v_stage_ids[i], 'tecfag', v_pecas_id, v_stage_names[i], i - 1, false, false, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name, order_index = EXCLUDED.order_index;
    END IF;
  END LOOP;

  -- FUNIL PROJETOS (10 etapas)
  v_stage_names := ARRAY['ABORDAGEM', 'DEFINIÇÃO DO ESCOPO', 'ESCOPO CONCLUIDO', 'ESCOPO APRESENTADO', 'ESCOPO APROVADO', 'DESENVOLVIMENTO', 'ATRIBUIÇÃO DE VALOR', 'PROPOSTA ENVIADA', 'FECHAMENTO', 'REQUALIFICAÇÃO'];
  v_stage_ids   := ARRAY['stg-tf-proj-abordagem', 'stg-tf-proj-definicao-escopo', 'stg-tf-proj-escopo-concluido', 'stg-tf-proj-escopo-apresentado', 'stg-tf-proj-escopo-aprovado', 'stg-tf-proj-desenvolvimento', 'stg-tf-proj-atribuicao-valor', 'stg-tf-proj-proposta-enviada', 'stg-tf-proj-fechamento', 'stg-tf-proj-requalificacao'];
  FOR i IN 1..array_length(v_stage_names, 1) LOOP
    UPDATE crm_stages SET order_index = i - 1, name = v_stage_names[i], updated_at = NOW()
    WHERE pipeline_id = v_proj_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_stage_names[i]));
    IF NOT FOUND THEN
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at)
      VALUES (v_stage_ids[i], 'tecfag', v_proj_id, v_stage_names[i], i - 1, false, false, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name, order_index = EXCLUDED.order_index;
    END IF;
  END LOOP;

  -- FUNIL SUPORTE TÉCNICO (12 etapas)
  v_stage_names := ARRAY['TRIAGEM', 'TROCA EM GARANTIA', 'SUPORTE', 'REMESSA DE CONSERTO', 'RASTREIO', 'NÃO CONFORME - FRETE', 'SIMPLES FATURAMENTO', 'NÃO CONFORME - DEVOLUÇÃO', 'ASSISTÊNCIA TÉCNICA', 'VIDEO CHAMADA', 'DEVOLUÇÃO', 'FINALIZADOS'];
  v_stage_ids   := ARRAY['stg-tf-sup-triagem', 'stg-tf-sup-troca-em-garantia', 'stg-tf-sup-suporte', 'stg-tf-sup-remessa-conserto', 'stg-tf-sup-rastreio', 'stg-tf-sup-nao-conforme-frete', 'stg-tf-sup-simples-faturamento', 'stg-tf-sup-nao-conforme-devolucao', 'stg-tf-sup-assistencia-tecnica', 'stg-tf-sup-video-chamada', 'stg-tf-sup-devolucao', 'stg-tf-sup-finalizados'];
  FOR i IN 1..array_length(v_stage_names, 1) LOOP
    UPDATE crm_stages SET order_index = i - 1, name = v_stage_names[i], updated_at = NOW()
    WHERE pipeline_id = v_sup_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_stage_names[i]));
    IF NOT FOUND THEN
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at)
      VALUES (v_stage_ids[i], 'tecfag', v_sup_id, v_stage_names[i], i - 1, false, false, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name, order_index = EXCLUDED.order_index;
    END IF;
  END LOOP;

  -- FUNIL MÁQUINAS 2.0 (7 etapas)
  v_stage_names := ARRAY['LEADS RECEBIDOS', 'ABORDAGEM COMERCIAL', 'ESFRIANDO', 'QUALIFICADO', 'PROPOSTA ENVIADA', 'FECHAMENTO', 'REQUALIFICAÇÃO'];
  v_stage_ids   := ARRAY['stg-tf-maq-leads-recebidos', 'stg-tf-maq-abordagem-comercial', 'stg-tf-maq-esfriando', 'stg-tf-maq-qualificado', 'stg-tf-maq-proposta-enviada', 'stg-tf-maq-fechamento', 'stg-tf-maq-requalificacao'];
  FOR i IN 1..array_length(v_stage_names, 1) LOOP
    UPDATE crm_stages SET order_index = i - 1, name = v_stage_names[i], updated_at = NOW()
    WHERE pipeline_id = v_maq_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_stage_names[i]));
    IF NOT FOUND THEN
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at)
      VALUES (v_stage_ids[i], 'tecfag', v_maq_id, v_stage_names[i], i - 1, false, false, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name, order_index = EXCLUDED.order_index;
    END IF;
  END LOOP;

  -- FUNIL PERSONNALITÉ (7 etapas)
  v_stage_names := ARRAY['LEADS RECEBIDOS', 'ABORDAGEM COMERCIAL', 'ESFRIANDO', 'QUALIFICADO', 'PROPOSTA ENVIADA', 'FECHAMENTO', 'REQUALIFICAÇÃO'];
  v_stage_ids   := ARRAY['stg-tf-pers-leads-recebidos', 'stg-tf-pers-abordagem-comercial', 'stg-tf-pers-esfriando', 'stg-tf-pers-qualificado', 'stg-tf-pers-proposta-enviada', 'stg-tf-pers-fechamento', 'stg-tf-pers-requalificacao'];
  FOR i IN 1..array_length(v_stage_names, 1) LOOP
    UPDATE crm_stages SET order_index = i - 1, name = v_stage_names[i], updated_at = NOW()
    WHERE pipeline_id = v_pers_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_stage_names[i]));
    IF NOT FOUND THEN
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at)
      VALUES (v_stage_ids[i], 'tecfag', v_pers_id, v_stage_names[i], i - 1, false, false, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name, order_index = EXCLUDED.order_index;
    END IF;
  END LOOP;

  -- FUNIL SDR (7 etapas)
  v_stage_names := ARRAY['PARA TRIAR', 'EM TRIAGEM', 'PARA ANÁLISE', 'SEM RESPOSTA', 'ATIVOS', 'DESQUALIFICADO', 'REQUALIFICAÇÃO'];
  v_stage_ids   := ARRAY['stg-tf-sdr-para-triar', 'stg-tf-sdr-em-triagem', 'stg-tf-sdr-para-analise', 'stg-tf-sdr-sem-resposta', 'stg-tf-sdr-ativos', 'stg-tf-sdr-desqualificado', 'stg-tf-sdr-requalificacao'];
  FOR i IN 1..array_length(v_stage_names, 1) LOOP
    UPDATE crm_stages SET order_index = i - 1, name = v_stage_names[i], updated_at = NOW()
    WHERE pipeline_id = v_sdr_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_stage_names[i]));
    IF NOT FOUND THEN
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at)
      VALUES (v_stage_ids[i], 'tecfag', v_sdr_id, v_stage_names[i], i - 1, false, false, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name, order_index = EXCLUDED.order_index;
    END IF;
  END LOOP;

  -- FUNIL FINANCEIRO (6 etapas)
  v_stage_names := ARRAY['CONTATO', 'COBRANÇA', 'PROPOSTA', 'NEGATIVAÇÃO', 'LIQUIDAÇÃO', 'FINALIZADOS'];
  v_stage_ids   := ARRAY['stg-tf-fin-contato', 'stg-tf-fin-cobranca', 'stg-tf-fin-proposta', 'stg-tf-fin-negativacao', 'stg-tf-fin-liquidacao', 'stg-tf-fin-finalizados'];
  FOR i IN 1..array_length(v_stage_names, 1) LOOP
    UPDATE crm_stages SET order_index = i - 1, name = v_stage_names[i], updated_at = NOW()
    WHERE pipeline_id = v_fin_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_stage_names[i]));
    IF NOT FOUND THEN
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at)
      VALUES (v_stage_ids[i], 'tecfag', v_fin_id, v_stage_names[i], i - 1, false, false, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name, order_index = EXCLUDED.order_index;
    END IF;
  END LOOP;

  -- FUNIL EXTERNO 2.0 (3 etapas)
  v_stage_names := ARRAY['PROSPECÇÃO REMOTA', 'PROSPECÇÃO IN LOCO', 'VISITA CONSULTIVA'];
  v_stage_ids   := ARRAY['stg-tf-ext-prospeccao-remota', 'stg-tf-ext-prospeccao-in-loco', 'stg-tf-ext-visita-consultiva'];
  FOR i IN 1..array_length(v_stage_names, 1) LOOP
    UPDATE crm_stages SET order_index = i - 1, name = v_stage_names[i], updated_at = NOW()
    WHERE pipeline_id = v_ext_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_stage_names[i]));
    IF NOT FOUND THEN
      INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at)
      VALUES (v_stage_ids[i], 'tecfag', v_ext_id, v_stage_names[i], i - 1, false, false, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name, order_index = EXCLUDED.order_index;
    END IF;
  END LOOP;

  -- Inserção de crm_stage_settings
  INSERT INTO crm_stage_settings (stage_id, tenant_id, cooling_enabled, cooling_days, updated_at)
  SELECT id, tenant_id, true, 10, NOW()
  FROM crm_stages
  WHERE tenant_id = 'tecfag'
  ON CONFLICT (stage_id) DO NOTHING;

  -- Vinculação no CommercialSettings
  INSERT INTO commercial_settings (tenant_id, pipeline_by_division, updated_at)
  VALUES (
    'tecfag',
    jsonb_build_object('personnalite', v_pers_id, 'maquinas', v_maq_id),
    NOW()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    pipeline_by_division = jsonb_set(
      jsonb_set(
        COALESCE(commercial_settings.pipeline_by_division, '{}'::jsonb),
        '{maquinas}',
        to_jsonb(v_maq_id)
      ),
      '{personnalite}',
      to_jsonb(v_pers_id)
    ),
    updated_at = NOW();

END $$;
