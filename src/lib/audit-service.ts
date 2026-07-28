/**
 * Audit Service — Pipeline de Auditoria de Atendimentos por IA
 *
 * Singleton que roda um job a cada 5 minutos processando até 3 auditorias
 * pendentes por ciclo (rate limiting manual para não explodir a cota da API).
 *
 * Fluxo por auditoria:
 *   1. Busca conversa finalizada com status='pending' em ai_conversation_audits
 *   2. Coleta toda a transcrição de mensagens da conversa
 *   3. Coleta métricas de SLA da conversa (gaps de resposta)
 *   4. Monta prompt com playbook + transcrição + métricas
 *   5. Chama Gemini Flash e parseia o JSON retornado
 *   6. Salva resultado em ai_conversation_audits
 *   7. Atualiza operator_daily_metrics do operador auditado
 */

import { db } from "../db";
import {
  aiConversationAudits,
  messages,
  conversations,
  contacts,
  operators,
  responseTimeLogs,
  operatorDailyMetrics,
} from "../db/schema";
import { eq, and, desc, isNotNull, avg, sql } from "drizzle-orm";
import { VALEM_PLAYBOOK, AUDIT_JSON_SCHEMA } from "./audit-playbook";

// ── Tipos internos ────────────────────────────────────────────────────────────
type AuditResult = {
  performanceScore: number;
  clientSentiment: "satisfeito" | "neutro" | "frustrado";
  hadLongResponseGap: boolean;
  hadMissedObjection: boolean;
  hadRudeLanguage: boolean;
  hadNoFollowUp: boolean;
  summary: string;
  strengths: string;
  weaknesses: string;
  actionableInsight: string;
};

// ── Serviço principal ─────────────────────────────────────────────────────────
export class AuditService {
  private static instance: AuditService;
  private jobInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private isProcessing = false;

  private constructor() {
    // Usa o vertexAi singleton (vertex-ai.ts) — sem necessidade de SDK externo
    console.log("[AuditService] Inicializado. Usará Vertex AI para auditorias.");
  }

  static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  /** Inicia o job de auditoria. Idempotente. */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("[AuditService] Iniciando job de auditoria (intervalo: 5min)...");

    // Roda imediatamente na inicialização
    this.runAuditBatch().catch((e) =>
      console.error("[AuditService] Erro no batch inicial:", e)
    );

    // Depois a cada 5 minutos
    this.jobInterval = setInterval(() => {
      this.runAuditBatch().catch((e) =>
        console.error("[AuditService] Erro no batch periódico:", e)
      );
    }, 5 * 60 * 1000);

    console.log("[AuditService] ✓ Job iniciado.");
  }

  stop() {
    if (this.jobInterval) clearInterval(this.jobInterval);
    this.isRunning = false;
  }

  /**
   * Processa até 3 auditorias pendentes por ciclo.
   * Evita processamento paralelo com o flag isProcessing.
   */
  private async runAuditBatch() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const pending = await db
        .select()
        .from(aiConversationAudits)
        .where(eq(aiConversationAudits.status, "pending"))
        .orderBy(aiConversationAudits.createdAt)
        .limit(3);

      if (pending.length === 0) {
        this.isProcessing = false;
        return;
      }

      console.log(`[AuditService] Processando ${pending.length} auditoria(s)...`);

      for (const audit of pending) {
        await this.processAudit(audit.id, audit.conversationId, audit.tenantId, audit.operatorId);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Processa uma auditoria individual do início ao fim.
   */
  private async processAudit(
    auditId: string,
    conversationId: string,
    tenantId: string,
    operatorId: string | null
  ) {
    // Marca como em processamento para não ser pego novamente
    await db
      .update(aiConversationAudits)
      .set({ status: "processing" })
      .where(eq(aiConversationAudits.id, auditId));

    try {
      // 1. Coleta a transcrição completa
      const msgs = await db
        .select({
          senderType: messages.senderType,
          senderName: messages.senderName,
          content: messages.content,
          sentAt: messages.sentAt,
          isInternalNote: messages.isInternalNote,
        })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.sentAt);

      // Filtra apenas mensagens visíveis (sem notas internas)
      const visibleMsgs = msgs.filter((m) => !m.isInternalNote);

      if (visibleMsgs.length < 3) {
        // Transcrição muito curta — não vale auditar
        await db
          .update(aiConversationAudits)
          .set({
            status: "error",
            errorMessage: "Transcrição muito curta para auditoria (menos de 3 mensagens visíveis).",
          })
          .where(eq(aiConversationAudits.id, auditId));
        return;
      }

      // 2. Coleta métricas de SLA da conversa
      const slaLogs = await db
        .select({
          responseTimeSeconds: responseTimeLogs.responseTimeSeconds,
          isOverdue: responseTimeLogs.isOverdue,
        })
        .from(responseTimeLogs)
        .where(
          and(
            eq(responseTimeLogs.conversationId, conversationId),
            isNotNull(responseTimeLogs.responseTimeSeconds)
          )
        );

      const avgResponseSec = slaLogs.length > 0
        ? Math.floor(slaLogs.reduce((s, l) => s + (l.responseTimeSeconds ?? 0), 0) / slaLogs.length)
        : null;
      const overdueCount = slaLogs.filter((l) => l.isOverdue).length;
      const maxResponseSec = slaLogs.length > 0
        ? Math.max(...slaLogs.map((l) => l.responseTimeSeconds ?? 0))
        : null;

      // 3. Monta a transcrição formatada
      const transcript = visibleMsgs
        .map((m) => {
          const role = m.senderType === "client" ? "CLIENTE" : "OPERADOR";
          const time = new Date(m.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          return `[${time}] ${role} (${m.senderName}): ${m.content}`;
        })
        .join("\n");

      // 4. Monta as métricas de SLA
      const slaContext = avgResponseSec !== null
        ? `Tempo médio de resposta do operador: ${Math.floor(avgResponseSec / 60)}min ${avgResponseSec % 60}s. ` +
          `Pior tempo: ${maxResponseSec ? `${Math.floor(maxResponseSec / 60)}min ${maxResponseSec % 60}s` : "N/A"}. ` +
          `Respostas atrasadas (> 15min): ${overdueCount}.`
        : "Dados de tempo de resposta não disponíveis para este atendimento.";

      // 5. Monta o prompt completo
      const prompt = buildAuditPrompt(transcript, slaContext);

      // 6. Chama o Gemini
      const result = await this.callGemini(prompt);
      if (!result) throw new Error("Gemini retornou resposta vazia ou inválida.");

      // 7. Salva o resultado
      await db
        .update(aiConversationAudits)
        .set({
          status: "done",
          performanceScore: result.performanceScore,
          clientSentiment: result.clientSentiment,
          hadLongResponseGap: result.hadLongResponseGap || overdueCount > 0,
          hadMissedObjection: result.hadMissedObjection,
          hadRudeLanguage: result.hadRudeLanguage,
          hadNoFollowUp: result.hadNoFollowUp,
          summary: result.summary,
          strengths: result.strengths,
          weaknesses: result.weaknesses,
          actionableInsight: result.actionableInsight,
          rawAiResponse: result as any,
          auditedAt: new Date(),
        })
        .where(eq(aiConversationAudits.id, auditId));

      console.log(
        `[AuditService] ✓ Auditoria ${auditId} concluída — Score: ${result.performanceScore}/100`
      );

      // 8. Atualiza métricas diárias do operador
      if (operatorId) {
        await this.updateOperatorAuditMetrics(tenantId, operatorId, result);
      }
    } catch (e: any) {
      console.error(`[AuditService] Erro ao processar auditoria ${auditId}:`, e.message);
      await db
        .update(aiConversationAudits)
        .set({
          status: "error",
          errorMessage: e.message?.slice(0, 500) ?? "Erro desconhecido",
        })
        .where(eq(aiConversationAudits.id, auditId));
    }
  }

  /**
   * Chama o Gemini 2.5 Pro via Vertex AI com suporte a JSON estruturado.
   */
  private async callGemini(prompt: string, attempt = 1): Promise<AuditResult | null> {
    try {
      const { vertexAi } = await import("./vertex-ai");
      const parsed = await vertexAi.generateStructuredJson<AuditResult>(prompt, "gemini-2.5-pro", undefined, {
        feature: "conversation_audit",
      });
      if (!parsed) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 3000));
          return this.callGemini(prompt, attempt + 1);
        }
        return null;
      }

      // Valida e sanitiza campos obrigatórios
      if (typeof parsed.performanceScore === "number") {
        parsed.performanceScore = Math.max(0, Math.min(100, parsed.performanceScore));
      } else {
        parsed.performanceScore = 70;
      }

      if (!parsed.clientSentiment) {
        parsed.clientSentiment = "neutro";
      }

      return parsed;
    } catch (e: any) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 3000));
        return this.callGemini(prompt, attempt + 1);
      }
      throw e;
    }
  }

  /**
   * Atualiza o score médio e contadores de sentimento do operador.
   * Chamado após cada auditoria concluída com sucesso.
   */
  private async updateOperatorAuditMetrics(
    tenantId: string,
    operatorId: string,
    result: AuditResult
  ) {
    const today = new Date().toISOString().split("T")[0];

    const existing = await db
      .select()
      .from(operatorDailyMetrics)
      .where(
        and(
          eq(operatorDailyMetrics.tenantId, tenantId),
          eq(operatorDailyMetrics.operatorId, operatorId),
          eq(operatorDailyMetrics.date, today)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const m = existing[0];
      const prevScore = m.avgPerformanceScore ?? 0;
      const auditedCount = m.totalConversations > 0 ? m.totalConversations : 1;
      const newAvgScore = Math.floor(
        (prevScore * (auditedCount - 1) + result.performanceScore) / auditedCount
      );

      await db
        .update(operatorDailyMetrics)
        .set({
          avgPerformanceScore: newAvgScore,
          satisfiedCount: m.satisfiedCount + (result.clientSentiment === "satisfeito" ? 1 : 0),
          neutralCount: m.neutralCount + (result.clientSentiment === "neutro" ? 1 : 0),
          frustratedCount: m.frustratedCount + (result.clientSentiment === "frustrado" ? 1 : 0),
          updatedAt: new Date(),
        })
        .where(eq(operatorDailyMetrics.id, existing[0].id));
    } else {
      const op = await db
        .select({ name: operators.name })
        .from(operators)
        .where(eq(operators.id, operatorId))
        .limit(1);

      await db.insert(operatorDailyMetrics).values({
        id: `odm-${tenantId}-${operatorId}-${today}`,
        tenantId,
        operatorId,
        operatorName: op[0]?.name ?? "Desconhecido",
        date: today,
        totalConversations: 1,
        avgPerformanceScore: result.performanceScore,
        satisfiedCount: result.clientSentiment === "satisfeito" ? 1 : 0,
        neutralCount: result.clientSentiment === "neutro" ? 1 : 0,
        frustratedCount: result.clientSentiment === "frustrado" ? 1 : 0,
        overdueCount: 0,
        updatedAt: new Date(),
      });
    }
  }

  /**
   * API pública: enfileira uma conversa finalizada para auditoria.
   * Chamado externamente quando uma conversa é movida para 'finalizados'.
   */
  async enqueueAudit(params: {
    tenantId: string;
    conversationId: string;
    operatorId: string | null;
    contactName: string | null;
  }) {
    // Verifica se já existe uma auditoria para essa conversa
    const existing = await db
      .select({ id: aiConversationAudits.id })
      .from(aiConversationAudits)
      .where(eq(aiConversationAudits.conversationId, params.conversationId))
      .limit(1);

    if (existing.length > 0) return; // Já enfileirada — ignora

    await db.insert(aiConversationAudits).values({
      id: `audit-${params.conversationId}-${Date.now()}`,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      operatorId: params.operatorId,
      contactName: params.contactName,
      status: "pending",
      createdAt: new Date(),
    });

    console.log(`[AuditService] Auditoria enfileirada para conversa ${params.conversationId}`);
  }
}

// ── Prompt Builder ────────────────────────────────────────────────────────────
function buildAuditPrompt(transcript: string, slaContext: string): string {
  return `Você é um auditor especialista em atendimento comercial e vendas B2B.
Sua função é analisar atendimentos realizados via WhatsApp e gerar avaliações precisas e justas.

${VALEM_PLAYBOOK}

## DADOS DO ATENDIMENTO A ANALISAR

### Métricas de Tempo de Resposta (SLA)
${slaContext}

### Transcrição Completa do Atendimento
${transcript}

## INSTRUÇÃO
Analise o atendimento acima com base no playbook e nas métricas fornecidas.
Seja específico — referencie mensagens concretas da transcrição ao identificar pontos fortes e fracos.
Seja justo — considere o contexto e o comportamento do cliente.

${AUDIT_JSON_SCHEMA}`;
}

export const auditService = AuditService.getInstance();
