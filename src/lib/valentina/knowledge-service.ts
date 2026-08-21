import { db } from "../../db";
import { knowledgeFiles, knowledgeFolders } from "../../db/schema";
import { eq } from "drizzle-orm";

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

    // Inclui todos os arquivos com conteúdo de texto extraído
    const activeFiles = files.filter(
      (f) => f.content && f.content.trim().length > 0 && !f.content.startsWith("[Documento ")
    );

    let additionalDocs = "";
    if (activeFiles.length > 0) {
      additionalDocs = activeFiles
        .map((f) => {
          const folderName = f.folderId ? folderMap.get(f.folderId) || "Geral" : "Geral";
          return `--- DOCUMENTO: ${f.name} (Pasta: ${folderName}) ---\n${f.content}\n--- FIM DO DOCUMENTO ---`;
        })
        .join("\n\n");
    }

    return `\n\n📚 BASE DE CONHECIMENTO, REGRAS COMERCIAIS E CATÁLOGO OFICIAL VALEMPACK:
${VALEM_CORE_COMMERCIAL_POLICIES}

${additionalDocs ? `DOCUMENTOS ADICIONAIS DA BASE:\n${additionalDocs}\n` : ""}

DIRETRIZ CRÍTICA DE USO DA BASE DE CONHECIMENTO:
1. Você tem autoridade total para usar as informações e regras fiscais/comerciais acima para responder com precisão matemática e comercial a qualquer dúvida do cliente.
2. NUNCA contradiga as regras de pedido mínimo (1.000 un atacado WhatsApp CNPJ; 50 un site para CPF ou volumes menores).
3. Responda sempre com segurança, precisão técnica e simpatia comercial humana antes de prosseguir com a qualificação.`;
  } catch (err: any) {
    console.warn("[knowledge-service] Aviso ao carregar contexto da base de conhecimento:", err?.message);
    return `\n\n📚 BASE DE CONHECIMENTO & REGRAS VALEMPACK:\n${VALEM_CORE_COMMERCIAL_POLICIES}`;
  }
}


