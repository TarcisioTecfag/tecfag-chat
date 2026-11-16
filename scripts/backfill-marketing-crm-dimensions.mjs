import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

/**
 * Backfill idempotente e determinístico das dimensões de Marketing × CRM:
 * - Preservação 100% de `rd_deal_id` e `rd_deal_url` em cards migrados (`deal-rd-*`)
 * - Renomeação do funil de arquivo histórico (`pipe-tecfag-testes` -> `ARQUIVO HISTÓRICO (RD)`)
 *   e criação do funil isolado `FUNIL DE TESTES` (`pipe-tecfag-funil-testes`) no tenant `tecfag`
 * - Marcação de `is_legacy` e `is_test` em `crm_deals` e `contacts`
 * - Separação entre `entry_channel` (canal técnico) e `source` (`deal_source_name` de mídia)
 * - Herança de primeiro toque (`first_source`, `first_campaign`) em `contacts` e deals sem fonte
 * - Preenchimento de `original_pipeline_id`, `sector_current` e `sector_origin` (travado no 1º setor comercial)
 * - Preenchimento de `won_at` (incluindo FECHAMENTO / VENDA CONCLUÍDA abertos) e `lost_at`
 */
export async function runMarketingCrmDimensionsBackfill(sql) {
  return await sql.begin(async (tx) => {
    // 1. Garantia de rd_deal_id e rd_deal_url em cards migrados do RD CRM
    const rdIdRes = await tx`
      UPDATE crm_deals
      SET
        rd_deal_id = COALESCE(rd_deal_id, SUBSTRING(id FROM 9)),
        rd_deal_url = COALESCE(rd_deal_url, 'https://crm.rdstation.com/app/deals/' || SUBSTRING(id FROM 9))
      WHERE id LIKE 'deal-rd-%'
        AND (rd_deal_id IS NULL OR rd_deal_url IS NULL)
    `;

    // 2. Governança de Funil Histórico vs. Funil de Testes real no tenant tecfag
    const [tecfagTenant] = await tx`SELECT id FROM tenants WHERE id = 'tecfag' LIMIT 1`;
    let renamedArchivePipeline = 0;
    if (tecfagTenant) {
      const renameRes = await tx`
        UPDATE crm_pipelines
        SET
          name = 'ARQUIVO HISTÓRICO (RD)',
          updated_at = NOW()
        WHERE tenant_id = 'tecfag'
          AND id = 'pipe-tecfag-testes'
          AND name != 'ARQUIVO HISTÓRICO (RD)'
      `;
      renamedArchivePipeline = renameRes.count ?? 0;

      await tx`
        INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at)
        VALUES (
          'pipe-tecfag-funil-testes',
          'tecfag',
          'FUNIL DE TESTES',
          99,
          false,
          '#64748b',
          30,
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          updated_at = NOW()
      `;

      await tx`
        INSERT INTO crm_stages (
          id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, created_at, updated_at
        )
        VALUES (
          'stg-tf-funil-testes-triagem',
          'tecfag',
          'pipe-tecfag-funil-testes',
          'TESTES',
          0,
          false,
          false,
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // 3. Flag is_legacy em cards do arquivo histórico do RD
    const legacyDealsRes = await tx`
      UPDATE crm_deals
      SET is_legacy = true
      WHERE is_legacy = false
        AND (
          pipeline_id = 'pipe-tecfag-testes'
          OR stage_id = 'stg-tf-testes-anteriores'
          OR (custom_fields IS NOT NULL AND (custom_fields ? 'funil_original_rd'))
        )
    `;

    // 4. Flag is_test em cards de funil de testes ou com palavra isolada TESTE/TESTES no título
    const testDealsRes = await tx`
      UPDATE crm_deals d
      SET is_test = true
      FROM crm_pipelines p
      WHERE p.tenant_id = d.tenant_id
        AND p.id = d.pipeline_id
        AND d.is_test = false
        AND (
          d.pipeline_id = 'pipe-tecfag-funil-testes'
          OR (
            d.pipeline_id != 'pipe-tecfag-testes'
            AND p.name ~* 'teste'
            AND p.name !~* '(arquivo|hist[oó]rico)'
          )
          OR d.title ~* '(^|[^a-zA-ZÀ-ÿ0-9])testes?($|[^a-zA-ZÀ-ÿ0-9])'
        )
    `;

    // 5. Separação de entry_channel vs. source operacional ('manual', 'chat', 'whatsapp', 'WhatsApp SDR...')
    await tx`
      UPDATE crm_deals
      SET entry_channel = 'import_rd'
      WHERE id LIKE 'deal-rd-%'
        AND entry_channel IS NULL
    `;

    const cleanOperationalSourceRes = await tx`
      UPDATE crm_deals
      SET
        entry_channel = COALESCE(
          entry_channel,
          CASE
            WHEN source ~* '^whatsapp sdr' OR lower(btrim(source)) = 'auto_sdr' THEN 'whatsapp_sdr'
            WHEN lower(btrim(source)) IN ('whatsapp', 'chat') THEN 'whatsapp'
            WHEN lower(btrim(source)) IN ('manual', 'crm') THEN 'manual'
            WHEN lower(btrim(source)) = 'rd station marketing' THEN 'rd_webhook'
            ELSE 'manual'
          END
        ),
        source = NULL
      WHERE source IS NOT NULL
        AND (
          lower(btrim(source)) IN (
            'manual', 'chat', 'whatsapp', 'auto_sdr', 'crm', 'import_rd',
            'rd station marketing', 'nao informada', 'não informada', 'desconhecido', '-'
          )
          OR source ~* '^whatsapp sdr'
        )
        AND id NOT LIKE 'deal-rd-%'
    `;

    // 6. Backfill de primeiro toque em contacts (first_source, first_campaign) a partir do 1º deal válido do contato
    const contactFirstTouchRes = await tx`
      WITH earliest_valid_deal AS (
        SELECT DISTINCT ON (dc.tenant_id, dc.contact_id)
          dc.tenant_id,
          dc.contact_id,
          d.source,
          d.campaign,
          d.utm_source,
          d.utm_medium,
          d.utm_campaign,
          d.utm_content,
          d.utm_term,
          d.click_id,
          d.landing_page
        FROM crm_deal_contacts dc
        JOIN crm_deals d
          ON d.tenant_id = dc.tenant_id
         AND d.id = dc.deal_id
        WHERE d.is_test = false
          AND d.source IS NOT NULL
          AND btrim(d.source) != ''
          AND lower(btrim(d.source)) NOT IN (
            'desconhecido', 'nao informada', 'não informada', 'manual', 'chat', 'whatsapp', '-'
          )
        ORDER BY dc.tenant_id, dc.contact_id, d.created_at ASC
      )
      UPDATE contacts c
      SET
        first_source = COALESCE(c.first_source, evd.source),
        first_campaign = COALESCE(c.first_campaign, evd.campaign),
        utm_source = COALESCE(c.utm_source, evd.utm_source),
        utm_medium = COALESCE(c.utm_medium, evd.utm_medium),
        utm_campaign = COALESCE(c.utm_campaign, evd.utm_campaign),
        utm_content = COALESCE(c.utm_content, evd.utm_content),
        utm_term = COALESCE(c.utm_term, evd.utm_term),
        click_id = COALESCE(c.click_id, evd.click_id),
        landing_page = COALESCE(c.landing_page, evd.landing_page)
      FROM earliest_valid_deal evd
      WHERE c.tenant_id = evd.tenant_id
        AND c.id = evd.contact_id
        AND c.first_source IS NULL
    `;

    // Herda first_source / first_campaign do contato para deals novos que ficaram com source NULL
    await tx`
      WITH primary_contact_attr AS (
        SELECT DISTINCT ON (dc.tenant_id, dc.deal_id)
          dc.tenant_id,
          dc.deal_id,
          c.first_source,
          c.first_campaign,
          c.utm_source,
          c.utm_medium,
          c.utm_campaign,
          c.utm_content,
          c.utm_term,
          c.click_id,
          c.landing_page
        FROM crm_deal_contacts dc
        JOIN contacts c
          ON c.tenant_id = dc.tenant_id
         AND c.id = dc.contact_id
        WHERE c.first_source IS NOT NULL
        ORDER BY dc.tenant_id, dc.deal_id, dc.is_primary DESC, dc.created_at ASC
      )
      UPDATE crm_deals d
      SET
        source = pca.first_source,
        campaign = COALESCE(d.campaign, pca.first_campaign),
        utm_source = COALESCE(d.utm_source, pca.utm_source),
        utm_medium = COALESCE(d.utm_medium, pca.utm_medium),
        utm_campaign = COALESCE(d.utm_campaign, pca.utm_campaign),
        utm_content = COALESCE(d.utm_content, pca.utm_content),
        utm_term = COALESCE(d.utm_term, pca.utm_term),
        click_id = COALESCE(d.click_id, pca.click_id),
        landing_page = COALESCE(d.landing_page, pca.landing_page)
      FROM primary_contact_attr pca
      WHERE d.tenant_id = pca.tenant_id
        AND d.id = pca.deal_id
        AND d.source IS NULL
        AND d.id NOT LIKE 'deal-rd-%'
    `;

    // 7. Preenchimento de original_pipeline_id (usa o 1º fromPipelineId registrado em eventos ou o pipeline atual)
    await tx`
      WITH first_pipe_event AS (
        SELECT DISTINCT ON (e.tenant_id, e.deal_id)
          e.tenant_id,
          e.deal_id,
          (e.metadata ->> 'fromPipelineId') AS first_pipeline_id
        FROM crm_deal_events e
        WHERE e.event_type = 'pipeline_changed'
          AND (e.metadata ->> 'fromPipelineId') IS NOT NULL
        ORDER BY e.tenant_id, e.deal_id, e.created_at ASC
      )
      UPDATE crm_deals d
      SET original_pipeline_id = COALESCE(d.original_pipeline_id, fpe.first_pipeline_id, d.pipeline_id)
      FROM (SELECT id, tenant_id FROM crm_deals WHERE original_pipeline_id IS NULL) target
      LEFT JOIN first_pipe_event fpe
        ON fpe.tenant_id = target.tenant_id
       AND fpe.deal_id = target.id
      WHERE d.tenant_id = target.tenant_id
        AND d.id = target.id
    `;

    // 8. Cálculo canônico em lote de sector_current e sector_origin para todas as negociações
    const sectorUpdateRes = await tx`
      WITH op_sectors AS (
        SELECT
          s.tenant_id,
          op_id AS operator_id,
          string_agg(lower(s.name), ' | ') AS sector_names_agg
        FROM sectors s
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(s.operator_ids) = 'array' THEN s.operator_ids ELSE '[]'::jsonb END
        ) AS op_id
        GROUP BY s.tenant_id, op_id
      ),
      computed AS (
        SELECT
          d.tenant_id,
          d.id,
          d.sector_origin AS prev_sector_origin,
          op_pipe.name AS orig_pipe_name,
          CASE
            WHEN d.is_test = true THEN 'teste'
            -- Se legado com funil_original_rd explícito
            WHEN d.is_legacy = true AND (d.custom_fields ->> 'funil_original_rd') IS NOT NULL THEN
              CASE
                WHEN lower(d.custom_fields ->> 'funil_original_rd') ~ '(m[aá]quina|semi.?industrial)' THEN 'semi_industrial'
                WHEN lower(d.custom_fields ->> 'funil_original_rd') ~ '(personnalit|personalit)' THEN 'personnalite'
                WHEN lower(d.custom_fields ->> 'funil_original_rd') ~ 'projeto' THEN 'projetos'
                WHEN lower(d.custom_fields ->> 'funil_original_rd') ~ 'pe[cç]a' THEN 'pecas'
                WHEN lower(d.custom_fields ->> 'funil_original_rd') ~ '(sdr|triagem|pr[eé].?venda)' THEN 'pre_venda'
                WHEN lower(d.custom_fields ->> 'funil_original_rd') ~ '(suporte|assist[eê]ncia|p[oó]s.?venda)' THEN 'suporte_tecnico'
                WHEN lower(d.custom_fields ->> 'funil_original_rd') ~ 'externo' THEN 'externo'
                WHEN lower(d.custom_fields ->> 'funil_original_rd') ~ '(financeiro|cobran[cç]a)' THEN 'financeiro'
                ELSE 'semi_industrial'
              END
            -- Funis dedicados por setor
            WHEN d.pipeline_id = 'pipe-tecfag-funil-testes' THEN 'teste'
            WHEN lower(p.name) ~ '(m[aá]quina|semi.?industrial)' THEN 'semi_industrial'
            WHEN lower(p.name) ~ '(personnalit|personalit)' THEN 'personnalite'
            WHEN lower(p.name) ~ 'projeto' THEN 'projetos'
            WHEN lower(p.name) ~ 'pe[cç]a' THEN 'pecas'
            WHEN lower(p.name) ~ '(sdr|triagem|pr[eé].?venda)' THEN 'pre_venda'
            WHEN lower(p.name) ~ '(suporte|assist[eê]ncia|p[oó]s.?venda)' THEN 'suporte_tecnico'
            WHEN lower(p.name) ~ 'externo' THEN 'externo'
            WHEN lower(p.name) ~ '(financeiro|cobran[cç]a)' THEN 'financeiro'
            -- Funil unificado (ex.: FUNIL CWR): resolve pela divisão / setor do responsável ou etapa de pré-venda
            WHEN COALESCE(os.sector_names_agg, '') ~ '(^|\\| )(sdr|pr[eé].?venda|triagem)' THEN 'pre_venda'
            WHEN COALESCE(os.sector_names_agg, '') ~ 'pe[cç]a' THEN 'pecas'
            WHEN COALESCE(os.sector_names_agg, '') ~ '(suporte|assist[eê]ncia)' THEN 'suporte_tecnico'
            WHEN COALESCE(os.sector_names_agg, '') ~ 'financeiro' THEN 'financeiro'
            WHEN lower(COALESCE(ccp.division, '')) IN ('maquinas', 'semi_industrial') THEN 'semi_industrial'
            WHEN lower(COALESCE(ccp.division, '')) IN ('personnalite', 'personalite') THEN 'personnalite'
            WHEN COALESCE(os.sector_names_agg, '') ~ '(personnalit|personalit)' THEN 'personnalite'
            WHEN COALESCE(os.sector_names_agg, '') ~ 'm[aá]quina' THEN 'semi_industrial'
            WHEN COALESCE(os.sector_names_agg, '') ~ 'projeto' THEN 'projetos'
            WHEN lower(COALESCE(st.name, '')) ~ '^(prospects|contatar|contatando|pr[eé].?qualifica|qualificando|para triar|em triagem|para an[aá]lise)' THEN 'pre_venda'
            WHEN lower(COALESCE(d.custom_fields ->> 'cf-tf-deal-equipes-responsavel', '')) ~ 'personnalit'
                 AND lower(COALESCE(d.custom_fields ->> 'cf-tf-deal-equipes-responsavel', '')) !~ 'm[aá]quina' THEN 'personnalite'
            WHEN lower(COALESCE(d.custom_fields ->> 'cf-tf-deal-equipes-responsavel', '')) ~ 'projeto'
                 AND lower(COALESCE(d.custom_fields ->> 'cf-tf-deal-equipes-responsavel', '')) !~ 'm[aá]quina' THEN 'projetos'
            WHEN lower(COALESCE(d.custom_fields ->> 'cf-tf-deal-equipes-responsavel', '')) ~ 'm[aá]quina' THEN 'semi_industrial'
            ELSE 'pre_venda'
          END AS next_sector_current
        FROM crm_deals d
        JOIN crm_pipelines p
          ON p.tenant_id = d.tenant_id
         AND p.id = d.pipeline_id
        JOIN crm_stages st
          ON st.tenant_id = d.tenant_id
         AND st.id = d.stage_id
        LEFT JOIN crm_pipelines op_pipe
          ON op_pipe.tenant_id = d.tenant_id
         AND op_pipe.id = d.original_pipeline_id
        LEFT JOIN commercial_consultant_profiles ccp
          ON ccp.tenant_id = d.tenant_id
         AND ccp.operator_id = d.operator_id
        LEFT JOIN op_sectors os
          ON os.tenant_id = d.tenant_id
         AND os.operator_id = d.operator_id
      )
      UPDATE crm_deals d
      SET
        sector_current = c.next_sector_current,
        sector_origin = CASE
          WHEN c.next_sector_current = 'teste' THEN 'teste'
          WHEN c.prev_sector_origin IN ('semi_industrial', 'personnalite', 'projetos', 'pecas', 'suporte_tecnico', 'externo', 'financeiro')
            THEN c.prev_sector_origin
          WHEN lower(COALESCE(c.orig_pipe_name, '')) ~ '(m[aá]quina|semi.?industrial)' THEN 'semi_industrial'
          WHEN lower(COALESCE(c.orig_pipe_name, '')) ~ '(personnalit|personalit)' THEN 'personnalite'
          WHEN lower(COALESCE(c.orig_pipe_name, '')) ~ 'projeto' THEN 'projetos'
          WHEN lower(COALESCE(c.orig_pipe_name, '')) ~ 'pe[cç]a' THEN 'pecas'
          ELSE c.next_sector_current
        END
      FROM computed c
      WHERE d.tenant_id = c.tenant_id
        AND d.id = c.id
        AND (
          d.sector_current IS DISTINCT FROM c.next_sector_current
          OR d.sector_origin IS NULL
          OR (d.sector_origin = 'pre_venda' AND c.next_sector_current IN ('semi_industrial', 'personnalite', 'projetos', 'pecas'))
        )
    `;

    // 9. Preenchimento de won_at (status='won' OU etapas FECHAMENTO / VENDA CONCLUÍDA abertas comerciais) e lost_at
    const winLossDatesRes = await tx`
      WITH earliest_win_ev AS (
        SELECT
          e.tenant_id,
          e.deal_id,
          MIN(e.created_at) AS first_win_at
        FROM crm_deal_events e
        WHERE e.event_type IN ('status_changed', 'stage_changed')
          AND (
            (e.metadata ->> 'toStatus') = 'won'
            OR lower(COALESCE(e.metadata ->> 'toStageName', '')) ~ '^(fechamento|venda conclu[ií]da)'
          )
        GROUP BY e.tenant_id, e.deal_id
      ),
      earliest_loss_ev AS (
        SELECT
          e.tenant_id,
          e.deal_id,
          MIN(e.created_at) AS first_lost_at
        FROM crm_deal_events e
        WHERE e.event_type = 'status_changed'
          AND (e.metadata ->> 'toStatus') = 'lost'
        GROUP BY e.tenant_id, e.deal_id
      ),
      computed_dates AS (
        SELECT
          d.tenant_id,
          d.id,
          CASE
            WHEN d.status = 'won'
              OR (
                d.status = 'open'
                AND COALESCE(d.sector_current, '') NOT IN ('suporte_tecnico', 'financeiro')
                AND (st.is_win_stage = true OR lower(st.name) ~ '^(fechamento|venda conclu[ií]da)')
              )
            THEN COALESCE(d.won_at, d.closed_at, ewe.first_win_at, d.updated_at, d.created_at)
            ELSE NULL
          END AS next_won_at,
          CASE
            WHEN d.status = 'lost'
            THEN COALESCE(d.lost_at, d.closed_at, ele.first_lost_at, d.updated_at, d.created_at)
            ELSE NULL
          END AS next_lost_at
        FROM crm_deals d
        JOIN crm_stages st
          ON st.tenant_id = d.tenant_id
         AND st.id = d.stage_id
        LEFT JOIN earliest_win_ev ewe
          ON ewe.tenant_id = d.tenant_id
         AND ewe.deal_id = d.id
        LEFT JOIN earliest_loss_ev ele
          ON ele.tenant_id = d.tenant_id
         AND ele.deal_id = d.id
      )
      UPDATE crm_deals d
      SET
        won_at = cd.next_won_at,
        lost_at = cd.next_lost_at
      FROM computed_dates cd
      WHERE d.tenant_id = cd.tenant_id
        AND d.id = cd.id
        AND (
          d.won_at IS DISTINCT FROM cd.next_won_at
          OR d.lost_at IS DISTINCT FROM cd.next_lost_at
        )
    `;

    // 10. Backfill de contacts (sector_origin, is_legacy, is_test)
    await tx`
      WITH contact_first_deal AS (
        SELECT DISTINCT ON (dc.tenant_id, dc.contact_id)
          dc.tenant_id,
          dc.contact_id,
          d.sector_origin
        FROM crm_deal_contacts dc
        JOIN crm_deals d
          ON d.tenant_id = dc.tenant_id
         AND d.id = dc.deal_id
        WHERE d.is_test = false
          AND d.sector_origin IS NOT NULL
        ORDER BY dc.tenant_id, dc.contact_id, d.created_at ASC
      )
      UPDATE contacts c
      SET sector_origin = cfd.sector_origin
      FROM contact_first_deal cfd
      WHERE c.tenant_id = cfd.tenant_id
        AND c.id = cfd.contact_id
        AND c.sector_origin IS NULL
    `;

    await tx`
      UPDATE contacts c
      SET sector_origin = 'pre_venda'
      WHERE c.sector_origin IS NULL
        AND EXISTS (
          SELECT 1 FROM conversations conv
          WHERE conv.tenant_id = c.tenant_id
            AND conv.contact_id = c.id
        )
    `;

    await tx`
      UPDATE contacts c
      SET is_test = true
      WHERE c.is_test = false
        AND c.name ~* '(^|[^a-zA-ZÀ-ÿ0-9])testes?($|[^a-zA-ZÀ-ÿ0-9])'
        AND NOT EXISTS (
          SELECT 1
          FROM crm_deal_contacts dc
          JOIN crm_deals d
            ON d.tenant_id = dc.tenant_id
           AND d.id = dc.deal_id
          WHERE dc.tenant_id = c.tenant_id
            AND dc.contact_id = c.id
            AND d.is_test = false
            AND d.status = 'won'
        )
    `;

    await tx`
      UPDATE contacts c
      SET is_legacy = true
      WHERE c.is_legacy = false
        AND EXISTS (
          SELECT 1
          FROM crm_deal_contacts dc
          JOIN crm_deals d
            ON d.tenant_id = dc.tenant_id
           AND d.id = dc.deal_id
          WHERE dc.tenant_id = c.tenant_id
            AND dc.contact_id = c.id
            AND d.is_legacy = true
        )
        AND NOT EXISTS (
          SELECT 1
          FROM crm_deal_contacts dc
          JOIN crm_deals d
            ON d.tenant_id = dc.tenant_id
           AND d.id = dc.deal_id
          WHERE dc.tenant_id = c.tenant_id
            AND dc.contact_id = c.id
            AND d.is_legacy = false
        )
    `;

    return {
      rdDealsEnsured: rdIdRes.count ?? 0,
      renamedArchivePipeline,
      legacyDealsMarked: legacyDealsRes.count ?? 0,
      testDealsMarked: testDealsRes.count ?? 0,
      operationalSourcesCleaned: cleanOperationalSourceRes.count ?? 0,
      contactsFirstTouchEnriched: contactFirstTouchRes.count ?? 0,
      dealsSectorUpdated: sectorUpdateRes.count ?? 0,
      winLossUpdated: winLossDatesRes.count ?? 0,
    };
  });
}

// Execução direta via CLI se invocado isoladamente
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    try {
      process.loadEnvFile(".env");
    } catch {}
  } else if (existsSync(".env")) {
    const envContent = readFileSync(".env", "utf8");
    for (const line of envContent.split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m && !process.env[m[1]]) {
        let v = (m[2] || "").trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  runMarketingCrmDimensionsBackfill(sql)
    .then((summary) => {
      console.log("[backfill-marketing-crm-dimensions] Concluído:", summary);
    })
    .catch((err) => {
      console.error("[backfill-marketing-crm-dimensions] Erro:", err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
