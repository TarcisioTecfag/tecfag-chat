/**
 * SLA Engine — Motor de Monitoramento de Tempo de Resposta
 *
 * Singleton que roda dois jobs em background:
 *  - Job 1 (a cada 60s): Varre ciclos SLA pendentes e marca como overdue
 *    quando o cliente aguarda mais do que o threshold configurado.
 *  - Job 2 (diário às 18h): Dispara geração de relatório diário (Fase 5).
 */

import { db } from "../db";
import { responseTimeLogs, operatorDailyMetrics, operators } from "../db/schema";
import { eq, isNull, and, sql } from "drizzle-orm";


export class SlaEngine {
  private static instance: SlaEngine;
  private overdueJobInterval: ReturnType<typeof setInterval> | null = null;
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

    console.log("[SlaEngine] Iniciando jobs de monitoramento...");

    // Job 1: Verificar overdue a cada 60 segundos
    this.overdueJobInterval = setInterval(() => {
      this.runOverdueCheck().catch((e) =>
        console.error("[SlaEngine] Erro no job de overdue:", e)
      );
    }, 60_000);

    // Roda imediatamente na inicialização
    this.runOverdueCheck().catch((e) =>
      console.error("[SlaEngine] Erro na verificação inicial de overdue:", e)
    );

    console.log("[SlaEngine] ✓ Jobs iniciados (overdue check: 60s)");
  }

  stop() {
    if (this.overdueJobInterval) {
      clearInterval(this.overdueJobInterval);
      this.overdueJobInterval = null;
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
