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
import { eq, and, asc, desc, inArray, gte, isNull, ne, sql } from "drizzle-orm";
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
  resolveRodizioOpTimeWindow,
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
      // 1. Buscar todos os operadores, setores e configuração salva do rodízio do tenant no banco
      const [dbOperators, dbSectors, configRow] = await Promise.all([
        db
          .select()
          .from(operators)
          .where(eq(operators.tenantId, tenantId))
          .orderBy(asc(operators.name)),
        db
          .select()
          .from(sectors)
          .where(eq(sectors.tenantId, tenantId)),
        db.query.agentConfigs.findFirst({
          where: (t, { eq: dEq, and: dAnd }) =>
            dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "rodizio")),
        }),
      ]);

      const configData = (configRow?.config as any) || {};

      // Identificar membros reais dos setores SDR vs Peças para corrigir SDR alocado por engano em Peças
      const sdrSectorOpIds = new Set<string>();
      const pecasSectorOpIds = new Set<string>();
      for (const sec of dbSectors) {
        const normSecName = (sec.name || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim();
        const opIds = Array.isArray(sec.operatorIds) ? sec.operatorIds : [];
        if (normSecName === "sdr" || normSecName.includes("sdr") || normSecName.includes("triagem")) {
          for (const id of opIds) sdrSectorOpIds.add(id);
        }
        if (normSecName.includes("peca")) {
          for (const id of opIds) pecasSectorOpIds.add(id);
        }
      }

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
        const isIndustrialPolicy = getAiPersona(tenantId).triagePolicy === "industrial";
        let needsIdHeal = false;
        const mappedOps: FlowOperator[] = configData.flowOperators.map((flowOp: FlowOperator) => {
          const matchedDbOp = matchDbOp(flowOp);
          const resolvedId = matchedDbOp?.id || flowOp.id;
          if (matchedDbOp && matchedDbOp.id !== flowOp.id) {
            needsIdHeal = true;
          }

          let areaKey = flowOp.area || "maquinas";
          let rawFunnels = Array.isArray(flowOp.funnels) ? flowOp.funnels : [];
          let rawRoleTag = flowOp.roleTag;

          // Auto-heal: se o colaborador pertence ao setor SDR (e não pertence ao setor Peças),
          // mas estava salvo na pasta "pecas" por falta de área SDR anterior, realoca para SDR / Análise
          const isPureSdrMember = sdrSectorOpIds.has(resolvedId) && !pecasSectorOpIds.has(resolvedId);
          if (isPureSdrMember && areaKey === "pecas") {
            areaKey = isIndustrialPolicy ? "outros" : "sdr";
            rawFunnels = isIndustrialPolicy ? ["Análise e revisão humana"] : ["SDR"];
            rawRoleTag = "SDR";
            needsIdHeal = true;
          }

          const activeLeave = isOperatorOnLeaveToday(flowOp, todayBrt);

          return {
            ...flowOp,
            id: resolvedId,
            name: matchedDbOp?.name || flowOp.name,
            email: matchedDbOp?.email || flowOp.email,
            avatar: matchedDbOp?.avatar || flowOp.avatar,
            isParticipating: flowOp.isParticipating ?? true,
            isOnLeave: activeLeave,
            leaveDate: activeLeave ? flowOp.leaveDate || todayBrt : null,
            isPenalized: flowOp.isPenalized ?? false,
            area: areaKey,
            departmentTag: flowOp.departmentTag || getDefaultDepartmentForArea(areaKey),
            roleTag: getDefaultRoleTagForArea(areaKey, rawRoleTag),
            funnels: isIndustrialPolicy
              ? normalizeIndustrialFunnels(rawFunnels)
              : rawFunnels.length > 0 ? rawFunnels : ["Máquinas"],
            compensation: flowOp.compensation ?? 0,
            leadsReceivedCount: flowOp.leadsReceivedCount ?? 0,
            recentLeads: flowOp.recentLeads || [],
          };
        });
        if (needsIdHeal && configRow) {
          const seenIds = new Set<string>();
          const healedOps = mappedOps.filter((op) => {
            if (seenIds.has(op.id)) return false;
            seenIds.add(op.id);
            return true;
          });
          if (isIndustrialPolicy) {
            mutateIndustrialRodizio(db, tenantId, (current) =>
              current.map((cur) => {
                const healed = healedOps.find(
                  (h) => h.id === cur.id || normalizeOpName(h.name) === normalizeOpName(cur.name),
                );
                if (!healed) return cur;
                return {
                  ...cur,
                  id: healed.id,
                  area: healed.area,
                  funnels: healed.funnels,
                  roleTag: healed.roleTag,
                };
              }),
            ).catch(() => {});
          } else {
            db.update(agentConfigs)
              .set({
                config: { ...configData, flowOperators: healedOps },
                updatedAt: new Date(),
              })
              .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.id, configRow.id)))
              .catch(() => {});
          }
          return healedOps;
        }
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
   * Desativado: operadores não devem ser injetados em massa em todos os setores do tenant.
   * Cada operador deve pertencer exclusivamente ao seu setor real definido em Equipe / Setores.
   */
  static async ensureFluxosOperatorsInSectors(_tenantId: string, _flowOps: FlowOperator[]): Promise<void> {
    return;
  }

  /**
   * Salva a lista integral de operadores da escala/fluxo no agentConfigs
   */
  static async saveFlowOperators(tenantId: string, flowOps: FlowOperator[]): Promise<boolean> {
    try {
      if (getAiPersona(tenantId).triagePolicy === "industrial") {
        await mutateIndustrialRodizio(db, tenantId, (current) => flowOps.map((op) => {
          const previous = current.find((item) => item.id === op.id);
          return previous ? mergeIndustrialOperatorSettings(previous, op) : { ...op, leadsReceivedCount: 0, compensation: 0, recentLeads: [] };
        }));
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

      // Filtro de janela de tempo para a seção "Leads por Operador" (padrão: Hoje no fuso de Brasília)
      const {
        startMs: opStartMs,
        endMs: opEndMs,
        startDate: opStartDate,
        endDate: opEndDate,
      } = resolveRodizioOpTimeWindow(options, now);
      const opStartIso = opStartDate ? opStartDate.toISOString() : null;
      const opEndIso = opEndDate ? opEndDate.toISOString() : null;

      const isWithinOpWindow = (dateVal: Date | string | null | undefined): boolean => {
        if (opStartMs === null && opEndMs === null) return true;
        if (!dateVal) return false;
        const ms = dateVal instanceof Date ? dateVal.getTime() : new Date(dateVal).getTime();
        if (!Number.isFinite(ms)) return false;
        if (opStartMs !== null && ms < opStartMs) return false;
        if (opEndMs !== null && ms > opEndMs) return false;
        return true;
      };

      const isWithinStatsWindow = (dateVal: Date | string | null | undefined): boolean => {
        if (!dateVal) return false;
        const ms = dateVal instanceof Date ? dateVal.getTime() : new Date(dateVal).getTime();
        if (!Number.isFinite(ms)) return false;
        return ms >= statsCutoff.getTime();
      };

      const extractQueryRows = <T = any>(res: unknown): T[] => {
        if (Array.isArray(res)) return res as T[];
        if (res && typeof res === "object" && Array.isArray((res as any).rows)) {
          return (res as any).rows as T[];
        }
        return [];
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
      const reassignments: Array<{ cardId: string; toOperatorId: string; toOperatorName?: string; at?: string }> =
        configData.reassignments || [];

      const reassignMap = new Map<string, { toOperatorId: string; toOperatorName?: string; at?: string }>();
      for (const r of reassignments) {
        if (!reassignMap.has(r.cardId)) {
          reassignMap.set(r.cardId, { toOperatorId: r.toOperatorId, toOperatorName: r.toOperatorName, at: r.at });
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

      const opSectorById = new Map<string, string>();
      for (const op of canonicalOpsMap.values()) {
        const normSec = (op.sector || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        opSectorById.set(
          op.id,
          getOperatorSector({
            name: op.name,
            sector: op.sector,
            rawArea: op.rawArea,
            allowed_subflows: op.allowed_subflows,
            is_sdr: !op.rawArea && (normSec === "sdr" || normSec.includes("sdr") || normSec.includes("triagem")),
          }),
        );
      }

      // Cutoffs para buscar os deals de Visão Geral + janela de operadores sem truncamento prematuro
      const dealsFetchStartDate =
        opStartDate === null
          ? statsDays >= 3650
            ? null
            : statsCutoff
          : opStartDate.getTime() < statsCutoff.getTime()
            ? opStartDate
            : statsCutoff;
      const dealsFetchStartIso = dealsFetchStartDate ? dealsFetchStartDate.toISOString() : null;

      // 2. Consultas parametrizadas por tenantId para capturar APENAS leads alocados/transferidos
      // (excluindo aberturas manuais próprias e negociações legadas importadas do RD Station CRM `deal-rd-*`)
      const [transferredDealsRes, createdDealsRes, attendanceTransfersRes, realFlowStates] = await Promise.all([
        // 2A. Negociações transferidas/alocadas para um operador na janela (owner_changed / operator_changed)
        db.execute(sql`
          SELECT DISTINCT ON (ev.deal_id, COALESCE(ev.metadata->>'toOperatorId', ''))
            ev.id AS event_id,
            ev.deal_id,
            ev.operator_id AS actor_operator_id,
            ev.metadata->>'fromOperatorId' AS from_operator_id,
            ev.metadata->>'toOperatorId' AS to_operator_id,
            ev.created_at AS allocated_at,
            d.title,
            d.operator_id AS current_deal_operator_id,
            d.rating,
            d.source,
            d.created_at AS deal_created_at,
            p.name AS funnel_name,
            acc.name AS account_name,
            acc.document AS account_doc,
            acc.phone AS account_phone,
            conv_link.conversation_id,
            ct.id AS contact_id,
            ct.name AS contact_name,
            ct.phone AS contact_phone,
            ct.cnpj AS contact_cnpj,
            ct.cpf AS contact_cpf,
            ct.cnpj_details AS contact_cnpj_details
          FROM crm_deal_events ev
          INNER JOIN crm_deals d
            ON d.tenant_id = ev.tenant_id AND d.id = ev.deal_id
          LEFT JOIN crm_pipelines p
            ON p.tenant_id = d.tenant_id AND p.id = d.pipeline_id
          LEFT JOIN crm_accounts acc
            ON acc.tenant_id = d.tenant_id AND acc.id = d.account_id
          LEFT JOIN LATERAL (
            SELECT cd.conversation_id
            FROM crm_conversation_deals cd
            WHERE cd.tenant_id = d.tenant_id AND cd.deal_id = d.id AND cd.is_active = true
            ORDER BY cd.created_at DESC
            LIMIT 1
          ) conv_link ON true
          LEFT JOIN conversations conv
            ON conv.tenant_id = d.tenant_id AND conv.id = conv_link.conversation_id
          LEFT JOIN LATERAL (
            SELECT dc.contact_id
            FROM crm_deal_contacts dc
            WHERE dc.tenant_id = d.tenant_id AND dc.deal_id = d.id
            ORDER BY dc.is_primary DESC, dc.created_at ASC
            LIMIT 1
          ) deal_ct ON true
          LEFT JOIN contacts ct
            ON ct.tenant_id = d.tenant_id AND ct.id = COALESCE(conv.contact_id, deal_ct.contact_id)
          WHERE ev.tenant_id = ${tenantId}
            AND ev.event_type IN ('owner_changed', 'operator_changed')
            AND d.id NOT LIKE 'deal-rd-%'
            AND COALESCE(ev.metadata->>'toOperatorId', '') <> ''
            AND (${opStartIso}::timestamptz IS NULL OR ev.created_at >= ${opStartIso}::timestamptz)
            AND (${opEndIso}::timestamptz IS NULL OR ev.created_at <= ${opEndIso}::timestamptz)
          ORDER BY ev.deal_id, COALESCE(ev.metadata->>'toOperatorId', ''), ev.created_at DESC
          LIMIT 2000
        `),

        // 2B. Negociações criadas no CRM Local (excluindo importações `deal-rd-*`)
        db.execute(sql`
          SELECT
            d.id AS deal_id,
            d.title,
            d.operator_id AS current_deal_operator_id,
            d.rating,
            d.source,
            d.custom_fields,
            d.created_at AS deal_created_at,
            p.name AS funnel_name,
            acc.name AS account_name,
            acc.document AS account_doc,
            acc.phone AS account_phone,
            conv_link.conversation_id,
            conv_link.origin AS conv_deal_origin,
            conv_link.created_by_operator_id AS conv_deal_creator_id,
            conv.operator_id AS conv_operator_id,
            ct.id AS contact_id,
            ct.name AS contact_name,
            ct.phone AS contact_phone,
            ct.cnpj AS contact_cnpj,
            ct.cpf AS contact_cpf,
            ct.cnpj_details AS contact_cnpj_details,
            created_ev.operator_id AS created_event_operator_id,
            created_ev.metadata->>'actorType' AS created_actor_type,
            first_tr.from_op AS first_transfer_from_op,
            last_tr.to_op AS last_transfer_to_op,
            EXISTS (
              SELECT 1 FROM rd_marketing_receipts r
              WHERE r.tenant_id = d.tenant_id AND r.deal_id = d.id
            ) AS has_rd_receipt
          FROM crm_deals d
          LEFT JOIN crm_pipelines p
            ON p.tenant_id = d.tenant_id AND p.id = d.pipeline_id
          LEFT JOIN crm_accounts acc
            ON acc.tenant_id = d.tenant_id AND acc.id = d.account_id
          LEFT JOIN LATERAL (
            SELECT cd.conversation_id, cd.origin, cd.created_by_operator_id
            FROM crm_conversation_deals cd
            WHERE cd.tenant_id = d.tenant_id AND cd.deal_id = d.id AND cd.is_active = true
            ORDER BY cd.created_at DESC
            LIMIT 1
          ) conv_link ON true
          LEFT JOIN conversations conv
            ON conv.tenant_id = d.tenant_id AND conv.id = conv_link.conversation_id
          LEFT JOIN LATERAL (
            SELECT dc.contact_id
            FROM crm_deal_contacts dc
            WHERE dc.tenant_id = d.tenant_id AND dc.deal_id = d.id
            ORDER BY dc.is_primary DESC, dc.created_at ASC
            LIMIT 1
          ) deal_ct ON true
          LEFT JOIN contacts ct
            ON ct.tenant_id = d.tenant_id AND ct.id = COALESCE(conv.contact_id, deal_ct.contact_id)
          LEFT JOIN LATERAL (
            SELECT ev.operator_id, ev.metadata
            FROM crm_deal_events ev
            WHERE ev.tenant_id = d.tenant_id AND ev.deal_id = d.id AND ev.event_type = 'created'
            ORDER BY ev.created_at ASC
            LIMIT 1
          ) created_ev ON true
          LEFT JOIN LATERAL (
            SELECT ev.metadata->>'fromOperatorId' AS from_op
            FROM crm_deal_events ev
            WHERE ev.tenant_id = d.tenant_id AND ev.deal_id = d.id
              AND ev.event_type IN ('owner_changed', 'operator_changed')
            ORDER BY ev.created_at ASC
            LIMIT 1
          ) first_tr ON true
          LEFT JOIN LATERAL (
            SELECT ev.metadata->>'toOperatorId' AS to_op
            FROM crm_deal_events ev
            WHERE ev.tenant_id = d.tenant_id AND ev.deal_id = d.id
              AND ev.event_type IN ('owner_changed', 'operator_changed')
              AND COALESCE(ev.metadata->>'toOperatorId', '') <> ''
              AND COALESCE(ev.operator_id, '') <> COALESCE(ev.metadata->>'toOperatorId', '')
            ORDER BY ev.created_at DESC
            LIMIT 1
          ) last_tr ON true
          WHERE d.tenant_id = ${tenantId}
            AND d.id NOT LIKE 'deal-rd-%'
            AND (${dealsFetchStartIso}::timestamptz IS NULL OR d.created_at >= ${dealsFetchStartIso}::timestamptz)
          ORDER BY d.created_at DESC
          LIMIT 2500
        `),

        // 2C. Transferências de atendimento no chat (ex: Pós-Venda, Suporte Técnico, Financeiro, Peças sem deal)
        db.execute(sql`
          SELECT
            ae.id AS event_id,
            ae.conversation_id,
            ae.operator_id AS actor_operator_id,
            ae.metadata->>'operatorId' AS to_operator_id,
            ae.deal_id AS event_deal_id,
            ae.created_at AS transferred_at,
            conv.contact_id,
            ct.name AS contact_name,
            ct.phone AS contact_phone,
            ct.cnpj AS contact_cnpj,
            ct.cpf AS contact_cpf,
            ct.cnpj_details AS contact_cnpj_details,
            sec.name AS sector_name,
            ctx.current_deal_id
          FROM attendance_events ae
          INNER JOIN conversations conv
            ON conv.tenant_id = ae.tenant_id AND conv.id = ae.conversation_id
          LEFT JOIN contacts ct
            ON ct.tenant_id = conv.tenant_id AND ct.id = conv.contact_id
          LEFT JOIN sectors sec
            ON sec.tenant_id = ae.tenant_id
            AND sec.id = COALESCE(NULLIF(ae.metadata->>'sectorId', ''), conv.sector_id)
          LEFT JOIN conversation_deal_contexts ctx
            ON ctx.tenant_id = ae.tenant_id AND ctx.conversation_id = ae.conversation_id
          WHERE ae.tenant_id = ${tenantId}
            AND ae.event_type = 'attendance.transferred'
            AND COALESCE(ae.metadata->>'operatorId', '') <> ''
            AND COALESCE(ae.operator_id, '') <> COALESCE(ae.metadata->>'operatorId', '')
            AND (${opStartIso}::timestamptz IS NULL OR ae.created_at >= ${opStartIso}::timestamptz)
            AND (${opEndIso}::timestamptz IS NULL OR ae.created_at <= ${opEndIso}::timestamptz)
          ORDER BY ae.created_at DESC
          LIMIT 2000
        `),

        // 3. Sessões reais de triagem da IA em agentFlowStates
        db
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
            contactId: conversations.contactId,
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
          .limit(500),
      ]);

      const transferredDealsRows = extractQueryRows(transferredDealsRes);
      const createdDealsRows = extractQueryRows(createdDealsRes);
      const attendanceTransferRows = extractQueryRows(attendanceTransfersRes);

      // 4. Processar cards alocados por operador (deduplicados por dealId / conversationId / contactId)
      const realCardsByOpId = new Map<string, any[]>();
      const seenDealIdsByOp = new Map<string, Set<string>>();
      const seenConvIdsByOp = new Map<string, Set<string>>();
      const seenContactIdsByOp = new Map<string, Set<string>>();

      const addCardToOperator = (
        targetOpId: string,
        card: any,
        dedup: { dealId?: string | null; conversationId?: string | null; contactId?: string | null },
      ): boolean => {
        if (!targetOpId) return false;
        const targetOp = canonicalOpsMap.get(targetOpId);
        if (!targetOp || !targetOp.isInFlow) return false;

        let dealSet = seenDealIdsByOp.get(targetOpId);
        if (!dealSet) {
          dealSet = new Set<string>();
          seenDealIdsByOp.set(targetOpId, dealSet);
        }
        let convSet = seenConvIdsByOp.get(targetOpId);
        if (!convSet) {
          convSet = new Set<string>();
          seenConvIdsByOp.set(targetOpId, convSet);
        }
        let contactSet = seenContactIdsByOp.get(targetOpId);
        if (!contactSet) {
          contactSet = new Set<string>();
          seenContactIdsByOp.set(targetOpId, contactSet);
        }

        if (dedup.dealId && dealSet.has(dedup.dealId)) return false;
        if (dedup.conversationId && convSet.has(dedup.conversationId)) return false;
        if (dedup.contactId && contactSet.has(dedup.contactId)) return false;

        if (dedup.dealId) dealSet.add(dedup.dealId);
        if (dedup.conversationId) convSet.add(dedup.conversationId);
        if (dedup.contactId) contactSet.add(dedup.contactId);

        const list = realCardsByOpId.get(targetOpId) || [];
        list.push(card);
        realCardsByOpId.set(targetOpId, list);
        return true;
      };

      const activeAiTriageCards: any[] = [];
      const realCrmDealsList: any[] = [];
      const seenStatsDealIds = new Set<string>();

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

      // 4A. Processar transferências de negociações (SDR / Operador / Rodízio -> Operador de destino)
      for (const row of transferredDealsRows) {
        const dealId = String(row.deal_id || "");
        if (!dealId || dealId.startsWith("deal-rd-")) continue;

        const convId = row.conversation_id ? String(row.conversation_id) : undefined;
        const contactId = row.contact_id ? String(row.contact_id) : undefined;
        const isCardRemoved =
          removedCards.includes(dealId) || (convId ? removedCards.includes(convId) : false);
        if (isCardRemoved) continue;

        const rawToOp = resolveOpId(row.to_operator_id);
        const actorOp = resolveOpId(row.actor_operator_id || row.from_operator_id);
        if (!rawToOp || actorOp === rawToOp) continue;

        const reassigned = reassignMap.get(dealId) || (convId ? reassignMap.get(convId) : undefined);
        const toOpSector = opSectorById.get(rawToOp);
        const currentDealOp = resolveOpId(row.current_deal_operator_id);

        // Se houve reatribuição manual no rodízio ou transferência corretiva dentro da mesma área comercial,
        // manter o lead apenas no destinatário vigente daquela área
        let effectiveOpId = rawToOp;
        if (reassigned && toOpSector !== "sdr") {
          const reassignedOpId = resolveOpId(reassigned.toOperatorId);
          if (reassignedOpId && reassignedOpId !== rawToOp) {
            continue;
          }
        } else if (
          toOpSector !== "sdr" &&
          currentDealOp &&
          currentDealOp !== rawToOp &&
          opSectorById.get(currentDealOp) === toOpSector
        ) {
          continue;
        }

        const allocatedAtDate = row.allocated_at ? new Date(row.allocated_at) : now;
        if (!isWithinOpWindow(allocatedAtDate)) continue;

        const cnpjDetails = (row.contact_cnpj_details || {}) as Record<string, any>;
        const companyName =
          row.account_name || cnpjDetails.razaoSocial || cnpjDetails.nomeFantasia || null;
        const phoneStr = row.account_phone || row.contact_phone || null;
        const cardDisplayName = row.contact_name || row.title || "Cliente";

        addCardToOperator(
          effectiveOpId,
          {
            id: convId || dealId,
            name: cardDisplayName,
            company: companyName,
            created_at: allocatedAtDate.toISOString(),
            chatId: convId,
            rdDealId: dealId,
            phone: phoneStr,
            subject: row.funnel_name || null,
          },
          { dealId, conversationId: convId, contactId },
        );
      }

      // 4B. Processar negociações automáticas/inbound ou abertas por terceiros (nunca auto-aberturas manuais)
      for (const row of createdDealsRows) {
        const dealId = String(row.deal_id || "");
        if (!dealId || dealId.startsWith("deal-rd-")) continue;

        const convId = row.conversation_id ? String(row.conversation_id) : undefined;
        const contactId = row.contact_id ? String(row.contact_id) : undefined;
        const createdAtDate = row.deal_created_at ? new Date(row.deal_created_at) : now;
        const createdAtIso = createdAtDate.toISOString();

        const initialOwnerOpId = resolveOpId(
          row.first_transfer_from_op || row.current_deal_operator_id || row.conv_operator_id,
        );
        const creatorOpId = resolveOpId(row.created_event_operator_id || row.conv_deal_creator_id);

        const cf = (row.custom_fields || {}) as Record<string, any>;
        const normSource = String(row.source || "").trim().toLowerCase();
        const normActorType = String(row.created_actor_type || "").trim().toLowerCase();

        const isAutomatedInbound =
          Boolean(row.has_rd_receipt) ||
          normSource.startsWith("whatsapp sdr") ||
          row.conv_deal_origin === "auto_sdr" ||
          (String(cf.autoCreatedFromLinkedDevice) === "true" &&
            String(cf.initialDirection || "") === "inbound") ||
          ["rd_marketing", "system", "ai", "webhook", "rodizio"].includes(normActorType);

        const isThirdPartyAssignedAtCreation = Boolean(
          creatorOpId && initialOwnerOpId && creatorOpId !== initialOwnerOpId,
        );

        const wasTransferredToAnotherOp = Boolean(row.last_transfer_to_op);

        const cnpjDetails = (row.contact_cnpj_details || {}) as Record<string, any>;
        const companyName =
          row.account_name || cnpjDetails.razaoSocial || cnpjDetails.nomeFantasia || null;
        const phoneStr = row.account_phone || row.contact_phone || null;
        const cardDisplayName = row.contact_name || row.title || "Cliente";
        const funnelKey = normalizeFunnelKey(row.funnel_name || "maquinas");

        // Atribuir na criação SOMENTE se foi entrada automática (RD Marketing / SDR IA / Inbound Auto)
        // ou atribuída diretamente por outro operador (excluindo auto-abertura manual onde creator === owner)
        const isCardRemoved =
          removedCards.includes(dealId) || (convId ? removedCards.includes(convId) : false);

        if ((isAutomatedInbound || isThirdPartyAssignedAtCreation) && !isCardRemoved && isWithinOpWindow(createdAtDate)) {
          const reassigned = reassignMap.get(dealId) || (convId ? reassignMap.get(convId) : undefined);
          const targetOpId =
            reassigned && opSectorById.get(initialOwnerOpId) !== "sdr"
              ? resolveOpId(reassigned.toOperatorId)
              : initialOwnerOpId;

          if (targetOpId) {
            addCardToOperator(
              targetOpId,
              {
                id: convId || dealId,
                name: cardDisplayName,
                company: companyName,
                created_at: createdAtIso,
                chatId: convId,
                rdDealId: dealId,
                phone: phoneStr,
                subject: row.funnel_name || null,
              },
              { dealId, conversationId: convId, contactId },
            );
          }
        }

        // Lista de negociações da Visão Geral (apenas leads reais de triagem/automação/transferência, sem manuais puros ou RD legado)
        if (
          (isAutomatedInbound || isThirdPartyAssignedAtCreation || wasTransferredToAnotherOp) &&
          !seenStatsDealIds.has(dealId) &&
          isWithinStatsWindow(createdAtDate)
        ) {
          seenStatsDealIds.add(dealId);
          const currentOwnerId = resolveOpId(
            (reassignMap.get(dealId) || (convId ? reassignMap.get(convId) : undefined))?.toOperatorId ||
              row.current_deal_operator_id ||
              row.last_transfer_to_op ||
              initialOwnerOpId,
          );
          const effectiveOpName =
            (currentOwnerId ? canonicalOpsMap.get(currentOwnerId)?.name : null) || "Operador";

          realCrmDealsList.push({
            id: dealId,
            name: row.title,
            company: companyName,
            phone: phoneStr,
            rd_deal_id: dealId,
            operator_name: effectiveOpName,
            sector: row.funnel_name || "Comercial",
            funnel: funnelKey,
            created_at: createdAtIso,
          });

          const leadKey = convId || `deal:${dealId}`;
          const hasDoc = Boolean(row.account_doc || row.contact_cnpj || row.contact_cpf);
          const ratingNum = Number(row.rating || 0);
          const dealRatingScore =
            ratingNum > 0
              ? Math.min(3, (ratingNum / 5) * 3)
              : companyName && hasDoc
                ? 2.7
                : companyName
                  ? 2.2
                  : 1.8;

          leadsInStatsWindow.set(leadKey, {
            dateIso: getBrtTodayYmd(createdAtDate),
            funnelKey,
            isTriageDone: true,
            lmsScore: dealRatingScore,
            hasCnpj: hasDoc,
          });
        }
      }

      // 4C. Processar transferências diretas de conversa (Pós-Venda, Suporte Técnico, Financeiro, Peças, etc.)
      for (const row of attendanceTransferRows) {
        const convId = String(row.conversation_id || "");
        if (!convId) continue;

        const rawDealId = String(row.event_deal_id || row.current_deal_id || "");
        const validDealId = rawDealId && !rawDealId.startsWith("deal-rd-") ? rawDealId : undefined;
        const contactId = row.contact_id ? String(row.contact_id) : undefined;

        const isCardRemoved =
          removedCards.includes(convId) || (validDealId ? removedCards.includes(validDealId) : false);
        if (isCardRemoved) continue;

        const rawToOp = resolveOpId(row.to_operator_id);
        const actorOp = resolveOpId(row.actor_operator_id);
        if (!rawToOp || actorOp === rawToOp) continue;

        const reassigned =
          (validDealId ? reassignMap.get(validDealId) : undefined) || reassignMap.get(convId);
        if (reassigned && opSectorById.get(rawToOp) !== "sdr") {
          const reassignedOpId = resolveOpId(reassigned.toOperatorId);
          if (reassignedOpId && reassignedOpId !== rawToOp) {
            continue;
          }
        }

        const transferredAtDate = row.transferred_at ? new Date(row.transferred_at) : now;
        if (!isWithinOpWindow(transferredAtDate)) continue;

        const cnpjDetails = (row.contact_cnpj_details || {}) as Record<string, any>;
        const companyName = cnpjDetails.razaoSocial || cnpjDetails.nomeFantasia || null;

        addCardToOperator(
          rawToOp,
          {
            id: convId,
            name: row.contact_name || "Cliente WhatsApp",
            company: companyName,
            created_at: transferredAtDate.toISOString(),
            chatId: convId,
            rdDealId: validDealId,
            phone: row.contact_phone || null,
            subject: row.sector_name || null,
          },
          { dealId: validDealId, conversationId: convId, contactId },
        );
      }

      // 5. Processar sessões de triagem reais (agentFlowStates)
      let activeRealSessions = 0;
      const seenActiveAiConvIds = new Set<string>();

      for (const fs of realFlowStates) {
        const collected = (fs.collectedData as Record<string, any>) || {};
        const meta = (fs.metadata as Record<string, any>) || {};

        const handoffOpIdRaw =
          meta.handoffReceipt?.result?.operator?.id ||
          meta.allocatedOperatorId ||
          (fs.outcome === "transferred" ? fs.convOperatorId : "") ||
          "";

        const isActiveSession =
          !handoffOpIdRaw &&
          fs.convQueueState === "automacao" &&
          (fs.outcome === "in_progress" || (!fs.outcome && fs.currentStep !== "Concluído"));
        const isCompletedSession =
          fs.outcome === "completed" ||
          fs.outcome === "transferred" ||
          fs.currentStep === "Concluído" ||
          Boolean(handoffOpIdRaw);

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

        const handoffRefDate =
          fs.completedAt ||
          meta.handoffReceipt?.completedAt ||
          fs.lastInteractionAt ||
          fs.startedAt ||
          now;
        const refDateObj = handoffRefDate instanceof Date ? handoffRefDate : new Date(handoffRefDate);
        const refDateIso = refDateObj.toISOString();

        const isCardRemoved = removedCards.includes(fs.conversationId) || removedCards.includes(fs.id);
        if (!isCardRemoved && isWithinOpWindow(refDateObj)) {
          const reassigned = reassignMap.get(fs.conversationId);
          const effectiveOpId = resolveOpId(reassigned?.toOperatorId || handoffOpIdRaw);

          const rawDealIdFromMeta = String(
            meta.localCrmDealId ||
              meta.handoffReceipt?.result?.deal?.dealId ||
              meta.dealId ||
              "",
          );
          const validDealIdFromMeta =
            rawDealIdFromMeta && !rawDealIdFromMeta.startsWith("deal-rd-")
              ? rawDealIdFromMeta
              : undefined;

          const cardObj = {
            id: fs.conversationId,
            name: clientName !== "Aguardando..." ? clientName : fs.contactName || "Cliente em Triagem",
            company: companyName && companyName !== "Aguardando..." ? companyName : null,
            created_at: refDateIso,
            chatId: fs.conversationId,
            rdDealId: validDealIdFromMeta,
            phone: fs.contactPhone || null,
            subject: meta.targetFunnel || null,
          };

          if (effectiveOpId && canonicalOpsMap.get(effectiveOpId)?.isInFlow) {
            addCardToOperator(effectiveOpId, cardObj, {
              dealId: validDealIdFromMeta,
              conversationId: fs.conversationId,
              contactId: fs.contactId || undefined,
            });
          } else if (isActiveSession && !seenActiveAiConvIds.has(fs.conversationId)) {
            seenActiveAiConvIds.add(fs.conversationId);
            activeAiTriageCards.push(cardObj);
          }
        }

        // Registrar na janela de estatísticas da Visão Geral
        if (isWithinStatsWindow(fs.startedAt || refDateObj)) {
          const existingLead = leadsInStatsWindow.get(fs.conversationId);
          const statDate = fs.startedAt ? new Date(fs.startedAt) : refDateObj;
          leadsInStatsWindow.set(fs.conversationId, {
            dateIso: getBrtTodayYmd(statDate),
            funnelKey: existingLead?.funnelKey && existingLead.funnelKey !== "maquinas" ? existingLead.funnelKey : funnelKey,
            isTriageDone: Boolean(existingLead?.isTriageDone || isCompletedSession),
            lmsScore: existingLead ? Math.max(existingLead.lmsScore, lmsScore) : lmsScore,
            hasCnpj: Boolean(existingLead?.hasCnpj || docValue),
          });
        }
      }

      // 6. Montar a lista de operadores para as 6 colunas — ESTRITAMENTE quem está cadastrado em cada fluxo (inclusive com 0 leads)
      const operatorRows: any[] = [];

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

      for (const op of canonicalOpsMap.values()) {
        if (!op.isInFlow) {
          continue;
        }

        const opCards = (realCardsByOpId.get(op.id) || []).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        const resolvedSector = opSectorById.get(op.id) || "maquinas";
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

      // Série temporal real para o gráfico "Leads por Dia" (últimos N dias até 30 barras no fuso de Brasília)
      const chartDaysCount = Math.min(statsDays, 30);
      const todayYmd = getBrtTodayYmd(now);
      const todayNoon = new Date(`${todayYmd}T12:00:00.000-03:00`);
      const byDay: Array<{ day: string; count: number }> = [];
      for (let i = chartDaysCount - 1; i >= 0; i--) {
        const d = new Date(todayNoon.getTime() - i * 24 * 60 * 60 * 1000);
        const dayKey = getBrtTodayYmd(d);
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


