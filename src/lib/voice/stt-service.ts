import { GoogleAuth } from "google-auth-library";
import fs from "fs";
import path from "path";

/**
 * Serviço de STT (Speech-to-Text) usando REST API da Google Cloud Speech
 * Transcreve áudio Mu-law 8kHz recebido das chamadas do Twilio
 */
export class SttService {
  private static instance: SttService;
  private auth: GoogleAuth | null = null;
  private isConfigured: boolean = false;

  private constructor() {
    this.init();
  }

  public static getInstance(): SttService {
    if (!SttService.instance) {
      SttService.instance = new SttService();
    }
    return SttService.instance;
  }

  private init() {
    try {
      let keyFilePath = process.env.VERTEX_KEY_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
      let credentialsObj: Record<string, any> | null = null;

      const rawEnvJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.VERTEX_SERVICE_ACCOUNT_JSON;
      if (rawEnvJson) {
        try { credentialsObj = JSON.parse(rawEnvJson); } catch {}
      }

      if (!credentialsObj && !keyFilePath) {
        const localKey = path.join(process.cwd(), "vertex-key.json");
        if (fs.existsSync(localKey)) keyFilePath = localKey;
      }

      const authOptions: any = {
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      };
      if (credentialsObj) authOptions.credentials = credentialsObj;
      else if (keyFilePath) authOptions.keyFilename = keyFilePath;

      this.auth = new GoogleAuth(authOptions);
      this.isConfigured = true;
    } catch (e: any) {
      console.warn("[SttService] Falha na inicialização do STT:", e?.message);
    }
  }

  /**
   * Transcreve áudio Mu-law 8kHz codificado em base64
   */
  public async transcribeAudioBuffer(base64Audio: string): Promise<string> {
    if (!this.auth) return "";

    try {
      const client = await this.auth.getClient();
      const tokenRes = await client.getAccessToken();
      const token = tokenRes.token;
      if (!token) return "";

      const url = "https://speech.googleapis.com/v1/speech:recognize";
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          config: {
            encoding: "MULAW",
            sampleRateHertz: 8000,
            languageCode: "pt-BR",
            enableAutomaticPunctuation: true,
          },
          audio: {
            content: base64Audio,
          },
        }),
      });

      if (!response.ok) {
        return "";
      }

      const data: any = await response.json();
      const transcription = data?.results?.[0]?.alternatives?.[0]?.transcript || "";
      return transcription.trim();
    } catch (err: any) {
      console.error("[SttService] Erro na transcrição de áudio:", err?.message || err);
      return "";
    }
  }
}

export const sttService = SttService.getInstance();
