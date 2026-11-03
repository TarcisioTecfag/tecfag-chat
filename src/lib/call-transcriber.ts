/**
 * call-transcriber.ts
 * Transcreve áudios de ligações WebRTC e mensagens de voz do WhatsApp (inbound e outbound)
 * usando Google Vertex AI (Gemini Multimodal).
 * Registra o consumo de tokens e repassa o custo para o painel de custos na funcionalidade 'call_transcription'.
 */
import { vertexAi, MultimodalPart } from "./vertex-ai";
import { db } from "../db";
import { messages } from "../db/schema";
import { and, eq } from "drizzle-orm";

const inFlightTranscriptions = new Map<string, Promise<string | null>>();

/**
 * Normaliza o MIME type de áudio para um formato base aceito pelo Vertex AI Gemini Multimodal.
 */
export function resolveAudioMimeType(mimeType?: string | null, filename?: string | null): string {
  const baseMime = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (baseMime.startsWith("audio/")) {
    if (baseMime === "audio/ogg" || baseMime === "audio/opus" || baseMime === "audio/oga") return "audio/ogg";
    if (baseMime === "audio/webm") return "audio/webm";
    if (baseMime === "audio/mp3" || baseMime === "audio/mpeg") return "audio/mp3";
    if (baseMime === "audio/wav" || baseMime === "audio/x-wav" || baseMime === "audio/wave") return "audio/wav";
    if (baseMime === "audio/aac" || baseMime === "audio/x-aac") return "audio/aac";
    if (baseMime === "audio/amr" || baseMime === "audio/3gpp") return "audio/amr";
    if (baseMime === "audio/mp4" || baseMime === "audio/x-m4a" || baseMime === "audio/m4a") return "audio/mp4";
    return baseMime;
  }

  const ext = (filename || "").split(".").pop()?.toLowerCase() || "";
  if (ext === "ogg" || ext === "oga" || ext === "opus") return "audio/ogg";
  if (ext === "webm") return "audio/webm";
  if (ext === "mp3" || ext === "mpeg") return "audio/mp3";
  if (ext === "wav") return "audio/wav";
  if (ext === "aac") return "audio/aac";
  if (ext === "amr") return "audio/amr";
  return "audio/ogg";
}

/**
 * Transcreve um buffer de áudio usando Vertex AI Gemini.
 * @param audioBuffer Buffer do arquivo de áudio
 * @param filename Nome do arquivo (extensão determina o mimeType de fallback)
 * @param tenantId Tenant proprietário
 * @param mimeType MIME type opcional do arquivo
 * @param metadata Metadados adicionais para auditoria de custos
 * @returns Texto da transcrição ou null em caso de erro
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string = "recording.webm",
  tenantId: string,
  mimeType?: string | null,
  metadata?: Record<string, any>,
): Promise<string | null> {
  try {
    if (!audioBuffer || audioBuffer.length === 0) return null;
    console.log(`[Transcriber VertexAI] Iniciando transcrição — ${(audioBuffer.length / 1024).toFixed(1)} KB`);

    if (!vertexAi.isReady()) {
      console.warn("[Transcriber VertexAI] Serviço Vertex AI não está configurado.");
      return null;
    }

    const resolvedMime = resolveAudioMimeType(mimeType, filename);
    const base64Data = audioBuffer.toString("base64");

    const multimodalParts: MultimodalPart[] = [
      {
        inlineData: {
          mimeType: resolvedMime,
          data: base64Data,
        },
      },
      {
        text: `Transcreva de forma exata e fiel a gravação de áudio em Português do Brasil. Retorne EXCLUSIVAMENTE o texto transcrito, sem introduções, sem aspas e sem explicações. Se o áudio estiver em silêncio ou sem fala compreensível, retorne apenas: [Áudio sem fala identificável]`,
      },
    ];

    let transcription = await vertexAi.generateText(
      multimodalParts,
      "gemini-2.5-flash",
      undefined,
      {
        tenantId,
        feature: "call_transcription",
        thinkingBudget: 0,
        temperature: 0.1,
        metadata: {
          filename,
          mimeType: resolvedMime,
          sizeKb: (audioBuffer.length / 1024).toFixed(1),
          ...(metadata || {}),
        },
      },
    );

    if (!transcription) {
      transcription = await vertexAi.generateText(
        multimodalParts,
        "gemini-2.5-pro",
        undefined,
        {
          tenantId,
          feature: "call_transcription",
          metadata: {
            filename,
            mimeType: resolvedMime,
            sizeKb: (audioBuffer.length / 1024).toFixed(1),
            fallbackModel: true,
            ...(metadata || {}),
          },
        },
      );
    }

    if (!transcription) return null;

    const cleaned = transcription.trim().replace(/^["“”]+|["“”]+$/g, "").trim();
    console.log(`[Transcriber VertexAI] Transcrição concluída: ${cleaned.substring(0, 80)}...`);
    return cleaned || null;
  } catch (err: any) {
    console.error("[Transcriber VertexAI] Erro ao transcrever áudio:", err?.message ?? err);
    return null;
  }
}

/**
 * Transcreve automaticamente uma mensagem de áudio do chat (enviada pelo cliente ou pelo operador),
 * persiste em `messages.mediaInterpretation` (para uso imediato pelo operador e pelas IAs de análise)
 * e emite evento SSE em tempo real (`message_transcription`).
 */
export async function transcribeAndPersistMessageAudio(params: {
  tenantId: string;
  messageId: string;
  conversationId: string;
  audioBuffer: Buffer;
  mimeType?: string | null;
  fileName?: string | null;
}): Promise<string | null> {
  const { tenantId, messageId, conversationId, audioBuffer, mimeType, fileName } = params;
  if (!tenantId || !messageId || !audioBuffer || audioBuffer.length === 0) return null;

  const lockKey = `${tenantId}:${messageId}`;
  const existingPromise = inFlightTranscriptions.get(lockKey);
  if (existingPromise) return existingPromise;

  const task = (async (): Promise<string | null> => {
    try {
      // 1. Verificar se já possui transcrição salva no banco (evita retrabalho e custo duplicado)
      const [existingMsg] = await db
        .select({ mediaInterpretation: messages.mediaInterpretation })
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)))
        .limit(1);

      if (existingMsg?.mediaInterpretation && existingMsg.mediaInterpretation.trim().length > 0) {
        return existingMsg.mediaInterpretation.trim();
      }

      // 2. Transcrever via Vertex AI
      const transcription = await transcribeAudio(
        audioBuffer,
        fileName || `${messageId}.ogg`,
        tenantId,
        mimeType,
        { messageId, conversationId, source: "chat_audio" },
      );

      if (!transcription) return null;

      // 3. Persistir em messages.mediaInterpretation (isolado por tenantId)
      await db
        .update(messages)
        .set({
          mediaInterpretation: transcription,
          updatedAt: new Date(),
        })
        .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)));

      // 4. Notificar operadores conectados via SSE para atualização instantânea na tela
      try {
        const { SessionManager } = await import("./baileys/session-manager");
        SessionManager.getInstance().notifyPublic(tenantId, {
          type: "message_transcription",
          conversationId,
          messageId,
          mediaInterpretation: transcription,
        });
      } catch (notifyErr: any) {
        console.warn("[Transcriber VertexAI] Falha ao emitir evento SSE de transcrição:", notifyErr?.message);
      }

      return transcription;
    } catch (err: any) {
      console.error(`[Transcriber VertexAI] Erro ao persistir transcrição da mensagem ${messageId}:`, err?.message ?? err);
      return null;
    } finally {
      inFlightTranscriptions.delete(lockKey);
    }
  })();

  inFlightTranscriptions.set(lockKey, task);
  return task;
}

/**
 * Formata a transcrição bruta como nota interna para o chat.
 * @param rawText Texto puro retornado pelo Gemini Vertex AI
 * @param agentName Nome do agente que iniciou a chamada
 * @param durationSeconds Duração em segundos
 * @returns Texto formatado para inserção como nota interna
 */
export function formatCallNote(
  rawText: string,
  agentName: string,
  durationSeconds: number
): string {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const duration = `${minutes}min ${seconds}s`;

  return `📞 *Ligação encerrada* • ${duration}\n\n*Agente:* ${agentName}\n\n*Transcrição automática (Vertex AI Gemini):*\n${rawText}`;
}
