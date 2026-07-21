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

      return chosenOperator;
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao alocar próximo operador:", err?.message);
      return null;
    }
  }
}
