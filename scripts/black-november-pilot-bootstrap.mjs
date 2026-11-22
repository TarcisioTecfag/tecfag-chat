/**
 * Bootstrap idempotente — Piloto Black November (22/11/2026)
 *
 * 1. Cria os 4 campos personalizados de negociação no CRM (tenant alvo) com IDs previsíveis
 *    e títulos exatos exigidos na especificação v3:
 *      - black_maquina  -> "Máquina Black"
 *      - black_preco    -> "Preço Black"
 *      - gap_t1         -> "Gap — trecho T1"
 *      - gap_t3         -> "Gap — lista T3"
 * 2. Configura os bindings automáticos (`deal_field:<id>`) nos 5 templates parametrizados do piloto.
 * 3. Exclui na Graph API da Meta (e marca DELETED no banco local) os 10 templates obsoletos da seção 7,
 *    pulando com aviso qualquer template ainda referenciado em algum fluxo de Webhook RD Marketing.
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

const BLACK_CUSTOM_FIELDS = [
  { id: "black_maquina", name: "Máquina Black", fieldType: "text" },
  { id: "black_preco", name: "Preço Black", fieldType: "text" },
  { id: "gap_t1", name: "Gap — trecho T1", fieldType: "text" },
  { id: "gap_t3", name: "Gap — lista T3", fieldType: "text" },
];

const BLACK_TEMPLATE_BINDINGS = [
  {
    name: "reeng_black_piloto_dia1_gap",
    bindings: {
      "1": "deal_field:black_maquina",
      "2": "deal_field:black_preco",
      "3": "deal_field:gap_t1",
    },
  },
  {
    name: "reeng_black_piloto_dia1",
    bindings: {
      "1": "deal_field:black_maquina",
      "2": "deal_field:black_preco",
    },
  },
  {
    name: "reeng_black_piloto_dia3_gap",
    bindings: {
      "1": "deal_field:black_maquina",
      "2": "deal_field:black_preco",
      "3": "deal_field:gap_t3",
    },
  },
  {
    name: "reeng_black_piloto_dia3_v2",
    bindings: {
      "1": "deal_field:black_maquina",
      "2": "deal_field:black_preco",
    },
  },
  {
    name: "reeng_black_piloto_dia4",
    bindings: {
      "1": "deal_field:black_maquina",
      "2": "deal_field:black_preco",
    },
  },
];

const DEPRECATED_META_TEMPLATES = [
  { name: "reeng_black_piloto_dia3", metaTemplateId: "1169671662173358" },
  { name: "fagner_abertura_dia1", metaTemplateId: "4734407543507365" },
  { name: "fagner_abertura_dia1_v2", metaTemplateId: "1044761848669496" },
  { name: "fagner_coringa_a", metaTemplateId: "1141647538645517" },
  { name: "fagner_coringa_b", metaTemplateId: "1801830701098175" },
  { name: "fagner_coringa_d", metaTemplateId: "1835986677489470" },
  { name: "fagner_dia2", metaTemplateId: "2195960964329658" },
  { name: "fagner_dia3", metaTemplateId: "1017270794018660" },
  { name: "fagner_dia4", metaTemplateId: "1385216660185920" },
  { name: "fagner_dia5", metaTemplateId: "1167092759200113" },
];

export async function runBlackNovemberPilotBootstrap(sql, tenantId = "tecfag") {
  const summary = {
    tenantId,
    fieldsCreated: [],
    fieldsReused: [],
    templatesBound: [],
    templatesDeleted: [],
    templatesSkippedReferenced: [],
    templatesAlreadyDeletedOrMissing: [],
    templateDeleteErrors: [],
  };

  const [tenantRow] = await sql`SELECT id FROM tenants WHERE id = ${tenantId} LIMIT 1`;
  if (!tenantRow) {
    return { ...summary, skipped: "tenant_not_found" };
  }

  // 1. Criar os 4 campos personalizados de negociação
  const existingFields = await sql`
    SELECT id, name, sort_order
    FROM crm_custom_field_definitions
    WHERE tenant_id = ${tenantId}
      AND entity_type = 'deal'
      AND archived_at IS NULL
  `;
  let nextSortOrder = existingFields.reduce(
    (max, f) => Math.max(max, Number(f.sort_order ?? 0)),
    -1,
  ) + 1;

  for (const spec of BLACK_CUSTOM_FIELDS) {
    const found = existingFields.find(
      (f) =>
        f.id === spec.id ||
        String(f.name || "").trim().toLowerCase() === spec.name.trim().toLowerCase(),
    );
    if (found) {
      summary.fieldsReused.push({ id: found.id, name: found.name });
      continue;
    }
    await sql`
      INSERT INTO crm_custom_field_definitions (
        id,
        tenant_id,
        entity_type,
        name,
        field_type,
        options,
        required,
        required_rule,
        required_from_stage_id,
        is_unique,
        visible_on_create,
        all_pipelines,
        pipeline_ids,
        sort_order,
        created_at,
        updated_at
      )
      VALUES (
        ${spec.id},
        ${tenantId},
        'deal',
        ${spec.name},
        ${spec.fieldType},
        '[]'::jsonb,
        false,
        'always',
        null,
        false,
        true,
        true,
        '[]'::jsonb,
        ${nextSortOrder++},
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
    summary.fieldsCreated.push({ id: spec.id, name: spec.name });
  }

  // 2. Configurar os bindings automáticos (`deal_field:*`) nos 5 templates parametrizados
  for (const tplSpec of BLACK_TEMPLATE_BINDINGS) {
    const updated = await sql`
      UPDATE meta_message_templates
      SET bindings = ${sql.json(tplSpec.bindings)}
      WHERE tenant_id = ${tenantId}
        AND name = ${tplSpec.name}
        AND status <> 'DELETED'
      RETURNING meta_template_id, name
    `;
    if (updated.length > 0) {
      summary.templatesBound.push({
        name: tplSpec.name,
        metaTemplateId: updated[0].meta_template_id,
        bindings: tplSpec.bindings,
      });
    }
  }

  // 3. Excluir os 10 templates obsoletos na Meta (pulando se referenciado em fluxo RD Marketing)
  const [channelCfg] = await sql`
    SELECT meta_business_account_id, meta_access_token
    FROM channel_configs
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `;

  if (!channelCfg?.meta_business_account_id || !channelCfg?.meta_access_token) {
    return summary;
  }

  const rdFlows = await sql`
    SELECT id, settings
    FROM rd_marketing_flows
    WHERE tenant_id = ${tenantId}
  `;

  const referencedValues = new Set();
  for (const flow of rdFlows) {
    const ref = String(flow?.settings?.whatsappTemplateId || "").trim();
    if (ref) referencedValues.add(ref);
  }

  for (const tpl of DEPRECATED_META_TEMPLATES) {
    const internalId = `${tenantId}:${tpl.metaTemplateId}`;
    const [existing] = await sql`
      SELECT id, meta_template_id, name, status
      FROM meta_message_templates
      WHERE tenant_id = ${tenantId}
        AND meta_template_id = ${tpl.metaTemplateId}
      LIMIT 1
    `;

    if (!existing || existing.status === "DELETED") {
      summary.templatesAlreadyDeletedOrMissing.push(tpl.name);
      continue;
    }

    if (
      referencedValues.has(internalId) ||
      referencedValues.has(tpl.metaTemplateId) ||
      referencedValues.has(tpl.name)
    ) {
      summary.templatesSkippedReferenced.push({
        name: tpl.name,
        metaTemplateId: tpl.metaTemplateId,
      });
      continue;
    }

    try {
      const params = new URLSearchParams({
        hsm_id: tpl.metaTemplateId,
        name: tpl.name,
      });
      const url = `${GRAPH_BASE}/${encodeURIComponent(channelCfg.meta_business_account_id)}/message_templates?${params}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${channelCfg.meta_access_token}`,
        },
        signal: AbortSignal.timeout(15000),
      });
      const payload = await res.json().catch(() => ({}));
      const errMsg = String(payload?.error?.message || "");
      const alreadyGoneOnMeta =
        !res.ok &&
        (payload?.error?.code === 100 ||
          errMsg.toLowerCase().includes("does not exist") ||
          errMsg.toLowerCase().includes("not found"));

      if (res.ok || alreadyGoneOnMeta) {
        await sql`
          UPDATE meta_message_templates
          SET status = 'DELETED', last_synced_at = NOW()
          WHERE tenant_id = ${tenantId}
            AND meta_template_id = ${tpl.metaTemplateId}
        `;
        summary.templatesDeleted.push({
          name: tpl.name,
          metaTemplateId: tpl.metaTemplateId,
          alreadyGoneOnMeta,
        });
      } else {
        summary.templateDeleteErrors.push({
          name: tpl.name,
          metaTemplateId: tpl.metaTemplateId,
          httpStatus: res.status,
          error: errMsg || `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      summary.templateDeleteErrors.push({
        name: tpl.name,
        metaTemplateId: tpl.metaTemplateId,
        error: err?.message || String(err),
      });
    }
  }

  return summary;
}
