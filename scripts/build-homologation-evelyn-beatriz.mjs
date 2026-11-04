import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import XLSX from "xlsx";

const DEAL_CSV_PATH =
  "C:/Users/TEC FAG/Downloads/Nova pasta (63)/673b397d6c7532001f2b0508_deal_export_2026-11-04_08_11.csv";
const TASK_CSV_PATH =
  "C:/Users/TEC FAG/Downloads/Nova pasta (63)/673b397d6c7532001f2b0508_task_export_2026-11-04_08_12.csv";
const FULL_SEED_PATH = path.resolve("scripts/data/tecfag-crm-seed.json.gz");
const OUTPUT_SEED_PATH = path.resolve(
  "scripts/data/tecfag-homologation-evelyn-beatriz.json.gz",
);

function readRdCsv(filePath) {
  let raw = fs.readFileSync(filePath, "utf8");
  raw = raw.replace(/^\uFEFF/, "").replace(/^sep=,[\r\n]+/i, "");
  const wb = XLSX.read(raw, { type: "string", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function normKey(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseBrDateTime(dateStr, timeStr) {
  const d = String(dateStr || "").trim();
  if (!d) return null;
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, day, month, year] = m;
    const t = String(timeStr || "").trim();
    const tm = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const hh = tm ? tm[1].padStart(2, "0") : "12";
    const mm = tm ? tm[2].padStart(2, "0") : "00";
    const ss = tm && tm[3] ? tm[3].padStart(2, "0") : "00";
    const dt = new Date(`${year}-${month}-${day}T${hh}:${mm}:${ss}-03:00`);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  const iso = new Date(d);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  return null;
}

function parseBrNumeric(val) {
  if (typeof val === "number") return Number.isFinite(val) ? val.toFixed(2) : "0.00";
  const s = String(val || "").trim();
  if (!s) return "0.00";
  if (s.includes(",") && s.includes(".")) {
    const cleaned = s.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
  }
  if (s.includes(",")) {
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
  }
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
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

function normalizeSinglePhone(rawPhone) {
  let digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  if (digits.startsWith("00") && digits.length > 11) {
    digits = digits.slice(2);
  }
  digits = digits.replace(/^0+/, "");
  if (digits.length < 8) return "";
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = "55" + digits;
  }
  return digits;
}

function extractPhoneCandidates(rawCell) {
  const parts = String(rawCell || "")
    .split(/[;,/|\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  const seenId = new Set();
  for (const part of parts) {
    const norm = normalizeSinglePhone(part);
    const id = contactPhoneIdentity(norm);
    if (norm && id && !seenId.has(id)) {
      seenId.add(id);
      out.push({ phone: norm, identity: id });
    }
  }
  return out;
}

function extractCleanDocument(orgName, infoComp) {
  const candidates = [];
  const info = String(infoComp || "");
  const mInfo = info.match(/CNPJ\s*\/?\s*CPF\s*:\s*([0-9.\-\/]+)/i);
  if (mInfo) candidates.push(mInfo[1]);

  const org = String(orgName || "");
  const mCnpj = org.match(/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/);
  if (mCnpj) candidates.push(mCnpj[1]);
  const mCpf = org.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);
  if (mCpf) candidates.push(mCpf[1]);

  for (const cand of candidates) {
    const digits = String(cand).replace(/\D/g, "");
    if (
      (digits.length === 11 || digits.length === 14) &&
      !/^(\d)\1+$/.test(digits)
    ) {
      return digits;
    }
  }
  return null;
}

function mapOperatorKey(rawName) {
  const k = normKey(rawName);
  if (k.includes("beatriz")) return "beatriz";
  if (k.includes("evelyn")) return "evelyn";
  if (k.includes("fernando")) return "fernando";
  return null;
}

const STAGE_MAP_MAQUINAS = {
  [normKey("LEADS RECEBIDOS")]: "stg-tf-maq-leads-recebidos",
  [normKey("ABORDAGEM COMERCIAL")]: "stg-tf-maq-abordagem-comercial",
  [normKey("ESFRIANDO")]: "stg-tf-maq-esfriando",
  [normKey("QUALIFICADO")]: "stg-tf-maq-qualificado",
  [normKey("PROPOSTA ENVIADA")]: "stg-tf-maq-proposta-enviada",
  [normKey("FECHAMENTO")]: "stg-tf-maq-fechamento",
  [normKey("REQUALIFICAÇÃO")]: "stg-tf-maq-requalificacao",
};

const CF_IDS = {
  PRODUTO_FABRICADO: "cf-6301c0e7-a9df-422d-99f0-524cb88b2f30",
  ONDE_AJUDA: "cf-dbf17e8d-6657-4dea-8914-2fb60ab3cc3f",
  COMO_FEITO_HOJE: "cf-3d854c1d-03eb-43ab-9959-394a4792fe8b",
  VOLUME_PRODUCAO: "cf-39e7205f-b6bb-4522-8a6e-03e3180b1025",
  EXPECTATIVA_USO: "cf-4c8d4c1d-ef02-4dfe-82b2-64b0e7aaa5b9",
  NIVEL_AUTOMACAO: "cf-a3669215-f9e7-46fd-a2e9-754ca2356ef3",
};

const dealRows = readRdCsv(DEAL_CSV_PATH);
const taskRows = readRdCsv(TASK_CSV_PATH);
const fullSeed = JSON.parse(
  zlib.gunzipSync(fs.readFileSync(FULL_SEED_PATH)).toString("utf8"),
);

// 1. Catalog state for Accounts, Contacts, Deals, DealContacts, Activities
const accountsById = new Map();
const accountIdByRdOrg = new Map();
const accountIdByDoc = new Map();
const accountIdByName = new Map();

const contactsById = new Map();
const contactIdByPhoneIdentity = new Map();
const contactIdByRdId = new Map();
const contactIdByEmail = new Map();
const contactIdByNameAcc = new Map();

const dealsById = new Map();
const dealContactsKeySet = new Set();
const dealContacts = [];
const activities = [];

function upsertAccount({
  rdOrgId,
  name,
  cleanDoc,
  email,
  phone,
  createdAt,
  preferredId,
}) {
  const trimmedName = String(name || "").trim();
  const doc =
    cleanDoc &&
    (cleanDoc.length === 11 || cleanDoc.length === 14) &&
    !/^(\d)\1+$/.test(cleanDoc)
      ? cleanDoc
      : null;

  if (!trimmedName && !doc && !rdOrgId) return null;

  let accId = null;
  if (rdOrgId && accountIdByRdOrg.has(rdOrgId)) {
    accId = accountIdByRdOrg.get(rdOrgId);
  }
  if (!accId && doc && accountIdByDoc.has(doc)) {
    accId = accountIdByDoc.get(doc);
  }
  const nKey = trimmedName ? normKey(trimmedName) : "";
  if (!accId && nKey && accountIdByName.has(nKey)) {
    accId = accountIdByName.get(nKey);
  }

  if (!accId) {
    accId =
      preferredId ||
      (rdOrgId
        ? `acc-rd-${rdOrgId}`
        : `acc-hb-${accountsById.size + 1}`);
    const isPerson = doc && doc.length === 11;
    accountsById.set(accId, {
      id: accId,
      type: isPerson ? "person" : "company",
      name: trimmedName || (doc ? `Documento ${doc}` : "Empresa sem nome"),
      trade_name: trimmedName || null,
      document_type: doc ? (doc.length === 11 ? "CPF" : "CNPJ") : null,
      document: doc && !accountIdByDoc.has(doc) ? doc : null,
      email: email || null,
      phone: phone || null,
      rd_organization_id: rdOrgId || null,
      created_at: createdAt || new Date().toISOString(),
    });
  } else {
    const existing = accountsById.get(accId);
    if (existing) {
      if (!existing.document && doc && !accountIdByDoc.has(doc)) {
        existing.document = doc;
        existing.document_type = doc.length === 11 ? "CPF" : "CNPJ";
      }
      if (!existing.email && email) existing.email = email;
      if (!existing.phone && phone) existing.phone = phone;
      if (!existing.rd_organization_id && rdOrgId) {
        existing.rd_organization_id = rdOrgId;
      }
    }
  }

  const finalAcc = accountsById.get(accId);
  if (rdOrgId) accountIdByRdOrg.set(rdOrgId, accId);
  if (finalAcc?.document) accountIdByDoc.set(finalAcc.document, accId);
  if (nKey) accountIdByName.set(nKey, accId);
  return accId;
}

function upsertContact({
  rdContactId,
  name,
  rawPhone,
  rawEmail,
  role,
  accountId,
  operatorKey,
  cleanDoc,
  createdAt,
  preferredId,
}) {
  const trimmedName = String(name || "").trim() || "Contato sem nome";
  const emailParts = String(rawEmail || "")
    .split(/[;,|\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
  const email = emailParts[0] || null;

  const phoneCandidates = extractPhoneCandidates(rawPhone);
  let chosenPhone = "";
  let chosenIdentity = "";
  if (phoneCandidates.length > 0) {
    chosenPhone = phoneCandidates[0].phone;
    chosenIdentity = phoneCandidates[0].identity;
  }

  let contactId = null;
  // Priority 1: Phone identity (strict DB trigger uniqueness)
  if (chosenIdentity && contactIdByPhoneIdentity.has(chosenIdentity)) {
    contactId = contactIdByPhoneIdentity.get(chosenIdentity);
  }
  // Priority 2: RD Contact ID
  if (!contactId && rdContactId && contactIdByRdId.has(rdContactId)) {
    const candidateId = contactIdByRdId.get(rdContactId);
    const existing = contactsById.get(candidateId);
    if (!chosenIdentity || !existing.phoneIdentity || existing.phoneIdentity === chosenIdentity) {
      contactId = candidateId;
    }
  }
  // Priority 3: Email (only when phone identity doesn't conflict)
  if (!contactId && email && contactIdByEmail.has(email)) {
    const candidateId = contactIdByEmail.get(email);
    const existing = contactsById.get(candidateId);
    if (!chosenIdentity || !existing.phoneIdentity || existing.phoneIdentity === chosenIdentity) {
      contactId = candidateId;
    }
  }
  // Priority 4: Same name + account when no phone
  const nameAccKey = `${accountId || "noacc"}:${normKey(trimmedName)}`;
  if (!contactId && !chosenIdentity && contactIdByNameAcc.has(nameAccKey)) {
    contactId = contactIdByNameAcc.get(nameAccKey);
  }

  if (!contactId) {
    contactId =
      preferredId && !contactsById.has(preferredId)
        ? preferredId
        : rdContactId && !contactsById.has(`cont-rd-${rdContactId}`)
          ? `cont-rd-${rdContactId}`
          : `cont-hb-${contactsById.size + 1}`;
    contactsById.set(contactId, {
      id: contactId,
      name: trimmedName,
      phone: chosenPhone || "",
      phoneIdentity: chosenIdentity || "",
      email: email || null,
      cnpj: cleanDoc || null,
      account_id: accountId || null,
      wallet_operator_key: operatorKey || null,
      role: role || null,
      rd_contact_id: rdContactId || null,
      created_at: createdAt || new Date().toISOString(),
    });
  } else {
    const existing = contactsById.get(contactId);
    if (existing) {
      if (!existing.account_id && accountId) existing.account_id = accountId;
      if (!existing.email && email) existing.email = email;
      if (!existing.cnpj && cleanDoc) existing.cnpj = cleanDoc;
      if (!existing.wallet_operator_key && operatorKey) {
        existing.wallet_operator_key = operatorKey;
      }
      if (!existing.phone && chosenPhone && !contactIdByPhoneIdentity.has(chosenIdentity)) {
        existing.phone = chosenPhone;
        existing.phoneIdentity = chosenIdentity;
      }
    }
  }

  const finalContact = contactsById.get(contactId);
  if (finalContact.phoneIdentity) {
    contactIdByPhoneIdentity.set(finalContact.phoneIdentity, contactId);
  }
  if (rdContactId) contactIdByRdId.set(rdContactId, contactId);
  if (email) contactIdByEmail.set(email, contactId);
  contactIdByNameAcc.set(nameAccKey, contactId);
  return contactId;
}

function linkDealContact(dealId, contactId, role, isPrimary, createdAt) {
  if (!dealId || !contactId) return;
  const key = `${dealId}:${contactId}`;
  if (dealContactsKeySet.has(key)) return;
  dealContactsKeySet.add(key);
  dealContacts.push({
    id: `dc-hb-${dealContacts.length + 1}`,
    deal_id: dealId,
    contact_id: contactId,
    role: role ? String(role).slice(0, 80) : "buyer",
    is_primary: Boolean(isPrimary),
    created_at: createdAt || new Date().toISOString(),
  });
}

// 2. Process all 1,657 rows from deal_export
for (const row of dealRows) {
  const rdDealId = String(row["ID"] || "").trim();
  if (!rdDealId) continue;

  const dealId = `deal-rd-${rdDealId}`;
  const title = String(row["Nome"] || "Negociação sem título").trim();
  const orgName = String(row["Empresa"] || "").trim();
  const rdOrgId = String(row["ID da Empresa"] || "").trim();
  const infoComp = String(row["INFORMAÇÕES COMPLEMENTARES"] || "").trim();
  const cleanDoc = extractCleanDocument(orgName, infoComp);

  const createdAt =
    parseBrDateTime(row["Data de criação"], row["Hora de criação"]) ||
    new Date().toISOString();
  const closedAt = parseBrDateTime(
    row["Data de fechamento"],
    row["Hora de fechamento"],
  );
  const lastContactAt = parseBrDateTime(
    row["Data do último contato"],
    row["Hora do último contato"],
  );
  const expectedCloseDate = parseBrDateTime(
    row["Previsão de fechamento"],
    "12:00",
  );

  const operatorKey = mapOperatorKey(row["Responsável"]) || "beatriz";
  const rawPhones = extractPhoneCandidates(row["Telefone"]);
  const primaryPhone = rawPhones[0]?.phone || null;
  const rawEmail = String(row["Email"] || "").trim() || null;

  // Create/Upsert Account if orgName, rdOrgId, or cleanDoc exists
  const accountName = orgName || (cleanDoc ? title : "");
  const accountId = upsertAccount({
    rdOrgId,
    name: accountName,
    cleanDoc,
    email: rawEmail,
    phone: primaryPhone,
    createdAt,
  });

  // Create/Upsert Contact (always ensure a contact is created & linked)
  const contactName =
    String(row["Contatos"] || "").trim() ||
    String(row["Lead"] || "").trim() ||
    orgName ||
    title;
  const rdContactId =
    String(row["ID do Contato"] || "").trim() ||
    String(row["ID do Lead"] || "").trim() ||
    null;
  const contactRole = String(row["Cargo"] || "").trim() || "buyer";

  const contactId = upsertContact({
    rdContactId,
    name: contactName,
    rawPhone: row["Telefone"],
    rawEmail: row["Email"],
    role: contactRole,
    accountId,
    operatorKey,
    cleanDoc,
    createdAt,
  });

  const contactObj = contactsById.get(contactId);
  const resolvedAccountId = accountId || contactObj?.account_id || null;
  if (resolvedAccountId && contactObj && !contactObj.account_id) {
    contactObj.account_id = resolvedAccountId;
  }

  if (!dealsById.has(dealId)) {
    const stageId =
      STAGE_MAP_MAQUINAS[normKey(row["Etapa"])] || "stg-tf-maq-leads-recebidos";

    const estadoNorm = normKey(row["Estado"]);
    const pausadaNorm = normKey(row["Pausada"]);
    let status = "open";
    if (pausadaNorm === "sim") status = "paused";
    else if (estadoNorm === "vendida" || estadoNorm === "ganha") status = "won";
    else if (estadoNorm === "perdida") status = "lost";

    const value = parseBrNumeric(row["Valor Único"]);
    const ratingNum = parseInt(String(row["Qualificação"] || "0"), 10);
    const rating =
      Number.isFinite(ratingNum) && ratingNum >= 0 && ratingNum <= 5
        ? ratingNum
        : 0;

    const rawLossReason = String(row["Motivo de Perda"] || "").trim();
    const lossReason =
      rawLossReason && normKey(rawLossReason) !== "nada" ? rawLossReason : null;
    const rawSource = String(row["Fonte"] || "").trim();
    const source =
      rawSource && normKey(rawSource) !== "desconhecido" ? rawSource : null;
    const rawCampaign = String(row["Campanha"] || "").trim();
    const campaign =
      rawCampaign && normKey(rawCampaign) !== "desconhecido"
        ? rawCampaign
        : null;

    const customFields = {};
    const vProd = String(
      row["QUAL O PRODUTO FABRICADO?"] ||
        row["QUAL O TIPO DE PRODUTO DO CLIENTE"] ||
        row["QUAL O TIPO DE PRODUTO? T"] ||
        "",
    ).trim();
    if (vProd) customFields[CF_IDS.PRODUTO_FABRICADO] = vProd;

    const vAjuda = String(row["ONDE O CLIENTE PRECISA DE AJUDA?"] || "").trim();
    if (vAjuda) customFields[CF_IDS.ONDE_AJUDA] = vAjuda;

    const vComo = String(row["COMO É FEITO HOJE?"] || "").trim();
    if (vComo) customFields[CF_IDS.COMO_FEITO_HOJE] = vComo;

    const vVol = String(
      row["VOLUME DE PRODUÇÃO?"] || row["PRODUÇÃO DESEJADA POR HORA"] || "",
    ).trim();
    if (vVol) customFields[CF_IDS.VOLUME_PRODUCAO] = vVol;

    const vExp = String(row["EXPECTATIVA DE USO?"] || "").trim();
    if (vExp) customFields[CF_IDS.EXPECTATIVA_USO] = vExp;

    const vAut = String(row["NÍVEL DE AUTOMAÇÃO EXIGIDO"] || "").trim();
    if (vAut) customFields[CF_IDS.NIVEL_AUTOMACAO] = vAut;

    if (infoComp) customFields.informacoes_complementares = infoComp;
    const descRd = String(row["DESCRIÇÃO"] || "").trim();
    if (descRd) customFields.descricao_rd = descRd;
    const lossNote = String(row["Anotação do motivo de perda"] || "").trim();
    if (lossNote) customFields.anotacao_motivo_perda = lossNote;
    const produtosRd = String(row["Produtos"] || "").trim();
    if (produtosRd) customFields.produtos_rd = produtosRd;
    const qualSdr = String(row["QUALIFICADO POR SDR"] || "").trim();
    if (qualSdr) customFields.qualificado_por_sdr = qualSdr;
    const propRd = String(row["PROPOSTA"] || row["PROPOSTA."] || "").trim();
    if (propRd) customFields.proposta_rd = propRd;

    const updatedAt = closedAt || lastContactAt || createdAt;

    dealsById.set(dealId, {
      id: dealId,
      title,
      account_id: resolvedAccountId,
      pipeline_id: "pipe-tecfag-maquinas-2-0",
      stage_id: stageId,
      status,
      value,
      currency: "BRL",
      expected_close_date: expectedCloseDate,
      operator_key: operatorKey,
      source,
      campaign,
      rating,
      loss_reason: lossReason,
      paused_reason: status === "paused" ? "Pausada no RD Station" : null,
      rd_deal_id: rdDealId,
      custom_fields: customFields,
      last_activity_at: updatedAt,
      closed_at: status === "won" || status === "lost" ? closedAt || updatedAt : null,
      created_at: createdAt,
      updated_at: updatedAt,
      next_task_date_str: String(row["Data da próxima tarefa"] || "").trim(),
      next_task_time_str: String(row["Hora da próxima tarefa"] || "").trim(),
    });

    linkDealContact(dealId, contactId, contactRole, true, createdAt);

    // If deal has complementary triage notes or description, add as a timeline note
    if (infoComp || descRd || lossNote) {
      const noteParts = [];
      if (infoComp) noteParts.push(infoComp);
      if (descRd && descRd !== infoComp) noteParts.push(`Descrição: ${descRd}`);
      if (lossNote) noteParts.push(`Anotação de perda: ${lossNote}`);
      activities.push({
        id: `note-hb-${rdDealId}`,
        deal_id: dealId,
        type: "note",
        title: "Histórico / Informações Complementares (RD Station)",
        description: noteParts.join("\n\n"),
        status: "completed",
        due_date: null,
        completed_at: createdAt,
        creator_key: operatorKey,
        primary_assignee_key: operatorKey,
        assignee_keys: [operatorKey],
        created_at: createdAt,
        updated_at: createdAt,
      });
    }
  } else {
    const existingDeal = dealsById.get(dealId);
    if (!existingDeal.account_id && resolvedAccountId) {
      existingDeal.account_id = resolvedAccountId;
    }
    linkDealContact(dealId, contactId, contactRole, false, createdAt);
  }
}

// 3. Index deals by normalized title for cross-referencing tasks
const dealsByTitleNorm = new Map();
for (const d of dealsById.values()) {
  const k = normKey(d.title);
  if (!dealsByTitleNorm.has(k)) dealsByTitleNorm.set(k, []);
  dealsByTitleNorm.get(k).push(d);
}

// Also index fullSeed deals/accounts/contacts for the 32 tasks on deals from other funnels
const seedAccountsById = new Map(fullSeed.accounts.map((a) => [a.id, a]));
const seedContactsById = new Map(fullSeed.contacts.map((c) => [c.id, c]));
const seedDealContactsByDealId = new Map();
for (const dc of fullSeed.links || []) {
  if (!seedDealContactsByDealId.has(dc.deal_id)) {
    seedDealContactsByDealId.set(dc.deal_id, []);
  }
  seedDealContactsByDealId.get(dc.deal_id).push(dc);
}
const seedDealsByTitleNorm = new Map();
for (const sd of fullSeed.deals) {
  const k = normKey(sd.title);
  if (!seedDealsByTitleNorm.has(k)) seedDealsByTitleNorm.set(k, []);
  seedDealsByTitleNorm.get(k).push(sd);
}

function importSeedDealForTask(seedDeal, primaryOperatorKey) {
  if (dealsById.has(seedDeal.id)) {
    return seedDeal.id;
  }

  let mappedAccountId = null;
  if (seedDeal.account_id) {
    const sAcc = seedAccountsById.get(seedDeal.account_id);
    if (sAcc) {
      mappedAccountId = upsertAccount({
        rdOrgId: sAcc.rd_organization_id,
        name: sAcc.name,
        cleanDoc: sAcc.document ? String(sAcc.document).replace(/\D/g, "") : null,
        email: sAcc.email,
        phone: sAcc.phone,
        createdAt: sAcc.created_at,
        preferredId: sAcc.id,
      });
    }
  }

  const sDcs = seedDealContactsByDealId.get(seedDeal.id) || [];
  const linkedContactIds = [];
  for (let i = 0; i < sDcs.length; i++) {
    const dc = sDcs[i];
    const sCont = seedContactsById.get(dc.contact_id);
    if (!sCont) continue;
    const cId = upsertContact({
      rdContactId: sCont.id.startsWith("cont-rd-")
        ? sCont.id.replace(/^cont-rd-/, "")
        : null,
      name: sCont.name,
      rawPhone: sCont.phone,
      rawEmail: sCont.email,
      role: dc.role || "buyer",
      accountId: mappedAccountId,
      operatorKey: primaryOperatorKey,
      cleanDoc: sCont.cnpj ? String(sCont.cnpj).replace(/\D/g, "") : null,
      createdAt: sCont.created_at,
      preferredId: sCont.id,
    });
    linkedContactIds.push({ contactId: cId, role: dc.role || "buyer", isPrimary: i === 0 });
  }

  // Ensure at least 1 contact exists and is linked even if seed had no dealContacts
  if (linkedContactIds.length === 0) {
    const fallbackAcc = mappedAccountId ? accountsById.get(mappedAccountId) : null;
    const cId = upsertContact({
      rdContactId: null,
      name: fallbackAcc?.name || seedDeal.title,
      rawPhone: fallbackAcc?.phone || "",
      rawEmail: fallbackAcc?.email || "",
      role: "buyer",
      accountId: mappedAccountId,
      operatorKey: primaryOperatorKey,
      cleanDoc: fallbackAcc?.document || null,
      createdAt: seedDeal.created_at,
    });
    linkedContactIds.push({ contactId: cId, role: "buyer", isPrimary: true });
  }

  const dealObj = {
    id: seedDeal.id,
    title: seedDeal.title,
    account_id: mappedAccountId,
    pipeline_id: seedDeal.pipeline_id,
    stage_id: seedDeal.stage_id,
    status: seedDeal.status || "open",
    value: String(seedDeal.value || "0.00"),
    currency: "BRL",
    expected_close_date: seedDeal.expected_close_date || null,
    operator_key: primaryOperatorKey,
    source: seedDeal.source || null,
    campaign: seedDeal.campaign || null,
    rating: Number(seedDeal.rating || 0),
    loss_reason: seedDeal.loss_reason || null,
    paused_reason: seedDeal.paused_reason || null,
    rd_deal_id: seedDeal.rd_deal_id || seedDeal.id.replace(/^deal-rd-/, ""),
    custom_fields: seedDeal.custom_fields || {},
    last_activity_at: seedDeal.last_activity_at || seedDeal.updated_at || seedDeal.created_at,
    closed_at: seedDeal.closed_at || null,
    created_at: seedDeal.created_at,
    updated_at: seedDeal.updated_at || seedDeal.created_at,
    next_task_date_str: "",
    next_task_time_str: "",
  };

  dealsById.set(dealObj.id, dealObj);
  const k = normKey(dealObj.title);
  if (!dealsByTitleNorm.has(k)) dealsByTitleNorm.set(k, []);
  dealsByTitleNorm.get(k).push(dealObj);

  for (const lc of linkedContactIds) {
    linkDealContact(dealObj.id, lc.contactId, lc.role, lc.isPrimary, dealObj.created_at);
  }

  return dealObj.id;
}

const TASK_TYPE_MAP = {
  [normKey("Tarefa")]: "task",
  [normKey("Almoço")]: "lunch",
  [normKey("Ligar")]: "call",
  [normKey("Reunião")]: "meeting",
  [normKey("E-mail")]: "email",
  [normKey("Visita")]: "visit",
  [normKey("WhatsApp")]: "whatsapp",
};

// 4. Process all 252 tasks from task_export
let matchedFromDealCsv = 0;
let matchedFromSeed = 0;

for (let idx = 0; idx < taskRows.length; idx++) {
  const t = taskRows[idx];
  const dealTitleRaw = String(t["Negociação vinculada"] || "").trim();
  const dealTitleKey = normKey(dealTitleRaw);
  const companyKey = normKey(t["Empresa vinculada"]);

  const rawResps = String(t["Responsáveis"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const assigneeKeys = [];
  for (const r of rawResps) {
    const k = mapOperatorKey(r);
    if (k && !assigneeKeys.includes(k)) assigneeKeys.push(k);
  }
  if (assigneeKeys.length === 0) assigneeKeys.push("beatriz");

  // Primary assignee is always Beatriz or Evelyn
  const primaryAssigneeKey =
    assigneeKeys.find((k) => k === "beatriz" || k === "evelyn") || assigneeKeys[0];
  const creatorKey = mapOperatorKey(t["Criado por"]) || primaryAssigneeKey;

  const schedDateStr = String(t["Data agendada"] || "").trim();
  const schedTimeStr = String(t["Hora agendada"] || "").trim();

  // Find best matching deal in dealsByTitleNorm first
  let candidates = dealsByTitleNorm.get(dealTitleKey) || [];
  let chosenDealId = null;

  if (candidates.length > 0) {
    let best = candidates[0];
    let bestScore = -1;
    for (const c of candidates) {
      let score = 0;
      if (c.operator_key === primaryAssigneeKey) score += 40;
      const acc = c.account_id ? accountsById.get(c.account_id) : null;
      if (companyKey && acc && normKey(acc.name) === companyKey) score += 100;
      else if (!companyKey && !acc) score += 20;
      if (c.next_task_date_str === schedDateStr) score += 50;
      if (c.next_task_time_str === schedTimeStr) score += 25;
      if (c.status === "open") score += 15;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    // Notice: For "Alexandre" with company "PJP SOLUCOES LTDA", the deal in deal_export has company "Bellas Cosméticos",
    // whereas seedDealsByTitleNorm has the exact "Alexandre" deal with company "PJP SOLUCOES LTDA"!
    const bestAcc = best.account_id ? accountsById.get(best.account_id) : null;
    const companyMismatch =
      companyKey &&
      (!bestAcc || normKey(bestAcc.name) !== companyKey) &&
      (seedDealsByTitleNorm.get(dealTitleKey) || []).some((sd) => {
        const sAcc = sd.account_id ? seedAccountsById.get(sd.account_id) : null;
        return sAcc && normKey(sAcc.name) === companyKey;
      });

    if (!companyMismatch) {
      chosenDealId = best.id;
      matchedFromDealCsv++;
    }
  }

  if (!chosenDealId) {
    const seedCands = seedDealsByTitleNorm.get(dealTitleKey) || [];
    if (seedCands.length === 0) {
      throw new Error(`Deal não encontrado para a tarefa #${idx + 1}: ${dealTitleRaw}`);
    }
    let bestSeed = seedCands[0];
    let bestSeedScore = -1;
    for (const sd of seedCands) {
      let score = 0;
      const sAcc = sd.account_id ? seedAccountsById.get(sd.account_id) : null;
      if (companyKey && sAcc && normKey(sAcc.name) === companyKey) score += 100;
      else if (!companyKey && !sAcc) score += 20;
      if (sd.status === "open") score += 50;
      if (sd.pipeline_id === "pipe-tecfag-maquinas-2-0") score += 10;
      if (score > bestSeedScore) {
        bestSeedScore = score;
        bestSeed = sd;
      }
    }
    chosenDealId = importSeedDealForTask(bestSeed, primaryAssigneeKey);
    matchedFromSeed++;
  }

  const actType = TASK_TYPE_MAP[normKey(t["Tipo"])] || "task";
  const statusNorm = normKey(t["Status"]);
  const completedAt = parseBrDateTime(t["Data da conclusão"], t["Hora da conclusão"]);
  const isCompleted =
    statusNorm === "concluida" || statusNorm === "concluido" || Boolean(completedAt);

  const dueDate = parseBrDateTime(schedDateStr, schedTimeStr);
  const createdAt =
    parseBrDateTime(t["Data de criação"], t["Hora de criação"]) ||
    dueDate ||
    new Date().toISOString();

  const title = String(t["Assunto"] || t["Tipo"] || "Tarefa").trim();
  const description = String(t["Descrição"] || "").trim() || null;

  activities.push({
    id: `task-hb-${String(idx + 1).padStart(4, "0")}`,
    deal_id: chosenDealId,
    type: actType,
    title,
    description,
    status: isCompleted ? "completed" : "pending",
    due_date: dueDate,
    completed_at: isCompleted ? completedAt || createdAt : null,
    creator_key: creatorKey,
    primary_assignee_key: primaryAssigneeKey,
    assignee_keys: assigneeKeys,
    created_at: createdAt,
    updated_at: isCompleted ? completedAt || createdAt : createdAt,
  });
}

// Clean helper properties before serializing
const cleanDeals = Array.from(dealsById.values()).map(
  ({ next_task_date_str, next_task_time_str, ...rest }) => rest,
);
const cleanContacts = Array.from(contactsById.values()).map(
  ({ phoneIdentity, ...rest }) => rest,
);
const cleanAccounts = Array.from(accountsById.values());

const payload = {
  generatedAt: new Date().toISOString(),
  tenantId: "tecfag",
  pipelines: fullSeed.pipelines,
  stages: fullSeed.stages,
  customFields: fullSeed.customFields,
  accounts: cleanAccounts,
  contacts: cleanContacts,
  deals: cleanDeals,
  dealContacts,
  activities,
};

const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), {
  level: 9,
});
fs.writeFileSync(OUTPUT_SEED_PATH, compressed);

const taskActs = activities.filter((a) => a.type !== "note");
const noteActs = activities.filter((a) => a.type === "note");

console.log("=== HOMOLOGATION PAYLOAD GENERATED ===");
console.log({
  outputFile: OUTPUT_SEED_PATH,
  compressedBytes: compressed.length,
  accounts: cleanAccounts.length,
  contacts: cleanContacts.length,
  dealsTotal: cleanDeals.length,
  dealsByOperator: {
    beatriz: cleanDeals.filter((d) => d.operator_key === "beatriz").length,
    evelyn: cleanDeals.filter((d) => d.operator_key === "evelyn").length,
  },
  dealContacts: dealContacts.length,
  tasksTotal: taskActs.length,
  tasksMatchedFromDealCsv: matchedFromDealCsv,
  tasksMatchedFromSeed: matchedFromSeed,
  tasksByPrimaryAssignee: {
    beatriz: taskActs.filter((t) => t.primary_assignee_key === "beatriz").length,
    evelyn: taskActs.filter((t) => t.primary_assignee_key === "evelyn").length,
  },
  notesTotal: noteActs.length,
});
