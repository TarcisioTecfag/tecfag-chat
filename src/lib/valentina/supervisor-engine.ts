import { runtimeSingleton } from "../runtime-singleton";
import { isSdrTenant } from "../ai-persona";
import { tenants } from "../../db/schema";
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
      SupervisorEngine.instance = runtimeSingleton("SupervisorEngine", () => new SupervisorEngine());
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
    const companies = await db.select({ id: tenants.id }).from(tenants);
    for (const company of companies.filter((row) => isSdrTenant(row.id)))
      await this.runTenantChecks(company.id);
  }

  private async runTenantChecks(tenantId: string) {
    const activeConvs = await db
      .select({
        id: conversations.id,
        tenantId: conversations.tenantId,
        operatorId: conversations.operatorId,
        queueState: conversations.queueState,
        contactName: contacts.name,
      })
      .from(conversations)
      .leftJoin(
        contacts,
        and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, tenantId)),
      )
      .where(
        and(
          eq(conversations.queueState, "meus"),
          eq(conversations.tenantId, tenantId),
          // Bug fix (AGENTS.md): Excluir contatos do Live Chat do site se houver.
          // O Supervisor monitora apenas conversas WhatsApp — o Live Chat
          // tem seu próprio mecanismo de follow-up (livechatWs.ts).
          ne(contacts.mainChannel, "livechat"),
        ),
      );

    const operatorConvsMap = new Map<
      string,
      Array<{
        clientId: string;
        clientName: string;
        lastMessage: string;
        waitMinutes: number;
        isWaiting: boolean;
      }>
    >();
    const operatorTenantMap = new Map<string, string>();

    for (const conv of activeConvs) {
      if (conv.operatorId && conv.tenantId) {
        operatorTenantMap.set(conv.operatorId, conv.tenantId);
      }

      const lastMsgs = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, conv.tenantId),
            eq(messages.conversationId, conv.id),
            eq(messages.isInternalNote, false),
            ne(messages.senderType, "system"),
          ),
        )
        .orderBy(desc(messages.sentAt))
        .limit(1);

      const lastMsg = lastMsgs[0];
      const isClientWaiting = lastMsg?.senderType === "client";
      const diffMs = lastMsg ? Date.now() - lastMsg.sentAt.getTime() : 0;
      const waitMinutes = lastMsg ? Math.max(0, Math.floor(diffMs / 60000)) : 0;
      const lastMessagePreview = (lastMsg?.content || lastMsg?.mediaInterpretation || "")
        .replace(/^\[(LOCAL_MEDIA|MEDIA):[^\]]+\]\s*/i, "[Mídia recebida] ")
        .trim()
        .slice(0, 180);

      if (conv.operatorId) {
        const list = operatorConvsMap.get(conv.operatorId) || [];
        list.push({
          clientId: conv.id,
          clientName: conv.contactName || "Cliente",
          lastMessage: lastMessagePreview || "Conversa ativa em Meus Atendimentos",
          waitMinutes,
          isWaiting: isClientWaiting,
        });
        operatorConvsMap.set(conv.operatorId, list);
      }

      if (!lastMsg) continue;

      if (isClientWaiting) {
        if (waitMinutes > 24 * 60) {
          await this.notifySlaRisk(conv, waitMinutes, lastMsg.sentAt, lastMessagePreview, "high", true);
        } else if (waitMinutes >= 15) {
          await this.notifySlaRisk(conv, waitMinutes, lastMsg.sentAt, lastMessagePreview, "high", false);
        } else if (waitMinutes >= 8) {
          await this.notifySlaRisk(conv, waitMinutes, lastMsg.sentAt, lastMessagePreview, "medium", false);
        }
      }
    }

    for (const [operatorId, convList] of operatorConvsMap.entries()) {
      const waitingCount = convList.filter((c) => c.isWaiting).length;
      if (convList.length > 8 && waitingCount > 0) {
        const opTenantId = operatorTenantMap.get(operatorId);
        if (opTenantId) {
          await this.notifyOperatorLoad(opTenantId, operatorId, convList);
        }
      }
    }
  }

  /**
   * Gera notificação para riscos de SLA
   */
  private async notifySlaRisk(
    conv: { id: string; tenantId: string; operatorId: string | null; contactName: string | null },
    waitMinutes: number,
    lastClientMessageAt: Date,
    lastMessageText: string,
    priority: "medium" | "high",
    is24h: boolean,
  ) {
    const now = Date.now();
    const tierKey = is24h ? `${conv.id}:24h` : priority === "high" ? `${conv.id}:15m` : `${conv.id}:8m`;
    const lastTime = this.lastNotified.get(tierKey) || 0;

    // Cache rápido em memória para evitar queries desnecessárias no banco
    if (now - lastTime < 20 * 60_000) return;
    this.lastNotified.set(tierKey, now);

    const clientName = conv.contactName || "Cliente";
    const hours = Math.floor(waitMinutes / 60);
    const mins = waitMinutes % 60;
    const waitFormatted = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}min` : ""}` : `${waitMinutes} minutos`;

    let alertMessage = `⚠️ *Atenção ao SLA:* O cliente *${clientName}* está aguardando sua resposta há *${waitFormatted}*.`;

    if (is24h) {
      alertMessage = `🚨 *SLA Estourado (+24h sem resposta):* O cliente *${clientName}* está aguardando retorno há *${waitFormatted}*! Priorize este atendimento agora.`;
    } else if (priority === "high") {
      alertMessage = `🚨 *SLA Estourado:* O cliente *${clientName}* já passou do limite de SLA e aguarda resposta há *${waitFormatted}*!`;
    }

    if (!conv.operatorId) return;

    await this.dispatchInternalNotification(conv.tenantId, conv.operatorId, alertMessage, {
      type: is24h ? "no_response" : "sla_alert",
      scope: "operator",
      isWarning: true,
      warningType: "delay",
      title: is24h
        ? `Cliente sem resposta há 24h+ — ${clientName}`
        : priority === "high"
          ? `🚨 SLA estourado — ${clientName}`
          : `⚠️ SLA em risco — ${clientName}`,
      priority,
      conversationId: conv.id,
      clientId: conv.id,
      contactName: clientName,
      clientName,
      waitMinutes,
      lastMessage: lastMessageText || "Aguardando retorno no WhatsApp",
      lastClientMessage: lastClientMessageAt.toISOString(),
    });
  }

  /**
   * Gera notificação consolidada para sobrecarga de operador com lista interativa das conversas
   */
  private async notifyOperatorLoad(
    tenantId: string,
    operatorId: string,
    convList: Array<{
      clientId: string;
      clientName: string;
      lastMessage: string;
      waitMinutes: number;
      isWaiting: boolean;
    }>,
  ) {
    const now = Date.now();
    const key = `op-load-${operatorId}`;
    const lastTime = this.lastNotified.get(key) || 0;

    if (now - lastTime < 4 * 60 * 60_000) return;
    this.lastNotified.set(key, now);

    const opRows = await db
      .select({ name: operators.name, tenantId: operators.tenantId })
      .from(operators)
      .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
      .limit(1);

    if (opRows.length === 0) return;
    const op = opRows[0];

    const sortedConvs = [...convList].sort(
      (a, b) => Number(b.isWaiting) - Number(a.isWaiting) || b.waitMinutes - a.waitMinutes,
    );
    const waitingCount = sortedConvs.filter((c) => c.isWaiting).length;
    const firstName = op.name.split(" ")[0];

    const alertMessage =
      waitingCount > 0
        ? `⚠️ ${firstName}, você está com *${convList.length} conversas ativas* em Meus Atendimentos agora (*${waitingCount} aguardando sua resposta*). Confira abaixo e clique para abrir diretamente:`
        : `⚠️ ${firstName}, você possui *${convList.length} conversas ativas* em Meus Atendimentos neste momento. Veja abaixo os atendimentos abertos:`;

    await this.dispatchInternalNotification(op.tenantId, operatorId, alertMessage, {
      type: "operator_overload",
      scope: "operator",
      isWarning: true,
      warningType: "overload",
      title: `Operador ${firstName} com ${convList.length} atendimentos ativos`,
      priority: "medium",
      activeCount: convList.length,
      waitingCount,
      conversationId: sortedConvs[0]?.clientId || null,
      clientId: sortedConvs[0]?.clientId || null,
      clientName: sortedConvs[0]?.clientName || "Cliente",
      conversations: sortedConvs.slice(0, 8),
    });
  }

  /**
   * Persiste a notificação no banco com lógica de UPSERT inteligente.
   *
   * Regra de deduplicação:
   *  - Para operator_overload: mantém APENAS 1 registro único por operador (atualiza in-place e remove duplicados antigos).
   *  - Para sla_alert / no_response: agrupa por conversationId dentro de 24h para nunca gerar spam repetido do mesmo cliente.
   */
  private async dispatchInternalNotification(
    tenantId: string,
    operatorId: string,
    content: string,
    metadata: any,
  ) {
    try {
      const operatorExists = await db.query.operators.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.id, operatorId), dEq(t.tenantId, tenantId)),
        columns: { id: true },
      });

      if (!operatorExists) {
        console.warn(
          `[SupervisorEngine] Operador ${operatorId} não encontrado no tenant "${tenantId}" — notificação descartada.`,
        );
        return;
      }

      const alertType = metadata?.type ?? "unknown";
      const convId = metadata?.conversationId ?? null;
      const now = new Date();
      let notificationId = "";
      let shouldBroadcastNew = false;

      const isOverload = alertType === "operator_overload";
      const isSlaType = alertType === "sla_alert" || alertType === "no_response";
      const windowStart = new Date(Date.now() - (isSlaType ? 24 * 60 * 60 * 1000 : DEDUP_WINDOW_MS));

      const existing = await db
        .select({
          id: internalMessages.id,
          repeatCount: internalMessages.repeatCount,
          metadata: internalMessages.metadata,
        })
        .from(internalMessages)
        .where(
          isOverload
            ? and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.operatorId, operatorId),
                sql`${internalMessages.metadata}->>'type' = 'operator_overload'`,
              )
            : and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.operatorId, operatorId),
                isSlaType
                  ? sql`${internalMessages.metadata}->>'type' IN ('sla_alert', 'no_response')`
                  : sql`${internalMessages.metadata}->>'type' = ${alertType}`,
                convId
                  ? sql`${internalMessages.metadata}->>'conversationId' = ${convId}`
                  : sql`${internalMessages.metadata}->>'conversationId' IS NULL`,
                gte(internalMessages.createdAt, windowStart),
              ),
        )
        .orderBy(desc(internalMessages.createdAt))
        .limit(10);

      if (existing.length > 0) {
        notificationId = existing[0].id;
        const prevPriority = (existing[0].metadata as any)?.priority;
        const newCount = (existing[0].repeatCount ?? 1) + 1;
        await db
          .update(internalMessages)
          .set({
            repeatCount: newCount,
            lastFiredAt: now,
            content,
            metadata,
          })
          .where(
            and(eq(internalMessages.id, existing[0].id), eq(internalMessages.tenantId, tenantId)),
          );

        // Remove duplicatas excedentes caso existam no banco
        if (existing.length > 1) {
          const duplicateIds = existing.slice(1).map((r) => r.id);
          await db
            .delete(internalMessages)
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                inArray(internalMessages.id, duplicateIds),
              ),
            );
        }

        // Se escalou de medium (8m) para high (15m+), reenvia o alerta em tempo real
        if (prevPriority === "medium" && metadata?.priority === "high") {
          shouldBroadcastNew = true;
        }
      } else {
        notificationId = crypto.randomUUID();
        shouldBroadcastNew = true;
        await db.insert(internalMessages).values({
          id: notificationId,
          tenantId,
          operatorId,
          direction: "from_agent",
          agentType: "supervisor",
          content,
          metadata,
          createdAt: now,
          repeatCount: 1,
          lastFiredAt: now,
        });
      }

      // SSE para atualizar o chat do Fagner/Valentina do operador em tempo real
      try {
        const { SessionManager } = await import("../baileys/session-manager");
        const { getAiPersona } = await import("../ai-persona");
        const persona = getAiPersona(tenantId);

        if (shouldBroadcastNew) {
          const resolvedWarningType =
            metadata?.warningType ||
            (alertType === "lead_transfer"
              ? "new_lead"
              : alertType === "operator_overload"
                ? "overload"
                : "delay");
          const warningMetaPayload =
            convId || Array.isArray(metadata?.conversations)
              ? {
                  clientId: convId || metadata?.conversations?.[0]?.clientId || "",
                  clientName: metadata?.clientName || metadata?.contactName || "Cliente",
                  lastMessage: metadata?.lastMessage || "",
                  conversations: metadata?.conversations || undefined,
                }
              : undefined;

          SessionManager.getInstance().notifyPublic(tenantId, {
            type: "operator_ai_notification",
            operatorId,
            message: {
              id: notificationId,
              direction: "from_agent",
              author: persona.name,
              content,
              createdAt: now.toISOString(),
              isWarning: true,
              warningType: resolvedWarningType,
              warningMetadata: warningMetaPayload,
              metadata,
            },
            notification: {
              id: notificationId,
              author: persona.name,
              content,
              createdAt: now.toISOString(),
              isWarning: true,
              warningType: resolvedWarningType,
              warningMetadata: warningMetaPayload,
            },
          });
        }
      } catch (sseErr) {
        console.warn("[SupervisorEngine] Failsafe SSE:", sseErr);
      }
    } catch (dbErr) {
      console.error("[SupervisorEngine] Erro ao gravar internalMessage:", dbErr);
    }
  }
}
