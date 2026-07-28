/**
 * call-transcriber.ts
 * Transcreve áudio gravado em ligações WebRTC usando Google Vertex AI (Gemini 2.5 Pro Multimodal).
 * Registra o consumo de tokens e repassa o custo para o painel de custos na funcionalidade 'call_transcription'.
 */
import { vertexAi, MultimodalPart } from "./vertex-ai";

/**
 * Transcreve um buffer de áudio usando Vertex AI Gemini 2.5 Pro.
 * @param audioBuffer Buffer do arquivo de áudio (webm/opus ou mp4/aac/mp3/wav)
 * @param filename Nome do arquivo (extensão determina o mimeType)
 * @param tenantId Tenant proprietário da chamada
 * @returns Texto da transcrição ou null em caso de erro
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string = "recording.webm",
  tenantId: string = "valem"
): Promise<string | null> {
  try {
    console.log(`[Transcriber VertexAI] Iniciando transcrição — ${(audioBuffer.length / 1024).toFixed(0)} KB`);

    if (!vertexAi.isReady()) {
      console.warn("[Transcriber VertexAI] Serviço Vertex AI não está configurado.");
      return null;
    }

    const mimeType = filename.endsWith(".webm")
      ? "audio/webm"
      : filename.endsWith(".mp3")
      ? "audio/mp3"
      : filename.endsWith(".wav")
      ? "audio/wav"
      : "audio/mp4";

    const base64Data = audioBuffer.toString("base64");

    const multimodalParts: MultimodalPart[] = [
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
      {
        text: `Transcreva de forma exata e fiel a gravação de áudio em Português do Brasil. Retorne EXCLUSIVAMENTE o texto transcrito, sem introduções, aspas ou explicações.`,
      },
    ];

    const transcription = await vertexAi.generateText(
      multimodalParts,
      "gemini-2.5-pro",
      undefined,
      {
        tenantId,
        feature: "call_transcription",
        metadata: { filename, sizeKb: (audioBuffer.length / 1024).toFixed(0) },
      }
    );

    if (!transcription) return null;

    const cleaned = transcription.trim();
    console.log(`[Transcriber VertexAI] Transcrição concluída: ${cleaned.substring(0, 80)}...`);
    return cleaned || null;
  } catch (err: any) {
    console.error("[Transcriber VertexAI] Erro ao transcrever áudio:", err?.message ?? err);
    return null;
  }
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
