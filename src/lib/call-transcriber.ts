/**
 * call-transcriber.ts
 * Envia áudio gravado para a API Groq Whisper e retorna transcrição em PT-BR.
 * Modelo: whisper-large-v3 (gratuito: 2.000 req/dia)
 */

import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Transcreve um buffer de áudio usando Groq Whisper.
 * @param audioBuffer Buffer do arquivo de áudio (webm/opus ou mp4/aac)
 * @param filename Nome do arquivo (extensão determina o codec)
 * @returns Texto da transcrição ou null em caso de erro
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string = "recording.webm"
): Promise<string | null> {
  try {
    console.log(`[Transcriber] Iniciando transcrição — ${(audioBuffer.length / 1024).toFixed(0)} KB`);

    // Groq aceita File-like objects — converter Buffer para Uint8Array
    const audioFile = new File([new Uint8Array(audioBuffer)], filename, {
      type: filename.endsWith(".webm") ? "audio/webm" : "audio/mp4",
    });

    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3",
      language: "pt",          // Força Português do Brasil
      response_format: "text", // Retorna texto simples (mais rápido)
    });

    const text = typeof transcription === "string" ? transcription : (transcription as any).text ?? "";
    console.log(`[Transcriber] Transcrição concluída: ${text.substring(0, 80)}...`);
    return text.trim() || null;
  } catch (err: any) {
    console.error("[Transcriber] Erro ao transcrever:", err?.message ?? err);
    return null;
  }
}

/**
 * Formata a transcrição bruta como nota interna para o chat.
 * @param rawText Texto puro retornado pelo Whisper
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

  return `📞 *Ligação encerrada* • ${duration}\n\n*Agente:* ${agentName}\n\n*Transcrição automática (Groq Whisper):*\n${rawText}`;
}
