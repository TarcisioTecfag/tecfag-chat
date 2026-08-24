import { db } from "../../db";
import { knowledgeFiles, knowledgeFolders } from "../../db/schema";
import { eq } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Diretório físico onde as mídias de Formato Real são salvas.
// Usa import.meta.url (igual ao knowledge.ts) para resolver corretamente
// tanto em desenvolvimento (ts-node) quanto em produção (Railway/.output/).
const __dirname_ks = path.dirname(fileURLToPath(import.meta.url));
export const KNOWLEDGE_MEDIA_DIR = path.resolve(__dirname_ks, "../../../public/knowledge-media");



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

3. REGRAS DE CONDUTA DA VALENTINA:
   - Se o cliente mandar foto ou pedir um item (ex: Pote de Vidro Âmbar 10ml), confirme com entusiasmo e apresente os detalhes reais do produto.
   - Se o cliente pedir quantidade < 50 un (ex: 10 unidades), oriente com carinho que o mínimo no site é 50 unidades (ou indique o Mercado Livre para 10 unidades).
   - Se o cliente disser que NÃO quer mais um item ou que não pediu (ex: "não pedi trigger", "esquece isso"), desconsidere imediatamente e foque no produto atual.
--- FIM DAS DIRETRIZES OFICIAIS ---
`;

// ── Regex de identificação de mídia real ───────────────────────────────────────
const REAL_MEDIA_PATTERN = /^\[FORMATO_REAL:(\/knowledge-media\/[^\]]+)\]/;
const BASE64_PATTERN = /\[BASE64:([A-Za-z0-9+/=]+)\]/;

export interface RealMediaFile {
  name: string;
  mediaUrl: string;
  fileId: string;
  base64Data?: string;   // Base64 da imagem — fonte de verdade persistente no banco
  mimeType?: string;
}

/**
 * Retorna todos os arquivos de Formato Real com mediaUrl e base64 disponíveis.
 * Usado pelo motor da Valentina para matching e envio de fotos.
 */
export async function getRealMediaFiles(tenantId: string): Promise<RealMediaFile[]> {
  try {
    const files = await db
      .select()
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.tenantId, tenantId));

    return files
      .filter(f => f.format === "real" && f.content)
      .map(f => {
        const contentFull = f.content || "";
        // Separa o prefixo (URL) do base64 enorme para evitar regex lenta em 170KB
        const b64SplitIdx = contentFull.indexOf("[BASE64:");
        const contentPrefix = b64SplitIdx >= 0 ? contentFull.substring(0, b64SplitIdx) : contentFull;

        const urlMatch = contentPrefix.match(REAL_MEDIA_PATTERN);
        if (!urlMatch) return null;
        const mediaUrl = urlMatch[1];

        // Extrai base64 salvo no banco (novo formato) — usa o content completo
        const b64Match = contentFull.match(BASE64_PATTERN);
        const base64Data = b64Match?.[1];

        // Deriva mimeType a partir da extensão do mediaUrl
        const ext = mediaUrl.split(".").pop()?.toLowerCase() || "jpg";
        const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";

        return { name: f.name, mediaUrl, fileId: f.id, base64Data, mimeType };
      })
      .filter(Boolean) as RealMediaFile[];
  } catch {
    return [];
  }
}

/**
 * Busca o contexto consolidado de todos os arquivos da base de conhecimento
 * salvos para alimentar o prompt do Gemini (SDR e Supervisor) e ligações (Twilio/ElevenLabs).
 */
export async function getKnowledgeBaseContext(tenantId: string = "valem"): Promise<string> {
  try {
    const files = await db
      .select()
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.tenantId, tenantId));

    const folders = await db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.tenantId, tenantId));

    const folderMap = new Map<string, string>();
    folders.forEach((f) => folderMap.set(f.id, f.name));

    // Inclui arquivos de texto com conteúdo extraído (exceto marcadores de formato real)
    const activeFiles = files.filter(
      (f) => f.content && f.content.trim().length > 0 && !f.content.startsWith("[Documento ")
        && f.format !== "real" // Arquivos Formato Real não entram no RAG de texto
    );

    // Compila catálogo de fotos reais disponíveis para a Valentina.
    // Usa apenas o prefixo do content (antes do [BASE64:...]) para evitar
    // processar 170KB de base64 desnecessariamente na regex.
    const realMediaFiles = files
      .filter(f => f.format === "real" && f.content)
      .map(f => {
        // Separa o prefixo "[FORMATO_REAL:url]" do resto (que pode conter base64 enorme)
        const contentPrefix = (f.content || "").split("[BASE64:")[0];
        const match = contentPrefix.match(REAL_MEDIA_PATTERN);
        if (!match) {
          console.log(`[KnowledgeService] ⚠️ REAL_MEDIA_PATTERN não encontrou match no arquivo: name="${f.name}" | contentPrefix="${contentPrefix.substring(0, 100)}"`);
          return null;
        }
        return `  - "${f.name}" → URL: ${match[1]}`;
      })
      .filter(Boolean);

    // 🔍 Diagnóstico: logar catálogo construído
    console.log(`[KnowledgeService] 📸 Catálogo Formato Real: ${realMediaFiles.length} foto(s) no prompt | Entradas: ${JSON.stringify(realMediaFiles)}`);

    let additionalDocs = "";
    if (activeFiles.length > 0) {
      additionalDocs = activeFiles
        .map((f) => {
          const folderName = f.folderId ? folderMap.get(f.folderId) || "Geral" : "Geral";
          return `--- DOCUMENTO: ${f.name} (Pasta: ${folderName}) ---\n${f.content}\n--- FIM DO DOCUMENTO ---`;
        })
        .join("\n\n");
    }

    const realMediaSection = realMediaFiles.length > 0
      ? `\n\n📸 FOTOS REAIS DISPONÍVEIS PARA ENVIO (Formato Real):
Você pode enviar essas fotos ao cliente durante o atendimento usando a tag [SEND_IMAGE:URL].
Exemplos de uso:
  - Cliente pede "válvula pump" → identifique o produto na lista abaixo e emita [SEND_IMAGE:URL] antes da mensagem de confirmação.
  - Fluxo obrigatório: 1. Envie a imagem com [SEND_IMAGE:URL]. 2. Pergunte: "Esse seria o modelo que você está procurando?" 3. Se SIM → prossiga. Se NÃO → peça mais detalhes ou foto de referência. NÃO insista.
Lista de fotos cadastradas:
${realMediaFiles.join("\n")}`
      : "";

    return `\n\n📚 BASE DE CONHECIMENTO, REGRAS COMERCIAIS E CATÁLOGO OFICIAL VALEMPACK:
${VALEM_CORE_COMMERCIAL_POLICIES}

${additionalDocs ? `DOCUMENTOS ADICIONAIS DA BASE:\n${additionalDocs}\n` : ""}
${realMediaSection}

DIRETRIZ CRÍTICA DE USO DA BASE DE CONHECIMENTO:
1. Você tem autoridade total para usar as informações e regras fiscais/comerciais acima para responder com precisão matemática e comercial a qualquer dúvida do cliente.
2. NUNCA contradiga as regras de pedido mínimo (1.000 un atacado WhatsApp CNPJ; 50 un site para CPF ou volumes menores).
3. Responda sempre com segurança, precisão técnica e simpatia comercial humana antes de prosseguir com a qualificação.`;
  } catch (err: any) {
    console.warn("[knowledge-service] Aviso ao carregar contexto da base de conhecimento:", err?.message);
    return `\n\n📚 BASE DE CONHECIMENTO & REGRAS VALEMPACK:\n${VALEM_CORE_COMMERCIAL_POLICIES}`;
  }
}


