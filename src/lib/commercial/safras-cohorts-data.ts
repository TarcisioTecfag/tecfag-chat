/**
 * Baseline data e definições de tipos para o módulo SAFRAS & RÉGUA DE-PARA
 * (Evolução Mensal de Criação de Oportunidades por Faixa de Valor - 9º Slide CWR).
 *
 * Mapeia a criação histórica de cards nos últimos 6 meses para as faixas da
 * Régua De-Para com base no valor e segrega itens sem classificação (sem valor).
 * Filtro estrito: FUNIL MÁQUINAS (Semi) e FUNIL PERSONNALITÉ.
 */

export interface TVCohortTierConfig {
  index: number;
  days: number;
  maxValue: number | null;
  label: string;
  valueRuleLabel: string;
  color: string;
}

export interface TVCohortTierPoint {
  tierIndex: number;
  days: number;
  label: string;
  valueRuleLabel: string;
  color: string;
  count: number;
  totalValue: number;
}

export interface TVCohortMonthData {
  monthKey: string;
  monthName: string;
  monthShort: string;
  year: number;
  fullLabel: string;
  isCurrentMonth: boolean;
  unclassifiedCount: number;
  unclassifiedValue: number;
  classifiedCount: number;
  classifiedValue: number;
  totalCards: number;
  totalValue: number;
  tiers: TVCohortTierPoint[];
}

export interface TVCohortsResponse {
  success: boolean;
  updatedAt: string;
  tiersConfig: TVCohortTierConfig[];
  months: TVCohortMonthData[];
  summary: {
    totalCardsAllMonths: number;
    totalUnclassifiedAllMonths: number;
    totalClassifiedAllMonths: number;
    totalValueAllMonths: number;
  };
}

export interface TVUnclassifiedDeal {
  id: string;
  name: string;
  userName: string;
  userAvatar?: string;
  team: string;
  pipelineName: string;
  stageName: string;
  totalPrice: number;
  dealCreatedAt: string;
  status: string;
  clientName?: string;
  companyName?: string;
}

export function formatBrlK(val: number): string {
  if (val >= 1000000) {
    return `R$ ${(val / 1000000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}M`;
  }
  if (val >= 1000) {
    return `R$ ${(val / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`;
  }
  return `R$ ${val.toLocaleString('pt-BR')}`;
}

export const DEFAULT_SAFRAS_TIERS_CONFIG: TVCohortTierConfig[] = [
  { index: 1, days: 3, maxValue: 8600, label: '3 DIAS', valueRuleLabel: '≤ R$ 8,6k', color: '#ef4444' },
  { index: 2, days: 15, maxValue: 50000, label: '15 DIAS', valueRuleLabel: '≤ R$ 50k', color: '#f59e0b' },
  { index: 3, days: 30, maxValue: 200000, label: '30 DIAS', valueRuleLabel: '≤ R$ 200k', color: '#3b82f6' },
  { index: 4, days: 60, maxValue: 600000, label: '60 DIAS', valueRuleLabel: '≤ R$ 600k', color: '#8b5cf6' },
  { index: 5, days: 90, maxValue: null, label: '90 DIAS', valueRuleLabel: '> R$ 600k', color: '#10b981' },
];

export const BASELINE_SAFRAS_MONTHS: TVCohortMonthData[] = [
  {
    monthKey: '2026-05',
    monthName: 'Maio',
    monthShort: 'Mai',
    year: 2026,
    fullLabel: 'Maio / 2026',
    isCurrentMonth: false,
    unclassifiedCount: 18,
    unclassifiedValue: 0,
    classifiedCount: 312,
    classifiedValue: 6240000,
    totalCards: 330,
    totalValue: 6240000,
    tiers: [
      { tierIndex: 1, days: 3, label: '3 DIAS', valueRuleLabel: '≤ R$ 8,6k', color: '#ef4444', count: 124, totalValue: 620000 },
      { tierIndex: 2, days: 15, label: '15 DIAS', valueRuleLabel: '≤ R$ 50k', color: '#f59e0b', count: 98, totalValue: 1860000 },
      { tierIndex: 3, days: 30, label: '30 DIAS', valueRuleLabel: '≤ R$ 200k', color: '#3b82f6', count: 52, totalValue: 2080000 },
      { tierIndex: 4, days: 60, label: '60 DIAS', valueRuleLabel: '≤ R$ 600k', color: '#8b5cf6', count: 26, totalValue: 1170000 },
      { tierIndex: 5, days: 90, label: '90 DIAS', valueRuleLabel: '> R$ 600k', color: '#10b981', count: 12, totalValue: 510000 },
    ],
  },
  {
    monthKey: '2026-06',
    monthName: 'Junho',
    monthShort: 'Jun',
    year: 2026,
    fullLabel: 'Junho / 2026',
    isCurrentMonth: false,
    unclassifiedCount: 22,
    unclassifiedValue: 0,
    classifiedCount: 345,
    classifiedValue: 6890000,
    totalCards: 367,
    totalValue: 6890000,
    tiers: [
      { tierIndex: 1, days: 3, label: '3 DIAS', valueRuleLabel: '≤ R$ 8,6k', color: '#ef4444', count: 136, totalValue: 680000 },
      { tierIndex: 2, days: 15, label: '15 DIAS', valueRuleLabel: '≤ R$ 50k', color: '#f59e0b', count: 104, totalValue: 1980000 },
      { tierIndex: 3, days: 30, label: '30 DIAS', valueRuleLabel: '≤ R$ 200k', color: '#3b82f6', count: 61, totalValue: 2440000 },
      { tierIndex: 4, days: 60, label: '60 DIAS', valueRuleLabel: '≤ R$ 600k', color: '#8b5cf6', count: 30, totalValue: 1260000 },
      { tierIndex: 5, days: 90, label: '90 DIAS', valueRuleLabel: '> R$ 600k', color: '#10b981', count: 14, totalValue: 530000 },
    ],
  },
  {
    monthKey: '2026-07',
    monthName: 'Julho',
    monthShort: 'Jul',
    year: 2026,
    fullLabel: 'Julho / 2026',
    isCurrentMonth: false,
    unclassifiedCount: 29,
    unclassifiedValue: 0,
    classifiedCount: 382,
    classifiedValue: 7420000,
    totalCards: 411,
    totalValue: 7420000,
    tiers: [
      { tierIndex: 1, days: 3, label: '3 DIAS', valueRuleLabel: '≤ R$ 8,6k', color: '#ef4444', count: 148, totalValue: 740000 },
      { tierIndex: 2, days: 15, label: '15 DIAS', valueRuleLabel: '≤ R$ 50k', color: '#f59e0b', count: 118, totalValue: 2240000 },
      { tierIndex: 3, days: 30, label: '30 DIAS', valueRuleLabel: '≤ R$ 200k', color: '#3b82f6', count: 68, totalValue: 2720000 },
      { tierIndex: 4, days: 60, label: '60 DIAS', valueRuleLabel: '≤ R$ 600k', color: '#8b5cf6', count: 32, totalValue: 1150000 },
      { tierIndex: 5, days: 90, label: '90 DIAS', valueRuleLabel: '> R$ 600k', color: '#10b981', count: 16, totalValue: 570000 },
    ],
  },
  {
    monthKey: '2026-08',
    monthName: 'Agosto',
    monthShort: 'Ago',
    year: 2026,
    fullLabel: 'Agosto / 2026',
    isCurrentMonth: false,
    unclassifiedCount: 34,
    unclassifiedValue: 0,
    classifiedCount: 398,
    classifiedValue: 7950000,
    totalCards: 432,
    totalValue: 7950000,
    tiers: [
      { tierIndex: 1, days: 3, label: '3 DIAS', valueRuleLabel: '≤ R$ 8,6k', color: '#ef4444', count: 152, totalValue: 760000 },
      { tierIndex: 2, days: 15, label: '15 DIAS', valueRuleLabel: '≤ R$ 50k', color: '#f59e0b', count: 125, totalValue: 2375000 },
      { tierIndex: 3, days: 30, label: '30 DIAS', valueRuleLabel: '≤ R$ 200k', color: '#3b82f6', count: 72, totalValue: 2880000 },
      { tierIndex: 4, days: 60, label: '60 DIAS', valueRuleLabel: '≤ R$ 600k', color: '#8b5cf6', count: 34, totalValue: 1320000 },
      { tierIndex: 5, days: 90, label: '90 DIAS', valueRuleLabel: '> R$ 600k', color: '#10b981', count: 15, totalValue: 615000 },
    ],
  },
  {
    monthKey: '2026-09',
    monthName: 'Setembro',
    monthShort: 'Set',
    year: 2026,
    fullLabel: 'Setembro / 2026',
    isCurrentMonth: false,
    unclassifiedCount: 42,
    unclassifiedValue: 0,
    classifiedCount: 426,
    classifiedValue: 8530000,
    totalCards: 468,
    totalValue: 8530000,
    tiers: [
      { tierIndex: 1, days: 3, label: '3 DIAS', valueRuleLabel: '≤ R$ 8,6k', color: '#ef4444', count: 165, totalValue: 825000 },
      { tierIndex: 2, days: 15, label: '15 DIAS', valueRuleLabel: '≤ R$ 50k', color: '#f59e0b', count: 135, totalValue: 2565000 },
      { tierIndex: 3, days: 30, label: '30 DIAS', valueRuleLabel: '≤ R$ 200k', color: '#3b82f6', count: 78, totalValue: 3120000 },
      { tierIndex: 4, days: 60, label: '60 DIAS', valueRuleLabel: '≤ R$ 600k', color: '#8b5cf6', count: 31, totalValue: 1364000 },
      { tierIndex: 5, days: 90, label: '90 DIAS', valueRuleLabel: '> R$ 600k', color: '#10b981', count: 17, totalValue: 656000 },
    ],
  },
  {
    monthKey: '2026-10',
    monthName: 'Outubro',
    monthShort: 'Out',
    year: 2026,
    fullLabel: 'Outubro / 2026',
    isCurrentMonth: true,
    unclassifiedCount: 47,
    unclassifiedValue: 0,
    classifiedCount: 105,
    classifiedValue: 2770000,
    totalCards: 152,
    totalValue: 2770000,
    tiers: [
      { tierIndex: 1, days: 3, label: '3 DIAS', valueRuleLabel: '≤ R$ 8,6k', color: '#ef4444', count: 44, totalValue: 220000 },
      { tierIndex: 2, days: 15, label: '15 DIAS', valueRuleLabel: '≤ R$ 50k', color: '#f59e0b', count: 32, totalValue: 608000 },
      { tierIndex: 3, days: 30, label: '30 DIAS', valueRuleLabel: '≤ R$ 200k', color: '#3b82f6', count: 18, totalValue: 720000 },
      { tierIndex: 4, days: 60, label: '60 DIAS', valueRuleLabel: '≤ R$ 600k', color: '#8b5cf6', count: 8, totalValue: 560000 },
      { tierIndex: 5, days: 90, label: '90 DIAS', valueRuleLabel: '> R$ 600k', color: '#10b981', count: 3, totalValue: 662000 },
    ],
  },
];

export const BASELINE_SAFRAS_SUMMARY = {
  totalCardsAllMonths: 2160,
  totalUnclassifiedAllMonths: 192,
  totalClassifiedAllMonths: 1968,
  totalValueAllMonths: 39800000,
};

export const BASELINE_UNCLASSIFIED_DEALS: Record<string, TVUnclassifiedDeal[]> = {
  '2026-10': [
    {
      id: 'deal-unc-10-1',
      name: 'Seladora Automática Contínua com Datador',
      userName: 'Diana Gimenes',
      team: 'PERSONNALITE',
      pipelineName: 'FUNIL PERSONNALITÉ 2.0',
      stageName: 'Abordagem Comercial',
      totalPrice: 0,
      dealCreatedAt: '2026-10-07T14:32:00Z',
      status: 'ongoing',
      clientName: 'Carlos Eduardo Mendes',
      companyName: 'Indústria Química Alfa Ltda',
    },
    {
      id: 'deal-unc-10-2',
      name: 'Embaladora a Vácuo de Dupla Câmara',
      userName: 'Melissa Gomes',
      team: 'MAQUINAS',
      pipelineName: 'FUNIL MÁQUINAS',
      stageName: 'Diagnóstico e Qualificação',
      totalPrice: 0,
      dealCreatedAt: '2026-10-06T11:20:00Z',
      status: 'ongoing',
      clientName: 'Mariana Silveira',
      companyName: 'Laticínios Serra Verde S.A.',
    },
    {
      id: 'deal-unc-10-3',
      name: 'Linha de Envase Rotativa para Frascos',
      userName: 'Victor Goes',
      team: 'MAQUINAS',
      pipelineName: 'FUNIL MÁQUINAS',
      stageName: 'Envio de Proposta',
      totalPrice: 0,
      dealCreatedAt: '2026-10-05T09:45:00Z',
      status: 'ongoing',
      clientName: 'Fernando Alencar',
      companyName: 'Cosméticos Bella Vita',
    },
    {
      id: 'deal-unc-10-4',
      name: 'Rosqueadeira Semi-Automática de Tampas',
      userName: 'Marcelo Nardelli',
      team: 'PERSONNALITE',
      pipelineName: 'FUNIL PERSONNALITÉ',
      stageName: 'Negociação / Fechamento',
      totalPrice: 0,
      dealCreatedAt: '2026-10-04T16:15:00Z',
      status: 'ongoing',
      clientName: 'Juliana Paes Correia',
      companyName: 'Farmacêutica Nova Era',
    },
    {
      id: 'deal-unc-10-5',
      name: 'Seladora em L com Túnel de Encolhimento',
      userName: 'Andreia Camargo',
      team: 'MAQUINAS',
      pipelineName: 'FUNIL MÁQUINAS',
      stageName: 'Abordagem Comercial',
      totalPrice: 0,
      dealCreatedAt: '2026-10-03T10:05:00Z',
      status: 'ongoing',
      clientName: 'Roberto Nogueira',
      companyName: 'Gráfica & Embalagens Express',
    },
    {
      id: 'deal-unc-10-6',
      name: 'Dosadora Pneumática de Pistão para Cremes',
      userName: 'Jhordan Rueda',
      team: 'PERSONNALITE',
      pipelineName: 'FUNIL PERSONNALITÉ',
      stageName: 'Diagnóstico e Qualificação',
      totalPrice: 0,
      dealCreatedAt: '2026-10-02T15:50:00Z',
      status: 'ongoing',
      clientName: 'Patrícia Toledo',
      companyName: 'Laboratórios Vitalis',
    },
    {
      id: 'deal-unc-10-7',
      name: 'Rotuladora Automática para Frascos Cilíndricos',
      userName: 'Beatriz Ribeiro',
      team: 'MAQUINAS',
      pipelineName: 'FUNIL MÁQUINAS',
      stageName: 'Envio de Proposta',
      totalPrice: 0,
      dealCreatedAt: '2026-10-01T13:40:00Z',
      status: 'ongoing',
      clientName: 'Marcos Vinicius Ribeiro',
      companyName: 'Cervejaria Artesanal Estrela',
    },
  ],
  '2026-09': [
    {
      id: 'deal-unc-09-1',
      name: 'Envasadora de Líquidos e Pastosos 4 Bicos',
      userName: 'Victor Goes',
      team: 'MAQUINAS',
      pipelineName: 'FUNIL MÁQUINAS',
      stageName: 'Abordagem Comercial',
      totalPrice: 0,
      dealCreatedAt: '2026-09-28T10:10:00Z',
      status: 'ongoing',
      clientName: 'Renato Farias',
      companyName: 'Indústria de Molhos Brasil',
    },
    {
      id: 'deal-unc-09-2',
      name: 'Fechadora de Caixas com Tração Superior',
      userName: 'Diana Gimenes',
      team: 'PERSONNALITE',
      pipelineName: 'FUNIL PERSONNALITÉ',
      stageName: 'Diagnóstico e Qualificação',
      totalPrice: 0,
      dealCreatedAt: '2026-09-22T14:40:00Z',
      status: 'ongoing',
      clientName: 'Luciana Gomes',
      companyName: 'Distribuidora LogSul',
    },
  ],
};

export function getBaselineSafrasCohortsData(): TVCohortsResponse {
  return {
    success: true,
    updatedAt: new Date().toISOString(),
    tiersConfig: DEFAULT_SAFRAS_TIERS_CONFIG,
    months: BASELINE_SAFRAS_MONTHS,
    summary: BASELINE_SAFRAS_SUMMARY,
  };
}

export function getBaselineUnclassifiedDeals(monthKey: string): TVUnclassifiedDeal[] {
  return BASELINE_UNCLASSIFIED_DEALS[monthKey] || BASELINE_UNCLASSIFIED_DEALS['2026-10'] || [];
}
