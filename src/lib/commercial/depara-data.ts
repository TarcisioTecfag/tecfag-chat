export type DeparaTierKey = "tier_3d" | "tier_15d" | "tier_30d" | "tier_60d" | "tier_90d";

export interface DeparaTierDefinition {
  key: DeparaTierKey;
  daysLabel: string;
  thresholdLabel: string;
  days: number;
  colorClass: string;
  dotColor: string;
  badgeBg: string;
}

export const DEPARA_TIERS: DeparaTierDefinition[] = [
  {
    key: "tier_3d",
    daysLabel: "3 DIAS",
    thresholdLabel: "≤ R$ 8.5k",
    days: 3,
    colorClass: "bg-[#8b1d1d] hover:bg-[#a12323] text-white",
    dotColor: "bg-red-500",
    badgeBg: "border-red-500/40 text-red-400 bg-red-950/20",
  },
  {
    key: "tier_15d",
    daysLabel: "15 DIAS",
    thresholdLabel: "≤ R$ 50k",
    days: 15,
    colorClass: "bg-[#b45309] hover:bg-[#d97706] text-white",
    dotColor: "bg-amber-500",
    badgeBg: "border-amber-500/40 text-amber-400 bg-amber-950/20",
  },
  {
    key: "tier_30d",
    daysLabel: "30 DIAS",
    thresholdLabel: "≤ R$ 200k",
    days: 30,
    colorClass: "bg-[#1d4ed8] hover:bg-[#2563eb] text-white",
    dotColor: "bg-blue-500",
    badgeBg: "border-blue-500/40 text-blue-400 bg-blue-950/20",
  },
  {
    key: "tier_60d",
    daysLabel: "60 DIAS",
    thresholdLabel: "≤ R$ 600k",
    days: 60,
    colorClass: "bg-[#6b21a8] hover:bg-[#7e22ce] text-white",
    dotColor: "bg-purple-500",
    badgeBg: "border-purple-500/40 text-purple-400 bg-purple-950/20",
  },
  {
    key: "tier_90d",
    daysLabel: "90 DIAS",
    thresholdLabel: "> R$ 600k",
    days: 90,
    colorClass: "bg-[#047857] hover:bg-[#059669] text-white",
    dotColor: "bg-emerald-500",
    badgeBg: "border-emerald-500/40 text-emerald-400 bg-emerald-950/20",
  },
];

export interface SellerDeparaRow {
  sellerId: string;
  sellerName: string;
  division: "personnalite" | "maquinas";
  avatarUrl?: string;
  metaValue: number; // ex: 1_000_000
  conversionPercent: number; // ex: 50%
  realizedValue: number; // ex: 291_000
  realizedPercent: number; // ex: 29%
  tiers: Record<DeparaTierKey, { value: number; formatted: string }>;
  tasksCount: number; // ex: 12
  totalMaduroValue: number; // ex: 2_930_000
  totalMaduroPercent: number; // ex: 293%
}

export interface TeamDeparaData {
  teamName: string;
  division: "personnalite" | "maquinas";
  metaTotal: number;
  maduroTotal: number;
  promessaTotal: number;
  sellers: SellerDeparaRow[];
}

export interface DeparaDealItem {
  id: string;
  title: string;
  companyName: string;
  sellerId: string;
  sellerName: string;
  division: "personnalite" | "maquinas";
  contactName?: string;
  phone?: string;
  value: number;
  ageDays: number;
  tierKey: DeparaTierKey | "out_of_rule";
  crmStage: string;
  isDelayed?: boolean;
}

// ─── DADOS OFICIAIS BASELINE DAS FOTOS (TV & MODAL) ───

export const BASELINE_DEPARA_PERSONNALITE: TeamDeparaData = {
  teamName: "TIME PERSONNALITÉ",
  division: "personnalite",
  metaTotal: 2_940_000,
  maduroTotal: 14_780_000,
  promessaTotal: 1_480_000,
  sellers: [
    {
      sellerId: "diana-gimenes",
      sellerName: "Diana",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      metaValue: 1_000_000,
      conversionPercent: 50,
      realizedValue: 291_000,
      realizedPercent: 29,
      tiers: {
        tier_3d: { value: 0, formatted: "0 MIL" },
        tier_15d: { value: 262_000, formatted: "262 MIL" },
        tier_30d: { value: 1_870_000, formatted: "1,87 MILHÕES" },
        tier_60d: { value: 789_000, formatted: "789 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      tasksCount: 12,
      totalMaduroValue: 2_930_000,
      totalMaduroPercent: 293,
    },
    {
      sellerId: "jhordan-rueda",
      sellerName: "Jhordan",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
      metaValue: 580_000,
      conversionPercent: 30,
      realizedValue: 416_000,
      realizedPercent: 72,
      tiers: {
        tier_3d: { value: 107_000, formatted: "107 MIL" },
        tier_15d: { value: 1_550_000, formatted: "1,55 MILHÕES" },
        tier_30d: { value: 2_180_000, formatted: "2,18 MILHÕES" },
        tier_60d: { value: 980_000, formatted: "980 MIL" },
        tier_90d: { value: 1_220_000, formatted: "1,22 MILHÕES" },
      },
      tasksCount: 2,
      totalMaduroValue: 6_100_000,
      totalMaduroPercent: 1051,
    },
    {
      sellerId: "marcelo-nardelli",
      sellerName: "Marcelo",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
      metaValue: 880_000,
      conversionPercent: 30,
      realizedValue: 241_000,
      realizedPercent: 40,
      tiers: {
        tier_3d: { value: 0, formatted: "0 MIL" },
        tier_15d: { value: 28_000, formatted: "28 MIL" },
        tier_30d: { value: 613_000, formatted: "613 MIL" },
        tier_60d: { value: 703_000, formatted: "703 MIL" },
        tier_90d: { value: 1_260_000, formatted: "1,26 MILHÕES" },
      },
      tasksCount: 3,
      totalMaduroValue: 2_610_000,
      totalMaduroPercent: 296,
    },
    {
      sellerId: "rosenvaldo-lucas",
      sellerName: "Rosenvaldo",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80",
      metaValue: 480_000,
      conversionPercent: 30,
      realizedValue: 334_000,
      realizedPercent: 85,
      tiers: {
        tier_3d: { value: 16_000, formatted: "16 MIL" },
        tier_15d: { value: 124_000, formatted: "124 MIL" },
        tier_30d: { value: 1_020_000, formatted: "1,02 MILHÕES" },
        tier_60d: { value: 1_980_000, formatted: "1,98 MILHÕES" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      tasksCount: 17,
      totalMaduroValue: 3_140_000,
      totalMaduroPercent: 654,
    },
  ],
};

export const BASELINE_DEPARA_SEMI_MAQUINAS: TeamDeparaData = {
  teamName: "TIME SEMI (MÁQUINAS)",
  division: "maquinas",
  metaTotal: 1_890_000,
  maduroTotal: 19_260_000,
  promessaTotal: 1_930_000,
  sellers: [
    {
      sellerId: "andreia-camargo",
      sellerName: "Andreia",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80",
      metaValue: 300_000,
      conversionPercent: 10,
      realizedValue: 824_000,
      realizedPercent: 87,
      tiers: {
        tier_3d: { value: 291_000, formatted: "291 MIL" },
        tier_15d: { value: 402_000, formatted: "402 MIL" },
        tier_30d: { value: 965_000, formatted: "965 MIL" },
        tier_60d: { value: 1_380_000, formatted: "1,38 MILHÕES" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      tasksCount: 15,
      totalMaduroValue: 3_240_000,
      totalMaduroPercent: 1081,
    },
    {
      sellerId: "beatriz-ribeiro",
      sellerName: "Beatriz",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80",
      metaValue: 340_000,
      conversionPercent: 10,
      realizedValue: 44_000,
      realizedPercent: 13,
      tiers: {
        tier_3d: { value: 204_000, formatted: "204 MIL" },
        tier_15d: { value: 650_000, formatted: "650 MIL" },
        tier_30d: { value: 2_040_000, formatted: "2,04 MILHÕES" },
        tier_60d: { value: 2_570_000, formatted: "2,57 MILHÕES" },
        tier_90d: { value: 2_010_000, formatted: "2,01 MILHÕES" },
      },
      tasksCount: 17,
      totalMaduroValue: 8_410_000,
      totalMaduroPercent: 2473,
    },
    {
      sellerId: "denise-gomes",
      sellerName: "Denise",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
      metaValue: 340_000,
      conversionPercent: 10,
      realizedValue: 114_000,
      realizedPercent: 34,
      tiers: {
        tier_3d: { value: 246_000, formatted: "246 MIL" },
        tier_15d: { value: 412_000, formatted: "412 MIL" },
        tier_30d: { value: 505_000, formatted: "505 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      tasksCount: 4,
      totalMaduroValue: 1_160_000,
      totalMaduroPercent: 342,
    },
    {
      sellerId: "melissa-gomes",
      sellerName: "Melissa",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
      metaValue: 340_000,
      conversionPercent: 10,
      realizedValue: 99_000,
      realizedPercent: 29,
      tiers: {
        tier_3d: { value: 244_000, formatted: "244 MIL" },
        tier_15d: { value: 585_000, formatted: "585 MIL" },
        tier_30d: { value: 162_000, formatted: "162 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      tasksCount: 5,
      totalMaduroValue: 990_000,
      totalMaduroPercent: 291,
    },
    {
      sellerId: "mercado-livre",
      sellerName: "MERCADO LIVRE / Deborah",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
      metaValue: 230_000,
      conversionPercent: 10,
      realizedValue: 371_000,
      realizedPercent: 161,
      tiers: {
        tier_3d: { value: 192_000, formatted: "192 MIL" },
        tier_15d: { value: 825_000, formatted: "825 MIL" },
        tier_30d: { value: 501_000, formatted: "501 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 1_390_000, formatted: "1,39 MILHÕES" },
      },
      tasksCount: 19,
      totalMaduroValue: 3_110_000,
      totalMaduroPercent: 1142,
    },
    {
      sellerId: "victor-goes",
      sellerName: "Victor",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80",
      metaValue: 340_000,
      conversionPercent: 10,
      realizedValue: 214_000,
      realizedPercent: 63,
      tiers: {
        tier_3d: { value: 271_000, formatted: "271 MIL" },
        tier_15d: { value: 989_000, formatted: "989 MIL" },
        tier_30d: { value: 855_000, formatted: "855 MIL" },
        tier_60d: { value: 231_000, formatted: "231 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      tasksCount: 5,
      totalMaduroValue: 2_350_000,
      totalMaduroPercent: 690,
    },
  ],
};

// ─── BASELINE DAS NEGOCIAÇÕES PARA O MODAL (FOTOS 2 E 3) ───

export const BASELINE_DEPARA_DEALS: DeparaDealItem[] = [
  // Diana Gimenes - 3 DIAS (Foto 2)
  {
    id: "deal-dg-3d-1",
    title: "Droga Vita",
    companyName: "Droga Vita",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499881122",
    value: 3_000,
    ageDays: 28,
    tierKey: "tier_3d",
    crmStage: "Abordagem Comercial",
  },
  {
    id: "deal-dg-3d-2",
    title: "Gabriele - MACANUDA INDUSTRIA COMERCIO LTDA",
    companyName: "Gabriele - MACANUDA INDUSTRIA COMERCIO LTDA",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499883344",
    value: 0,
    ageDays: 297,
    tierKey: "tier_3d",
    crmStage: "Esfriando",
  },
  {
    id: "deal-dg-3d-3",
    title: "0018359 -rosqueadora - Apoena Biosolucoes do Brasil Ltda.",
    companyName: "0018359 -rosqueadora - Apoena Biosolucoes do Brasil Ltda.",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499885566",
    value: 5_000,
    ageDays: 252,
    tierKey: "tier_3d",
    crmStage: "Esfriando",
  },

  // Diana Gimenes - 15 DIAS (Foto 3)
  {
    id: "deal-dg-15d-1",
    title: "PAULO MAURICIO SPASIUK PEREIRA",
    companyName: "PAULO MAURICIO SPASIUK PEREIRA",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499887788",
    value: 50_000,
    ageDays: 23,
    tierKey: "tier_15d",
    crmStage: "Proposta Enviada",
  },
  {
    id: "deal-dg-15d-2",
    title: "0024129 - EMPACOTADORA - CLEBERLEI",
    companyName: "0024129 - EMPACOTADORA - CLEBERLEI",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499889900",
    value: 40_000,
    ageDays: 14,
    tierKey: "tier_15d",
    crmStage: "Proposta Enviada",
    isDelayed: true,
  },
  {
    id: "deal-dg-15d-3",
    title: "0024228 - Rotuladora - Marcelo",
    companyName: "0024228 - Rotuladora - Marcelo",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499871122",
    value: 60_000,
    ageDays: 12,
    tierKey: "tier_15d",
    crmStage: "Proposta Enviada",
  },
  {
    id: "deal-dg-15d-4",
    title: "24258 - ROTULADORA - D&L LINHA VERDE",
    companyName: "24258 - ROTULADORA - D&L LINHA VERDE",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499873344",
    value: 48_000,
    ageDays: 8,
    tierKey: "tier_15d",
    crmStage: "Proposta Enviada",
  },
  {
    id: "deal-dg-15d-5",
    title: "TERMOFORMADORA - ALINE GIOVANA",
    companyName: "TERMOFORMADORA - ALINE GIOVANA",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499875566",
    value: 350_000,
    ageDays: 27,
    tierKey: "tier_15d",
    crmStage: "Qualificado",
  },
  {
    id: "deal-dg-15d-6",
    title: "Empacotadora - Marco Antonio Oliveira",
    companyName: "Empacotadora - Marco Antonio Oliveira",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499877788",
    value: 65_000,
    ageDays: 24,
    tierKey: "tier_15d",
    crmStage: "Qualificado",
  },
  {
    id: "deal-dg-15d-7",
    title: "Envasadora - Bruno M Carletti",
    companyName: "Envasadora - Bruno M Carletti",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499879900",
    value: 86_000,
    ageDays: 17,
    tierKey: "tier_15d",
    crmStage: "Qualificado",
  },
  {
    id: "deal-dg-15d-8",
    title: "Anderson Luiz Quatroque",
    companyName: "Anderson Luiz Quatroque",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499861122",
    value: 86_000,
    ageDays: 17,
    tierKey: "tier_15d",
    crmStage: "Qualificado",
  },
  {
    id: "deal-dg-15d-9",
    title: "Renata",
    companyName: "Renata",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499863344",
    value: 140_000,
    ageDays: 14,
    tierKey: "tier_15d",
    crmStage: "Qualificado",
  },
  {
    id: "deal-dg-15d-10",
    title: "Enfardadeira - Rafael",
    companyName: "Enfardadeira - Rafael",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499865566",
    value: 60_000,
    ageDays: 13,
    tierKey: "tier_15d",
    crmStage: "Qualificado",
  },
  {
    id: "deal-dg-15d-11",
    title: "Seladora Automática - AgroBrasil",
    companyName: "AgroBrasil Alimentos",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499867788",
    value: 45_000,
    ageDays: 11,
    tierKey: "tier_15d",
    crmStage: "Qualificado",
  },
  {
    id: "deal-dg-15d-12",
    title: "Datador Inkjet Industrial - Laticínios Vale",
    companyName: "Laticínios Vale",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499869900",
    value: 28_000,
    ageDays: 9,
    tierKey: "tier_15d",
    crmStage: "Qualificado",
  },

  // Diana Gimenes - 30 DIAS (17 negoc.)
  {
    id: "deal-dg-30d-1",
    title: "Linha de Enchimento Aerosol - Química Paulista",
    companyName: "Química Paulista Ltda",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499851122",
    value: 180_000,
    ageDays: 32,
    tierKey: "tier_30d",
    crmStage: "Proposta Enviada",
  },
  {
    id: "deal-dg-30d-2",
    title: "Envasadora Rotativa 8 Bicos - FarmaClean",
    companyName: "FarmaClean Indústria",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499853344",
    value: 195_000,
    ageDays: 35,
    tierKey: "tier_30d",
    crmStage: "Proposta Enviada",
  },

  // Diana Gimenes - 60 DIAS (3 negoc.)
  {
    id: "deal-dg-60d-1",
    title: "Linha Completa de Envase e Rotulagem - Cosméticos Bella",
    companyName: "Cosméticos Bella S.A.",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499841122",
    value: 580_000,
    ageDays: 64,
    tierKey: "tier_60d",
    crmStage: "Proposta Enviada",
  },
];

// Utilitário para formatar moeda e contadores
export function formatDeparaCurrency(val: number): string {
  if (val === 0) return "0 MIL";
  if (val >= 1_000_000) {
    const formatted = (val / 1_000_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });
    return `${formatted} MILHÕES`;
  }
  const formatted = Math.round(val / 1000);
  return `${formatted} MIL`;
}

export function formatDeparaMeta(val: number): string {
  if (val >= 1_000_000) {
    return `R$ ${(val / 1_000_000).toFixed(2)}M`;
  }
  return `R$ ${Math.round(val / 1000)}k`;
}

export function formatDealCurrencyDetail(val: number): string {
  if (val === 0) return "R$ 0,00 mil";
  if (val >= 1_000_000) {
    return `R$ ${(val / 1_000_000).toFixed(2).replace(".", ",")}M`;
  }
  return `R$ ${(val / 1000).toFixed(2).replace(".", ",")} mil`;
}

export function getBaselineDeparaDeals(sellerId?: string): DeparaDealItem[] {
  if (!sellerId) return BASELINE_DEPARA_DEALS;
  const filtered = BASELINE_DEPARA_DEALS.filter((d) => d.sellerId === sellerId);
  if (filtered.length > 0) return filtered;

  // Fallback para outros consultores: gera deals fictícios condizentes para demonstração
  const seller =
    BASELINE_DEPARA_PERSONNALITE.sellers.find((s) => s.sellerId === sellerId) ||
    BASELINE_DEPARA_SEMI_MAQUINAS.sellers.find((s) => s.sellerId === sellerId);

  const name = seller?.sellerName || "Consultor";
  const div = seller?.division || "personnalite";

  return [
    {
      id: `deal-${sellerId}-1`,
      title: `Oportunidade Comercial Especial - ${name}`,
      companyName: `${name} Soluções Industriais`,
      sellerId: sellerId,
      sellerName: name,
      division: div,
      phone: "1499880011",
      value: 75_000,
      ageDays: 16,
      tierKey: "tier_15d",
      crmStage: "Proposta Enviada",
      isDelayed: false,
    },
    {
      id: `deal-${sellerId}-2`,
      title: `Linha de Produção Automatizada - ${name}`,
      companyName: `Grupo Industrial Paulistano`,
      sellerId: sellerId,
      sellerName: name,
      division: div,
      phone: "1499882233",
      value: 190_000,
      ageDays: 34,
      tierKey: "tier_30d",
      crmStage: "Qualificado",
      isDelayed: true,
    },
  ];
}

