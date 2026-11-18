import { db } from "../src/db";
import { messages } from "../src/db/schema";
import { and, eq, isNull, or, sql, like } from "drizzle-orm";
import { transcribeAndPersistMessageAudio } from "../src/lib/call-transcriber";
import fs from "node:fs";
import path from "node:path";

async function reprocessFailedTranscriptions() {
  console.log("Iniciando reprocessamento de transcrições falhas...");

  // Buscar mensagens que têm conteúdo de mídia de áudio mas não possuem interpretação
  const failedMessages = await db
    .select()
    .from(messages)
    .where(
      and(
        like(messages.content, "[MEDIA:audio]%"),
        or(isNull(messages.mediaInterpretation), sql`length(trim(${messages.mediaInterpretation})) = 0`)
      )
    )
    .limit(10); // Lote menor para diagnóstico

  console.log(`Encontradas ${failedMessages.length} mensagens para reprocessar.`);

  for (const msg of failedMessages) {
    console.log(`Reprocessando mensagem ${msg.id} (tenant: ${msg.tenantId})...`);
    
    // Extrai o mediaId
    const mediaMatch = (msg.content || "").match(/^\[MEDIA:audio\]([^:\n]+)(?::([^\n]+))?/);
    const targetMediaId = mediaMatch?.[1]?.trim();

    if (!targetMediaId) {
        console.warn(`Não foi possível extrair mediaId da mensagem ${msg.id}`);
        continue;
    }

    // Busca o arquivo
    const localDiskPath = path.join(process.cwd(), "media", targetMediaId);
    
    if (!fs.existsSync(localDiskPath)) {
        console.warn(`Arquivo de áudio não encontrado em ${localDiskPath}`);
        continue;
    }
    
    const audioBuffer = fs.readFileSync(localDiskPath);
    
    // Tenta transcrever
    try {
        const transcription = await transcribeAndPersistMessageAudio({
            tenantId: msg.tenantId,
            messageId: msg.id,
            conversationId: msg.conversationId,
            audioBuffer,
            mimeType: "audio/ogg", // Fallback assumido
            fileName: `${targetMediaId}.ogg`
        });
        
        if (transcription) {
            console.log(`Sucesso na mensagem ${msg.id}: ${transcription.substring(0, 20)}...`);
        } else {
            console.error(`Falha ao transcrever mensagem ${msg.id} (erro já logado no service)`);
        }
    } catch (err) {
        console.error(`Erro inesperado no reprocessamento da mensagem ${msg.id}:`, err);
    }
  }
}

reprocessFailedTranscriptions().catch(console.error);
