import { db } from "../../db";
import { conversations, contacts, messages, internalMessages, operators } from "../../db/schema";
import { eq, ne, desc, and, inArray, gte, sql } from "drizzle-orm";
import crypto from "crypto";

/**
 * Tenants com Supervisor ativo.
 * Tecfag está INATIVO — não processa suas conversas.
 * Quando tecfag entrar em produção, adicionar "tecfag" aqui.
 */
const SUPERVISOR_ACTIVE_TENANTS = ["valem"] as const;

/**
 * Janela de deduplicação em milissegundos (4 horas).
 * Alertas do mesmo tipo + mesma conversa dentro desta janela são agrupados
 * em vez de gerar novas linhas no banco.
 */
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Supervisor Engine — Motor de Supervisão em Tempo Real
 *
 * Job em background que monitora ativamente as conversas em andamento
 * e detecta gargalos de SLA, falta de resposta ou sobrecarga dos operadores.
 *
 * Deduplicação: alertas repetidos do mesmo tipo+conversa dentro de 4h são
 * agrupados em uma única linha (repeatCount++) em vez de poluir o banco.
 */
export class SupervisorEngine {
  private static instance: SupervisorEngine;
  private jobInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  // Rate-limit em memória APENAS como cache rápido entre ciclos de 60s.
  // A deduplicação real é feita no banco (persistente entre reinicializações).
  private lastNotified = new Map<string, number>();

  private constructor() {}

  public static getInstance(): SupervisorEngine {
    if (!SupervisorEngine.instance) {
      SupervisorEngine.instance = new SupervisorEngine();
    }
    return SupervisorEngine.instance;
  }

  /**
   * Inicia o motor de supervisão a cada 60 segundos
   */
  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[SupervisorEngine] Iniciando motor de supervisão (SLA & Capacidade)...");

    this.jobInterval = setInterval(() => {
      this.runChecks().catch((e) => console.error("[SupervisorEngine] Erro na execução:", e));
    }, 60_000);

    // Executa a primeira varredura imediatamente
    this.runChecks().catch((e) => console.error("[SupervisorEngine] Erro inicial:", e));
  }

  /**
   * Para a execução do motor
   */
  public stop() {
    if (this.jobInterval) {
      clearInterval(this.jobInterval);
      this.jobInterval = null;
    }
    this.isRunning = false;
    console.log("[SupervisorEngine] Motor de supervisão encerrado.");
  }

  /**
   * Executa a varredura das regras de negócio
   */
  private async runChecks() {
    const activeConvs = await db
      .select({
        id: conversations.id,
        tenantId: conversations.tenantId,
        operatorId: conversations.operatorId,
        contactName: contacts.name,
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(
        and(
          ne(conversations.queueState, "finalizados"),
          inArray(conversations.tenantId, SUPERVISOR_ACTIVE_TENANTS as unknown as string[])
        )
      );

    const operatorLoads = new Map<string, number>();

    for (const conv of activeConvs) {
      if (conv.operatorId) {
        operatorLoads.set(conv.operatorId, (operatorLoads.get(conv.operatorId) || 0) + 1);
      }

      const lastMsgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.sentAt))
        .limit(1);

      if (lastMsgs.length === 0) continue;

      const lastMsg = lastMsgs[0];

      if (lastMsg.senderType === "client") {
        const diffMs = Date.now() - lastMsg.sentAt.getTime();
        const waitMinutes = Math.floor(diffMs / 60000);

        if (waitMinutes > 24 * 60) {
          await this.notifySlaRisk(conv, waitMinutes, lastMsg.sentAt, "high", true);
        } else if (waitMinutes > 15) {
          await this.notifySlaRisk(conv, waitMinutes, lastMsg.sentAt, "high", false);
        } else if (waitMinutes > 8) {
          await this.notifySlaRisk(conv, waitMinutes, lastMsg.sentAt, "medium", false);
        }
      }
    }

    for (const [operatorId, count] of operatorLoads.entries()) {
      if (count > 5) {
        await this.notifyOperatorLoad(operatorId, count);
      }
    }
  }

  /**
   * Gera notificação para riscos de SLA
   */
  private async notifySlaRisk(
    conv: { id: string; tenantId: string; operatorId: string | null; contactName: string | null },
    waitMinutes: number,
    lastClientMessage: Date,
    priority: "medium" | "high",
    is24h: boolean
  ) {
    const now = Date.now();
    const lastTime = this.lastNotified.get(conv.id) || 0;

    // Cache rápido em memória para evitar queries desnecessárias no banco
    if (now - lastTime < 20 * 60_000) return;
    this.lastNotified.set(conv.id, now);

    let alertMessage = `⚠️ Atenção! O cliente ${conv.contactName || "Desconhecido"} está aguardando resposta há ${waitMinutes} minutos.`;

    if (is24h) {
      alertMessage = `🚨 ALERTA DE ABANDONO! O cliente ${conv.contactName || "Desconhecido"} não recebe resposta há mais de 24 horas!`;
    } else if (priority === "high") {
      alertMessage = `🚨 TEMPO CRÍTICO! O cliente ${conv.contactName || "Desconhecido"} está aguardando resposta há mais de 15 minutos!`;
    }

    if (!conv.operatorId) return;

    await this.dispatchInternalNotification(
      conv.tenantId,
      conv.operatorId,
      alertMessage,
      {
        type: is24h ? "no_response" : "sla_alert",
        title: is24h
          ? `Cliente sem resposta há 24h+ — ${conv.contactName || "Desconhecido"}`
          : priority === "high"
          ? `🚨 SLA estourado — ${conv.contactName || "Desconhecido"}`
          : `⚠️ SLA em risco — ${conv.contactName || "Desconhecido"}`,
        priority,
        conversationId: conv.id,
        contactName: conv.contactName,
        waitMinutes,
        lastClientMessage: lastClientMessage.toISOString(),
      }
    );
  }

  /**
   * Gera notificação para sobrecarga de operador
   */
  private async notifyOperatorLoad(operatorId: string, count: number) {
    const now = Date.now();
    const key = `op-load-${operatorId}`;
    const lastTime = this.lastNotified.get(key) || 0;

    if (now - lastTime < 20 * 60_000) return;
    this.lastNotified.set(key, now);

    const opRows = await db
      .select({ name: operators.name, tenantId: operators.tenantId })
      .from(operators)
      .where(eq(operators.id, operatorId))
      .limit(1);

    if (opRows.length === 0) return;
    const op = opRows[0];

    const alertMessage = `⚠️ Atenção ${op.name.split(" ")[0]}! Você possui ${count} conversas ativas neste momento. Tente focar em fechar os atendimentos atuais para manter a qualidade.`;

    await this.dispatchInternalNotification(
      op.tenantId,
      operatorId,
      alertMessage,
      {
        type: "operator_overload",
        title: `Operador ${op.name.split(" ")[0]} com ${count} atendimentos ativos`,
        priority: "medium",
        activeCount: count,
      }
    );
  }

  /**
   * Persiste a notificação no banco com lógica de UPSERT inteligente.
   *
   * Regra de deduplicação (janela de 4h):
   *  - Busca um registro existente com mesmo tenantId + operatorId + alertType + conversationId
   *    criado nas últimas 4 horas.
   *  - Se EXISTE  → incrementa repeatCount e atualiza lastFiredAt (sem nova linha)
   *  - Se NÃO EXISTE → insere nova linha (novo evento)
   */
  private async dispatchInternalNotification(
    tenantId: string,
    operatorId: string,
    content: string,
    metadata: any
  ) {
    try {
      const operatorExists = await db.query.operators.findFirst({
        where: eq(operators.id, operatorId),
        columns: { id: true },
      });

      if (!operatorExists) {
        console.warn(`[SupervisorEngine] Operador ${operatorId} não encontrado — notificação descartada.`);
        return;
      }

      // ── Janela de deduplicação ─────────────────────────────────────────────
      const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);
      const alertType   = metadata?.type ?? "unknown";
      const convId      = metadata?.conversationId ?? null;

      const existing = await db
        .select({ id: internalMessages.id, repeatCount: internalMessages.repeatCount })
        .from(internalMessages)
        .where(
          and(
            eq(internalMessages.tenantId, tenantId),
            eq(internalMessages.operatorId, operatorId),
            sql`${internalMessages.metadata}->>'type' = ${alertType}`,
            convId
              ? sql`${internalMessages.metadata}->>'conversationId' = ${convId}`
              : sql`${internalMessages.metadata}->>'conversationId' IS NULL`,
            gte(internalMessages.createdAt, windowStart)
          )
        )
        .orderBy(desc(internalMessages.createdAt))
        .limit(1);

      if (existing.length > 0) {
        // ── Agrupa no registro existente ──────────────────────────────────────
        const newCount = (existing[0].repeatCount ?? 1) + 1;
        await db
          .update(internalMessages)
          .set({ repeatCount: newCount, lastFiredAt: new Date(), content })
          .where(eq(internalMessages.id, existing[0].id));

        console.log(`[SupervisorEngine] Alerta agrupado (${alertType} ×${newCount}) conv=${convId ?? "N/A"}`);
      } else {
        // ── Novo evento — insere nova linha ───────────────────────────────────
        await db.insert(internalMessages).values({
          id: crypto.randomUUID(),
          tenantId,
          operatorId,
          direction: "from_agent",
          agentType: "supervisor",
          content,
          metadata,
          createdAt: new Date(),
          repeatCount: 1,
          lastFiredAt: new Date(),
        });

        console.log(`[SupervisorEngine] Novo alerta (${alertType}) conv=${convId ?? "N/A"}`);
      }

      // SSE para atualizar a timeline em tempo real
      try {
        const { SessionManager } = await import("../baileys/session-manager");
        SessionManager.getInstance().notifyPublic(tenantId, {
          type: "chat_updated",
          chat: { id: metadata.conversationId || operatorId },
        });
      } catch (sseErr) {
        console.warn("[SupervisorEngine] Failsafe SSE:", sseErr);
      }
    } catch (dbErr) {
      console.error("[SupervisorEngine] Erro ao gravar internalMessage:", dbErr);
    }
  }
}
