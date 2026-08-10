/**
 * SLA Engine — Motor de Monitoramento de Tempo de Resposta e Relatórios Automáticos
 *
 * Singleton que roda jobs em background:
 *  - Job 1 (a cada 60s): Varre ciclos SLA pendentes e marca como overdue
 *    quando o cliente aguarda mais do que o threshold configurado.
 *  - Job 2 (a cada 15min): Varre configurações de tenants e dispara relatórios
 *    analíticos executivos diários/semanais gerados por IA para WhatsApp e E-mail.
 *
 *  NOTA: O disparo real agora é delegado ao ReportDispatcher (report-dispatcher.ts).
 *  Se config.reportRequiresApproval=true, o cron apenas salva o rascunho sem enviar.
 */

import { db } from "../db";
import {
  responseTimeLogs,
  operatorDailyMetrics,
  operators,
  tenants,
  channelConfigs,
  conversations,
  aiConversationAudits,
  aiReports
} from "../db/schema";
import { eq, isNull, and, sql, gte, desc } from "drizzle-orm";

// Helper para obter a semana em formato YYYY-WNN
function getWeekString(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export class SlaEngine {
  private static instance: SlaEngine;
  private overdueJobInterval: ReturnType<typeof setInterval> | null = null;
  private reportJobInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  private constructor() {}

  static getInstance(): SlaEngine {
    if (!SlaEngine.instance) {
      SlaEngine.instance = new SlaEngine();
    }
    return SlaEngine.instance;
  }

  /**
   * Inicia todos os jobs da engine. Idempotente — chamar várias vezes não duplica os jobs.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("[SlaEngine] Iniciando jobs de monitoramento e relatórios...");

    // Job 1: Verificar overdue a cada 60 segundos
    this.overdueJobInterval = setInterval(() => {
      this.runOverdueCheck().catch((e) =>
        console.error("[SlaEngine] Erro no job de overdue:", e)
      );
    }, 60_000);

    // Job 2: Verificar e gerar relatórios executivos a cada 15 minutos
    this.reportJobInterval = setInterval(() => {
      this.runReportEngine().catch((e) =>
        console.error("[SlaEngine] Erro no job de relatórios:", e)
      );
    }, 15 * 60 * 1000);

    // Roda imediatamente na inicialização
    this.runOverdueCheck().catch((e) =>
      console.error("[SlaEngine] Erro na verificação inicial de overdue:", e)
    );

    this.runReportEngine().catch((e) =>
      console.error("[SlaEngine] Erro na geração inicial de relatórios:", e)
    );

    console.log("[SlaEngine] ✓ Jobs iniciados (overdue check: 60s, report engine: 15min)");
  }

  stop() {
    if (this.overdueJobInterval) {
      clearInterval(this.overdueJobInterval);
      this.overdueJobInterval = null;
    }
    if (this.reportJobInterval) {
      clearInterval(this.reportJobInterval);
      this.reportJobInterval = null;
    }
    this.isRunning = false;
    console.log("[SlaEngine] Jobs encerrados.");
  }

  /**
   * Varre todos os ciclos SLA ainda sem resposta.
   * Marca como overdue quando o tempo de espera excede o threshold.
   * Também atualiza o overdueCount nas métricas diárias do operador.
   */
  private async runOverdueCheck() {
    const now = new Date();

    // Busca ciclos pendentes que ainda não foram marcados como overdue
    // e cujo tempo de espera já excedeu o threshold
    const pendingLogs = await db
      .select()
      .from(responseTimeLogs)
      .where(
        and(
          isNull(responseTimeLogs.agentResponseId),    // Ainda sem resposta
          eq(responseTimeLogs.isOverdue, false),        // Ainda não marcado como overdue
          // Verifica: (now - clientMessageAt) > overdueThresholdSeconds
          sql`EXTRACT(EPOCH FROM (NOW() - ${responseTimeLogs.clientMessageAt})) > ${responseTimeLogs.overdueThresholdSeconds}`
        )
      );

    if (pendingLogs.length === 0) return;

    console.log(`[SlaEngine] ${pendingLogs.length} ciclo(s) SLA marcado(s) como overdue.`);

    for (const log of pendingLogs) {
      // Marca como overdue
      await db
        .update(responseTimeLogs)
        .set({
          isOverdue: true,
          overdueNotifiedAt: now,
        })
        .where(eq(responseTimeLogs.id, log.id));

      // Atualiza o overdueCount nas métricas diárias do operador (se houver um atribuído)
      if (log.operatorId) {
        const today = now.toISOString().split("T")[0];
        await this.incrementOperatorOverdue(log.tenantId, log.operatorId, today);
      }
    }
  }

  /**
   * Varre todos os tenants cadastrados e verifica a necessidade de emitir relatórios
   * com base nas configurações em channel_configs.
   */
  private async runReportEngine() {
    const activeTenants = await db.select().from(tenants);

    for (const t of activeTenants) {
      const config = await db.query.channelConfigs.findFirst({
        where: eq(channelConfigs.tenantId, t.id),
      });

      if (!config) continue;

      const now = new Date();
      const brtHourStr = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "numeric",
        hour12: false,
      }).format(now);
      const brtHour = parseInt(brtHourStr, 10);
      const isPast6PM = brtHour >= 18;

      if (isPast6PM) {
        const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

        // 1. Relatório Diário
        if (config.reportDailyWhatsapp || config.reportDailyEmail) {
          const exists = await db.query.aiReports.findFirst({
            where: and(
              eq(aiReports.tenantId, t.id),
              eq(aiReports.type, "daily"),
              eq(aiReports.period, todayStr)
            ),
          });

          if (!exists) {
            console.log(`[SlaEngine] Iniciando geração de Relatório Diário para o tenant: ${t.id} (${todayStr})`);
            await this.generateAndSendReport(t.id, "daily", todayStr, config);
          }
        }

        // 2. Relatório Semanal (dispara na Sexta-feira após as 18h)
        const isFriday = now.getDay() === 5;
        if (isFriday && (config.reportWeeklyWhatsapp || config.reportWeeklyEmail)) {
          const weekStr = getWeekString(now);
          const exists = await db.query.aiReports.findFirst({
            where: and(
              eq(aiReports.tenantId, t.id),
              eq(aiReports.type, "weekly"),
              eq(aiReports.period, weekStr)
            ),
          });

          if (!exists) {
            console.log(`[SlaEngine] Iniciando geração de Relatório Semanal para o tenant: ${t.id} (${weekStr})`);
            await this.generateAndSendReport(t.id, "weekly", weekStr, config);
          }
        }
      }
    }
  }

  /**
   * Reúne dados consolidados do período, invoca a IA para gerar o relatório Markdown
   * e envia por e-mail (SMTP) e/ou WhatsApp (Baileys/Meta) para múltiplos destinatários.
   * Se config.reportRequiresApproval=true, apenas salva o rascunho sem enviar.
   */
  private async generateAndSendReport(tenantId: string, type: "daily" | "weekly", period: string, config: any) {
    try {
      const { buildStoredReport, buildMarkdownFromStoredReport } = await import("./report-builder");
      const { ReportDispatcher } = await import("./report-dispatcher");

      const now = new Date();
      console.log(`[SlaEngine] Construindo relatório v2 (${type}) para ${tenantId}...`);

      // ── Constrói o StoredReport completo via Report Builder ──
      const { storedReport, markdown: markdownReport } = await buildStoredReport(tenantId, type, period, now);

      // ── Salvar o relatório na tabela aiReports (v2 — com JSON rico) ──
      const reportId = storedReport.id;
      await db.insert(aiReports).values({
        id: reportId,
        tenantId,
        type,
        period,
        reportMarkdown: markdownReport,
        reportData: storedReport as any,
        stage: "rascunho",
        currentVersion: "v1",
        headline: storedReport.headline,
        summary: storedReport.summary,
        confidence: storedReport.confidence,
        generatedAt: now,
      });

      // ── Cria o registro de versão v1 ──
      const { aiReportVersions } = await import("../db/schema");
      await db.insert(aiReportVersions).values({
        id: `rev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        reportId,
        tenantId,
        version: "v1",
        createdAt: storedReport.versions[0]?.createdAt ?? storedReport.syncedAt,
        author: "IA · sla_advisor",
        note: "Primeira síntese automática do ciclo.",
        stage: "rascunho",
        reportData: storedReport as any,
      });

      console.log(`[SlaEngine] ✓ Relatório v2 salvo em ai_reports (${reportId})`);

      // ── Disparo: só envia se NÃO exigir aprovação humana ──
      if (config.reportRequiresApproval) {
        console.log(`[SlaEngine] Modo aprovacão ativo: relatório ${reportId} aguardando aprovação humana. Envio suspenso.`);
        return;
      }

      // Disparo automático via ReportDispatcher
      const dispatchResult = await ReportDispatcher.dispatch(tenantId, storedReport, markdownReport);

      if (dispatchResult.whatsappSent.length > 0) {
        console.log(`[SlaEngine] ✓ WhatsApp enviado para: ${dispatchResult.whatsappSent.join(", ")}`);
      }
      if (dispatchResult.emailSent.length > 0) {
        console.log(`[SlaEngine] ✓ E-mail enviado para: ${dispatchResult.emailSent.join(", ")}`);
      }
      if (dispatchResult.errors.length > 0) {
        console.error(`[SlaEngine] Erros no dispatch:`, dispatchResult.errors);
      }
      if (dispatchResult.skipped.length > 0) {
        console.log(`[SlaEngine] Dispatch pulado: ${dispatchResult.skipped.join("; ")}`);
      }

      // Marca como enviado se ao menos um canal disparou
      if (dispatchResult.whatsappSent.length > 0 || dispatchResult.emailSent.length > 0) {
        await ReportDispatcher.markAsEnviado(reportId, tenantId);
      }

    } catch (e: any) {
      console.error("[SlaEngine] Erro fatal no gerador de relatório v2:", e.message);
    }
  }

  /**
   * Incrementa o contador de overdue do operador nas métricas do dia.
   * Cria o registro se ainda não existir.
   */
  private async incrementOperatorOverdue(tenantId: string, operatorId: string, date: string) {
    const existing = await db
      .select()
      .from(operatorDailyMetrics)
      .where(
        and(
          eq(operatorDailyMetrics.tenantId, tenantId),
          eq(operatorDailyMetrics.operatorId, operatorId),
          eq(operatorDailyMetrics.date, date)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(operatorDailyMetrics)
        .set({
          overdueCount: (existing[0].overdueCount ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(operatorDailyMetrics.id, existing[0].id));
    } else {
      // Busca o nome do operador para desnormalizar
      const op = await db
        .select({ name: operators.name })
        .from(operators)
        .where(eq(operators.id, operatorId))
        .limit(1);

      await db.insert(operatorDailyMetrics).values({
        id: `odm-${tenantId}-${operatorId}-${date}`,
        tenantId,
        operatorId,
        operatorName: op[0]?.name ?? "Desconhecido",
        date,
        overdueCount: 1,
        totalConversations: 0,
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Atualiza as métricas de tempo de resposta de um operador após cada resposta dada.
   * Chamado externamente após fechar um ciclo SLA.
   */
  async updateResponseMetrics(tenantId: string, operatorId: string, responseTimeSeconds: number) {
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
      const prevAvg = m.avgResponseTimeSeconds ?? 0;
      const prevMax = m.maxResponseTimeSeconds ?? 0;
      const prevTotal = m.totalConversations ?? 0;

      // Média acumulada incremental: newAvg = (prevAvg * n + newValue) / (n + 1)
      const newAvg = Math.floor((prevAvg * prevTotal + responseTimeSeconds) / (prevTotal + 1));
      const newMax = Math.max(prevMax, responseTimeSeconds);

      await db
        .update(operatorDailyMetrics)
        .set({
          avgResponseTimeSeconds: newAvg,
          maxResponseTimeSeconds: newMax,
          totalConversations: prevTotal + 1,
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
        avgResponseTimeSeconds: responseTimeSeconds,
        maxResponseTimeSeconds: responseTimeSeconds,
        overdueCount: 0,
        updatedAt: new Date(),
      });
    }
  }
}
