// ══════════════════════════════════════════════════════════════════════════════
// 🔄 RODÍZIO ENGINE — Algoritmo de Distribuição Automática de Leads por Rodízio
// ══════════════════════════════════════════════════════════════════════════════

import { db } from "../../db";
import {
  operators,
  conversations,
  contacts,
  agentConfigs,
  agentFlowStates,
  crmDeals,
  crmConversationDeals,
  crmDealEvents,
  crmPipelines,
  crmAccounts,
} from "../../db/schema";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import {
  RodizioOperatorConfig,
  FlowOperator,
  FLOW_AREAS,
  ALL_FLOW_FUNNELS,
  DEFAULT_TECFAG_FLOW_OPERATORS,
} from "./rodizio-types";

export * from "./rodizio-types";

export class RodizioEngine {
  /**
   * Obtém os operadores configurados no fluxo/escala do tenant.
   * Não insere operadores automaticamente: apenas operadores explicitamente cadastrados no fluxo são retornados.
   */
  static async getRodizioState(tenantId: string = "valem"): Promise<FlowOperator[]> {
    try {
      // 1. Buscar todos os operadores do tenant no banco (para atualizar avatares e emails em tempo real)
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

      const configData = (configRow?.config as any) || {};

      // Se já existem flowOperators salvos, usamos exclusivamente os configurados
      if (Array.isArray(configData.flowOperators)) {
        return configData.flowOperators.map((flowOp: FlowOperator) => {
          const matchedDbOp = dbOperators.find(
            (o) =>
              o.id === flowOp.id ||
              (o.email && flowOp.email && o.email.toLowerCase().trim() === flowOp.email.toLowerCase().trim())
          );

          return {
            ...flowOp,
            name: matchedDbOp?.name || flowOp.name,
            email: matchedDbOp?.email || flowOp.email,
            avatar: matchedDbOp?.avatar || flowOp.avatar,
            isParticipating: flowOp.isParticipating ?? true,
            isOnLeave: flowOp.isOnLeave ?? false,
            isPenalized: flowOp.isPenalized ?? false,
            area: flowOp.area || "maquinas",
            funnels: Array.isArray(flowOp.funnels) && flowOp.funnels.length > 0 ? flowOp.funnels : ["Máquinas"],
            compensation: flowOp.compensation ?? 0,
            leadsReceivedCount: flowOp.leadsReceivedCount ?? 0,
            recentLeads: flowOp.recentLeads || [],
          };
        });
      }

      // Se for a primeira vez e o tenant for tecfag, inicializa com o time padrão da escala de referência
      if (tenantId === "tecfag") {
        const seededList = DEFAULT_TECFAG_FLOW_OPERATORS.map((defOp) => {
          const matchedDb = dbOperators.find(
            (o) =>
              o.id === defOp.id ||
              (o.email && defOp.email && o.email.toLowerCase().trim() === defOp.email.toLowerCase().trim())
          );
          return {
            ...defOp,
            id: matchedDb?.id || defOp.id,
            name: matchedDb?.name || defOp.name,
            avatar: matchedDb?.avatar || undefined,
          };
        });

        await this.saveFlowOperators(tenantId, seededList);
        return seededList;
      }

      // Para outros tenants (como valem), se não há lista explícita, inicializa com os operadores já participantes
      if (tenantId === "valem") {
        const storedOpsMap: Record<string, RodizioOperatorConfig> = configData.operatorsMap || {};
        const valemOps: FlowOperator[] = dbOperators.map((op) => {
          const saved = storedOpsMap[op.id];
          return {
            id: op.id,
            name: op.name,
            email: op.email,
            avatar: op.avatar,
            isParticipating: saved?.isParticipating ?? true,
            isOnLeave: saved?.isOnLeave ?? false,
            isPenalized: saved?.isPenalized ?? false,
            area: "maquinas",
            funnels: ["Máquinas"],
            compensation: 0,
            leadsReceivedCount: saved?.leadsReceivedCount ?? 0,
            recentLeads: saved?.recentLeads || [],
          };
        });

        await this.saveFlowOperators(tenantId, valemOps);
        return valemOps;
      }

      return [];
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao obter estado do rodízio:", err?.message);
      return [];
    }
  }

  /**
   * Salva a lista integral de operadores da escala/fluxo no agentConfigs
   */
  static async saveFlowOperators(tenantId: string, flowOps: FlowOperator[]): Promise<boolean> {
    try {
      const existingConfig = await db.query.agentConfigs.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "rodizio")),
      });

      const currentConfig = (existingConfig?.config as any) || {};

      // Sincroniza também operatorsMap para compatibilidade legada com dashboard
      const operatorsMap: Record<string, RodizioOperatorConfig> = currentConfig.operatorsMap || {};
      for (const op of flowOps) {
        operatorsMap[op.id] = {
          operatorId: op.id,
          isParticipating: op.isParticipating,
          isOnLeave: op.isOnLeave,
          isPenalized: !!op.isPenalized,
          leadsReceivedCount: op.leadsReceivedCount,
          recentLeads: op.recentLeads || [],
        };
      }

      const updatedJson = {
        ...currentConfig,
        flowOperators: flowOps,
        operatorsMap,
      };

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
      console.error("[RodizioEngine] Erro ao salvar flowOperators:", err?.message);
      return false;
    }
  }

  /**
   * Adiciona um operador existente do sistema à escala de rodízio
   */
  static async addOperatorToFlow(
    tenantId: string,
    newOp: Partial<FlowOperator> & { id: string; name: string }
  ): Promise<FlowOperator[]> {
    const currentOps = await this.getRodizioState(tenantId);
    const existingIndex = currentOps.findIndex((o) => o.id === newOp.id);

    const fullOp: FlowOperator = {
      id: newOp.id,
      name: newOp.name,
      email: newOp.email || "",
      avatar: newOp.avatar || undefined,
      isParticipating: newOp.isParticipating ?? true,
      isOnLeave: newOp.isOnLeave ?? false,
      isPenalized: newOp.isPenalized ?? false,
      area: newOp.area || "maquinas",
      funnels: Array.isArray(newOp.funnels) && newOp.funnels.length > 0 ? newOp.funnels : ["Máquinas"],
      compensation: typeof newOp.compensation === "number" ? newOp.compensation : 0,
      crmId: newOp.crmId || `${newOp.name} (${newOp.email || ""})`,
      departmentTag: newOp.departmentTag || "COMERCIAL",
      roleTag: newOp.roleTag || "SDR",
      talosId: newOp.talosId || "",
      leadsReceivedCount: newOp.leadsReceivedCount || 0,
      recentLeads: newOp.recentLeads || [],
      addedAt: new Date().toISOString(),
    };

    let updatedList: FlowOperator[];
    if (existingIndex >= 0) {
      updatedList = [...currentOps];
      updatedList[existingIndex] = { ...currentOps[existingIndex], ...fullOp };
    } else {
      updatedList = [...currentOps, fullOp];
    }

    await this.saveFlowOperators(tenantId, updatedList);
    return updatedList;
  }

  /**
   * Atualiza propriedades de um operador na escala
   */
  static async updateOperatorInFlow(
    tenantId: string,
    operatorId: string,
    patch: Partial<FlowOperator>
  ): Promise<FlowOperator[]> {
    const currentOps = await this.getRodizioState(tenantId);
    const updatedList = currentOps.map((op) => {
      if (op.id !== operatorId) return op;
      return { ...op, ...patch };
    });

    await this.saveFlowOperators(tenantId, updatedList);
    return updatedList;
  }

  /**
   * Remove um operador da escala do fluxo
   */
  static async removeOperatorFromFlow(tenantId: string, operatorId: string): Promise<FlowOperator[]> {
    const currentOps = await this.getRodizioState(tenantId);
    const updatedList = currentOps.filter((op) => op.id !== operatorId);
    await this.saveFlowOperators(tenantId, updatedList);
    return updatedList;
  }

  /**
   * Alterna a participação em um funil específico
   */
  static async toggleFunnel(tenantId: string, operatorId: string, funnel: string): Promise<FlowOperator[]> {
    const currentOps = await this.getRodizioState(tenantId);
    const updatedList = currentOps.map((op) => {
      if (op.id !== operatorId) return op;
      const funnels = Array.isArray(op.funnels) ? [...op.funnels] : [];
      const idx = funnels.indexOf(funnel);
      if (idx >= 0) {
        funnels.splice(idx, 1);
      } else {
        funnels.push(funnel);
      }
      return { ...op, funnels };
    });

    await this.saveFlowOperators(tenantId, updatedList);
    return updatedList;
  }

  /**
   * Alterna folga do operador
   */
  static async toggleLeave(tenantId: string, operatorId: string): Promise<FlowOperator[]> {
    const currentOps = await this.getRodizioState(tenantId);
    const updatedList = currentOps.map((op) => {
      if (op.id !== operatorId) return op;
      return { ...op, isOnLeave: !op.isOnLeave };
    });

    await this.saveFlowOperators(tenantId, updatedList);
    return updatedList;
  }

  /**
   * Ajusta o saldo de compensação (+1, -1 ou valor absoluto)
   */
  static async updateCompensation(
    tenantId: string,
    operatorId: string,
    valueOrDelta: number,
    isAbsolute: boolean = false
  ): Promise<FlowOperator[]> {
    const currentOps = await this.getRodizioState(tenantId);
    const updatedList = currentOps.map((op) => {
      if (op.id !== operatorId) return op;
      const current = op.compensation || 0;
      const nextVal = isAbsolute ? valueOrDelta : current + valueOrDelta;
      return { ...op, compensation: Math.max(0, nextVal) };
    });

    await this.saveFlowOperators(tenantId, updatedList);
    return updatedList;
  }

  /**
   * Atualiza as configurações do Rodízio no banco (legado compatível)
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
      area?: string;
      funnels?: string[];
      compensation?: number;
      crmId?: string;
      departmentTag?: string;
      roleTag?: string;
      talosId?: string;
    }>
  ) {
    try {
      const currentFlowOps = await this.getRodizioState(tenantId);
      const updatedMap = new Map<string, any>();
      for (const op of updatedOps) {
        updatedMap.set(op.id, op);
      }

      const mergedFlowOps = currentFlowOps.map((flowOp) => {
        const patch = updatedMap.get(flowOp.id);
        if (!patch) return flowOp;
        return {
          ...flowOp,
          isParticipating: patch.isParticipating ?? flowOp.isParticipating,
          isOnLeave: patch.isOnLeave ?? flowOp.isOnLeave,
          isPenalized: patch.isPenalized ?? flowOp.isPenalized,
          leadsReceivedCount: patch.leadsReceivedCount !== undefined ? patch.leadsReceivedCount : flowOp.leadsReceivedCount,
          recentLeads: patch.recentLeads !== undefined ? patch.recentLeads : flowOp.recentLeads,
          area: patch.area ?? flowOp.area,
          funnels: patch.funnels ?? flowOp.funnels,
          compensation: patch.compensation ?? flowOp.compensation,
          crmId: patch.crmId ?? flowOp.crmId,
          departmentTag: patch.departmentTag ?? flowOp.departmentTag,
          roleTag: patch.roleTag ?? flowOp.roleTag,
          talosId: patch.talosId ?? flowOp.talosId,
        };
      });

      return await this.saveFlowOperators(tenantId, mergedFlowOps);
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao salvar estado do rodízio:", err?.message);
      return false;
    }
  }

  /**
   * Zera todos os contadores de leads do rodízio
   */
  static async resetRodizioCounters(tenantId: string = "valem"): Promise<FlowOperator[]> {
    const currentOps = await this.getRodizioState(tenantId);
    const resetOps = currentOps.map((op) => ({
      ...op,
      leadsReceivedCount: 0,
      recentLeads: [],
    }));
    await this.saveFlowOperators(tenantId, resetOps);
    return resetOps;
  }

  /**
   * Reatribui um lead/card para outro operador e sincroniza com conversa, contato e CRM Local
   */
  static async reassignLead(
    tenantId: string,
    cardId: string,
    toOperatorId: string,
    toOperatorName: string
  ) {
    try {
      const now = new Date();

      // 1. Atualiza a conversa se existir no banco (cardId pode ser conversationId ou dealId)
      let conv = await db.query.conversations.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.id, cardId)),
      });

      if (!conv) {
        const [dealLink] = await db
          .select({ conversationId: crmConversationDeals.conversationId })
          .from(crmConversationDeals)
          .where(
            and(
              eq(crmConversationDeals.tenantId, tenantId),
              eq(crmConversationDeals.dealId, cardId),
            ),
          )
          .limit(1);
        if (dealLink?.conversationId) {
          conv = await db.query.conversations.findFirst({
            where: (t, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(t.tenantId, tenantId), dEq(t.id, dealLink.conversationId)),
          });
        }
      }

      if (conv) {
        await db
          .update(conversations)
          .set({
            operatorId: toOperatorId,
            queueState: "meus",
            updatedAt: now,
          })
          .where(and(eq(conversations.id, conv.id), eq(conversations.tenantId, tenantId)));

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

      // 1b. Sincroniza também as negociações vinculadas no CRM Local (crm_deals)
      const targetDealIds = new Set<string>();
      const [directDeal] = await db
        .select({ id: crmDeals.id, operatorId: crmDeals.operatorId })
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, cardId)))
        .limit(1);
      if (directDeal) {
        targetDealIds.add(directDeal.id);
      }

      if (conv) {
        const convDealLinks = await db
          .select({ dealId: crmConversationDeals.dealId })
          .from(crmConversationDeals)
          .where(
            and(
              eq(crmConversationDeals.tenantId, tenantId),
              eq(crmConversationDeals.conversationId, conv.id),
            ),
          );
        for (const link of convDealLinks) {
          targetDealIds.add(link.dealId);
        }
      }

      if (targetDealIds.size > 0) {
        const dealIdList = Array.from(targetDealIds);
        await db
          .update(crmDeals)
          .set({
            operatorId: toOperatorId,
            updatedAt: now,
          })
          .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, dealIdList)));

        for (const dealId of dealIdList) {
          await db.insert(crmDealEvents).values({
            id: `cdev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            tenantId,
            dealId,
            eventType: "owner_changed",
            operatorId: toOperatorId,
            metadata: {
              source: "rodizio_reassignment",
              toOperatorId,
              toOperatorName,
            },
            createdAt: now,
          });
        }
      }

      // 2. Atualizar compensações no agentConfigs do rodízio e na escala flowOperators
      await this.updateCompensation(tenantId, toOperatorId, 1, false);

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
        at: now.toISOString(),
      });

      if (existingConfig) {
        await db
          .update(agentConfigs)
          .set({
            config: {
              ...configData,
              compensations,
              reassignments: reassignments.slice(0, 100),
            },
            updatedAt: now,
          })
          .where(eq(agentConfigs.id, existingConfig.id));
      }

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
   * Mescla dados reais do banco (agentFlowStates + crmDeals + flowOperators) com o estado do tenant.
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

      // 1. Buscar operadores do tenant e escala atual
      const dbOps = await db
        .select()
        .from(operators)
        .where(eq(operators.tenantId, tenantId))
        .orderBy(asc(operators.name));

      const flowOps = await this.getRodizioState(tenantId);

      // 2. Buscar configuração salva do rodízio
      const configRow = await db.query.agentConfigs.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "rodizio")),
      });

      const configData = (configRow?.config as any) || {};
      const storedOpsMap: Record<string, RodizioOperatorConfig> = configData.operatorsMap || {};
      const compensations: Record<string, number> = configData.compensations || {};
      const removedCards: string[] = configData.removedCards || [];
      const reassignments: Array<{ cardId: string; toOperatorId: string; toOperatorName?: string }> =
        configData.reassignments || [];

      const reassignMap = new Map<string, { toOperatorId: string; toOperatorName?: string }>();
      for (const r of reassignments) {
        if (!reassignMap.has(r.cardId)) {
          reassignMap.set(r.cardId, { toOperatorId: r.toOperatorId, toOperatorName: r.toOperatorName });
        }
      }

      // 3. Buscar negociações reais do CRM Local criadas ou vinculadas pelo SDR neste tenant
      const realDealsRows = await db
        .select({
          dealId: crmDeals.id,
          title: crmDeals.title,
          operatorId: crmDeals.operatorId,
          createdAt: crmDeals.createdAt,
          funnelName: crmPipelines.name,
          accountName: crmAccounts.name,
          contactPhone: crmAccounts.phone,
          conversationId: crmConversationDeals.conversationId,
          origin: crmConversationDeals.origin,
        })
        .from(crmConversationDeals)
        .innerJoin(
          crmDeals,
          and(
            eq(crmConversationDeals.dealId, crmDeals.id),
            eq(crmDeals.tenantId, tenantId),
          ),
        )
        .leftJoin(
          crmPipelines,
          and(
            eq(crmDeals.pipelineId, crmPipelines.id),
            eq(crmPipelines.tenantId, tenantId),
          ),
        )
        .leftJoin(
          crmAccounts,
          and(
            eq(crmDeals.accountId, crmAccounts.id),
            eq(crmAccounts.tenantId, tenantId),
          ),
        )
        .where(eq(crmConversationDeals.tenantId, tenantId))
        .orderBy(desc(crmDeals.createdAt))
        .limit(100);

      // 4. Buscar estados de triagem reais em agentFlowStates
      const realFlowStates = await db
        .select()
        .from(agentFlowStates)
        .where(eq(agentFlowStates.tenantId, tenantId));

      const opById = new Map<string, { id: string; name: string }>();
      for (const op of dbOps) opById.set(op.id, { id: op.id, name: op.name });
      for (const fOp of flowOps) {
        if (!opById.has(fOp.id)) opById.set(fOp.id, { id: fOp.id, name: fOp.name });
      }

      // Agrupar cards reais por operatorId
      const realCardsByOpId = new Map<string, any[]>();
      const realCrmDealsList: any[] = [];
      const seenDealIds = new Set<string>();

      for (const row of realDealsRows) {
        if (seenDealIds.has(row.dealId)) continue;
        seenDealIds.add(row.dealId);

        const reassigned = reassignMap.get(row.dealId) || (row.conversationId ? reassignMap.get(row.conversationId) : undefined);
        const effectiveOpId = reassigned?.toOperatorId || row.operatorId || "";
        const effectiveOpName =
          reassigned?.toOperatorName ||
          (effectiveOpId ? opById.get(effectiveOpId)?.name : null) ||
          "Operador";

        const createdAtIso = row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString();

        if (effectiveOpId && !removedCards.includes(row.dealId) && (!row.conversationId || !removedCards.includes(row.conversationId))) {
          const opCards = realCardsByOpId.get(effectiveOpId) || [];
          opCards.push({
            id: row.conversationId || row.dealId,
            name: row.title,
            company: row.accountName || null,
            created_at: createdAtIso,
            chatId: row.conversationId || undefined,
            rdDealId: row.dealId,
            phone: row.contactPhone || null,
            subject: row.funnelName || null,
          });
          realCardsByOpId.set(effectiveOpId, opCards);
        }

        realCrmDealsList.push({
          id: row.dealId,
          name: row.title,
          company: row.accountName || null,
          phone: row.contactPhone || null,
          rd_deal_id: row.dealId,
          operator_name: effectiveOpName,
          sector: row.funnelName || "Comercial",
          funnel: (row.funnelName || "maquinas").toLowerCase(),
          created_at: createdAtIso,
        });
      }

      // Se o banco tiver os operadores do tenant, mesclamos o benchmark com os operadores reais e cards reais
      let operatorRows = benchmark.operators;
      if (dbOps.length > 0 || flowOps.length > 0) {
        operatorRows = benchmark.operators.map((bOp) => {
          const matchedDbOp = dbOps.find(
            (o) =>
              o.id === bOp.id ||
              o.name.toLowerCase().trim() === bOp.name.toLowerCase().trim() ||
              (o.email && bOp.email && o.email.toLowerCase().trim() === bOp.email.toLowerCase().trim())
          );
          const matchedFlowOp = flowOps.find(
            (fo) =>
              fo.id === (matchedDbOp?.id || bOp.id) ||
              fo.name.toLowerCase().trim() === bOp.name.toLowerCase().trim()
          );

          const opId = matchedDbOp?.id || matchedFlowOp?.id || bOp.id;
          const savedConfig = storedOpsMap[opId];
          const dynamicComp =
            matchedFlowOp?.compensation !== undefined
              ? matchedFlowOp.compensation
              : compensations[opId] !== undefined
                ? compensations[opId]
                : bOp.compensation;

          const realOpCards = realCardsByOpId.get(opId) || [];
          const benchmarkCards = (bOp.cards || []).filter((c) => !removedCards.includes(c.id));
          const mergedCards = [...realOpCards, ...benchmarkCards];

          return {
            ...bOp,
            id: opId,
            avatar: matchedDbOp?.avatar || matchedFlowOp?.avatar || bOp.avatar,
            sector: matchedFlowOp?.area || bOp.sector,
            allowed_subflows: matchedFlowOp?.funnels || bOp.allowed_subflows,
            compensation: dynamicComp,
            count: (bOp.count || 0) + realOpCards.length,
            isParticipating: matchedFlowOp?.isParticipating ?? savedConfig?.isParticipating ?? bOp.isParticipating ?? true,
            isOnLeave: matchedFlowOp?.isOnLeave ?? savedConfig?.isOnLeave ?? bOp.isOnLeave ?? false,
            isPenalized: matchedFlowOp?.isPenalized ?? savedConfig?.isPenalized ?? bOp.isPenalized ?? false,
            cards: mergedCards,
          };
        });
      }

      const activeRealSessions = realFlowStates.filter((fs) => fs.outcome === "in_progress").length;
      const completedRealSessions = realFlowStates.filter(
        (fs) => fs.outcome === "completed" || fs.outcome === "transferred"
      ).length;

      return {
        stats: {
          ...benchmark.stats,
          totalLeads: benchmark.stats.totalLeads + realFlowStates.length,
          syncedToCrm: benchmark.stats.syncedToCrm + realCrmDealsList.length,
          triageDone: benchmark.stats.triageDone + completedRealSessions,
          activeSessions: benchmark.stats.activeSessions + activeRealSessions,
        },
        byDay: benchmark.byDay,
        byFunnel: benchmark.byFunnel,
        operators: operatorRows,
        deals: [...realCrmDealsList, ...benchmark.deals],
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
   * ALOCA O PRÓXIMO VENDEDOR NO RODÍZIO QUANDO A IA CONCLUI A TRIAGEM
   * Considera área/funil alvo, compensações acumuladas e menor quantidade de leads.
   * Suporta o callback `beforeTransfer(chosenOperator)` para vincular/criar negociação no CRM Local
   * ANTES de efetivar a transferência da conversa para a fila "meus" do operador.
   */
  static async allocateNextOperator(
    tenantId: string,
    conversationId: string,
    clientName: string,
    targetAreaOrFunnel?: string,
    options?: {
      beforeTransfer?: (chosenOperator: FlowOperator) => Promise<void>;
    }
  ): Promise<FlowOperator | null> {
    try {
      const allOps = await this.getRodizioState(tenantId);

      // Filtra elegíveis: Participando = true, Folga = false, Penalizado = false
      const available = allOps.filter((o) => o.isParticipating && !o.isOnLeave && !o.isPenalized);

      if (available.length === 0) {
        console.warn(`[RodizioEngine] Nenhum operador elegível no rodízio para tenant ${tenantId}. Mantendo na fila geral.`);
        return null;
      }

      let eligible = available;

      // Filtragem por Área / Funil se especificado
      if (targetAreaOrFunnel && targetAreaOrFunnel.trim() !== "") {
        const normTarget = targetAreaOrFunnel.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const areaMatches = available.filter((o) => {
          const normArea = (o.area || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          if (normArea === normTarget || normArea.includes(normTarget) || normTarget.includes(normArea)) return true;
          return (o.funnels || []).some((f) => {
            const normF = f.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            return normF === normTarget || normF.includes(normTarget) || normTarget.includes(normF);
          });
        });

        if (areaMatches.length > 0) {
          eligible = areaMatches;
        } else {
          console.warn(`[RodizioEngine] Nenhum operador específico ativo para área/funil "${targetAreaOrFunnel}". Usando operadores gerais.`);
        }
      }

      // Ordenação Round-Robin ponderada por compensações:
      // Quem tem mais compensação acumulada tem prioridade (menor score efetivo)
      eligible.sort((a, b) => {
        const scoreA = (a.leadsReceivedCount || 0) - (a.compensation || 0);
        const scoreB = (b.leadsReceivedCount || 0) - (b.compensation || 0);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return (a.leadsReceivedCount || 0) - (b.leadsReceivedCount || 0);
      });

      const chosenOperator = eligible[0];
      const timeNow = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      // 0. Hook opcional ANTES da transferência (ex: criar ou vincular card no CRM Local com janela de 3h)
      if (options?.beforeTransfer) {
        await options.beforeTransfer(chosenOperator);
      }

      // 1. Atualiza conversa para o operador alocado e coloca na aba "Meus Atendimentos"
      await db
        .update(conversations)
        .set({
          operatorId: chosenOperator.id,
          queueState: "meus",
          updatedAt: new Date(),
        })
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

      // 2. Buscar o contato da conversa e atualizar carteira e responsável
      const conv = await db.query.conversations.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.id, conversationId)),
      });

      if (conv?.contactId) {
        await db
          .update(contacts)
          .set({
            walletOperatorId: chosenOperator.id,
            responsibleName: chosenOperator.name,
          })
          .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)));
      }

      // 3. Atualizar o estado do rodízio (incrementar contador do operador, consumir compensação e adicionar aos recentes)
      if (chosenOperator.compensation && chosenOperator.compensation > 0) {
        chosenOperator.compensation -= 1;
      }
      chosenOperator.leadsReceivedCount = (chosenOperator.leadsReceivedCount || 0) + 1;
      chosenOperator.recentLeads = [
        { chatId: conversationId, clientName: clientName || "Cliente", receivedAt: timeNow },
        ...(chosenOperator.recentLeads || []).slice(0, 9),
      ];

      await this.updateOperatorInFlow(tenantId, chosenOperator.id, {
        compensation: chosenOperator.compensation,
        leadsReceivedCount: chosenOperator.leadsReceivedCount,
        recentLeads: chosenOperator.recentLeads,
      });

      console.log(`[RodizioEngine] Lead "${clientName}" (${conversationId}) alocado com sucesso para: ${chosenOperator.name} (Área: ${chosenOperator.area})`);

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


