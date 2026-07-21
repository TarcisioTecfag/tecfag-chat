import { GoogleAuth } from "google-auth-library";
import fs from "fs";
import path from "path";

export interface VertexConfig {
  projectId?: string;
  location?: string;
  keyFilePath?: string;
  credentialsJson?: Record<string, any>;
  defaultModel?: string;
}

export type MultimodalPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

class VertexAiService {
  private static instance: VertexAiService;
  private auth: GoogleAuth | null = null;
  private projectId: string = "valem-chat";
  private location: string = "us-central1";
  private defaultModelName: string = "gemini-2.5-pro";
  private isConfigured: boolean = false;
  private configError: string | null = null;

  private constructor() {
    this.init();
  }

  public static getInstance(): VertexAiService {
    if (!VertexAiService.instance) {
      VertexAiService.instance = new VertexAiService();
    }
    return VertexAiService.instance;
  }

  /**
   * Inicializa a autenticação leve (pure JS) via google-auth-library
   */
  public init(customConfig?: VertexConfig): void {
    try {
      let keyFilePath = customConfig?.keyFilePath || process.env.VERTEX_KEY_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
      let credentialsObj: Record<string, any> | null = customConfig?.credentialsJson || null;

      // 1. Tentar ler string JSON crua do .env (VERTEX_SERVICE_ACCOUNT_JSON)
      if (!credentialsObj && process.env.VERTEX_SERVICE_ACCOUNT_JSON) {
        try {
          credentialsObj = JSON.parse(process.env.VERTEX_SERVICE_ACCOUNT_JSON);
        } catch (e) {
          console.warn("[VertexAI] Erro ao parsear VERTEX_SERVICE_ACCOUNT_JSON no env.");
        }
      }

      // 2. Se não houver objeto JSON, procurar por arquivo vertex-key.json no root do projeto
      if (!credentialsObj && !keyFilePath) {
        const defaultLocalKeyPath = path.join(process.cwd(), "vertex-key.json");
        if (fs.existsSync(defaultLocalKeyPath)) {
          keyFilePath = defaultLocalKeyPath;
        }
      }

      // 3. Carregar arquivo JSON se existir o caminho
      if (!credentialsObj && keyFilePath && fs.existsSync(keyFilePath)) {
        const rawContent = fs.readFileSync(keyFilePath, "utf8");
        credentialsObj = JSON.parse(rawContent);
      }

      // Extrair projectId
      this.projectId = customConfig?.projectId || 
                      process.env.VERTEX_PROJECT_ID || 
                      credentialsObj?.project_id || 
                      "project-d51e2a29-9246-4af9-b80";

      this.location = customConfig?.location || process.env.VERTEX_LOCATION || "us-central1";
      this.defaultModelName = customConfig?.defaultModel || process.env.VERTEX_DEFAULT_MODEL || "gemini-2.5-pro";

      const authOptions: any = {
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      };

      if (credentialsObj) {
        authOptions.credentials = credentialsObj;
      } else if (keyFilePath) {
        authOptions.keyFilename = keyFilePath;
      }

      this.auth = new GoogleAuth(authOptions);
      this.isConfigured = true;
      this.configError = null;
      console.log(`[VertexAI] Autenticação REST inicializada! Projeto: ${this.projectId} | Região: ${this.location} | Modelo padrão: ${this.defaultModelName}`);

    } catch (e: any) {
      this.isConfigured = false;
      this.configError = e.message || "Erro ao inicializar GoogleAuth.";
      console.warn(`[VertexAI] Falha na inicialização: ${this.configError}`);
    }
  }

  public isReady(): boolean {
    return this.isConfigured && this.auth !== null;
  }

  public getError(): string | null {
    return this.configError;
  }

  /**
   * Obtém token OAuth2 de acesso do Google Cloud
   */
  private async getAccessToken(): Promise<string | null> {
    if (!this.auth) {
      this.init();
      if (!this.auth) return null;
    }

    try {
      const client = await this.auth.getClient();
      const tokenRes = await client.getAccessToken();
      return tokenRes.token || null;
    } catch (e: any) {
      console.error("[VertexAI] Erro ao obter token de acesso OAuth2:", e?.message || e);
      return null;
    }
  }

  /**
   * Executa uma geração multimodal (texto, imagens, áudio) via REST API no Vertex AI (Gemini 2.5 Pro)
   * Suporta cancelamento por AbortSignal (Stop & Restart)
   */
  public async generateText(
    promptInput: string | MultimodalPart[],
    modelName?: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      console.warn("[VertexAI] Não foi possível obter token de acesso. Verifique credenciais.");
      return null;
    }

    const model = modelName || this.defaultModelName;
    const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:generateContent`;

    const parts: MultimodalPart[] = typeof promptInput === "string" ? [{ text: promptInput }] : promptInput;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            temperature: 0.2,
          },
        }),
        signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[VertexAI] Erro HTTP ${response.status} na API Vertex AI:`, errText);
        return null;
      }

      const data: any = await response.json();
      const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return responseText || null;

    } catch (e: any) {
      if (e.name === "AbortError" || signal?.aborted) {
        console.log("[VertexAI] Chamada cancelada via AbortSignal (Stop & Restart).");
        return null;
      }
      console.error("[VertexAI] Erro na chamada REST Vertex AI:", e?.message || e);
      return null;
    }
  }

  /**
   * Gera uma resposta estruturada em JSON parseada garantida.
   * Suporta partes multimodais e AbortSignal.
   */
  public async generateStructuredJson<T>(
    promptInput: string | MultimodalPart[],
    modelName?: string,
    signal?: AbortSignal
  ): Promise<T | null> {
    let parts: MultimodalPart[];
    const jsonInstruction = `\n\nREGRAS CRÍTICAS DE RETORNO: Retorne EXCLUSIVAMENTE um objeto JSON válido. Não inclua blocos de markdown (\`\`\`json), nem texto explicativo antes ou depois.`;

    if (typeof promptInput === "string") {
      parts = [{ text: promptInput + jsonInstruction }];
    } else {
      parts = [...promptInput, { text: jsonInstruction }];
    }

    const rawText = await this.generateText(parts, modelName, signal);
    if (!rawText) return null;

    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();

      return JSON.parse(cleaned) as T;
    } catch (e: any) {
      console.error("[VertexAI] Erro ao parsear JSON retornado pelo Gemini:", e?.message, rawText);
      return null;
    }
  }
}

export const vertexAi = VertexAiService.getInstance();
