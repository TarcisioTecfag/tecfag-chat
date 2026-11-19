import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import postgres from "postgres";

if (typeof process.loadEnvFile === "function") {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
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

function stableJson(obj) {
  if (!obj || typeof obj !== "object") return JSON.stringify(obj ?? null);
  if (Array.isArray(obj)) return `[${obj.map(stableJson).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

function isGenericOrOperationalSource(raw) {
  const n = normKey(raw);
  if (!n) return true;
  return (
    n === "manual" ||
    n === "chat" ||
    n === "whatsapp" ||
    n === "auto_sdr" ||
    n === "crm" ||
    n === "import_rd" ||
    n === "rd station marketing" ||
    n === "rd station crm" ||
    n === "nao informada" ||
    n === "nao informado" ||
    n === "desconhecido" ||
    n === "desconhecida" ||
    n.startsWith("whatsapp sdr")
  );
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

export async function runTecfagSdrRdCrmMigration(sql, options = {}) {
  const seedUrl = new URL(
    "./data/tecfag-sdr-rd-crm-2026-11-19.json.gz",
    import.meta.url,
  );
  const seedPath = options.seedPath || fileURLToPath(seedUrl);
  if (!existsSync(seedPath)) {
    throw new Error(`Arquivo de seed do FUNIL SDR não encontrado: ${seedPath}`);
  }

  const payload = JSON.parse(gunzipSync(readFileSync(seedPath)).toString("utf8"));
  const tenantId = options.tenantId || payload.tenantId || "tecfag";

  return await sql.begin(async (tx) => {
    await tx`
      INSERT INTO tenants (id, name, slug, connection_type)
      VALUES (${tenantId}, 'Tecfag Informática', ${tenantId}, 'meta')
      ON CONFLICT (id) DO NOTHING
    `;

    // 1. Resolve active operators dynamically (EMAIL -> ID -> NAME; never create fake operators)
    const existingOps = await tx`
      SELECT id, name, email
      FROM operators
      WHERE tenant_id = ${tenantId}
        AND id NOT LIKE 'op-tf-%'
    `;
    const opByKey = new Map();
    for (const spec of payload.operatorSpecs || []) {
      const specEmail = String(spec.email || "").trim().toLowerCase();
      const found =
        (specEmail
          ? existingOps.find(
              (o) => String(o.email || "").trim().toLowerCase() === specEmail,
            )
          : null) ||
        existingOps.find((o) => o.id === spec.id) ||
        existingOps.find((o) => normKey(o.name) === normKey(spec.name)) ||
        null;
      if (found) opByKey.set(spec.key, found);
    }

    // 2. Resolve or ensure FUNIL SDR pipeline & all 8 stages
    const dbPipelines = await tx`
      SELECT id, name
      FROM crm_pipelines
      WHERE tenant_id = ${tenantId}
    `;
    let sdrPipe =
      dbPipelines.find((p) => p.id === "pipe-tecfag-sdr") ||
      dbPipelines.find((p) => {
        const nk = normKey(p.name);
        return nk === "funil sdr" || nk === "sdr" || nk.includes("sdr");
      }) ||
      null;

    if (!sdrPipe) {
      const [created] = await tx`
        INSERT INTO crm_pipelines (
          id, tenant_id, name, order_index, is_default, color, cooling_days, created_at, updated_at
        ) VALUES (
          'pipe-tecfag-sdr', ${tenantId}, 'FUNIL SDR', 4, false, '#8b5cf6', 7, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name
      `;
      sdrPipe = created;
    }

    const dbStages = await tx`
      SELECT id, pipeline_id, name, order_index
      FROM crm_stages
      WHERE tenant_id = ${tenantId}
        AND pipeline_id = ${sdrPipe.id}
      ORDER BY order_index ASC, id ASC
    `;
    const stageIdRemap = new Map();
    for (const s of payload.stages || []) {
      let existingStage =
        dbStages.find((ds) => ds.id === s.id) ||
        dbStages.find((ds) => normKey(ds.name) === normKey(s.name)) ||
        null;
      if (!existingStage) {
        const [createdStg] = await tx`
          INSERT INTO crm_stages (
            id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields, created_at, updated_at
          ) VALUES (
            ${s.id}, ${tenantId}, ${sdrPipe.id}, ${s.name}, ${s.order_index ?? 0},
            false, false, '[]'::jsonb, NOW(), NOW()
          )
          ON CONFLICT (id) DO UPDATE SET pipeline_id = EXCLUDED.pipeline_id, name = EXCLUDED.name
          RETURNING id, pipeline_id, name, order_index
        `;
        existingStage = createdStg;
        dbStages.push(existingStage);
      }
      stageIdRemap.set(s.id, existingStage.id);
    }

    // 3. Ensure extended custom field definitions exist
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

    // 4. Reconcile & Upsert Companies (crm_accounts) — zero duplicates (CPF/CNPJ -> rd_organization_id -> normalized name -> id)
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
    let accountsReused = 0;
    let accountsCreated = 0;

    for (const acc of payload.accounts || []) {
      const rawDoc = String(acc.document || "").replace(/\D/g, "");
      const cleanDoc =
        (rawDoc.length === 11 || rawDoc.length === 14) && !/^(\d)\1+$/.test(rawDoc)
          ? rawDoc
          : "";

      let targetId = null;
      if (cleanDoc && claimedDocs.has(cleanDoc)) {
        targetId = claimedDocs.get(cleanDoc);
      } else if (acc.rd_organization_id && dbAccByRdOrg.has(acc.rd_organization_id)) {
        targetId = dbAccByRdOrg.get(acc.rd_organization_id);
      } else if (acc.name && dbAccByName.has(normKey(acc.name))) {
        targetId = dbAccByName.get(normKey(acc.name));
      } else if (dbAccById.has(acc.id)) {
        targetId = acc.id;
      }

      const existedInDb = Boolean(targetId && dbAccById.has(targetId));
      if (!targetId) {
        targetId = acc.id;
        accountsCreated++;
      } else if (existedInDb && !accountsToUpsertMap.has(targetId)) {
        accountsReused++;
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
          document_type: safeDoc ? (safeDoc.length === 11 ? "CPF" : "CNPJ") : null,
          document: safeDoc,
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
          rd_organization_id = COALESCE(crm_accounts.rd_organization_id, EXCLUDED.rd_organization_id),
          updated_at = NOW()
      `;
    }

    // 5. Reconcile & Upsert Contacts (contacts + contact_phones) — zero duplicates across BOTH tables
    const dbContacts = await tx`
      SELECT
        id,
        name,
        phone,
        email,
        cnpj,
        account_id,
        first_source,
        first_campaign,
        custom_fields,
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
      if (c.email) dbContactByEmail.set(String(c.email).trim().toLowerCase(), c.id);
      if (!pId && c.name) {
        dbContactByNameAcc.set(`${c.account_id || "noacc"}:${normKey(c.name)}`, c.id);
      }
    }
    for (const cp of dbContactPhones) {
      const pId = cp.phone_identity || pgContactPhoneIdentity(cp.phone);
      if (pId && pId.length >= 8) {
        existingCpPairs.add(`${cp.contact_id}:${pId}`);
        if (!claimedPhoneId.has(pId)) claimedPhoneId.set(pId, cp.contact_id);
      }
    }

    const contactIdRemap = new Map();
    const contactsToUpsertMap = new Map();
    const secondaryPhonesMap = new Map();
    let contactsReused = 0;
    let contactsCreated = 0;

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
      const rawList = Array.isArray(c.phones) ? [...c.phones] : [];
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
      if (!targetId && !primaryIdentity && dbContactByNameAcc.has(nameAccKey)) {
        targetId = dbContactByNameAcc.get(nameAccKey);
      }

      const existedInDb = Boolean(targetId && dbContactById.has(targetId));
      if (!targetId) {
        targetId = dbContactById.has(c.id) ? `${c.id}-sdr` : c.id;
        contactsCreated++;
      } else if (existedInDb && !contactsToUpsertMap.has(targetId)) {
        contactsReused++;
      }

      contactIdRemap.set(c.id, targetId);
      if (emailClean && !dbContactByEmail.has(emailClean)) {
        dbContactByEmail.set(emailClean, targetId);
      }
      if (!primaryIdentity && !dbContactByNameAcc.has(nameAccKey)) {
        dbContactByNameAcc.set(nameAccKey, targetId);
      }

      const existingDb = dbContactById.get(targetId);
      const resolvedOp = c.wallet_operator_key ? opByKey.get(c.wallet_operator_key) || null : null;
      const dt = c.created_at ? new Date(c.created_at) : new Date();
      const effectiveAccId = existingDb?.account_id || mappedAccId || null;
      if (effectiveAccId) resolvedContactAccountById.set(targetId, effectiveAccId);

      const contactCf = c.cargo ? { cargo: c.cargo } : {};

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
          wallet_operator_id: resolvedOp?.id || null,
          responsible_name: resolvedOp?.name || "Sem responsável",
          main_channel: "whatsapp",
          entry_channel: "import_rd",
          first_source: c.first_source || null,
          first_campaign: c.first_campaign || null,
          custom_fields: contactCf,
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
        if (!cur.first_source && c.first_source) cur.first_source = c.first_source;
        if (!cur.first_campaign && c.first_campaign) cur.first_campaign = c.first_campaign;
        if (c.cargo && !cur.custom_fields.cargo) cur.custom_fields.cargo = c.cargo;

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
          "entry_channel",
          "first_source",
          "first_campaign",
          "custom_fields",
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
          email = COALESCE(NULLIF(btrim(contacts.email), ''), EXCLUDED.email),
          cnpj = COALESCE(NULLIF(btrim(contacts.cnpj), ''), EXCLUDED.cnpj),
          first_source = COALESCE(NULLIF(btrim(contacts.first_source), ''), EXCLUDED.first_source),
          first_campaign = COALESCE(NULLIF(btrim(contacts.first_campaign), ''), EXCLUDED.first_campaign),
          custom_fields = COALESCE(EXCLUDED.custom_fields, '{}'::jsonb) || COALESCE(contacts.custom_fields, '{}'::jsonb)
      `;
    }

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

    // 6. Reconcile Deals in 2 Layers (Layer 1: rd_deal_id / id; Layer 2: same contact + title or ±24h in FUNIL SDR without rd_deal_id)
    const dbDeals = await tx`
      SELECT
        id,
        rd_deal_id,
        title,
        pipeline_id,
        original_pipeline_id,
        stage_id,
        status,
        account_id,
        source,
        campaign,
        loss_reason,
        paused_reason,
        rating,
        closed_at,
        expected_close_date,
        custom_fields,
        created_at
      FROM crm_deals
      WHERE tenant_id = ${tenantId}
    `;
    const dbDealContacts = await tx`
      SELECT deal_id, contact_id
      FROM crm_deal_contacts
      WHERE tenant_id = ${tenantId}
    `;

    const dbDealById = new Map();
    const dbDealByRdId = new Map();
    const sdrDealsWithoutRdByContact = new Map();
    for (const d of dbDeals) {
      dbDealById.set(d.id, d);
      if (d.rd_deal_id) dbDealByRdId.set(String(d.rd_deal_id).trim(), d);
    }
    for (const dc of dbDealContacts) {
      const d = dbDealById.get(dc.deal_id);
      if (
        d &&
        (d.pipeline_id === sdrPipe.id || d.original_pipeline_id === sdrPipe.id) &&
        !d.rd_deal_id
      ) {
        if (!sdrDealsWithoutRdByContact.has(dc.contact_id)) {
          sdrDealsWithoutRdByContact.set(dc.contact_id, []);
        }
        sdrDealsWithoutRdByContact.get(dc.contact_id).push(d);
      }
    }

    // Group payload contacts per payload deal ID (already remapped to resolved contact IDs)
    const payloadContactsByDealId = new Map();
    const fallbackContactAccByDealId = new Map();
    for (const dc of payload.dealContacts || []) {
      const mappedContId = contactIdRemap.get(dc.contact_id) || dc.contact_id;
      if (!payloadContactsByDealId.has(dc.deal_id)) {
        payloadContactsByDealId.set(dc.deal_id, []);
      }
      payloadContactsByDealId.get(dc.deal_id).push(mappedContId);
      if (!fallbackContactAccByDealId.has(dc.deal_id)) {
        const contAccId = resolvedContactAccountById.get(mappedContId);
        if (contAccId) fallbackContactAccByDealId.set(dc.deal_id, contAccId);
      }
    }

    const dealIdRemap = new Map();
    const claimedFuzzyExistingDealIds = new Set();
    const dealsToInsert = [];
    const dealsToEnrich = [];
    let dealsMatchedByRdId = 0;
    let dealsMatchedByContactFuzzy = 0;

    for (const d of payload.deals || []) {
      const mappedAccId = d.account_id
        ? accountIdRemap.get(d.account_id) || d.account_id
        : fallbackContactAccByDealId.get(d.id) || null;
      const resolvedOp = d.operator_key ? opByKey.get(d.operator_key) || null : null;
      const mappedStageId = stageIdRemap.get(d.stage_id) || d.stage_id;

      const createdAt = d.created_at ? new Date(d.created_at) : new Date();
      const updatedAt = d.updated_at ? new Date(d.updated_at) : createdAt;
      const lastActAt = d.last_activity_at ? new Date(d.last_activity_at) : updatedAt;
      const closedAt = d.closed_at ? new Date(d.closed_at) : null;
      const wonAt = d.won_at ? new Date(d.won_at) : null;
      const lostAt = d.lost_at ? new Date(d.lost_at) : null;
      const expClose = d.expected_close_date ? new Date(d.expected_close_date) : null;

      // Layer 1: Exact RD ID or deterministic deal-rd-<id>
      let matchedExisting =
        (d.rd_deal_id ? dbDealByRdId.get(String(d.rd_deal_id).trim()) : null) ||
        dbDealById.get(d.id) ||
        null;

      if (matchedExisting) {
        dealsMatchedByRdId++;
      } else {
        // Layer 2: Same resolved contact in FUNIL SDR without rd_deal_id (same title OR within ±24h)
        const linkedContacts = payloadContactsByDealId.get(d.id) || [];
        const targetTitleKey = normKey(d.title);
        const createdMs = createdAt.getTime();
        for (const cid of linkedContacts) {
          const candidates = sdrDealsWithoutRdByContact.get(cid) || [];
          const hit = candidates.find((cand) => {
            if (claimedFuzzyExistingDealIds.has(cand.id)) return false;
            if (normKey(cand.title) === targetTitleKey) return true;
            const candMs = cand.created_at ? new Date(cand.created_at).getTime() : NaN;
            return Number.isFinite(candMs) && Math.abs(candMs - createdMs) <= 24 * 3600_000;
          });
          if (hit) {
            matchedExisting = hit;
            claimedFuzzyExistingDealIds.add(hit.id);
            dealsMatchedByContactFuzzy++;
            break;
          }
        }
      }

      if (matchedExisting) {
        dealIdRemap.set(d.id, matchedExisting.id);

        // Enrich ONLY empty/missing fields — NEVER touch pipeline_id, stage_id, status, operator_id, title, value, updated_at
        const existingCf =
          matchedExisting.custom_fields && typeof matchedExisting.custom_fields === "object"
            ? matchedExisting.custom_fields
            : {};
        const incomingCf = d.custom_fields && typeof d.custom_fields === "object" ? d.custom_fields : {};
        const mergedCf = { ...incomingCf };
        for (const [k, v] of Object.entries(existingCf)) {
          if (v !== null && v !== undefined && v !== "") {
            mergedCf[k] = v;
          }
        }

        const nextSource =
          isGenericOrOperationalSource(matchedExisting.source) && d.source && !isGenericOrOperationalSource(d.source)
            ? d.source
            : matchedExisting.source || d.source || null;
        const nextCampaign =
          matchedExisting.campaign && String(matchedExisting.campaign).trim()
            ? matchedExisting.campaign
            : d.campaign || null;
        const nextAccountId = matchedExisting.account_id || mappedAccId || null;
        const nextLossReason = matchedExisting.loss_reason || d.loss_reason || null;
        const nextPausedReason = matchedExisting.paused_reason || d.paused_reason || null;
        const nextRating = Number(matchedExisting.rating || 0) > 0 ? Number(matchedExisting.rating) : Number(d.rating || 0);
        const nextClosedAt = matchedExisting.closed_at || closedAt;
        const nextExpClose = matchedExisting.expected_close_date || expClose;
        const nextRdDealId = matchedExisting.rd_deal_id || d.rd_deal_id || null;
        const nextRdDealUrl = nextRdDealId
          ? `https://crm.rdstation.com/app/deals/${nextRdDealId}`
          : null;

        const cfChanged = stableJson(mergedCf) !== stableJson(existingCf);
        const fieldsChanged =
          nextSource !== matchedExisting.source ||
          nextCampaign !== matchedExisting.campaign ||
          nextAccountId !== matchedExisting.account_id ||
          nextLossReason !== matchedExisting.loss_reason ||
          nextPausedReason !== matchedExisting.paused_reason ||
          nextRating !== Number(matchedExisting.rating || 0) ||
          nextRdDealId !== matchedExisting.rd_deal_id ||
          (!matchedExisting.closed_at && Boolean(nextClosedAt)) ||
          (!matchedExisting.expected_close_date && Boolean(nextExpClose)) ||
          cfChanged;

        if (fieldsChanged) {
          dealsToEnrich.push({
            id: matchedExisting.id,
            account_id: nextAccountId,
            source: nextSource,
            campaign: nextCampaign,
            loss_reason: nextLossReason,
            paused_reason: nextPausedReason,
            rating: nextRating,
            closed_at: nextClosedAt,
            expected_close_date: nextExpClose,
            rd_deal_id: nextRdDealId,
            rd_deal_url: nextRdDealUrl,
            custom_fields: mergedCf,
          });
        }
      } else {
        dealIdRemap.set(d.id, d.id);
        const sector = d.is_test ? "teste" : "pre_venda";
        dealsToInsert.push({
          id: d.id,
          tenant_id: tenantId,
          title: d.title,
          account_id: mappedAccId,
          pipeline_id: sdrPipe.id,
          original_pipeline_id: sdrPipe.id,
          stage_id: mappedStageId,
          status: d.status || "open",
          value: String(d.value || "0.00"),
          currency: d.currency || "BRL",
          expected_close_date: expClose,
          operator_id: resolvedOp?.id || null,
          entry_channel: "import_rd",
          source: d.source || null,
          campaign: d.campaign || null,
          rating: Number(d.rating || 0),
          loss_reason: d.loss_reason || null,
          paused_reason: d.paused_reason || null,
          rd_deal_id: d.rd_deal_id || null,
          rd_deal_url: d.rd_deal_id
            ? `https://crm.rdstation.com/app/deals/${d.rd_deal_id}`
            : null,
          sector_origin: sector,
          sector_current: sector,
          is_test: Boolean(d.is_test),
          is_legacy: false,
          won_at: wonAt,
          lost_at: lostAt,
          custom_fields: d.custom_fields || {},
          last_activity_at: lastActAt,
          closed_at: closedAt,
          created_at: createdAt,
          updated_at: updatedAt,
        });
      }
    }

    // Insert ONLY truly missing deals
    for (let i = 0; i < dealsToInsert.length; i += BATCH) {
      const slice = dealsToInsert.slice(i, i + BATCH);
      await tx`
        INSERT INTO crm_deals ${tx(
          slice,
          "id",
          "tenant_id",
          "title",
          "account_id",
          "pipeline_id",
          "original_pipeline_id",
          "stage_id",
          "status",
          "value",
          "currency",
          "expected_close_date",
          "operator_id",
          "entry_channel",
          "source",
          "campaign",
          "rating",
          "loss_reason",
          "paused_reason",
          "rd_deal_id",
          "rd_deal_url",
          "sector_origin",
          "sector_current",
          "is_test",
          "is_legacy",
          "won_at",
          "lost_at",
          "custom_fields",
          "last_activity_at",
          "closed_at",
          "created_at",
          "updated_at",
        )}
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // Enrich existing deals non-destructively (only missing fields)
    for (const e of dealsToEnrich) {
      await tx`
        UPDATE crm_deals
        SET
          account_id = ${e.account_id},
          source = ${e.source},
          campaign = ${e.campaign},
          loss_reason = ${e.loss_reason},
          paused_reason = ${e.paused_reason},
          rating = ${e.rating},
          closed_at = ${e.closed_at},
          expected_close_date = ${e.expected_close_date},
          rd_deal_id = ${e.rd_deal_id},
          rd_deal_url = ${e.rd_deal_url},
          custom_fields = ${tx.json(e.custom_fields)}
        WHERE id = ${e.id} AND tenant_id = ${tenantId}
      `;
    }

    // 7. Link Contacts <-> Deals (crm_deal_contacts) using RESOLVED IDs — zero duplicate links
    const seenDealContactPairs = new Set();
    const dealContactsToUpsert = [];
    for (const dc of payload.dealContacts || []) {
      const resolvedDealId = dealIdRemap.get(dc.deal_id) || dc.deal_id;
      const resolvedContactId = contactIdRemap.get(dc.contact_id) || dc.contact_id;
      const pairKey = `${resolvedDealId}:${resolvedContactId}`;
      if (seenDealContactPairs.has(pairKey)) continue;
      seenDealContactPairs.add(pairKey);
      dealContactsToUpsert.push({
        id: `dc-sdr-${md5Short(pairKey)}`,
        tenant_id: tenantId,
        deal_id: resolvedDealId,
        contact_id: resolvedContactId,
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
          is_primary = (crm_deal_contacts.is_primary OR EXCLUDED.is_primary)
      `;
    }

    // 8. Ensure Catalog Options (source, campaign, loss_reason) exist in crm_catalog_items
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
        id: `cat-${tenantId}-${kind}-${code.slice(0, 32)}-${md5Short(name.toLowerCase())}`.slice(
          0,
          80,
        ),
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

    const existingCatalog = await tx`
      SELECT kind, lower(name) AS lower_name
      FROM crm_catalog_items
      WHERE tenant_id = ${tenantId}
    `;
    const existingCatalogSet = new Set(
      existingCatalog.map((c) => `${c.kind}:${c.lower_name}`),
    );

    let catalogInserted = 0;
    for (const item of catalogEntries) {
      const key = `${item.kind}:${item.name.toLowerCase()}`;
      if (existingCatalogSet.has(key)) continue;
      existingCatalogSet.add(key);
      await tx`
        INSERT INTO crm_catalog_items (
          id, tenant_id, kind, name, created_at, updated_at
        ) VALUES (
          ${item.id}, ${item.tenant_id}, ${item.kind}, ${item.name}, NOW(), NOW()
        )
        ON CONFLICT DO NOTHING
      `;
      catalogInserted++;
    }

    return {
      sdrPipelineId: sdrPipe.id,
      totalCsvDeals: (payload.deals || []).length,
      dealsInserted: dealsToInsert.length,
      dealsMatchedByRdId,
      dealsMatchedByContactFuzzy,
      dealsEnriched: dealsToEnrich.length,
      accountsCreated,
      accountsReused,
      contactsCreated,
      contactsReused,
      secondaryPhonesAdded: secondaryPhonesToUpsert.length,
      dealContactsLinked: dealContactsToUpsert.length,
      catalogInserted,
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
    console.error("[sdr rd migration] DATABASE_URL não configurada.");
    process.exit(1);
  }
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  runTecfagSdrRdCrmMigration(sql)
    .then((summary) => {
      console.log("[sdr rd migration] Concluído com sucesso:", summary);
    })
    .catch((err) => {
      console.error("[sdr rd migration] Erro fatal:", err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
