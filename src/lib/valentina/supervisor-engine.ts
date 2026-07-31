import { db } from "../../db";
import { conversations, contacts, messages, internalMessages, operators } from "../../db/schema";
import { eq, ne, desc, and, inArray } from "drizzle-orm";
import crypto from "crypto";

/**
 * Tenants com Supervisor ativo.
 * Tecfag está INATIVO — não processa suas conversas.
 * Quando tecfag entrar em produção, adicionar "tecfag" aqui.
 */
const SUPERVISOR_ACTIVE_TENANTS = ["valem"] as const;

/**
 * Supervisor Engine — Motor de Supervisão em Tempo Real
 * 
 * Job em background que monitora ativamente as conversas em andamento
 * e detecta gargalos de SLA, falta de resposta ou sobrecarga dos operadores.
 */
export class SupervisorEngine {
  private static instance: SupervisorEngine;
  private jobInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  
  // Controle de rate limit: Map<conversationId | operatorId, timestamp>
  // Evita flood de notificações (1 alerta a cada 20 minutos por entidade)
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
    // 1. Buscar conversas ativas SOMENTE dos tenants com Supervisor ativo.
    //    NUNCA processar conversas de tenants inativos (ex: tecfag).
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
      // Contabilizar carga por operador
      if (conv.operatorId) {
        operatorLoads.set(conv.operatorId, (operatorLoads.get(conv.operatorId) || 0) + 1);
      }

      // Buscar a última mensagem da conversa
      const lastMsgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.sentAt))
        .limit(1);

      if (lastMsgs.length === 0) continue;

      const lastMsg = lastMsgs[0];

      // Verificar se a última mensagem foi enviada pelo cliente (ou seja, o agente ainda não respondeu)
      if (lastMsg.senderType === "client") {
        const diffMs = Date.now() - lastMsg.sentAt.getTime();
        const waitMinutes = Math.floor(diffMs / 60000);

        // scanNoResponse(): Mais de 24 horas sem resposta
        if (waitMinutes > 24 * 60) {
          await this.notifySlaRisk(conv, waitMinutes, lastMsg.sentAt, "high", true);
        } 
        // scanSlaRisks(): CRÍTICO (> 15 min) ou WARNING (> 8 min)
        else if (waitMinutes > 15) {
          await this.notifySlaRisk(conv, waitMinutes, lastMsg.sentAt, "high", false);
        } else if (waitMinutes > 8) {
          await this.notifySlaRisk(conv, waitMinutes, lastMsg.sentAt, "medium", false);
        }
      }
    }

    // scanOperatorLoad(): Alerta para operadores com mais de 5 conversas ativas
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
    
    // Rate limit: 1 alerta a cada 20 minutos por conversa
    if (now - lastTime < 20 * 60_000) return;
    this.lastNotified.set(conv.id, now);

    let alertMessage = `⚠️ Atenção! O cliente ${conv.contactName || "Desconhecido"} está aguardando resposta há ${waitMinutes} minutos.`;
    
    if (is24h) {
      alertMessage = `🚨 ALERTA DE ABANDONO! O cliente ${conv.contactName || "Desconhecido"} não recebe resposta há mais de 24 horas!`;
    } else if (priority === "high") {
      alertMessage = `🚨 TEMPO CRÍTICO! O cliente ${conv.contactName || "Desconhecido"} está aguardando resposta há mais de 15 minutos!`;
    }

    // Se não há operador responsável, não há destinatário — notificação descartada silenciosamente.
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
        lastClientMessage: lastClientMessage.toISOString()
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
    
    // Rate limit: 1 alerta a cada 20 minutos por operador
    if (now - lastTime < 20 * 60_000) return;
    this.lastNotified.set(key, now);

    const opRows = await db
      .select({ name: operators.name, tenantId: operators.tenantId })
      .from(operators)
      .where(eq(operators.id, operatorId))
      .limit(1);
    
    if (opRows.length === 0) return;
    const op = opRows[0];

    const alertMessage = `⚠️ Atenção ${op.name.split(' ')[0]}! Você possui ${count} conversas ativas neste momento. Tente focar em fechar os atendimentos atuais para manter a qualidade.`;

    await this.dispatchInternalNotification(
      op.tenantId,
      operatorId,
      alertMessage,
      { 
        type: "operator_overload", 
        title: `Operador ${op.name.split(' ')[0]} com ${count} atendimentos ativos`,
        priority: "medium", 
        activeCount: count 
      }
    );
  }

  /**
   * Persiste a mensagem no banco e tenta disparar SSE via SessionManager
   */
  private async dispatchInternalNotification(
    tenantId: string,
    operatorId: string,
    content: string,
    metadata: any
  ) {
    const messageId = crypto.randomUUID();

    try {
      // Verificar se o operador existe antes de inserir (evita FK violation se operador foi deletado)
      const operatorExists = await db.query.operators.findFirst({
        where: eq(operators.id, operatorId),
        columns: { id: true },
      });

      if (!operatorExists) {
        console.warn(`[SupervisorEngine] Operador ${operatorId} não encontrado no banco — notificação descartada.`);
        return;
      }

      await db.insert(internalMessages).values({
        id: messageId,
        tenantId,
        operatorId,
        direction: "from_agent",
        agentType: "supervisor",
        content,
        metadata,
        createdAt: new Date()
      });

      // Disparo de SSE via dynamic import (failsafe para evitar dependências cíclicas)
      try {
        const { SessionManager } = await import("../baileys/session-manager");
        
        SessionManager.getInstance().notifyPublic(tenantId, {
          type: "chat_updated",
          chat: { id: metadata.conversationId || operatorId }
        });
      } catch (sseErr) {
        console.warn("[SupervisorEngine] Failsafe: Erro ao disparar SSE", sseErr);
      }
      
    } catch (dbErr) {
      console.error("[SupervisorEngine] Erro ao gravar internalMessage:", dbErr);
    }
  }
}
