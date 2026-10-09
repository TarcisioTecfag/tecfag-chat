/**
 * pipeline-data.ts
 * Estruturas, tipos, cálculos e baseline do Commercial War Room
 * Tela 1: OPORTUNIDADES & PIPELINE POR FASE (CRM)
 */

export type PipelineStageKey = string;

export interface PipelineStageDef {
  key: PipelineStageKey;
  label: string;
  bracketLabel: string;
  pillLabel: string;
}

export const PIPELINE_STAGES: PipelineStageDef[] = [
  {
    key: "requalificacao",
    label: "Requalificação",
    bracketLabel: "[REQUALIFICAÇÃO]",
    pillLabel: "Requalificação",
  },
  {
    key: "esfriando",
    label: "Esfriando",
    bracketLabel: "[ESFRIANDO]",
    pillLabel: "Esfriando",
  },
  {
    key: "leads_recebidos",
    label: "Leads Recebidos",
    bracketLabel: "[LEADS RECEBIDOS]",
    pillLabel: "Leads Recebidos",
  },
  {
    key: "abordagem_comercial",
    label: "Abordagem Comercial",
    bracketLabel: "[ABORDAGEM COMERCIAL]",
    pillLabel: "Abordagem Comercial",
  },
  {
    key: "qualificado",
    label: "Qualificado",
    bracketLabel: "[QUALIFICADO]",
    pillLabel: "Qualificado",
  },
  {
    key: "proposta_enviada",
    label: "Proposta Enviada",
    bracketLabel: "[PROPOSTA ENVIADA]",
    pillLabel: "Proposta Enviada",
  },
  {
    key: "fechamento",
    label: "Fechamento",
    bracketLabel: "[FECHAMENTO]",
    pillLabel: "Fechamento",
  },
];

export interface StageMetric {
  count: number;
  value: number; // Em R$
  percent: number; // % sobre o total de valor
}

export interface SellerPipelineRow {
  sellerId: string;
  sellerName: string;
  avatar?: string;
  avatarUrl?: string;
  division: "personnalite" | "maquinas";
  stages: Record<PipelineStageKey, StageMetric>;
  totalCards: number;
  totalValue: number;
  teamSharePercent: number; // % sobre o total da equipe
}

export interface TeamPipelineData {
  teamId: "personnalite" | "maquinas";
  teamName: string;
  icon: "star" | "flag";
  totalCards: number;
  totalValue: number;
  sellers: SellerPipelineRow[];
  stageTotals: Record<PipelineStageKey, StageMetric>;
}

export interface CommercialPipelineDeal {
  id: string;
  title: string;
  funnelName: string;
  responsibleName: string;
  responsibleId?: string;
  division: "personnalite" | "maquinas";
  value: number;
  daysOpen: number;
  createdAt: string; // Ex: '10 de set. de 2026'
  stageKey: PipelineStageKey;
  stageName: string;
  rdDealId?: string;
  rdDealUrl?: string;
}

/**
 * Formatação do valor em célula da tabela do War Room
 * Ex: R$ 781k, R$ 1.3M, R$ 40.0M, R$ 60.05M
 */
export function formatAbbreviatedCurrency(value: number, isTotal = false): string {
  if (!value || value <= 0) return "—";
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `R$ ${millions.toFixed(isTotal ? 2 : 1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `R$ ${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(0)}k`;
  }
  return `R$ ${Math.round(value)}`;
}

/**
 * Formatação de porcentagem de célula
 * Ex: <1%, 18%, 50%, —
 */
export function formatPercentage(percent: number): string {
  if (percent <= 0) return "—";
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

/**
 * Formatação do valor monetário no Modal
 * Ex: R$ 3.0 mil, R$ 0,00, R$ 1.5M
 */
export function formatDealValue(value: number): string {
  if (!value || value === 0) return "R$ 0,00";
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `R$ ${(value / 1_000).toFixed(1)} mil`;
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/**
 * Formatação do resumo da equipe
 * Ex: "Total: 1307 cards - Valor: R$ 60.05M"
 */
export function formatTeamSummary(
  totalCards: number,
  totalValue: number,
): { cards: string; value: string } {
  const cardsStr = `Total: ${totalCards} cards`;
  const millions = totalValue / 1_000_000;
  const valStr = `Valor: R$ ${millions.toFixed(2)}M`;
  return { cards: cardsStr, value: valStr };
}

// ─────────────────────────────────────────────────────────────────────────────
// BASELINE OFICIAL DO WAR ROOM (RÉPLICA FIEL DA FOTO 1)
// ─────────────────────────────────────────────────────────────────────────────

export const BASELINE_PERSONNALITE: TeamPipelineData = {
  teamId: "personnalite",
  teamName: "TIME PERSONNALITÉ",
  icon: "star",
  totalCards: 1307,
  totalValue: 60_050_000,
  sellers: [
    {
      sellerId: "op-tf-diana.gimenes.93",
      sellerName: "Diana Gimenes",
      division: "personnalite",
      totalCards: 321,
      totalValue: 3_940_000,
      teamSharePercent: 7,
      stages: {
        requalificacao: { count: 2, value: 0, percent: 0 },
        esfriando: { count: 214, value: 781_000, percent: 18 },
        leads_recebidos: { count: 12, value: 22_000, percent: 1 },
        abordagem_comercial: { count: 42, value: 3_000, percent: 0.5 },
        qualificado: { count: 27, value: 1_300_000, percent: 32 },
        proposta_enviada: { count: 25, value: 2_000_000, percent: 50 },
        fechamento: { count: 1, value: 0, percent: 0 },
      },
    },
    {
      sellerId: "op-tf-jhordan.rueda.102",
      sellerName: "Jhordan Rueda",
      division: "personnalite",
      totalCards: 841,
      totalValue: 8_170_000,
      teamSharePercent: 18,
      stages: {
        requalificacao: { count: 1, value: 0, percent: 0 },
        esfriando: { count: 624, value: 5_800_000, percent: 49 },
        leads_recebidos: { count: 46, value: 0, percent: 0 },
        abordagem_comercial: { count: 145, value: 1_600_000, percent: 25 },
        qualificado: { count: 13, value: 475_000, percent: 8 },
        proposta_enviada: { count: 13, value: 1_100_000, percent: 18 },
        fechamento: { count: 0, value: 0, percent: 0 },
      },
    },
    {
      sellerId: "op-tf-murrelo.nardelli",
      sellerName: "Murrelo Nardelli",
      division: "personnalite",
      totalCards: 36,
      totalValue: 42_700_000,
      teamSharePercent: 71,
      stages: {
        requalificacao: { count: 0, value: 0, percent: 0 },
        esfriando: { count: 0, value: 0, percent: 0 },
        leads_recebidos: { count: 3, value: 40_000_000, percent: 94 },
        abordagem_comercial: { count: 12, value: 120_000, percent: 0.5 },
        qualificado: { count: 15, value: 368_000, percent: 1 },
        proposta_enviada: { count: 6, value: 2_300_000, percent: 5 },
        fechamento: { count: 0, value: 0, percent: 0 },
      },
    },
    {
      sellerId: "op-tf-rosenvaldo.lucas.121",
      sellerName: "Rosenvaldo Lucas",
      division: "personnalite",
      totalCards: 109,
      totalValue: 7_160_000,
      teamSharePercent: 12,
      stages: {
        requalificacao: { count: 6, value: 0, percent: 0 },
        esfriando: { count: 0, value: 0, percent: 0 },
        leads_recebidos: { count: 28, value: 0, percent: 0 },
        abordagem_comercial: { count: 16, value: 0, percent: 0 },
        qualificado: { count: 25, value: 0, percent: 0 },
        proposta_enviada: { count: 40, value: 7_200_000, percent: 100 },
        fechamento: { count: 0, value: 0, percent: 0 },
      },
    },
  ],
  stageTotals: {
    requalificacao: { count: 9, value: 0, percent: 0 },
    esfriando: { count: 838, value: 7_700_000, percent: 9 },
    leads_recebidos: { count: 89, value: 40_000_000, percent: 67 },
    abordagem_comercial: { count: 215, value: 1_700_000, percent: 3 },
    qualificado: { count: 80, value: 2_100_000, percent: 4 },
    proposta_enviada: { count: 84, value: 12_500_000, percent: 21 },
    fechamento: { count: 1, value: 0, percent: 0 },
  },
};

export const BASELINE_SEMI_MAQUINAS: TeamPipelineData = {
  teamId: "maquinas",
  teamName: "TIME SEMI (MÁQUINAS)",
  icon: "flag",
  totalCards: 2988,
  totalValue: 20_700_000,
  sellers: [
    {
      sellerId: "op-tf-andreia.camargo",
      sellerName: "Andreia Camargo",
      division: "maquinas",
      totalCards: 444,
      totalValue: 3_350_000,
      teamSharePercent: 17,
      stages: {
        requalificacao: { count: 0, value: 0, percent: 0 },
        esfriando: { count: 50, value: 2_200_000, percent: 40 },
        leads_recebidos: { count: 3, value: 0, percent: 0 },
        abordagem_comercial: { count: 290, value: 441_000, percent: 10 },
        qualificado: { count: 56, value: 939_000, percent: 9 },
        proposta_enviada: { count: 44, value: 417_000, percent: 12 },
        fechamento: { count: 1, value: 0, percent: 0 },
      },
    },
    {
      sellerId: "op-tf-beatriz.ribeiro.96",
      sellerName: "Beatriz Ribeiro",
      division: "maquinas",
      totalCards: 398,
      totalValue: 8_960_000,
      teamSharePercent: 44,
      stages: {
        requalificacao: { count: 0, value: 0, percent: 0 },
        esfriando: { count: 86, value: 6_300_000, percent: 70 },
        leads_recebidos: { count: 4, value: 0, percent: 0 },
        abordagem_comercial: { count: 254, value: 686_000, percent: 8 },
        qualificado: { count: 20, value: 516_000, percent: 6 },
        proposta_enviada: { count: 34, value: 1_500_000, percent: 17 },
        fechamento: { count: 0, value: 0, percent: 0 },
      },
    },
    {
      sellerId: "op-tf-denise.gomes.34",
      sellerName: "Denise Gomes",
      division: "maquinas",
      totalCards: 635,
      totalValue: 1_260_000,
      teamSharePercent: 6,
      stages: {
        requalificacao: { count: 0, value: 0, percent: 0 },
        esfriando: { count: 1, value: 0, percent: 0 },
        leads_recebidos: { count: 14, value: 0, percent: 0 },
        abordagem_comercial: { count: 348, value: 130_000, percent: 10 },
        qualificado: { count: 242, value: 655_000, percent: 52 },
        proposta_enviada: { count: 24, value: 287_000, percent: 23 },
        fechamento: { count: 6, value: 186_000, percent: 15 },
      },
    },
    {
      sellerId: "op-tf-melissa.gomes.80",
      sellerName: "Melissa Gomes",
      division: "maquinas",
      totalCards: 618,
      totalValue: 1_080_000,
      teamSharePercent: 5,
      stages: {
        requalificacao: { count: 0, value: 0, percent: 0 },
        esfriando: { count: 2, value: 0, percent: 0 },
        leads_recebidos: { count: 30, value: 0, percent: 0 },
        abordagem_comercial: { count: 386, value: 52_000, percent: 5 },
        qualificado: { count: 101, value: 64_000, percent: 6 },
        proposta_enviada: { count: 93, value: 855_000, percent: 79 },
        fechamento: { count: 6, value: 112_000, percent: 10 },
      },
    },
    {
      sellerId: "op-tf-deborah.alves.94",
      sellerName: "MERCADO LIVRE / Deborah",
      division: "maquinas",
      totalCards: 340,
      totalValue: 3_110_000,
      teamSharePercent: 15,
      stages: {
        requalificacao: { count: 0, value: 0, percent: 0 },
        esfriando: { count: 3, value: 1_400_000, percent: 45 },
        leads_recebidos: { count: 114, value: 37_000, percent: 1 },
        abordagem_comercial: { count: 83, value: 0, percent: 0 },
        qualificado: { count: 106, value: 881_000, percent: 28 },
        proposta_enviada: { count: 32, value: 791_000, percent: 25 },
        fechamento: { count: 2, value: 10_000, percent: 0.5 },
      },
    },
    {
      sellerId: "op-tf-victor.goes.95",
      sellerName: "Victor Goes",
      division: "maquinas",
      totalCards: 553,
      totalValue: 2_430_000,
      teamSharePercent: 12,
      stages: {
        requalificacao: { count: 0, value: 0, percent: 0 },
        esfriando: { count: 9, value: 0, percent: 0 },
        leads_recebidos: { count: 7, value: 0, percent: 0 },
        abordagem_comercial: { count: 334, value: 205_000, percent: 8 },
        qualificado: { count: 116, value: 272_000, percent: 11 },
        proposta_enviada: { count: 84, value: 1_800_000, percent: 75 },
        fechamento: { count: 3, value: 137_000, percent: 6 },
      },
    },
  ],
  stageTotals: {
    requalificacao: { count: 0, value: 0, percent: 0 },
    esfriando: { count: 151, value: 9_900_000, percent: 48 },
    leads_recebidos: { count: 172, value: 37_000, percent: 0.5 },
    abordagem_comercial: { count: 1695, value: 1_500_000, percent: 7 },
    qualificado: { count: 641, value: 2_700_000, percent: 13 },
    proposta_enviada: { count: 311, value: 5_600_000, percent: 28 },
    fechamento: { count: 18, value: 445_000, percent: 2 },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// NEGOCIAÇÕES REAIS / BASELINE DA DIANA GIMENES (RÉPLICA FIEL DA FOTO 2)
// ─────────────────────────────────────────────────────────────────────────────

export const BASELINE_DEALS_DIANA_ABORDAGEM: CommercialPipelineDeal[] = [
  {
    id: "deal-dg-01",
    title: "Droga Vita",
    funnelName: "FUNIL MÁQUINAS",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 3000,
    daysOpen: 27,
    createdAt: "10 de set. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-01",
  },
  {
    id: "deal-dg-02",
    title: "Maicon Buisn Werplotz",
    funnelName: "FUNIL PERSONNALITÉ",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 44,
    createdAt: "24 de ago. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-02",
  },
  {
    id: "deal-dg-03",
    title: "Thomaz dias machado",
    funnelName: "FUNIL PERSONNALITÉ",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 43,
    createdAt: "25 de ago. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-03",
  },
  {
    id: "deal-dg-04",
    title: "FAGNER | Teppey",
    funnelName: "FUNIL PERSONNALITÉ",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 42,
    createdAt: "26 de ago. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-04",
  },
  {
    id: "deal-dg-05",
    title: "Rodrigo",
    funnelName: "FUNIL PERSONNALITÉ",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 38,
    createdAt: "30 de ago. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-05",
  },
  {
    id: "deal-dg-06",
    title: "FAGNER | Eric silva",
    funnelName: "FUNIL PERSONNALITÉ",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 33,
    createdAt: "04 de set. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-06",
  },
  {
    id: "deal-dg-07",
    title: "FAGNER | Marcelo Soares",
    funnelName: "FUNIL MÁQUINAS",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 29,
    createdAt: "08 de set. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-07",
  },
  {
    id: "deal-dg-08",
    title: "milton Marçal",
    funnelName: "FUNIL MÁQUINAS",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 26,
    createdAt: "11 de set. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-08",
  },
  {
    id: "deal-dg-09",
    title: "Gabriel Silva",
    funnelName: "FUNIL PERSONNALITÉ",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 25,
    createdAt: "12 de set. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-09",
  },
  {
    id: "deal-dg-10",
    title: "FAGNER | Jéssica",
    funnelName: "FUNIL PERSONNALITÉ",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 23,
    createdAt: "14 de set. de 2026",
    stageKey: "abordagem_comercial",
    stageName: "Abordagem Comercial",
    rdDealUrl: "https://crm.rdstation.com/app/deals/deal-dg-10",
  },
];

// Gerador determinístico de negociações para preencher o conjunto completo
export function getBaselineDeals(
  sellerId?: string,
  stageKey?: PipelineStageKey,
): CommercialPipelineDeal[] {
  const deals: CommercialPipelineDeal[] = [...BASELINE_DEALS_DIANA_ABORDAGEM];

  // Adicionar negociações complementares para Diana em Abordagem Comercial até somar 42
  for (let i = 11; i <= 42; i++) {
    const days = Math.max(5, 50 - i);
    deals.push({
      id: `deal-dg-${i.toString().padStart(2, "0")}`,
      title: `Oportunidade Comercial #${i} - Cliente Tecfag`,
      funnelName: i % 2 === 0 ? "FUNIL PERSONNALITÉ" : "FUNIL MÁQUINAS",
      responsibleName: "Diana Gimenes",
      responsibleId: "op-tf-diana.gimenes.93",
      division: "personnalite",
      value: i === 15 ? 1500 : i === 22 ? 800 : 0,
      daysOpen: days,
      createdAt: `${Math.min(28, ((i * 2) % 28) + 1)} de ago. de 2026`,
      stageKey: "abordagem_comercial",
      stageName: "Abordagem Comercial",
      rdDealUrl: `https://crm.rdstation.com/app/deals/deal-dg-${i}`,
    });
  }

  // Negociações de Requalificação (2)
  deals.push(
    {
      id: "deal-dg-req-1",
      title: "Requalificação Industrial Alpha",
      funnelName: "FUNIL PERSONNALITÉ",
      responsibleName: "Diana Gimenes",
      responsibleId: "op-tf-diana.gimenes.93",
      division: "personnalite",
      value: 0,
      daysOpen: 65,
      createdAt: "12 de jul. de 2026",
      stageKey: "requalificacao",
      stageName: "Requalificação",
    },
    {
      id: "deal-dg-req-2",
      title: "Requalificação Embalagens Beta",
      funnelName: "FUNIL MÁQUINAS",
      responsibleName: "Diana Gimenes",
      responsibleId: "op-tf-diana.gimenes.93",
      division: "personnalite",
      value: 0,
      daysOpen: 58,
      createdAt: "18 de jul. de 2026",
      stageKey: "requalificacao",
      stageName: "Requalificação",
    },
  );

  // Negociações de Esfriando (214)
  for (let i = 1; i <= 214; i++) {
    const val = i <= 10 ? 40_000 + i * 5_000 : i <= 30 ? 15_000 : 0;
    deals.push({
      id: `deal-dg-esf-${i}`,
      title: `Negócio em Atenção #${i} - Indústria ${i}`,
      funnelName: "FUNIL PERSONNALITÉ",
      responsibleName: "Diana Gimenes",
      responsibleId: "op-tf-diana.gimenes.93",
      division: "personnalite",
      value: val,
      daysOpen: 35 + (i % 30),
      createdAt: "15 de jul. de 2026",
      stageKey: "esfriando",
      stageName: "Esfriando",
    });
  }

  // Negociações de Leads Recebidos (12)
  for (let i = 1; i <= 12; i++) {
    deals.push({
      id: `deal-dg-rec-${i}`,
      title: `Lead Recente #${i} - Contato via Site`,
      funnelName: "FUNIL PERSONNALITÉ",
      responsibleName: "Diana Gimenes",
      responsibleId: "op-tf-diana.gimenes.93",
      division: "personnalite",
      value: i === 1 ? 22_000 : 0,
      daysOpen: 2 + (i % 5),
      createdAt: "06 de out. de 2026",
      stageKey: "leads_recebidos",
      stageName: "Leads Recebidos",
    });
  }

  // Negociações de Qualificado (27)
  for (let i = 1; i <= 27; i++) {
    const val = Math.round(1_300_000 / 27);
    deals.push({
      id: `deal-dg-qual-${i}`,
      title: `Oportunidade Qualificada #${i} - Farmacêutica ${i}`,
      funnelName: "FUNIL PERSONNALITÉ",
      responsibleName: "Diana Gimenes",
      responsibleId: "op-tf-diana.gimenes.93",
      division: "personnalite",
      value: val,
      daysOpen: 14 + (i % 10),
      createdAt: "20 de set. de 2026",
      stageKey: "qualificado",
      stageName: "Qualificado",
    });
  }

  // Negociações de Proposta Enviada (25)
  for (let i = 1; i <= 25; i++) {
    const val = Math.round(2_000_000 / 25);
    deals.push({
      id: `deal-dg-prop-${i}`,
      title: `Proposta Técnica #${i} - Grupo Cosméticos ${i}`,
      funnelName: "FUNIL PERSONNALITÉ",
      responsibleName: "Diana Gimenes",
      responsibleId: "op-tf-diana.gimenes.93",
      division: "personnalite",
      value: val,
      daysOpen: 8 + (i % 8),
      createdAt: "28 de set. de 2026",
      stageKey: "proposta_enviada",
      stageName: "Proposta Enviada",
    });
  }

  // Negociação de Fechamento (1)
  deals.push({
    id: "deal-dg-fech-1",
    title: "Contrato em Fechamento - Linha de Envasamento",
    funnelName: "FUNIL PERSONNALITÉ",
    responsibleName: "Diana Gimenes",
    responsibleId: "op-tf-diana.gimenes.93",
    division: "personnalite",
    value: 0,
    daysOpen: 4,
    createdAt: "04 de out. de 2026",
    stageKey: "fechamento",
    stageName: "Fechamento",
  });

  // Filtragem se informada
  let filtered = deals;
  if (sellerId) {
    filtered = filtered.filter((d) => d.responsibleId === sellerId);
  }
  if (stageKey) {
    filtered = filtered.filter((d) => d.stageKey === stageKey);
  }
  return filtered;
}
