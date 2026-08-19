import { db } from "../../db";
import { knowledgeFiles, knowledgeFolders } from "../../db/schema";
import { eq } from "drizzle-orm";

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

    if (activeFiles.length === 0) {
      return `\n\n📚 BASE DE CONHECIMENTO & CATÁLOGO OFICIAL VALEMPACK:
- Segmento: Válvulas e Embalagens Industriais, Cosméticas e Farmacêuticas.
- Produtos Principais:
  * Válvulas Spray (roscas 24/410, 28/410, estriadas e lisas, pescador sob medida)
  * Válvulas Pump e Saboneteira (dosadoras para loções, cremes e sabonetes)
  * Válvulas Gatilho / Mini Trigger (para borrifadores de limpeza e cosméticos)
  * Válvulas Espumadoras (para sabonete em espuma e higienização facial)
  * Frascos e Potes (PET, PEAD, Vidro, Alumínio) de 30ml a 1000ml
  * Seladoras e Embaladoras industriais (Manuais, Automáticas, Contínuas)
- Política Comercial: Atendimento a atacado e varejo, estoque para pronta entrega e envios para todo o Brasil.`;
    }

    const compiledText = activeFiles
      .map((f) => {
        const folderName = f.folderId ? folderMap.get(f.folderId) || "Geral" : "Geral";
        return `--- DOCUMENTO: ${f.name} (Pasta: ${folderName}) ---\n${f.content}\n--- FIM DO DOCUMENTO ---`;
      })
      .join("\n\n");

    return `\n\n📚 BASE DE CONHECIMENTO, ARGUMENTOS E CATÁLOGO OFICIAL VALEMPACK:
${compiledText}

DIRETRIZ CRÍTICA DE USO DA BASE DE CONHECIMENTO:
1. Você tem autoridade total para usar as informações acima para responder a qualquer dúvida do cliente sobre: modelos de produtos, tipos de válvulas (Spray, Pump, Gatilho, Espumadora), roscas e terminações (ex: 24/410, 28/410), compatibilidade de materiais (PET, PEAD, Vidro, Alumínio), volumetrias, argumentos de venda e diferenciais da Valempack.
2. Responda sempre com segurança, precisão técnica e simpatia comercial humana antes de prosseguir com a qualificação.`;
  } catch (err: any) {
    console.warn("[knowledge-service] Aviso ao carregar contexto da base de conhecimento:", err?.message);
    return "";
  }
}

