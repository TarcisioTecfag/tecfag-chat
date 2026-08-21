import { mulawToWavBuffer } from "./audio-utils";
import { vertexAi } from "../vertex-ai";

/**
 * Serviço de STT (Speech-to-Text) via Google Vertex AI (Gemini Flash multimodal)
 * Transcreve áudio de telefonia em Português sem depender de provedores externos.
 * Substitui Groq Whisper — conforme regra AGENTS.md: provedor único = Vertex AI.
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
   * Transcreve áudio Mu-law 8kHz codificado em base64 via Vertex AI Gemini Flash
   */
  public async transcribeAudioBuffer(
    base64MulawAudio: string,
    tenantId = "valem"
  ): Promise<string> {
    try {
      // 1. Converte o áudio Mu-law 8kHz em arquivo WAV RIFF 16-bit 8kHz
      const rawMulawBuffer = Buffer.from(base64MulawAudio, "base64");
      const wavBuffer = mulawToWavBuffer(rawMulawBuffer);
      const base64Wav = wavBuffer.toString("base64");

      // 2. Monta prompt multimodal para o Gemini Flash
      const parts = [
        {
          inlineData: {
            mimeType: "audio/wav",
            data: base64Wav,
          },
        },
        {
          text: [
            "Transcreva o áudio a seguir para texto em Português Brasileiro.",
            "Retorne APENAS o texto transcrito, sem comentários, sem formatação adicional.",
            "Se o áudio estiver em silêncio, vazio ou inaudível, retorne exatamente: [SILENCIO]",
          ].join(" "),
        },
      ];

      const startTime = Date.now();
      const rawText = await vertexAi.generateText(
        parts,
        "gemini-2.5-flash",
        undefined,
        {
          feature: "call_transcription",
          tenantId,
        }
      );
      const elapsed = Date.now() - startTime;
      const cleanedText = rawText.trim();

      console.log(`[SttService Vertex] Transcrito em ${elapsed}ms: "${cleanedText}"`);

      // 3. Descarte transcrições de ruído / silêncio
      if (
        !cleanedText ||
        cleanedText === "[SILENCIO]" ||
        cleanedText.startsWith("[") ||
        cleanedText.startsWith("(") ||
        cleanedText.toLowerCase().includes("legendas") ||
        cleanedText.toLowerCase().includes("obrigado por assistir") ||
        cleanedText.length < 2
      ) {
        return "";
      }

      return cleanedText;
    } catch (err: any) {
      console.error("[SttService Vertex] Erro na transcrição de áudio:", err?.message || err);
      return "";
    }
  }
}

export const sttService = SttService.getInstance();
