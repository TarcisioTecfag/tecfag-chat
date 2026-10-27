import { db } from "../../db";
import { knowledgeFiles, knowledgeFolders } from "../../db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { getAiPersona } from "../ai-persona";
import defaultTecfagCatalog from "../triage/tecfag-default-catalog.json";
import type { KnowledgeSourceItem, KnowledgeSourceStatus } from "../mockData";

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
  primaryDocModelRaw: string;
  primaryDocModelCompact: string;
  modelTokens: string[];
  normalizedContent: string;
}

export interface MatchedCatalogPhoto {
  fileId: string;
  name: string;
  fileName: string;
  displayName: string;
  modelCode: string;
  modelDisplay: string;
  compactModel: string;
  normalizedModelKey: string;
  internalCode?: string;
  aliasKeys: string[];
  rawImageUrl: string;
  mediaUrl: string;
  category: string;
  photoKey: string;
}

interface IndexedCatalogPhotoItem {
  id: string;
  name: string;
  displayName: string;
  normalizedDisplayName: string;
  sku: string;
  compactModel: string;
  internalCode?: string;
  aliasKeys: string[];
  category: string;
  mediaUrl: string;
  rawImageUrl: string;
  photoKey: string;
  isAccessoryForOtherModel: boolean;
  modelRegex: RegExp | null;
}

// Cache leve em memória para evitar re-leitura repetitiva a cada mensagem da IA (TTL: 60s)
interface CachedKnowledgeData {
  timestamp: number;
  totalActiveChars: number;
  indexedDocs: IndexedKnowledgeDoc[];
  realMediaItems: IndexedCatalogPhotoItem[];
}
const knowledgeCacheByTenant = new Map<string, CachedKnowledgeData>();
const KNOWLEDGE_CACHE_TTL_MS = 60_000;

export function invalidateKnowledgeCache(tenantId?: string) {
  if (tenantId) {
    knowledgeCacheByTenant.delete(tenantId);
    fastPhotoCacheByTenant.delete(tenantId);
  } else {
    knowledgeCacheByTenant.clear();
    fastPhotoCacheByTenant.clear();
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
  "voces", "nosso", "nossa", "seu", "sua", "seus", "suas", "esse", "essa", "este", "esta",
  "isso", "isto", "aquele", "aquela", "aqui", "ai", "la", "tem", "ter", "fala", "fale",
  "diga", "diz", "pode", "poderia", "quero", "queria", "preciso", "gostaria", "favor",
  "bom", "boa", "dia", "tarde", "noite", "ola", "oi", "fagner", "valentina", "tecfag",
  "valem", "manual", "manuais", "maquina", "maquinas", "equipamento", "equipamentos",
  "modelo", "modelos", "informacao", "informacoes", "detalhe", "detalhes", "ficha",
  "tecnica", "especificacao", "especificacoes", "catalogo",
  // Palavras operacionais, verbos comuns, fila de atendimento e CRM (evita falso-positivo em manuais)
  "nao", "ha", "nenhum", "nenhuma", "momento", "dei", "olhada", "caixa", "entrada",
  "aguardando", "esperando", "resposta", "respostas", "whatsapp", "cliente", "clientes",
  "minha", "minhas", "meu", "meus", "agora", "estao", "esta", "estava", "estavam",
  "tudo", "certo", "fila", "atendimento", "atendimentos", "negociacao", "negociacoes",
  "tarefa", "tarefas", "meta", "metas", "conversa", "conversas", "ligacao", "ligacoes",
  "card", "cards", "crm", "funil", "etapa", "proposta", "propostas", "orcamento",
  "orcamentos", "carteira", "hoje", "ontem", "amanha", "semana", "mes", "ano", "mais",
  "menos", "muito", "pouco", "bem", "mal", "sim", "ou", "mas", "porem", "foi", "foram",
  "ser", "sao", "era", "eram", "tinha", "tinham", "tenho", "temos", "vai", "vao", "vou",
  "vamos", "ja", "ainda", "so", "somente", "apenas", "tambem", "ate", "desde", "entre",
  "apos", "antes", "depois", "durante", "outro", "outra", "outros", "outras", "algum",
  "alguma", "alguns", "algumas", "todo", "toda", "todos", "todas", "cada", "mesmo",
  "mesma", "mesmos", "mesmas", "qualquer", "quaisquer", "tanto", "tanta", "tantos",
  "tantas", "quanta", "acesso", "contexto", "sistema", "operador", "vendedor", "consultor",
  "equipe", "empresa", "empresas", "contato", "contatos", "telefone", "celular", "email",
  "cnpj", "cpf", "valor", "valores", "total", "totais", "lista", "listar", "liste",
  "resumo", "status", "pendente", "pendentes", "aberta", "abertas", "aberto", "abertos",
  "fechada", "fechadas", "fechado", "fechados", "ganha", "ganhas", "ganho", "ganhos",
  "perdida", "perdidas", "perdido", "perdidos", "parada", "paradas", "parado", "parados",
  "atraso", "atrasada", "atrasadas", "atrasado", "atrasados", "sla", "lead", "leads",
  "novo", "nova", "novos", "novas", "chegou", "chegaram", "transferido", "transferidos",
  "transferida", "transferidas", "tarcisio", "responder", "respondido", "mensagens",
  "mensagem", "alguem", "ninguem", "zerada", "zerado",
]);

function extractManualPrimaryModelFromName(name: string, bracketModelRaw: string): string {
  const withoutExt = (name || "").replace(/\.pdf$/i, "").trim();
  const afterBracket = withoutExt.replace(/^\[[^\]]+\]\s*/, "").trim();
  const isErpCodeBracket = /^PAMQ[A-Z0-9]+$/i.test(bracketModelRaw);
  if (!isErpCodeBracket && bracketModelRaw) {
    return bracketModelRaw;
  }
  if (!afterBracket) return bracketModelRaw;
  const cleaned = afterBracket
    .replace(/^DISM\s*[-–—_]?\s*/i, "")
    .replace(/\s*[-–—_]\s*(?:MANUAL|DISM).*$/i, "")
    .trim();
  const firstSegment = cleaned.split(/\s+[-–—_]\s+/)[0]?.trim() || cleaned;
  const withoutComSuffix = firstSegment.replace(/\s+com\s+.*$/i, "").trim();
  return withoutComSuffix || bracketModelRaw;
}

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
  const primaryDocModelRaw = extractManualPrimaryModelFromName(name, bracketModelRaw);
  const primaryDocModelCompact = normalizeSearchText(primaryDocModelRaw).replace(/[^a-z0-9]/g, "");

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
  if (primaryDocModelCompact) {
    modelTokenSet.add(primaryDocModelCompact);
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
    primaryDocModelRaw,
    primaryDocModelCompact,
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

  const codeToModelMap = getInternalCodeToModelMap();
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

  const scored: Array<{ item: CatalogEntry; mappedModel: string; score: number }> = [];

  for (const item of catalog) {
    const normCode = normalizeSearchText(item.code || "").replace(/[^a-z0-9]/g, "");
    const mappedModel = normCode ? codeToModelMap.get(normCode) || "" : "";
    const normMappedModel = normalizeSearchText(mappedModel);
    const compactMappedModel = normMappedModel.replace(/[^a-z0-9]/g, "");

    const normName = normalizeSearchText(item.name || "");
    const compactName = normName.replace(/[^a-z0-9]/g, "");
    const normSku = normalizeSearchText(item.sku || "");
    const normDesc = normalizeSearchText(item.description || "");
    const normAliases = (item.aliases || []).map((a) => normalizeSearchText(a)).join(" ");

    let score = 0;

    // 1. Match exato ou por família de código de modelo (ex: VSF, VSF-30S, APF300-2B, BSF-5640LG, PAMQGPAU079)
    for (const qCode of compactQueryCodes) {
      if (compactMappedModel && compactMappedModel === qCode) {
        score += 800;
      } else if (compactName.includes(qCode) || (compactMappedModel && compactMappedModel.includes(qCode))) {
        score += 500;
      } else {
        const familyPrefix = qCode.match(/^[a-z]{2,6}\d{2,5}/)?.[0];
        if (
          familyPrefix &&
          (compactName.includes(familyPrefix) ||
            (compactMappedModel && compactMappedModel.includes(familyPrefix)))
        ) {
          score += 220;
        }
      }
    }

    if (normCode && normCode.length >= 4 && compactQuery.includes(normCode)) {
      score += 750;
    }
    if (normSku && normSku.length >= 2 && queryTerms.includes(normSku)) {
      score += 300;
    }

    // 2. Match exato de sigla de modelo sem dígitos (ex: "VSF" vs "VSF-30S")
    if (compactMappedModel) {
      if (queryTerms.includes(compactMappedModel)) {
        score += 650;
      } else if (queryTerms.some((t) => t.length >= 3 && compactMappedModel.startsWith(t))) {
        score += 200;
      }
    }

    // 3. Match por termos da consulta
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
      scored.push({ item, mappedModel, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxItems);
  if (top.length === 0) return "";

  const lines = top.map(({ item, mappedModel }) => {
    const cleanName = (item.name || "").replace(/\s+/g, " ").trim();
    const displayTitle =
      mappedModel && !normalizeSearchText(cleanName).includes(normalizeSearchText(mappedModel))
        ? `${mappedModel} — ${cleanName}`
        : cleanName;
    const parts = [`• Modelo/Equipamento: "${displayTitle}"`];
    if (mappedModel) parts.push(`Sigla Oficial do Modelo: ${mappedModel}`);
    if (item.code) parts.push(`Código Interno no Sistema: ${item.code}`);
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

async function getOrLoadTenantKnowledgeCache(tenantId: string): Promise<CachedKnowledgeData> {
  if (tenantId === "tecfag") {
    await ensureTecfagManualsKnowledgePopulated("tecfag");
  }

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

    const seenPhotoByKey = new Map<string, IndexedCatalogPhotoItem>();
    const realMediaItems: CachedKnowledgeData["realMediaItems"] = [];

    for (const f of files) {
      const isImageFile =
        f.format === "real" ||
        f.type === "image" ||
        /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name || "");
      if (!isImageFile) continue;
      const contentPrefix = (f.content || "").split("[BASE64:")[0];
      const match = contentPrefix.match(REAL_MEDIA_PATTERN);
      const extFromName = (f.name.split(".").pop() || "jpg").toLowerCase();
      const mediaUrl = match ? match[1] : `/knowledge-media/${f.id}.${extFromName}`;
      const category = f.folderId ? folderMap.get(f.folderId) || "Geral" : "Geral";
      const indexedPhoto = buildIndexedCatalogPhotoItem(f.id, f.name, category, mediaUrl);
      const dedupKey = indexedPhoto.compactModel || indexedPhoto.normalizedDisplayName || f.id;
      const existingPhoto = seenPhotoByKey.get(dedupKey);
      if (existingPhoto) {
        existingPhoto.aliasKeys = Array.from(
          new Set([...existingPhoto.aliasKeys, f.id, mediaUrl, ...indexedPhoto.aliasKeys])
        );
        continue;
      }
      seenPhotoByKey.set(dedupKey, indexedPhoto);
      realMediaItems.push(indexedPhoto);
    }
    enrichCatalogPhotoAliasKeys(realMediaItems);

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

  return cached;
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

  const persona = getAiPersona(tenantId);
  const corePolicies = tenantId === "valem" ? VALEM_CORE_COMMERCIAL_POLICIES : "";

  try {
    const cached = await getOrLoadTenantKnowledgeCache(tenantId);

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
        const rawQuery = expandInternalCatalogCodesInText((queryHint || "").trim());
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

          // Match prioritário pelo modelo real do cabeçalho do manual (ex: "[PAMQGPAU079] VSF - MANUAL.pdf" -> "vsf")
          if (doc.primaryDocModelCompact && doc.primaryDocModelCompact.length >= 2) {
            if (
              compactQueryModels.includes(doc.primaryDocModelCompact) ||
              queryTerms.includes(doc.primaryDocModelCompact)
            ) {
              // Match exato do token de modelo (ex: "vsf" bate 100% com "vsf" e ganha de "vsf30s")
              score += 1450;
            } else if (compactQuery.includes(doc.primaryDocModelCompact)) {
              score += /\d/.test(doc.primaryDocModelCompact) ? 1350 : 380;
            } else {
              for (const qm of compactQueryModels) {
                if (
                  doc.primaryDocModelCompact.startsWith(qm) ||
                  qm.startsWith(doc.primaryDocModelCompact)
                ) {
                  score += 650;
                }
              }
              for (const term of queryTerms) {
                if (term.length >= 3 && doc.primaryDocModelCompact.startsWith(term)) {
                  score += 360;
                }
              }
            }
          }

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

          // Match nos tokens de modelo extraídos do nome do arquivo (inclui famílias como "vsf", "apf", "bsf")
          for (const qm of compactQueryModels) {
            if (doc.modelTokens.includes(qm)) {
              score += 500;
            } else if (doc.compactAlnumName.includes(qm)) {
              score += 350;
            }
          }
          for (const term of queryTerms) {
            if (term.length >= 2 && doc.modelTokens.includes(term)) {
              score += 320;
            } else if (
              term.length >= 3 &&
              doc.bracketModelCompact &&
              doc.bracketModelCompact.startsWith(term)
            ) {
              score += 260;
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
        const expandedHint = expandInternalCatalogCodesInText(queryHint);
        const normHint = normalizeSearchText(expandedHint);
        const compactHint = normHint.replace(/[^a-z0-9]/g, "");
        const terms = normHint
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 2 && !RAG_STOPWORDS.has(t));
        if (terms.length > 0 || compactHint.length >= 3) {
          const scored = selectedPhotos
            .map((item) => {
              const target = normalizeSearchText(`${item.name} ${item.category} ${item.sku}`);
              const compactTarget = target.replace(/[^a-z0-9]/g, "");
              let score = 0;
              if (item.compactModel && item.compactModel.length >= 3 && compactHint.includes(item.compactModel)) {
                score += 100;
              }
              for (const term of terms) {
                if (target.includes(term) || compactTarget.includes(term)) {
                  score += /\d/.test(term) ? 5 : 1;
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

    const realMediaLines = selectedPhotos.map(
      (item) =>
        `  - "${item.name}"${item.sku ? ` [Modelo: ${item.sku}]` : ""}${item.internalCode ? ` [Cód. Interno: ${item.internalCode}]` : ""} → URL: ${item.mediaUrl}`
    );

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

DIRETRIZ CRÍTICA DE USO DA BASE DE CONHECIMENTO E SINCERIDADE TÉCNICA (ANTI-ALUCINAÇÃO):
1. QUANDO A INFORMAÇÃO CONSTAR NOS MANUAIS OU NO CATÁLOGO ACIMA: Você tem autoridade total para usar as especificações técnicas, parâmetros de operação, faixas de dosagem/produção, requisitos pneumáticos/elétricos e regras dos MANUAIS TÉCNICOS e do CATÁLOGO OFICIAL acima para responder com precisão e segurança. NUNCA diga que um equipamento presente no Catálogo Oficial ou nos Manuais Técnicos acima "não foi encontrado".
2. QUANDO A INFORMAÇÃO NÃO CONSTAR (PROIBIÇÃO ABSOLUTA DE ALUCINAR OU INVENTAR): Uma coisa é funcionar muito bem com os dados reais da base; outra completamente diferente é inventar coisas por não saber. Se o operador perguntar sobre um modelo que NÃO está nos manuais/catálogo acima, ou pedir um dado técnico específico (ex: consumo de ar, peso exato, dimensão, potência, velocidade, peça específica, ajuste elétrico) que NÃO esteja escrito no manual ou na ficha do catálogo acima, NUNCA chute, NUNCA deduza e NUNCA invente números ou especificações!
3. SINCERIDADE OBRIGATÓRIA: Quando não souber ou o dado específico não constar no manual/catálogo da base, seja 100% sincero e transparente: passe apenas os dados reais que constam no documento (se houver) e diga claramente que aquela informação específica não consta no manual/catálogo da base e que não vai inventar para não induzir a erro.`;
  } catch (err: any) {
    console.warn("[knowledge-service] Aviso ao carregar contexto da base de conhecimento:", err?.message);
    return `\n\n📚 BASE DE CONHECIMENTO (${persona.company}):\n${corePolicies}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 📸 PAREAMENTO AUTOMÁTICO E SOB DEMANDA DE FOTOS DO CATÁLOGO / BASE DE CONHECIMENTO
// ══════════════════════════════════════════════════════════════════════════════

let cachedInternalCodeToModelMap: Map<string, string> | null = null;
let cachedModelToInternalCodeMap: Map<string, string> | null = null;

function ensureCodeModelMapsInitialized(): {
  codeToModel: Map<string, string>;
  modelToCode: Map<string, string>;
} {
  if (cachedInternalCodeToModelMap && cachedModelToInternalCodeMap) {
    return {
      codeToModel: cachedInternalCodeToModelMap,
      modelToCode: cachedModelToInternalCodeMap,
    };
  }
  const codeToModel = new Map<string, string>();
  const modelToCode = new Map<string, string>();

  // 1. Mapeamentos diretos a partir dos cabeçalhos de manuais técnicos ([PAMQ...] MODELO - MANUAL.pdf)
  const manualEntries = getPreExtractedTecfagManuals();
  for (const m of manualEntries) {
    const mName = (m?.name || "").trim();
    const headerMatch = mName.match(/^\[([A-Za-z0-9_-]{4,20})\]\s*([A-Za-z0-9][A-Za-z0-9\s.+/_-]{0,24}?)\s*[-–—]\s*MANUAL/i);
    if (headerMatch) {
      const upperCode = headerMatch[1].trim().toUpperCase();
      const normCode = normalizeSearchText(upperCode).replace(/[^a-z0-9]/g, "");
      const modelRaw = headerMatch[2].trim();
      const compactModel = normalizeSearchText(modelRaw).replace(/[^a-z0-9+]/g, "");
      if (normCode.length >= 4 && modelRaw.length >= 2) {
        codeToModel.set(normCode, modelRaw);
        if (compactModel.length >= 2 && !modelToCode.has(compactModel)) {
          modelToCode.set(compactModel, upperCode);
        }
      }
    }
  }

  // 2. Mapeamentos do catálogo oficial (nome com "MODELO - Descrição" ou modelo citado na descrição)
  const catalog = (defaultTecfagCatalog as CatalogEntry[]) || [];
  for (const item of catalog) {
    if (!item || item.active === false) continue;
    const rawCode = (item.code || "").trim().toUpperCase();
    const rawName = (item.name || "").trim();
    if (!rawCode || !rawName) continue;
    const normCode = normalizeSearchText(rawCode).replace(/[^a-z0-9]/g, "");
    if (normCode.length < 4) continue;

    let modelCandidate = "";
    if (/\s+[-–—]\s+/.test(rawName)) {
      const prefix = rawName.split(/\s+[-–—]\s+/)[0]?.trim() || "";
      if (prefix && prefix.length >= 2 && prefix.length <= 28) {
        modelCandidate = prefix;
      }
    }
    if (!modelCandidate && item.description) {
      const descMatch = item.description.match(
        /\b(?:Envasadora|Seladora|Dosadora|Empacotadora|Datador|Fechadora|Encapsuladora|Rosqueadora|Rotuladora|Esteira|Moinho|Misturador|alimentador|T[uú]nel(?:\s+de\s+Encolhimento)?)\s+(?:de\s+p[oó]s\s+|port[aá]til\s+|semiautom[aá]tica\s+|autom[aá]tica\s+|em\s+L\s+autom[aá]tica\s+)?([A-Z]{2,6}[-_\s/]?\d{1,5}(?:[-_\s/.]?[A-Z0-9]{1,5})*)\b/
      );
      if (descMatch && descMatch[1]) {
        modelCandidate = descMatch[1].trim();
      }
      if (/\bPratic\s+Seal\b/i.test(item.description) && !modelToCode.has("praticseal")) {
        modelToCode.set("praticseal", rawCode);
      }
    }

    if (modelCandidate) {
      if (!codeToModel.has(normCode)) {
        codeToModel.set(normCode, modelCandidate);
      }
      const compactModel = normalizeSearchText(modelCandidate).replace(/[^a-z0-9+]/g, "");
      if (compactModel.length >= 2 && !modelToCode.has(compactModel)) {
        modelToCode.set(compactModel, rawCode);
      }
    }
  }

  cachedInternalCodeToModelMap = codeToModel;
  cachedModelToInternalCodeMap = modelToCode;
  return { codeToModel, modelToCode };
}

function getInternalCodeToModelMap(): Map<string, string> {
  return ensureCodeModelMapsInitialized().codeToModel;
}

export function getModelToInternalCodeMap(): Map<string, string> {
  return ensureCodeModelMapsInitialized().modelToCode;
}

function expandInternalCatalogCodesInText(text: string): string {
  if (!text) return "";
  const { codeToModel, modelToCode } = ensureCodeModelMapsInitialized();
  if (codeToModel.size === 0 && modelToCode.size === 0) return text;
  const tokens = normalizeSearchText(text).match(/\b[a-z]{2,8}(?:[-_\s]?\d{1,6}[a-z0-9-]*)?\b/g) || [];
  const additions: string[] = [];
  for (const tk of tokens) {
    const cleanTk = tk.replace(/[^a-z0-9]/g, "");
    const mappedModel = codeToModel.get(cleanTk);
    if (mappedModel && !additions.includes(mappedModel)) {
      additions.push(mappedModel);
    }
    const mappedCode = modelToCode.get(cleanTk);
    if (mappedCode && !additions.includes(mappedCode)) {
      additions.push(mappedCode);
    }
  }
  return additions.length > 0 ? `${text} ${additions.join(" ")}` : text;
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractPhotoModelMetadata(fileName: string): {
  displayName: string;
  primaryModel: string;
  compactModel: string;
  normalizedModelKey: string;
  isAccessoryForOtherModel: boolean;
} {
  const displayName = (fileName || "").replace(/\.(jpg|jpeg|png|webp|gif)$/i, "").trim();
  const isAccessoryForOtherModel = /\bpara\s+[A-Z0-9-]+$/i.test(displayName);

  // Ignora IDs internos de arquivo de mídia (ex: kf-1791988358053-6veo3) para não confundir o sufixo aleatório com modelo
  if (/^kf-\d+-[a-z0-9]+$/i.test(displayName)) {
    return {
      displayName,
      primaryModel: "",
      compactModel: "",
      normalizedModelKey: "",
      isAccessoryForOtherModel: false,
    };
  }

  // 1. SKU numérico entre colchetes ou no início
  const numericSkuMatch = displayName.match(/^\[?(\d{4,8})\]?/);
  if (numericSkuMatch) {
    const primaryModel = numericSkuMatch[1];
    const compactModel = primaryModel.toLowerCase();
    return {
      displayName,
      primaryModel,
      compactModel,
      normalizedModelKey: compactModel,
      isAccessoryForOtherModel,
    };
  }

  // 2. Separador com hífen ou travessão (" - " ou " – ")
  const dashParts = displayName.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    let candidate = dashParts[dashParts.length - 1].trim();
    if (
      /^(?:inox|pl[aá]stico|bivolt|220v|380v|manual|autom[aá]tica)$/i.test(candidate) &&
      dashParts.length >= 3
    ) {
      candidate = dashParts[dashParts.length - 2].trim();
    }
    candidate = candidate.replace(/^(?:modelo|linha)\s+/i, "").trim();
    if (
      candidate.length >= 2 &&
      candidate.length <= 26 &&
      (/\d/.test(candidate) ||
        /^[A-Z0-9\s.+/-]{2,18}$/.test(candidate) ||
        /^(?:Pratic\s+Seal|Luxury)$/i.test(candidate))
    ) {
      const compactModel = normalizeSearchText(candidate).replace(/[^a-z0-9+]/g, "");
      return {
        displayName,
        primaryModel: candidate,
        compactModel,
        normalizedModelKey: compactModel,
        isAccessoryForOtherModel,
      };
    }
    const firstCode = dashParts[0].match(/\b([A-Z]{2,5}\s?\d{1,4}[A-Z0-9-]*)\b/);
    if (firstCode) {
      const primaryModel = firstCode[1].trim();
      const compactModel = normalizeSearchText(primaryModel).replace(/[^a-z0-9]/g, "");
      return {
        displayName,
        primaryModel,
        compactModel,
        normalizedModelKey: compactModel,
        isAccessoryForOtherModel,
      };
    }
  }

  // 3. Séries nomeadas ou código alfanumérico no final do nome sem travessão (ex: "Envasadora de Pós VSF-30S", "Genius 12", "SPG-6050", "Empacotadora Cipher 420 com Balança Multicabeças")
  if (!isAccessoryForOtherModel) {
    const seriesMatch = displayName.match(
      /\b((?:Genius|Fusion|Diamond(?:\s+Flow|\s+Plus)?|Exacta|Union(?:\s+Plus(?:\s+II)?|\s+Pro|\s+Advance)?|Sensation\s+Line|Solutions(?:\s+Plus)?|Cipher)\s*[-_]?\s*[A-Za-z0-9]*(?:[-_\s][A-Za-z0-9]+)?)$/i
    );
    if (seriesMatch && seriesMatch[1].trim().length >= 3) {
      const primaryModel = seriesMatch[1].trim();
      const compactModel = normalizeSearchText(primaryModel).replace(/[^a-z0-9]/g, "");
      return {
        displayName,
        primaryModel,
        compactModel,
        normalizedModelKey: compactModel,
        isAccessoryForOtherModel,
      };
    }

    const embeddedCipherOrSeries = displayName.match(
      /\b((?:Cipher|Genius|Fusion|Exacta)\s*[-_]?\s*\d{1,4}[A-Za-z0-9-]*)\b/i
    );
    if (embeddedCipherOrSeries) {
      const primaryModel = embeddedCipherOrSeries[1].trim();
      const compactModel = normalizeSearchText(primaryModel).replace(/[^a-z0-9]/g, "");
      return {
        displayName,
        primaryModel,
        compactModel,
        normalizedModelKey: compactModel,
        isAccessoryForOtherModel,
      };
    }

    const tailCode = displayName.match(
      /\b([A-Z]{1,7}(?:[-_\s]?\d{1,5})(?:[-_\s]?[A-Z0-9]{1,5})*)$/
    );
    if (
      tailCode &&
      !/^(?:INOX\s*304|\d+\s*(?:ML|CM|M|L|KG|W|BICOS|CABECAS))$/i.test(tailCode[1].trim())
    ) {
      const primaryModel = tailCode[1].trim();
      const compactModel = normalizeSearchText(primaryModel).replace(/[^a-z0-9]/g, "");
      return {
        displayName,
        primaryModel,
        compactModel,
        normalizedModelKey: compactModel,
        isAccessoryForOtherModel,
      };
    }

    const endUpper = displayName.match(/\s([A-Z]{3,6})$/);
    if (endUpper && !/^(?:INOX|MANUAL|VACUO|VÁCUO)$/i.test(endUpper[1])) {
      const primaryModel = endUpper[1].trim();
      const compactModel = normalizeSearchText(primaryModel).replace(/[^a-z0-9]/g, "");
      return {
        displayName,
        primaryModel,
        compactModel,
        normalizedModelKey: compactModel,
        isAccessoryForOtherModel,
      };
    }
  }

  return {
    displayName,
    primaryModel: "",
    compactModel: "",
    normalizedModelKey: "",
    isAccessoryForOtherModel,
  };
}

function buildModelBoundaryRegex(primaryModel: string): RegExp | null {
  const norm = normalizeSearchText(primaryModel);
  if (!norm || norm.length < 2) return null;
  // Se for combinação com "+" (ex: "FZL-200S + TDM100S"), exige ambos
  if (norm.includes("+")) {
    const parts = norm
      .split("+")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const partPatterns = parts.map((p) => {
        const sub = p.match(/[a-z]+|\d+/g) || [p];
        return sub.map(escapeRegexLiteral).join("[\\s\\-_/]*");
      });
      return new RegExp(
        `(?:^|[^a-z0-9])(${partPatterns.join("[\\s+\\-_/]+")})(?![a-z0-9])`,
        "i"
      );
    }
  }

  const subTokens = norm.match(/[a-z]+|\d+/g) || [];
  if (subTokens.length === 0) return null;
  const hasDigits = /\d/.test(norm);
  const body = subTokens.map(escapeRegexLiteral).join("[\\s\\-_/]*");

  // Evita que modelos curtos sem dígito (ex: "VSF", "Union") batam como prefixo de modelos compostos ("VSF-30S", "VSF 2000", "Union Plus")
  const lookahead = hasDigits
    ? `(?![a-z0-9]|[\\-_][a-z0-9]|[\\s\\-_]+(?:plus|ii|iii)\\b)`
    : `(?![a-z0-9]|[\\s\\-_]*\\d|[\\s\\-_]+(?:plus|pro|advance|flow|ii|iii)\\b)`;

  return new RegExp(`(?:^|[^a-z0-9])(${body})${lookahead}`, "i");
}

function buildIndexedCatalogPhotoItem(
  id: string,
  name: string,
  category: string,
  mediaUrl: string
): IndexedCatalogPhotoItem {
  const { displayName, primaryModel, compactModel, isAccessoryForOtherModel } =
    extractPhotoModelMetadata(name);
  const normalizedDisplayName = normalizeSearchText(displayName);
  const rawImageUrl = `/api/valentina/catalog-images?action=rawImage&fileId=${encodeURIComponent(id)}`;
  const photoKey =
    compactModel || normalizedDisplayName.replace(/[^a-z0-9]/g, "") || id;
  const modelRegex = primaryModel ? buildModelBoundaryRegex(primaryModel) : null;
  const internalCode = compactModel ? getModelToInternalCodeMap().get(compactModel) : undefined;
  const normInternalCode = internalCode
    ? normalizeSearchText(internalCode).replace(/[^a-z0-9]/g, "")
    : "";
  const aliasKeys = Array.from(
    new Set([compactModel, photoKey, normInternalCode].filter(Boolean))
  );

  return {
    id,
    name,
    displayName,
    normalizedDisplayName,
    sku: primaryModel,
    internalCode,
    compactModel,
    aliasKeys,
    category,
    mediaUrl,
    rawImageUrl,
    photoKey,
    isAccessoryForOtherModel,
    modelRegex,
  };
}

/**
 * Vincula aliases cruzados de fotos que representam o mesmo equipamento físico
 * (ex: "Seladora Contínua Pratic Seal - TC-20" [tc20] e "Seladora Portátil de Embalagens Bivolt - Pratic Seal" [praticseal]),
 * evitando envio duplicado no mesmo turno e garantindo que o controle de anti-repetição (24h) reconheça ambos.
 */
function enrichCatalogPhotoAliasKeys(items: IndexedCatalogPhotoItem[]): void {
  for (const itemA of items) {
    if (!itemA.compactModel || itemA.isAccessoryForOtherModel) continue;
    for (const itemB of items) {
      if (itemA.id === itemB.id || !itemB.compactModel || itemB.isAccessoryForOtherModel) continue;
      const aMentionsB =
        itemB.modelRegex && itemB.compactModel.length >= 4
          ? itemB.modelRegex.test(itemA.normalizedDisplayName)
          : false;
      const bMentionsA =
        itemA.modelRegex && itemA.compactModel.length >= 4
          ? itemA.modelRegex.test(itemB.normalizedDisplayName)
          : false;
      if (aMentionsB || bMentionsA) {
        const merged = Array.from(new Set([...itemA.aliasKeys, ...itemB.aliasKeys]));
        itemA.aliasKeys = merged;
        itemB.aliasKeys = merged;
      }
    }
  }
}

/**
 * Detecta se a mensagem do usuário é uma solicitação direta de foto/imagem da máquina.
 * Ex: "me manda uma foto dela", "cosnegue me mandar uma foto dela", "tem foto?", "mostra uma imagem da vsf 30s".
 */
export function isExplicitMachinePhotoRequest(
  text: string,
  hasAttachedImage = false
): boolean {
  if (hasAttachedImage) return false;
  const q = normalizeSearchText(text || "");
  if (!q) return false;
  return (
    /\b(?:manda|mandar|mande|envia|enviar|envie|mostra|mostrar|mostre|tem|ter|quero\s+ver|ver|qual|cade|puxa|puxe|separa|separe|consegue|cosnegue|conseguir|pode|teria|passa|passar|passe|arruma|arrumar)\b[\s\S]{0,42}\b(?:foto|fotos|imagem|imagens|fotografia)\b/i.test(
      q
    ) ||
    /\b(?:foto|fotos|imagem|imagens)\b[\s\S]{0,28}\b(?:dela|dele|dessa|desse|delas|deles|de\s+todas|de\s+todos|da\s+maquina|do\s+equipamento|do\s+modelo|dos\s+modelos|da\s+linha|da\s+[a-z0-9]|do\s+[a-z0-9]|das\s+[a-z0-9]|dos\s+[a-z0-9])/i.test(
      q
    ) ||
    /^(?:me\s+)?(?:uma\s+)?(?:foto|fotos|imagem|imagens)(?:\s+por\s+favor|\?)?$/i.test(
      q.trim()
    )
  );
}

/**
 * Detecta se o usuário está pedindo fotos de MÚLTIPLOS modelos ou de TODA uma linha/família de máquinas
 * (ex: "me manda foto de todas as vsf disponiveis", "fotos de todos os modelos da linha vsf", "manda foto das duas").
 */
export function isMultiOrFamilyMachinePhotoRequest(text: string): boolean {
  const q = normalizeSearchText(text || "");
  if (!q) return false;
  return (
    /\b(?:todas\s+as|todos\s+os|todas\s+essas|todos\s+esses|cada\s+uma\s+das|cada\s+um\s+dos|todos\s+os\s+modelos|todas\s+as\s+opcoes|modelos\s+disponiveis|opcoes\s+disponiveis)\b/i.test(
      q
    ) ||
    /\b(?:foto|fotos|imagem|imagens)\b[\s\S]{0,30}\b(?:de\s+todas|de\s+todos|dos\s+modelos|das\s+opcoes|da\s+linha|dessa\s+linha|dos\s+dois|das\s+duas|de\s+ambos|de\s+ambas|delas|deles)\b/i.test(
      q
    ) ||
    /\b(?:quais\s+(?:sao\s+)?(?:as|os)|linha\s+completa)\s+[a-z]{2,6}\b/i.test(q)
  );
}

/**
 * Localiza na lista indexada de fotos do catálogo quais máquinas foram citadas em `sourceText`,
 * priorizando modelos mais específicos (longest compactModel match) e consumindo o trecho do texto
 * para impedir que prefixos curtos (ex: "VSF" ou "FX800") casem dentro de códigos maiores ("VSF-30S", "FX 800 C").
 * Quando `includeFamilyMatches = true` (ex: "todas as vsf disponiveis"), expande também para todos os modelos
 * daquela família/linha cadastrados no catálogo de fotos.
 */
function findCatalogPhotosMentionedInText(
  sourceText: string,
  allPhotos: IndexedCatalogPhotoItem[],
  options?: { includeFamilyMatches?: boolean }
): IndexedCatalogPhotoItem[] {
  if (!sourceText || !sourceText.trim() || allPhotos.length === 0) return [];
  const expanded = expandInternalCatalogCodesInText(sourceText);
  const normText = normalizeSearchText(expanded);
  if (!normText) return [];

  // Ordena pelas fotos com modelo mais específico (maior compactModel) primeiro
  const photosWithModel = allPhotos
    .filter((p) => p.modelRegex && p.compactModel.length >= 2 && !p.isAccessoryForOtherModel)
    .sort((a, b) => b.compactModel.length - a.compactModel.length);

  const consumedSpans: Array<{ start: number; end: number }> = [];
  const matchedWithPos: Array<{ photo: IndexedCatalogPhotoItem; pos: number }> = [];

  const overlapsConsumed = (start: number, end: number) =>
    consumedSpans.some((s) => start < s.end && end > s.start);

  for (const photo of photosWithModel) {
    if (!photo.modelRegex) continue;
    const globalRegex = new RegExp(photo.modelRegex.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = globalRegex.exec(normText)) !== null) {
      const captured = m[1] || m[0];
      const matchStart = m.index + (m[0].length - captured.length);
      const matchEnd = matchStart + captured.length;

      // Verifica se logo após o match há sufixo de modelo com espaço + código (ex: "fx 800 c" quando testando "fx800")
      if (overlapsConsumed(matchStart, matchEnd)) continue;

      consumedSpans.push({ start: matchStart, end: matchEnd });
      matchedWithPos.push({ photo, pos: matchStart });
      break;
    }
  }

  // Expansão de família/linha (ex: "todas as vsf disponiveis" -> inclui VSF, VSF-30S, VSF30S-B, VSF2000, VSF 30AGIII, VSFII-30A, VSF-30AG-II, VSF30A)
  if (options?.includeFamilyMatches) {
    const familyPrefixes = new Set<string>();
    for (const entry of matchedWithPos) {
      const prefixMatch = entry.photo.compactModel.match(/^[a-z]{3,6}/)?.[0];
      if (prefixMatch) familyPrefixes.add(prefixMatch);
    }
    const queryTokens = normText.split(/[^a-z0-9]+/).filter((t) => /^[a-z]{3,6}$/.test(t));
    for (const qt of queryTokens) {
      const countInFamily = photosWithModel.filter((p) => p.compactModel.startsWith(qt)).length;
      if (countInFamily >= 2) {
        familyPrefixes.add(qt);
      }
    }

    if (familyPrefixes.size > 0) {
      const alreadyIds = new Set(matchedWithPos.map((e) => e.photo.id));
      const familyExtras: IndexedCatalogPhotoItem[] = [];
      for (const prefix of familyPrefixes) {
        const matchingFamily = allPhotos
          .filter(
            (p) =>
              !p.isAccessoryForOtherModel &&
              p.compactModel.startsWith(prefix) &&
              !alreadyIds.has(p.id)
          )
          .sort((a, b) => a.compactModel.length - b.compactModel.length);
        for (const fp of matchingFamily) {
          alreadyIds.add(fp.id);
          familyExtras.push(fp);
        }
      }
      matchedWithPos.sort((a, b) => a.pos - b.pos);
      return [...matchedWithPos.map((entry) => entry.photo), ...familyExtras];
    }
  }

  // Também verifica match por nome descritivo completo do equipamento (ex: "Alicate para Arqueação Manual", "Esteira Curva")
  if (matchedWithPos.length === 0) {
    const byFullName = [...allPhotos]
      .filter((p) => p.normalizedDisplayName.length >= 12)
      .sort((a, b) => b.normalizedDisplayName.length - a.normalizedDisplayName.length);

    for (const photo of byFullName) {
      const idx = normText.indexOf(photo.normalizedDisplayName);
      if (idx !== -1 && !overlapsConsumed(idx, idx + photo.normalizedDisplayName.length)) {
        consumedSpans.push({
          start: idx,
          end: idx + photo.normalizedDisplayName.length,
        });
        matchedWithPos.push({ photo, pos: idx });
      }
    }
  }

  matchedWithPos.sort((a, b) => a.pos - b.pos);
  return matchedWithPos.map((entry) => entry.photo);
}

/**
 * Identifica quais fotos de `candidates` são apresentadas especificamente no balão `fragmentText`,
 * respeitando a especificidade dos códigos (ex: "VSF-30S" não ativa o modelo base "VSF") e ignorando
 * menções genéricas a "linha VSF" em frases introdutórias.
 */
export function findCatalogPhotosInFragment(
  fragmentText: string,
  candidates: MatchedCatalogPhoto[]
): MatchedCatalogPhoto[] {
  if (!fragmentText || !fragmentText.trim() || candidates.length === 0) return [];
  // Remove menções genéricas do tipo "todos os modelos da linha VSF" para não confundir introdução da linha com o modelo base "VSF"
  const cleanedFragment = fragmentText.replace(
    /\b(?:todos\s+os\s+modelos\s+da\s+linha|modelos\s+da\s+linha|opcoes\s+da\s+linha|toda\s+a\s+linha|da\s+linha|dessa\s+linha|familia)\s+[A-Za-z0-9-]+\b/gi,
    " "
  );
  const normText = normalizeSearchText(cleanedFragment);
  if (!normText) return [];

  const sortedCandidates = [...candidates].sort(
    (a, b) => (b.compactModel?.length || 0) - (a.compactModel?.length || 0)
  );

  const consumedSpans: Array<{ start: number; end: number }> = [];
  const matchedWithPos: Array<{ photo: MatchedCatalogPhoto; pos: number }> = [];
  const overlapsConsumed = (start: number, end: number) =>
    consumedSpans.some((s) => start < s.end && end > s.start);

  for (const photo of sortedCandidates) {
    const rx = buildModelBoundaryRegex(photo.modelCode || photo.modelDisplay || "");
    if (!rx) continue;
    const globalRegex = new RegExp(rx.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = globalRegex.exec(normText)) !== null) {
      const captured = m[1] || m[0];
      const matchStart = m.index + (m[0].length - captured.length);
      const matchEnd = matchStart + captured.length;
      if (overlapsConsumed(matchStart, matchEnd)) continue;
      consumedSpans.push({ start: matchStart, end: matchEnd });
      matchedWithPos.push({ photo, pos: matchStart });
      break;
    }
  }

  matchedWithPos.sort((a, b) => a.pos - b.pos);
  return matchedWithPos.map((e) => e.photo);
}

const fastPhotoCacheByTenant = new Map<
  string,
  { timestamp: number; items: IndexedCatalogPhotoItem[] }
>();

async function getIndexedCatalogPhotosFast(tenantId: string): Promise<IndexedCatalogPhotoItem[]> {
  const fullCached = knowledgeCacheByTenant.get(tenantId);
  if (fullCached && Date.now() - fullCached.timestamp <= KNOWLEDGE_CACHE_TTL_MS) {
    return fullCached.realMediaItems;
  }
  const fastCached = fastPhotoCacheByTenant.get(tenantId);
  if (fastCached && Date.now() - fastCached.timestamp <= KNOWLEDGE_CACHE_TTL_MS) {
    return fastCached.items;
  }
  try {
    const rows = await db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        name: knowledgeFiles.name,
        format: knowledgeFiles.format,
        type: knowledgeFiles.type,
        content: sql<string>`SUBSTRING(${knowledgeFiles.content} FROM 1 FOR 180)`,
      })
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.tenantId, tenantId));

    const folders = await db
      .select({ id: knowledgeFolders.id, name: knowledgeFolders.name })
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.tenantId, tenantId));

    const folderMap = new Map<string, string>();
    folders.forEach((f) => folderMap.set(f.id, f.name));

    const seenByKey = new Map<string, IndexedCatalogPhotoItem>();
    const items: IndexedCatalogPhotoItem[] = [];
    for (const f of rows) {
      const isImageFile =
        f.format === "real" ||
        f.type === "image" ||
        /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name || "");
      if (!isImageFile) continue;
      const contentPrefix = (f.content || "").split("[BASE64:")[0];
      const match = contentPrefix.match(REAL_MEDIA_PATTERN);
      const extFromName = (f.name.split(".").pop() || "jpg").toLowerCase();
      const mediaUrl = match ? match[1] : `/knowledge-media/${f.id}.${extFromName}`;
      const category = f.folderId ? folderMap.get(f.folderId) || "Geral" : "Geral";
      const indexed = buildIndexedCatalogPhotoItem(f.id, f.name, category, mediaUrl);
      const dedupKey = indexed.compactModel || indexed.normalizedDisplayName || f.id;
      const existing = seenByKey.get(dedupKey);
      if (existing) {
        existing.aliasKeys = Array.from(
          new Set([...existing.aliasKeys, f.id, mediaUrl, ...indexed.aliasKeys])
        );
        continue;
      }
      seenByKey.set(dedupKey, indexed);
      items.push(indexed);
    }
    enrichCatalogPhotoAliasKeys(items);
    fastPhotoCacheByTenant.set(tenantId, { timestamp: Date.now(), items });
    return items;
  } catch {
    return [];
  }
}

function toMatchedCatalogPhoto(photo: IndexedCatalogPhotoItem): MatchedCatalogPhoto {
  return {
    fileId: photo.id,
    name: photo.name,
    fileName: photo.name,
    displayName: photo.displayName,
    modelCode: photo.sku || photo.displayName,
    modelDisplay: photo.sku || photo.displayName,
    internalCode: photo.internalCode,
    compactModel: photo.compactModel,
    normalizedModelKey: photo.compactModel || photo.photoKey,
    aliasKeys: photo.aliasKeys,
    rawImageUrl: photo.rawImageUrl,
    mediaUrl: photo.mediaUrl,
    category: photo.category,
    photoKey: photo.photoKey,
  };
}

export interface ResolveCatalogPhotosOptions {
  tenantId?: string;
  userQuery?: string;
  userText?: string;
  attachedFileName?: string;
  aiReplyText?: string;
  recentHistoryMessages?: string[];
  isExplicitPhotoRequest?: boolean;
  isExplicitRequest?: boolean;
  includeFamilyMatches?: boolean;
  alreadySentPhotoKeysInWindow?: Set<string> | string[];
  maxPhotos?: number;
}

/**
 * Resolve as fotos cadastradas no Catálogo / Base de Conhecimento para envio pelo Fagner:
 * - Suporta tanto `resolveMatchingCatalogPhotos(tenantId, options)` quanto `resolveMatchingCatalogPhotos({ tenantId, ...options })`.
 * - Modo Proativo ("de prontidão"): Pareia o modelo/nome da máquina consultada ou explicada e retorna a foto
 *   SE E SOMENTE SE ela (ou um alias do mesmo equipamento, ex: Pratic Seal <-> TC-20) ainda não tiver sido enviada na janela atual de 24h.
 * - Modo Sob Solicitação (`isExplicitPhotoRequest` / `isExplicitRequest` = true): Quando o próprio usuário pede a foto diretamente
 *   (ex: "me manda uma foto dela"), ignora o bloqueio de repetição e busca na pergunta atual ou no turno mais recente da conversa.
 */
export async function resolveMatchingCatalogPhotos(
  tenantIdOrParams: string | ResolveCatalogPhotosOptions,
  maybeOptions?: ResolveCatalogPhotosOptions
): Promise<MatchedCatalogPhoto[]> {
  const normalizedParams: ResolveCatalogPhotosOptions =
    typeof tenantIdOrParams === "string"
      ? { ...(maybeOptions || {}), tenantId: tenantIdOrParams }
      : tenantIdOrParams || {};

  const tenantId = normalizedParams.tenantId || "";
  const userQuery = normalizedParams.userQuery ?? normalizedParams.userText ?? "";
  const attachedFileName = normalizedParams.attachedFileName ?? "";
  const aiReplyText = normalizedParams.aiReplyText ?? "";
  const recentHistoryMessages = normalizedParams.recentHistoryMessages ?? [];
  const isExplicitPhotoRequest =
    normalizedParams.isExplicitPhotoRequest ?? normalizedParams.isExplicitRequest ?? false;
  const includeFamilyMatches =
    normalizedParams.includeFamilyMatches ?? isMultiOrFamilyMachinePhotoRequest(userQuery);
  const alreadySentPhotoKeysInWindow = normalizedParams.alreadySentPhotoKeysInWindow;
  const maxPhotos = normalizedParams.maxPhotos ?? (includeFamilyMatches ? 10 : 1);

  if (!tenantId) return [];

  const allPhotos = await getIndexedCatalogPhotosFast(tenantId);
  if (allPhotos.length === 0) return [];

  const sentSet = new Set<string>();
  if (alreadySentPhotoKeysInWindow) {
    const items = Array.isArray(alreadySentPhotoKeysInWindow)
      ? alreadySentPhotoKeysInWindow
      : Array.from(alreadySentPhotoKeysInWindow);
    for (const k of items) {
      if (!k) continue;
      const raw = String(k).trim();
      sentSet.add(raw);
      const clean = normalizeSearchText(raw).replace(/[^a-z0-9]/g, "");
      if (clean) sentSet.add(clean);
      const kfMatch = raw.match(/(kf-\d+-[a-z0-9]+)/i);
      if (kfMatch) sentSet.add(kfMatch[1]);
    }
  }

  // Propaga os aliases equivalentes das fotos já enviadas (ex: se enviou Pratic Seal, marca TC-20 como já enviada também)
  if (sentSet.size > 0) {
    for (const photo of allPhotos) {
      const normFile = normalizeSearchText(photo.displayName).replace(/[^a-z0-9]/g, "");
      const matchedSent =
        sentSet.has(photo.id) ||
        sentSet.has(photo.photoKey) ||
        sentSet.has(photo.mediaUrl) ||
        sentSet.has(photo.rawImageUrl) ||
        (photo.compactModel && sentSet.has(photo.compactModel)) ||
        (normFile && sentSet.has(normFile)) ||
        photo.aliasKeys.some((ak) => ak && sentSet.has(ak));
      if (matchedSent) {
        sentSet.add(photo.id);
        sentSet.add(photo.photoKey);
        if (photo.compactModel) sentSet.add(photo.compactModel);
        for (const ak of photo.aliasKeys) {
          if (ak) sentSet.add(ak);
        }
      }
    }
  }

  const isAlreadySent = (photo: IndexedCatalogPhotoItem): boolean => {
    if (sentSet.size === 0) return false;
    if (sentSet.has(photo.id) || sentSet.has(photo.photoKey)) return true;
    if (photo.compactModel && sentSet.has(photo.compactModel)) return true;
    if (photo.aliasKeys.some((ak) => ak && sentSet.has(ak))) return true;
    const normFile = normalizeSearchText(photo.displayName).replace(/[^a-z0-9]/g, "");
    if (normFile && sentSet.has(normFile)) return true;
    return false;
  };

  let candidates: IndexedCatalogPhotoItem[] = [];

  // 1. Prioridade 1: Máquina citada diretamente na pergunta atual ou no nome do arquivo anexado (ex: "vsf 30s" ou "[PAMQGPAU036] VSF-30S - MANUAL.pdf")
  const currentTurnInput = [userQuery, attachedFileName].filter(Boolean).join(" ");
  if (currentTurnInput.trim()) {
    candidates = findCatalogPhotosMentionedInText(currentTurnInput, allPhotos, {
      includeFamilyMatches,
    });
  }

  // 2. Prioridade 2 (Quando o usuário pediu foto tipo "me manda uma foto dela" sem repetir o código):
  // Busca na mensagem mais recente do histórico que mencione um modelo de máquina (do turno mais recente para trás!)
  if (candidates.length === 0 && isExplicitPhotoRequest && recentHistoryMessages.length > 0) {
    for (const histMsg of recentHistoryMessages) {
      const foundInTurn = findCatalogPhotosMentionedInText(histMsg, allPhotos, {
        includeFamilyMatches,
      });
      if (foundInTurn.length > 0) {
        candidates = includeFamilyMatches ? foundInTurn : [foundInTurn[0]];
        break;
      }
    }
  }

  // 3. Prioridade 3: Máquina apresentada/explicada na própria resposta atual do Fagner
  if (aiReplyText.trim()) {
    const replyCandidates = findCatalogPhotosMentionedInText(aiReplyText, allPhotos);
    if (candidates.length === 0) {
      candidates = replyCandidates;
    } else if (includeFamilyMatches && replyCandidates.length > 0) {
      // Ordena prioritariamente na ordem em que o Fagner apresentou os modelos nos balões, mantendo eventuais extras da família ao final
      const seenReplyIds = new Set(replyCandidates.map((p) => p.id));
      candidates = [
        ...replyCandidates,
        ...candidates.filter((p) => !seenReplyIds.has(p.id)),
      ];
    }
  }

  if (candidates.length === 0) return [];

  // Aplica a regra de controle anti-repetição:
  // Se NÃO for pedido explícito do usuário (envio proativo "de prontidão"),
  // bloqueia fotos que já foram enviadas nesta janela de 24h, permitindo apenas máquinas ainda não enviadas.
  const filtered = isExplicitPhotoRequest
    ? candidates
    : candidates.filter((photo) => !isAlreadySent(photo));

  const seenIds = new Set<string>();
  const seenAliasKeys = new Set<string>();
  const result: MatchedCatalogPhoto[] = [];
  for (const photo of filtered) {
    if (seenIds.has(photo.id)) continue;
    if (photo.aliasKeys.some((ak) => ak && seenAliasKeys.has(ak))) continue;
    seenIds.add(photo.id);
    for (const ak of photo.aliasKeys) {
      if (ak) seenAliasKeys.add(ak);
    }
    result.push(toMatchedCatalogPhoto(photo));
    if (result.length >= maxPhotos) break;
  }

  return result;
}

/**
 * Resolve URLs do tipo `/knowledge-media/kf-...png` ou IDs de arquivo `kf-...` emitidos em tags `[SEND_IMAGE:...]`
 * para os objetos `MatchedCatalogPhoto` correspondentes do tenant.
 */
export async function resolveCatalogPhotosByMediaUrls(
  tenantId: string,
  urlsOrIds: string[]
): Promise<MatchedCatalogPhoto[]> {
  if (!tenantId || !Array.isArray(urlsOrIds) || urlsOrIds.length === 0) return [];
  const allPhotos = await getIndexedCatalogPhotosFast(tenantId);
  if (allPhotos.length === 0) return [];

  const result: MatchedCatalogPhoto[] = [];
  const seenIds = new Set<string>();

  for (const raw of urlsOrIds) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    const kfMatch = trimmed.match(/(kf-[a-z0-9-]+)/i);
    const targetId = kfMatch ? kfMatch[1] : trimmed.replace(/^\/knowledge-media\//i, "").replace(/\.[a-z0-9]+$/i, "");

    const found = allPhotos.find(
      (p) =>
        p.id === targetId ||
        p.mediaUrl === trimmed ||
        p.rawImageUrl === trimmed ||
        p.mediaUrl.includes(targetId) ||
        p.aliasKeys.includes(targetId) ||
        p.aliasKeys.includes(trimmed)
    );
    if (found && !seenIds.has(found.id)) {
      seenIds.add(found.id);
      result.push(toMatchedCatalogPhoto(found));
    }
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// 🔍 RASTREABILIDADE DE FONTE TÉCNICA (ÍCONE ? NO CHAT DO ASSISTENTE)
// ══════════════════════════════════════════════════════════════════════════════

export interface ResolveKnowledgeSourcesOptions {
  tenantId: string;
  userQuery?: string;
  aiReplyText?: string;
  catalogPhoto?: MatchedCatalogPhoto | Record<string, any> | null;
  hasCrmContext?: boolean;
  crmContextSummary?: string;
  usedKnowledgeBase?: boolean;
}

export interface ResolvedKnowledgeSourcesResult {
  sources: KnowledgeSourceItem[];
  status: KnowledgeSourceStatus;
  statusLabel: string;
  statusDescription: string;
  hasTechnicalClaims: boolean;
  isHonestUnknown: boolean;
}

function buildConciseManualSnippet(doc: IndexedKnowledgeDoc, terms: string[]): string {
  const cleanText = (doc.content || "")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " • ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanText) return "Manual técnico indexado na Base de Conhecimento.";

  const normText = doc.normalizedContent || normalizeSearchText(cleanText);
  for (const term of terms) {
    if (term.length < 3) continue;
    const idx = normText.indexOf(term);
    if (idx > 40) {
      const start = Math.max(0, idx - 50);
      const snippet = cleanText.slice(start, start + 210).trim();
      if (snippet.length > 30) {
        return `${start > 0 ? "…" : ""}${snippet}${start + 210 < cleanText.length ? "…" : ""}`;
      }
    }
  }

  return cleanText.length > 210 ? `${cleanText.slice(0, 210).trim()}…` : cleanText;
}

/**
 * Identifica exatamente de qual Manual Técnico (PDF), Ficha do Catálogo Oficial (1.037 itens)
 * ou Documento/Foto da Base de Conhecimento a resposta do Fagner/Valentina tirou as informações,
 * classificando também quando a IA declarou sinceramente que não sabe (`honest_unknown`)
 * ou quando fez afirmações técnicas sem documento vinculado (`unverified_technical`).
 */
export async function resolveKnowledgeSourcesForMessage(
  options: ResolveKnowledgeSourcesOptions
): Promise<ResolvedKnowledgeSourcesResult> {
  const {
    tenantId,
    userQuery = "",
    aiReplyText = "",
    catalogPhoto,
    hasCrmContext,
    crmContextSummary,
    usedKnowledgeBase,
  } = options;

  const cleanReply = (aiReplyText || "")
    .replace(/\[LOCAL_MEDIA:[^\]]+\]/gi, " ")
    .replace(/\[SEND_IMAGE:[^\]]+\]/gi, " ")
    .trim();
  const cleanUser = (userQuery || "").trim();

  const isHonestUnknown =
    /(n[aã]o consta no manual|n[aã]o consta no cat[aá]logo|n[aã]o consta na documenta[cç][aã]o|n[aã]o consta na base|n[aã]o tenho essa informa[cç][aã]o|n[aã]o encontrei essa especifica[cç][aã]o|n[aã]o encontrei no manual|n[aã]o encontrei no cat[aá]logo|n[aã]o sei informar com precis[aã]o|prefiro n[aã]o chutar|n[aã]o vou inventar|n[aã]o h[aá] registro desse modelo|confirmar direto com a engenharia)/i.test(
      cleanReply
    );

  const hasTechnicalSpecTerms =
    /\b(\d+\s*(v|volts|hz|w|kw|cv|hp|bar|psi|mpa|mm|cm|kg|g|ml|litros|l\/min|m3\/min|potes\/min|embalagens\/min|un\/min|sacos\/min|bpm|rpm|°c|graus)|inox\s*304|inox\s*316|clp|ihm|pneum[aá]tic[oa]|servomotor|rosca sem[- ]fim|balan[cç]a|cabe[cç]ote|bico|esteira|t[uú]nel de encolhimento|seladora|envasadora|dosadora|arqueadora|empacotadora|datador|encapsuladora|rotuladora|fechadora|encartuchadeira|blister|termoformadora)\b/i.test(
      cleanReply
    );

  const sources: KnowledgeSourceItem[] = [];
  const seenIds = new Set<string>();

  if (!tenantId) {
    return {
      sources: [],
      status: "operational_or_chat",
      statusLabel: "Interação Operacional",
      statusDescription: "Mensagem sem vínculo de tenant para consulta documental.",
      hasTechnicalClaims: false,
      isHonestUnknown: false,
    };
  }

  const combinedText = [
    cleanReply,
    cleanUser,
    catalogPhoto?.modelCode || "",
    catalogPhoto?.displayName || "",
  ]
    .filter(Boolean)
    .join(" ");

  const expandedCombined = expandInternalCatalogCodesInText(combinedText);
  const normReply = normalizeSearchText(expandInternalCatalogCodesInText(cleanReply));
  const normUser = normalizeSearchText(expandInternalCatalogCodesInText(cleanUser));
  const normCombined = normalizeSearchText(expandedCombined);
  const compactReply = normReply.replace(/[^a-z0-9]/g, "");
  const compactCombined = normCombined.replace(/[^a-z0-9]/g, "");

  const nonModelTokenRegex = /^(?:r\d+|\d+h|\d+min|\d+d|\d+m|\d+s|360o?|24h|48h|72h)$/i;
  const replyModelMatches =
    normReply.match(/\b[a-z]{1,6}[-_\s/]?\d{1,5}(?:[-_\s/]?[a-z0-9]{1,5})*\b/g) || [];
  const userModelMatches =
    normUser.match(/\b[a-z]{1,6}[-_\s/]?\d{1,5}(?:[-_\s/]?[a-z0-9]{1,5})*\b/g) || [];

  const compactReplyModels = Array.from(
    new Set(
      replyModelMatches
        .map((m) => m.replace(/[^a-z0-9]/g, ""))
        .filter((m) => m.length >= 3 && !nonModelTokenRegex.test(m))
    )
  );
  const compactUserModels = Array.from(
    new Set(
      userModelMatches
        .map((m) => m.replace(/[^a-z0-9]/g, ""))
        .filter((m) => m.length >= 3 && !nonModelTokenRegex.test(m))
    )
  );
  const allCompactModels = Array.from(new Set([...compactReplyModels, ...compactUserModels]));

  const hasExplicitMachineOrCatalogKeyword =
    /\b(?:maquina|maquinas|equipamento|equipamentos|modelo|modelos|manual|manuais|especificac|catalogo|ficha\s+tecnica|seladora|selar|selagem|envasadora|envasar|envase|rotuladora|rotular|rotulagem|datador|datar|datacao|empacotadora|empacotar|dosadora|dosar|valvula|frasco|frascos|pote|potes|garrafa|garrafas|tampa|tampas|alicate|arqueadora|arquear|arqueacao|fita|tunel|encolhimento|vacuo|sache|saches|encapsuladora|encapsular|blister|cartonadora|enfardad|fechadora|stretch|inkjet|laser|ribbon|teflon|resistencia|ihm|clp|inversor|bomba|rotor|pistao|bico|bicos|compressor|pneumatic|pamq[a-z0-9]+|vsf|apf|bsf|dzf?|dbf|dcgy|fql)\b/i.test(
      normCombined
    );

  const isOperationalQueueOrCrmTurn =
    /\b(?:aguardando\s+(?:sua\s+|minha\s+)?resposta|caixa\s+de\s+entrada\s+est[aá]\s+em\s+dia|nenhum\s+cliente\s+aguardando|fila\s+de\s+atendimento|clientes?\s+est[aã]o\s+aguardando|minhas\s+negocia[cç][oõ]es|meus\s+cards|minha\s+meta|minhas\s+tarefas|liga[cç][oõ]es\s+agendadas)\b/i.test(
      normCombined
    );

  // Só busca em manuais técnicos e no catálogo de máquinas quando a mensagem realmente envolver máquinas/produtos/catálogo!
  const shouldSearchTechnicalDocsAndCatalog =
    Boolean(catalogPhoto && (catalogPhoto.fileId || catalogPhoto.mediaUrl || catalogPhoto.rawImageUrl || catalogPhoto.name)) ||
    hasTechnicalSpecTerms ||
    isHonestUnknown ||
    allCompactModels.length > 0 ||
    (hasExplicitMachineOrCatalogKeyword && usedKnowledgeBase !== false && !isOperationalQueueOrCrmTurn);

  try {
    // 1. Se o balão contém uma Foto Oficial do Catálogo anexada
    if (catalogPhoto && (catalogPhoto.fileId || catalogPhoto.mediaUrl || catalogPhoto.rawImageUrl || catalogPhoto.name)) {
      const photoId = `photo-${catalogPhoto.fileId || catalogPhoto.modelCode || catalogPhoto.name}`;
      seenIds.add(photoId);
      sources.push({
        id: photoId,
        kind: "photo",
        title: catalogPhoto.fileName || catalogPhoto.name || catalogPhoto.displayName || "Foto Oficial do Equipamento",
        code: catalogPhoto.modelCode || catalogPhoto.modelDisplay || undefined,
        model: catalogPhoto.displayName || catalogPhoto.modelDisplay || undefined,
        folderOrCategory: catalogPhoto.category
          ? `Acervo de Fotos Reais • ${catalogPhoto.category}`
          : "Base de Conhecimento • Fotos Reais",
        excerptOrDetail: `Imagem oficial do equipamento (${catalogPhoto.displayName || catalogPhoto.modelCode || "Catálogo"}) verificada na Base de Conhecimento.`,
        fileId: catalogPhoto.fileId || undefined,
        mediaUrl: catalogPhoto.rawImageUrl || catalogPhoto.mediaUrl || undefined,
        verified: true,
      });
    }

    if (shouldSearchTechnicalDocsAndCatalog) {
      const cached = await getOrLoadTenantKnowledgeCache(tenantId);

      const replyTerms = Array.from(
        new Set(
          normReply
            .split(/[^a-z0-9]+/)
            .map((t) => t.trim())
            .filter((t) => t.length >= 2 && !RAG_STOPWORDS.has(t))
        )
      );
      const userTerms = Array.from(
        new Set(
          normUser
            .split(/[^a-z0-9]+/)
            .map((t) => t.trim())
            .filter((t) => t.length >= 2 && !RAG_STOPWORDS.has(t))
        )
      );
      const allSearchTerms = Array.from(new Set([...replyTerms, ...userTerms]));

      // 2. Cruza com o Catálogo Oficial de Máquinas Tecfag (1.037 itens) para descobrir modelos e códigos PAMQ
      const matchedCatalogEntries: Array<{ item: CatalogEntry; mappedModel: string; score: number }> = [];
      const matchedFamilyTokens = new Set<string>();
      const matchedPamqCodesCompact = new Set<string>();

      if (tenantId === "tecfag") {
        const catalog = (defaultTecfagCatalog as CatalogEntry[]).filter((item) => item && item.active !== false);
        const codeMap = getInternalCodeToModelMap();

        for (const item of catalog) {
          const rawName = (item.name || "").trim();
          const normName = normalizeSearchText(rawName);
          const compactName = normName.replace(/[^a-z0-9]/g, "");
          const rawCode = (item.code || "").trim();
          const normCode = normalizeSearchText(rawCode).replace(/[^a-z0-9]/g, "");
          const mappedModel = (normCode && codeMap.get(normCode)) || rawName.split(/\s+[-–—]\s+/)[0]?.trim() || "";
          const normPrefix = normalizeSearchText(mappedModel);
          const compactPrefix = normPrefix.replace(/[^a-z0-9]/g, "");

          let score = 0;

          // Match exato do código interno PAMQ...
          if (normCode && normCode.length >= 5 && compactCombined.includes(normCode)) {
            score += compactReply.includes(normCode) ? 1400 : 1100;
          }

          // Match exato do modelo na resposta ou pergunta (ex: "VSF-30S", "VSF2000", "VSF", "APF300-2B")
          if (compactPrefix && compactPrefix.length >= 2) {
            if (compactReplyModels.includes(compactPrefix) || compactUserModels.includes(compactPrefix)) {
              score += compactReplyModels.includes(compactPrefix) ? 1300 : 1050;
            } else if (
              compactPrefix.length >= 3 &&
              (replyTerms.includes(compactPrefix) || userTerms.includes(compactPrefix))
            ) {
              score += replyTerms.includes(compactPrefix) ? 950 : 800;
            } else {
              for (const qm of allCompactModels) {
                if (compactPrefix === qm) {
                  score += 1200;
                } else if (
                  (compactPrefix.length >= 4 && qm.startsWith(compactPrefix)) ||
                  (qm.length >= 4 && compactPrefix.startsWith(qm))
                ) {
                  score += 520;
                } else {
                  const qFamily = qm.match(/^[a-z]{2,5}\d{2,5}/)?.[0];
                  const pFamily = compactPrefix.match(/^[a-z]{2,5}\d{2,5}/)?.[0];
                  if (qFamily && pFamily && qFamily === pFamily) {
                    score += 380;
                  }
                }
              }
            }
          }

          // Match de família (ex: usuário perguntou "VSF" e o item é da família VSF)
          const prefixLetters = compactPrefix.match(/^[a-z]{2,6}/)?.[0] || "";
          if (
            prefixLetters.length >= 3 &&
            (replyTerms.includes(prefixLetters) || userTerms.includes(prefixLetters))
          ) {
            score += replyTerms.includes(prefixLetters) ? 340 : 280;
          }

          // Match de termos específicos com dígitos no nome do equipamento
          for (const term of allSearchTerms) {
            if (/\d/.test(term) && term.length >= 3 && (normName.includes(term) || compactName.includes(term))) {
              score += replyTerms.includes(term) ? 180 : 130;
            }
          }

          if (score >= 260) {
            matchedCatalogEntries.push({ item, mappedModel, score });
            if (compactPrefix.length >= 2) matchedFamilyTokens.add(compactPrefix);
            if (prefixLetters.length >= 3) matchedFamilyTokens.add(prefixLetters);
            if (normCode) matchedPamqCodesCompact.add(normCode);
          }
        }

        matchedCatalogEntries.sort((a, b) => b.score - a.score);
      }

      // 3. Cruza com os Manuais Técnicos (PDF) e Documentos da Base de Conhecimento (`cached.indexedDocs`)
      if (cached.indexedDocs.length > 0 && (allSearchTerms.length > 0 || allCompactModels.length > 0)) {
        const scoredDocs = cached.indexedDocs.map((doc) => {
          let score = 0;
          const isManualDoc =
            doc.folderName.toLowerCase() === "manuais" ||
            /manual/i.test(doc.name) ||
            /^\[pamq/i.test(doc.name);

          if (doc.bracketModelCompact && doc.bracketModelCompact.length >= 3) {
            if (
              allCompactModels.includes(doc.bracketModelCompact) ||
              matchedPamqCodesCompact.has(doc.bracketModelCompact) ||
              matchedFamilyTokens.has(doc.bracketModelCompact)
            ) {
              score += 1400;
            } else if (compactCombined.includes(doc.bracketModelCompact)) {
              score += 1100;
            } else {
              for (const qm of allCompactModels) {
                if (
                  doc.bracketModelCompact.startsWith(qm) ||
                  qm.startsWith(doc.bracketModelCompact)
                ) {
                  score += 650;
                } else {
                  const qFamily = qm.match(/^[a-z]{2,5}\d{2,5}/)?.[0];
                  const dFamily = doc.bracketModelCompact.match(/^[a-z]{2,5}\d{2,5}/)?.[0];
                  if (qFamily && dFamily && qFamily === dFamily) {
                    score += 460;
                  }
                }
              }
            }
          }

          for (const qm of allCompactModels) {
            if (doc.modelTokens.includes(qm)) {
              score += 620;
            } else if (doc.compactAlnumName.includes(qm)) {
              score += 420;
            }
          }

          for (const fam of matchedFamilyTokens) {
            if (fam.length >= 3 && (doc.modelTokens.includes(fam) || doc.bracketModelCompact === fam)) {
              score += 480;
            } else if (fam.length >= 3 && doc.bracketModelCompact.startsWith(fam)) {
              score += 320;
            }
          }

          for (const term of allSearchTerms) {
            const hasDigit = /\d/.test(term);
            if (doc.modelTokens.includes(term)) {
              score += hasDigit ? 340 : 240;
            } else if (hasDigit && (doc.normalizedName.includes(term) || doc.compactAlnumName.includes(term))) {
              score += 150;
            } else if (
              !hasDigit &&
              term.length >= 4 &&
              new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(doc.normalizedName)
            ) {
              score += 60;
            }
            if (!isManualDoc && doc.normalizedContent.includes(term)) {
              score += hasDigit ? 50 : 25;
            }
          }

          return { doc, score };
        });

        scoredDocs.sort((a, b) => b.score - a.score);
        const minDocScore = tenantId === "tecfag" ? 240 : 60;
        const topDocs = scoredDocs.filter((d) => d.score >= minDocScore).slice(0, 4);

        for (const { doc } of topDocs) {
          const docSourceId = `doc-${doc.id}`;
          if (seenIds.has(docSourceId)) continue;
          seenIds.add(docSourceId);
          const isManual =
            doc.folderName.toLowerCase() === "manuais" ||
            /manual/i.test(doc.name) ||
            /^\[pamq/i.test(doc.name);
          sources.push({
            id: docSourceId,
            kind: isManual ? "manual" : "document",
            title: doc.name,
            code: doc.bracketModelRaw || undefined,
            folderOrCategory: isManual ? `Manual Técnico PDF • Pasta ${doc.folderName}` : `Documento • Pasta ${doc.folderName}`,
            charCount: doc.content.length,
            excerptOrDetail: buildConciseManualSnippet(doc, allSearchTerms),
            fileId: doc.id,
            verified: true,
          });
        }
      }

      // 4. Adiciona as Fichas do Catálogo Oficial correspondentes (até 5 fichas mais relevantes)
      for (const { item, mappedModel } of matchedCatalogEntries.slice(0, 5)) {
        const catId = `cat-${item.id || item.code || item.name}`;
        if (seenIds.has(catId)) continue;
        seenIds.add(catId);

        const cleanTitle = (item.name || "").replace(/\s+/g, " ").trim();
        const details: string[] = [];
        if (item.code) details.push(`Código: ${item.code}`);
        if (item.sku) details.push(`SKU: ${item.sku}`);
        if (item.line) details.push(`Linha: ${item.line}`);
        if (item.production) details.push(`Produção: ${item.production}`);
        if (item.description) {
          details.push(item.description.replace(/\s+/g, " ").trim());
        }

        sources.push({
          id: catId,
          kind: "catalog",
          title:
            mappedModel && !normalizeSearchText(cleanTitle).includes(normalizeSearchText(mappedModel))
              ? `${mappedModel} — ${cleanTitle}`
              : cleanTitle,
          code: item.code || (item.sku ? `SKU ${item.sku}` : undefined),
          model: mappedModel || undefined,
          folderOrCategory: item.line
            ? `Catálogo Oficial Tecfag • Linha ${item.line}`
            : "Catálogo Oficial de Máquinas",
          excerptOrDetail:
            details.join(" • ").slice(0, 260) || "Registro oficial ativo no Catálogo de Máquinas.",
          verified: true,
        });
      }
    }

    // 5. Se utilizou dados do CRM / Atendimento em tempo real
    if (hasCrmContext || isOperationalQueueOrCrmTurn) {
      sources.push({
        id: "crm-live-context",
        kind: "crm",
        title: "Dados Operacionais em Tempo Real (Fila WhatsApp & CRM)",
        folderOrCategory: "Banco de Dados Operacional • Tempo Real",
        excerptOrDetail:
          crmContextSummary ||
          "Consulta direta em tempo real na sua fila de atendimento do WhatsApp e nos registros da sua carteira no CRM.",
        verified: true,
      });
    }
  } catch (err: any) {
    console.warn("[knowledge-service] Aviso ao resolver fontes da mensagem:", err?.message);
  }

  const hasManualOrDoc = sources.some((s) => s.kind === "manual" || s.kind === "document");
  const hasCatalogOrPhoto = sources.some((s) => s.kind === "catalog" || s.kind === "photo");
  const hasCrmSource = sources.some((s) => s.kind === "crm");
  const hasTechnicalClaims = hasTechnicalSpecTerms || hasManualOrDoc || hasCatalogOrPhoto;

  let status: KnowledgeSourceStatus = "operational_or_chat";
  let statusLabel = hasCrmSource
    ? "Consulta Operacional em Tempo Real (Fila & CRM)"
    : "Interação Operacional / Conversa";
  let statusDescription = hasCrmSource
    ? "O assistente consultou em tempo real sua fila de atendimento no WhatsApp e sua carteira no CRM (nenhum manual técnico de máquina foi utilizado)."
    : "Mensagem conversacional ou de apoio operacional (sem exigência de manual técnico específico).";

  if (hasManualOrDoc) {
    if (isHonestUnknown) {
      status = "honest_unknown";
      statusLabel = "Sinceridade Técnica • Manual Consultado";
      statusDescription =
        "O assistente consultou os Manuais Técnicos abaixo e informou com transparência o que consta e o que não está especificado na documentação.";
    } else {
      status = "verified";
      statusLabel = "Fonte Técnica Verificada (Manual / RAG)";
      statusDescription =
        "Informações técnicas extraídas diretamente dos Manuais Técnicos (PDF) e Catálogo Oficial indexados na Base de Conhecimento.";
    }
  } else if (hasCatalogOrPhoto) {
    if (isHonestUnknown) {
      status = "honest_unknown";
      statusLabel = "Sinceridade Técnica • Catálogo Consultado";
      statusDescription =
        "O assistente consultou o Catálogo Oficial abaixo e declarou com sinceridade os detalhes técnicos que não constam na ficha resumida.";
    } else {
      status = "catalog_only";
      statusLabel = "Fonte Verificada no Catálogo Oficial";
      statusDescription =
        "Informações de modelos, códigos, linhas e capacidades extraídas do Catálogo Oficial de Máquinas e Acervo da Base de Conhecimento.";
    }
  } else if (isHonestUnknown) {
    status = "honest_unknown";
    statusLabel = "Sinceridade Técnica (Dado Ausente na Base)";
    statusDescription =
      "O assistente declarou sinceramente que não possui esse dado técnico na documentação oficial, evitando alucinar ou inventar especificações.";
  } else if (hasTechnicalSpecTerms) {
    status = "unverified_technical";
    statusLabel = "Atenção: Sem Manual ou Ficha Vinculada";
    statusDescription =
      "Esta resposta menciona especificações técnicas de máquina, mas nenhum Manual PDF ou ficha do Catálogo Oficial correspondente foi localizado na Base de Conhecimento. Confirme antes de repassar.";
  }

  return {
    sources,
    status,
    statusLabel,
    statusDescription,
    hasTechnicalClaims,
    isHonestUnknown,
  };
}



