export type PacingViewMode = "daily" | "weekly";
export type PacingStatus = "recuperar" | "alvo" | "acelerado";

export interface PacingSellerRow {
  sellerId: string;
  sellerName: string;
  division: "personnalite" | "maquinas";
  avatarUrl?: string;
  pacingStatus: PacingStatus;
  statusLabel: string; // "Recuperar", "No Alvo", "Acelerado"
  metaMonthly: number; // ex: 1_000_000
  realizedMonthly: number; // ex: 10_000
  realizedPercent: number; // ex: 0.9%
  remainingMonthly: number; // ex: 990_000
  // Meta Diária
  dailyGoal: number; // ex: 58_300 (R$ 58.3k)
  dailyRealized: number; // ex: 0
  dailyRealizedPercent: number; // ex: 0%
  // Meta Semanal
  weeklyGoal: number; // ex: 291_500 (R$ 291.5k)
  weeklyRealized: number; // ex: 9_000
  weeklyRealizedPercent: number; // ex: 3%
  // Oportunidades do Dia (De-Para)
  habeisCount: number; // ex: 35
  habeisValue: number; // ex: 2_930_000 (R$ 2.93M)
}

export interface TeamPacingData {
  teamName: string;
  division: "personnalite" | "maquinas";
  metaTotal: number;
  fechadoTotal: number;
  fechadoPercent: number;
  ritmoDiarioTotal: number;
  sellers: PacingSellerRow[];
}

export interface PacingDealItem {
  id: string;
  code: string;
  title: string;
  companyName: string;
  sellerId: string;
  sellerName: string;
  division: "personnalite" | "maquinas";
  contactName?: string;
  phone?: string;
  value: number;
  ageDays: number;
  horizonKey: "tier_3d" | "tier_15d" | "tier_30d" | "tier_60d" | "tier_90d" | "fora_regua";
  horizonLabel: string;
  crmStage: string;
  crmUrl?: string;
  isDelayed?: boolean;
  hasDirectiveCompleted?: boolean;
}

export interface PacingGlobalKpis {
  businessDaysRemaining: number;
  businessDaysTotal: number;
  businessDaysElapsed: number;
  elapsedPercent: number; // ponto onde fica o marcador vertical de run rate (ex: 22.7%)
  metaGlobal: number;
  realizedGlobal: number;
  globalPercent: number;
  companyPacingDaily: number;
  companyRealizedToday: number;
}

export const GLOBAL_PACING_KPIS: PacingGlobalKpis = {
  businessDaysRemaining: 17,
  businessDaysTotal: 22,
  businessDaysElapsed: 5,
  elapsedPercent: (5 / 22) * 100, // ~22.7%
  metaGlobal: 4_830_000,
  realizedGlobal: 1_070_000,
  globalPercent: 22.3,
  companyPacingDaily: 221_000,
  companyRealizedToday: 0,
};

// Formatação monetária tática
export function formatPacingCurrency(val: number): string {
  if (val >= 1_000_000) {
    const m = val / 1_000_000;
    return `R$ ${m.toFixed(2).replace(/\.00$/, "").replace(".", ",")}M`;
  }
  if (val >= 1_000) {
    const k = val / 1_000;
    return `R$ ${k.toFixed(1).replace(/\.0$/, "").replace(".", ",")}k`;
  }
  return `R$ ${val.toLocaleString("pt-BR")}`;
}

export function formatPacingShortCurrency(val: number): string {
  if (val >= 1_000_000) {
    const m = val / 1_000_000;
    return `R$ ${m.toFixed(2)}M`;
  }
  if (val >= 1_000) {
    const k = Math.round(val / 1_000);
    return `R$ ${k}k`;
  }
  return `R$ ${val}`;
}

// ─── DADOS OFICIAIS DO TIME PERSONNALITÉ (SLIDE 4) ───
export const BASELINE_PACING_PERSONNALITE: TeamPacingData = {
  teamName: "TIME PERSONNALITÉ",
  division: "personnalite",
  metaTotal: 2_940_000,
  fechadoTotal: 840_000,
  fechadoPercent: 28.5,
  ritmoDiarioTotal: 134_000,
  sellers: [
    {
      sellerId: "diana-gimenes",
      sellerName: "Diana",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "recuperar",
      statusLabel: "Recuperar",
      metaMonthly: 1_000_000,
      realizedMonthly: 10_000,
      realizedPercent: 0.9,
      remainingMonthly: 990_000,
      dailyGoal: 58_300,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 291_500,
      weeklyRealized: 9_000,
      weeklyRealizedPercent: 3,
      habeisCount: 35,
      habeisValue: 2_930_000,
    },
    {
      sellerId: "jhordan-rueda",
      sellerName: "Jhordan",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "alvo",
      statusLabel: "No Alvo",
      metaMonthly: 580_000,
      realizedMonthly: 150_000,
      realizedPercent: 25.1,
      remainingMonthly: 430_000,
      dailyGoal: 26_400,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 174_000,
      weeklyRealized: 148_000,
      weeklyRealizedPercent: 111,
      habeisCount: 117,
      habeisValue: 6_100_000,
    },
    {
      sellerId: "marcelo-nardelli",
      sellerName: "Marcelo",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "acelerado",
      statusLabel: "Acelerado",
      metaMonthly: 880_000,
      realizedMonthly: 630_000,
      realizedPercent: 71.6,
      remainingMonthly: 250_000,
      dailyGoal: 40_000,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 200_000,
      weeklyRealized: 630_000,
      weeklyRealizedPercent: 315,
      habeisCount: 9,
      habeisValue: 2_610_000,
    },
    {
      sellerId: "rosenvaldo-lucas",
      sellerName: "Rosenvaldo",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "recuperar",
      statusLabel: "Recuperar",
      metaMonthly: 480_000,
      realizedMonthly: 50_000,
      realizedPercent: 10.7,
      remainingMonthly: 430_000,
      dailyGoal: 25_200,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 124_000,
      weeklyRealized: 52_000,
      weeklyRealizedPercent: 41,
      habeisCount: 21,
      habeisValue: 3_140_000,
    },
  ],
};

// ─── DADOS OFICIAIS DO TIME SEMI (MÁQUINAS) (SLIDE 4) ───
export const BASELINE_PACING_SEMI_MAQUINAS: TeamPacingData = {
  teamName: "TIME SEMI (MÁQUINAS)",
  division: "maquinas",
  metaTotal: 1_890_000,
  fechadoTotal: 230_000,
  fechadoPercent: 12.3,
  ritmoDiarioTotal: 98_000,
  sellers: [
    {
      sellerId: "andreia-camargo",
      sellerName: "Andreia",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "recuperar",
      statusLabel: "Recuperar",
      metaMonthly: 400_000,
      realizedMonthly: 10_000,
      realizedPercent: 8.2,
      remainingMonthly: 390_000,
      dailyGoal: 18_200,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 81_000,
      weeklyRealized: 25_000,
      weeklyRealizedPercent: 31,
      habeisCount: 119,
      habeisValue: 3_240_000,
    },
    {
      sellerId: "beatriz-ribeiro",
      sellerName: "Beatriz",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "recuperar",
      statusLabel: "Recuperar",
      metaMonthly: 340_000,
      realizedMonthly: 30_000,
      realizedPercent: 9.9,
      remainingMonthly: 310_000,
      dailyGoal: 18_000,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 90_100,
      weeklyRealized: 34_000,
      weeklyRealizedPercent: 38,
      habeisCount: 133,
      habeisValue: 8_400_000,
    },
    {
      sellerId: "mercado-livre",
      sellerName: "MERCADO",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "alvo",
      statusLabel: "No Alvo",
      metaMonthly: 230_000,
      realizedMonthly: 50_000,
      realizedPercent: 22.6,
      remainingMonthly: 180_000,
      dailyGoal: 10_500,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 52_300,
      weeklyRealized: 54_000,
      weeklyRealizedPercent: 103,
      habeisCount: 134,
      habeisValue: 3_110_000,
    },
    {
      sellerId: "denise-gomes",
      sellerName: "Denise",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "recuperar",
      statusLabel: "Recuperar",
      metaMonthly: 340_000,
      realizedMonthly: 40_000,
      realizedPercent: 11.3,
      remainingMonthly: 300_000,
      dailyGoal: 17_700,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 88_700,
      weeklyRealized: 39_000,
      weeklyRealizedPercent: 44,
      habeisCount: 98,
      habeisValue: 1_160_000,
    },
    {
      sellerId: "melissa-gomes",
      sellerName: "Melissa",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "recuperar",
      statusLabel: "Recuperar",
      metaMonthly: 340_000,
      realizedMonthly: 50_000,
      realizedPercent: 15.0,
      remainingMonthly: 290_000,
      dailyGoal: 17_000,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 85_000,
      weeklyRealized: 51_000,
      weeklyRealizedPercent: 60,
      habeisCount: 84,
      habeisValue: 994_000,
    },
    {
      sellerId: "victor-goes",
      sellerName: "Victor",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80",
      pacingStatus: "recuperar",
      statusLabel: "Recuperar",
      metaMonthly: 340_000,
      realizedMonthly: 30_000,
      realizedPercent: 8.9,
      remainingMonthly: 310_000,
      dailyGoal: 18_200,
      dailyRealized: 0,
      dailyRealizedPercent: 0,
      weeklyGoal: 91_100,
      weeklyRealized: 38_000,
      weeklyRealizedPercent: 41,
      habeisCount: 131,
      habeisValue: 2_350_000,
    },
  ],
};

// ─── DADOS DO MODAL DE OPORTUNIDADES DO DIA (FOTO 2 - MARCELO NARDELLI) ───
export const BASELINE_PACING_DEALS: PacingDealItem[] = [
  {
    id: "pacing-deal-1",
    code: "0016186",
    title: "0016186 - Linha de Envase Própolis- Apisnutri",
    companyName: "0016186 - Linha de Envase Própolis- Apisnutri",
    sellerId: "marcelo-nardelli",
    sellerName: "Marcelo Nardelli",
    division: "personnalite",
    phone: "11988887766",
    value: 484_000,
    ageDays: 289,
    horizonKey: "tier_60d",
    horizonLabel: "60 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "pacing-deal-2",
    code: "0016181",
    title: "0016181 - Seladora, Rotuladora e Rosqueadeira - Alphanutri",
    companyName: "0016181 - Seladora, Rotuladora e Rosqueadeira - Alphanutri",
    sellerId: "marcelo-nardelli",
    sellerName: "Marcelo Nardelli",
    division: "personnalite",
    phone: "11977776655",
    value: 111_000,
    ageDays: 288,
    horizonKey: "tier_30d",
    horizonLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "pacing-deal-3",
    code: "005856",
    title: "005856 - Linha de Envase - AQUA DO BRASIL",
    companyName: "005856 - Linha de Envase - AQUA DO BRASIL",
    sellerId: "marcelo-nardelli",
    sellerName: "Marcelo Nardelli",
    division: "personnalite",
    phone: "11966665544",
    value: 1_260_000,
    ageDays: 223,
    horizonKey: "tier_90d",
    horizonLabel: "90 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "pacing-deal-4",
    code: "0019647",
    title: "0019647- Rotuladoras - N O DOS SANTOS",
    companyName: "0019647- Rotuladoras - N O DOS SANTOS",
    sellerId: "marcelo-nardelli",
    sellerName: "Marcelo Nardelli",
    division: "personnalite",
    phone: "11955554433",
    value: 219_000,
    ageDays: 205,
    horizonKey: "tier_60d",
    horizonLabel: "60 DIAS",
    crmStage: "Proposta Enviada",
    hasDirectiveCompleted: true,
  },
  {
    id: "pacing-deal-5",
    code: "0022953",
    title: "0022953 - Seladora em L - Confio Fios e Cabos",
    companyName: "0022953 - Seladora em L - Confio Fios e Cabos",
    sellerId: "marcelo-nardelli",
    sellerName: "Marcelo Nardelli",
    division: "personnalite",
    phone: "11944443322",
    value: 182_000,
    ageDays: 72,
    horizonKey: "tier_30d",
    horizonLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "pacing-deal-6",
    code: "0023942",
    title: "0023942 - Inkjet Mx1 - Master Indústria",
    companyName: "0023942 - Inkjet Mx1 - Master Indústria",
    sellerId: "marcelo-nardelli",
    sellerName: "Marcelo Nardelli",
    division: "personnalite",
    phone: "11933332211",
    value: 28_000,
    ageDays: 20,
    horizonKey: "tier_15d",
    horizonLabel: "15 DIAS",
    crmStage: "Proposta Enviada",
    hasDirectiveCompleted: true,
  },
  {
    id: "pacing-deal-7",
    code: "0024011",
    title: "Grupo Admil",
    companyName: "Grupo Admil",
    sellerId: "marcelo-nardelli",
    sellerName: "Marcelo Nardelli",
    division: "personnalite",
    phone: "11922221100",
    value: 100_000,
    ageDays: 100,
    horizonKey: "tier_30d",
    horizonLabel: "30 DIAS",
    crmStage: "Qualificado",
  },
  {
    id: "pacing-deal-8",
    code: "0024022",
    title: "DPR Indústria",
    companyName: "DPR Indústria",
    sellerId: "marcelo-nardelli",
    sellerName: "Marcelo Nardelli",
    division: "personnalite",
    phone: "11911110099",
    value: 100_000,
    ageDays: 58,
    horizonKey: "tier_30d",
    horizonLabel: "30 DIAS",
    crmStage: "Qualificado",
  },
  {
    id: "pacing-deal-9",
    code: "0024033",
    title: "Café Serra do Piloto",
    companyName: "Café Serra do Piloto",
    sellerId: "marcelo-nardelli",
    sellerName: "Marcelo Nardelli",
    division: "personnalite",
    phone: "11900009988",
    value: 120_000,
    ageDays: 43,
    horizonKey: "tier_30d",
    horizonLabel: "30 DIAS",
    crmStage: "Abordagem Comercial",
    hasDirectiveCompleted: true,
  },
];

export function getBaselinePacingDeals(sellerId?: string): PacingDealItem[] {
  if (!sellerId) return BASELINE_PACING_DEALS;
  const filtered = BASELINE_PACING_DEALS.filter((d) => d.sellerId === sellerId);
  if (filtered.length > 0) return filtered;
  // Se for outro consultor, retorna os mesmos deals ajustando o sellerId
  return BASELINE_PACING_DEALS.map((d) => ({
    ...d,
    sellerId,
  }));
}
