import { VertexAI, GenerativeModel } from "@google-cloud/vertexai";
import fs from "fs";
import path from "path";

// ── Interface de Configuração do Vertex AI ──────────────────────────────────
export interface VertexConfig {
  projectId?: string;
  location?: string;
  keyFilePath?: string;
  credentialsJson?: Record<string, any>;
  defaultModel?: string;
}

class VertexAiService {
  private static instance: VertexAiService;
  private vertexAi: VertexAI | null = null;
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
   * Inicializa o cliente Vertex AI buscando credenciais do arquivo JSON ou variáveis de ambiente.
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
      const projectId = customConfig?.projectId || 
                        process.env.VERTEX_PROJECT_ID || 
                        credentialsObj?.project_id || 
                        "valem-chat";

      const location = customConfig?.location || process.env.VERTEX_LOCATION || "us-central1";
      this.defaultModelName = customConfig?.defaultModel || process.env.VERTEX_DEFAULT_MODEL || "gemini-2.5-pro";

      const authOptions: any = {};
      if (credentialsObj) {
        authOptions.credentials = credentialsObj;
      } else if (keyFilePath) {
        authOptions.keyFilename = keyFilePath;
      }

      this.vertexAi = new VertexAI({
        project: projectId,
        location,
        googleAuthOptions: authOptions,
      });

      this.isConfigured = true;
      this.configError = null;
      console.log(`[VertexAI] Inicializado com sucesso! Projeto: ${projectId} | Região: ${location} | Modelo padrão: ${this.defaultModelName}`);

    } catch (e: any) {
      this.isConfigured = false;
      this.configError = e.message || "Erro desconhecido ao inicializar Vertex AI.";
      console.warn(`[VertexAI] Falha na inicialização: ${this.configError}`);
    }
  }

  public isReady(): boolean {
    return this.isConfigured && this.vertexAi !== null;
  }

  public getError(): string | null {
    return this.configError;
  }

  /**
   * Retorna um GenerativeModel do Vertex AI para o modelo especificado (ex: 'gemini-2.5-pro', 'gemini-2.5-flash').
   */
  public getModel(modelName?: string): GenerativeModel | null {
    if (!this.vertexAi) {
      this.init(); // Tenta re-inicializar caso credenciais tenham sido adicionadas
      if (!this.vertexAi) return null;
    }

    const targetModel = modelName || this.defaultModelName;
    return this.vertexAi.getGenerativeModel({
      model: targetModel,
    });
  }

  /**
   * Executa uma geração de texto simples usando Gemini no Vertex AI.
   */
  public async generateText(prompt: string, modelName?: string): Promise<string | null> {
    const model = this.getModel(modelName);
    if (!model) {
      console.warn("[VertexAI] Modelo não disponível. Verifique o arquivo JSON de credenciais.");
      return null;
    }

    try {
      const resp = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const responseText = resp.response?.candidates?.[0]?.content?.parts?.[0]?.text;
      return responseText || null;
    } catch (e: any) {
      console.error("[VertexAI] Erro ao chamar generateContent:", e?.message || e);
      return null;
    }
  }

  /**
   * Gera uma resposta estruturada em JSON parseada garantida.
   */
  public async generateStructuredJson<T>(prompt: string, modelName?: string): Promise<T | null> {
    const jsonPrompt = `${prompt}\n\nREGRAS CRÍTICAS: Retorne EXCLUSIVAMENTE um objeto JSON válido. Não inclua blocos de markdown (\`\`\`json), nem texto explicativo antes ou depois.`;

    const rawText = await this.generateText(jsonPrompt, modelName);
    if (!rawText) return null;

    try {
      // Limpar potenciais marcadores markdown
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();

      return JSON.parse(cleaned) as T;
    } catch (e: any) {
      console.error("[VertexAI] Erro ao parsear JSON retornado pelo Gemini 2.5:", e?.message, rawText);
      return null;
    }
  }
}

export const vertexAi = VertexAiService.getInstance();
