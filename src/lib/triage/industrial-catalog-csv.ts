import { machineSchema, type IndustrialMachine } from "./industrial-settings";
import { inferMachineCategory } from "./tecfag-default-catalog";

export interface IndustrialCatalogCsvImportResult {
  catalog: IndustrialMachine[];
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  semiCount: number;
  personnaliteCount: number;
  inactiveCount: number;
  warnings: string[];
}

function normalizeHeaderKey(raw: string): string {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function detectCsvDelimiter(rawText: string): "," | ";" {
  const firstLine = rawText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  if (!firstLine) return ",";
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === ",") commas++;
      else if (ch === ";") semicolons++;
    }
  }
  return semicolons > commas ? ";" : ",";
}

/** Parser RFC-4180 com suporte a campos multilinhas entre aspas e separador `,` ou `;`. */
export function parseCsvMatrix(rawText: string, delimiter?: "," | ";"): string[][] {
  const clean = String(rawText || "").replace(/^\uFEFF/, "");
  const sep = delimiter || detectCsvDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        row.push(field);
        field = "";
      } else if (ch === "\r") {
        // ignora CR de CRLF
      } else if (ch === "\n") {
        row.push(field);
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function parseLineValue(raw: string, rowNumber: number): IndustrialMachine["line"] {
  const norm = normalizeHeaderKey(raw);
  if (
    norm === "semi" ||
    norm === "semi industrial" ||
    norm === "maquinas" ||
    norm === "maquina" ||
    norm.startsWith("semi ")
  ) {
    return "SEMI-INDUSTRIAL";
  }
  if (
    norm === "personalite" ||
    norm === "personnalite" ||
    norm.includes("personalit") ||
    norm.includes("personnalit")
  ) {
    return "PERSONNALITE";
  }
  throw new Error(
    `Linha ${rowNumber}: coluna LINHA inválida ("${raw || "vazio"}"). Use "Semi" ou "Personalite".`,
  );
}

function parseActiveValue(raw: string): boolean {
  const norm = normalizeHeaderKey(raw);
  if (!norm) return true;
  if (
    norm === "inativo" ||
    norm === "inativa" ||
    norm === "false" ||
    norm === "0" ||
    norm === "nao" ||
    norm === "desativado" ||
    norm === "desativada" ||
    norm === "pausado"
  ) {
    return false;
  }
  return true;
}

function cleanSingleLine(raw: string, maxLen: number): string {
  return String(raw || "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function cleanMultiline(raw: string, maxLen: number): string {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLen);
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h === candidate);
    if (idx >= 0) return idx;
  }
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h.includes(candidate));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Converte uma planilha CSV (formato padrão Tecfag `LINHA,NOME,CÓD. NEXT,SKU,PRODUTIVIDADE,...`)
 * em `IndustrialMachine[]`, preservando `id` e `aliases` de itens já existentes quando casam por `code`.
 */
export function parseIndustrialCatalogCsv(
  rawCsv: string,
  existingCatalog: IndustrialMachine[] = [],
): IndustrialCatalogCsvImportResult {
  const matrix = parseCsvMatrix(rawCsv);
  if (matrix.length < 2) {
    throw new Error("CSV vazio ou sem linhas de dados. Inclua o cabeçalho e ao menos 1 equipamento.");
  }

  const headers = matrix[0].map(normalizeHeaderKey);
  const idxLine = findColumnIndex(headers, ["linha", "line", "grupo", "group"]);
  const idxName = findColumnIndex(headers, ["nome", "name", "maquina", "equipamento", "produto"]);
  const idxCode = findColumnIndex(headers, ["cod next", "codigo next", "codigo", "code", "cod"]);
  const idxSku = findColumnIndex(headers, ["sku", "id vtex"]);
  const idxProd = findColumnIndex(headers, ["produtividade", "production", "capacidade"]);
  const idxDesc = findColumnIndex(headers, ["descricao sobre", "descricao", "description", "sobre"]);
  const idxStatus = findColumnIndex(headers, ["status", "ativo", "active"]);

  if (idxLine < 0 || idxName < 0) {
    throw new Error(
      'Cabeçalho CSV inválido. São obrigatórias ao menos as colunas "LINHA" e "NOME".',
    );
  }

  const existingByCode = new Map<string, IndustrialMachine>();
  const existingById = new Map<string, IndustrialMachine>();
  for (const item of existingCatalog) {
    if (item.code) existingByCode.set(item.code.trim().toUpperCase(), item);
    existingById.set(item.id, item);
  }

  const usedIds = new Set<string>();
  const warnings: string[] = [];
  const catalog: IndustrialMachine[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let nextSyntheticNumber = existingCatalog.length + 1;

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const rowNumber = i + 1;
    const rawName = cleanSingleLine(row[idxName] || "", 300);
    const rawLine = String(row[idxLine] || "").trim();
    if (!rawName && !rawLine) continue;
    if (rawName.length < 3) {
      warnings.push(`Linha ${rowNumber} ignorada: nome curto demais ("${rawName}").`);
      continue;
    }

    const line = parseLineValue(rawLine, rowNumber);
    const code = idxCode >= 0 ? cleanSingleLine(row[idxCode] || "", 100) : "";
    const sku = idxSku >= 0 ? cleanSingleLine(row[idxSku] || "", 100) : "";
    const production = idxProd >= 0 ? cleanSingleLine(row[idxProd] || "", 500) : "";
    const description = idxDesc >= 0 ? cleanMultiline(row[idxDesc] || "", 2000) : "";
    const active = idxStatus >= 0 ? parseActiveValue(row[idxStatus] || "") : true;

    const matched = code ? existingByCode.get(code.toUpperCase()) : undefined;
    let id = matched?.id || `catalog-csv-${nextSyntheticNumber++}`;
    while (usedIds.has(id)) {
      id = `catalog-csv-${nextSyntheticNumber++}`;
    }
    usedIds.add(id);

    if (matched) updatedCount++;
    else createdCount++;

    const parsed = machineSchema.parse({
      id,
      name: rawName,
      sku,
      code,
      line,
      production,
      description,
      aliases: matched?.aliases ? [...matched.aliases] : [],
      active,
    });
    catalog.push(parsed);
  }

  if (catalog.length === 0) {
    throw new Error("Nenhum equipamento válido foi encontrado no CSV.");
  }

  return {
    catalog,
    totalRows: catalog.length,
    createdCount,
    updatedCount,
    semiCount: catalog.filter((m) => m.line === "SEMI-INDUSTRIAL").length,
    personnaliteCount: catalog.filter((m) => m.line === "PERSONNALITE").length,
    inactiveCount: catalog.filter((m) => !m.active).length,
    warnings,
  };
}

function escapeCsvCell(value: string): string {
  const str = String(value ?? "");
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Exporta o catálogo em CSV UTF-8 (com BOM para Excel Windows) no padrão oficial da planilha Tecfag. */
export function exportIndustrialCatalogCsv(catalog: IndustrialMachine[]): string {
  const header = [
    "LINHA",
    "NOME",
    "CÓD. NEXT",
    "SKU",
    "PRODUTIVIDADE",
    "FAMÍLIA",
    "DESCRIÇÃO / SOBRE",
    "LINK",
    "STATUS",
  ];
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const m of catalog) {
    const linha = m.line === "SEMI-INDUSTRIAL" ? "Semi" : "Personalite";
    const familia = inferMachineCategory(m);
    const status = m.active ? "Ativo" : "Inativo";
    lines.push(
      [
        linha,
        m.name,
        m.code || "",
        m.sku || "",
        m.production || "",
        familia,
        m.description || "",
        "",
        status,
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
