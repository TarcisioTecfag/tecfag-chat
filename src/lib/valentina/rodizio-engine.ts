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

export interface FlowOperator {
  id: string; // operatorId
  name: string;
  email?: string;
  avatar?: string | null;
  isParticipating: boolean; // Ativo = true, Inativo = false (default: true)
  isOnLeave: boolean; // Em Folga = true, Normal = false (default: false)
  isPenalized?: boolean; // Penalizado = true (default: false)
  area: string; // "maquinas" | "personalite" | "pecas" | "tecnica" | "pos_venda" | "financeiro"
  funnels: string[]; // e.g. ["Máquinas"], ["Personnalité"], etc.
  compensation: number; // Saldo de compensação (+1, +2, 0, etc.)
  crmId?: string; // CRM ID/tag e.g. "Andreia Camargo - 123 (vendas5@tecfag.com.br)"
  departmentTag?: string; // "COMERCIAL", "PÓS-VENDA", "FINANCEIRO", "SUPORTE"
  roleTag?: string; // "SDR", "VENDEDOR", "CONSULTOR", "TÉCNICO"
  talosId?: string; // Talos ID e.g. "67a8540b625a60007f9d712"
  leadsReceivedCount: number; // default: 0
  recentLeads?: Array<{
    chatId: string;
    clientName: string;
    receivedAt: string;
  }>;
  addedAt?: string;
}

export const FLOW_AREAS = [
  {
    id: "maquinas",
    name: "Máquinas",
    description: "Rodízio Comercial de Máquinas e Equipamentos",
    defaultFunnels: ["Máquinas"],
    icon: "Folder",
    color: "#df3d3d",
  },
  {
    id: "personalite",
    name: "Personnalité",
    description: "Rodízio Comercial Especializado e Linhas Premium",
    defaultFunnels: ["Personnalité"],
    icon: "Gem",
    color: "#d946ef",
  },
  {
    id: "pecas",
    name: "Peças",
    description: "Rodízio de Vendas de Peças e Componentes",
    defaultFunnels: ["Peças"],
    icon: "Settings",
    color: "#ef4444",
  },
  {
    id: "tecnica",
    name: "Assistência Técnica",
    description: "Rodízio de Assistência Técnica, Suporte e Garantia",
    defaultFunnels: ["Assistência Técnica"],
    icon: "Wrench",
    color: "#0284c7",
  },
  {
    id: "pos_venda",
    name: "Pós-Venda",
    description: "Rodízio de Pós-Venda Geral, Rastreio e NF de Pedidos",
    defaultFunnels: ["Pós-Venda Geral", "Pós-Venda Rastreio", "Pós-Venda - NF do Pedido"],
    icon: "Package",
    color: "#2563eb",
  },
  {
    id: "financeiro",
    name: "Financeiro",
    description: "Rodízio de Emissão de Boletos e Notas Fiscais",
    defaultFunnels: ["Fin. Boleto", "Fin. Nota Fiscal"],
    icon: "CircleDollarSign",
    color: "#10b981",
  },
] as const;

export const ALL_FLOW_FUNNELS = [
  "Máquinas",
  "Personnalité",
  "Peças",
  "Fin. Boleto",
  "Fin. Nota Fiscal",
  "Assistência Técnica",
  "Pós-Venda Rastreio",
  "Pós-Venda - NF do Pedido",
  "Pós-Venda Geral",
] as const;

const DEFAULT_TECFAG_FLOW_OPERATORS: FlowOperator[] = [
  {
    id: "op-tf-andreia.camargo",
    name: "Andreia Camargo",
    email: "vendas5@tecfag.com.br",
    isParticipating: true,
    isOnLeave: false,
    isPenalized: false,
    area: "maquinas",
    funnels: ["Máquinas"],
    compensation: 1,
    crmId: "Andreia Camargo - 123 (vendas5@tecfag.com.br)",
    departmentTag: "COMERCIAL",
    roleTag: "SDR",
    talosId: "67a8540b625a60007f9d712",
    leadsReceivedCount: 0,
    recentLeads: [],
  },
  {
    id: "op-tf-beatriz.ribeiro.96",
    name: "Beatriz Ribeiro - 96",
    email: "vendas7@tecfag.com.br",
    isParticipating: true,
    isOnLeave: false,
    isPenalized: false,
    area: "maquinas",
    funnels: ["Máquinas"],
    compensation: 1,
    crmId: "Beatriz Ribeiro - 96 (vendas7@tecfag.com.br)",
    departmentTag: "COMERCIAL",
    roleTag: "SDR",
    talosId: "67aa25f85f215a90087ae1b3",
    leadsReceivedCount: 0,
    recentLeads: [],
  },
  {
    id: "op-tf-denise.gomes.34",
    name: "Denise Gomes - 34",
    email: "vendas16@tecfag.com.br",
    isParticipating: true,
    isOnLeave: false,
    isPenalized: false,
    area: "maquinas",
    funnels: ["Máquinas"],
    compensation: 2,
    crmId: "Denise Gomes - 34 (vendas16@tecfag.com.br)",
    departmentTag: "COMERCIAL",
    roleTag: "SDR",
    talosId: "68642f75f72dc700073997dc",
    leadsReceivedCount: 0,
    recentLeads: [],
  },
  {
    id: "op-tf-melissa.gomes.80",
    name: "Melissa Gomes - 80",
    email: "vendas3@tecfag.com.br",
    isParticipating: true,
    isOnLeave: false,
    isPenalized: false,
    area: "maquinas",
    funnels: ["Máquinas"],
    compensation: 2,
    crmId: "Melissa Gomes - 80 (vendas3@tecfag.com.br)",
    departmentTag: "COMERCIAL",
    roleTag: "SDR",
    talosId: "67aa62a1e41d2000079ec9c8",
    leadsReceivedCount: 0,
    recentLeads: [],
  },
  {
    id: "op-tf-victor.goes.95",
    name: "Victor Goes - 95",
    email: "vendas12@tecfag.com.br",
    isParticipating: true,
    isOnLeave: false,
    isPenalized: false,
    area: "maquinas",
    funnels: ["Máquinas"],
    compensation: 1,
    crmId: "Victor Goes - 95 (vendas12@tecfag.com.br)",
    departmentTag: "COMERCIAL",
    roleTag: "SDR",
    talosId: "67e30d56a511660007613725",
    leadsReceivedCount: 0,
    recentLeads: [],
  },
  {
    id: "op-tf-diana.gimenes.93",
    name: "Diana Gimenes - 93",
    email: "vendas14@tecfag.com.br",
    isParticipating: true,
    isOnLeave: false,
    isPenalized: false,
    area: "personalite",
    funnels: ["Personnalité"],
    compensation: 0,
    crmId: "Diana Gimenes - 93 (vendas14@tecfag.com.br)",
    departmentTag: "COMERCIAL",
    roleTag: "SDR",
    talosId: "681a748952774a000797adac",
    leadsReceivedCount: 0,
    recentLeads: [],
  },
  {
    id: "op-tf-jhordan.rueda.102",
    name: "Jhordan Rueda - 102",
    email: "vendas4@tecfag.com.br",
    isParticipating: true,
    isOnLeave: false,
    isPenalized: false,
    area: "personalite",
    funnels: ["Personnalité"],
    compensation: 1,
    crmId: "Jhordan Rueda - 102 (vendas4@tecfag.com.br)",
    departmentTag: "COMERCIAL",
    roleTag: "SDR",
    talosId: "67aa6824348cd4000761dc56",
    leadsReceivedCount: 0,
    recentLeads: [],
  },
];

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
   * ALOCA O PRÓXIMO VENDEDOR NO RODÍZIO QUANDO A IA CONCLUI A TRIAGEM
   * Considera área/funil alvo, compensações acumuladas e menor quantidade de leads
   */
  static async allocateNextOperator(
    tenantId: string,
    conversationId: string,
    clientName: string,
    targetAreaOrFunnel?: string
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

