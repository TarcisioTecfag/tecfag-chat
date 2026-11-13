import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import XLSX from "xlsx";

const SUPORTE_DIR = "C:/Users/TEC FAG/Downloads/Nova pasta (69)";
const DEAL_CSV_FILE =
  "673b397d6c7532001f2b0508_deal_export_2026-11-13_11_08.csv";
const TASK_CSV_FILE =
  "673b397d6c7532001f2b0508_task_export_2026-11-13_11_10.csv";

const PECAS_1211_SEED_PATH = path.resolve(
  "scripts/data/tecfag-pecas-rd-crm-2026-11-12.json.gz",
);
const FULL_1011_SEED_PATH = path.resolve(
  "scripts/data/tecfag-full-rd-crm-2026-11-10.json.gz",
);
const OLD_CRM_SEED_PATH = path.resolve("scripts/data/tecfag-crm-seed.json.gz");
const OUTPUT_SEED_PATH = path.resolve(
  "scripts/data/tecfag-suporte-rd-crm-2026-11-13.json.gz",
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

function normAlnum(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
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
  if (typeof val === "number") {
    return Number.isFinite(val) ? val.toFixed(2) : "0.00";
  }
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

/**
 * Exact JavaScript port of PostgreSQL `contact_phone_identity(value text)`
 * in `src/db/migrations/0056_contact_multiple_phones.sql`.
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

function normalizeSinglePhone(rawPhone) {
  const rawTrimmed = String(rawPhone || "").trim();
  const hasIntlPlus = rawTrimmed.startsWith("+");
  let digits = rawTrimmed.replace(/\D/g, "");
  if (digits.length < 8) return "";

  if (hasIntlPlus && !digits.startsWith("55")) {
    return `+${digits}`;
  }
  if (
    digits.startsWith("00") &&
    digits.length > 11 &&
    !digits.startsWith("0055")
  ) {
    return `+${digits.slice(2)}`;
  }
  if (digits.startsWith("0055") && digits.length >= 14) {
    digits = digits.slice(2);
  } else {
    digits = digits.replace(/^0+/, "");
  }
  if (digits.length < 8) return "";
  if (digits.startsWith("5555") && digits.length >= 14) {
    digits = digits.slice(2);
  }
  if (/^1[2-9][0-8][0-9]{8}$/.test(digits)) {
    return `+${digits}`;
  }
  if (
    (digits.length === 10 || digits.length === 11) &&
    !digits.startsWith("55")
  ) {
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
    const id = pgContactPhoneIdentity(norm);
    if (norm && id && id.length >= 8 && !seenId.has(id)) {
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

export const ACTIVE_OPERATOR_SPECS = [
  // Setor Suporte Técnico & Pós-Venda — equipe principal desta migração (match primário por email oficial)
  {
    key: "raiane_aguiar",
    id: "op-1791377346185",
    email: "assistencia@tecfag.com.br",
    name: "Raiane Aguiar",
    rdNames: ["Raiane Aguiar - 114", "Raiane Aguiar"],
  },
  {
    key: "maria_vitoria",
    id: "op-1791377303454",
    email: "assistencia4@tecfag.com.br",
    name: "Maria Vitoria",
    rdNames: ["Maria Vitoria", "Maria Vitória"],
  },
  {
    key: "matheus_henrique",
    id: "op-1791377324588",
    email: "assistencia7@tecfag.com.br",
    name: "Matheus Henrique",
    rdNames: ["Matheus Henrique", "Matheus Henrique "],
  },
  {
    key: "lucimara_dal_mora",
    id: "op-1791377140738",
    email: "sac@tecfag.com.br",
    name: "Lucimara Dal Mora",
    rdNames: ["Lucimara", "Lucimara Dal Mora"],
  },
  {
    key: "melissa_bueno",
    id: "op-1791377157191",
    email: "posvenda@tecfag.com.br",
    name: "Melissa Bueno",
    rdNames: ["Melissa Bueno", "Melissa Bueno "],
  },
  {
    key: "deborah_rayane",
    id: "op-1791377124750",
    email: "vendas15@tecfag.com.br",
    name: "Déborah Rayane",
    rdNames: ["Deborah Alves - 94", "Deborah Alves", "Déborah Rayane"],
  },
  // Demais operadores ativos no tenant Tecfag
  {
    key: "guilherme_bertola",
    id: "op-1791376760659",
    email: "vendas18@tecfag.com.br",
    name: "Guilherme Bertola",
    rdNames: ["Guilherme Bertola - 115", "Guilherme Bertola"],
  },
  {
    key: "keicy_cardoso",
    id: "op-1794490464050",
    email: "vendas21@tecfag.com.br",
    name: "Keicy Cardoso",
    rdNames: ["Keicy Cardoso", "Keicy  Cardoso"],
  },
  {
    key: "melissa_gomes",
    id: "op-1791376839829",
    email: "vendas3@tecfag.com.br",
    name: "Melissa Gomes",
    rdNames: ["Melissa Gomes - 80", "Melissa Gomes"],
  },
  {
    key: "victor_goes",
    id: "op-1791376883222",
    email: "vendas12@tecfag.com.br",
    name: "Victor Goes",
    rdNames: ["Victor Goes - 95", "Victor Goes"],
  },
  {
    key: "beatriz_ribeiro",
    id: "op-1791376711001",
    email: "vendas7@tecfag.com.br",
    name: "Beatriz Ribeiro",
    rdNames: ["Beatriz Ribeiro - 96", "Beatriz Ribeiro"],
  },
  {
    key: "denise_gomes",
    id: "op-1791376727270",
    email: "vendas16@tecfag.com.br",
    name: "Denise Gomes",
    rdNames: ["Denise Gomes - 34", "Denise Gomes"],
  },
  {
    key: "jhordan_rueda",
    id: "op-1791376776876",
    email: "vendas4@tecfag.com.br",
    name: "Jhordan Rueda",
    rdNames: ["Jhordan Rueda - 102", "Jhordan Rueda"],
  },
  {
    key: "cesar_trassatte",
    id: "op-1793276657016",
    email: "apoiocomercial2@tecfag.com.br",
    name: "Cesar Trassatte",
    rdNames: ["Cesar Trassatte"],
  },
  {
    key: "diana_vieira",
    id: "op-1791376744668",
    email: "vendas14@tecfag.com.br",
    name: "Diana Vieira",
    rdNames: ["Diana Gimenes - 93", "Diana Gimenes", "Diana Vieira"],
  },
  {
    key: "patricia_pileggi",
    id: "op-1791377256625",
    email: "contato@tecfag.com.br",
    name: "Patricia Pileggi",
    rdNames: ["Patricia Pileggi"],
  },
  {
    key: "pamela_titato",
    id: "op-1794224168499",
    email: "vendas8@tecfag.com.br",
    name: "Pamela Titato",
    rdNames: ["Pamela Titato - 98", "Pamela Titato"],
  },
  {
    key: "lucas_rosenvaldo",
    id: "op-1791376812068",
    email: "vendas19@tecfag.com.br",
    name: "Lucas Rosenvaldo",
    rdNames: [
      "Rosenvaldo Lucas - 121",
      "Rosenvaldo Lucas",
      "Lucas Rosenvaldo",
    ],
  },
  {
    key: "adriano_ordonho",
    id: "op-1791376660777",
    email: "vendas20@tecfag.com.br",
    name: "Adriano Ordonho",
    rdNames: ["Adriano Ordonho"],
  },
  {
    key: "roseli_costa",
    id: "op-1791376365982",
    email: "recepcao2@tecfag.com.br",
    name: "Roseli Costa",
    rdNames: ["Roseli Recepção", "Roseli Costa"],
  },
  {
    key: "vinicius",
    id: "op-1793048671367",
    email: "vendas9@tecfag.com.br",
    name: "Vinicius",
    rdNames: [
      "Vinicius  Vidotti",
      "Vinicius Vidotti",
      "Vinicius Capetti",
      "Vinicius",
    ],
  },
  {
    key: "denis_menezes",
    id: "op-1794223754650",
    email: "vendas1@tecfag.com.br",
    name: "Denis Menezes",
    rdNames: ["Denis Menezes - 125", "Denis Menezes"],
  },
  {
    key: "gustavo_sessilio",
    id: "op-1791377401679",
    email: "ecommerce@tecfag.com.br",
    name: "Gustavo Sessilio",
    rdNames: ["Gustavo Sessilio"],
  },
  {
    key: "evelyn_silveira",
    id: "op-1793791337754",
    email: "vendas22@tecfag.com.br",
    name: "Evelyn Silveira",
    rdNames: ["Evelyn Silveira"],
  },
  {
    key: "marcelo_nardelli",
    id: "op-1791376825772",
    email: "vendas17@tecfag.com.br",
    name: "Marcelo Nardelli",
    rdNames: ["Marcelo Nardelli - 118", "Marcelo Nardelli"],
  },
  {
    key: "rafaela_lima",
    id: "op-1791376855232",
    email: "apoiocomercial3@tecfag.com.br",
    name: "Rafaela Lima",
    rdNames: ["Rafaela Lima"],
  },
  {
    key: "tarcisio_pereira",
    id: "38306207-265e-4cd1-b702-a78805526b94",
    email: "suporte2@tecfag.com.br",
    name: "Tarcisio Pereira",
    rdNames: ["Tarcísio Pereira", "Tarcisio Pereira"],
  },
  {
    key: "joao_lanza",
    id: "op-1792762774332",
    email: "joao@tecfag.com.br",
    name: "João Lanza",
    rdNames: ["João Lanza", "Joao Lanza"],
  },
  {
    key: "leticia_cardoso",
    id: "op-1791207143889",
    email: "performance@tecfag.com.br",
    name: "Leticia Cardoso",
    rdNames: ["Leticia Cardoso"],
  },
  {
    key: "isabella_inhesta",
    id: "op-1793810331796",
    email: "apoiocomercial@tecfag.com.br",
    name: "Isabella Inhesta",
    rdNames: ["Isabella  Machado", "Isabella Machado", "Isabella Inhesta"],
  },
  {
    key: "jessica_pimentel",
    id: "op-1791376520586",
    email: "cobranca@tecfag.com.br",
    name: "Jessica Pimentel",
    rdNames: ["Jessica", "Jessica Pimentel"],
  },
  {
    key: "henrique_tavares",
    id: "op-1791377416478",
    email: "marketing@tecfag.com.br",
    name: "Henrique Tavares",
    rdNames: ["Henrique Tavares"],
  },
  {
    key: "gilson_donato",
    id: "op-1791375814029",
    email: "gilson@tecfag.com.br",
    name: "Gilson Donato",
    rdNames: ["Gilson Jose Donato", "Gilson Donato"],
  },
  {
    key: "fernando_mendes",
    id: "op-1791377512862",
    email: "projetos@grupo.tecfag.com.br",
    name: "Fernando Mendes",
    rdNames: ["Fernando Mendes"],
  },
];

const rdNameMap = new Map();
const operatorSpecById = new Map();
for (const spec of ACTIVE_OPERATOR_SPECS) {
  operatorSpecById.set(spec.id, spec);
  rdNameMap.set(normKey(spec.name), spec);
  for (const rn of spec.rdNames) {
    rdNameMap.set(normKey(rn), spec);
    const stripped = normKey(rn.replace(/-\s*\d+$/, ""));
    if (stripped) rdNameMap.set(stripped, spec);
  }
}

const NON_OPERATOR_TEAM_LABELS = new Set([
  "financeiro",
  "pecas",
  "suporte",
  "suporte tecnico",
  "assistencia",
  "assistencia tecnica",
  "comercial",
  "pos venda",
  "pos-venda",
  "marketing",
  "sdr",
  "diretoria",
]);

function matchActiveOperator(rawRdName) {
  const k = normKey(rawRdName);
  if (!k) return null;
  if (rdNameMap.has(k)) return rdNameMap.get(k);
  const stripped = normKey(String(rawRdName).replace(/-\s*\d+$/, ""));
  if (stripped && rdNameMap.has(stripped)) return rdNameMap.get(stripped);
  return null;
}

export const SUPORTE_STAGE_DEFS = [
  {
    id: "stg-tf-sup-triagem",
    name: "TRIAGEM",
    order_index: 0,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-troca-em-garantia",
    name: "TROCA EM GARANTIA",
    order_index: 1,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-suporte",
    name: "SUPORTE",
    order_index: 2,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-remessa-conserto",
    name: "REMESSA DE CONSERTO",
    order_index: 3,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-rastreio",
    name: "RASTREIO",
    order_index: 4,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-nao-conforme-frete",
    name: "NÃO CONFORME - FRETE",
    order_index: 5,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-simples-faturamento",
    name: "SIMPLES FATURAMENTO",
    order_index: 6,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-nao-conforme-devolucao",
    name: "NÃO CONFORME - DEVOLUÇÃO",
    order_index: 7,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-assistencia-tecnica",
    name: "ASSISTÊNCIA TÉCNICA",
    order_index: 8,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-video-chamada",
    name: "VIDEO CHAMADA",
    order_index: 9,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-devolucao",
    name: "DEVOLUÇÃO",
    order_index: 10,
    is_win_stage: false,
    is_loss_stage: false,
  },
  {
    id: "stg-tf-sup-finalizados",
    name: "FINALIZADOS",
    order_index: 11,
    is_win_stage: false,
    is_loss_stage: false,
  },
];

const SUPORTE_STAGE_BY_NAME = new Map(
  SUPORTE_STAGE_DEFS.map((s) => [normKey(s.name), s.id]),
);

function resolveSuporteStageId(rawStageName) {
  const k = normKey(rawStageName);
  return SUPORTE_STAGE_BY_NAME.get(k) || "stg-tf-sup-triagem";
}

// Official Custom Field IDs from seed + extended IDs
const CF_SEED_IDS = {
  CLIENTE_NOVO: "cf-6301c0e7-a9df-422d-99f0-524cb88b2f30",
  QUALIFICADO_SDR: "cf-dbf17e8d-6657-4dea-8914-2fb60ab3cc3f",
  PROPOSTA_NEXT: "cf-3d854c1d-03eb-43ab-9959-394a4792fe8b",
  PRODUTO_FABRICADO: "cf-39e7205f-b6bb-4522-8a6e-03e3180b1025",
  TIPO_PRODUTO: "cf-4c8d4c1d-ef02-4dfe-82b2-64b0e7aaa5b9",
  VOLUME_PRODUCAO: "cf-a3669215-f9e7-46fd-a2e9-754ca2356ef3",
};

function buildDealCustomFields(row, isLegacyFallback) {
  const cf = {};

  // 1. CLIENTE NOVO?
  const rawClienteNovo = normKey(row["CLIENTE NOVO?"]);
  if (rawClienteNovo) {
    if (rawClienteNovo.includes("sim")) cf[CF_SEED_IDS.CLIENTE_NOVO] = "sim";
    else if (rawClienteNovo.includes("nao"))
      cf[CF_SEED_IDS.CLIENTE_NOVO] = "nao";
    else if (rawClienteNovo.includes("pecas"))
      cf[CF_SEED_IDS.CLIENTE_NOVO] = "pecas";
    else cf[CF_SEED_IDS.CLIENTE_NOVO] = String(row["CLIENTE NOVO?"]).trim();
    cf["cf-tf-deal-cliente-novo"] = String(row["CLIENTE NOVO?"]).trim();
  }

  // 2. QUALIFICADO POR SDR
  const rawQualSource =
    row["QUALIFICADO POR SDR"] ||
    row["QUALIFICADO POR SDR (VALEM)"] ||
    row["QUALIFICADO POR SDR (VALEM) T"] ||
    "";
  const rawQualSdr = normKey(rawQualSource);
  if (rawQualSdr) {
    if (rawQualSdr === "quente") cf[CF_SEED_IDS.QUALIFICADO_SDR] = "quente";
    else if (rawQualSdr === "morno") cf[CF_SEED_IDS.QUALIFICADO_SDR] = "morno";
    else if (rawQualSdr === "frio") cf[CF_SEED_IDS.QUALIFICADO_SDR] = "frio";
    else if (rawQualSdr.includes("planejando")) {
      cf[CF_SEED_IDS.QUALIFICADO_SDR] = "planejando";
    } else if (rawQualSdr.includes("decisor")) {
      cf[CF_SEED_IDS.QUALIFICADO_SDR] = "decisor";
    } else if (rawQualSdr.includes("troca")) {
      cf[CF_SEED_IDS.QUALIFICADO_SDR] = "troca";
    } else if (
      rawQualSdr.includes("pecas") ||
      rawQualSdr.includes("reposicao")
    ) {
      cf[CF_SEED_IDS.QUALIFICADO_SDR] = "pecas";
    } else if (rawQualSdr.includes("revenda")) {
      cf[CF_SEED_IDS.QUALIFICADO_SDR] = "revenda";
    } else if (rawQualSdr.includes("recompra")) {
      cf[CF_SEED_IDS.QUALIFICADO_SDR] = "recompra";
    } else if (
      rawQualSdr.includes("curioso") ||
      rawQualSdr.includes("estudante")
    ) {
      cf[CF_SEED_IDS.QUALIFICADO_SDR] = "curioso";
    } else {
      cf[CF_SEED_IDS.QUALIFICADO_SDR] = String(rawQualSource).trim();
    }
    cf["cf-tf-deal-sdr-qualificacao"] = String(rawQualSource).trim();
  }

  // 3. PROPOSTA NEXT
  const rawProposta = String(
    row["PROPOSTA NEXT"] || row["PROPOSTA"] || row["PROPOSTA."] || "",
  ).trim();
  if (rawProposta) {
    const num = parseInt(rawProposta, 10);
    cf[CF_SEED_IDS.PROPOSTA_NEXT] = Number.isNaN(num) ? rawProposta : num;
    cf["cf-tf-deal-proposta"] = rawProposta;
  }

  // 4. QUAL O PRODUTO FABRICADO?
  const rawProdFab = String(row["QUAL O PRODUTO FABRICADO?"] || "").trim();
  if (rawProdFab) {
    cf[CF_SEED_IDS.PRODUTO_FABRICADO] = rawProdFab;
    cf["cf-tf-deal-produto-fabricado"] = rawProdFab;
  }

  // 5. QUAL O TIPO DE PRODUTO DO CLIENTE
  const rawTipoProdSource =
    row["QUAL O TIPO DE PRODUTO DO CLIENTE"] ||
    row["QUAL O TIPO DE PRODUTO? T"] ||
    row["QUAL O TIPO DE PRODUTO (VALEM)"] ||
    "";
  const rawTipoProd = normKey(rawTipoProdSource);
  if (rawTipoProd) {
    if (
      rawTipoProd.includes("cosmetico") ||
      rawTipoProd.includes("farmaceutico")
    ) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "cosmeticos";
    } else if (
      rawTipoProd.includes("liquido") ||
      rawTipoProd.includes("pastoso")
    ) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "alimentos_liquidos";
    } else if (
      rawTipoProd.includes("grao") ||
      rawTipoProd.includes("pos") ||
      rawTipoProd.includes("farinha") ||
      rawTipoProd.includes("cafe")
    ) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "alimentos_graos";
    } else if (
      rawTipoProd.includes("snack") ||
      rawTipoProd.includes("congelado") ||
      rawTipoProd.includes("chips")
    ) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "alimentos_snacks";
    } else if (
      rawTipoProd.includes("bebida") ||
      rawTipoProd.includes("suco") ||
      rawTipoProd.includes("agua") ||
      rawTipoProd.includes("cerveja")
    ) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "bebidas";
    } else if (
      rawTipoProd.includes("quimico") ||
      rawTipoProd.includes("limpeza") ||
      rawTipoProd.includes("tinta")
    ) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "quimicos";
    } else if (rawTipoProd.includes("pet") || rawTipoProd.includes("racao")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "pet_shop";
    } else if (
      rawTipoProd.includes("construcao") ||
      rawTipoProd.includes("argamassa")
    ) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "construcao";
    } else if (rawTipoProd.includes("pecas")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "pecas";
    } else {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "outros";
    }
    cf["cf-tf-deal-tipo-produto-cliente"] = String(rawTipoProdSource).trim();
  }

  // 6. VOLUME DE PRODUÇÃO
  const rawVolStr = String(
    row["VOLUME DE PRODUÇÃO?"] ||
      row["VOLUME DE PRODUÇÃO"] ||
      row["PRODUÇÃO DESEJADA POR HORA"] ||
      "",
  ).trim();
  if (rawVolStr) {
    const parts = rawVolStr
      .split(";")
      .map((x) => normKey(x))
      .filter(Boolean);
    const matchedIds = [];
    for (const p of parts) {
      if (p.includes("alta escala") || p.includes("turnos")) {
        if (!matchedIds.includes("alta_escala")) matchedIds.push("alta_escala");
      } else if (p.includes("pequena escala") || p.includes("comecando")) {
        if (!matchedIds.includes("pequena_escala")) {
          matchedIds.push("pequena_escala");
        }
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
    cf[CF_SEED_IDS.VOLUME_PRODUCAO] =
      matchedIds.length > 0 ? matchedIds : [rawVolStr];
    cf["cf-tf-deal-volume-producao"] = rawVolStr;
  }

  // 7. All additional Suporte Técnico & RD custom fields preserved without loss
  const extraMappings = [
    ["cf-tf-deal-ajuda-necessaria", "ONDE O CLIENTE PRECISA DE AJUDA?"],
    ["cf-tf-deal-processo-atual", "COMO É FEITO HOJE?"],
    ["cf-tf-deal-expectativa-uso", "EXPECTATIVA DE USO?"],
    ["cf-tf-deal-nivel-automacao", "NÍVEL DE AUTOMAÇÃO EXIGIDO"],
    ["cf-tf-deal-tipo-embalagem", "QUE TIPO DE EMBALAGEM?"],
    ["cf-tf-deal-producao-hora", "PRODUÇÃO DESEJADA POR HORA"],
    ["cf-tf-deal-perfil-cliente", "QUAL PERFIL O CLIENTE SE ENCAIXA?"],
    ["cf-tf-deal-apresentacao-proposta", "APRESENTAÇÃO DA PROPOSTA"],
    ["cf-tf-deal-projetos-desenvolvimento", "PROJETOS / DESENVOLVIMENTO"],
    ["cf-tf-deal-projetos-desenvolvimento", "PROJETOS / DESENVOLVIMENTO T"],
    ["cf-tf-deal-info-complementares", "INFORMAÇÕES COMPLEMENTARES"],
    ["cf-tf-deal-escopo-validado", "ESCOPO VALIDADO PELO CLIENTE"],
    ["cf-tf-deal-destino-projeto", "DESTINO FINAL DO PROJETO (AUDITORIA CEO)"],
    [
      "cf-tf-deal-justificativa-movimentacao",
      "JUSTIFICATIVA DE MOVIMENTAÇÃO DE PROJETO",
    ],
    ["cf-tf-deal-descricao", "DESCRIÇÃO"],
    ["cf-tf-deal-feito-por", "FEITO POR"],
    ["cf-tf-deal-feito-por", "FEITO POR "],
    ["cf-tf-deal-equipamento", "EQUIPAMENTO"],
    ["cf-tf-deal-budget", "Budget"],
    ["cf-tf-deal-pre-analise", "PRÉ-ANÁLISE "],
    ["cf-tf-deal-anotacao-perda", "Anotação do motivo de perda"],
    ["cf-tf-deal-equipes-responsavel", "Equipes do responsável"],
    ["cf-tf-deal-produtos", "Produtos"],
    ["cf-tf-deal-foto-anexada", "FOTO ANEXADA?"],
    ["cf-tf-deal-qual-cliente", "QUAL É O CLIENTE?"],
    ["cf-tf-deal-video-chamada", "VIDEO CHAMADA?"],
    ["cf-tf-deal-visita-tecnica", "VISITA TÉCNICA?"],
    ["cf-tf-deal-tem-etiqueta", "TEM ETIQUETA?"],
    ["cf-tf-deal-numero-os", "NUMERO DA OS"],
    ["cf-tf-deal-tipo-atendimento", "TIPO DE ATENDIMENTO"],
    ["cf-tf-deal-tipo-pecas", "TIPO "],
  ];

  for (const [cfKey, colName] of extraMappings) {
    const val = String(row[colName] || "").trim();
    if (val && !cf[cfKey]) cf[cfKey] = val;
  }

  if (isLegacyFallback) {
    cf.responsavel_original_rd = String(row["Responsável"] || "").trim();
    cf.funil_original_rd = String(row["Funil de vendas"] || "").trim();
    cf.etapa_original_rd = String(row["Etapa"] || "").trim();
  }

  return cf;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve("scripts/build-tecfag-suporte-rd-crm.mjs").toLowerCase();

if (isMain) {
  const pecas1211 = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(PECAS_1211_SEED_PATH)).toString("utf8"),
  );
  const full1011 = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(FULL_1011_SEED_PATH)).toString("utf8"),
  );
  const oldSeed = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(OLD_CRM_SEED_PATH)).toString("utf8"),
  );

  // State maps for strict deduplication
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
  const dealHasPrimaryContact = new Set();
  const dealContacts = [];
  const activities = [];

  function upsertAccount({ rdOrgId, name, cleanDoc, email, phone, createdAt }) {
    const trimmedName = String(name || "").trim();
    const doc =
      cleanDoc &&
      (cleanDoc.length === 11 || cleanDoc.length === 14) &&
      !/^(\d)\1+$/.test(cleanDoc)
        ? cleanDoc
        : null;

    if (!trimmedName && !doc && !rdOrgId) return null;

    let accId = null;
    if (doc && accountIdByDoc.has(doc)) {
      accId = accountIdByDoc.get(doc);
    }
    if (!accId && rdOrgId && accountIdByRdOrg.has(rdOrgId)) {
      accId = accountIdByRdOrg.get(rdOrgId);
    }
    const nKey = trimmedName ? normKey(trimmedName) : "";
    if (!accId && nKey && accountIdByName.has(nKey)) {
      accId = accountIdByName.get(nKey);
    }

    if (!accId) {
      accId = rdOrgId
        ? `acc-rd-${rdOrgId}`
        : `acc-tf-suporte-${accountsById.size + 1}`;
      if (accountsById.has(accId)) {
        accId = `acc-tf-suporte-${accountsById.size + 1}-${Math.random().toString(36).slice(2, 6)}`;
      }
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
    explicitId,
    rdContactId,
    name,
    rawPhone,
    rawEmail,
    role,
    accountId,
    operatorKey,
    cleanDoc,
    createdAt,
  }) {
    const trimmedName = String(name || "").trim() || "Contato sem nome";
    const emailParts = String(rawEmail || "")
      .split(/[;,|\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes("@"));
    const email = emailParts[0] || null;

    const phoneCandidates = extractPhoneCandidates(rawPhone);
    const primaryCand = phoneCandidates[0] || null;
    const chosenIdentity = primaryCand?.identity || "";

    let contactId = null;
    // Priority 1: ANY canonical phone identity across all candidate phones
    for (const cand of phoneCandidates) {
      if (contactIdByPhoneIdentity.has(cand.identity)) {
        contactId = contactIdByPhoneIdentity.get(cand.identity);
        break;
      }
    }
    // Priority 2: RD Contact ID (when phone identity does not conflict)
    if (!contactId && rdContactId && contactIdByRdId.has(rdContactId)) {
      const candidateId = contactIdByRdId.get(rdContactId);
      const existing = contactsById.get(candidateId);
      if (
        !chosenIdentity ||
        !existing.phoneIdentity ||
        existing.phoneIdentity === chosenIdentity
      ) {
        contactId = candidateId;
      }
    }
    // Priority 3: Email (when phone identity does not conflict)
    if (!contactId && email && contactIdByEmail.has(email)) {
      const candidateId = contactIdByEmail.get(email);
      const existing = contactsById.get(candidateId);
      if (
        !chosenIdentity ||
        !existing.phoneIdentity ||
        existing.phoneIdentity === chosenIdentity
      ) {
        contactId = candidateId;
      }
    }
    // Priority 4: Same normalized name + account when no phone
    const nameAccKey = `${accountId || "noacc"}:${normKey(trimmedName)}`;
    if (!contactId && !chosenIdentity && contactIdByNameAcc.has(nameAccKey)) {
      contactId = contactIdByNameAcc.get(nameAccKey);
    }

    if (!contactId) {
      if (explicitId && !contactsById.has(explicitId)) {
        contactId = explicitId;
      } else if (rdContactId && !contactsById.has(`cont-rd-${rdContactId}`)) {
        contactId = `cont-rd-${rdContactId}`;
      } else {
        contactId = `cont-tf-suporte-${contactsById.size + 1}`;
      }

      const claimedPhones = [];
      for (const cand of phoneCandidates) {
        if (!contactIdByPhoneIdentity.has(cand.identity)) {
          contactIdByPhoneIdentity.set(cand.identity, contactId);
          claimedPhones.push(cand);
        }
      }
      const mainPhoneObj = claimedPhones[0] || null;

      contactsById.set(contactId, {
        id: contactId,
        name: trimmedName,
        phone: mainPhoneObj ? mainPhoneObj.phone : "",
        phoneIdentity: mainPhoneObj ? mainPhoneObj.identity : "",
        phones: claimedPhones.map((p, idx) => ({
          phone: p.phone,
          identity: p.identity,
          isPrimary: idx === 0,
        })),
        email: email || null,
        cnpj: cleanDoc || null,
        account_id: accountId || null,
        wallet_operator_key: operatorKey || "raiane_aguiar",
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
        for (const cand of phoneCandidates) {
          const owner = contactIdByPhoneIdentity.get(cand.identity);
          if (!owner) {
            contactIdByPhoneIdentity.set(cand.identity, contactId);
            if (!existing.phone) {
              existing.phone = cand.phone;
              existing.phoneIdentity = cand.identity;
              existing.phones.unshift({
                phone: cand.phone,
                identity: cand.identity,
                isPrimary: true,
              });
            } else if (
              !existing.phones.some((p) => p.identity === cand.identity)
            ) {
              existing.phones.push({
                phone: cand.phone,
                identity: cand.identity,
                isPrimary: false,
              });
            }
          }
        }
      }
    }

    if (rdContactId) contactIdByRdId.set(rdContactId, contactId);
    if (email) contactIdByEmail.set(email, contactId);
    contactIdByNameAcc.set(nameAccKey, contactId);
    return contactId;
  }

  function linkDealContact(dealId, contactId, role, createdAt) {
    if (!dealId || !contactId) return;
    const key = `${dealId}:${contactId}`;
    if (dealContactsKeySet.has(key)) return;
    dealContactsKeySet.add(key);
    const isPrimary = !dealHasPrimaryContact.has(dealId);
    if (isPrimary) dealHasPrimaryContact.add(dealId);
    dealContacts.push({
      id: `dc-tf-suporte-${dealContacts.length + 1}`,
      deal_id: dealId,
      contact_id: contactId,
      role: role ? String(role).slice(0, 80) : "buyer",
      is_primary: isPrimary,
      created_at: createdAt || new Date().toISOString(),
    });
  }

  // 1. Read & process Suporte Técnico deal_export CSV
  const dealRows = readRdCsv(path.join(SUPORTE_DIR, DEAL_CSV_FILE));
  let legacyDealsToViniciusTestes = 0;
  let rowsWithoutContactSkippedFakeCreation = 0;

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

    const matchedSpec = matchActiveOperator(row["Responsável"]);
    const isLegacyFallback = !matchedSpec;
    const operatorKey = matchedSpec ? matchedSpec.key : "vinicius";

    const rawPhones = extractPhoneCandidates(row["Telefone"]);
    const primaryPhone = rawPhones[0]?.phone || null;
    const rawEmail = String(row["Email"] || "").trim() || null;

    // Account (Company)
    const accountName = orgName || (cleanDoc ? title : "");
    const accountId = upsertAccount({
      rdOrgId,
      name: accountName,
      cleanDoc,
      email: rawEmail,
      phone: primaryPhone,
      createdAt,
    });

    // Contact (only create/link when RD row genuinely has contact data)
    const rawContactName =
      String(row["Contatos"] || "").trim() ||
      String(row["Lead"] || "").trim();
    const rdContactId =
      String(row["ID do Contato"] || "").trim() ||
      String(row["ID do Lead"] || "").trim() ||
      null;
    const hasContactInfo = Boolean(
      rawContactName || rdContactId || rawPhones.length > 0 || rawEmail,
    );

    let contactId = null;
    const contactRole = String(row["Cargo"] || "").trim() || "buyer";

    if (hasContactInfo) {
      contactId = upsertContact({
        rdContactId,
        name: rawContactName || orgName || title,
        rawPhone: row["Telefone"],
        rawEmail: row["Email"],
        role: contactRole,
        accountId,
        operatorKey,
        cleanDoc,
        createdAt,
      });
    } else {
      rowsWithoutContactSkippedFakeCreation++;
    }

    const contactObj = contactId ? contactsById.get(contactId) : null;
    const resolvedAccountId = accountId || contactObj?.account_id || null;
    if (resolvedAccountId && contactObj && !contactObj.account_id) {
      contactObj.account_id = resolvedAccountId;
    }

    if (!dealsById.has(dealId)) {
      let pipelineId;
      let stageId;
      if (isLegacyFallback) {
        pipelineId = "pipe-tecfag-testes";
        stageId = "stg-tf-testes-anteriores";
        legacyDealsToViniciusTestes++;
      } else {
        pipelineId = "pipe-tecfag-suporte-tecnico";
        stageId = resolveSuporteStageId(row["Etapa"]);
      }

      const estadoNorm = normKey(row["Estado"]);
      const pausadaNorm = normKey(row["Pausada"]);
      let status = "open";
      if (pausadaNorm === "sim") status = "paused";
      else if (
        estadoNorm === "vendida" ||
        estadoNorm === "ganha" ||
        estadoNorm.includes("ganh") ||
        estadoNorm.includes("vend")
      ) {
        status = "won";
      } else if (estadoNorm === "perdida" || estadoNorm.includes("perd")) {
        status = "lost";
      }

      const value = parseBrNumeric(row["Valor Único"]);
      const ratingNum = parseInt(String(row["Qualificação"] || "0"), 10);
      const rating =
        Number.isFinite(ratingNum) && ratingNum >= 0 && ratingNum <= 5
          ? ratingNum
          : 0;

      const rawLossReason = String(row["Motivo de Perda"] || "").trim();
      const lossReason =
        rawLossReason && normKey(rawLossReason) !== "nada"
          ? rawLossReason
          : null;
      const rawSource = String(row["Fonte"] || "").trim();
      const source =
        rawSource && normKey(rawSource) !== "desconhecido" ? rawSource : null;
      const rawCampaign = String(row["Campanha"] || "").trim();
      const campaign =
        rawCampaign && normKey(rawCampaign) !== "desconhecido"
          ? rawCampaign
          : null;

      const customFields = buildDealCustomFields(row, isLegacyFallback);
      const updatedAt = closedAt || lastContactAt || createdAt;

      dealsById.set(dealId, {
        id: dealId,
        title,
        account_id: resolvedAccountId,
        pipeline_id: pipelineId,
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
        closed_at:
          status === "won" || status === "lost" ? closedAt || updatedAt : null,
        created_at: createdAt,
        updated_at: updatedAt,
        next_task_date_str: String(row["Data da próxima tarefa"] || "").trim(),
        next_task_time_str: String(row["Hora da próxima tarefa"] || "").trim(),
      });

      if (contactId) {
        linkDealContact(dealId, contactId, contactRole, createdAt);
      }

      // Preserve complementary notes, descriptions, pre-analysis, and loss notes as a timeline note
      const descRd = String(row["DESCRIÇÃO"] || "").trim();
      const lossNote = String(row["Anotação do motivo de perda"] || "").trim();
      const preAnalise = String(row["PRÉ-ANÁLISE "] || "").trim();
      if (infoComp || descRd || lossNote || preAnalise) {
        const noteParts = [];
        if (infoComp) noteParts.push(infoComp);
        if (preAnalise && preAnalise !== infoComp) {
          noteParts.push(`Pré-Análise: ${preAnalise}`);
        }
        if (descRd && descRd !== infoComp) {
          noteParts.push(`Descrição: ${descRd}`);
        }
        if (lossNote) noteParts.push(`Anotação de perda: ${lossNote}`);
        activities.push({
          id: `note-rd-${rdDealId}`,
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
      if (contactId) {
        linkDealContact(dealId, contactId, contactRole, createdAt);
      }
    }
  }

  // Backfill deal.account_id when another row of the same contact provided the company
  const dcsByDealId = new Map();
  for (const dc of dealContacts) {
    if (!dcsByDealId.has(dc.deal_id)) dcsByDealId.set(dc.deal_id, []);
    dcsByDealId.get(dc.deal_id).push(dc);
  }
  for (const d of dealsById.values()) {
    if (!d.account_id) {
      const linkedAccId = (dcsByDealId.get(d.id) || [])
        .map((dc) => contactsById.get(dc.contact_id)?.account_id)
        .find(Boolean);
      if (linkedAccId) d.account_id = linkedAccId;
    }
  }

  // 2. Build indexes for multi-tier task matching (Suporte CSV -> Peças 12/11 Seed -> 10/11 Full Seed -> Old CRM Seed)
  const dealsByTitleAlnum = new Map();
  const dealsByCompanyAlnum = new Map();

  for (const d of dealsById.values()) {
    const tk = normAlnum(d.title);
    if (tk) {
      if (!dealsByTitleAlnum.has(tk)) dealsByTitleAlnum.set(tk, []);
      dealsByTitleAlnum.get(tk).push(d);
    }
    const acc = d.account_id ? accountsById.get(d.account_id) : null;
    const ck = acc ? normAlnum(acc.name) : "";
    if (ck) {
      if (!dealsByCompanyAlnum.has(ck)) dealsByCompanyAlnum.set(ck, []);
      dealsByCompanyAlnum.get(ck).push(d);
    }
  }

  function buildSeedLookup(seedObj) {
    const accMap = new Map((seedObj.accounts || []).map((a) => [a.id, a]));
    const contMap = new Map((seedObj.contacts || []).map((c) => [c.id, c]));
    const dcByDeal = new Map();
    for (const dc of seedObj.dealContacts || []) {
      if (!dcByDeal.has(dc.deal_id)) dcByDeal.set(dc.deal_id, []);
      dcByDeal.get(dc.deal_id).push(dc);
    }
    const byTitle = new Map();
    const byComp = new Map();
    for (const d of seedObj.deals || []) {
      const tk = normAlnum(d.title);
      if (tk) {
        if (!byTitle.has(tk)) byTitle.set(tk, []);
        byTitle.get(tk).push(d);
      }
      const ck = normAlnum(accMap.get(d.account_id)?.name || "");
      if (ck) {
        if (!byComp.has(ck)) byComp.set(ck, []);
        byComp.get(ck).push(d);
      }
    }
    return { accMap, contMap, dcByDeal, byTitle, byComp };
  }

  const pecasLookup = buildSeedLookup(pecas1211);
  const fullLookup = buildSeedLookup(full1011);
  const oldLookup = buildSeedLookup(oldSeed);

  const fallbackTaskDealsById = new Map();
  const fallbackDealContacts = [];
  const fallbackDcKeys = new Set();

  function registerExternalDealSnapshot(extDeal, lookup) {
    if (dealsById.has(extDeal.id)) return dealsById.get(extDeal.id);
    if (fallbackTaskDealsById.has(extDeal.id)) {
      return fallbackTaskDealsById.get(extDeal.id);
    }

    const srcAcc = lookup.accMap.get(extDeal.account_id);
    let mappedAccId = null;
    if (srcAcc) {
      mappedAccId = upsertAccount({
        rdOrgId: srcAcc.rd_organization_id || null,
        name: srcAcc.name,
        cleanDoc: String(srcAcc.document || "").replace(/\D/g, "") || null,
        email: srcAcc.email || null,
        phone: srcAcc.phone || null,
        createdAt: srcAcc.created_at,
      });
    }

    let operatorKey = extDeal.operator_key || null;
    if (!operatorKey && extDeal.operator_id) {
      operatorKey = operatorSpecById.get(extDeal.operator_id)?.key || null;
    }
    if (!operatorKey) operatorKey = "raiane_aguiar";

    const srcDcs = lookup.dcByDeal.get(extDeal.id) || [];
    for (const dc of srcDcs) {
      const srcCont = lookup.contMap.get(dc.contact_id);
      if (!srcCont) continue;
      const mappedContId = upsertContact({
        explicitId: srcCont.id,
        rdContactId: srcCont.rd_contact_id || null,
        name: srcCont.name,
        rawPhone: srcCont.phone || "",
        rawEmail: srcCont.email || "",
        role: dc.role || "buyer",
        accountId: mappedAccId,
        operatorKey,
        cleanDoc: srcCont.cnpj || null,
        createdAt: srcCont.created_at,
      });
      const fk = `${extDeal.id}:${mappedContId}`;
      if (!fallbackDcKeys.has(fk)) {
        fallbackDcKeys.add(fk);
        fallbackDealContacts.push({
          id: `dc-tf-suporte-ext-${fallbackDealContacts.length + 1}`,
          deal_id: extDeal.id,
          contact_id: mappedContId,
          role: dc.role || "buyer",
          is_primary: Boolean(dc.is_primary),
          created_at:
            dc.created_at || extDeal.created_at || new Date().toISOString(),
        });
      }
    }

    const snap = {
      id: extDeal.id,
      title: extDeal.title,
      account_id: mappedAccId,
      pipeline_id: extDeal.pipeline_id,
      stage_id: extDeal.stage_id,
      status: extDeal.status || "open",
      value: String(extDeal.value || "0.00"),
      currency: extDeal.currency || "BRL",
      expected_close_date: extDeal.expected_close_date || null,
      operator_key: operatorKey,
      source: extDeal.source || null,
      campaign: extDeal.campaign || null,
      rating: Number(extDeal.rating || 0),
      loss_reason: extDeal.loss_reason || null,
      paused_reason: extDeal.paused_reason || null,
      rd_deal_id:
        extDeal.rd_deal_id ||
        (extDeal.id.startsWith("deal-rd-") ? extDeal.id.slice(8) : null),
      custom_fields: extDeal.custom_fields || {},
      last_activity_at:
        extDeal.last_activity_at || extDeal.updated_at || extDeal.created_at,
      closed_at: extDeal.closed_at || null,
      created_at: extDeal.created_at || new Date().toISOString(),
      updated_at:
        extDeal.updated_at || extDeal.created_at || new Date().toISOString(),
    };
    fallbackTaskDealsById.set(snap.id, snap);
    return snap;
  }

  // 3. Read & link 100% of tasks from task_export CSV
  const TASK_TYPE_MAP = {
    [normKey("Tarefa")]: "task",
    [normKey("Almoço")]: "lunch",
    [normKey("Ligar")]: "call",
    [normKey("Reunião")]: "meeting",
    [normKey("E-mail")]: "email",
    [normKey("Email")]: "email",
    [normKey("Visita")]: "visit",
    [normKey("WhatsApp")]: "whatsapp",
  };

  const taskRows = readRdCsv(path.join(SUPORTE_DIR, TASK_CSV_FILE));
  let tasksMatchedSuporteTitle = 0;
  let tasksMatchedSuporteCompany = 0;
  let tasksMatchedPecas1211 = 0;
  let tasksMatchedFull1011 = 0;
  let tasksMatchedOldSeed = 0;
  let tasksUnmatched = 0;
  let tasksOverdueCount = 0;
  let tasksPendingCount = 0;
  let tasksCompletedCount = 0;

  for (let idx = 0; idx < taskRows.length; idx++) {
    const t = taskRows[idx];
    const dealTitleRaw = String(t["Negociação vinculada"] || "").trim();
    const dealTitleKey = normAlnum(dealTitleRaw);
    const companyKey = normAlnum(t["Empresa vinculada"]);
    const schedDateStr = String(t["Data agendada"] || "").trim();
    const schedTimeStr = String(t["Hora agendada"] || "").trim();

    const rawResps = String(t["Responsáveis"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const assigneeKeys = [];
    for (const r of rawResps) {
      if (NON_OPERATOR_TEAM_LABELS.has(normKey(r))) continue;
      const spec = matchActiveOperator(r);
      if (spec && !assigneeKeys.includes(spec.key)) {
        assigneeKeys.push(spec.key);
      }
    }

    let chosenDeal = null;

    // Tier 1: Match in Suporte Técnico deals by normalized title (with company cross-check)
    const sCands = dealTitleKey
      ? dealsByTitleAlnum.get(dealTitleKey) || []
      : [];
    if (sCands.length > 0) {
      let best = sCands[0];
      let bestScore = -1;
      for (const c of sCands) {
        let score = 0;
        if (assigneeKeys.includes(c.operator_key)) score += 40;
        const acc = c.account_id ? accountsById.get(c.account_id) : null;
        if (companyKey && acc && normAlnum(acc.name) === companyKey)
          score += 100;
        else if (!companyKey && !acc) score += 20;
        if (c.next_task_date_str === schedDateStr) score += 50;
        if (c.next_task_time_str === schedTimeStr) score += 25;
        if (c.status === "open") score += 15;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }

      const bestAcc = best.account_id ? accountsById.get(best.account_id) : null;
      const bestCompNorm = bestAcc ? normAlnum(bestAcc.name) : "";

      if (companyKey && bestCompNorm !== companyKey) {
        const pExact = (pecasLookup.byTitle.get(dealTitleKey) || []).find(
          (pd) =>
            normAlnum(pecasLookup.accMap.get(pd.account_id)?.name || "") ===
            companyKey,
        );
        const fExact = !pExact
          ? (fullLookup.byTitle.get(dealTitleKey) || []).find(
              (fd) =>
                normAlnum(fullLookup.accMap.get(fd.account_id)?.name || "") ===
                companyKey,
            )
          : null;
        const oExact =
          !pExact && !fExact
            ? (oldLookup.byTitle.get(dealTitleKey) || []).find(
                (od) =>
                  normAlnum(oldLookup.accMap.get(od.account_id)?.name || "") ===
                  companyKey,
              )
            : null;
        if (pExact) {
          chosenDeal = registerExternalDealSnapshot(pExact, pecasLookup);
          tasksMatchedPecas1211++;
        } else if (fExact) {
          chosenDeal = registerExternalDealSnapshot(fExact, fullLookup);
          tasksMatchedFull1011++;
        } else if (oExact) {
          chosenDeal = registerExternalDealSnapshot(oExact, oldLookup);
          tasksMatchedOldSeed++;
        } else {
          chosenDeal = best;
          tasksMatchedSuporteTitle++;
        }
      } else {
        chosenDeal = best;
        tasksMatchedSuporteTitle++;
      }
    }

    // Tier 2: Match in Peças 12/11 Seed deals by normalized title
    if (!chosenDeal && dealTitleKey && pecasLookup.byTitle.has(dealTitleKey)) {
      const pCands = pecasLookup.byTitle.get(dealTitleKey);
      const picked =
        pCands.find(
          (pd) =>
            companyKey &&
            normAlnum(pecasLookup.accMap.get(pd.account_id)?.name || "") ===
              companyKey,
        ) || pCands[0];
      chosenDeal = registerExternalDealSnapshot(picked, pecasLookup);
      tasksMatchedPecas1211++;
    }

    // Tier 3: Match in 10/11 Full Seed deals by normalized title
    if (!chosenDeal && dealTitleKey && fullLookup.byTitle.has(dealTitleKey)) {
      const fCands = fullLookup.byTitle.get(dealTitleKey);
      const picked =
        fCands.find(
          (fd) =>
            companyKey &&
            normAlnum(fullLookup.accMap.get(fd.account_id)?.name || "") ===
              companyKey,
        ) || fCands[0];
      chosenDeal = registerExternalDealSnapshot(picked, fullLookup);
      tasksMatchedFull1011++;
    }

    // Tier 4: Match in Old CRM Seed deals by normalized title
    if (!chosenDeal && dealTitleKey && oldLookup.byTitle.has(dealTitleKey)) {
      const oCands = oldLookup.byTitle.get(dealTitleKey);
      const picked =
        oCands.find(
          (od) =>
            companyKey &&
            normAlnum(oldLookup.accMap.get(od.account_id)?.name || "") ===
              companyKey,
        ) || oCands[0];
      chosenDeal = registerExternalDealSnapshot(picked, oldLookup);
      tasksMatchedOldSeed++;
    }

    // Tier 5: Match by normalized company across Suporte -> Peças -> Full -> Old
    if (!chosenDeal && companyKey && dealsByCompanyAlnum.has(companyKey)) {
      const compCands = dealsByCompanyAlnum.get(companyKey);
      const picked =
        compCands.find(
          (d) =>
            d.next_task_date_str === schedDateStr ||
            assigneeKeys.includes(d.operator_key),
        ) || compCands[0];
      chosenDeal = picked;
      tasksMatchedSuporteCompany++;
    }
    if (!chosenDeal && companyKey && pecasLookup.byComp.has(companyKey)) {
      chosenDeal = registerExternalDealSnapshot(
        pecasLookup.byComp.get(companyKey)[0],
        pecasLookup,
      );
      tasksMatchedPecas1211++;
    }
    if (!chosenDeal && companyKey && fullLookup.byComp.has(companyKey)) {
      chosenDeal = registerExternalDealSnapshot(
        fullLookup.byComp.get(companyKey)[0],
        fullLookup,
      );
      tasksMatchedFull1011++;
    }
    if (!chosenDeal && companyKey && oldLookup.byComp.has(companyKey)) {
      chosenDeal = registerExternalDealSnapshot(
        oldLookup.byComp.get(companyKey)[0],
        oldLookup,
      );
      tasksMatchedOldSeed++;
    }

    if (!chosenDeal) {
      tasksUnmatched++;
      continue;
    }

    const primaryAssigneeKey =
      assigneeKeys.length > 0 ? assigneeKeys[0] : chosenDeal.operator_key;
    const rawCreator = t["Usuário que criou"] || t["Criado por"] || "";
    const creatorSpec = matchActiveOperator(rawCreator);
    const creatorKey = creatorSpec ? creatorSpec.key : primaryAssigneeKey;

    const actType = TASK_TYPE_MAP[normKey(t["Tipo"])] || "task";
    const statusNorm = normKey(t["Status"]);
    const completedAt = parseBrDateTime(
      t["Data da conclusão"],
      t["Hora da conclusão"],
    );
    const isCompleted =
      statusNorm === "concluida" ||
      statusNorm === "concluido" ||
      Boolean(completedAt);

    if (isCompleted) tasksCompletedCount++;
    else if (statusNorm.includes("atrasad")) tasksOverdueCount++;
    else tasksPendingCount++;

    const dueDate = parseBrDateTime(schedDateStr, schedTimeStr);
    const createdAt =
      parseBrDateTime(t["Data de criação"], t["Hora de criação"]) ||
      dueDate ||
      new Date().toISOString();

    const title = String(t["Assunto"] || t["Tipo"] || "Tarefa").trim();
    const description = String(t["Descrição"] || "").trim() || null;

    activities.push({
      id: `task-rd-suporte-${String(idx + 1).padStart(5, "0")}`,
      deal_id: chosenDeal.id,
      type: actType,
      title,
      description,
      status: isCompleted ? "completed" : "pending",
      due_date: dueDate,
      completed_at: isCompleted ? completedAt || createdAt : null,
      creator_key: creatorKey,
      primary_assignee_key: primaryAssigneeKey,
      assignee_keys:
        assigneeKeys.length > 0 ? assigneeKeys : [primaryAssigneeKey],
      created_at: createdAt,
      updated_at: isCompleted ? completedAt || createdAt : createdAt,
    });
  }

  // 4. Assemble required Pipelines & Stages (FUNIL SUPORTE TÉCNICO + FUNIL TESTES + any pipeline referenced by fallbackTaskDeals)
  const neededPipeIds = new Set([
    "pipe-tecfag-suporte-tecnico",
    "pipe-tecfag-testes",
  ]);
  for (const fd of fallbackTaskDealsById.values()) {
    if (fd.pipeline_id) neededPipeIds.add(fd.pipeline_id);
  }

  const allKnownPipelines = new Map();
  for (const p of oldSeed.pipelines || []) allKnownPipelines.set(p.id, p);
  for (const p of full1011.pipelines || []) allKnownPipelines.set(p.id, p);
  for (const p of pecas1211.pipelines || []) allKnownPipelines.set(p.id, p);
  allKnownPipelines.set("pipe-tecfag-suporte-tecnico", {
    id: "pipe-tecfag-suporte-tecnico",
    tenant_id: "tecfag",
    name: "FUNIL SUPORTE TÉCNICO",
    order_index: 5,
    is_default: false,
    color: "#0ea5e9",
    cooling_days: 10,
    rd_pipeline_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const pipelines = Array.from(neededPipeIds)
    .map((id) => allKnownPipelines.get(id))
    .filter(Boolean);

  const allKnownStages = new Map();
  for (const s of oldSeed.stages || []) {
    if (s.pipeline_id !== "pipe-tecfag-suporte-tecnico")
      allKnownStages.set(s.id, s);
  }
  for (const s of full1011.stages || []) {
    if (s.pipeline_id !== "pipe-tecfag-suporte-tecnico")
      allKnownStages.set(s.id, s);
  }
  for (const s of pecas1211.stages || []) {
    if (s.pipeline_id !== "pipe-tecfag-suporte-tecnico")
      allKnownStages.set(s.id, s);
  }
  for (const ss of SUPORTE_STAGE_DEFS) {
    allKnownStages.set(ss.id, {
      ...ss,
      tenant_id: "tecfag",
      pipeline_id: "pipe-tecfag-suporte-tecnico",
      required_fields: [],
      rd_stage_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const stages = Array.from(allKnownStages.values()).filter((s) =>
    neededPipeIds.has(s.pipeline_id),
  );

  const cleanDeals = Array.from(dealsById.values()).map(
    ({ next_task_date_str, next_task_time_str, ...rest }) => rest,
  );
  const cleanContacts = Array.from(contactsById.values()).map(
    ({ phoneIdentity, ...rest }) => rest,
  );
  const cleanAccounts = Array.from(accountsById.values());
  const cleanFallbackTaskDeals = Array.from(fallbackTaskDealsById.values());

  const payload = {
    generatedAt: new Date().toISOString(),
    tenantId: "tecfag",
    operatorSpecs: ACTIVE_OPERATOR_SPECS,
    pipelines,
    stages,
    customFields: oldSeed.customFields,
    accounts: cleanAccounts,
    contacts: cleanContacts,
    deals: cleanDeals,
    fallbackTaskDeals: cleanFallbackTaskDeals,
    dealContacts,
    fallbackDealContacts,
    activities,
  };

  const compressed = zlib.gzipSync(
    Buffer.from(JSON.stringify(payload), "utf8"),
    { level: 9 },
  );
  fs.writeFileSync(OUTPUT_SEED_PATH, compressed);

  const dealsByPipe = {};
  const dealsByStage = {};
  const dealsByOp = {};
  for (const d of cleanDeals) {
    dealsByPipe[d.pipeline_id] = (dealsByPipe[d.pipeline_id] || 0) + 1;
    dealsByStage[d.stage_id] = (dealsByStage[d.stage_id] || 0) + 1;
    dealsByOp[d.operator_key] = (dealsByOp[d.operator_key] || 0) + 1;
  }

  console.log("=== TECFAG SUPORTE TÉCNICO RD CRM MIGRATION PAYLOAD GENERATED ===");
  console.log({
    outputFile: OUTPUT_SEED_PATH,
    compressedSizeMB: (compressed.length / (1024 * 1024)).toFixed(2) + " MB",
    dealRowsRead: dealRows.length,
    uniqueSuporteDealsTotal: cleanDeals.length,
    fallbackExternalTaskDealsTotal: cleanFallbackTaskDeals.length,
    dealsByPipeline: dealsByPipe,
    dealsByStage,
    topDealOwners: Object.entries(dealsByOp)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
    legacyDealsRoutedToViniciusTestes: legacyDealsToViniciusTestes,
    rowsWithoutContactSkippedFakeCreation,
    uniqueAccountsTotal: cleanAccounts.length,
    uniqueContactsTotal: cleanContacts.length,
    contactsWithMultiplePhones: cleanContacts.filter(
      (c) => (c.phones || []).length > 1,
    ).length,
    dealContactsLinksTotal: dealContacts.length,
    fallbackDealContactsLinksTotal: fallbackDealContacts.length,
    tasksTotalRead: taskRows.length,
    tasksImportedTotal:
      tasksMatchedSuporteTitle +
      tasksMatchedSuporteCompany +
      tasksMatchedPecas1211 +
      tasksMatchedFull1011 +
      tasksMatchedOldSeed,
    tasksMatchedSuporteTitle,
    tasksMatchedSuporteCompany,
    tasksMatchedPecas1211,
    tasksMatchedFull1011,
    tasksMatchedOldSeed,
    tasksUnmatched,
    tasksOverdueImported: tasksOverdueCount,
    tasksPendingImported: tasksPendingCount,
    tasksCompletedImported: tasksCompletedCount,
    timelineNotesGenerated: activities.filter((a) => a.type === "note").length,
  });
}
