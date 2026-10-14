import { db } from "../../db";
import { knowledgeFiles, knowledgeFolders } from "../../db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAiPersona } from "../ai-persona";

// Diretório físico onde as mídias de Formato Real são salvas.
// Usa import.meta.url (igual ao knowledge.ts) para resolver corretamente
// tanto em desenvolvimento (ts-node) quanto em produção (Railway/.output/).
const __dirname_ks = path.dirname(fileURLToPath(import.meta.url));
export const KNOWLEDGE_MEDIA_DIR = path.resolve(__dirname_ks, "../../../public/knowledge-media");

// Cache leve em memória para evitar re-leitura repetitiva a cada mensagem da IA (TTL: 60s)
interface CachedKnowledgeData {
  timestamp: number;
  activeDocsText: string;
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
    // Extrai fileIds caso targetUrls no formato "/knowledge-media/<fileId>.<ext>" sejam passados
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
        // Só carrega o Base64 completo quando há filtro de arquivo específico; caso contrário, lê apenas o cabeçalho
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

/**
 * Busca o contexto consolidado de todos os arquivos da base de conhecimento
 * salvos para alimentar o prompt do Gemini (SDR e Supervisor) e ligações (Twilio/ElevenLabs).
 * Otimizado para NUNCA puxar os ~99 MB de Base64 do PostgreSQL e para limitar a injeção de fotos no prompt.
 */
export async function getKnowledgeBaseContext(tenantId: string, queryHint?: string): Promise<string> {
  if (!tenantId) {
    throw new Error("[knowledge-service] tenantId é obrigatório ao buscar contexto da base de conhecimento (AGENTS.md).");
  }

  const persona = getAiPersona(tenantId);
  const corePolicies = tenantId === "valem" ? VALEM_CORE_COMMERCIAL_POLICIES : "";

  try {
    let cached = knowledgeCacheByTenant.get(tenantId);
    if (!cached || Date.now() - cached.timestamp > KNOWLEDGE_CACHE_TTL_MS) {
      // Seleciona APENAS os primeiros 180 caracteres quando format = 'real' (evita transferir 99 MB de TOAST Base64!)
      const files = await db
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

      const folders = await db
        .select({
          id: knowledgeFolders.id,
          name: knowledgeFolders.name,
        })
        .from(knowledgeFolders)
        .where(eq(knowledgeFolders.tenantId, tenantId));

      const folderMap = new Map<string, string>();
      folders.forEach((f) => folderMap.set(f.id, f.name));

      // Inclui arquivos de texto com conteúdo extraído (exceto marcadores de formato real)
      const activeFiles = files.filter(
        (f) =>
          f.content &&
          f.content.trim().length > 0 &&
          !f.content.startsWith("[Documento ") &&
          f.format !== "real"
      );

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

      const activeDocsText =
        activeFiles.length > 0
          ? activeFiles
              .map((f) => {
                const folderName = f.folderId ? folderMap.get(f.folderId) || "Geral" : "Geral";
                return `--- DOCUMENTO: ${f.name} (Pasta: ${folderName}) ---\n${f.content}\n--- FIM DO DOCUMENTO ---`;
              })
              .join("\n\n")
          : "";

      cached = {
        timestamp: Date.now(),
        activeDocsText,
        realMediaItems,
      };
      knowledgeCacheByTenant.set(tenantId, cached);
    }

    // Se houver mais de 45 fotos (ex: 447 máquinas no tenant tecfag), filtra contextualmente
    // para não desperdiçar ~13.000 tokens de entrada em cada requisição ao Gemini.
    const MAX_PROMPT_PHOTOS = 40;
    let selectedPhotos = cached.realMediaItems;
    if (selectedPhotos.length > MAX_PROMPT_PHOTOS) {
      if (queryHint && queryHint.trim().length >= 2) {
        const terms = normalizeSearchText(queryHint)
          .split(/\s+/)
          .filter((t) => t.length >= 2);
        if (terms.length > 0) {
          const scored = selectedPhotos
            .map((item) => {
              const target = normalizeSearchText(`${item.name} ${item.category} ${item.sku}`);
              let score = 0;
              for (const term of terms) {
                if (target.includes(term)) score += 1;
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

${cached.activeDocsText ? `DOCUMENTOS ADICIONAIS DA BASE:\n${cached.activeDocsText}\n` : ""}
${realMediaSection}

DIRETRIZ CRÍTICA DE USO DA BASE DE CONHECIMENTO:
1. Você tem autoridade total para usar as informações e regras técnicas/comerciais acima para responder com precisão e segurança a qualquer dúvida do cliente.
2. Responda sempre com segurança, precisão técnica e empatia antes de prosseguir com a qualificação.`;
  } catch (err: any) {
    console.warn("[knowledge-service] Aviso ao carregar contexto da base de conhecimento:", err?.message);
    return `\n\n📚 BASE DE CONHECIMENTO (${persona.company}):\n${corePolicies}`;
  }
}


