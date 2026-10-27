import { GoogleAuth } from "google-auth-library";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { aiUsageLogs } from "../db/schema";
import crypto from "crypto";

const uuidv4 = () => crypto.randomUUID();

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

export interface VertexGenerationOptions {
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  systemInstruction?: string;
}

export interface VertexCallContext {
  tenantId?: string;
  feature?: string;
  metadata?: Record<string, any>;
  generationConfig?: VertexGenerationOptions;
}

export function calculateVertexCost(model: string, promptTokens: number, completionTokens: number): { usd: number; brl: number } {
  const normalized = (model || "").toLowerCase();
  const isFlash25 = normalized.includes("2.5-flash");
  const isFlash = normalized.includes("flash");

  // Preços oficiais por 1,000,000 tokens (USD) — Google Vertex AI
  // gemini-2.5-pro: $1.25 input / $10.00 output (ou $5.00 média ponderada <=200k)
  // gemini-2.5-flash: $0.15 input / $0.60 output
  // gemini-2.0-flash / gemini-1.5-flash: $0.075 input / $0.30 output
  const promptRatePer1M = isFlash25 ? 0.15 : isFlash ? 0.075 : 1.25;
  const completionRatePer1M = isFlash25 ? 0.60 : isFlash ? 0.30 : 5.00;

  const usdPrompt = (promptTokens / 1_000_000) * promptRatePer1M;
  const usdCompletion = (completionTokens / 1_000_000) * completionRatePer1M;
  const totalUsd = usdPrompt + usdCompletion;
  const usdToBrl = 5.60;

  return {
    usd: Number(totalUsd.toFixed(6)),
    brl: Number((totalUsd * usdToBrl).toFixed(6)),
  };
}

/**
 * Executa gravação assíncrona de telemetria no banco sem bloquear a requisição principal
 */
async function logAiUsage(data: {
  tenantId: string;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: "success" | "error";
  errorMessage?: string;
  metadata?: Record<string, any>;
}) {
  try {
    const cost = calculateVertexCost(data.model, data.promptTokens, data.completionTokens);
    await db.insert(aiUsageLogs).values({
      id: uuidv4(),
      tenantId: data.tenantId,
      feature: data.feature || "general",
      model: data.model,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      totalTokens: data.totalTokens,
      costUsd: cost.usd.toString(),
      costBrl: cost.brl.toString(),
      latencyMs: data.latencyMs,
      status: data.status,
      errorMessage: data.errorMessage,
      metadata: data.metadata || {},
    });
  } catch (e: any) {
    console.error("[VertexAI Log] Erro ao gravar log de uso no banco:", e?.message || e);
  }
}

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

      // 1. Tentar ler string JSON crua do .env (GOOGLE_SERVICE_ACCOUNT_JSON ou VERTEX_SERVICE_ACCOUNT_JSON)
      const rawEnvJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.VERTEX_SERVICE_ACCOUNT_JSON;
      if (!credentialsObj && rawEnvJson) {
        try {
          credentialsObj = JSON.parse(rawEnvJson);
        } catch (e) {
          console.warn("[VertexAI] Erro ao parsear GOOGLE_SERVICE_ACCOUNT_JSON / VERTEX_SERVICE_ACCOUNT_JSON no env.");
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
   * Suporta cancelamento por AbortSignal (Stop & Restart) e telemetria de uso
   */
  public async generateText(
    promptInput: string | MultimodalPart[],
    modelName?: string,
    signal?: AbortSignal,
    context?: VertexCallContext
  ): Promise<string | null> {
    const startTime = Date.now();
    const accessToken = await this.getAccessToken();
    const model = modelName || this.defaultModelName;
    const tenantId = context?.tenantId;
    if (!tenantId) {
      throw new Error("[VertexAI] Violação arquitetural de isolamento: tenantId é estritamente obrigatório em todas as chamadas Vertex AI (AGENTS.md).");
    }
    const feature = context?.feature || "general";

    if (!accessToken) {
      console.warn("[VertexAI] Não foi possível obter token de acesso. Verifique credenciais.");
      logAiUsage({
        tenantId,
        feature,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: Date.now() - startTime,
        status: "error",
        errorMessage: "Credenciais do Vertex AI não configuradas.",
        metadata: context?.metadata,
      });
      return null;
    }

    const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:generateContent`;
    const parts: MultimodalPart[] = typeof promptInput === "string" ? [{ text: promptInput }] : promptInput;

    const genCfg: Record<string, any> = {
      temperature: context?.generationConfig?.temperature ?? 0.2,
      maxOutputTokens: context?.generationConfig?.maxOutputTokens ?? 8192,
    };

    if (
      typeof context?.generationConfig?.thinkingBudget === "number" &&
      model.toLowerCase().includes("gemini-2.5")
    ) {
      genCfg.thinkingConfig = {
        thinkingBudget: context.generationConfig.thinkingBudget,
      };
    }

    const requestBody: Record<string, any> = {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: genCfg,
    };

    if (context?.generationConfig?.systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: context.generationConfig.systemInstruction }],
      };
    }

    try {
      let response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      // Fallback transparente caso algum modelo/região não aceite thinkingConfig
      if (!response.ok && response.status === 400 && genCfg.thinkingConfig) {
        const fallbackGenCfg = { ...genCfg };
        delete fallbackGenCfg.thinkingConfig;
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...requestBody,
            generationConfig: fallbackGenCfg,
          }),
          signal,
        });
      }

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[VertexAI] Erro HTTP ${response.status} na API Vertex AI:`, errText);
        logAiUsage({
          tenantId,
          feature,
          model,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs,
          status: "error",
          errorMessage: `Erro HTTP ${response.status}: ${errText.slice(0, 200)}`,
          metadata: context?.metadata,
        });
        return null;
      }

      const data: any = await response.json();
      const candidateParts: any[] = data?.candidates?.[0]?.content?.parts || [];
      const nonThoughtText = candidateParts
        .filter((p: any) => !p?.thought && typeof p?.text === "string")
        .map((p: any) => p.text)
        .join("");
      const responseText = nonThoughtText || candidateParts[0]?.text;
      
      // Extrair uso de tokens real da resposta do Vertex AI (incluindo thinking tokens do Gemini 2.5)
      const usage = data?.usageMetadata || {};
      const promptTokens = usage?.promptTokenCount || 0;
      const thoughtsTokens = usage?.thoughtsTokenCount || 0;
      const completionTokens = (usage?.candidatesTokenCount || 0) + thoughtsTokens;
      const totalTokens = usage?.totalTokenCount || (promptTokens + completionTokens);

      logAiUsage({
        tenantId,
        feature,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        latencyMs,
        status: "success",
        metadata: {
          ...(context?.metadata || {}),
          ...(thoughtsTokens > 0 ? { thoughtsTokens } : {}),
        },
      });

      return responseText || null;

    } catch (e: any) {
      const latencyMs = Date.now() - startTime;
      if (e.name === "AbortError" || signal?.aborted) {
        console.log("[VertexAI] Chamada cancelada via AbortSignal (Stop & Restart).");
        return null;
      }
      console.error("[VertexAI] Erro na chamada REST Vertex AI:", e?.message || e);
      logAiUsage({
        tenantId,
        feature,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs,
        status: "error",
        errorMessage: e?.message || String(e),
        metadata: context?.metadata,
      });
      return null;
    }
  }

  /**
   * Streaming de geração de texto via streamGenerateContent (SSE).
   * Yields chunks de texto conforme chegam, permitindo pipeline de latência baixa,
   * e registra telemetria de uso em aiUsageLogs ao concluir.
   */
  public async *generateTextStream(
    promptInput: string | MultimodalPart[],
    modelName?: string,
    signal?: AbortSignal,
    context?: VertexCallContext
  ): AsyncGenerator<string, void, unknown> {
    const startTime = Date.now();
    const tenantId = context?.tenantId;
    if (!tenantId) {
      throw new Error("[VertexAI Stream] Violação arquitetural de isolamento: tenantId é estritamente obrigatório em todas as chamadas Vertex AI (AGENTS.md).");
    }
    const feature = context?.feature || "general";
    const model = modelName || this.defaultModelName;

    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      logAiUsage({
        tenantId,
        feature,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: Date.now() - startTime,
        status: "error",
        errorMessage: "[VertexAI Stream] Sem token de acesso",
        metadata: context?.metadata,
      });
      throw new Error("[VertexAI Stream] Sem token de acesso");
    }

    const url =
      `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}` +
      `/locations/${this.location}/publishers/google/models/${model}:streamGenerateContent?alt=sse`;

    const parts: MultimodalPart[] =
      typeof promptInput === "string" ? [{ text: promptInput }] : promptInput;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 80,
        },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      logAiUsage({
        tenantId,
        feature,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: Date.now() - startTime,
        status: "error",
        errorMessage: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
        metadata: context?.metadata,
      });
      throw new Error(`[VertexAI Stream] HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    if (!response.body) throw new Error("[VertexAI Stream] Sem body na resposta");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let streamedChars = 0;

    const captureUsageFromChunk = (json: any) => {
      const usage = json?.usageMetadata;
      if (!usage) return;
      if (typeof usage.promptTokenCount === "number") promptTokens = usage.promptTokenCount;
      const cand = typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0;
      const thoughts = typeof usage.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : 0;
      if (cand + thoughts > 0) completionTokens = cand + thoughts;
      if (typeof usage.totalTokenCount === "number") totalTokens = usage.totalTokenCount;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });

        // Processa linhas SSE conforme chegam
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);

          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          if (jsonStr === "[DONE]") return;

          try {
            const json = JSON.parse(jsonStr);
            captureUsageFromChunk(json);
            const text: string =
              json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (text) {
              streamedChars += text.length;
              yield text;
            }
          } catch {
            // chunk JSON inválido — ignorar
          }
        }
      }

      // Processa sobra do buffer
      if (buf.trim().startsWith("data: ")) {
        const jsonStr = buf.slice(buf.indexOf("data: ") + 6).trim();
        if (jsonStr && jsonStr !== "[DONE]") {
          try {
            const json = JSON.parse(jsonStr);
            captureUsageFromChunk(json);
            const text: string =
              json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (text) {
              streamedChars += text.length;
              yield text;
            }
          } catch {}
        }
      }
    } finally {
      reader.releaseLock();
      // Fallback de estimativa caso o stream tenha encerrado antes do chunk final de usageMetadata
      if (promptTokens === 0 && typeof promptInput === "string") {
        promptTokens = Math.max(1, Math.ceil(promptInput.length / 4));
      }
      if (completionTokens === 0 && streamedChars > 0) {
        completionTokens = Math.max(1, Math.ceil(streamedChars / 4));
      }
      if (totalTokens === 0) {
        totalTokens = promptTokens + completionTokens;
      }
      if (!signal?.aborted) {
        logAiUsage({
          tenantId,
          feature,
          model,
          promptTokens,
          completionTokens,
          totalTokens,
          latencyMs: Date.now() - startTime,
          status: "success",
          metadata: { ...(context?.metadata || {}), streaming: true },
        });
      }
    }
  }

  /**
   * Gera uma resposta estruturada em JSON parseada garantida.
   * Suporta partes multimodais, AbortSignal e contexto de telemetria.
   */
  public async generateStructuredJson<T>(
    promptInput: string | MultimodalPart[],
    modelName?: string,
    signal?: AbortSignal,
    context?: VertexCallContext
  ): Promise<T | null> {
    let parts: MultimodalPart[];
    const jsonInstruction = `\n\nREGRAS CRÍTICAS DE RETORNO: Retorne EXCLUSIVAMENTE um objeto JSON válido. Não inclua blocos de markdown (\`\`\`json), nem texto explicativo antes ou depois.`;

    if (typeof promptInput === "string") {
      parts = [{ text: promptInput + jsonInstruction }];
    } else {
      parts = [...promptInput, { text: jsonInstruction }];
    }

    const rawText = await this.generateText(parts, modelName, signal, context);
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
