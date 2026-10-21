// ══════════════════════════════════════════════════════════════════════════════
// 🔄 RODÍZIO TYPES & CONSTANTS — Tipagens e Metadados do Rodízio (Client-Safe)
// Arquivo 100% puro para permitir importação em componentes frontend e backend
// SEM puxar o banco de dados PostgreSQL ou Baileys para o bundle do navegador.
// ══════════════════════════════════════════════════════════════════════════════

import { getAiPersona } from "../ai-persona.ts";
import { INDUSTRIAL_FUNNELS } from "../triage/industrial-policy.ts";

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

type FlowAreaDefinition = {
  id: string;
  name: string;
  description: string;
  defaultFunnels: readonly string[];
  icon: string;
  color: string;
};

/** A escala usa o mesmo vocabulário da política, sem alterar os perfis existentes. */
export function getFlowConfiguration(tenantId: string): {
  areas: readonly FlowAreaDefinition[];
  funnels: readonly string[];
} {
  if (!tenantId || getAiPersona(tenantId).triagePolicy !== "industrial")
    return { areas: FLOW_AREAS, funnels: ALL_FLOW_FUNNELS };
  return {
    areas: [
      ...FLOW_AREAS.map((area) =>
        area.id === "financeiro"
          ? { ...area, defaultFunnels: ["Financeiro"] }
          : area.id === "pos_venda"
            ? { ...area, defaultFunnels: ["Pós-Venda"] }
            : area,
      ),
      {
        id: "outros",
        name: "Análise e revisão humana",
        description: "Solicitações sem área definida, atendimento humano e revisão",
        defaultFunnels: ["Análise e revisão humana"],
        icon: "Folder",
        color: "#64748b",
      },
    ],
    funnels: INDUSTRIAL_FUNNELS,
  };
}

export const DEFAULT_TECFAG_FLOW_OPERATORS: FlowOperator[] = [
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
