import { mulawToWavBuffer } from "./audio-utils";

/**
 * Serviço de STT (Speech-to-Text) usando Groq Whisper (whisper-large-v3-turbo)
 * Transcreve áudio de telefonia em tempo ultrarrápido (~40ms) com altíssima precisão em Português
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
   * Transcreve áudio Mu-law 8kHz codificado em base64 via Groq Whisper API
   */
  public async transcribeAudioBuffer(base64MulawAudio: string): Promise<string> {
    try {
      const apiKey = process.env.GROQ_API_KEY || "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";

      // 1. Converte o áudio Mu-law 8kHz em arquivo WAV RIFF 16-bit 8kHz
      const rawMulawBuffer = Buffer.from(base64MulawAudio, "base64");
      const wavBuffer = mulawToWavBuffer(rawMulawBuffer);

      // 2. Prepara multipart/form-data para a API do Groq Whisper
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" });
      formData.append("file", blob, "speech.wav");
      formData.append("model", "whisper-large-v3-turbo");
      formData.append("language", "pt");
      formData.append("response_format", "json");

      const startTime = Date.now();
      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      const elapsed = Date.now() - startTime;

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`[SttService Groq] Erro HTTP ${res.status}: ${errText}`);
        return "";
      }

      const data: any = await res.json();
      const rawText = data?.text || "";
      const cleanedText = rawText.trim();

      console.log(`[SttService Groq] Transcrito em ${elapsed}ms: "${cleanedText}"`);

      // Descarte transcrições de ruído típico do Whisper (ex: "[Música]", "(silêncio)", "Legendas")
      if (
        !cleanedText ||
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
      console.error("[SttService Groq] Erro na transcrição de áudio:", err?.message || err);
      return "";
    }
  }
}

export const sttService = SttService.getInstance();
