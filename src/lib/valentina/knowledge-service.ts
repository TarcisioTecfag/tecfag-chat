import { db } from "../../db";
import { knowledgeFiles } from "../../db/schema";
import { eq } from "drizzle-orm";

/**
 * Busca o contexto consolidado de todos os arquivos da base de conhecimento
 * salvos como 'embeddings' para alimentar o prompt do Gemini (SDR e Supervisor).
 */
export async function getKnowledgeBaseContext(tenantId: string = "valem"): Promise<string> {
  try {
    const files = await db
      .select()
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.tenantId, tenantId));

    // Filtra arquivos com formato 'embeddings' ou com conteúdo de texto extraído
    const activeFiles = files.filter(
      (f) => f.format === "embeddings" && f.content && f.content.trim().length > 0
    );

    if (activeFiles.length === 0) {
      return "";
    }

    const compiledText = activeFiles
      .map((f) => `--- INÍCIO DO ARQUIVO DA BASE DE CONHECIMENTO: ${f.name} ---\n${f.content}\n--- FIM DO ARQUIVO: ${f.name} ---`)
      .join("\n\n");

    return `\n\n📚 CONHECIMENTO TÉCNICO E CATÁLOGO OFICIAL DE PRODUTOS DA VALEMPACK:
${compiledText}
Use as informações acima para responder com exatidão sobre os tipos de produtos, materiais (PET, PEAD, Vidro, Alumínio), válvulas (Pump, Spray, Borrifador, Gatilho, Espumadora), volumetrias, marcas e aplicações que a Valempack comercializa.`;
  } catch (err: any) {
    console.warn("[knowledge-service] Aviso ao carregar contexto da base de conhecimento:", err?.message);
    return "";
  }
}
