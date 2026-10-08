// ══════════════════════════════════════════════════════════════════════════════
// 🔄 RODÍZIO ENGINE — Algoritmo de Distribuição Automática de Leads por Rodízio
// ══════════════════════════════════════════════════════════════════════════════

import { db } from "../../db";
import { operators, conversations, contacts, agentConfigs, internalMessages } from "../../db/schema";
import { eq, and, asc } from "drizzle-orm";

export interface RodizioOperatorConfig {
  operatorId: string;
  isParticipating: boolean; // default: true
  isOnLeave: boolean; // default: false
  isPenalized: boolean; // default: false
  leadsReceivedCount: number; // default: 0
  recentLeads: Array<{
    chatId: string;
    clientName: string;
    receivedAt: string;
  }>;
}

export class RodizioEngine {
  /**
   * Obtém a lista de operadores do tenant mesclados com a configuração do Rodízio
   */
  static async getRodizioState(tenantId: string = "valem") {
    try {
      // 1. Buscar todos os operadores do tenant no banco
      const dbOperators = await db
        .select()
        .from(operators)
        .where(eq(operators.tenantId, tenantId))
        .orderBy(asc(operators.name));

      // 2. Buscar a configuração salva do rodízio no agentConfigs
      const configRow = await db.query.agentConfigs.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "rodizio")),
      });

      const storedOpsMap: Record<string, RodizioOperatorConfig> = (configRow?.config as any)?.operatorsMap || {};

      // 3. Mesclar operadores reais com o estado salvo no rodízio
      const resultOperators = dbOperators.map((op) => {
        const saved = storedOpsMap[op.id] || {
          operatorId: op.id,
          isParticipating: true,
          isOnLeave: false,
          isPenalized: false,
          leadsReceivedCount: 0,
          recentLeads: [],
        };

        return {
          id: op.id,
          name: op.name,
          email: op.email,
          avatar: op.avatar,
          isParticipating: saved.isParticipating ?? true,
          isOnLeave: saved.isOnLeave ?? false,
          isPenalized: saved.isPenalized ?? false,
          leadsReceivedCount: saved.leadsReceivedCount ?? 0,
          recentLeads: saved.recentLeads || [],
        };
      });

      return resultOperators;
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao obter estado do rodízio:", err?.message);
      return [];
    }
  }

  /**
   * Atualiza as configurações do Rodízio no banco
   */
  static async saveRodizioState(
    tenantId: string = "valem",
    updatedOps: Array<{
      id: string;
      isParticipating: boolean;
      isOnLeave: boolean;
      isPenalized: boolean;
      leadsReceivedCount?: number;
      recentLeads?: any[];
    }>
  ) {
    try {
      const existingConfig = await db.query.agentConfigs.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "rodizio")),
      });

      const currentOperatorsMap: Record<string, RodizioOperatorConfig> = (existingConfig?.config as any)?.operatorsMap || {};

      for (const op of updatedOps) {
        currentOperatorsMap[op.id] = {
          operatorId: op.id,
          isParticipating: op.isParticipating,
          isOnLeave: op.isOnLeave,
          isPenalized: op.isPenalized,
          leadsReceivedCount: op.leadsReceivedCount !== undefined ? op.leadsReceivedCount : currentOperatorsMap[op.id]?.leadsReceivedCount || 0,
          recentLeads: op.recentLeads !== undefined ? op.recentLeads : currentOperatorsMap[op.id]?.recentLeads || [],
        };
      }

      const updatedJson = { operatorsMap: currentOperatorsMap };

      if (existingConfig) {
        await db
          .update(agentConfigs)
          .set({
            config: updatedJson,
            updatedAt: new Date(),
          })
          .where(eq(agentConfigs.id, existingConfig.id));
      } else {
        await db.insert(agentConfigs).values({
          id: `cfg-rodizio-${Date.now()}`,
          tenantId,
          agentType: "rodizio",
          enabled: 1,
          config: updatedJson,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      return true;
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao salvar estado do rodízio:", err?.message);
      return false;
    }
  }

  /**
   * Zera todos os contadores de leads do rodízio
   */
  static async resetRodizioCounters(tenantId: string = "valem") {
    const dbOps = await this.getRodizioState(tenantId);
    const resetOps = dbOps.map((op) => ({
      ...op,
      leadsReceivedCount: 0,
      recentLeads: [],
    }));
    await this.saveRodizioState(tenantId, resetOps);
    return resetOps;
  }

  /**
   * Reatribui um lead/card para outro operador e atualiza a compensação
   */
  static async reassignLead(
    tenantId: string,
    cardId: string,
    toOperatorId: string,
    toOperatorName: string
  ) {
    try {
      // 1. Atualiza a conversa se existir no banco
      const conv = await db.query.conversations.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.id, cardId)),
      });

      if (conv) {
        await db
          .update(conversations)
          .set({
            operatorId: toOperatorId,
            queueState: "meus",
            updatedAt: new Date(),
          })
          .where(and(eq(conversations.id, cardId), eq(conversations.tenantId, tenantId)));

        if (conv.contactId) {
          await db
            .update(contacts)
            .set({
              walletOperatorId: toOperatorId,
              responsibleName: toOperatorName,
            })
            .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)));
        }
      }

      // 2. Atualizar compensações no agentConfigs do rodízio
      const existingConfig = await db.query.agentConfigs.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "rodizio")),
      });

      const configData = (existingConfig?.config as any) || {};
      const compensations: Record<string, number> = configData.compensations || {};
      compensations[toOperatorId] = (compensations[toOperatorId] || 0) + 1;

      const reassignments: Array<{ cardId: string; toOperatorId: string; toOperatorName: string; at: string }> =
        configData.reassignments || [];
      reassignments.unshift({
        cardId,
        toOperatorId,
        toOperatorName,
        at: new Date().toISOString(),
      });

      await db
        .update(agentConfigs)
        .set({
          config: {
            ...configData,
            compensations,
            reassignments: reassignments.slice(0, 100),
          },
          updatedAt: new Date(),
        })
        .where(eq(agentConfigs.id, existingConfig!.id));

      return { success: true };
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao reatribuir lead:", err);
      return { success: false, error: err?.message };
    }
  }

  /**
   * Remove card do painel do operador
   */
  static async removeLeadCard(tenantId: string, cardId: string) {
    try {
      const existingConfig = await db.query.agentConfigs.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "rodizio")),
      });

      if (!existingConfig) return { success: true };

      const configData = (existingConfig.config as any) || {};
      const removedCards: string[] = configData.removedCards || [];
      if (!removedCards.includes(cardId)) {
        removedCards.push(cardId);
      }

      await db
        .update(agentConfigs)
        .set({
          config: {
            ...configData,
            removedCards,
          },
          updatedAt: new Date(),
        })
        .where(eq(agentConfigs.id, existingConfig.id));

      return { success: true };
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao remover card:", err);
      return { success: false, error: err?.message };
    }
  }

  /**
   * Obtém os dados completos de inteligência do Dashboard de Rodízio
   */
  static async getDashboardData(
    tenantId: string = "valem",
    options: { days?: number; dateFrom?: string; dateTo?: string } = {}
  ) {
    try {
      const { getBenchmarkRodizioData } = await import(
        "../../components/valentina/rodizio-dashboard-data"
      );
      const benchmark = getBenchmarkRodizioData(tenantId);

      // 1. Buscar operadores do tenant
      const dbOps = await db
        .select()
        .from(operators)
        .where(eq(operators.tenantId, tenantId))
        .orderBy(asc(operators.name));

      // 2. Buscar configuração salva do rodízio
      const configRow = await db.query.agentConfigs.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "rodizio")),
      });

      const configData = (configRow?.config as any) || {};
      const storedOpsMap: Record<string, RodizioOperatorConfig> = configData.operatorsMap || {};
      const compensations: Record<string, number> = configData.compensations || {};
      const removedCards: string[] = configData.removedCards || [];
      const reassignments: Array<{ cardId: string; toOperatorId: string }> =
        configData.reassignments || [];

      // Mapeamento de reatribuições recentes
      const reassignMap = new Map<string, string>();
      for (const r of reassignments) {
        reassignMap.set(r.cardId, r.toOperatorId);
      }

      // Se o banco tiver os operadores do tenant, mesclamos o benchmark com os operadores reais
      let operatorRows = benchmark.operators;
      if (dbOps.length > 0) {
        // Enriquecer ou mapear operadores reais do banco com dados de visualização
        operatorRows = benchmark.operators.map((bOp) => {
          const matchedDbOp = dbOps.find(
            (o) =>
              o.name.toLowerCase().trim() === bOp.name.toLowerCase().trim() ||
              (o.email && bOp.email && o.email.toLowerCase().trim() === bOp.email.toLowerCase().trim())
          );

          const opId = matchedDbOp?.id || bOp.id;
          const savedConfig = storedOpsMap[opId];
          const dynamicComp = compensations[opId] !== undefined ? compensations[opId] : bOp.compensation;

          // Filtra cards removidos
          const validCards = (bOp.cards || []).filter((c) => !removedCards.includes(c.id));

          return {
            ...bOp,
            id: opId,
            avatar: matchedDbOp?.avatar || bOp.avatar,
            compensation: dynamicComp,
            isParticipating: savedConfig?.isParticipating ?? bOp.isParticipating ?? true,
            isOnLeave: savedConfig?.isOnLeave ?? bOp.isOnLeave ?? false,
            isPenalized: savedConfig?.isPenalized ?? bOp.isPenalized ?? false,
            cards: validCards,
          };
        });
      }

      return {
        stats: benchmark.stats,
        byDay: benchmark.byDay,
        byFunnel: benchmark.byFunnel,
        operators: operatorRows,
        deals: benchmark.deals,
      };
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao montar dashboard do rodízio:", err?.message);
      const { getBenchmarkRodizioData } = await import(
        "../../components/valentina/rodizio-dashboard-data"
      );
      return getBenchmarkRodizioData(tenantId);
    }
  }

  /**
   * ALOCA O PRÓXIMO VENDEDOR NO RODÍZIO QUANDO A VALENTINA CONCLUI A TRIAGEM
   */
  static async allocateNextOperator(tenantId: string, conversationId: string, clientName: string) {
    try {
      const allOps = await this.getRodizioState(tenantId);

      // Filtra elegíveis: Participando = true, Folga = false, Penalizado = false
      const eligible = allOps.filter((o) => o.isParticipating && !o.isOnLeave && !o.isPenalized);

      if (eligible.length === 0) {
        console.warn(`[RodizioEngine] Nenhum operador elegível no rodízio para tenant ${tenantId}. Mantendo na fila geral.`);
        return null;
      }

      // Ordena por menor quantidade de leads recebidos (Round-Robin balanceado)
      eligible.sort((a, b) => a.leadsReceivedCount - b.leadsReceivedCount);
      const chosenOperator = eligible[0];

      const timeNow = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      // 1. Atualiza conversa para o operador alocado e coloca na aba "Meus Atendimentos"
      await db
        .update(conversations)
        .set({
          operatorId: chosenOperator.id,
          queueState: "meus",
        })
        .where(eq(conversations.id, conversationId));

      // 2. Buscar o contato da conversa e atualizar carteira e responsável
      const conv = await db.query.conversations.findFirst({
        where: (t, { eq: dEq }) => dEq(t.id, conversationId),
      });

      if (conv?.contactId) {
        await db
          .update(contacts)
          .set({
            walletOperatorId: chosenOperator.id,
            responsibleName: chosenOperator.name,
          })
          .where(eq(contacts.id, conv.contactId));
      }

      // 3. Atualizar o estado do rodízio (incrementar contador do operador e adicionar à lista de recentes)
      chosenOperator.leadsReceivedCount += 1;
      chosenOperator.recentLeads = [
        { chatId: conversationId, clientName: clientName || "Cliente", receivedAt: timeNow },
        ...(chosenOperator.recentLeads || []).slice(0, 4),
      ];

      await this.saveRodizioState(tenantId, [chosenOperator]);

      console.log(`[RodizioEngine] Lead "${clientName}" (${conversationId}) alocado com sucesso para o vendedor: ${chosenOperator.name}`);

      // 4. Notificar a interface do usuário em tempo real via SSE
      try {
        const { SessionManager } = await import("../baileys/session-manager");
        SessionManager.getInstance().notifyPublic(tenantId, {
          type: "chat_updated",
          chat: {
            id: conversationId,
            contactId: conv?.contactId || null,
            queue: "meus",
            operatorId: chosenOperator.id,
            walletOperatorId: chosenOperator.id,
            responsibleName: chosenOperator.name,
          },
        });
      } catch (sseErr: any) {
        console.warn("[RodizioEngine] Erro ao notificar SSE sobre alocação do rodízio:", sseErr?.message);
      }

      return chosenOperator;
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao alocar próximo operador:", err?.message);
      return null;
    }
  }
}
