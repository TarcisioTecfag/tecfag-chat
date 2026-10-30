// ══════════════════════════════════════════════════════════════════════════════
// 🔄 RODÍZIO ENGINE — Algoritmo de Distribuição Automática de Leads por Rodízio
// ══════════════════════════════════════════════════════════════════════════════

import { db } from "../../db";
import {
  operators,
  sectors,
  conversations,
  contacts,
  agentConfigs,
  agentFlowStates,
  crmDeals,
  crmConversationDeals,
  crmDealEvents,
  crmPipelines,
  crmAccounts,
  aiUsageLogs,
} from "../../db/schema";
import { eq, and, asc, desc, inArray, gte, isNull, ne } from "drizzle-orm";
import { getAiPersona } from "../ai-persona";
import { isEligibleIndustrialOperator, normalizeIndustrialFunnel, normalizeIndustrialFunnels } from "../triage/industrial-policy";
import { mutateIndustrialRodizio, mergeIndustrialOperatorSettings } from "../triage/industrial-rodizio-store";
import {
  RodizioOperatorConfig,
  FlowOperator,
  FLOW_AREAS,
  ALL_FLOW_FUNNELS,
  DEFAULT_TECFAG_FLOW_OPERATORS,
  getBrtTodayYmd,
  isOperatorOnLeaveToday,
  getDefaultRoleTagForArea,
  getDefaultDepartmentForArea,
} from "./rodizio-types";

export * from "./rodizio-types";

function normalizeOpName(rawName: string = ""): string {
  return rawName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*-\s*\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFunnelKey(rawFunnel: string = ""): string {
  const s = rawFunnel
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  if (!s) return "maquinas";
  if (s.includes("personalit") || s.includes("personnalit")) return "personalite";
  if (s.includes("assistencia") || s.includes("manutencao") || s.includes("tecnic")) return "assistencia-tecnica";
  if (s.includes("pos-venda") || s.includes("pos venda") || s.includes("pos_venda") || s.includes("rastreio") || s.includes("nf do pedido")) {
    return "pos-venda";
  }
  if (s.includes("financeiro") || s.includes("boleto") || s.includes("nota fiscal") || s.includes("faturamento")) {
    return "financeiro";
  }
  if (s.includes("peca") || s.includes("reposicao")) return "pecas";
  if (s.includes("sem_resposta") || s.includes("sem-resposta") || s.includes("sem resposta") || s.includes("abandon")) {
    return "sem-resposta";
  }
  if (s === "triagem" || s.includes("em qualificacao") || s.includes("triagem")) return "triagem";
  if (s.includes("outro")) return "outros";
  if (s.includes("maquina") || s.includes("seladora") || s.includes("envasadora") || s.includes("datador") || s.includes("dosadora")) {
    return "maquinas";
  }
  if (s.includes("comercial") || s.includes("funil comercial")) return "comercial";
  return "maquinas";
}

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

      const matchDbOp = (flowOp: { id: string; name: string; email?: string }) => {
        const normFlowName = normalizeOpName(flowOp.name);
        return dbOperators.find(
          (o) =>
            o.id === flowOp.id ||
            (o.email && flowOp.email && o.email.toLowerCase().trim() === flowOp.email.toLowerCase().trim()) ||
            (normFlowName && normalizeOpName(o.name) === normFlowName)
        );
      };

      // Se já existem flowOperators salvos, usamos exclusivamente os configurados
      if (Array.isArray(configData.flowOperators)) {
        const todayBrt = getBrtTodayYmd();
        const mappedOps: FlowOperator[] = configData.flowOperators.map((flowOp: FlowOperator) => {
          const matchedDbOp = matchDbOp(flowOp);
          const areaKey = flowOp.area || "maquinas";
          const activeLeave = isOperatorOnLeaveToday(flowOp, todayBrt);

          return {
            ...flowOp,
            id: matchedDbOp?.id || flowOp.id,
            name: matchedDbOp?.name || flowOp.name,
            email: matchedDbOp?.email || flowOp.email,
            avatar: matchedDbOp?.avatar || flowOp.avatar,
            isParticipating: flowOp.isParticipating ?? true,
            isOnLeave: activeLeave,
            leaveDate: activeLeave ? flowOp.leaveDate || todayBrt : null,
            isPenalized: flowOp.isPenalized ?? false,
            area: areaKey,
            departmentTag: flowOp.departmentTag || getDefaultDepartmentForArea(areaKey),
            roleTag: getDefaultRoleTagForArea(areaKey, flowOp.roleTag),
            funnels: getAiPersona(tenantId).triagePolicy === "industrial"
              ? normalizeIndustrialFunnels(Array.isArray(flowOp.funnels) ? flowOp.funnels : [])
              : Array.isArray(flowOp.funnels) && flowOp.funnels.length > 0 ? flowOp.funnels : ["Máquinas"],
            compensation: flowOp.compensation ?? 0,
            leadsReceivedCount: flowOp.leadsReceivedCount ?? 0,
            recentLeads: flowOp.recentLeads || [],
          };
        });
        await this.ensureFluxosOperatorsInSectors(tenantId, mappedOps);
        return mappedOps;
      }

      // Consulta não cadastra equipe nem habilita uma operação em implantação.
      if (getAiPersona(tenantId).triagePolicy === "industrial") return [];

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
   * Sincroniza automaticamente os operadores das Pastas de Fluxos nos setores do tenant
   * para que o handoff siga 100% a ordem do Rodízio das pastas sem travar por setor ausente.
   */
  static async ensureFluxosOperatorsInSectors(tenantId: string, flowOps: FlowOperator[]): Promise<void> {
    if (getAiPersona(tenantId).triagePolicy !== "industrial" || !flowOps.length) return;
    try {
      const flowIds = Array.from(new Set(flowOps.map((op) => op.id).filter(Boolean)));
      if (!flowIds.length) return;
      const tenantSectors = await db
        .select()
        .from(sectors)
        .where(eq(sectors.tenantId, tenantId));
      for (const sec of tenantSectors) {
        const currentIds = Array.isArray(sec.operatorIds) ? sec.operatorIds : [];
        const missing = flowIds.filter((id) => !currentIds.includes(id));
        if (missing.length > 0) {
          await db
            .update(sectors)
            .set({ operatorIds: [...currentIds, ...missing] })
            .where(and(eq(sectors.tenantId, tenantId), eq(sectors.id, sec.id)));
        }
      }
    } catch {
      // Silencioso para não afetar consultas do rodízio
    }
  }

  /**
   * Salva a lista integral de operadores da escala/fluxo no agentConfigs
   */
  static async saveFlowOperators(tenantId: string, flowOps: FlowOperator[]): Promise<boolean> {
    try {
      if (getAiPersona(tenantId).triagePolicy === "industrial") {
        const nextOps = await mutateIndustrialRodizio(db, tenantId, (current) => flowOps.map((op) => {
          const previous = current.find((item) => item.id === op.id);
          return previous ? mergeIndustrialOperatorSettings(previous, op) : { ...op, leadsReceivedCount: 0, compensation: 0, recentLeads: [] };
        }));
        await this.ensureFluxosOperatorsInSectors(tenantId, nextOps);
        return true;
      }
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
          .where(and(eq(agentConfigs.id, existingConfig.id), eq(agentConfigs.tenantId, tenantId)));
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

    const areaKey = newOp.area || "maquinas";
    const fullOp: FlowOperator = {
      id: newOp.id,
      name: newOp.name,
      email: newOp.email || "",
      avatar: newOp.avatar || undefined,
      isParticipating: newOp.isParticipating ?? true,
      isOnLeave: newOp.isOnLeave ?? false,
      leaveDate: newOp.isOnLeave ? getBrtTodayYmd() : null,
      isPenalized: newOp.isPenalized ?? false,
      area: areaKey,
      funnels: Array.isArray(newOp.funnels) && newOp.funnels.length > 0 ? newOp.funnels : ["Máquinas"],
      compensation: typeof newOp.compensation === "number" ? newOp.compensation : 0,
      crmId: newOp.crmId || `${newOp.name} (${newOp.email || ""})`,
      departmentTag: newOp.departmentTag || getDefaultDepartmentForArea(areaKey),
      roleTag: getDefaultRoleTagForArea(areaKey, newOp.roleTag),
      talosId: newOp.talosId || "",
      leadsReceivedCount: newOp.leadsReceivedCount || 0,
      recentLeads: newOp.recentLeads || [],
      addedAt: new Date().toISOString(),
    };

    if (getAiPersona(tenantId).triagePolicy === "industrial") {
      return mutateIndustrialRodizio(db, tenantId, (current) => {
        const previous = current.find((op) => op.id === fullOp.id);
        return previous ? current.map((op) => op.id === fullOp.id ? mergeIndustrialOperatorSettings(op, fullOp) : op)
          : [...current, { ...fullOp, compensation: Math.max(0, fullOp.compensation || 0), leadsReceivedCount: 0, recentLeads: [] }];
      });
    }
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
    if (getAiPersona(tenantId).triagePolicy === "industrial") {
      return mutateIndustrialRodizio(db, tenantId, (ops) => ops.map((op) => op.id === operatorId ? mergeIndustrialOperatorSettings(op, patch) : op));
    }
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
    if (getAiPersona(tenantId).triagePolicy === "industrial")
      return mutateIndustrialRodizio(db, tenantId, (ops) => ops.filter((op) => op.id !== operatorId));
    const currentOps = await this.getRodizioState(tenantId);
    const updatedList = currentOps.filter((op) => op.id !== operatorId);
    await this.saveFlowOperators(tenantId, updatedList);
    return updatedList;
  }

  /**
   * Alterna a participação em um funil específico
   */
  static async toggleFunnel(tenantId: string, operatorId: string, funnel: string): Promise<FlowOperator[]> {
    if (getAiPersona(tenantId).triagePolicy === "industrial") {
      funnel = normalizeIndustrialFunnel(funnel);
      return mutateIndustrialRodizio(db, tenantId, (ops) => ops.map((op) => op.id !== operatorId ? op : {
        ...op, funnels: (op.funnels || []).includes(funnel) ? op.funnels.filter((item) => item !== funnel) : [...(op.funnels || []), funnel],
      }));
    }
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
   * Alterna folga diária do operador (remove apenas no dia atual, NUNCA altera compensação)
   */
  static async toggleLeave(tenantId: string, operatorId: string): Promise<FlowOperator[]> {
    const todayBrt = getBrtTodayYmd();
    if (getAiPersona(tenantId).triagePolicy === "industrial") {
      return mutateIndustrialRodizio(db, tenantId, (ops) =>
        ops.map((op) => {
          if (op.id !== operatorId) return op;
          const nextLeave = !isOperatorOnLeaveToday(op, todayBrt);
          return {
            ...op,
            isOnLeave: nextLeave,
            leaveDate: nextLeave ? todayBrt : null,
            compensation: op.compensation ?? 0,
          };
        }),
      );
    }
    const currentOps = await this.getRodizioState(tenantId);
    const updatedList = currentOps.map((op) => {
      if (op.id !== operatorId) return op;
      const nextLeave = !isOperatorOnLeaveToday(op, todayBrt);
      return {
        ...op,
        isOnLeave: nextLeave,
        leaveDate: nextLeave ? todayBrt : null,
        compensation: op.compensation ?? 0,
      };
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
    if (getAiPersona(tenantId).triagePolicy === "industrial")
      return mutateIndustrialRodizio(db, tenantId, (ops) => ops.map((op) => op.id !== operatorId ? op : {
        ...op, compensation: Math.max(0, isAbsolute ? valueOrDelta : (op.compensation || 0) + valueOrDelta),
      }));
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
      if (getAiPersona(tenantId).triagePolicy === "industrial") {
        await mutateIndustrialRodizio(db, tenantId, (ops) => ops.map((op) => {
          const patch = updatedOps.find((item) => item.id === op.id);
          return patch ? mergeIndustrialOperatorSettings(op, patch) : op;
        }));
        return true;
      }
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
    if (getAiPersona(tenantId).triagePolicy === "industrial")
      return mutateIndustrialRodizio(db, tenantId, (ops) => ops.map((op) => ({ ...op, leadsReceivedCount: 0, recentLeads: [] })));
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

        const { ensureLeadTransferTaskOnDeal } = await import("./sdr-crm-local");
        const aiPersona = getAiPersona(tenantId);
        for (const dealId of dealIdList) {
          await ensureLeadTransferTaskOnDeal({
            tenantId,
            dealId,
            conversationId: conv?.id || "",
            operatorId: toOperatorId,
            operatorName: toOperatorName,
          });
          await db.insert(crmDealEvents).values({
            id: `cdev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            tenantId,
            dealId,
            eventType: "owner_changed",
            operatorId: null,
            metadata: {
              source: "rodizio_reassignment",
              actorName: aiPersona.name,
              actorType: "ai_sdr",
              toOperatorId,
              toOperatorName,
            },
            createdAt: now,
          });
        }
      }

      // 2. Atualizar compensações no agentConfigs do rodízio e na escala flowOperators
      if (getAiPersona(tenantId).triagePolicy === "industrial") {
        await mutateIndustrialRodizio(db, tenantId, (ops, config) => {
          const compensations = { ...((config.compensations || {}) as Record<string, number>) };
          compensations[toOperatorId] = (compensations[toOperatorId] || 0) + 1;
          config.compensations = compensations;
          config.reassignments = [{ cardId, toOperatorId, toOperatorName, at: now.toISOString() },
            ...((config.reassignments || []) as unknown[])].slice(0, 100);
          return ops.map((op) => op.id !== toOperatorId ? op : { ...op, compensation: (op.compensation || 0) + 1 });
        });
      } else {
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
          .where(and(eq(agentConfigs.id, existingConfig.id), eq(agentConfigs.tenantId, tenantId)));
      }
      }

      if (conv?.id) {
        const { notifyOperatorLeadTransferred } = await import("./operator-notifications");
        await notifyOperatorLeadTransferred({
          tenantId,
          operatorId: toOperatorId,
          operatorName: toOperatorName,
          conversationId: conv.id,
          temperature: "quente",
          transferSource: "rodizio_reassignment",
        });
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
      if (getAiPersona(tenantId).triagePolicy === "industrial") {
        await mutateIndustrialRodizio(db, tenantId, (ops, config) => {
          config.removedCards = Array.from(new Set([...((config.removedCards || []) as string[]), cardId]));
          return ops;
        });
        return { success: true };
      }
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
        .where(and(eq(agentConfigs.id, existingConfig.id), eq(agentConfigs.tenantId, tenantId)));

      return { success: true };
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao remover card:", err);
      return { success: false, error: err?.message };
    }
  }

  /**
   * Obtém os dados 100% reais de inteligência do Dashboard de Rodízio
   * Conectado exclusivamente ao banco PostgreSQL (agentFlowStates, crmDeals,
   * crmConversationDeals, conversations, contacts, operators, sectors e aiUsageLogs).
   */
  static async getDashboardData(
    tenantId: string = "valem",
    options: { days?: number; opDays?: number; dateFrom?: string; dateTo?: string } = {}
  ) {
    try {
      const { getEmptyRodizioData, getOperatorSector, getPosVendaSubTeam } = await import(
        "../../components/valentina/rodizio-dashboard-data"
      );
      const persona = getAiPersona(tenantId);
      const now = new Date();

      const statsDays = options.days && options.days > 0 ? options.days : 3650;
      const statsCutoff = new Date(now.getTime() - statsDays * 24 * 60 * 60 * 1000);

      // Filtro de janela de tempo para a seção "Leads por Operador"
      let opStartMs: number | null = null;
      let opEndMs: number | null = null;

      if (options.dateFrom && options.dateTo) {
        const start = new Date(`${options.dateFrom}T00:00:00.000-03:00`).getTime();
        const end = new Date(`${options.dateTo}T23:59:59.999-03:00`).getTime();
        if (Number.isFinite(start)) opStartMs = start;
        if (Number.isFinite(end)) opEndMs = end;
      } else if (options.dateFrom) {
        const start = new Date(`${options.dateFrom}T00:00:00.000-03:00`).getTime();
        const end = new Date(`${options.dateFrom}T23:59:59.999-03:00`).getTime();
        if (Number.isFinite(start)) opStartMs = start;
        if (Number.isFinite(end)) opEndMs = end;
      } else if (options.opDays && options.opDays > 0 && options.opDays < 3650) {
        opStartMs = now.getTime() - options.opDays * 24 * 60 * 60 * 1000;
      }

      const isWithinOpWindow = (dateVal: Date | string | null | undefined): boolean => {
        if (opStartMs === null && opEndMs === null) return true;
        if (!dateVal) return true;
        const ms = dateVal instanceof Date ? dateVal.getTime() : new Date(dateVal).getTime();
        if (!Number.isFinite(ms)) return true;
        if (opStartMs !== null && ms < opStartMs) return false;
        if (opEndMs !== null && ms > opEndMs) return false;
        return true;
      };

      const isWithinStatsWindow = (dateVal: Date | string | null | undefined): boolean => {
        if (!dateVal) return true;
        const ms = dateVal instanceof Date ? dateVal.getTime() : new Date(dateVal).getTime();
        if (!Number.isFinite(ms)) return true;
        return ms >= statsCutoff.getTime();
      };

      // 1. Buscar operadores reais do tenant, setores e escala atual
      const [dbOps, dbSectors, flowOps, configRow] = await Promise.all([
        db
          .select()
          .from(operators)
          .where(eq(operators.tenantId, tenantId))
          .orderBy(asc(operators.name)),
        db
          .select()
          .from(sectors)
          .where(eq(sectors.tenantId, tenantId)),
        this.getRodizioState(tenantId),
        db.query.agentConfigs.findFirst({
          where: (t, { eq: dEq, and: dAnd }) =>
            dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "rodizio")),
        }),
      ]);

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

      // Mapear setores do banco por operatorId
      const dbSectorByOpId = new Map<string, string>();
      for (const sec of dbSectors) {
        const ids = Array.isArray(sec.operatorIds) ? sec.operatorIds : [];
        for (const id of ids) {
          if (!dbSectorByOpId.has(id)) {
            dbSectorByOpId.set(id, sec.name);
          }
        }
      }

      // Construir mapa canônico de operadores (unificando dbOps + flowOps sem duplicatas)
      const aliasToCanonicalId = new Map<string, string>();
      const canonicalOpsMap = new Map<
        string,
        {
          id: string;
          name: string;
          email: string;
          avatar?: string | null;
          sector?: string | null;
          rawArea?: string | null;
          allowed_subflows?: string[] | null;
          compensation: number;
          isParticipating: boolean;
          isOnLeave: boolean;
          isPenalized: boolean;
          isInFlow: boolean;
        }
      >();

      for (const dbOp of dbOps) {
        aliasToCanonicalId.set(dbOp.id, dbOp.id);
        const saved = storedOpsMap[dbOp.id];
        canonicalOpsMap.set(dbOp.id, {
          id: dbOp.id,
          name: dbOp.name,
          email: dbOp.email,
          avatar: dbOp.avatar,
          sector: dbSectorByOpId.get(dbOp.id) || null,
          rawArea: null,
          allowed_subflows: null,
          compensation: compensations[dbOp.id] ?? 0,
          isParticipating: saved?.isParticipating ?? true,
          isOnLeave: saved?.isOnLeave ?? false,
          isPenalized: saved?.isPenalized ?? false,
          isInFlow: false,
        });
      }

      for (const fOp of flowOps) {
        const normFName = normalizeOpName(fOp.name);
        const matchedDb = dbOps.find(
          (o) =>
            o.id === fOp.id ||
            (o.email && fOp.email && o.email.toLowerCase().trim() === fOp.email.toLowerCase().trim()) ||
            (normFName && normalizeOpName(o.name) === normFName)
        );

        const canonicalId = matchedDb?.id || fOp.id;
        aliasToCanonicalId.set(fOp.id, canonicalId);
        if (matchedDb) aliasToCanonicalId.set(matchedDb.id, canonicalId);

        const existing = canonicalOpsMap.get(canonicalId);
        const saved = storedOpsMap[canonicalId] || storedOpsMap[fOp.id];
        const comp =
          fOp.compensation !== undefined
            ? fOp.compensation
            : compensations[canonicalId] ?? compensations[fOp.id] ?? existing?.compensation ?? 0;

        canonicalOpsMap.set(canonicalId, {
          id: canonicalId,
          name: fOp.name || existing?.name || "Operador",
          email: matchedDb?.email || fOp.email || existing?.email || "",
          avatar: matchedDb?.avatar || fOp.avatar || existing?.avatar || null,
          sector: fOp.area || existing?.sector || null,
          rawArea: fOp.area || existing?.rawArea || null,
          allowed_subflows: Array.isArray(fOp.funnels) && fOp.funnels.length > 0 ? fOp.funnels : existing?.allowed_subflows || null,
          compensation: comp,
          isParticipating: fOp.isParticipating ?? saved?.isParticipating ?? existing?.isParticipating ?? true,
          isOnLeave: fOp.isOnLeave ?? saved?.isOnLeave ?? existing?.isOnLeave ?? false,
          isPenalized: fOp.isPenalized ?? saved?.isPenalized ?? existing?.isPenalized ?? false,
          isInFlow: true,
        });
      }

      // Também mapear IDs legados de DEFAULT_TECFAG_FLOW_OPERATORS caso algum registro aponte para eles
      for (const defOp of DEFAULT_TECFAG_FLOW_OPERATORS) {
        if (!aliasToCanonicalId.has(defOp.id)) {
          const normDef = normalizeOpName(defOp.name);
          const matched = Array.from(canonicalOpsMap.values()).find(
            (c) =>
              (c.email && defOp.email && c.email.toLowerCase().trim() === defOp.email.toLowerCase().trim()) ||
              (normDef && normalizeOpName(c.name) === normDef)
          );
          if (matched) {
            aliasToCanonicalId.set(defOp.id, matched.id);
          }
        }
      }

      const resolveOpId = (rawId: string | null | undefined): string => {
        if (!rawId) return "";
        return aliasToCanonicalId.get(rawId) || rawId;
      };

      // 2. Buscar negociações reais vinculadas a conversas/triagens no CRM Local
      const realDealsRows = await db
        .select({
          dealId: crmDeals.id,
          title: crmDeals.title,
          operatorId: crmDeals.operatorId,
          rating: crmDeals.rating,
          createdAt: crmDeals.createdAt,
          funnelName: crmPipelines.name,
          accountName: crmAccounts.name,
          accountDoc: crmAccounts.document,
          accountPhone: crmAccounts.phone,
          conversationId: crmConversationDeals.conversationId,
          origin: crmConversationDeals.origin,
          convOperatorId: conversations.operatorId,
          contactName: contacts.name,
          contactPhone: contacts.phone,
          contactCnpj: contacts.cnpj,
          contactCpf: contacts.cpf,
          contactCnpjDetails: contacts.cnpjDetails,
        })
        .from(crmConversationDeals)
        .innerJoin(
          crmDeals,
          and(
            eq(crmConversationDeals.dealId, crmDeals.id),
            eq(crmDeals.tenantId, tenantId)
          )
        )
        .leftJoin(
          crmPipelines,
          and(
            eq(crmDeals.pipelineId, crmPipelines.id),
            eq(crmPipelines.tenantId, tenantId)
          )
        )
        .leftJoin(
          crmAccounts,
          and(
            eq(crmDeals.accountId, crmAccounts.id),
            eq(crmAccounts.tenantId, tenantId)
          )
        )
        .leftJoin(
          conversations,
          and(
            eq(crmConversationDeals.conversationId, conversations.id),
            eq(conversations.tenantId, tenantId)
          )
        )
        .leftJoin(
          contacts,
          and(
            eq(conversations.contactId, contacts.id),
            eq(contacts.tenantId, tenantId)
          )
        )
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.isActive, true)
          )
        )
        .orderBy(desc(crmDeals.createdAt))
        .limit(500);

      // 3. Buscar sessões reais de triagem da IA em agentFlowStates
      const realFlowStates = await db
        .select({
          id: agentFlowStates.id,
          conversationId: agentFlowStates.conversationId,
          currentStep: agentFlowStates.currentStep,
          collectedData: agentFlowStates.collectedData,
          metadata: agentFlowStates.metadata,
          startedAt: agentFlowStates.startedAt,
          lastInteractionAt: agentFlowStates.lastInteractionAt,
          completedAt: agentFlowStates.completedAt,
          outcome: agentFlowStates.outcome,
          convOperatorId: conversations.operatorId,
          convQueueState: conversations.queueState,
          contactName: contacts.name,
          contactPhone: contacts.phone,
          contactCnpj: contacts.cnpj,
          contactCpf: contacts.cpf,
          contactCnpjDetails: contacts.cnpjDetails,
        })
        .from(agentFlowStates)
        .leftJoin(
          conversations,
          and(
            eq(agentFlowStates.conversationId, conversations.id),
            eq(conversations.tenantId, tenantId)
          )
        )
        .leftJoin(
          contacts,
          and(
            eq(conversations.contactId, contacts.id),
            eq(contacts.tenantId, tenantId)
          )
        )
        .where(eq(agentFlowStates.tenantId, tenantId))
        .orderBy(desc(agentFlowStates.lastInteractionAt))
        .limit(500);

      // 4. Processar cards reais dos operadores e lista de Deals no CRM
      const realCardsByOpId = new Map<string, any[]>();
      const activeAiTriageCards: any[] = [];
      const realCrmDealsList: any[] = [];
      const seenDealIds = new Set<string>();
      const seenConvIdsInOpCards = new Set<string>();

      // Mapa unificado de leads capturados na janela de estatísticas (Visão Geral)
      const leadsInStatsWindow = new Map<
        string,
        {
          dateIso: string;
          funnelKey: string;
          isTriageDone: boolean;
          lmsScore: number;
          hasCnpj: boolean;
        }
      >();

      for (const row of realDealsRows) {
        if (seenDealIds.has(row.dealId)) continue;
        seenDealIds.add(row.dealId);

        const reassigned =
          reassignMap.get(row.dealId) ||
          (row.conversationId ? reassignMap.get(row.conversationId) : undefined);

        const rawOpId = reassigned?.toOperatorId || row.operatorId || row.convOperatorId || "";
        const effectiveOpId = resolveOpId(rawOpId);
        const effectiveOpName =
          reassigned?.toOperatorName ||
          (effectiveOpId ? canonicalOpsMap.get(effectiveOpId)?.name : null) ||
          "Operador";

        const createdAtDate = row.createdAt ? new Date(row.createdAt) : now;
        const createdAtIso = createdAtDate.toISOString();

        const companyName =
          row.accountName ||
          (row.contactCnpjDetails as any)?.razaoSocial ||
          (row.contactCnpjDetails as any)?.nomeFantasia ||
          null;
        const phoneStr = row.accountPhone || row.contactPhone || null;
        const cardDisplayName = row.contactName || row.title;
        const funnelKey = normalizeFunnelKey(row.funnelName || "maquinas");

        const isCardRemoved =
          removedCards.includes(row.dealId) ||
          (row.conversationId ? removedCards.includes(row.conversationId) : false);

        if (effectiveOpId && !isCardRemoved && isWithinOpWindow(createdAtDate)) {
          const opCards = realCardsByOpId.get(effectiveOpId) || [];
          opCards.push({
            id: row.conversationId || row.dealId,
            name: cardDisplayName,
            company: companyName,
            created_at: createdAtIso,
            chatId: row.conversationId || undefined,
            rdDealId: row.dealId,
            phone: phoneStr,
            subject: row.funnelName || null,
          });
          realCardsByOpId.set(effectiveOpId, opCards);
          if (row.conversationId) {
            seenConvIdsInOpCards.add(row.conversationId);
          }
        }

        if (isWithinStatsWindow(createdAtDate)) {
          realCrmDealsList.push({
            id: row.dealId,
            name: row.title,
            company: companyName,
            phone: phoneStr,
            rd_deal_id: row.dealId,
            operator_name: effectiveOpName,
            sector: row.funnelName || "Comercial",
            funnel: funnelKey,
            created_at: createdAtIso,
          });

          const leadKey = row.conversationId || `deal:${row.dealId}`;
          const hasDoc = Boolean(row.accountDoc || row.contactCnpj || row.contactCpf);
          const dealRatingScore =
            typeof row.rating === "number" && row.rating > 0
              ? Math.min(3, (row.rating / 5) * 3)
              : companyName && hasDoc
                ? 2.7
                : companyName
                  ? 2.2
                  : 1.8;

          leadsInStatsWindow.set(leadKey, {
            dateIso: createdAtIso.slice(0, 10),
            funnelKey,
            isTriageDone: true,
            lmsScore: dealRatingScore,
            hasCnpj: hasDoc,
          });
        }
      }

      // 5. Processar sessões de triagem reais (agentFlowStates)
      let activeRealSessions = 0;

      for (const fs of realFlowStates) {
        const collected = (fs.collectedData as Record<string, any>) || {};
        const meta = (fs.metadata as Record<string, any>) || {};

        const isActiveSession =
          fs.outcome === "in_progress" ||
          (!fs.outcome && fs.currentStep !== "Concluído");
        const isCompletedSession =
          fs.outcome === "completed" ||
          fs.outcome === "transferred" ||
          fs.currentStep === "Concluído";

        if (isActiveSession) {
          activeRealSessions += 1;
        }

        const clientName =
          collected["NOME COMPLETO"]?.value ||
          collected["nome"]?.value ||
          fs.contactName ||
          "Cliente WhatsApp";

        const companyName =
          (collected["EMPRESA"]?.status === "filled" ? collected["EMPRESA"]?.value : null) ||
          (collected["_RECEITA_FEDERAL"] as any)?.razaoSocial ||
          (fs.contactCnpjDetails as any)?.razaoSocial ||
          null;

        const docValue =
          (collected["CNPJ OU CPF"]?.status === "filled" ? collected["CNPJ OU CPF"]?.value : null) ||
          (collected["CNPJ"]?.status === "filled" ? collected["CNPJ"]?.value : null) ||
          fs.contactCnpj ||
          fs.contactCpf ||
          null;

        const rawFunnel =
          meta.targetFunnel ||
          meta.funnelStage ||
          collected["SETOR / FUNIL DE DESTINO"]?.value ||
          (isActiveSession ? "triagem" : "maquinas");
        const funnelKey = normalizeFunnelKey(rawFunnel);

        // Calcular Score LMS real (0.0 a 3.0) baseado no preenchimento real dos campos de triagem
        const filledFieldsCount = Object.entries(collected).filter(
          ([k, v]) =>
            !k.startsWith("_") &&
            v &&
            typeof v === "object" &&
            v.status === "filled" &&
            v.value &&
            v.value !== "Aguardando..."
        ).length;
        const lmsScore = Math.min(3.0, Math.max(0.5, (filledFieldsCount / 6) * 3.0));

        const refDate = fs.lastInteractionAt || fs.startedAt || now;
        const refDateObj = refDate instanceof Date ? refDate : new Date(refDate);
        const refDateIso = refDateObj.toISOString();

        // Se a conversa da triagem ainda não gerou card via realDealsRows, incluir no painel
        const isCardRemoved = removedCards.includes(fs.conversationId) || removedCards.includes(fs.id);
        if (!seenConvIdsInOpCards.has(fs.conversationId) && !isCardRemoved && isWithinOpWindow(refDateObj)) {
          const reassigned = reassignMap.get(fs.conversationId);
          const rawOpId =
            reassigned?.toOperatorId ||
            fs.convOperatorId ||
            meta.allocatedOperatorId ||
            "";
          const effectiveOpId = resolveOpId(rawOpId);

          const dealIdFromMeta =
            meta.localCrmDealId ||
            meta.handoffReceipt?.result?.deal?.dealId ||
            meta.dealId ||
            undefined;

          const cardObj = {
            id: fs.conversationId,
            name: clientName !== "Aguardando..." ? clientName : fs.contactName || "Cliente em Triagem",
            company: companyName && companyName !== "Aguardando..." ? companyName : null,
            created_at: refDateIso,
            chatId: fs.conversationId,
            rdDealId: dealIdFromMeta,
            phone: fs.contactPhone || null,
            subject: meta.targetFunnel || null,
          };

          if (effectiveOpId && canonicalOpsMap.has(effectiveOpId)) {
            const opCards = realCardsByOpId.get(effectiveOpId) || [];
            opCards.push(cardObj);
            realCardsByOpId.set(effectiveOpId, opCards);
            seenConvIdsInOpCards.add(fs.conversationId);
          } else if (isActiveSession) {
            activeAiTriageCards.push(cardObj);
            seenConvIdsInOpCards.add(fs.conversationId);
          }
        }

        // Registrar na janela de estatísticas da Visão Geral
        if (isWithinStatsWindow(fs.startedAt || refDateObj)) {
          const existingLead = leadsInStatsWindow.get(fs.conversationId);
          leadsInStatsWindow.set(fs.conversationId, {
            dateIso: (fs.startedAt ? new Date(fs.startedAt) : refDateObj).toISOString().slice(0, 10),
            funnelKey: existingLead?.funnelKey && existingLead.funnelKey !== "maquinas" ? existingLead.funnelKey : funnelKey,
            isTriageDone: Boolean(existingLead?.isTriageDone || isCompletedSession),
            lmsScore: existingLead ? Math.max(existingLead.lmsScore, lmsScore) : lmsScore,
            hasCnpj: Boolean(existingLead?.hasCnpj || docValue),
          });
        }
      }

      // 6. Montar a lista de operadores 100% real para as 6 colunas
      const operatorRows: any[] = [];

      // Se houver sessões ativas em triagem na IA (ou para exibir a fila viva do Fagner/Valentina na coluna SDR / Análise)
      if (activeAiTriageCards.length > 0) {
        operatorRows.push({
          id: `ai-sdr-${tenantId}`,
          name: `${persona.name} (Triagem IA)`,
          email: `sdr@${tenantId}.ia`,
          avatar: persona.avatar,
          count: activeAiTriageCards.length,
          compensation: 0,
          sector: "sdr",
          rawArea: "sdr",
          is_sdr: true,
          isParticipating: true,
          isOnLeave: false,
          isPenalized: false,
          cards: activeAiTriageCards,
        });
      }

      const hasConfiguredFlowScale = flowOps.length > 0;

      for (const op of canonicalOpsMap.values()) {
        const opCards = realCardsByOpId.get(op.id) || [];
        const normOpSector = (op.sector || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const normOpNameStr = normalizeOpName(op.name);
        const isSdrAnalyst =
          normOpSector === "sdr" ||
          normOpSector.includes("sdr") ||
          normOpSector.includes("triagem") ||
          normOpNameStr.includes("rafaela lima");

        if (hasConfiguredFlowScale) {
          // Quando a escala em Fluxos está configurada, exibir apenas os operadores da escala (+ analista SDR)
          // evitando que operadores de setores gerais do chat (ex: Leticia Cardoso em "Comercial") caiam no fallback de Máquinas
          if (!op.isInFlow && !isSdrAnalyst) {
            continue;
          }
        } else if (!op.isInFlow && !op.sector && opCards.length === 0) {
          continue;
        }

        // Se o operador não tem setor explícito, inferir pelo funil dos cards reais dele ou pelo classificador de setor
        const dominantCardSector = opCards.find((c) => c.subject)?.subject || null;
        const resolvedSector = getOperatorSector({
          name: op.name,
          sector: op.sector || dominantCardSector,
          rawArea: op.rawArea,
          allowed_subflows: op.allowed_subflows,
          is_sdr: op.sector === "sdr" || isSdrAnalyst,
        });

        const subTeam =
          resolvedSector === "pos venda"
            ? getPosVendaSubTeam({
                name: op.name,
                sector: op.sector,
                rawArea: op.rawArea,
                allowed_subflows: op.allowed_subflows,
              })
            : undefined;

        operatorRows.push({
          id: op.id,
          name: op.name,
          email: op.email,
          avatar: op.avatar,
          sector: resolvedSector,
          rawArea: op.rawArea || op.sector || null,
          subTeam,
          allowed_subflows: op.allowed_subflows || undefined,
          is_sdr: resolvedSector === "sdr",
          compensation: op.compensation,
          count: opCards.length,
          isParticipating: op.isParticipating,
          isOnLeave: op.isOnLeave,
          isPenalized: op.isPenalized,
          cards: opCards,
        });
      }

      // 7. Calcular KPIs e Gráficos 100% Reais da Visão Geral
      const totalLeads = leadsInStatsWindow.size;
      let triageDone = 0;
      let totalScoreSum = 0;
      let leadsWithCnpj = 0;
      const dayCountsMap = new Map<string, number>();
      const funnelCountsMap = new Map<string, number>();

      for (const item of leadsInStatsWindow.values()) {
        if (item.isTriageDone) triageDone += 1;
        totalScoreSum += item.lmsScore;
        if (item.hasCnpj) leadsWithCnpj += 1;

        dayCountsMap.set(item.dateIso, (dayCountsMap.get(item.dateIso) || 0) + 1);
        funnelCountsMap.set(item.funnelKey, (funnelCountsMap.get(item.funnelKey) || 0) + 1);
      }

      const triageRate = totalLeads > 0 ? Math.round((triageDone / totalLeads) * 100) : 0;
      const avgScore = totalLeads > 0 ? (totalScoreSum / totalLeads).toFixed(1) : "0.0";

      // Série temporal real para o gráfico "Leads por Dia" (últimos N dias até 30 barras)
      const chartDaysCount = Math.min(statsDays, 30);
      const byDay: Array<{ day: string; count: number }> = [];
      for (let i = chartDaysCount - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayKey = d.toISOString().slice(0, 10);
        byDay.push({
          day: dayKey,
          count: dayCountsMap.get(dayKey) || 0,
        });
      }

      // Distribuição real por funil ordenada por volume
      const byFunnel = Array.from(funnelCountsMap.entries())
        .map(([funnel, count]) => ({ funnel, count }))
        .filter((f) => f.count > 0)
        .sort((a, b) => b.count - a.count);

      // Custos reais de IA dos últimos 30 dias em aiUsageLogs
      let totalCost30d = 0;
      try {
        const costCutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const usageRows = await db
          .select({ costBrl: aiUsageLogs.costBrl })
          .from(aiUsageLogs)
          .where(and(eq(aiUsageLogs.tenantId, tenantId), gte(aiUsageLogs.createdAt, costCutoff30d)));

        for (const u of usageRows) {
          const val = parseFloat(u.costBrl || "0");
          if (Number.isFinite(val)) totalCost30d += val;
        }
      } catch {
        // Ignora silenciosamente se tabela de logs não estiver acessível
      }

      const costPerLead = totalLeads > 0 ? Number((totalCost30d / totalLeads).toFixed(2)) : 0;

      return {
        stats: {
          totalLeads,
          syncedToCrm: realCrmDealsList.length,
          triageDone,
          triageRate,
          activeSessions: activeRealSessions,
          avgScore,
          costPerLead,
          totalCost30d: Number(totalCost30d.toFixed(2)),
          leadsWithCnpj,
        },
        byDay,
        byFunnel,
        operators: operatorRows,
        deals: realCrmDealsList,
      };
    } catch (err: any) {
      console.error("[RodizioEngine] Erro ao montar dashboard real do rodízio:", err?.message);
      const { getEmptyRodizioData } = await import(
        "../../components/valentina/rodizio-dashboard-data"
      );
      return getEmptyRodizioData();
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
      strictFunnel?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<FlowOperator | null> {
    if (getAiPersona(tenantId).triagePolicy === "industrial") {
      throw new Error("Triagem industrial exige o handoff transacional com chave do ciclo.");
    }
    try {
      const allOps = await this.getRodizioState(tenantId);
      if (options?.signal?.aborted) return null;
      const validOperatorIds = options?.strictFunnel
        ? new Set((await db.select({ id: operators.id }).from(operators).where(eq(operators.tenantId, tenantId))).map((operator) => operator.id))
        : null;

      // Filtra elegíveis: Participando = true, Folga = false, Penalizado = false
      const available = allOps.filter((o) => o.isParticipating && !o.isOnLeave && !o.isPenalized && (!validOperatorIds || validOperatorIds.has(o.id)));

      if (available.length === 0) {
        console.warn(`[RodizioEngine] Nenhum operador elegível no rodízio para tenant ${tenantId}. Mantendo na fila geral.`);
        return null;
      }

      let eligible = available;

      // Filtragem por Área / Funil se especificado
      if (targetAreaOrFunnel && targetAreaOrFunnel.trim() !== "") {
        const normTarget = targetAreaOrFunnel.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const areaMatches = available.filter((o) => {
          if (options?.strictFunnel) {
            return isEligibleIndustrialOperator(o, targetAreaOrFunnel, validOperatorIds!);
          }
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
          if (options?.strictFunnel) return null;
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
      if (options?.strictFunnel && !targetAreaOrFunnel?.trim()) return null;
      const timeNow = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      // 0. Hook opcional ANTES da transferência (ex: criar ou vincular card no CRM Local com janela de 3h)
      if (options?.beforeTransfer) {
        await options.beforeTransfer(chosenOperator);
      }
      if (options?.signal?.aborted) return null;

      // 1. Atualiza conversa para o operador alocado e coloca na aba "Meus Atendimentos"
      const assignedRows = await db
        .update(conversations)
        .set({
          operatorId: chosenOperator.id,
          queueState: "meus",
          updatedAt: new Date(),
        })
        .where(and(
          eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId),
          ...(options?.strictFunnel ? [isNull(conversations.operatorId), ne(conversations.queueState, "meus"), ne(conversations.queueState, "finalizados")] : []),
        ))
        .returning({ id: conversations.id });
      if (options?.strictFunnel && assignedRows.length === 0) return null;

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


