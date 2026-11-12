import { createHash } from "node:crypto";
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

/**
 * Exact JavaScript mirror of PostgreSQL `contact_phone_identity(value text)`
 * from `src/db/migrations/0056_contact_multiple_phones.sql`.
 */
export function pgContactPhoneIdentity(value) {
  const raw = String(value ?? "");
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (/^551[2-9][0-8][0-9]{8}$/.test(digits)) {
    return digits.slice(2);
  }
  if (
    (raw.trim().startsWith("+") && !/^55/.test(digits)) ||
    /^1[2-9][0-8][0-9]{8}$/.test(digits)
  ) {
    return digits;
  }
  let national = digits;
  if (
    digits.startsWith("55") &&
    (digits.length === 12 || digits.length === 13)
  ) {
    national = digits.slice(2);
  }
  if (national.length === 10 || national.length === 11) {
    const ddd = national.slice(0, 2);
    if (
      /^(1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])$/.test(
        ddd,
      )
    ) {
      if (national.length === 11 && /^9[6-9][0-9]{7}$/.test(national.slice(2))) {
        national = ddd + national.slice(3);
      }
      if (national.length === 10 && /^[2-9][0-9]{7}$/.test(national.slice(2))) {
        return "55" + national;
      }
    }
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

function md5Short(str) {
  return createHash("md5").update(String(str)).digest("hex").slice(0, 10);
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
  { id: "cf-tf-deal-foto-anexada", name: "Foto Anexada?" },
  { id: "cf-tf-deal-qual-cliente", name: "Qual é o Cliente?" },
  { id: "cf-tf-deal-video-chamada", name: "Vídeo Chamada?" },
  { id: "cf-tf-deal-visita-tecnica", name: "Visita Técnica?" },
  { id: "cf-tf-deal-tem-etiqueta", name: "Tem Etiqueta?" },
  { id: "cf-tf-deal-numero-os", name: "Número da OS" },
  { id: "cf-tf-deal-tipo-atendimento", name: "Tipo de Atendimento" },
  { id: "cf-tf-deal-tipo-pecas", name: "Tipo (Peças)" },
];

export async function runTecfagPecasRdCrmMigration(sql, options = {}) {
  const seedUrl = new URL(
    "./data/tecfag-pecas-rd-crm-2026-11-12.json.gz",
    import.meta.url,
  );
  const seedPath = options.seedPath || fileURLToPath(seedUrl);
  if (!existsSync(seedPath)) {
    throw new Error(`Arquivo de seed de Peças não encontrado: ${seedPath}`);
  }

  const rawBuffer = readFileSync(seedPath);
  const payload = JSON.parse(gunzipSync(rawBuffer).toString("utf8"));
  const tenantId = options.tenantId || payload.tenantId || "tecfag";

  return await sql.begin(async (tx) => {
    await tx`
      INSERT INTO tenants (id, name, slug, connection_type)
      VALUES (${tenantId}, 'Tecfag Informática', ${tenantId}, 'meta')
      ON CONFLICT (id) DO NOTHING
    `;

    // 1. Resolve all active operators dynamically — EMAIL FIRST (excluding synthetic 'op-tf-%')
    const existingOps = await tx`
      SELECT id, name, email
      FROM operators
      WHERE tenant_id = ${tenantId}
        AND id NOT LIKE 'op-tf-%'
    `;

    const opByKey = new Map();
    for (const spec of payload.operatorSpecs || []) {
      const specEmail = String(spec.email || "").trim().toLowerCase();
      let found =
        (specEmail
          ? existingOps.find(
              (o) => String(o.email || "").trim().toLowerCase() === specEmail,
            )
          : null) ||
        existingOps.find((o) => o.id === spec.id) ||
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

    const guilhermeOp = opByKey.get("guilherme_bertola");
    const keicyOp = opByKey.get("keicy_cardoso");
    const leticiaOp = opByKey.get("leticia_cardoso");
    const viniciusOp = opByKey.get("vinicius") || guilhermeOp || existingOps[0];

    // Ensure Keicy Cardoso & Guilherme Bertola are linked to Setor de Peças if present
    const pecasSectors = await tx`
      SELECT id, name, operator_ids
      FROM sectors
      WHERE tenant_id = ${tenantId}
    `;
    const pecasSector = pecasSectors.find((s) => {
      const nk = normKey(s.name);
      return (
        s.id === "sec-1793274652985" ||
        nk === "pecas" ||
        nk === "setor de pecas" ||
        nk === "setor pecas"
      );
    });
    if (pecasSector && guilhermeOp && keicyOp) {
      const currentIds = Array.isArray(pecasSector.operator_ids)
        ? pecasSector.operator_ids
        : [];
      const mergedIds = Array.from(
        new Set([...currentIds, guilhermeOp.id, keicyOp.id].filter(Boolean)),
      );
      if (mergedIds.length !== currentIds.length) {
        await tx`
          UPDATE sectors
          SET operator_ids = ${tx.json(mergedIds)}
          WHERE id = ${pecasSector.id}
            AND tenant_id = ${tenantId}
        `;
      }
    }

    // Repair the 42 Keicy Cardoso deals from the 10/11 migration if still assigned to Leticia Cardoso
    let keicyDealsReassigned = 0;
    if (
      keicyOp &&
      leticiaOp &&
      keicyOp.id !== leticiaOp.id &&
      Array.isArray(payload.keicyReassignDealIds) &&
      payload.keicyReassignDealIds.length > 0
    ) {
      const repairRes = await tx`
        UPDATE crm_deals
        SET operator_id = ${keicyOp.id}
        WHERE tenant_id = ${tenantId}
          AND id = ANY(${payload.keicyReassignDealIds})
          AND operator_id = ${leticiaOp.id}
      `;
      keicyDealsReassigned = repairRes.count ?? 0;
    }

    // 2. Resolve Pipelines & Stages (including FUNIL PEÇAS with all 8 stages & FUNIL TESTES -> ANTERIORES)
    const dbPipelines = await tx`
      SELECT id, name, order_index
      FROM crm_pipelines
      WHERE tenant_id = ${tenantId}
    `;

    const pipelineIdRemap = new Map();

    for (const p of payload.pipelines || []) {
      if (p.id === "pipe-tecfag-testes") continue;
      let existing =
        dbPipelines.find((dp) => dp.id === p.id) ||
        dbPipelines.find((dp) => normKey(dp.name) === normKey(p.name));

      if (!existing && p.id === "pipe-tecfag-pecas") {
        existing = dbPipelines.find((dp) => {
          const nk = normKey(dp.name);
          return (
            nk === "funil pecas" ||
            nk === "funil pecas 2.0" ||
            nk === "pecas" ||
            nk === "funil de pecas"
          );
        });
      }
      if (!existing && p.id === "pipe-tecfag-suporte-tecnico") {
        existing = dbPipelines.find((dp) => {
          const nk = normKey(dp.name);
          return nk === "funil suporte tecnico" || nk === "suporte tecnico";
        });
      }
      if (!existing && p.id === "pipe-tecfag-sdr") {
        existing = dbPipelines.find((dp) => {
          const nk = normKey(dp.name);
          return nk === "funil sdr" || nk === "sdr";
        });
      }

      if (!existing) {
        const [created] = await tx`
          INSERT INTO crm_pipelines (
            id, tenant_id, name, order_index, is_default, color, cooling_days, rd_pipeline_id, created_at, updated_at
          ) VALUES (
            ${p.id}, ${tenantId}, ${p.name}, ${p.order_index ?? 3},
            ${p.is_default ?? false}, ${p.color || "#f59e0b"},
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
          'pipe-tecfag-testes', ${tenantId}, 'FUNIL TESTES', 9, false, '#64748b', 10, NOW(), NOW()
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
      ORDER BY order_index ASC, id ASC
    `;
    const stageIdRemap = new Map();

    for (const s of payload.stages || []) {
      if (s.id === "stg-tf-testes-anteriores") continue;
      const targetPipeId =
        pipelineIdRemap.get(s.pipeline_id) || s.pipeline_id;
      const pipeStages = dbStages.filter(
        (ds) => ds.pipeline_id === targetPipeId,
      );
      let existingStage =
        dbStages.find((ds) => ds.id === s.id) ||
        pipeStages.find((ds) => normKey(ds.name) === normKey(s.name));

      if (!existingStage) {
        const [createdStg] = await tx`
          INSERT INTO crm_stages (
            id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at
          ) VALUES (
            ${s.id}, ${tenantId}, ${targetPipeId}, ${s.name}, ${s.order_index ?? 0},
            ${s.is_win_stage ?? false}, ${s.is_loss_stage ?? false},
            ${JSON.stringify(s.required_fields ?? [])}::jsonb, NOW(), NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            pipeline_id = EXCLUDED.pipeline_id,
            name = EXCLUDED.name,
            order_index = EXCLUDED.order_index
          RETURNING id, pipeline_id, name, order_index
        `;
        existingStage = createdStg;
        dbStages.push(existingStage);
      } else if (
        s.pipeline_id === "pipe-tecfag-pecas" &&
        Number(existingStage.order_index) !== Number(s.order_index)
      ) {
        await tx`
          UPDATE crm_stages
          SET order_index = ${s.order_index}
          WHERE id = ${existingStage.id}
            AND tenant_id = ${tenantId}
        `;
        existingStage.order_index = s.order_index;
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

    // 3. Ensure Custom Field Definitions exist (standard + Peças specific)
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

    let extraSortOrder = 20;
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

    // 4. Reconcile & Upsert Accounts (crm_accounts) — strictly deduplicated with triggers ENABLED
    const dbAccounts = await tx`
      SELECT
        id,
        name,
        regexp_replace(coalesce(document, ''), '[^0-9]', '', 'g') AS clean_doc,
        rd_organization_id
      FROM crm_accounts
      WHERE tenant_id = ${tenantId}
    `;
    const dbAccById = new Map();
    const claimedDocs = new Map();
    const dbAccByRdOrg = new Map();
    const dbAccByName = new Map();
    for (const a of dbAccounts) {
      dbAccById.set(a.id, a);
      if (a.clean_doc) claimedDocs.set(a.clean_doc, a.id);
      if (a.rd_organization_id) dbAccByRdOrg.set(a.rd_organization_id, a.id);
      if (a.name) dbAccByName.set(normKey(a.name), a.id);
    }

    const accountIdRemap = new Map();
    const accountsToUpsertMap = new Map();

    for (const acc of payload.accounts || []) {
      const rawDoc = String(acc.document || "").replace(/\D/g, "");
      const cleanDoc =
        (rawDoc.length === 11 || rawDoc.length === 14) &&
        !/^(\d)\1+$/.test(rawDoc)
          ? rawDoc
          : "";

      let targetId = acc.id;
      if (cleanDoc && claimedDocs.has(cleanDoc)) {
        targetId = claimedDocs.get(cleanDoc);
      } else if (
        acc.rd_organization_id &&
        dbAccByRdOrg.has(acc.rd_organization_id)
      ) {
        targetId = dbAccByRdOrg.get(acc.rd_organization_id);
      } else if (acc.name && dbAccByName.has(normKey(acc.name))) {
        targetId = dbAccByName.get(normKey(acc.name));
      } else if (dbAccById.has(acc.id)) {
        targetId = acc.id;
      }

      accountIdRemap.set(acc.id, targetId);
      if (acc.rd_organization_id && !dbAccByRdOrg.has(acc.rd_organization_id)) {
        dbAccByRdOrg.set(acc.rd_organization_id, targetId);
      }
      if (acc.name && !dbAccByName.has(normKey(acc.name))) {
        dbAccByName.set(normKey(acc.name), targetId);
      }

      const existingDbAcc = dbAccById.get(targetId);
      let safeDoc = null;
      if (existingDbAcc?.clean_doc) {
        safeDoc = existingDbAcc.clean_doc;
      } else if (
        cleanDoc &&
        (!claimedDocs.has(cleanDoc) || claimedDocs.get(cleanDoc) === targetId)
      ) {
        claimedDocs.set(cleanDoc, targetId);
        safeDoc = cleanDoc;
      }

      if (!accountsToUpsertMap.has(targetId)) {
        const dt = acc.created_at ? new Date(acc.created_at) : new Date();
        accountsToUpsertMap.set(targetId, {
          id: targetId,
          tenant_id: tenantId,
          type: safeDoc?.length === 11 ? "person" : acc.type || "company",
          name: existingDbAcc?.name || acc.name,
          trade_name: acc.trade_name || acc.name,
          document_type: safeDoc
            ? safeDoc.length === 11
              ? "CPF"
              : "CNPJ"
            : null,
          document: safeDoc,
          email: acc.email || null,
          phone: acc.phone || null,
          rd_organization_id: acc.rd_organization_id || null,
          created_at: dt,
          updated_at: dt,
        });
      } else {
        const cur = accountsToUpsertMap.get(targetId);
        if (!cur.document && safeDoc) {
          cur.document = safeDoc;
          cur.document_type = safeDoc.length === 11 ? "CPF" : "CNPJ";
        }
        if (!cur.email && acc.email) cur.email = acc.email;
        if (!cur.phone && acc.phone) cur.phone = acc.phone;
        if (!cur.rd_organization_id && acc.rd_organization_id) {
          cur.rd_organization_id = acc.rd_organization_id;
        }
      }
    }

    const BATCH = 400;
    const accountsToUpsert = Array.from(accountsToUpsertMap.values());
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
          document = CASE
            WHEN regexp_replace(coalesce(crm_accounts.document, ''), '[^0-9]', '', 'g') = ''
              THEN EXCLUDED.document
            ELSE crm_accounts.document
          END,
          email = COALESCE(crm_accounts.email, EXCLUDED.email),
          phone = COALESCE(crm_accounts.phone, EXCLUDED.phone),
          rd_organization_id = COALESCE(crm_accounts.rd_organization_id, EXCLUDED.rd_organization_id),
          updated_at = NOW()
      `;
    }

    // 5. Reconcile & Upsert Contacts (contacts + contact_phones) — strictly deduplicated across BOTH tables
    const dbContacts = await tx`
      SELECT
        id,
        name,
        phone,
        email,
        cnpj,
        account_id,
        contact_phone_identity(phone) AS phone_id
      FROM contacts
      WHERE tenant_id = ${tenantId}
    `;
    const dbContactPhones = await tx`
      SELECT contact_id, phone, phone_identity
      FROM contact_phones
      WHERE tenant_id = ${tenantId}
    `;

    const dbContactById = new Map();
    const claimedPhoneId = new Map();
    const existingCpPairs = new Set();
    const dbContactByEmail = new Map();
    const dbContactByNameAcc = new Map();
    const resolvedContactAccountById = new Map();

    for (const c of dbContacts) {
      dbContactById.set(c.id, c);
      if (c.account_id) resolvedContactAccountById.set(c.id, c.account_id);
      const pId = c.phone_id || pgContactPhoneIdentity(c.phone);
      if (pId && pId.length >= 8) claimedPhoneId.set(pId, c.id);
      if (c.email) {
        dbContactByEmail.set(String(c.email).trim().toLowerCase(), c.id);
      }
      if (!pId && c.name) {
        dbContactByNameAcc.set(
          `${c.account_id || "noacc"}:${normKey(c.name)}`,
          c.id,
        );
      }
    }
    for (const cp of dbContactPhones) {
      const pId = cp.phone_identity || pgContactPhoneIdentity(cp.phone);
      if (pId && pId.length >= 8) {
        existingCpPairs.add(`${cp.contact_id}:${pId}`);
        if (!claimedPhoneId.has(pId)) {
          claimedPhoneId.set(pId, cp.contact_id);
        }
      }
    }

    const contactIdRemap = new Map();
    const contactsToUpsertMap = new Map();
    const secondaryPhonesMap = new Map();

    const queueSecondaryPhone = (contactId, phoneStr, identityStr, createdAt) => {
      if (!phoneStr || !identityStr || identityStr.length < 8) return;
      const owner = claimedPhoneId.get(identityStr);
      if (owner && owner !== contactId) return;
      claimedPhoneId.set(identityStr, contactId);
      const mapKey = `${contactId}:${identityStr}`;
      if (existingCpPairs.has(mapKey)) return;
      if (!secondaryPhonesMap.has(mapKey)) {
        const isLandline = /^55[1-9][0-9][2-5][0-9]{7}$/.test(identityStr);
        secondaryPhonesMap.set(mapKey, {
          id: `cph-${contactId}-${md5Short(identityStr)}`,
          tenant_id: tenantId,
          contact_id: contactId,
          phone: phoneStr,
          phone_identity: identityStr,
          type: isLandline ? "landline" : "commercial",
          is_primary: false,
          has_whatsapp: !isLandline,
          position: 1,
          created_at: createdAt,
          updated_at: new Date(),
        });
      }
    };

    for (const c of payload.contacts || []) {
      const mappedAccId = c.account_id
        ? accountIdRemap.get(c.account_id) || c.account_id
        : null;
      const emailClean = c.email ? String(c.email).trim().toLowerCase() : "";

      const candPhones = [];
      const seenCandId = new Set();
      const rawList = Array.isArray(c.phones) ? c.phones : [];
      if (c.phone) rawList.unshift({ phone: c.phone });
      for (const item of rawList) {
        const pStr = String(item?.phone || "").trim();
        const idStr = pgContactPhoneIdentity(pStr);
        if (pStr && idStr && idStr.length >= 8 && !seenCandId.has(idStr)) {
          seenCandId.add(idStr);
          candPhones.push({ phone: pStr, identity: idStr });
        }
      }
      const primaryIdentity = candPhones[0]?.identity || "";

      // Resolve target contact ID without creating any duplicate
      let targetId = null;
      for (const cand of candPhones) {
        if (claimedPhoneId.has(cand.identity)) {
          targetId = claimedPhoneId.get(cand.identity);
          break;
        }
      }
      if (!targetId && dbContactById.has(c.id)) {
        const existingById = dbContactById.get(c.id);
        const existingPId =
          existingById.phone_id || pgContactPhoneIdentity(existingById.phone);
        if (!primaryIdentity || !existingPId || existingPId === primaryIdentity) {
          targetId = c.id;
        }
      }
      if (!targetId && emailClean && dbContactByEmail.has(emailClean)) {
        const emailOwnerId = dbContactByEmail.get(emailClean);
        const emailOwnerDb = dbContactById.get(emailOwnerId);
        const emailOwnerQueued = contactsToUpsertMap.get(emailOwnerId);
        const existingPId = emailOwnerDb
          ? emailOwnerDb.phone_id || pgContactPhoneIdentity(emailOwnerDb.phone)
          : pgContactPhoneIdentity(emailOwnerQueued?.phone || "");
        if (!primaryIdentity || !existingPId || existingPId === primaryIdentity) {
          targetId = emailOwnerId;
        }
      }
      const nameAccKey = `${mappedAccId || "noacc"}:${normKey(c.name)}`;
      if (
        !targetId &&
        !primaryIdentity &&
        dbContactByNameAcc.has(nameAccKey)
      ) {
        targetId = dbContactByNameAcc.get(nameAccKey);
      }
      if (!targetId) {
        targetId = dbContactById.has(c.id)
          ? `${c.id}-pecas`
          : c.id;
      }

      contactIdRemap.set(c.id, targetId);
      if (emailClean && !dbContactByEmail.has(emailClean)) {
        dbContactByEmail.set(emailClean, targetId);
      }
      if (!primaryIdentity && !dbContactByNameAcc.has(nameAccKey)) {
        dbContactByNameAcc.set(nameAccKey, targetId);
      }

      const existingDb = dbContactById.get(targetId);
      const resolvedOp = opByKey.get(c.wallet_operator_key) || guilhermeOp || viniciusOp;
      const dt = c.created_at ? new Date(c.created_at) : new Date();
      const effectiveAccId = existingDb?.account_id || mappedAccId || null;
      if (effectiveAccId) {
        resolvedContactAccountById.set(targetId, effectiveAccId);
      }

      if (!contactsToUpsertMap.has(targetId)) {
        let primaryPhoneToWrite = "";
        let startSecondaryIdx = 0;

        if (existingDb && existingDb.phone_id && existingDb.phone_id.length >= 8) {
          primaryPhoneToWrite = existingDb.phone;
          startSecondaryIdx = 0;
        } else {
          for (let idx = 0; idx < candPhones.length; idx++) {
            const cand = candPhones[idx];
            const owner = claimedPhoneId.get(cand.identity);
            if (!owner || owner === targetId) {
              claimedPhoneId.set(cand.identity, targetId);
              primaryPhoneToWrite = cand.phone;
              startSecondaryIdx = idx + 1;
              break;
            }
          }
        }

        contactsToUpsertMap.set(targetId, {
          id: targetId,
          tenant_id: tenantId,
          name: existingDb?.name || c.name,
          phone: primaryPhoneToWrite || existingDb?.phone || "",
          email: c.email || null,
          cnpj: c.cnpj || null,
          account_id: mappedAccId || existingDb?.account_id || null,
          wallet_operator_id: resolvedOp.id,
          responsible_name: resolvedOp.name,
          main_channel: "whatsapp",
          created_at: dt,
        });

        const primaryIdWritten = pgContactPhoneIdentity(primaryPhoneToWrite);
        for (let idx = startSecondaryIdx; idx < candPhones.length; idx++) {
          const cand = candPhones[idx];
          if (cand.identity !== primaryIdWritten) {
            queueSecondaryPhone(targetId, cand.phone, cand.identity, dt);
          }
        }
      } else {
        const cur = contactsToUpsertMap.get(targetId);
        if (!cur.account_id && mappedAccId) {
          cur.account_id = mappedAccId;
          resolvedContactAccountById.set(targetId, mappedAccId);
        }
        if (!cur.email && c.email) cur.email = c.email;
        if (!cur.cnpj && c.cnpj) cur.cnpj = c.cnpj;

        const curPrimaryId = pgContactPhoneIdentity(cur.phone);
        for (const cand of candPhones) {
          const owner = claimedPhoneId.get(cand.identity);
          if (!curPrimaryId && (!owner || owner === targetId)) {
            claimedPhoneId.set(cand.identity, targetId);
            cur.phone = cand.phone;
          } else if (cand.identity !== curPrimaryId) {
            queueSecondaryPhone(targetId, cand.phone, cand.identity, dt);
          }
        }
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
          phone = CASE
            WHEN contact_phone_identity(contacts.phone) = ''
              THEN EXCLUDED.phone
            ELSE contacts.phone
          END,
          account_id = COALESCE(contacts.account_id, EXCLUDED.account_id),
          wallet_operator_id = COALESCE(contacts.wallet_operator_id, EXCLUDED.wallet_operator_id),
          responsible_name = COALESCE(contacts.responsible_name, EXCLUDED.responsible_name),
          email = COALESCE(contacts.email, EXCLUDED.email),
          cnpj = COALESCE(contacts.cnpj, EXCLUDED.cnpj)
      `;
    }

    // Upsert secondary phones into contact_phones
    const secondaryPhonesToUpsert = Array.from(secondaryPhonesMap.values());
    for (let i = 0; i < secondaryPhonesToUpsert.length; i += BATCH) {
      const slice = secondaryPhonesToUpsert.slice(i, i + BATCH);
      await tx`
        INSERT INTO contact_phones ${tx(
          slice,
          "id",
          "tenant_id",
          "contact_id",
          "phone",
          "phone_identity",
          "type",
          "is_primary",
          "has_whatsapp",
          "position",
          "created_at",
          "updated_at",
        )}
        ON CONFLICT (tenant_id, contact_id, phone_identity) WHERE phone_identity <> ''
        DO NOTHING
      `;
    }

    // Map deal -> contact's resolved account_id (in case a deal lacked Empresa in Peças CSV while the contact already has a company in DB)
    const fallbackContactAccByDealId = new Map();
    for (const dc of payload.dealContacts || []) {
      if (fallbackContactAccByDealId.has(dc.deal_id)) continue;
      const mappedContId = contactIdRemap.get(dc.contact_id) || dc.contact_id;
      const contAccId = resolvedContactAccountById.get(mappedContId);
      if (contAccId) fallbackContactAccByDealId.set(dc.deal_id, contAccId);
    }

    // 6. Upsert Primary Peças Deals (crm_deals — 4,610 deals) + Fallback External Task Deals (ON CONFLICT DO NOTHING)
    const formatDealRow = (d) => {
      const mappedAccId = d.account_id
        ? accountIdRemap.get(d.account_id) || d.account_id
        : fallbackContactAccByDealId.get(d.id) || null;
      const resolvedOp = opByKey.get(d.operator_key) || guilhermeOp || viniciusOp;
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
    };

    const dealsToUpsert = (payload.deals || []).map(formatDealRow);
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
          pipeline_id = CASE WHEN crm_deals.updated_at >= '2026-11-12 16:00:00+00'::timestamptz THEN crm_deals.pipeline_id ELSE EXCLUDED.pipeline_id END,
          stage_id = CASE WHEN crm_deals.updated_at >= '2026-11-12 16:00:00+00'::timestamptz THEN crm_deals.stage_id ELSE EXCLUDED.stage_id END,
          status = CASE WHEN crm_deals.updated_at >= '2026-11-12 16:00:00+00'::timestamptz THEN crm_deals.status ELSE EXCLUDED.status END,
          value = CASE WHEN crm_deals.updated_at >= '2026-11-12 16:00:00+00'::timestamptz THEN crm_deals.value ELSE EXCLUDED.value END,
          operator_id = CASE WHEN crm_deals.updated_at >= '2026-11-12 16:00:00+00'::timestamptz THEN crm_deals.operator_id ELSE EXCLUDED.operator_id END,
          source = COALESCE(EXCLUDED.source, crm_deals.source),
          campaign = COALESCE(EXCLUDED.campaign, crm_deals.campaign),
          rating = EXCLUDED.rating,
          loss_reason = COALESCE(EXCLUDED.loss_reason, crm_deals.loss_reason),
          paused_reason = COALESCE(EXCLUDED.paused_reason, crm_deals.paused_reason),
          rd_deal_id = COALESCE(EXCLUDED.rd_deal_id, crm_deals.rd_deal_id),
          rd_deal_url = COALESCE(EXCLUDED.rd_deal_url, crm_deals.rd_deal_url),
          custom_fields = EXCLUDED.custom_fields,
          closed_at = COALESCE(crm_deals.closed_at, EXCLUDED.closed_at),
          updated_at = CASE WHEN crm_deals.updated_at >= '2026-11-12 16:00:00+00'::timestamptz THEN crm_deals.updated_at ELSE EXCLUDED.updated_at END
      `;
    }

    // Fallback external deals for cross-funnel tasks (never overwrite live Máquinas/Personnalité/SDR deals)
    const fallbackDealsToInsert = (payload.fallbackTaskDeals || []).map(
      formatDealRow,
    );
    for (let i = 0; i < fallbackDealsToInsert.length; i += BATCH) {
      const slice = fallbackDealsToInsert.slice(i, i + BATCH);
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
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // 7. Upsert Deal Contacts (crm_deal_contacts)
    const seenDealContactPairs = new Set();
    const dealContactsToUpsert = [];
    for (const dc of payload.dealContacts || []) {
      const mappedContactId =
        contactIdRemap.get(dc.contact_id) || dc.contact_id;
      const pairKey = `${dc.deal_id}:${mappedContactId}`;
      if (seenDealContactPairs.has(pairKey)) continue;
      seenDealContactPairs.add(pairKey);
      dealContactsToUpsert.push({
        id: `dc-pecas-${md5Short(pairKey)}`,
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
          is_primary = (crm_deal_contacts.is_primary OR EXCLUDED.is_primary)
      `;
    }

    const fallbackDcToInsert = [];
    for (const dc of payload.fallbackDealContacts || []) {
      const mappedContactId =
        contactIdRemap.get(dc.contact_id) || dc.contact_id;
      const pairKey = `${dc.deal_id}:${mappedContactId}`;
      if (seenDealContactPairs.has(pairKey)) continue;
      seenDealContactPairs.add(pairKey);
      fallbackDcToInsert.push({
        id: `dc-pecas-ext-${md5Short(pairKey)}`,
        tenant_id: tenantId,
        deal_id: dc.deal_id,
        contact_id: mappedContactId,
        role: dc.role || "buyer",
        is_primary: Boolean(dc.is_primary),
        created_at: dc.created_at ? new Date(dc.created_at) : new Date(),
      });
    }
    for (let i = 0; i < fallbackDcToInsert.length; i += BATCH) {
      const slice = fallbackDcToInsert.slice(i, i + BATCH);
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
        ON CONFLICT (tenant_id, deal_id, contact_id) DO NOTHING
      `;
    }

    // 8. Reconcile & Upsert Tasks (all 3,864: 226 overdue + 9 pending + 3,629 completed) & Timeline Notes (2,354)
    // Deduplicate against pre-existing tasks from prior migrations (e.g. 'task-rd-XXXXX' from 10/11) so cross-funnel tasks are updated in-place (fixing Leticia -> Keicy) with 0 duplicates across both UTC (Railway/Bun) and America/Sao_Paulo (Windows Node) sessions!
    const existingOtherTasks = await tx`
      SELECT
        id,
        deal_id,
        type,
        title,
        to_char(due_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS due_raw_utc
      FROM crm_deal_activities
      WHERE tenant_id = ${tenantId}
        AND type <> 'note'
        AND id NOT LIKE 'task-rd-pecas-%'
    `;
    const preExistingBucketsByKey = new Map();
    for (const et of existingOtherTasks) {
      const bucketKey = `${et.deal_id}|${et.type}|${normKey(et.title)}`;
      if (!preExistingBucketsByKey.has(bucketKey)) {
        preExistingBucketsByKey.set(bucketKey, []);
      }
      const parsedMs = et.due_raw_utc ? Date.parse(et.due_raw_utc) : null;
      preExistingBucketsByKey.get(bucketKey).push({
        id: et.id,
        dueMs: Number.isFinite(parsedMs) ? parsedMs : null,
        used: false,
      });
    }

    let preExistingTasksReconciled = 0;
    const supersededPecasTaskIds = [];
    const activitiesToUpsertMap = new Map();

    for (const a of payload.activities || []) {
      const creatorOp =
        opByKey.get(a.creator_key) ||
        opByKey.get(a.primary_assignee_key) ||
        guilhermeOp ||
        viniciusOp;
      const primaryAssigneeOp =
        opByKey.get(a.primary_assignee_key) || guilhermeOp || viniciusOp;
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

      let targetActId = a.id;
      if (a.type !== "note") {
        const bucketKey = `${a.deal_id}|${a.type || "task"}|${normKey(a.title)}`;
        const bucket = preExistingBucketsByKey.get(bucketKey);
        if (bucket && bucket.length > 0) {
          const targetMs = dueDate ? dueDate.getTime() : null;
          const matchedEntry =
            bucket.find((e) => !e.used && e.dueMs === targetMs) ||
            bucket.find(
              (e) =>
                !e.used &&
                e.dueMs !== null &&
                targetMs !== null &&
                Math.abs(e.dueMs - targetMs) === 3 * 3600_000,
            );
          if (matchedEntry) {
            matchedEntry.used = true;
            targetActId = matchedEntry.id;
            if (a.id !== targetActId) supersededPecasTaskIds.push(a.id);
            preExistingTasksReconciled++;
          }
        }
      }

      activitiesToUpsertMap.set(targetActId, {
        id: targetActId,
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
      });
    }

    if (supersededPecasTaskIds.length > 0) {
      await tx`
        DELETE FROM crm_deal_activities
        WHERE tenant_id = ${tenantId}
          AND id = ANY(${supersededPecasTaskIds})
      `;
    }

    const activitiesToUpsert = Array.from(activitiesToUpsertMap.values());
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
          description = COALESCE(EXCLUDED.description, crm_deal_activities.description),
          status = CASE
            WHEN crm_deal_activities.status = 'completed' THEN 'completed'
            ELSE EXCLUDED.status
          END,
          due_date = EXCLUDED.due_date,
          completed_at = COALESCE(crm_deal_activities.completed_at, EXCLUDED.completed_at),
          operator_id = EXCLUDED.operator_id,
          assigned_to_operator_id = EXCLUDED.assigned_to_operator_id,
          assigned_to_operator_ids = EXCLUDED.assigned_to_operator_ids,
          updated_at = EXCLUDED.updated_at
      `;
    }

    // 9. Populate Catalog Items (source, campaign, loss_reason)
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

    const summary = {
      tenantId,
      guilhermeOperatorId: guilhermeOp?.id || null,
      guilhermeEmail: guilhermeOp?.email || null,
      keicyOperatorId: keicyOp?.id || null,
      keicyEmail: keicyOp?.email || null,
      keicyPrevDealsReassigned: keicyDealsReassigned,
      pecasPipelineId: pipelineIdRemap.get("pipe-tecfag-pecas"),
      testesPipelineId: testesPipe.id,
      anterioresStageId: anterioresStage.id,
      accountsUpserted: accountsToUpsert.length,
      contactsUpserted: contactsToUpsert.length,
      secondaryPhonesUpserted: secondaryPhonesToUpsert.length,
      dealsUpserted: dealsToUpsert.length,
      fallbackDealsChecked: fallbackDealsToInsert.length,
      dealContactsUpserted: dealContactsToUpsert.length,
      tasksUpserted: activitiesToUpsert.filter((a) => a.type !== "note").length,
      preExistingTasksReconciled,
      notesUpserted: activitiesToUpsert.filter((a) => a.type === "note").length,
      catalogItemsChecked: catalogEntries.length,
    };

    // 10. Record audit log in crm_migration_runs
    await tx`
      INSERT INTO crm_migration_runs (
        id, tenant_id, source, status, source_of_truth, report, started_at, finished_at
      ) VALUES (
        'mig-tecfag-pecas-rd-crm-2026-11-12',
        ${tenantId},
        'rd_station_pecas_csv',
        'completed',
        'rd_primary',
        ${tx.json(summary)},
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        status = 'completed',
        report = EXCLUDED.report,
        finished_at = NOW()
    `;

    return summary;
  });
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    process.argv[1].replace(/\//g, "\\").toLowerCase();

if (isMain) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[pecas rd migration] DATABASE_URL não configurada.");
    process.exit(1);
  }
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  runTecfagPecasRdCrmMigration(sql)
    .then((summary) => {
      console.log("[pecas rd migration] Concluído com sucesso:", summary);
    })
    .catch((err) => {
      console.error("[pecas rd migration] Erro fatal:", err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
