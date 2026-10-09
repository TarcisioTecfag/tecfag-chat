/**
 * SCRIPT PROFISSIONAL DE IMPORTAÇÃO EM MASSA DOS 8 FUNIS DO CRM TECFAG
 *
 * Fontes: C:\Users\TEC FAG\Downloads\CRM E CONVERSAS\FUNIS\
 *   1. FUNIL MÁQUINAS (maquinas.csv)
 *   2. FUNIL PERSONNALITÉ (PERSONNALITÉ.csv)
 *   3. FUNIL SDR (SDR.csv)
 *   4. FUNIL PEÇAS (PEÇAS.csv)
 *   5. FUNIL PROJETOS (Projetos.csv)
 *   6. FUNIL SUPORTE TÉCNICO (SUPORTE TÉCNICO.csv)
 *   7. FUNIL FINANCEIRO (Financeiro.csv)
 *   8. FUNIL EXTERNO (Externo.csv)
 *
 * 🔒 REGRAS ESTREITAS DO USUÁRIO:
 *   - Não criar campos novos: Match estrito nos 6 campos configurados.
 *   - Não criar usuários novos: Match nos existentes; fallback para Tarcísio Pereira.
 *   - Deduplicação inteligente de Contatos e Empresas.
 *   - Suporte a múltiplos contatos por negociação (crm_deal_contacts).
 *   - Execução idempotente (ON CONFLICT DO UPDATE).
 *   - Modos: --dry-run (padrão) e --execute.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Flags de linha de comando
const args = process.argv.slice(2);
const isExecute = args.includes("--execute");
const filterFunilRaw = args.find(a => a.startsWith("--funil="))?.split("=")[1];
const filterFunil = filterFunilRaw ? normalizeName(filterFunilRaw) : null;
const customDbUrl = args.find(a => a.startsWith("--db="))?.split("=")[1];

const databaseUrl = customDbUrl || process.env.DATABASE_URL || "postgres://postgres:123@localhost:5432/valemchat";
const tenantId = "tecfag";
const basePath = "C:\\Users\\TEC FAG\\Downloads\\CRM E CONVERSAS\\FUNIS";

// Configuração dos 6 campos personalizados oficiais (IDs da interface Tecfag)
const CF_IDS = {
  CLIENTE_NOVO: "cf-6301c0e7-a9df-422d-99f0-524cb88b2f30",
  QUALIFICADO_SDR: "cf-dbf17e8d-6657-4dea-8914-2fb60ab3cc3f",
  PROPOSTA_NEXT: "cf-3d854c1d-03eb-43ab-9959-394a4792fe8b",
  PRODUTO_FABRICADO: "cf-39e7205f-b6bb-4522-8a6e-03e3180b1025",
  TIPO_PRODUTO: "cf-4c8d4c1d-ef02-4dfe-82b2-64b0e7aaa5b9",
  VOLUME_PRODUCAO: "cf-a3669215-f9e7-46fd-a2e9-754ca2356ef3"
};

const FUNIS_CONFIG = [
  { folder: "FUNIL EXTERNO 2.0", file: "Externo.csv", pipeId: "pipe-tecfag-externo-2-0", pipeName: "FUNIL EXTERNO" },
  { folder: "FUNIL FINANCEIRO", file: "Financeiro.csv", pipeId: "pipe-tecfag-financeiro", pipeName: "FUNIL FINANCEIRO" },
  { folder: "FUNIL PROJETOS", file: "Projetos.csv", pipeId: "pipe-tecfag-projetos", pipeName: "FUNIL PROJETOS" },
  { folder: "FUNIL SDR", file: "SDR.csv", pipeId: "pipe-tecfag-sdr", pipeName: "FUNIL SDR" },
  { folder: "FUNIL PEÇAS", file: "PEÇAS.csv", pipeId: "pipe-tecfag-pecas", pipeName: "FUNIL PEÇAS" },
  { folder: "FUNIL PERSONNALITÉ", file: "PERSONNALITÉ.csv", pipeId: "pipe-tecfag-personnalite", pipeName: "FUNIL PERSONNALITÉ" },
  { folder: "FUNIL SUPORTE TÉCNICO", file: "SUPORTE TÉCNICO.csv", pipeId: "pipe-tecfag-suporte-tecnico", pipeName: "FUNIL SUPORTE TÉCNICO" },
  { folder: "FUNIL MÁQUINAS 2.0", file: "maquinas.csv", pipeId: "pipe-tecfag-maquinas-2-0", pipeName: "FUNIL MÁQUINAS" }
];

function normalizeName(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDocument(str) {
  if (!str) return null;
  const cnpjMatch = str.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/);
  if (cnpjMatch) return cnpjMatch[0].replace(/\D/g, "");
  const cpfMatch = str.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
  if (cpfMatch) return cpfMatch[0].replace(/\D/g, "");
  const pureDigits = str.replace(/\D/g, "");
  if (pureDigits.length === 14 && /^\d{14}$/.test(str.trim())) return pureDigits;
  if (pureDigits.length === 11 && /^\d{11}$/.test(str.trim())) return pureDigits;
  return null;
}

function canonicalPhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits || digits.length < 8) return null;

  // Corrige prefixo duplicado +55 55... se o número for muito longo
  if (digits.startsWith("5555") && digits.length >= 14) {
    digits = digits.slice(2);
  }

  // Se tem 10 ou 11 dígitos e não começa com 55, adiciona 55
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    return `55${digits}`;
  }

  return digits;
}

function parsePtDate(dateStr, timeStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.trim().split("/");
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);

  let hours = 12;
  let minutes = 0;
  if (timeStr && typeof timeStr === "string" && timeStr.includes(":")) {
    const tParts = timeStr.trim().split(":");
    hours = parseInt(tParts[0], 10) || 12;
    minutes = parseInt(tParts[1], 10) || 0;
  }

  const d = new Date(Date.UTC(year, month, day, hours, minutes));
  return isNaN(d.getTime()) ? null : d;
}

function mapStatus(estado, pausada) {
  const est = String(estado || "").trim().toLowerCase();
  const pau = String(pausada || "").trim().toLowerCase();
  if (pau === "sim") return "paused";
  if (est.includes("ganho")) return "won";
  if (est.includes("perd")) return "lost";
  return "open";
}

async function main() {
  console.log(`============================================================`);
  console.log(`🚀 [Tecfag CRM] Ingestão em Massa dos 8 Funis Operacionais`);
  console.log(`   Modo: ${isExecute ? "⚡ EXECUÇÃO REAL NO BANCO" : "🔍 DRY-RUN (SIMULAÇÃO E AUDITORIA)"}`);
  console.log(`   Tenant: ${tenantId}`);
  console.log(`   Database: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`============================================================\n`);

  const sql = postgres(databaseUrl, { max: 10, prepare: false });

  try {
    // 1. CARREGAR OPERADORES E MONTAR MATCHERS
    const dbOperators = await sql`
      SELECT id, name, email FROM operators WHERE tenant_id = ${tenantId}
    `;
    const tarcisio = dbOperators.find(op => normalizeName(op.name).includes("tarcisio")) || dbOperators[0];
    console.log(`Operador fallback padrão: [${tarcisio.id}] ${tarcisio.name}`);

    const opMap = new Map();
    for (const op of dbOperators) {
      opMap.set(normalizeName(op.name), op);
      const clean = normalizeName(op.name).replace(/\b\d+\b/g, "").replace(/\s+/g, " ").trim();
      if (clean) opMap.set(clean, op);
    }

    function matchOperator(name) {
      if (!name || !name.trim()) return tarcisio;
      const norm = normalizeName(name);
      if (opMap.has(norm)) return opMap.get(norm);
      const clean = norm.replace(/\b\d+\b/g, "").replace(/\s+/g, " ").trim();
      if (opMap.has(clean)) return opMap.get(clean);
      const parts = clean.split(" ").filter(x => x.length > 2);
      for (const [key, op] of opMap.entries()) {
        if (parts.length >= 2 && parts.every(p => key.includes(p))) {
          return op;
        }
      }
      return tarcisio;
    }

    // 2. CARREGAR FUNIS E ETAPAS
    const dbPipelines = await sql`
      SELECT id, name, order_index FROM crm_pipelines WHERE tenant_id = ${tenantId}
    `;
    const dbStages = await sql`
      SELECT id, pipeline_id, name, order_index FROM crm_stages WHERE tenant_id = ${tenantId}
    `;

    // Mapeador de etapas por funil
    const stagesByPipe = new Map();
    for (const p of dbPipelines) {
      const pStages = dbStages.filter(s => s.pipeline_id === p.id);
      const stMap = new Map();
      for (const st of pStages) {
        stMap.set(normalizeName(st.name), st);
      }
      stagesByPipe.set(p.id, { stages: pStages, map: stMap });
    }

    function matchStage(pipelineId, stageName) {
      const pData = stagesByPipe.get(pipelineId);
      if (!pData || !pData.stages.length) return null;

      const norm = normalizeName(stageName);
      if (pData.map.has(norm)) return pData.map.get(norm);

      // Tratamentos específicos observados no levantamento forense
      if (pipelineId === "pipe-tecfag-projetos") {
        if (norm.includes("abordagem")) {
          return pData.map.get("abordagem") || pData.stages[0];
        }
        if (norm.includes("escopo apresentado")) {
          return pData.map.get("escopo apresentado") || pData.stages[3];
        }
      }
      if (pipelineId === "pipe-tecfag-pecas") {
        if (norm.includes("pendencia comercial")) {
          return pData.map.get("pendencia tecnica") || pData.map.get("abordagem comercial") || pData.stages[1];
        }
      }

      // Procura por inclusão
      for (const [key, st] of pData.map.entries()) {
        if (key.includes(norm) || norm.includes(key)) {
          return st;
        }
      }

      return pData.stages[0]; // Fallback para primeira etapa do funil
    }

    // 3. CACHES EM MEMÓRIA PARA DEDUPLICAÇÃO E MATCH DE CONTATOS E EMPRESAS
    console.log(`Carregando contatos e empresas existentes para deduplicação...`);
    const existingAccounts = await sql`
      SELECT id, name, document, rd_organization_id FROM crm_accounts WHERE tenant_id = ${tenantId}
    `;
    const accountByRdId = new Map();
    const accountByName = new Map();
    const accountByDoc = new Map();
    for (const a of existingAccounts) {
      if (a.rd_organization_id) accountByRdId.set(a.rd_organization_id, a.id);
      if (a.document) {
        const cleanDoc = a.document.replace(/\D/g, "");
        if (cleanDoc) accountByDoc.set(cleanDoc, a.id);
      }
      accountByName.set(normalizeName(a.name), a.id);
    }

    const existingContacts = await sql`
      SELECT id, phone, email, name, rd_crm_deal_id FROM contacts WHERE tenant_id = ${tenantId}
    `;
    const contactByPhone = new Map();
    const contactByEmail = new Map();
    const contactByRdId = new Map();

    function registerContactPhone(p, id) {
      if (!p) return;
      contactByPhone.set(p, id);
      if (p.startsWith("55")) {
        contactByPhone.set(p.slice(2), id);
      } else {
        contactByPhone.set(`55${p}`, id);
      }
      if (p.startsWith("5555")) {
        contactByPhone.set(p.slice(2), id);
      }
    }

    for (const c of existingContacts) {
      const p = canonicalPhone(c.phone);
      registerContactPhone(p, c.id);
      if (c.phone) registerContactPhone(c.phone, c.id);
      if (c.email) contactByEmail.set(c.email.toLowerCase().trim(), c.id);
    }

    console.log(`  Contatos no banco: ${existingContacts.length} | Empresas no banco: ${existingAccounts.length}`);

    // 4. PROCESSAMENTO FUNIL A FUNIL
    const targetConfigs = filterFunil
      ? FUNIS_CONFIG.filter(f => normalizeName(f.file).includes(filterFunil) || normalizeName(f.folder).includes(filterFunil))
      : FUNIS_CONFIG;

    let globalStats = {
      files: targetConfigs.length,
      rowsRead: 0,
      uniqueDeals: 0,
      accountsCreated: 0,
      contactsCreated: 0,
      dealsCreated: 0,
      dealsUpdated: 0,
      dealContactsCreated: 0,
      customFieldsPopulated: 0,
      fallbackToTarcisioCount: 0
    };

    for (const conf of targetConfigs) {
      const csvPath = path.join(basePath, conf.folder, conf.file);
      if (!fs.existsSync(csvPath)) {
        console.warn(`[Aviso] Arquivo não encontrado: ${csvPath}`);
        continue;
      }

      console.log(`\n────────────────────────────────────────────────────────────`);
      console.log(`📁 Processando [${conf.pipeName}] (${conf.file})...`);
      const t0 = performance.now();
      const wb = XLSX.readFile(csvPath, { codepage: 65001, raw: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      console.log(`   ${rows.length} linhas lidas do arquivo em ${(performance.now() - t0).toFixed(0)}ms.`);

      globalStats.rowsRead += rows.length;

      // Agrupamento por ID do Deal (pois RD exporta 1 linha por contato)
      const dealsGrouped = new Map();
      for (const r of rows) {
        const dealId = String(r["ID"] || "").trim();
        if (!dealId) continue;
        if (!dealsGrouped.has(dealId)) {
          dealsGrouped.set(dealId, {
            primaryRow: r,
            contactRows: [r]
          });
        } else {
          dealsGrouped.get(dealId).contactRows.push(r);
        }
      }

      console.log(`   Negociações únicas no funil: ${dealsGrouped.size}`);
      globalStats.uniqueDeals += dealsGrouped.size;

      // Lotes de processamento
      const dealList = Array.from(dealsGrouped.values());
      const BATCH_SIZE = 250;

      for (let b = 0; b < dealList.length; b += BATCH_SIZE) {
        const batch = dealList.slice(b, b + BATCH_SIZE);

        for (const item of batch) {
          const r = item.primaryRow;
          const operator = matchOperator(r["Responsável"]);
          if (operator.id === tarcisio.id && !normalizeName(r["Responsável"]).includes("tarcisio")) {
            globalStats.fallbackToTarcisioCount++;
          }

          let hasCf = false;
          if (r["CLIENTE NOVO?"] && String(r["CLIENTE NOVO?"]).trim()) hasCf = true;
          if (r["QUALIFICADO POR SDR"] && String(r["QUALIFICADO POR SDR"]).trim()) hasCf = true;
          if ((r["PROPOSTA NEXT"] || r["PROPOSTA"] || r["PROPOSTA."]) && String(r["PROPOSTA NEXT"] || r["PROPOSTA"] || r["PROPOSTA."]).trim()) hasCf = true;
          if (r["QUAL O PRODUTO FABRICADO?"] && String(r["QUAL O PRODUTO FABRICADO?"]).trim()) hasCf = true;
          if (r["QUAL O TIPO DE PRODUTO DO CLIENTE"] && String(r["QUAL O TIPO DE PRODUTO DO CLIENTE"]).trim()) hasCf = true;
          if ((r["VOLUME DE PRODUÇÃO?"] || r["VOLUME DE PRODUÇÃO"]) && String(r["VOLUME DE PRODUÇÃO?"] || r["VOLUME DE PRODUÇÃO"]).trim()) hasCf = true;
          if (hasCf) globalStats.customFieldsPopulated++;
        }

        if (isExecute) {
          await sql.begin(async (tx) => {
            for (const item of batch) {
              const r = item.primaryRow;
              const rdDealId = String(r["ID"] || "").trim();
              const title = String(r["Nome"] || "").trim() || "Negociação Sem Título";
              const rawCompany = String(r["Empresa"] || "").trim();
              const rdCompanyId = String(r["ID da Empresa"] || "").trim();

              // 1. EMPRESA / ACCOUNT
              let accountId = null;
              if (rawCompany || rdCompanyId) {
                const doc = extractDocument(rawCompany);
                const normName = normalizeName(rawCompany);

                if (rdCompanyId && accountByRdId.has(rdCompanyId)) {
                  accountId = accountByRdId.get(rdCompanyId);
                } else if (doc && accountByDoc.has(doc)) {
                  accountId = accountByDoc.get(doc);
                } else if (normName && accountByName.has(normName)) {
                  accountId = accountByName.get(normName);
                } else {
                  // Cria empresa
                  accountId = `acc-rd-${rdCompanyId || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  await tx`
                    INSERT INTO crm_accounts (
                      id, tenant_id, type, name, document_type, document, rd_organization_id, created_at, updated_at
                    ) VALUES (
                      ${accountId}, ${tenantId}, 'company', ${rawCompany || "Empresa sem nome"},
                      ${doc ? (doc.length === 14 ? "cnpj" : "cpf") : null}, ${doc}, ${rdCompanyId || null},
                      NOW(), NOW()
                    ) ON CONFLICT (id) DO NOTHING
                  `;
                  globalStats.accountsCreated++;
                }

                if (accountId) {
                  if (rdCompanyId) accountByRdId.set(rdCompanyId, accountId);
                  if (doc) accountByDoc.set(doc, accountId);
                  if (normName) accountByName.set(normName, accountId);
                }
              }

              // 2. ETAPA E OPERADOR
              const stage = matchStage(conf.pipeId, r["Etapa"]);
              const operator = matchOperator(r["Responsável"]);

              // 3. CAMPOS PERSONALIZADOS (com match de option.id para Select e Checkbox)
              const customFields = {};

              // CLIENTE NOVO? (options: sim, nao, pecas)
              const rawClienteNovo = normalizeName(r["CLIENTE NOVO?"]);
              if (rawClienteNovo) {
                if (rawClienteNovo.includes("sim")) customFields[CF_IDS.CLIENTE_NOVO] = "sim";
                else if (rawClienteNovo.includes("nao")) customFields[CF_IDS.CLIENTE_NOVO] = "nao";
                else if (rawClienteNovo.includes("pecas")) customFields[CF_IDS.CLIENTE_NOVO] = "pecas";
                else customFields[CF_IDS.CLIENTE_NOVO] = rawClienteNovo;
              }

              // QUALIFICADO POR SDR (options: quente, morno, frio, planejando, decisor, troca, pecas, revenda, recompra, curioso)
              const rawQualSdr = normalizeName(r["QUALIFICADO POR SDR"]);
              if (rawQualSdr) {
                if (rawQualSdr === "quente") customFields[CF_IDS.QUALIFICADO_SDR] = "quente";
                else if (rawQualSdr === "morno") customFields[CF_IDS.QUALIFICADO_SDR] = "morno";
                else if (rawQualSdr === "frio") customFields[CF_IDS.QUALIFICADO_SDR] = "frio";
                else if (rawQualSdr.includes("planejando")) customFields[CF_IDS.QUALIFICADO_SDR] = "planejando";
                else if (rawQualSdr.includes("decisor")) customFields[CF_IDS.QUALIFICADO_SDR] = "decisor";
                else if (rawQualSdr.includes("troca")) customFields[CF_IDS.QUALIFICADO_SDR] = "troca";
                else if (rawQualSdr.includes("pecas") || rawQualSdr.includes("reposicao")) customFields[CF_IDS.QUALIFICADO_SDR] = "pecas";
                else if (rawQualSdr.includes("revenda")) customFields[CF_IDS.QUALIFICADO_SDR] = "revenda";
                else if (rawQualSdr.includes("recompra")) customFields[CF_IDS.QUALIFICADO_SDR] = "recompra";
                else if (rawQualSdr.includes("curioso") || rawQualSdr.includes("estudante")) customFields[CF_IDS.QUALIFICADO_SDR] = "curioso";
                else customFields[CF_IDS.QUALIFICADO_SDR] = String(r["QUALIFICADO POR SDR"]).trim();
              }

              // PROPOSTA NEXT (numérica)
              const rawProposta = String(r["PROPOSTA NEXT"] || r["PROPOSTA"] || r["PROPOSTA."] || "").trim();
              if (rawProposta) {
                const num = parseInt(rawProposta, 10);
                customFields[CF_IDS.PROPOSTA_NEXT] = isNaN(num) ? rawProposta : num;
              }

              // QUAL O PRODUTO FABRICADO? (texto livre)
              const rawProdFab = String(r["QUAL O PRODUTO FABRICADO?"] || "").trim();
              if (rawProdFab) {
                customFields[CF_IDS.PRODUTO_FABRICADO] = rawProdFab;
              }

              // QUAL O TIPO DE PRODUTO DO CLIENTE (single: cosmeticos, alimentos_liquidos, alimentos_graos, alimentos_snacks, bebidas, quimicos, pet_shop, construcao, pecas, outros)
              const rawTipoProd = normalizeName(r["QUAL O TIPO DE PRODUTO DO CLIENTE"]);
              if (rawTipoProd) {
                if (rawTipoProd.includes("cosmetico") || rawTipoProd.includes("farmaceutico")) customFields[CF_IDS.TIPO_PRODUTO] = "cosmeticos";
                else if (rawTipoProd.includes("liquido") || rawTipoProd.includes("pastoso")) customFields[CF_IDS.TIPO_PRODUTO] = "alimentos_liquidos";
                else if (rawTipoProd.includes("grao") || rawTipoProd.includes("pos") || rawTipoProd.includes("farinha") || rawTipoProd.includes("cafe")) customFields[CF_IDS.TIPO_PRODUTO] = "alimentos_graos";
                else if (rawTipoProd.includes("snack") || rawTipoProd.includes("congelado") || rawTipoProd.includes("chips")) customFields[CF_IDS.TIPO_PRODUTO] = "alimentos_snacks";
                else if (rawTipoProd.includes("bebida") || rawTipoProd.includes("suco") || rawTipoProd.includes("agua") || rawTipoProd.includes("cerveja")) customFields[CF_IDS.TIPO_PRODUTO] = "bebidas";
                else if (rawTipoProd.includes("quimico") || rawTipoProd.includes("limpeza") || rawTipoProd.includes("tinta")) customFields[CF_IDS.TIPO_PRODUTO] = "quimicos";
                else if (rawTipoProd.includes("pet") || rawTipoProd.includes("racao")) customFields[CF_IDS.TIPO_PRODUTO] = "pet_shop";
                else if (rawTipoProd.includes("construcao") || rawTipoProd.includes("argamassa")) customFields[CF_IDS.TIPO_PRODUTO] = "construcao";
                else if (rawTipoProd.includes("pecas")) customFields[CF_IDS.TIPO_PRODUTO] = "pecas";
                else if (rawTipoProd.includes("outro")) customFields[CF_IDS.TIPO_PRODUTO] = "outros";
                else customFields[CF_IDS.TIPO_PRODUTO] = "outros";
              }

              // VOLUME DE PRODUÇÃO (multiple: array de option IDs: baixo, medio, alto, alta_escala, pequena_escala, pecas)
              const rawVolStr = String(r["VOLUME DE PRODUÇÃO?"] || r["VOLUME DE PRODUÇÃO"] || "").trim();
              if (rawVolStr) {
                const parts = rawVolStr.split(";").map(x => normalizeName(x)).filter(Boolean);
                const matchedIds = [];
                for (const p of parts) {
                  if (p.includes("alta escala") || p.includes("turnos")) {
                    if (!matchedIds.includes("alta_escala")) matchedIds.push("alta_escala");
                  } else if (p.includes("pequena escala") || p.includes("comecando")) {
                    if (!matchedIds.includes("pequena_escala")) matchedIds.push("pequena_escala");
                  } else if (p.includes("baixo")) {
                    if (!matchedIds.includes("baixo")) matchedIds.push("baixo");
                  } else if (p.includes("medio")) {
                    if (!matchedIds.includes("medio")) matchedIds.push("medio");
                  } else if (p.includes("alto")) {
                    if (!matchedIds.includes("alto")) matchedIds.push("alto");
                  } else if (p.includes("pecas")) {
                    if (!matchedIds.includes("pecas")) matchedIds.push("pecas");
                  }
                }
                if (matchedIds.length > 0) {
                  customFields[CF_IDS.VOLUME_PRODUCAO] = matchedIds;
                }
              }

              // 4. METADADOS DO DEAL
              const value = parseFloat(String(r["Valor Único"] || "0").replace(",", ".")) || 0;
              const status = mapStatus(r["Estado"], r["Pausada"]);
              const rating = parseInt(r["Qualificação"], 10) || 0;
              const source = String(r["Fonte"] || "").trim() || null;
              const campaign = String(r["Campanha"] || "").trim() || null;
              const lossReason = String(r["Motivo de Perda"] || "").trim() || null;
              const createdAt = parsePtDate(r["Data de criação"], r["Hora de criação"]) || new Date();
              const closedAt = parsePtDate(r["Data de fechamento"], r["Hora de fechamento"]);
              const expectedClose = parsePtDate(r["Previsão de fechamento"]);

              const dbDealId = `deal-rd-${rdDealId}`;
              const rdUrl = `https://crm.rdstation.com/app/deals/${rdDealId}`;

              await tx`
                INSERT INTO crm_deals (
                  id, tenant_id, title, account_id, pipeline_id, stage_id, status, value, currency,
                  expected_close_date, operator_id, source, campaign, rating, loss_reason, rd_deal_id,
                  rd_deal_url, custom_fields, created_at, closed_at, updated_at
                ) VALUES (
                  ${dbDealId}, ${tenantId}, ${title}, ${accountId}, ${conf.pipeId}, ${stage.id},
                  ${status}, ${value}, 'BRL', ${expectedClose}, ${operator.id}, ${source}, ${campaign},
                  ${rating}, ${lossReason}, ${rdDealId}, ${rdUrl}, ${sql.json(customFields)},
                  ${createdAt}, ${closedAt}, NOW()
                ) ON CONFLICT (tenant_id, id) DO UPDATE SET
                  title = EXCLUDED.title,
                  account_id = COALESCE(EXCLUDED.account_id, crm_deals.account_id),
                  stage_id = EXCLUDED.stage_id,
                  status = EXCLUDED.status,
                  value = EXCLUDED.value,
                  operator_id = EXCLUDED.operator_id,
                  custom_fields = EXCLUDED.custom_fields,
                  updated_at = NOW()
              `;
              globalStats.dealsCreated++;

              // 5. CONTATOS VINCULADOS AO NEGÓCIO
              for (const cRow of item.contactRows) {
                const cName = String(cRow["Contatos"] || "").trim();
                const rawPhone = String(cRow["Telefone"] || "").trim();
                const phone = canonicalPhone(rawPhone);
                const email = String(cRow["Email"] || "").trim().toLowerCase() || null;
                const rdContactId = String(cRow["ID do Contato"] || "").trim();

                if (!cName && !phone && !email && !rdContactId) continue;

                let contactId = null;
                if (phone && contactByPhone.has(phone)) {
                  contactId = contactByPhone.get(phone);
                } else if (email && contactByEmail.has(email)) {
                  contactId = contactByEmail.get(email);
                } else if (rdContactId && contactByRdId.has(rdContactId)) {
                  contactId = contactByRdId.get(rdContactId);
                } else {
                  contactId = `ct-rd-${rdContactId || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  await tx`
                    INSERT INTO contacts (
                      id, tenant_id, account_id, name, phone, email, main_channel, wallet_operator_id,
                      responsible_name, rd_crm_deal_id, created_at
                    ) VALUES (
                      ${contactId}, ${tenantId}, ${accountId}, ${cName || "Contato sem nome"},
                      ${phone}, ${email}, 'whatsapp', ${operator.id}, ${operator.name},
                      ${rdDealId}, ${createdAt}
                    ) ON CONFLICT (id) DO UPDATE SET
                      name = EXCLUDED.name,
                      email = COALESCE(EXCLUDED.email, contacts.email),
                      account_id = COALESCE(EXCLUDED.account_id, contacts.account_id)
                  `;
                  globalStats.contactsCreated++;
                }

                if (contactId) {
                  if (phone) registerContactPhone(phone, contactId);
                  if (email) contactByEmail.set(email, contactId);
                  if (rdContactId) contactByRdId.set(rdContactId, contactId);

                  if (accountId) {
                    await tx`
                      UPDATE contacts
                      SET account_id = COALESCE(account_id, ${accountId})
                      WHERE id = ${contactId} AND tenant_id = ${tenantId} AND account_id IS NULL
                    `;
                  }
                }

                // Vínculo Deal ↔ Contact
                const dcId = `dc-${dbDealId}-${contactId}`;
                await tx`
                  INSERT INTO crm_deal_contacts (
                    id, tenant_id, deal_id, contact_id, role, is_primary, created_at
                  ) VALUES (
                    ${dcId}, ${tenantId}, ${dbDealId}, ${contactId}, 'buyer', true, NOW()
                  ) ON CONFLICT (tenant_id, deal_id, contact_id) DO NOTHING
                `;
                globalStats.dealContactsCreated++;
              }
            }
          });
        }
      }

      console.log(`   ✓ Concluído com sucesso lote do funil ${conf.pipeName}.`);
    }

    if (isExecute) {
      console.log(`\n🔗 Executando reconciliação relacional Empresa ↔ Contato...`);
      const updatedContacts = await sql`
        UPDATE contacts c
        SET account_id = d.account_id
        FROM crm_deal_contacts dc
        JOIN crm_deals d ON d.id = dc.deal_id
        WHERE dc.contact_id = c.id
          AND c.tenant_id = ${tenantId}
          AND c.account_id IS NULL
          AND d.account_id IS NOT NULL
      `;
      console.log(`   ✓ ${updatedContacts.count} contatos associados à empresa das negociações.`);

      const updatedDeals = await sql`
        UPDATE crm_deals d
        SET account_id = c.account_id
        FROM crm_deal_contacts dc
        JOIN contacts c ON c.id = dc.contact_id
        WHERE dc.deal_id = d.id
          AND d.tenant_id = ${tenantId}
          AND d.account_id IS NULL
          AND c.account_id IS NOT NULL
      `;
      console.log(`   ✓ ${updatedDeals.count} negociações enriquecidas com a empresa do contato.`);
    }

    console.log(`\n============================================================`);
    console.log(`🏁 [Relatório de Conciliação] Ingestão em Massa`);
    console.log(`   Arquivos processados: ${globalStats.files}`);
    console.log(`   Linhas de planilha lidas: ${globalStats.rowsRead}`);
    console.log(`   Negociações únicas consolidadas: ${globalStats.uniqueDeals}`);
    if (isExecute) {
      console.log(`   Empresas criadas/atualizadas: ${globalStats.accountsCreated}`);
      console.log(`   Contatos criados/atualizados: ${globalStats.contactsCreated}`);
      console.log(`   Negociações inseridas no CRM: ${globalStats.dealsCreated}`);
      console.log(`   Vínculos Deal-Contato estabelecidos: ${globalStats.dealContactsCreated}`);
    } else {
      console.log(`   [DRY-RUN] Nenhuma gravação efetuada no banco.`);
    }
    console.log(`   Negócios com campos personalizados: ${globalStats.customFieldsPopulated}`);
    console.log(`   Fallback de responsável para Tarcísio: ${globalStats.fallbackToTarcisioCount}`);
    console.log(`============================================================\n`);

  } catch (err) {
    console.error(`❌ [Erro Crítico na Ingestão]:`, err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch(console.error);
