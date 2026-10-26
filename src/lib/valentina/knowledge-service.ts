import { db } from "../../db";
import { knowledgeFiles, knowledgeFolders } from "../../db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { getAiPersona } from "../ai-persona";
import defaultTecfagCatalog from "../triage/tecfag-default-catalog.json";

// Diretório físico onde as mídias de Formato Real são salvas.
// Usa import.meta.url (igual ao knowledge.ts) para resolver corretamente
// tanto em desenvolvimento (ts-node) quanto em produção (Railway/.output/).
const __dirname_ks = path.dirname(fileURLToPath(import.meta.url));
export const KNOWLEDGE_MEDIA_DIR = path.resolve(__dirname_ks, "../../../public/knowledge-media");

export interface PreExtractedManualEntry {
  id: string;
  name: string;
  size: string;
  content: string;
}

interface IndexedKnowledgeDoc {
  id: string;
  name: string;
  folderName: string;
  content: string;
  normalizedName: string;
  compactAlnumName: string;
  bracketModelRaw: string;
  bracketModelNorm: string;
  bracketModelCompact: string;
  modelTokens: string[];
  normalizedContent: string;
}

// Cache leve em memória para evitar re-leitura repetitiva a cada mensagem da IA (TTL: 60s)
interface CachedKnowledgeData {
  timestamp: number;
  totalActiveChars: number;
  indexedDocs: IndexedKnowledgeDoc[];
  realMediaItems: Array<{ id: string; name: string; sku: string; category: string; mediaUrl: string }>;
}
const knowledgeCacheByTenant = new Map<string, CachedKnowledgeData>();
const KNOWLEDGE_CACHE_TTL_MS = 60_000;

export function invalidateKnowledgeCache(tenantId?: string) {
  if (tenantId) {
    knowledgeCacheByTenant.delete(tenantId);
  } else {
    knowledgeCacheByTenant.clear();
  }
}

// ── Arquivo pré-extraído dos 210 manuais técnicos da Tecfag (fallback e auto-reparo) ──
let preExtractedManualsCache: PreExtractedManualEntry[] | null = null;
let preExtractedByNameMap: Map<string, PreExtractedManualEntry> | null = null;
let preExtractedByCompactModelMap: Map<string, PreExtractedManualEntry> | null = null;
let tecfagManualsDbSynced = false;
let tecfagManualsDbSyncPromise: Promise<void> | null = null;

function resolveManualsGzPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "public/tecfag-manuals-rag.json.gz"),
    path.resolve(process.cwd(), ".output/public/tecfag-manuals-rag.json.gz"),
    path.resolve(__dirname_ks, "../../../public/tecfag-manuals-rag.json.gz"),
    path.resolve(__dirname_ks, "../../public/tecfag-manuals-rag.json.gz"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

export function getPreExtractedTecfagManuals(): PreExtractedManualEntry[] {
  if (preExtractedManualsCache) return preExtractedManualsCache;
  const gzPath = resolveManualsGzPath();
  if (!gzPath) {
    preExtractedManualsCache = [];
    preExtractedByNameMap = new Map();
    preExtractedByCompactModelMap = new Map();
    return preExtractedManualsCache;
  }
  try {
    const compressed = fs.readFileSync(gzPath);
    const jsonStr = zlib.gunzipSync(compressed).toString("utf8");
    const parsed = JSON.parse(jsonStr);
    preExtractedManualsCache = Array.isArray(parsed) ? parsed : [];
    preExtractedByNameMap = new Map();
    preExtractedByCompactModelMap = new Map();
    for (const item of preExtractedManualsCache) {
      if (!item?.name || !item?.content) continue;
      const key = item.name.trim().toLowerCase();
      preExtractedByNameMap.set(key, item);
      const noExtKey = key.replace(/\.pdf$/i, "").trim();
      preExtractedByNameMap.set(noExtKey, item);
      const bracketMatch = item.name.match(/^\[([^\]]+)\]/);
      if (bracketMatch) {
        const compactBracket = bracketMatch[1].toLowerCase().replace(/[^a-z0-9]/g, "");
        if (compactBracket) preExtractedByCompactModelMap.set(compactBracket, item);
      }
    }
    return preExtractedManualsCache;
  } catch (err: any) {
    console.warn("[knowledge-service] Falha ao carregar tecfag-manuals-rag.json.gz:", err?.message);
    preExtractedManualsCache = [];
    preExtractedByNameMap = new Map();
    preExtractedByCompactModelMap = new Map();
    return preExtractedManualsCache;
  }
}

export function findPreExtractedManualContent(fileName: string): string | null {
  if (!fileName) return null;
  getPreExtractedTecfagManuals();
  if (!preExtractedByNameMap || preExtractedByNameMap.size === 0) return null;

  const clean = fileName.trim().toLowerCase();
  const direct = preExtractedByNameMap.get(clean) || preExtractedByNameMap.get(clean.replace(/\.pdf$/i, "").trim());
  if (direct?.content) return direct.content;

  const bracketMatch = fileName.match(/^\[([^\]]+)\]/);
  if (bracketMatch && preExtractedByCompactModelMap) {
    const compact = bracketMatch[1].toLowerCase().replace(/[^a-z0-9]/g, "");
    const byModel = preExtractedByCompactModelMap.get(compact);
    if (byModel?.content) return byModel.content;
  }
  return null;
}

/**
 * Garante que os 210 manuais técnicos na pasta MANUAIS do tenant 'tecfag'
 * estejam preenchidos com seu texto extraído no banco PostgreSQL (auto-reparo).
 */
export async function ensureTecfagManualsKnowledgePopulated(tenantId: string): Promise<void> {
  if (tenantId !== "tecfag" || tecfagManualsDbSynced) return;
  if (tecfagManualsDbSyncPromise) return tecfagManualsDbSyncPromise;

  tecfagManualsDbSyncPromise = (async () => {
    try {
      const manuals = getPreExtractedTecfagManuals();
      if (manuals.length === 0) {
        tecfagManualsDbSynced = true;
        return;
      }

      const existingFolders = await db
        .select({ id: knowledgeFolders.id, name: knowledgeFolders.name })
        .from(knowledgeFolders)
        .where(eq(knowledgeFolders.tenantId, "tecfag"));

      let manuaisFolder = existingFolders.find(
        (f) => f.name.trim().toLowerCase() === "manuais"
      );

      if (!manuaisFolder) {
        const folderId = "f-tf-manuais";
        await db
          .insert(knowledgeFolders)
          .values({
            id: folderId,
            tenantId: "tecfag",
            name: "MANUAIS",
            parentId: null,
            createdAt: new Date(),
          })
          .onConflictDoNothing();
        manuaisFolder = { id: folderId, name: "MANUAIS" };
      }

      const existingPdfRows = await db
        .select({
          id: knowledgeFiles.id,
          name: knowledgeFiles.name,
          folderId: knowledgeFiles.folderId,
          contentLen: sql<number>`LENGTH(TRIM(COALESCE(${knowledgeFiles.content}, '')))`,
        })
        .from(knowledgeFiles)
        .where(eq(knowledgeFiles.tenantId, "tecfag"));

      const existingByName = new Map<string, (typeof existingPdfRows)[number]>();
      for (const row of existingPdfRows) {
        existingByName.set((row.name || "").trim().toLowerCase(), row);
      }

      let repairedCount = 0;
      let insertedCount = 0;

      for (const manual of manuals) {
        const key = manual.name.trim().toLowerCase();
        const existing = existingByName.get(key);
        if (existing) {
          if (Number(existing.contentLen || 0) < 50) {
            await db
              .update(knowledgeFiles)
              .set({
                content: manual.content,
                size: manual.size,
                type: "pdf",
                format: "embeddings",
                folderId: existing.folderId || manuaisFolder.id,
              })
              .where(
                and(
                  eq(knowledgeFiles.id, existing.id),
                  eq(knowledgeFiles.tenantId, "tecfag")
                )
              );
            repairedCount++;
          }
        } else {
          await db
            .insert(knowledgeFiles)
            .values({
              id: manual.id,
              tenantId: "tecfag",
              folderId: manuaisFolder.id,
              name: manual.name,
              size: manual.size,
              type: "pdf",
              format: "embeddings",
              content: manual.content,
              uploadedAt: new Date(),
            })
            .onConflictDoNothing();
          insertedCount++;
        }
      }

      tecfagManualsDbSynced = true;
      if (repairedCount > 0 || insertedCount > 0) {
        invalidateKnowledgeCache("tecfag");
        console.log(
          `[knowledge-service] ✅ Auto-reparo MANUAIS (tecfag): ${repairedCount} manuais reparados com texto RAG completo, ${insertedCount} inseridos.`
        );
      }
    } catch (err: any) {
      console.warn("[knowledge-service] Aviso no auto-reparo de manuais:", err?.message);
    } finally {
      tecfagManualsDbSyncPromise = null;
    }
  })();

  return tecfagManualsDbSyncPromise;
}

const VALEM_CORE_COMMERCIAL_POLICIES = `
--- 🏛️ DIRETRIZES COMERCIAIS, FISCAIS, CATÁLOGO & FAQ OFICIAL VALEMPACK (INVIOLÁVEL) ---
1. CANAIS DE ATENDIMENTO & POLÍTICAS DE QUANTIDADE:
   - COMPRAS NO SITE (www.valempack.com.br):
     * Aberto para PESSOA FÍSICA (CPF) e PESSOA JURÍDICA (CNPJ).
     * Quantidade Mínima no Site: A partir de 50 UNIDADES por item.
     * Formas de pagamento: PIX, Cartão de Crédito e Boleto.
     * Desconto Especial PJ no Site: 15% DE DESCONTO para empresas em compras no e-commerce.
   - ATACADO B2B DIRETO COM CONSULTORAS (WHATSAPP):
     * EXCLUSIVO para empresas com CNPJ ativo.
     * Quantidade Mínima no Atacado WhatsApp: 1.000 (MIL) UNIDADES por item.
     * Condições: Faturamento faturado para PJ, boleto a prazo e cotações especiais.
   - QUANTIDADES ABAIXO DE 50 UNIDADES:
     * Disponíveis em nossa loja oficial no MERCADO LIVRE.

2. CATÁLOGO COMPLETO DE PRODUTOS VALEM PACK:
   - POTES DE VIDRO ÂMBAR & COSMÉTICOS:
     * Pote de Vidro Âmbar com Tampa Preta / Branca: 10ml (aprox. R$ 2,52/un), 20ml, 30ml, 50ml, 100ml.
     * Potes plásticos de PEAD e PET para cremes, pomadas e suplementos.
     * Venda no site a partir de 50 unidades; atacado a partir de 1.000 unidades.
   - VÁLVULAS SPRAY & PUMP:
     * Válvula Spray (roscas 20/410, 24/410, 28/410, estriadas, lisas, metálicas e plásticas, pescador cortado sob medida).
     * Válvulas Pump e Saboneteira dosadora (para loções, hidratantes, géis e sabonete líquido).
     * Válvulas Espumadoras (para higienização facial e espuma rica).
   - VÁLVULAS GATILHO / MINI TRIGGER & TRIGGER INDUSTRIAL:
     * Mini Trigger e Gatilho Spray/Stream (roscas 24/410, 28/410 para borrifadores, home care, automotivo e químicos).
   - FRASCOS E EMBALAGENS:
     * Frascos PET, Vidro Âmbar e PEAD de 10ml, 30ml, 50ml, 100ml, 250ml, 500ml e 1000ml.
   - SELADORAS E MÁQUINAS:
     * Seladoras manuais, contínuas, a vácuo e embaladoras industriais.

3. REGRAS DE CONDUTA DA ATENDENTE:
   - Se o cliente mandar foto ou pedir um item (ex: Pote de Vidro Âmbar 10ml), confirme com entusiasmo e apresente os detalhes reais do produto.
   - Se o cliente pedir quantidade < 50 un (ex: 10 unidades), oriente com carinho que o mínimo no site é 50 unidades (ou indique o Mercado Livre para 10 unidades).
   - Se o cliente disser que NÃO quer mais um item ou que não pediu (ex: "não pedi trigger", "esquece isso"), desconsidere imediatamente e foque no produto atual.
--- FIM DAS DIRETRIZES OFICIAIS ---
`;

// ── Regex de identificação de mídia real ───────────────────────────────────────
const REAL_MEDIA_PATTERN = /^\[FORMATO_REAL:(\/knowledge-media\/[^\]]+)\]/;

export interface RealMediaFile {
  name: string;
  mediaUrl: string;
  fileId: string;
  base64Data?: string;   // Base64 da imagem — fonte de verdade persistente no banco
  mimeType?: string;
}

/**
 * Retorna os arquivos de Formato Real com mediaUrl e base64 disponíveis.
 * Otimizado: se `targetUrls` for informado (ex: envio de 1 foto específica no SDR),
 * busca o Base64 APENAS dos arquivos solicitados (evitando ler 99 MB de TOAST do PostgreSQL).
 */
export async function getRealMediaFiles(tenantId: string, targetUrls?: string[]): Promise<RealMediaFile[]> {
  try {
    const targetFileIds = (targetUrls || [])
      .map((u) => {
        const base = path.basename(u || "");
        const dotIdx = base.lastIndexOf(".");
        return dotIdx > 0 ? base.slice(0, dotIdx) : base;
      })
      .filter(Boolean);

    const conditions = [
      eq(knowledgeFiles.tenantId, tenantId),
      eq(knowledgeFiles.format, "real"),
    ];
    if (targetFileIds.length > 0) {
      conditions.push(inArray(knowledgeFiles.id, targetFileIds));
    }

    const files = await db
      .select({
        id: knowledgeFiles.id,
        name: knowledgeFiles.name,
        format: knowledgeFiles.format,
        content:
          targetFileIds.length > 0
            ? knowledgeFiles.content
            : sql<string>`SUBSTRING(${knowledgeFiles.content} FROM 1 FOR 180)`,
      })
      .from(knowledgeFiles)
      .where(and(...conditions));

    return files
      .filter((f) => f.content)
      .map((f) => {
        const contentFull = f.content || "";
        const b64SplitIdx = contentFull.indexOf("[BASE64:");
        const contentPrefix = b64SplitIdx >= 0 ? contentFull.substring(0, b64SplitIdx) : contentFull;

        const urlMatch = contentPrefix.match(REAL_MEDIA_PATTERN);
        const extFromName = (f.name.split(".").pop() || "jpg").toLowerCase();
        const mediaUrl = urlMatch ? urlMatch[1] : `/knowledge-media/${f.id}.${extFromName}`;

        let base64Data: string | undefined;
        if (b64SplitIdx >= 0) {
          const b64Start = b64SplitIdx + 8;
          const b64End = contentFull.indexOf("]", b64Start);
          base64Data = b64End >= 0 ? contentFull.slice(b64Start, b64End) : contentFull.slice(b64Start);
        }

        const ext = mediaUrl.split(".").pop()?.toLowerCase() || "jpg";
        const mimeType =
          ext === "png"
            ? "image/png"
            : ext === "gif"
              ? "image/gif"
              : ext === "webp"
                ? "image/webp"
                : "image/jpeg";

        return { name: f.name, mediaUrl, fileId: f.id, base64Data, mimeType };
      });
  } catch {
    return [];
  }
}

function normalizeSearchText(str: string): string {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const RAG_STOPWORDS = new Set([
  "o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos",
  "em", "na", "no", "nas", "nos", "para", "pra", "pro", "por", "com", "sem", "sob",
  "sobre", "que", "oque", "qual", "quais", "como", "onde", "quando", "quanto", "quantos",
  "quantas", "sabe", "saber", "me", "te", "se", "ele", "ela", "eles", "elas", "voce",
  "voces", "nosso", "nossa", "seu", "sua", "esse", "essa", "este", "esta", "isso",
  "isto", "aquele", "aquela", "aqui", "ai", "la", "tem", "ter", "fala", "fale", "diga",
  "diz", "pode", "poderia", "quero", "queria", "preciso", "gostaria", "favor", "bom",
  "boa", "dia", "tarde", "noite", "ola", "oi", "fagner", "valentina", "tecfag", "valem",
  "manual", "manuais", "maquina", "maquinas", "equipamento", "equipamentos", "modelo",
  "modelos", "informacao", "informacoes", "detalhe", "detalhes", "ficha", "tecnica",
  "especificacao", "especificacoes", "catalogo",
]);

function buildIndexedDoc(
  id: string,
  name: string,
  folderName: string,
  content: string
): IndexedKnowledgeDoc {
  const normalizedName = normalizeSearchText(name.replace(/\.pdf$/i, ""));
  const compactAlnumName = normalizedName.replace(/[^a-z0-9]/g, "");
  const bracketMatch = name.match(/^\[([^\]]+)\]/);
  const bracketModelRaw = bracketMatch ? bracketMatch[1].trim() : "";
  const bracketModelNorm = normalizeSearchText(bracketModelRaw);
  const bracketModelCompact = bracketModelNorm.replace(/[^a-z0-9]/g, "");

  // Extrai tokens de modelo do nome do arquivo (ex: "apf300-2b", "apf300", "apf", "bsf-5640lg", "bsf5640lg")
  const rawTokens = normalizedName
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !RAG_STOPWORDS.has(t));

  // Também adiciona combinações adjacentes com hífen no nome original (ex: "apf300-2b", "bs-6535la")
  const hyphenMatches = normalizedName.match(/[a-z0-9]+(?:[-_][a-z0-9]+)+/g) || [];
  const modelTokenSet = new Set<string>();
  for (const hm of hyphenMatches) {
    modelTokenSet.add(hm);
    modelTokenSet.add(hm.replace(/[^a-z0-9]/g, ""));
  }
  for (const rt of rawTokens) {
    if (/\d/.test(rt) || rt.length >= 3) {
      modelTokenSet.add(rt);
    }
  }
  if (bracketModelCompact) {
    modelTokenSet.add(bracketModelCompact);
    const firstBracketWord = bracketModelNorm.split(/\s+/)[0];
    if (firstBracketWord && firstBracketWord.length >= 2) {
      modelTokenSet.add(firstBracketWord);
      modelTokenSet.add(firstBracketWord.replace(/[^a-z0-9]/g, ""));
    }
  }

  return {
    id,
    name,
    folderName,
    content,
    normalizedName,
    compactAlnumName,
    bracketModelRaw,
    bracketModelNorm,
    bracketModelCompact,
    modelTokens: Array.from(modelTokenSet),
    normalizedContent: normalizeSearchText(content),
  };
}

function buildSmartManualExcerpt(
  doc: IndexedKnowledgeDoc,
  queryTerms: string[],
  maxChars: number
): string {
  const full = doc.content.trim();
  if (full.length <= maxChars) return full;

  // Sempre inclui o início do manual (capa, prefácio, descrição geral e tabela de parâmetros técnicos)
  const headBudget = Math.min(Math.floor(maxChars * 0.55), 8000);
  const headPart = full.slice(0, headBudget);

  // Busca janelas relevantes no restante do documento onde os termos da pergunta aparecem
  const tailText = full.slice(headBudget);
  const normTail = doc.normalizedContent.slice(headBudget);
  const remainingBudget = maxChars - headPart.length - 120;
  if (remainingBudget <= 400 || queryTerms.length === 0) {
    return `${headPart}\n\n[...]\n\n${full.slice(full.length - Math.max(500, remainingBudget))}`;
  }

  const windowSize = 1800;
  const candidateWindows: Array<{ start: number; score: number }> = [];
  const step = 900;
  for (let pos = 0; pos < normTail.length; pos += step) {
    const slice = normTail.slice(pos, pos + windowSize);
    let score = 0;
    for (const term of queryTerms) {
      if (slice.includes(term)) score += /\d/.test(term) ? 4 : 2;
    }
    if (score > 0) {
      candidateWindows.push({ start: pos, score });
    }
  }

  candidateWindows.sort((a, b) => b.score - a.score);
  const chosenSlices: string[] = [];
  let usedChars = 0;
  const usedStarts: number[] = [];

  for (const win of candidateWindows) {
    if (usedStarts.some((s) => Math.abs(s - win.start) < windowSize * 0.7)) continue;
    const chunk = tailText.slice(win.start, win.start + windowSize).trim();
    if (!chunk) continue;
    if (usedChars + chunk.length > remainingBudget) break;
    usedStarts.push(win.start);
    chosenSlices.push(chunk);
    usedChars += chunk.length + 20;
    if (chosenSlices.length >= 4) break;
  }

  if (chosenSlices.length === 0) {
    return `${headPart}\n\n[...]\n\n${tailText.slice(0, remainingBudget)}`;
  }

  return `${headPart}\n\n[... Trechos adicionais relevantes do manual ...]\n\n${chosenSlices.join("\n\n[...]\n\n")}`;
}

interface CatalogEntry {
  id: string;
  name: string;
  sku?: string;
  code?: string;
  line?: string;
  production?: string;
  description?: string;
  aliases?: string[];
  active?: boolean;
}

function searchTecfagCatalogEntries(queryHint: string, maxItems = 10): string {
  if (!queryHint || !queryHint.trim()) return "";
  const catalog = (defaultTecfagCatalog as CatalogEntry[]).filter((item) => item && item.active !== false);
  if (catalog.length === 0) return "";

  const normQuery = normalizeSearchText(queryHint);
  const compactQuery = normQuery.replace(/[^a-z0-9]/g, "");
  const hyphenatedQueryCodes = normQuery.match(/[a-z]{1,6}[-_\s]?\d{1,5}(?:[-_\s]?[a-z0-9]{1,5})*/g) || [];
  const compactQueryCodes = hyphenatedQueryCodes
    .map((c) => c.replace(/[^a-z0-9]/g, ""))
    .filter((c) => c.length >= 3);

  const queryTerms = normQuery
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !RAG_STOPWORDS.has(t));

  if (queryTerms.length === 0 && compactQueryCodes.length === 0) return "";

  const scored: Array<{ item: CatalogEntry; score: number }> = [];

  for (const item of catalog) {
    const normName = normalizeSearchText(item.name || "");
    const compactName = normName.replace(/[^a-z0-9]/g, "");
    const normCode = normalizeSearchText(item.code || "");
    const normSku = normalizeSearchText(item.sku || "");
    const normDesc = normalizeSearchText(item.description || "");
    const normAliases = (item.aliases || []).map((a) => normalizeSearchText(a)).join(" ");

    let score = 0;

    // 1. Match de código de modelo (ex: APF300-2B, APF300-4B, BSF-5640LG, PAMQLQAU045)
    for (const qCode of compactQueryCodes) {
      if (compactName.includes(qCode)) {
        score += 500;
      } else {
        // Verifica prefixo base da família (ex: "apf300" bate em "apf3002b" e nas envasadoras APF)
        const familyPrefix = qCode.match(/^[a-z]{2,6}\d{2,5}/)?.[0];
        if (familyPrefix && compactName.includes(familyPrefix)) {
          score += 220;
        }
      }
    }

    if (normCode && normCode.length >= 4 && compactQuery.includes(normCode.replace(/[^a-z0-9]/g, ""))) {
      score += 450;
    }
    if (normSku && normSku.length >= 2 && queryTerms.includes(normSku)) {
      score += 300;
    }

    // 2. Match por termos da consulta
    for (const term of queryTerms) {
      const hasDigits = /\d/.test(term);
      if (normName.includes(term) || compactName.includes(term)) {
        score += hasDigits ? 120 : 35;
      } else if (normAliases && normAliases.includes(term)) {
        score += hasDigits ? 90 : 25;
      } else if (normDesc && normDesc.includes(term)) {
        score += hasDigits ? 40 : 12;
      }
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxItems);
  if (top.length === 0) return "";

  const lines = top.map(({ item }) => {
    const parts = [`• Modelo/Equipamento: "${(item.name || "").replace(/\s+/g, " ").trim()}"`];
    if (item.code) parts.push(`Código Interno: ${item.code}`);
    if (item.sku) parts.push(`SKU Loja: ${item.sku}`);
    if (item.line) parts.push(`Linha/Divisão: ${item.line}`);
    if (item.production) parts.push(`Produção/Capacidade: ${item.production}`);
    if (item.description) {
      parts.push(`Descrição Técnica: ${item.description.replace(/\s+/g, " ").trim()}`);
    }
    return parts.join(" | ");
  });

  return `🏭 EQUIPAMENTOS ENCONTRADOS NO CATÁLOGO OFICIAL TECFAG (${top.length} referência(s) direta(s)):\n${lines.join("\n")}`;
}

/**
 * Busca o contexto consolidado e ranqueado (RAG) da base de conhecimento
 * para alimentar o prompt do Gemini (SDR, Copiloto do Vendedor e Diretoria) e ligações.
 * Otimizado para suportar os 210 manuais técnicos (5,7 MB) sem estourar o limite de tokens,
 * priorizando o manual exato da máquina consultada (ex: [APF300-2B] APF - MANUAL.pdf).
 */
export async function getKnowledgeBaseContext(tenantId: string, queryHint?: string): Promise<string> {
  if (!tenantId) {
    throw new Error("[knowledge-service] tenantId é obrigatório ao buscar contexto da base de conhecimento (AGENTS.md).");
  }

  if (tenantId === "tecfag") {
    await ensureTecfagManualsKnowledgePopulated("tecfag");
  }

  const persona = getAiPersona(tenantId);
  const corePolicies = tenantId === "valem" ? VALEM_CORE_COMMERCIAL_POLICIES : "";

  try {
    let cached = knowledgeCacheByTenant.get(tenantId);
    if (!cached || Date.now() - cached.timestamp > KNOWLEDGE_CACHE_TTL_MS) {
      let files: Array<{
        id: string;
        folderId: string | null;
        name: string;
        format: string;
        type: string;
        content: string;
      }> = [];
      let folders: Array<{ id: string; name: string }> = [];

      try {
        // Seleciona APENAS os primeiros 180 caracteres quando format = 'real' (evita transferir 99 MB de TOAST Base64!)
        files = await db
          .select({
            id: knowledgeFiles.id,
            folderId: knowledgeFiles.folderId,
            name: knowledgeFiles.name,
            format: knowledgeFiles.format,
            type: knowledgeFiles.type,
            content: sql<string>`CASE WHEN ${knowledgeFiles.format} = 'real' THEN SUBSTRING(${knowledgeFiles.content} FROM 1 FOR 180) ELSE ${knowledgeFiles.content} END`,
          })
          .from(knowledgeFiles)
          .where(eq(knowledgeFiles.tenantId, tenantId));

        folders = await db
          .select({
            id: knowledgeFolders.id,
            name: knowledgeFolders.name,
          })
          .from(knowledgeFolders)
          .where(eq(knowledgeFolders.tenantId, tenantId));
      } catch (dbErr: any) {
        console.warn("[knowledge-service] Aviso ao consultar banco na base de conhecimento:", dbErr?.message);
      }

      const folderMap = new Map<string, string>();
      folders.forEach((f) => folderMap.set(f.id, f.name));

      const indexedDocs: IndexedKnowledgeDoc[] = [];
      const seenDocNamesNorm = new Set<string>();
      let totalActiveChars = 0;

      for (const f of files) {
        if (f.format === "real") continue;
        let effectiveContent = (f.content || "").trim();
        if (effectiveContent.length < 50 && tenantId === "tecfag") {
          const fallbackManual = findPreExtractedManualContent(f.name);
          if (fallbackManual) {
            effectiveContent = fallbackManual;
          }
        }
        if (!effectiveContent || effectiveContent.startsWith("[Documento ")) continue;

        const folderName = f.folderId ? folderMap.get(f.folderId) || "Geral" : "Geral";
        indexedDocs.push(buildIndexedDoc(f.id, f.name, folderName, effectiveContent));
        seenDocNamesNorm.add(normalizeSearchText(f.name));
        totalActiveChars += effectiveContent.length;
      }

      if (tenantId === "tecfag") {
        const preExtracted = getPreExtractedTecfagManuals();
        for (const manual of preExtracted) {
          const normName = normalizeSearchText(manual.name);
          if (seenDocNamesNorm.has(normName) || !manual.content) continue;
          indexedDocs.push(buildIndexedDoc(manual.id, manual.name, "MANUAIS", manual.content));
          seenDocNamesNorm.add(normName);
          totalActiveChars += manual.content.length;
        }
      }

      const seenSkus = new Set<string>();
      const realMediaItems: CachedKnowledgeData["realMediaItems"] = [];

      for (const f of files) {
        if (f.format !== "real" || !f.content) continue;
        const contentPrefix = (f.content || "").split("[BASE64:")[0];
        const match = contentPrefix.match(REAL_MEDIA_PATTERN);
        if (!match) continue;
        const skuMatch = f.name.match(/^\[?(\d{5,})\]?/);
        const sku = skuMatch ? skuMatch[1] : f.name;
        if (seenSkus.has(sku)) continue;
        seenSkus.add(sku);
        const category = f.folderId ? folderMap.get(f.folderId) || "Geral" : "Geral";
        realMediaItems.push({
          id: f.id,
          name: f.name,
          sku,
          category,
          mediaUrl: match[1],
        });
      }

      cached = {
        timestamp: Date.now(),
        totalActiveChars,
        indexedDocs,
        realMediaItems,
      };
      if (files.length > 0 || indexedDocs.length > 0) {
        knowledgeCacheByTenant.set(tenantId, cached);
      }
    }

    // ── 1. Seleção Inteligente de Documentos / Manuais (RAG) ───────────────────
    const MAX_FULL_INJECTION_CHARS = 45_000;
    let activeDocsText = "";

    if (cached.indexedDocs.length > 0) {
      if (cached.totalActiveChars <= MAX_FULL_INJECTION_CHARS) {
        // Base enxuta (ex: Valem com 3 PDFs = 12 KB): injeta integralmente
        activeDocsText = cached.indexedDocs
          .map(
            (doc) =>
              `--- DOCUMENTO: ${doc.name} (Pasta: ${doc.folderName}) ---\n${doc.content}\n--- FIM DO DOCUMENTO ---`
          )
          .join("\n\n");
      } else {
        // Base extensa (ex: Tecfag com 210 manuais técnicos = 5,74 MB):
        // Ranqueia por código de máquina, título e conteúdo para injetar os manuais exatos da pergunta!
        const rawQuery = (queryHint || "").trim();
        const normQuery = normalizeSearchText(rawQuery);
        const compactQuery = normQuery.replace(/[^a-z0-9]/g, "");

        // Detecta códigos alfanuméricos na pergunta (ex: "apf300-2b", "apf 300", "bsf-5640lg", "dz400")
        const queryModelMatches =
          normQuery.match(/\b[a-z]{1,6}[-_\s]?\d{1,5}(?:[-_\s]?[a-z0-9]{1,5})*\b/g) || [];
        const compactQueryModels = queryModelMatches
          .map((m) => m.replace(/[^a-z0-9]/g, ""))
          .filter((m) => m.length >= 3);

        const queryTerms = normQuery
          .split(/[^a-z0-9]+/)
          .map((t) => t.trim())
          .filter((t) => t.length >= 2 && !RAG_STOPWORDS.has(t));

        const scoredDocs = cached.indexedDocs.map((doc) => {
          let score = 0;

          // Match exato do código entre colchetes do manual (ex: [APF300-2B] -> "apf3002b")
          if (doc.bracketModelCompact && doc.bracketModelCompact.length >= 3) {
            if (compactQuery.includes(doc.bracketModelCompact)) {
              score += 1200;
            } else {
              for (const qm of compactQueryModels) {
                if (doc.bracketModelCompact === qm) {
                  score += 1200;
                } else if (
                  doc.bracketModelCompact.startsWith(qm) ||
                  qm.startsWith(doc.bracketModelCompact)
                ) {
                  score += 650;
                } else {
                  const qFamily = qm.match(/^[a-z]{2,5}\d{2,5}/)?.[0];
                  const dFamily = doc.bracketModelCompact.match(/^[a-z]{2,5}\d{2,5}/)?.[0];
                  if (qFamily && dFamily && qFamily === dFamily) {
                    score += 450;
                  } else {
                    const qLetters = qm.match(/^[a-z]{2,5}/)?.[0];
                    const dLetters = doc.bracketModelCompact.match(/^[a-z]{2,5}/)?.[0];
                    if (qLetters && dLetters && qLetters.length >= 3 && qLetters === dLetters) {
                      score += 180;
                    }
                  }
                }
              }
            }
          }

          // Match nos tokens de modelo extraídos do nome do arquivo
          for (const qm of compactQueryModels) {
            if (doc.modelTokens.includes(qm)) {
              score += 500;
            } else if (doc.compactAlnumName.includes(qm)) {
              score += 350;
            }
          }

          // Match por termos individuais da consulta no título e no corpo do manual
          for (const term of queryTerms) {
            const hasDigit = /\d/.test(term);
            if (doc.normalizedName.includes(term) || doc.compactAlnumName.includes(term)) {
              score += hasDigit ? 140 : 55;
            }
            if (doc.normalizedContent.includes(term)) {
              score += hasDigit ? 35 : 15;
            }
          }

          // Documentos curtos institucionais fora da pasta MANUAIS ganham leve prioridade base
          if (doc.folderName.toLowerCase() !== "manuais" && doc.content.length < 8000) {
            score += 20;
          }

          return { doc, score };
        });

        scoredDocs.sort((a, b) => b.score - a.score);
        const topMatched = scoredDocs.filter((entry) => entry.score > 0).slice(0, 4);

        const selectedBlocks: string[] = [];
        let totalBudgetRemaining = 42_000;

        for (let i = 0; i < topMatched.length; i++) {
          const { doc } = topMatched[i];
          // O 1º manual mais relevante recebe até 26.000 caracteres (cobre 100% de manuais como APF300-2B de 19.655 chars!)
          const perDocMax = i === 0 ? Math.min(26_000, totalBudgetRemaining) : Math.min(8_000, totalBudgetRemaining);
          if (perDocMax < 800) break;

          const excerpt = buildSmartManualExcerpt(doc, queryTerms, perDocMax);
          selectedBlocks.push(
            `--- MANUAL / DOCUMENTO TÉCNICO OFICIAL #${i + 1}: ${doc.name} (Pasta: ${doc.folderName} | Total: ${doc.content.length.toLocaleString("pt-BR")} caracteres) ---\n${excerpt}\n--- FIM DO MANUAL ${doc.name} ---`
          );
          totalBudgetRemaining -= excerpt.length;
        }

        if (selectedBlocks.length > 0) {
          activeDocsText =
            `📖 MANUAIS TÉCNICOS E DOCUMENTOS LOCALIZADOS NA BASE DE CONHECIMENTO (${cached.indexedDocs.length} manuais indexados no cérebro da IA — exibindo os ${selectedBlocks.length} mais relevantes para a consulta):\n\n` +
            selectedBlocks.join("\n\n");
        } else {
          // Resumo compacto do índice de manuais disponíveis quando a pergunta for genérica
          const sampleModels = cached.indexedDocs
            .slice(0, 35)
            .map((d) => d.bracketModelRaw || d.name.replace(/\.pdf$/i, ""))
            .join(", ");
          activeDocsText = `📖 ÍNDICE DE MANUAIS TÉCNICOS ATIVOS NA BASE (${cached.indexedDocs.length} manuais completos disponíveis para consulta por código ou equipamento): ${sampleModels}...`;
        }
      }
    }

    // ── 2. Catálogo Estruturado de Máquinas Tecfag (1.037 itens) ───────────────
    const tecfagCatalogSection =
      tenantId === "tecfag" && queryHint ? searchTecfagCatalogEntries(queryHint, 10) : "";

    // ── 3. Seleção Contextual de Fotos Reais (Formato Real) ────────────────────
    const MAX_PROMPT_PHOTOS = 40;
    let selectedPhotos = cached.realMediaItems;
    if (selectedPhotos.length > MAX_PROMPT_PHOTOS) {
      if (queryHint && queryHint.trim().length >= 2) {
        const terms = normalizeSearchText(queryHint)
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 2 && !RAG_STOPWORDS.has(t));
        if (terms.length > 0) {
          const scored = selectedPhotos
            .map((item) => {
              const target = normalizeSearchText(`${item.name} ${item.category} ${item.sku}`);
              const compactTarget = target.replace(/[^a-z0-9]/g, "");
              let score = 0;
              for (const term of terms) {
                if (target.includes(term) || compactTarget.includes(term)) {
                  score += /\d/.test(term) ? 3 : 1;
                }
              }
              return { item, score };
            })
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score);
          selectedPhotos =
            scored.length > 0
              ? scored.slice(0, MAX_PROMPT_PHOTOS).map((s) => s.item)
              : selectedPhotos.slice(0, MAX_PROMPT_PHOTOS);
        } else {
          selectedPhotos = selectedPhotos.slice(0, MAX_PROMPT_PHOTOS);
        }
      } else {
        selectedPhotos = selectedPhotos.slice(0, MAX_PROMPT_PHOTOS);
      }
    }

    const realMediaLines = selectedPhotos.map((item) => `  - "${item.name}" → URL: ${item.mediaUrl}`);

    const realMediaSection =
      realMediaLines.length > 0
        ? `\n\n📸 FOTOS REAIS DISPONÍVEIS PARA ENVIO (Formato Real — exibindo ${realMediaLines.length} de ${cached.realMediaItems.length} itens):
Você pode enviar essas fotos ao cliente durante o atendimento usando a tag [SEND_IMAGE:URL].
Exemplos de uso:
  - Cliente pede fotos do produto → identifique o produto na lista abaixo e emita [SEND_IMAGE:URL] antes da mensagem de confirmação.
  - Fluxo obrigatório: 1. Envie a imagem com [SEND_IMAGE:URL]. 2. Pergunte: "Esse seria o modelo que você está procurando?" 3. Se SIM → prossiga. Se NÃO → peça mais detalhes ou foto de referência. NÃO insista.
Lista de fotos cadastradas:
${realMediaLines.join("\n")}`
        : "";

    return `\n\n📚 BASE DE CONHECIMENTO & DIRETRIZES (${persona.company}):
${corePolicies}
${tecfagCatalogSection ? `\n${tecfagCatalogSection}\n` : ""}
${activeDocsText ? `\nDOCUMENTOS E MANUAIS TÉCNICOS DA BASE (RAG ATIVO):\n${activeDocsText}\n` : ""}
${realMediaSection}

DIRETRIZ CRÍTICA DE USO DA BASE DE CONHECIMENTO:
1. Você tem autoridade total para usar as informações, especificações técnicas, parâmetros de operação, faixas de dosagem/produção, requisitos pneumáticos/elétricos e regras dos MANUAIS TÉCNICOS e do CATÁLOGO OFICIAL acima para responder com precisão e segurança a qualquer dúvida técnica ou comercial sobre os equipamentos.
2. NUNCA diga que um equipamento presente no Catálogo Oficial ou nos Manuais Técnicos acima "não corresponde a um equipamento do catálogo atual" ou que "não encontrou o catálogo técnico". Responda sempre com segurança, precisão técnica e empatia.`;
  } catch (err: any) {
    console.warn("[knowledge-service] Aviso ao carregar contexto da base de conhecimento:", err?.message);
    return `\n\n📚 BASE DE CONHECIMENTO (${persona.company}):\n${corePolicies}`;
  }
}
