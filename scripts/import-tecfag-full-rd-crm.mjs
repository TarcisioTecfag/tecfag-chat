import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import postgres from "postgres";

if (typeof process.loadEnvFile === "function") {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
  } catch {}
} else if (existsSync(".env")) {
  try {
    const envContent = readFileSync(".env", "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || "").trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch {}
}

function normKey(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function contactPhoneIdentity(rawPhone) {
  let digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  if (digits.startsWith("00") && digits.length > 11) {
    digits = digits.slice(2);
  }
  digits = digits.replace(/^0+/, "");
  if (digits.length < 8) return "";
  if (digits.length === 10 || digits.length === 11) {
    digits = "55" + digits;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return digits;
  }
  if (digits.length === 13 && digits.startsWith("55") && digits[4] === "9") {
    return digits.slice(0, 4) + digits.slice(5);
  }
  return digits;
}

function slugifyCatalogCode(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

const EXTENDED_DEAL_CF_DEFS = [
  { id: "cf-tf-deal-ajuda-necessaria", name: "Onde o Cliente Precisa de Ajuda?" },
  { id: "cf-tf-deal-processo-atual", name: "Como é Feito Hoje?" },
  { id: "cf-tf-deal-expectativa-uso", name: "Expectativa de Uso?" },
  { id: "cf-tf-deal-nivel-automacao", name: "Nível de Automação Exigido" },
  { id: "cf-tf-deal-tipo-embalagem", name: "Que Tipo de Embalagem?" },
  { id: "cf-tf-deal-producao-hora", name: "Produção Desejada por Hora" },
  { id: "cf-tf-deal-perfil-cliente", name: "Qual Perfil o Cliente se Encaixa?" },
  { id: "cf-tf-deal-apresentacao-proposta", name: "Apresentação da Proposta" },
  { id: "cf-tf-deal-projetos-desenvolvimento", name: "Projetos / Desenvolvimento" },
  { id: "cf-tf-deal-info-complementares", name: "Informações Complementares" },
  { id: "cf-tf-deal-escopo-validado", name: "Escopo Validado pelo Cliente" },
  { id: "cf-tf-deal-destino-projeto", name: "Destino Final do Projeto (Auditoria CEO)" },
  { id: "cf-tf-deal-justificativa-movimentacao", name: "Justificativa de Movimentação de Projeto" },
  { id: "cf-tf-deal-descricao", name: "Descrição" },
  { id: "cf-tf-deal-feito-por", name: "Feito Por" },
  { id: "cf-tf-deal-equipamento", name: "Equipamento" },
  { id: "cf-tf-deal-budget", name: "Budget" },
  { id: "cf-tf-deal-pre-analise", name: "Pré-Análise" },
  { id: "cf-tf-deal-anotacao-perda", name: "Anotação do Motivo de Perda" },
  { id: "cf-tf-deal-equipes-responsavel", name: "Equipes do Responsável" },
  { id: "cf-tf-deal-produtos", name: "Produtos de Interesse" },
];

export async function runTecfagFullRdCrmMigration(sql) {
  const seedUrl = new URL(
    "./data/tecfag-full-rd-crm-2026-11-10.json.gz",
    import.meta.url,
  );
  const seedPath = fileURLToPath(seedUrl);
  if (!existsSync(seedPath)) {
    throw new Error(`Arquivo de seed não encontrado: ${seedPath}`);
  }

  const rawBuffer = readFileSync(seedPath);
  const payload = JSON.parse(gunzipSync(rawBuffer).toString("utf8"));
  const tenantId = "tecfag";

  return await sql.begin(async (tx) => {
    await tx`
      INSERT INTO tenants (id, name, slug, connection_type)
      VALUES ('tecfag', 'Tecfag Informática', 'tecfag', 'meta')
      ON CONFLICT (id) DO NOTHING
    `;

    // 1. Resolve all active operators dynamically (never use synthetic 'op-tf-%')
    const existingOps = await tx`
      SELECT id, name, email
      FROM operators
      WHERE tenant_id = ${tenantId}
        AND id NOT LIKE 'op-tf-%'
    `;

    const opByKey = new Map();
    for (const spec of payload.operatorSpecs || []) {
      let found =
        existingOps.find((o) => o.id === spec.id) ||
        existingOps.find(
          (o) =>
            String(o.email || "").toLowerCase() ===
            String(spec.email || "").toLowerCase(),
        ) ||
        existingOps.find((o) => normKey(o.name) === normKey(spec.name)) ||
        null;

      if (!found) {
        const [created] = await tx`
          INSERT INTO operators (id, tenant_id, name, email, password_hash, role, status)
          VALUES (${spec.id}, ${tenantId}, ${spec.name}, ${spec.email}, 'rd_crm_migration_placeholder', 'agent', 'disponivel')
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
          RETURNING id, name, email
        `;
        found = created;
        existingOps.push(found);
      }
      opByKey.set(spec.key, found);
    }

    const viniciusOp = opByKey.get("vinicius") || existingOps[0];

    // 2. Resolve Pipelines & Stages (including FUNIL TESTES -> ANTERIORES)
    const dbPipelines = await tx`
      SELECT id, name, order_index
      FROM crm_pipelines
      WHERE tenant_id = ${tenantId}
    `;

    const pipelineIdRemap = new Map();

    // Ensure the 4 main pipelines exist
    for (const p of payload.pipelines || []) {
      if (p.id === "pipe-tecfag-testes") continue;
      let existing =
        dbPipelines.find((dp) => dp.id === p.id) ||
        dbPipelines.find((dp) => normKey(dp.name) === normKey(p.name));
      if (!existing) {
        const [created] = await tx`
          INSERT INTO crm_pipelines (
            id, tenant_id, name, order_index, is_default, color, cooling_days, rd_pipeline_id, created_at, updated_at
          ) VALUES (
            ${p.id}, ${tenantId}, ${p.name}, ${p.order_index ?? 0},
            ${p.is_default ?? false}, ${p.color || "#0284c7"},
            ${p.cooling_days ?? 10}, ${p.rd_pipeline_id ?? null}, NOW(), NOW()
          )
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
          RETURNING id, name, order_index
        `;
        existing = created;
        dbPipelines.push(existing);
      }
      pipelineIdRemap.set(p.id, existing.id);
    }

    // Resolve or create FUNIL TESTES
    let testesPipe =
      dbPipelines.find((dp) => dp.id === "pipe-tecfag-testes") ||
      dbPipelines.find((dp) => {
        const nk = normKey(dp.name);
        return (
          nk === "testes" ||
          nk === "funil testes" ||
          nk === "funil de testes" ||
          nk.includes("teste")
        );
      });

    if (!testesPipe) {
      const [createdTestes] = await tx`
        INSERT INTO crm_pipelines (
          id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at
        ) VALUES (
          'pipe-tecfag-testes', ${tenantId}, 'FUNIL TESTES', 8, false, '#64748b', 10, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name, order_index
      `;
      testesPipe = createdTestes;
      dbPipelines.push(testesPipe);
    }
    pipelineIdRemap.set("pipe-tecfag-testes", testesPipe.id);

    // Resolve or create Stages
    const dbStages = await tx`
      SELECT id, pipeline_id, name, order_index
      FROM crm_stages
      WHERE tenant_id = ${tenantId}
    `;
    const stageIdRemap = new Map();

    for (const s of payload.stages || []) {
      if (s.id === "stg-tf-testes-anteriores") continue;
      const targetPipeId =
        pipelineIdRemap.get(s.pipeline_id) || s.pipeline_id;
      let existingStage =
        dbStages.find((ds) => ds.id === s.id) ||
        dbStages.find(
          (ds) =>
            ds.pipeline_id === targetPipeId &&
            normKey(ds.name) === normKey(s.name),
        );
      if (!existingStage) {
        const [createdStg] = await tx`
          INSERT INTO crm_stages (
            id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at
          ) VALUES (
            ${s.id}, ${tenantId}, ${targetPipeId}, ${s.name}, ${s.order_index ?? 0},
            ${s.is_win_stage ?? false}, ${s.is_loss_stage ?? false},
            ${JSON.stringify(s.required_fields ?? [])}::jsonb, NOW(), NOW()
          )
          ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name
          RETURNING id, pipeline_id, name, order_index
        `;
        existingStage = createdStg;
        dbStages.push(existingStage);
      }
      stageIdRemap.set(s.id, existingStage.id);
    }

    // Resolve or create stage ANTERIORES inside FUNIL TESTES
    let anterioresStage =
      dbStages.find(
        (ds) =>
          ds.pipeline_id === testesPipe.id &&
          (ds.id === "stg-tf-testes-anteriores" ||
            normKey(ds.name) === "anteriores" ||
            normKey(ds.name).includes("anterior")),
      ) || null;

    if (!anterioresStage) {
      const maxOrder = dbStages
        .filter((ds) => ds.pipeline_id === testesPipe.id)
        .reduce((m, ds) => Math.max(m, Number(ds.order_index || 0)), -1);
      const [createdAnt] = await tx`
        INSERT INTO crm_stages (
          id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at
        ) VALUES (
          'stg-tf-testes-anteriores', ${tenantId}, ${testesPipe.id}, 'ANTERIORES', ${maxOrder + 1}, false, false, '[]'::jsonb, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name
        RETURNING id, pipeline_id, name, order_index
      `;
      anterioresStage = createdAnt;
      dbStages.push(anterioresStage);
    }
    stageIdRemap.set("stg-tf-testes-anteriores", anterioresStage.id);

    console.log("[full rd migration] Funil Testes e etapa ANTERIORES resolvidos:", {
      testesPipelineId: testesPipe.id,
      testesPipelineName: testesPipe.name,
      anterioresStageId: anterioresStage.id,
      anterioresStageName: anterioresStage.name,
      viniciusOperatorId: viniciusOp.id,
    });

    // 3. Ensure Custom Field Definitions exist
    for (const f of payload.customFields || []) {
      await tx`
        INSERT INTO crm_custom_field_definitions (
          id, tenant_id, entity_type, name, field_type, options, required,
          required_rule, required_from_stage_id, is_unique, visible_on_create,
          all_pipelines, pipeline_ids, sort_order, archived_at, created_at, updated_at
        ) VALUES (
          ${f.id}, ${tenantId}, ${f.entity_type ?? "deal"}, ${f.name},
          ${f.field_type ?? "text"},
          ${JSON.stringify(f.options ?? [])}::jsonb,
          ${f.required ?? false}, ${f.required_rule ?? "always"},
          ${f.required_from_stage_id ?? null},
          ${f.is_unique ?? false},
          ${f.visible_on_create ?? true},
          ${f.all_pipelines ?? true},
          ${JSON.stringify(f.pipeline_ids ?? [])}::jsonb,
          ${f.sort_order ?? 0},
          null, NOW(), NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    let extraSortOrder = 10;
    for (const extDef of EXTENDED_DEAL_CF_DEFS) {
      await tx`
        INSERT INTO crm_custom_field_definitions (
          id, tenant_id, entity_type, name, field_type, options, required,
          required_rule, visible_on_create, all_pipelines, pipeline_ids, sort_order, created_at, updated_at
        ) VALUES (
          ${extDef.id}, ${tenantId}, 'deal', ${extDef.name}, 'text', '[]'::jsonb, false,
          'always', true, true, '[]'::jsonb, ${extraSortOrder++}, NOW(), NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // 4. Clean up old homologation tasks/notes & deals from irrelevant funnels (Peças, SDR, Suporte, Financeiro)
    await tx`
      DELETE FROM crm_deal_activities
      WHERE tenant_id = ${tenantId}
        AND (
          id LIKE 'task-hb-%'
          OR id LIKE 'note-hb-%'
          OR id LIKE 'task-rd-%'
          OR id LIKE 'note-rd-%'
        )
    `;

    await tx`
      DELETE FROM crm_deals
      WHERE tenant_id = ${tenantId}
        AND id LIKE 'deal-rd-%'
        AND pipeline_id IN (
          'pipe-tecfag-pecas',
          'pipe-tecfag-sdr',
          'pipe-tecfag-suporte-tecnico',
          'pipe-tecfag-financeiro'
        )
    `;

    // 5. Reconcile & Upsert Accounts (crm_accounts) without duplicates
    const dbAccounts = await tx`
      SELECT id, name, document, rd_organization_id
      FROM crm_accounts
      WHERE tenant_id = ${tenantId}
    `;
    const dbAccByDoc = new Map();
    const dbAccByRdOrg = new Map();
    const dbAccByName = new Map();
    for (const a of dbAccounts) {
      const cleanDoc = String(a.document || "").replace(/\D/g, "");
      if (cleanDoc) dbAccByDoc.set(cleanDoc, a.id);
      if (a.rd_organization_id) dbAccByRdOrg.set(a.rd_organization_id, a.id);
      if (a.name) dbAccByName.set(normKey(a.name), a.id);
    }

    const accountIdRemap = new Map();
    const accountsToUpsertMap = new Map();

    for (const acc of payload.accounts || []) {
      const cleanDoc = String(acc.document || "").replace(/\D/g, "");
      let targetId = acc.id;

      if (cleanDoc && dbAccByDoc.has(cleanDoc)) {
        targetId = dbAccByDoc.get(cleanDoc);
      } else if (
        acc.rd_organization_id &&
        dbAccByRdOrg.has(acc.rd_organization_id)
      ) {
        targetId = dbAccByRdOrg.get(acc.rd_organization_id);
      } else if (acc.name && dbAccByName.has(normKey(acc.name))) {
        targetId = dbAccByName.get(normKey(acc.name));
      }

      accountIdRemap.set(acc.id, targetId);
      if (cleanDoc) dbAccByDoc.set(cleanDoc, targetId);
      if (acc.rd_organization_id) {
        dbAccByRdOrg.set(acc.rd_organization_id, targetId);
      }
      if (acc.name) dbAccByName.set(normKey(acc.name), targetId);

      if (!accountsToUpsertMap.has(targetId)) {
        const dt = acc.created_at ? new Date(acc.created_at) : new Date();
        accountsToUpsertMap.set(targetId, {
          id: targetId,
          tenant_id: tenantId,
          type: acc.type || "company",
          name: acc.name,
          trade_name: acc.trade_name || acc.name,
          document_type: acc.document_type || null,
          document: cleanDoc || null,
          email: acc.email || null,
          phone: acc.phone || null,
          rd_organization_id: acc.rd_organization_id || null,
          created_at: dt,
          updated_at: dt,
        });
      }
    }

    const accountsToUpsert = Array.from(accountsToUpsertMap.values());
    const BATCH = 400;

    try {
      await tx.unsafe(
        "ALTER TABLE contacts DISABLE TRIGGER trg_contact_phone_identity",
      );
      await tx.unsafe(
        "ALTER TABLE crm_accounts DISABLE TRIGGER trg_account_document_identity",
      );
    } catch {}

    for (let i = 0; i < accountsToUpsert.length; i += BATCH) {
      const slice = accountsToUpsert.slice(i, i + BATCH);
      await tx`
        INSERT INTO crm_accounts ${tx(
          slice,
          "id",
          "tenant_id",
          "type",
          "name",
          "trade_name",
          "document_type",
          "document",
          "email",
          "phone",
          "rd_organization_id",
          "created_at",
          "updated_at",
        )}
        ON CONFLICT (id) DO UPDATE SET
          trade_name = COALESCE(crm_accounts.trade_name, EXCLUDED.trade_name),
          document_type = COALESCE(crm_accounts.document_type, EXCLUDED.document_type),
          document = COALESCE(crm_accounts.document, EXCLUDED.document),
          email = COALESCE(crm_accounts.email, EXCLUDED.email),
          phone = COALESCE(crm_accounts.phone, EXCLUDED.phone),
          rd_organization_id = COALESCE(crm_accounts.rd_organization_id, EXCLUDED.rd_organization_id),
          updated_at = NOW()
      `;
    }

    // 6. Reconcile & Upsert Contacts (contacts) without duplicates
    const dbContacts = await tx`
      SELECT id, name, phone, email
      FROM contacts
      WHERE tenant_id = ${tenantId}
    `;
    const dbContactByPhoneId = new Map();
    const dbContactByEmail = new Map();
    for (const c of dbContacts) {
      const pId = contactPhoneIdentity(c.phone);
      if (pId) dbContactByPhoneId.set(pId, c.id);
      if (c.email) dbContactByEmail.set(String(c.email).toLowerCase().trim(), c.id);
    }

    const contactIdRemap = new Map();
    const contactsToUpsertMap = new Map();

    for (const c of payload.contacts || []) {
      const pId = contactPhoneIdentity(c.phone);
      const emailClean = c.email ? String(c.email).toLowerCase().trim() : "";
      let targetId = c.id;
      if (pId && dbContactByPhoneId.has(pId)) {
        targetId = dbContactByPhoneId.get(pId);
      } else if (!pId && emailClean && dbContactByEmail.has(emailClean)) {
        targetId = dbContactByEmail.get(emailClean);
      }
      contactIdRemap.set(c.id, targetId);
      if (pId) dbContactByPhoneId.set(pId, targetId);
      if (emailClean) dbContactByEmail.set(emailClean, targetId);

      const mappedAccId = c.account_id
        ? accountIdRemap.get(c.account_id) || c.account_id
        : null;
      const resolvedOp = opByKey.get(c.wallet_operator_key) || viniciusOp;

      if (!contactsToUpsertMap.has(targetId)) {
        const dt = c.created_at ? new Date(c.created_at) : new Date();
        contactsToUpsertMap.set(targetId, {
          id: targetId,
          tenant_id: tenantId,
          name: c.name,
          phone: c.phone || "",
          email: c.email || null,
          cnpj: c.cnpj || null,
          account_id: mappedAccId,
          wallet_operator_id: resolvedOp.id,
          responsible_name: resolvedOp.name,
          main_channel: "whatsapp",
          created_at: dt,
        });
      } else {
        const existing = contactsToUpsertMap.get(targetId);
        if (!existing.account_id && mappedAccId) existing.account_id = mappedAccId;
        if (!existing.email && c.email) existing.email = c.email;
        if (!existing.cnpj && c.cnpj) existing.cnpj = c.cnpj;
      }
    }

    const contactsToUpsert = Array.from(contactsToUpsertMap.values());
    for (let i = 0; i < contactsToUpsert.length; i += BATCH) {
      const slice = contactsToUpsert.slice(i, i + BATCH);
      await tx`
        INSERT INTO contacts ${tx(
          slice,
          "id",
          "tenant_id",
          "name",
          "phone",
          "email",
          "cnpj",
          "account_id",
          "wallet_operator_id",
          "responsible_name",
          "main_channel",
          "created_at",
        )}
        ON CONFLICT (id) DO UPDATE SET
          account_id = COALESCE(EXCLUDED.account_id, contacts.account_id),
          wallet_operator_id = COALESCE(contacts.wallet_operator_id, EXCLUDED.wallet_operator_id),
          responsible_name = COALESCE(EXCLUDED.responsible_name, contacts.responsible_name),
          email = COALESCE(contacts.email, EXCLUDED.email),
          cnpj = COALESCE(contacts.cnpj, EXCLUDED.cnpj)
      `;
    }

    // 7. Upsert Deals (crm_deals)
    const dealsToUpsert = (payload.deals || []).map((d) => {
      const mappedAccId = d.account_id
        ? accountIdRemap.get(d.account_id) || d.account_id
        : null;
      const resolvedOp = opByKey.get(d.operator_key) || viniciusOp;
      const mappedPipeId =
        pipelineIdRemap.get(d.pipeline_id) || d.pipeline_id;
      const mappedStageId = stageIdRemap.get(d.stage_id) || d.stage_id;

      const createdAt = d.created_at ? new Date(d.created_at) : new Date();
      const updatedAt = d.updated_at ? new Date(d.updated_at) : createdAt;
      const lastActAt = d.last_activity_at
        ? new Date(d.last_activity_at)
        : updatedAt;
      const closedAt = d.closed_at ? new Date(d.closed_at) : null;
      const expClose = d.expected_close_date
        ? new Date(d.expected_close_date)
        : null;

      return {
        id: d.id,
        tenant_id: tenantId,
        title: d.title,
        account_id: mappedAccId,
        pipeline_id: mappedPipeId,
        stage_id: mappedStageId,
        status: d.status || "open",
        value: String(d.value || "0.00"),
        currency: d.currency || "BRL",
        expected_close_date: expClose,
        operator_id: resolvedOp.id,
        source: d.source || null,
        campaign: d.campaign || null,
        rating: Number(d.rating || 0),
        loss_reason: d.loss_reason || null,
        paused_reason: d.paused_reason || null,
        rd_deal_id: d.rd_deal_id || null,
        rd_deal_url: d.rd_deal_id
          ? `https://crm.rdstation.com/app/deals/${d.rd_deal_id}`
          : null,
        custom_fields: d.custom_fields || {},
        last_activity_at: lastActAt,
        closed_at: closedAt,
        created_at: createdAt,
        updated_at: updatedAt,
      };
    });

    for (let i = 0; i < dealsToUpsert.length; i += BATCH) {
      const slice = dealsToUpsert.slice(i, i + BATCH);
      await tx`
        INSERT INTO crm_deals ${tx(
          slice,
          "id",
          "tenant_id",
          "title",
          "account_id",
          "pipeline_id",
          "stage_id",
          "status",
          "value",
          "currency",
          "expected_close_date",
          "operator_id",
          "source",
          "campaign",
          "rating",
          "loss_reason",
          "paused_reason",
          "rd_deal_id",
          "rd_deal_url",
          "custom_fields",
          "last_activity_at",
          "closed_at",
          "created_at",
          "updated_at",
        )}
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          account_id = COALESCE(EXCLUDED.account_id, crm_deals.account_id),
          pipeline_id = EXCLUDED.pipeline_id,
          stage_id = EXCLUDED.stage_id,
          status = EXCLUDED.status,
          value = EXCLUDED.value,
          operator_id = EXCLUDED.operator_id,
          source = COALESCE(EXCLUDED.source, crm_deals.source),
          campaign = COALESCE(EXCLUDED.campaign, crm_deals.campaign),
          rating = EXCLUDED.rating,
          loss_reason = COALESCE(EXCLUDED.loss_reason, crm_deals.loss_reason),
          paused_reason = COALESCE(EXCLUDED.paused_reason, crm_deals.paused_reason),
          rd_deal_id = COALESCE(EXCLUDED.rd_deal_id, crm_deals.rd_deal_id),
          rd_deal_url = COALESCE(EXCLUDED.rd_deal_url, crm_deals.rd_deal_url),
          custom_fields = EXCLUDED.custom_fields,
          closed_at = EXCLUDED.closed_at,
          updated_at = EXCLUDED.updated_at
      `;
    }

    // 8. Upsert Deal Contacts (crm_deal_contacts)
    const seenDealContactPairs = new Set();
    const dealContactsToUpsert = [];
    for (const dc of payload.dealContacts || []) {
      const mappedContactId =
        contactIdRemap.get(dc.contact_id) || dc.contact_id;
      const pairKey = `${dc.deal_id}:${mappedContactId}`;
      if (seenDealContactPairs.has(pairKey)) continue;
      seenDealContactPairs.add(pairKey);
      dealContactsToUpsert.push({
        id: dc.id,
        tenant_id: tenantId,
        deal_id: dc.deal_id,
        contact_id: mappedContactId,
        role: dc.role || "buyer",
        is_primary: Boolean(dc.is_primary),
        created_at: dc.created_at ? new Date(dc.created_at) : new Date(),
      });
    }

    for (let i = 0; i < dealContactsToUpsert.length; i += BATCH) {
      const slice = dealContactsToUpsert.slice(i, i + BATCH);
      await tx`
        INSERT INTO crm_deal_contacts ${tx(
          slice,
          "id",
          "tenant_id",
          "deal_id",
          "contact_id",
          "role",
          "is_primary",
          "created_at",
        )}
        ON CONFLICT (tenant_id, deal_id, contact_id) DO UPDATE SET
          role = EXCLUDED.role,
          is_primary = EXCLUDED.is_primary
      `;
    }

    // 9. Upsert Tasks & Timeline Notes (crm_deal_activities)
    const activitiesToUpsert = (payload.activities || []).map((a) => {
      const creatorOp =
        opByKey.get(a.creator_key) ||
        opByKey.get(a.primary_assignee_key) ||
        viniciusOp;
      const primaryAssigneeOp =
        opByKey.get(a.primary_assignee_key) || viniciusOp;
      const assigneeIds = Array.from(
        new Set(
          (a.assignee_keys || [a.primary_assignee_key])
            .map((k) => opByKey.get(k)?.id)
            .filter(Boolean),
        ),
      );
      if (assigneeIds.length === 0) assigneeIds.push(primaryAssigneeOp.id);

      const createdAt = a.created_at ? new Date(a.created_at) : new Date();
      const updatedAt = a.updated_at ? new Date(a.updated_at) : createdAt;
      const dueDate = a.due_date ? new Date(a.due_date) : null;
      const completedAt = a.completed_at ? new Date(a.completed_at) : null;

      return {
        id: a.id,
        tenant_id: tenantId,
        deal_id: a.deal_id,
        type: a.type || "task",
        title: a.title,
        description: a.description || null,
        status: a.status || "pending",
        due_date: dueDate,
        completed_at: completedAt,
        operator_id: creatorOp.id,
        assigned_to_operator_id: primaryAssigneeOp.id,
        assigned_to_operator_ids: assigneeIds,
        created_at: createdAt,
        updated_at: updatedAt,
      };
    });

    for (let i = 0; i < activitiesToUpsert.length; i += BATCH) {
      const slice = activitiesToUpsert.slice(i, i + BATCH);
      await tx`
        INSERT INTO crm_deal_activities ${tx(
          slice,
          "id",
          "tenant_id",
          "deal_id",
          "type",
          "title",
          "description",
          "status",
          "due_date",
          "completed_at",
          "operator_id",
          "assigned_to_operator_id",
          "assigned_to_operator_ids",
          "created_at",
          "updated_at",
        )}
        ON CONFLICT (id) DO UPDATE SET
          deal_id = EXCLUDED.deal_id,
          type = EXCLUDED.type,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          due_date = EXCLUDED.due_date,
          completed_at = EXCLUDED.completed_at,
          operator_id = EXCLUDED.operator_id,
          assigned_to_operator_id = EXCLUDED.assigned_to_operator_id,
          assigned_to_operator_ids = EXCLUDED.assigned_to_operator_ids,
          updated_at = EXCLUDED.updated_at
      `;
    }

    try {
      await tx.unsafe(
        "ALTER TABLE contacts ENABLE TRIGGER trg_contact_phone_identity",
      );
      await tx.unsafe(
        "ALTER TABLE crm_accounts ENABLE TRIGGER trg_account_document_identity",
      );
    } catch {}

    // 10. Populate Catalog Items (source, campaign, loss_reason)
    const catalogEntries = [];
    const seenCatalog = new Set();
    const addCatalog = (kind, rawName) => {
      const name = String(rawName || "").trim();
      if (!name || name.length > 120) return;
      const code = slugifyCatalogCode(name);
      if (!code) return;
      const key = `${kind}:${name.toLowerCase()}`;
      if (seenCatalog.has(key)) return;
      seenCatalog.add(key);
      catalogEntries.push({
        id: `cat-tf-${kind}-${code}`.slice(0, 80),
        tenant_id: tenantId,
        kind,
        name,
      });
    };

    for (const d of payload.deals || []) {
      if (d.source) addCatalog("source", d.source);
      if (d.campaign) addCatalog("campaign", d.campaign);
      if (d.loss_reason) addCatalog("loss_reason", d.loss_reason);
    }

    for (const item of catalogEntries) {
      await tx`
        INSERT INTO crm_catalog_items (
          id, tenant_id, kind, name, created_at, updated_at
        ) VALUES (
          ${item.id}, ${item.tenant_id}, ${item.kind}, ${item.name}, NOW(), NOW()
        )
        ON CONFLICT DO NOTHING
      `;
    }

    return {
      accountsUpserted: accountsToUpsert.length,
      contactsUpserted: contactsToUpsert.length,
      dealsUpserted: dealsToUpsert.length,
      dealContactsUpserted: dealContactsToUpsert.length,
      tasksUpserted: activitiesToUpsert.filter((a) => a.type !== "note").length,
      notesUpserted: activitiesToUpsert.filter((a) => a.type === "note").length,
      catalogItemsChecked: catalogEntries.length,
      testesPipelineId: testesPipe.id,
      anterioresStageId: anterioresStage.id,
    };
  });
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    process.argv[1].replace(/\//g, "\\").toLowerCase();

if (isMain) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[full rd migration] DATABASE_URL não configurada.");
    process.exit(1);
  }
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  runTecfagFullRdCrmMigration(sql)
    .then((summary) => {
      console.log("[full rd migration] Concluído com sucesso:", summary);
    })
    .catch((err) => {
      console.error("[full rd migration] Erro fatal:", err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
