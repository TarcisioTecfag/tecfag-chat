import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import XLSX from "xlsx";

const CSV_PATH =
  process.argv[2] ||
  "C:/Users/TEC FAG/Downloads/Nova pasta (71)/673b397d6c7532001f2b0508_deal_export_2026-11-19_14_11.csv";
const OUTPUT_SEED_PATH = path.resolve(
  "scripts/data/tecfag-sdr-rd-crm-2026-11-19.json.gz",
);

function readRdCsv(filePath) {
  let raw = fs.readFileSync(filePath, "utf8");
  raw = raw.replace(/^\uFEFF/, "").replace(/^sep=[^\r\n]+[\r\n]+/i, "");
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

function isTestEntityTitle(rawTitle) {
  if (!rawTitle) return false;
  return /(?:^|[^a-zA-ZÀ-ÿ0-9])testes?(?:$|[^a-zA-ZÀ-ÿ0-9])/i.test(
    String(rawTitle).trim(),
  );
}

/**
 * Exact JavaScript mirror of PostgreSQL `contact_phone_identity(value text)`
 * from `src/db/migrations/0056_contact_multiple_phones.sql`.
 */
function pgContactPhoneIdentity(value) {
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
  let digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  if (digits.startsWith("00") && digits.length > 11) {
    digits = digits.slice(2);
  }
  digits = digits.replace(/^0+/, "");
  if (digits.length < 8) return "";
  if (digits.startsWith("5555") && digits.length >= 14) {
    digits = digits.slice(2);
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

function parseBrDateTime(dateStr, timeStr) {
  const d = String(dateStr || "").trim();
  if (!d) return null;
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, day, month, year] = m;
    const t = String(timeStr || "").trim();
    const tm = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const hh = tm ? tm[1].padStart(2, "0") : "12";
    const mm = tm ? tm[2] : "00";
    const ss = tm && tm[3] ? tm[3] : "00";
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
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
  }
  if (s.includes(",")) {
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
  }
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function extractCleanDocument(...texts) {
  for (const raw of texts) {
    const str = String(raw || "");
    if (!str) continue;
    const mLabeled = str.match(/CNPJ\s*\/?\s*CPF\s*:\s*([0-9.\-\/]+)/i);
    if (mLabeled) {
      const d = mLabeled[1].replace(/\D/g, "");
      if ((d.length === 11 || d.length === 14) && !/^(\d)\1+$/.test(d)) {
        return d;
      }
    }
    const mCnpj = str.match(/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/);
    if (mCnpj) {
      const d = mCnpj[1].replace(/\D/g, "");
      if (d.length === 14 && !/^(\d)\1+$/.test(d)) return d;
    }
    const mCpf = str.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);
    if (mCpf) {
      const d = mCpf[1].replace(/\D/g, "");
      if (d.length === 11 && !/^(\d)\1+$/.test(d)) return d;
    }
  }
  return "";
}

function normalizeSdrSource(rawSource) {
  const s = String(rawSource || "").trim();
  if (!s) return null;
  const nk = normKey(s);
  if (
    nk === "(direct)" ||
    nk === "direct" ||
    nk === "(none)" ||
    nk === "direto" ||
    nk === "trafego direto" ||
    /^referencia\s*\|\s*(www\.)?tecfag[a-z0-9-]*\.com(\.br)?$/i.test(nk) ||
    /^(www\.)?tecfag[a-z0-9-]*\.com(\.br)?$/i.test(nk)
  ) {
    return "Tráfego Direto";
  }
  if (nk === "contato pelo site") return "Contato pelo Site";
  return s;
}

const ACTIVE_OPERATOR_SPECS = [
  {
    key: "rafaela_lima",
    id: "op-1791376855232",
    email: "apoiocomercial3@tecfag.com.br",
    name: "Rafaela Lima",
    rdNames: ["Rafaela Lima"],
  },
  {
    key: "isabella_inhesta",
    id: "op-1793810331796",
    email: "apoiocomercial@tecfag.com.br",
    name: "Isabella Inhesta",
    rdNames: ["Isabella Inhesta", "Isabella Machado", "Isabella  Machado"],
  },
  {
    key: "cesar_trassatte",
    id: "op-1793276657016",
    email: "apoiocomercial2@tecfag.com.br",
    name: "Cesar Trassatte",
    rdNames: ["Cesar Trassatte"],
  },
  {
    key: "keicy_cardoso",
    id: "op-1794490464050",
    email: "vendas21@tecfag.com.br",
    name: "Keicy Cardoso",
    rdNames: ["Keicy Cardoso"],
  },
  {
    key: "diana_vieira",
    id: "op-1791376744668",
    email: "vendas14@tecfag.com.br",
    name: "Diana Vieira",
    rdNames: ["Diana Vieira", "Diana Gimenes", "Diana Gimenes - 93"],
  },
  {
    key: "pamela_titato",
    id: "op-1794224168499",
    email: "vendas8@tecfag.com.br",
    name: "Pamela Titato",
    rdNames: ["Pamela Titato", "Pamela Titato - 98"],
  },
  {
    key: "matheus_henrique",
    id: "op-1791377324588",
    email: "assistencia7@tecfag.com.br",
    name: "Matheus Henrique",
    rdNames: ["Matheus Henrique"],
  },
  {
    key: "denis_menezes",
    id: "op-1794223754650",
    email: "vendas1@tecfag.com.br",
    name: "Denis Menezes",
    rdNames: ["Denis Menezes", "Denis Menezes - 125"],
  },
  {
    key: "raiane_aguiar",
    id: "op-1791377346185",
    email: "assistencia@tecfag.com.br",
    name: "Raiane Aguiar",
    rdNames: ["Raiane Aguiar", "Raiane Aguiar - 114"],
  },
  {
    key: "guilherme_bertola",
    id: "op-1791376760659",
    email: "vendas18@tecfag.com.br",
    name: "Guilherme Bertola",
    rdNames: ["Guilherme Bertola", "Guilherme Bertola - 115"],
  },
  {
    key: "melissa_gomes",
    id: "op-1791376839829",
    email: "vendas3@tecfag.com.br",
    name: "Melissa Gomes",
    rdNames: ["Melissa Gomes", "Melissa Gomes - 80"],
  },
  {
    key: "denise_gomes",
    id: "op-1791376727270",
    email: "vendas16@tecfag.com.br",
    name: "Denise Gomes",
    rdNames: ["Denise Gomes", "Denise Gomes - 34"],
  },
  {
    key: "marcelo_nardelli",
    id: "op-1791376825772",
    email: "vendas17@tecfag.com.br",
    name: "Marcelo Nardelli",
    rdNames: ["Marcelo Nardelli", "Marcelo Nardelli - 118"],
  },
  {
    key: "victor_goes",
    id: "op-1791376883222",
    email: "vendas12@tecfag.com.br",
    name: "Victor Goes",
    rdNames: ["Victor Goes", "Victor Goes - 95"],
  },
  {
    key: "beatriz_ribeiro",
    id: "op-1791376711001",
    email: "vendas7@tecfag.com.br",
    name: "Beatriz Ribeiro",
    rdNames: ["Beatriz Ribeiro", "Beatriz Ribeiro - 96"],
  },
  {
    key: "lucimara_dal_mora",
    id: "op-1791377140738",
    email: "sac@tecfag.com.br",
    name: "Lucimara Dal Mora",
    rdNames: ["Lucimara Dal Mora"],
  },
  {
    key: "jhordan_rueda",
    id: "op-1791376776876",
    email: "vendas4@tecfag.com.br",
    name: "Jhordan Rueda",
    rdNames: ["Jhordan Rueda", "Jhordan Rueda - 102"],
  },
  {
    key: "deborah_alves",
    id: "op-1794601994898",
    email: "ouvidoria@tecfag.com.br",
    name: "Deborah Alves",
    rdNames: ["Deborah Alves", "Deborah Alves - 94", "Deborah Rayane"],
  },
  {
    key: "evelyn_silveira",
    id: "op-1793791337754",
    email: "vendas22@tecfag.com.br",
    name: "Evelyn Silveira",
    rdNames: ["Evelyn Silveira"],
  },
  {
    key: "gustavo_sessilio",
    id: "op-1791377401679",
    email: "ecommerce@tecfag.com.br",
    name: "Gustavo Sessilio",
    rdNames: ["Gustavo Sessilio"],
  },
  {
    key: "adriano_ordonho",
    id: "op-1791376660777",
    email: "vendas20@tecfag.com.br",
    name: "Adriano Ordonho",
    rdNames: ["Adriano Ordonho"],
  },
  {
    key: "lucas_rosenvaldo",
    id: "op-1791376812068",
    email: "vendas19@tecfag.com.br",
    name: "Lucas",
    rdNames: ["Lucas", "Rosenvaldo Lucas", "Rosenvaldo Lucas - 121", "Lucas Rosenvaldo"],
  },
  {
    key: "jonatas_oliveira",
    id: "op-1791377471541",
    email: "suporte4@tecfag.com.br",
    name: "Jonatas Oliveira",
    rdNames: ["Jonatas Oliveira", "Jonatas  Oliveira"],
  },
  {
    key: "melissa_bueno",
    id: "op-1791377157191",
    email: "posvenda@tecfag.com.br",
    name: "Melissa Bueno",
    rdNames: ["Melissa Bueno"],
  },
  {
    key: "vinicius_capetti",
    id: "op-1793048671367",
    email: "vendas9@tecfag.com.br",
    name: "Vinicius",
    rdNames: ["Vinicius", "Vinicius Capetti"],
  },
];

const rdNameMap = new Map();
for (const spec of ACTIVE_OPERATOR_SPECS) {
  rdNameMap.set(normKey(spec.name), spec);
  for (const rn of spec.rdNames) {
    rdNameMap.set(normKey(rn), spec);
    const stripped = normKey(rn.replace(/-\s*\d+$/, ""));
    if (stripped) rdNameMap.set(stripped, spec);
  }
}

function matchActiveOperator(rawRdName) {
  const k = normKey(rawRdName);
  if (!k) return null;
  if (rdNameMap.has(k)) return rdNameMap.get(k);
  const stripped = normKey(String(rawRdName).replace(/-\s*\d+$/, ""));
  if (stripped && rdNameMap.has(stripped)) return rdNameMap.get(stripped);
  return null;
}

const SDR_STAGES = [
  { id: "stg-tf-sdr-para-triar", name: "PARA TRIAR", order_index: 0 },
  { id: "stg-tf-sdr-em-triagem", name: "EM TRIAGEM", order_index: 1 },
  { id: "stg-tf-sdr-para-analise", name: "PARA ANÁLISE", order_index: 2 },
  { id: "stg-tf-sdr-sem-resposta", name: "SEM RESPOSTA", order_index: 3 },
  { id: "stg-tf-sdr-ativos", name: "ATIVOS", order_index: 4 },
  { id: "stg-tf-sdr-tecfag-crm", name: "TECFAG CRM", order_index: 5 },
  { id: "stg-tf-sdr-requalificacao", name: "REQUALIFICAÇÃO", order_index: 6 },
  { id: "stg-tf-sdr-desqualificado", name: "DESQUALIFICADO", order_index: 7 },
];

const SDR_STAGE_BY_NORM = new Map(
  SDR_STAGES.map((s) => [normKey(s.name), s.id]),
);

function resolveSdrStageId(rawStageName) {
  const k = normKey(rawStageName);
  return SDR_STAGE_BY_NORM.get(k) || "stg-tf-sdr-em-triagem";
}

const CF_SEED_IDS = {
  CLIENTE_NOVO: "cf-6301c0e7-a9df-422d-99f0-524cb88b2f30",
  QUALIFICADO_SDR: "cf-dbf17e8d-6657-4dea-8914-2fb60ab3cc3f",
  PROPOSTA_NEXT: "cf-3d854c1d-03eb-43ab-9959-394a4792fe8b",
  PRODUTO_FABRICADO: "cf-39e7205f-b6bb-4522-8a6e-03e3180b1025",
  TIPO_PRODUTO: "cf-4c8d4c1d-ef02-4dfe-82b2-64b0e7aaa5b9",
  VOLUME_PRODUCAO: "cf-a3669215-f9e7-46fd-a2e9-754ca2356ef3",
};

function buildDealCustomFields(row, matchedOp) {
  const cf = {};

  const rawClienteNovo = normKey(row["CLIENTE NOVO?"]);
  if (rawClienteNovo) {
    if (rawClienteNovo.includes("sim")) cf[CF_SEED_IDS.CLIENTE_NOVO] = "sim";
    else if (rawClienteNovo.includes("nao")) cf[CF_SEED_IDS.CLIENTE_NOVO] = "nao";
    else if (rawClienteNovo.includes("pecas")) cf[CF_SEED_IDS.CLIENTE_NOVO] = "pecas";
    else cf[CF_SEED_IDS.CLIENTE_NOVO] = String(row["CLIENTE NOVO?"]).trim();
    cf["cf-tf-deal-cliente-novo"] = String(row["CLIENTE NOVO?"]).trim();
  }

  const rawQualSdrText = String(
    row["QUALIFICADO POR SDR"] || row["QUALIFICADO POR SDR (VALEM) T"] || "",
  ).trim();
  const rawQualSdr = normKey(rawQualSdrText);
  if (rawQualSdr) {
    if (rawQualSdr === "quente") cf[CF_SEED_IDS.QUALIFICADO_SDR] = "quente";
    else if (rawQualSdr === "morno") cf[CF_SEED_IDS.QUALIFICADO_SDR] = "morno";
    else if (rawQualSdr === "frio") cf[CF_SEED_IDS.QUALIFICADO_SDR] = "frio";
    else if (rawQualSdr.includes("planejando")) cf[CF_SEED_IDS.QUALIFICADO_SDR] = "planejando";
    else if (rawQualSdr.includes("decisor")) cf[CF_SEED_IDS.QUALIFICADO_SDR] = "decisor";
    else if (rawQualSdr.includes("troca")) cf[CF_SEED_IDS.QUALIFICADO_SDR] = "troca";
    else if (rawQualSdr.includes("pecas") || rawQualSdr.includes("reposicao")) cf[CF_SEED_IDS.QUALIFICADO_SDR] = "pecas";
    else if (rawQualSdr.includes("revenda")) cf[CF_SEED_IDS.QUALIFICADO_SDR] = "revenda";
    else if (rawQualSdr.includes("recompra")) cf[CF_SEED_IDS.QUALIFICADO_SDR] = "recompra";
    else if (rawQualSdr.includes("curioso") || rawQualSdr.includes("estudante")) cf[CF_SEED_IDS.QUALIFICADO_SDR] = "curioso";
    else cf[CF_SEED_IDS.QUALIFICADO_SDR] = rawQualSdrText;
    cf["cf-tf-deal-sdr-qualificacao"] = rawQualSdrText;
  }

  const rawProposta = String(
    row["PROPOSTA NEXT"] || row["PROPOSTA"] || row["PROPOSTA."] || "",
  ).trim();
  if (rawProposta) {
    const num = parseInt(rawProposta, 10);
    cf[CF_SEED_IDS.PROPOSTA_NEXT] = Number.isNaN(num) ? rawProposta : num;
    cf["cf-tf-deal-proposta"] = rawProposta;
  }

  const rawProdFab = String(row["QUAL O PRODUTO FABRICADO?"] || "").trim();
  if (rawProdFab) {
    cf[CF_SEED_IDS.PRODUTO_FABRICADO] = rawProdFab;
    cf["cf-tf-deal-produto-fabricado"] = rawProdFab;
  }

  const rawTipoProdText = String(
    row["QUAL O TIPO DE PRODUTO DO CLIENTE"] || row["QUAL O TIPO DE PRODUTO? T"] || "",
  ).trim();
  const rawTipoProd = normKey(rawTipoProdText);
  if (rawTipoProd) {
    if (rawTipoProd.includes("cosmetico") || rawTipoProd.includes("farmaceutico")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "cosmeticos";
    } else if (rawTipoProd.includes("liquido") || rawTipoProd.includes("pastoso")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "alimentos_liquidos";
    } else if (rawTipoProd.includes("grao") || rawTipoProd.includes("pos") || rawTipoProd.includes("farinha") || rawTipoProd.includes("cafe")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "alimentos_graos";
    } else if (rawTipoProd.includes("snack") || rawTipoProd.includes("congelado") || rawTipoProd.includes("chips")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "alimentos_snacks";
    } else if (rawTipoProd.includes("bebida") || rawTipoProd.includes("suco") || rawTipoProd.includes("agua") || rawTipoProd.includes("cerveja")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "bebidas";
    } else if (rawTipoProd.includes("quimico") || rawTipoProd.includes("limpeza") || rawTipoProd.includes("tinta")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "quimicos";
    } else if (rawTipoProd.includes("pet") || rawTipoProd.includes("racao")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "pet_shop";
    } else if (rawTipoProd.includes("construcao") || rawTipoProd.includes("argamassa")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "construcao";
    } else if (rawTipoProd.includes("pecas")) {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "pecas";
    } else {
      cf[CF_SEED_IDS.TIPO_PRODUTO] = "outros";
    }
    cf["cf-tf-deal-tipo-produto-cliente"] = rawTipoProdText;
  }

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
    cf[CF_SEED_IDS.VOLUME_PRODUCAO] =
      matchedIds.length > 0 ? matchedIds : [rawVolStr];
    cf["cf-tf-deal-volume-producao"] = rawVolStr;
  }

  const extraMappings = [
    ["cf-tf-deal-ajuda-necessaria", ["ONDE O CLIENTE PRECISA DE AJUDA?"]],
    ["cf-tf-deal-processo-atual", ["COMO É FEITO HOJE?"]],
    ["cf-tf-deal-expectativa-uso", ["EXPECTATIVA DE USO?"]],
    ["cf-tf-deal-nivel-automacao", ["NÍVEL DE AUTOMAÇÃO EXIGIDO"]],
    ["cf-tf-deal-tipo-embalagem", ["QUE TIPO DE EMBALAGEM?"]],
    ["cf-tf-deal-producao-hora", ["PRODUÇÃO DESEJADA POR HORA"]],
    ["cf-tf-deal-perfil-cliente", ["QUAL PERFIL O CLIENTE SE ENCAIXA?"]],
    ["cf-tf-deal-apresentacao-proposta", ["APRESENTAÇÃO DA PROPOSTA"]],
    ["cf-tf-deal-projetos-desenvolvimento", ["PROJETOS / DESENVOLVIMENTO"]],
    ["cf-tf-deal-info-complementares", ["INFORMAÇÕES COMPLEMENTARES"]],
    ["cf-tf-deal-escopo-validado", ["ESCOPO VALIDADO PELO CLIENTE"]],
    ["cf-tf-deal-destino-projeto", ["DESTINO FINAL DO PROJETO (AUDITORIA CEO)"]],
    ["cf-tf-deal-justificativa-movimentacao", ["JUSTIFICATIVA DE MOVIMENTAÇÃO DE PROJETO"]],
    ["cf-tf-deal-descricao", ["DESCRIÇÃO"]],
    ["cf-tf-deal-feito-por", ["FEITO POR", "FEITO POR "]],
    ["cf-tf-deal-equipamento", ["EQUIPAMENTO"]],
    ["cf-tf-deal-budget", ["Budget"]],
    ["cf-tf-deal-pre-analise", ["PRÉ-ANÁLISE ", "PRÉ-ANÁLISE"]],
    ["cf-tf-deal-anotacao-perda", ["Anotação do motivo de perda"]],
    ["cf-tf-deal-equipes-responsavel", ["Equipes do responsável"]],
    ["cf-tf-deal-produtos", ["Produtos"]],
    ["cf-tf-deal-foto-anexada", ["FOTO ANEXADA?"]],
    ["cf-tf-deal-qual-cliente", ["QUAL É O CLIENTE?"]],
    ["cf-tf-deal-video-chamada", ["VIDEO CHAMADA?"]],
    ["cf-tf-deal-visita-tecnica", ["VISITA TÉCNICA?"]],
    ["cf-tf-deal-tem-etiqueta", ["TEM ETIQUETA?"]],
    ["cf-tf-deal-numero-os", ["NUMERO DA OS"]],
    ["cf-tf-deal-tipo-atendimento", ["TIPO DE ATENDIMENTO"]],
    ["cf-tf-deal-tipo-pecas", ["TIPO ", "TIPO"]],
  ];

  for (const [cfKey, colNames] of extraMappings) {
    for (const colName of colNames) {
      const val = String(row[colName] || "").trim();
      if (val) {
        cf[cfKey] = val;
        break;
      }
    }
  }

  if (!matchedOp) {
    const origResp = String(row["Responsável"] || "").trim();
    if (origResp) cf.responsavel_original_rd = origResp;
  }

  return cf;
}

const rows = readRdCsv(CSV_PATH);

// Group rows by RD Deal ID so multi-contact deals produce 1 deal + N contacts
const rowsByDealId = new Map();
for (const row of rows) {
  const rdDealId = String(row["ID"] || "").trim();
  if (!rdDealId) continue;
  if (!rowsByDealId.has(rdDealId)) rowsByDealId.set(rdDealId, []);
  rowsByDealId.get(rdDealId).push(row);
}

// Accounts deduplication inside payload
const accountsById = new Map();
const accIdByDoc = new Map();
const accIdByRdOrg = new Map();
const accIdByName = new Map();

function upsertPayloadAccount({ name, rdOrgId, doc, createdAt }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return null;
  const cleanRdOrg = String(rdOrgId || "").trim();
  const cleanDoc = String(doc || "").replace(/\D/g, "");
  const validDoc =
    (cleanDoc.length === 11 || cleanDoc.length === 14) && !/^(\d)\1+$/.test(cleanDoc)
      ? cleanDoc
      : "";

  let accId = null;
  if (validDoc && accIdByDoc.has(validDoc)) accId = accIdByDoc.get(validDoc);
  else if (cleanRdOrg && accIdByRdOrg.has(cleanRdOrg)) accId = accIdByRdOrg.get(cleanRdOrg);
  else if (accIdByName.has(normKey(cleanName))) accId = accIdByName.get(normKey(cleanName));
  else accId = cleanRdOrg ? `acc-rd-${cleanRdOrg}` : `acc-rd-sdr-${normKey(cleanName).replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`;

  if (validDoc && !accIdByDoc.has(validDoc)) accIdByDoc.set(validDoc, accId);
  if (cleanRdOrg && !accIdByRdOrg.has(cleanRdOrg)) accIdByRdOrg.set(cleanRdOrg, accId);
  if (!accIdByName.has(normKey(cleanName))) accIdByName.set(normKey(cleanName), accId);

  if (!accountsById.has(accId)) {
    accountsById.set(accId, {
      id: accId,
      name: cleanName,
      trade_name: cleanName,
      type: validDoc.length === 11 ? "person" : "company",
      document_type: validDoc ? (validDoc.length === 11 ? "CPF" : "CNPJ") : null,
      document: validDoc || null,
      rd_organization_id: cleanRdOrg || null,
      created_at: createdAt || new Date().toISOString(),
    });
  } else {
    const cur = accountsById.get(accId);
    if (!cur.document && validDoc) {
      cur.document = validDoc;
      cur.document_type = validDoc.length === 11 ? "CPF" : "CNPJ";
      cur.type = validDoc.length === 11 ? "person" : "company";
    }
    if (!cur.rd_organization_id && cleanRdOrg) cur.rd_organization_id = cleanRdOrg;
  }
  return accId;
}

// Contacts deduplication inside payload
const contactsById = new Map();
const contactIdByPhoneIdentity = new Map();
const contactIdByRdContact = new Map();
const contactIdByEmail = new Map();

function upsertPayloadContact({
  rdContactId,
  name,
  email,
  phoneRaw,
  cargo,
  cnpj,
  accountId,
  operatorKey,
  source,
  campaign,
  createdAt,
}) {
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanRdContact = String(rdContactId || "").trim();
  const cleanCargo = String(cargo || "").trim();
  const phones = extractPhoneCandidates(phoneRaw);

  if (!cleanName && !cleanEmail && phones.length === 0) return null;

  let contactId = null;
  for (const p of phones) {
    if (contactIdByPhoneIdentity.has(p.identity)) {
      contactId = contactIdByPhoneIdentity.get(p.identity);
      break;
    }
  }
  if (!contactId && cleanRdContact && contactIdByRdContact.has(cleanRdContact)) {
    contactId = contactIdByRdContact.get(cleanRdContact);
  }
  if (!contactId && cleanEmail && contactIdByEmail.has(cleanEmail)) {
    const owner = contactsById.get(contactIdByEmail.get(cleanEmail));
    const ownerPrimaryId = owner?.phones?.[0]?.identity || "";
    const candPrimaryId = phones[0]?.identity || "";
    if (!ownerPrimaryId || !candPrimaryId || ownerPrimaryId === candPrimaryId) {
      contactId = owner.id;
    }
  }
  if (!contactId) {
    contactId = cleanRdContact
      ? `cont-rd-${cleanRdContact}`
      : phones[0]?.identity
        ? `cont-rd-ph-${phones[0].identity}`
        : `cont-rd-em-${cleanEmail.replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`;
  }

  for (const p of phones) {
    if (!contactIdByPhoneIdentity.has(p.identity)) {
      contactIdByPhoneIdentity.set(p.identity, contactId);
    }
  }
  if (cleanRdContact && !contactIdByRdContact.has(cleanRdContact)) {
    contactIdByRdContact.set(cleanRdContact, contactId);
  }
  if (cleanEmail && !contactIdByEmail.has(cleanEmail)) {
    contactIdByEmail.set(cleanEmail, contactId);
  }

  if (!contactsById.has(contactId)) {
    const ownedPhones = [];
    for (const p of phones) {
      const owner = contactIdByPhoneIdentity.get(p.identity);
      if (!owner || owner === contactId) {
        contactIdByPhoneIdentity.set(p.identity, contactId);
        ownedPhones.push({ phone: p.phone, identity: p.identity });
      }
    }
    contactsById.set(contactId, {
      id: contactId,
      name: cleanName || cleanEmail || ownedPhones[0]?.phone || "Contato Sem Nome",
      phone: ownedPhones[0]?.phone || "",
      phones: ownedPhones,
      email: cleanEmail || null,
      cargo: cleanCargo || null,
      cnpj: cnpj || null,
      account_id: accountId || null,
      wallet_operator_key: operatorKey || null,
      first_source: source || null,
      first_campaign: campaign || null,
      created_at: createdAt || new Date().toISOString(),
    });
  } else {
    const cur = contactsById.get(contactId);
    if (!cur.account_id && accountId) cur.account_id = accountId;
    if (!cur.email && cleanEmail) cur.email = cleanEmail;
    if (!cur.cargo && cleanCargo) cur.cargo = cleanCargo;
    if (!cur.cnpj && cnpj) cur.cnpj = cnpj;
    if (!cur.wallet_operator_key && operatorKey) cur.wallet_operator_key = operatorKey;
    if (!cur.first_source && source) cur.first_source = source;
    if (!cur.first_campaign && campaign) cur.first_campaign = campaign;
    const seen = new Set(cur.phones.map((x) => x.identity));
    for (const p of phones) {
      const owner = contactIdByPhoneIdentity.get(p.identity);
      if (!seen.has(p.identity) && (!owner || owner === contactId)) {
        contactIdByPhoneIdentity.set(p.identity, contactId);
        seen.add(p.identity);
        cur.phones.push({ phone: p.phone, identity: p.identity });
        if (!cur.phone) cur.phone = p.phone;
      }
    }
  }

  return contactId;
}

const deals = [];
const dealContacts = [];
const seenDealContactPairs = new Set();

for (const [rdDealId, dealRows] of rowsByDealId.entries()) {
  const row = dealRows[0];
  const title = String(row["Nome"] || "").trim() || `Negociação RD ${rdDealId}`;
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
  const expectedCloseDate = parseBrDateTime(row["Previsão de fechamento"], "");
  const updatedAt = closedAt || lastContactAt || createdAt;

  const estadoNorm = normKey(row["Estado"]);
  let status = "open";
  if (estadoNorm.includes("perdid")) status = "lost";
  else if (estadoNorm.includes("vendid") || estadoNorm.includes("ganh")) status = "won";

  const rawPaused = normKey(row["Pausada"]);
  const pausedReason = rawPaused === "sim" ? "Pausada no RD Station CRM" : null;

  const rawLossReason = String(row["Motivo de Perda"] || "").trim();
  const lossReason =
    rawLossReason && normKey(rawLossReason) !== "nada" ? rawLossReason : null;

  const source = normalizeSdrSource(row["Fonte"]);
  const campaign = String(row["Campanha"] || "").trim() || null;
  const rating = Math.max(0, Math.min(5, parseInt(String(row["Qualificação"] || "0"), 10) || 0));
  const value = parseBrNumeric(row["Valor Único"]);
  const stageId = resolveSdrStageId(row["Etapa"]);

  const matchedOp = matchActiveOperator(row["Responsável"]);
  const operatorKey = matchedOp ? matchedOp.key : null;

  const cleanDoc = extractCleanDocument(
    row["Empresa"],
    row["INFORMAÇÕES COMPLEMENTARES"],
    row["QUAL É O CLIENTE?"],
  );
  const accountId = upsertPayloadAccount({
    name: row["Empresa"],
    rdOrgId: row["ID da Empresa"],
    doc: cleanDoc,
    createdAt,
  });

  const customFields = buildDealCustomFields(row, matchedOp);
  const isTest = isTestEntityTitle(title);

  const dealId = `deal-rd-${rdDealId}`;
  deals.push({
    id: dealId,
    rd_deal_id: rdDealId,
    title,
    account_id: accountId,
    pipeline_id: "pipe-tecfag-sdr",
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
    paused_reason: pausedReason,
    custom_fields: customFields,
    is_test: isTest,
    won_at: status === "won" ? closedAt || updatedAt : null,
    lost_at: status === "lost" ? closedAt || updatedAt : null,
    closed_at: closedAt,
    last_activity_at: lastContactAt || updatedAt,
    created_at: createdAt,
    updated_at: updatedAt,
  });

  // Collect ALL contacts across all rows belonging to this RD deal
  let isFirstContact = true;
  for (const r of dealRows) {
    const contactId = upsertPayloadContact({
      rdContactId: r["ID do Contato"],
      name: r["Contatos"],
      email: r["Email"],
      phoneRaw: r["Telefone"],
      cargo: r["Cargo"],
      cnpj: cleanDoc || null,
      accountId,
      operatorKey,
      source,
      campaign,
      createdAt,
    });
    if (contactId) {
      const pairKey = `${dealId}:${contactId}`;
      if (!seenDealContactPairs.has(pairKey)) {
        seenDealContactPairs.add(pairKey);
        dealContacts.push({
          deal_id: dealId,
          contact_id: contactId,
          role: String(r["Cargo"] || "").trim().slice(0, 60) || "buyer",
          is_primary: isFirstContact,
          created_at: createdAt,
        });
        isFirstContact = false;
      }
    }
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  sourceCsv: path.basename(CSV_PATH),
  tenantId: "tecfag",
  pipeline: {
    id: "pipe-tecfag-sdr",
    name: "FUNIL SDR",
    order_index: 4,
    color: "#8b5cf6",
    cooling_days: 7,
  },
  stages: SDR_STAGES,
  operatorSpecs: ACTIVE_OPERATOR_SPECS,
  accounts: Array.from(accountsById.values()),
  contacts: Array.from(contactsById.values()),
  deals,
  dealContacts,
};

fs.mkdirSync(path.dirname(OUTPUT_SEED_PATH), { recursive: true });
const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
fs.writeFileSync(OUTPUT_SEED_PATH, gz);

console.log("[build-tecfag-sdr-rd-crm] Seed gerado com sucesso:", {
  output: OUTPUT_SEED_PATH,
  sizeKB: Math.round(gz.length / 1024),
  csvRows: rows.length,
  deals: deals.length,
  accounts: payload.accounts.length,
  contacts: payload.contacts.length,
  dealContacts: dealContacts.length,
  dealsWithoutContact: deals.filter(
    (d) => !dealContacts.some((dc) => dc.deal_id === d.id),
  ).length,
  exCollaboratorDeals: deals.filter((d) => !d.operator_key).length,
});
