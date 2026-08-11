import { vertexAi, MultimodalPart } from "../vertex-ai";
import { mulawToWavBuffer } from "./audio-utils";

/**
 * Serviço de STT (Speech-to-Text) usando Google Vertex AI (Gemini 2.5 Flash)
 * Transcreve áudio Mu-law 8kHz recebido das chamadas do Twilio convertendo para WAV RIFF 16-bit
 */
export class SttService {
  private static instance: SttService;

  private constructor() {}

  public static getInstance(): SttService {
    if (!SttService.instance) {
      SttService.instance = new SttService();
    }
    return SttService.instance;
  }

  /**
   * Transcreve áudio Mu-law 8kHz codificado em base64 via Vertex AI Gemini Multimodal
   */
  public async transcribeAudioBuffer(base64MulawAudio: string): Promise<string> {
    try {
      // 1. Converte o buffer de áudio Mu-law para arquivo WAV 16-bit 8kHz com cabeçalho RIFF
      const rawMulawBuffer = Buffer.from(base64MulawAudio, "base64");
      const wavBuffer = mulawToWavBuffer(rawMulawBuffer);
      const base64Wav = wavBuffer.toString("base64");

      // 2. Prepara o payload multimodal para o Vertex AI (Gemini 2.5 Flash)
      const parts: MultimodalPart[] = [
        {
          inlineData: {
            mimeType: "audio/wav",
            data: base64Wav,
          },
        },
        {
          text: `Transcreva exatamente o áudio recebido do cliente em português do Brasil.
Retorne APENAS a transcrição textual exata do que foi dito pelo cliente.
Se o áudio contiver apenas ruído, chiado ou nada compreensível, responda exatamente: NADA.`,
        },
      ];

      // 3. Chama o modelo Vertex AI Gemini 2.5 Flash (Regra Estrita: Provedor único de I.A. no projeto)
      const responseText = await vertexAi.generateText(parts, "gemini-2.5-flash", undefined, {
        tenantId: "valem",
        feature: "call_transcription",
      });

      const cleanedText = responseText ? responseText.trim() : "";
      if (!cleanedText || cleanedText.toUpperCase().includes("NADA") || cleanedText.length < 2) {
        return "";
      }

      return cleanedText;
    } catch (err: any) {
      console.error("[SttService VertexAI] Erro na transcrição de áudio via Gemini:", err?.message || err);
      return "";
    }
  }
}

export const sttService = SttService.getInstance();
