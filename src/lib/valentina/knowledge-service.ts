import { db } from "../../db";
import { knowledgeFiles, knowledgeFolders } from "../../db/schema";
import { eq } from "drizzle-orm";

const VALEM_CORE_COMMERCIAL_POLICIES = `
--- 🏛️ DIRETRIZES COMERCIAIS, FISCAIS E FAQ OFICIAL VALEMPACK (INVIOLÁVEL) ---
1. ATENDIMENTO DIRETO NO WHATSAPP & CONSULTORAS (ATACADO B2B EXCLUSIVO PARA CNPJ):
   - Nossas vendas diretas, inclusive via WhatsApp e atendimento com nossas consultoras, são destinadas EXCLUSIVAMENTE para transações entre CNPJ (empresa para empresa).
   - Justificativa Fiscal: Esse modelo evita questões fiscais como DIFAL (Diferencial de Alíquota) e permite oferecer as melhores condições comerciais do mercado.
   - QUANTIDADE MÍNIMA PARA ATACADO NO WHATSAPP: O pedido mínimo é de 1.000 (MIL) UNIDADES POR ITEM.

2. COMPRAS PARA CPF / PESSOA FÍSICA (E-COMMERCE & MERCADO LIVRE):
   - A Valem NÃO realiza vendas diretas pelo WhatsApp para CPF.
   - Para compras em CPF, as vendas acontecem EXCLUSIVAMENTE pelo nosso site oficial: https://www.valempack.com.br
   - Quantidade no site: a partir de 50 UNIDADES.
   - Para quantidades menores que 50 unidades: Também disponibilizamos parte dos produtos em nossa loja oficial no MERCADO LIVRE.

3. EMPRESAS (CNPJ) QUE DESEJAM COMPRAR MENOS DE 1.000 UNIDADES:
   - Empresas que não atingem a venda mínima do atacado (1.000 un) podem comprar diretamente pelo site.
   - Benefício Especial PJ no Site: Oferecemos 15% DE DESCONTO para cadastros PJ no site (basta entrar em contato com a assistente virtual do e-commerce para validar o cupom).

4. CATÁLOGO & PRODUTOS EM LINHA:
   - Válvulas Spray (roscas 24/410, 28/410, estriadas, lisas, metálicas e plásticas, pescador sob medida).
   - Válvulas Pump e Saboneteira (dosadoras para loções, cremes e sabonetes).
   - Válvulas Gatilho / Mini Trigger (para borrifadores de limpeza, cosméticos e automotivo).
   - Válvulas Espumadoras (para sabonete em espuma e higienização facial).
   - Frascos e Potes (PET, PEAD, Vidro, Alumínio) de 30ml a 1000ml.
   - Seladoras e Embaladoras industriais (Manuais, Automáticas, Contínuas).

5. REGRAS DE CONDUTA DA VALENTINA PARA DÚVIDAS SOBRE CPF / PEDIDO MÍNIMO:
   - 🛑 NUNCA diga que no WhatsApp não tem pedido mínimo ou que vende qualquer quantidade para CPF!
   - Se o cliente perguntar o pedido mínimo para CPF:
     Explique com simpatia humana: "Olha, aqui no WhatsApp nosso atendimento é no atacado para empresas (CNPJ), com pedido mínimo de mil unidades por item para garantir as melhores condições fiscais. Já para compras no CPF ou quantidades menores, a gente atende direto pelo nosso site www.valempack.com.br a partir de 50 unidades, ou no Mercado Livre! 😊"
   - Se o cliente for CNPJ e quiser menos de 1.000 unidades:
     Oriente com entusiasmo que ele pode comprar no site www.valempack.com.br com 15% de desconto para PJ!
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


