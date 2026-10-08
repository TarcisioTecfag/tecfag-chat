export type PrevistasTierKey = "tier_hoje" | "tier_15d" | "tier_30d" | "tier_60d" | "tier_90d";

export interface PrevistasTierDefinition {
  key: PrevistasTierKey;
  daysLabel: string;
  subLabel: string;
  days: number;
  colorClass: string;
  dotColor: string;
  badgeBg: string;
  colWidth: string;
}

export const PREVISTAS_TIERS: PrevistasTierDefinition[] = [
  {
    key: "tier_hoje",
    daysLabel: "HOJE",
    subLabel: "Prontos / Atrasados",
    days: 0,
    colorClass: "bg-[#8b1d1d] hover:bg-[#a12323] text-white",
    dotColor: "bg-red-500",
    badgeBg: "border-red-500/40 text-red-400 bg-red-950/20",
    colWidth: "w-[10%]",
  },
  {
    key: "tier_15d",
    daysLabel: "15 DIAS",
    subLabel: "A Faturar",
    days: 15,
    colorClass: "bg-[#b45309] hover:bg-[#d97706] text-white",
    dotColor: "bg-amber-500",
    badgeBg: "border-amber-500/40 text-amber-400 bg-amber-950/20",
    colWidth: "w-[13%]",
  },
  {
    key: "tier_30d",
    daysLabel: "30 DIAS",
    subLabel: "A Faturar",
    days: 30,
    colorClass: "bg-[#1d4ed8] hover:bg-[#2563eb] text-white",
    dotColor: "bg-blue-500",
    badgeBg: "border-blue-500/40 text-blue-400 bg-blue-950/20",
    colWidth: "w-[16%]",
  },
  {
    key: "tier_60d",
    daysLabel: "60 DIAS",
    subLabel: "A Faturar",
    days: 60,
    colorClass: "bg-[#6b21a8] hover:bg-[#7e22ce] text-white",
    dotColor: "bg-purple-500",
    badgeBg: "border-purple-500/40 text-purple-400 bg-purple-950/20",
    colWidth: "w-[20%]",
  },
  {
    key: "tier_90d",
    daysLabel: "90 DIAS",
    subLabel: "A Faturar",
    days: 90,
    colorClass: "bg-[#047857] hover:bg-[#059669] text-white",
    dotColor: "bg-emerald-500",
    badgeBg: "border-emerald-500/40 text-emerald-400 bg-emerald-950/20",
    colWidth: "w-[24%]",
  },
];

export interface SellerPrevistasRow {
  sellerId: string;
  sellerName: string;
  division: "personnalite" | "maquinas";
  avatarUrl?: string;
  metaValue: number; // ex: 1_000_000
  conversionPercent: number; // ex: 50%
  realizedValue: number; // ex: 291_000
  realizedPercent: number; // ex: 29%
  tiers: Record<PrevistasTierKey, { value: number; formatted: string }>;
  totalAFaturarValue: number; // ex: 3_940_000
  totalAFaturarPercent: number; // ex: 394%
}

export interface TeamPrevistasData {
  teamName: string;
  division: "personnalite" | "maquinas";
  metaTotal: number;
  aFaturarTotal: number;
  promessaTotal: number;
  sellers: SellerPrevistasRow[];
}

export interface PrevistasDealItem {
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
  horizonKey: PrevistasTierKey;
  faixaPrevisaoLabel: string; // ex: "30 DIAS", "60 DIAS", "15 DIAS"
  crmStage: string;
  isDelayed?: boolean;
  hasDirectiveCompleted?: boolean;
}

// ─── DADOS OFICIAIS BASELINE DA FOTO 1 (SLIDE 3: RESPONSABILIDADES PREVISTAS CWR) ───

export const BASELINE_PREVISTAS_PERSONNALITE: TeamPrevistasData = {
  teamName: "TIME PERSONNALITÉ",
  division: "personnalite",
  metaTotal: 2_940_000,
  aFaturarTotal: 20_050_000,
  promessaTotal: 2_000_000,
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
        tier_hoje: { value: 2_930_000, formatted: "2,93 MILHÕES" },
        tier_15d: { value: 297_000, formatted: "297 MIL" },
        tier_30d: { value: 260_000, formatted: "260 MIL" },
        tier_60d: { value: 250_000, formatted: "250 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      totalAFaturarValue: 3_940_000,
      totalAFaturarPercent: 394,
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
        tier_hoje: { value: 6_100_000, formatted: "6,10 MILHÕES" },
        tier_15d: { value: 11_000, formatted: "11 MIL" },
        tier_30d: { value: 66_000, formatted: "66 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      totalAFaturarValue: 6_170_000,
      totalAFaturarPercent: 1064,
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
        tier_hoje: { value: 2_610_000, formatted: "2,61 MILHÕES" },
        tier_15d: { value: 168_000, formatted: "168 MIL" },
        tier_30d: { value: 0, formatted: "0 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      totalAFaturarValue: 2_780_000,
      totalAFaturarPercent: 316,
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
        tier_hoje: { value: 3_140_000, formatted: "3,14 MILHÕES" },
        tier_15d: { value: 638_000, formatted: "638 MIL" },
        tier_30d: { value: 808_000, formatted: "808 MIL" },
        tier_60d: { value: 968_000, formatted: "968 MIL" },
        tier_90d: { value: 1_610_000, formatted: "1,61 MILHÕES" },
      },
      totalAFaturarValue: 7_160_000,
      totalAFaturarPercent: 1492,
    },
  ],
};

export const BASELINE_PREVISTAS_SEMI_MAQUINAS: TeamPrevistasData = {
  teamName: "TIME SEMI (MÁQUINAS)",
  division: "maquinas",
  metaTotal: 1_890_000,
  aFaturarTotal: 20_190_000,
  promessaTotal: 2_020_000,
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
        tier_hoje: { value: 3_240_000, formatted: "3,24 MILHÕES" },
        tier_15d: { value: 117_000, formatted: "117 MIL" },
        tier_30d: { value: 0, formatted: "0 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      totalAFaturarValue: 3_360_000,
      totalAFaturarPercent: 1119,
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
        tier_hoje: { value: 8_400_000, formatted: "8,40 MILHÕES" },
        tier_15d: { value: 286_000, formatted: "286 MIL" },
        tier_30d: { value: 269_000, formatted: "269 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      totalAFaturarValue: 8_960_000,
      totalAFaturarPercent: 2634,
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
        tier_hoje: { value: 1_160_000, formatted: "1,16 MILHÕES" },
        tier_15d: { value: 99_000, formatted: "99 MIL" },
        tier_30d: { value: 0, formatted: "0 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      totalAFaturarValue: 1_260_000,
      totalAFaturarPercent: 371,
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
        tier_hoje: { value: 994_000, formatted: "994 MIL" },
        tier_15d: { value: 88_000, formatted: "88 MIL" },
        tier_30d: { value: 0, formatted: "0 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      totalAFaturarValue: 1_080_000,
      totalAFaturarPercent: 319,
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
        tier_hoje: { value: 3_110_000, formatted: "3,11 MILHÕES" },
        tier_15d: { value: 0, formatted: "0 MIL" },
        tier_30d: { value: 0, formatted: "0 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      totalAFaturarValue: 3_110_000,
      totalAFaturarPercent: 1352,
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
        tier_hoje: { value: 2_350_000, formatted: "2,35 MILHÕES" },
        tier_15d: { value: 82_000, formatted: "82 MIL" },
        tier_30d: { value: 0, formatted: "0 MIL" },
        tier_60d: { value: 0, formatted: "0 MIL" },
        tier_90d: { value: 0, formatted: "0 MIL" },
      },
      totalAFaturarValue: 2_430_000,
      totalAFaturarPercent: 716,
    },
  ],
};

// ─── BASELINE DAS NEGOCIAÇÕES PARA O MODAL (FOTOS 2 E 3 - DIANA GIMENES) ───

export const BASELINE_PREVISTAS_DEALS: PrevistasDealItem[] = [
  // HOJE (Prontos / Atrasados) - Exatamente conforme Fotos 2 e 3
  {
    id: "prev-deal-1",
    code: "0021202",
    title: "0021202 - FLOWPACK - SOUZA E MAIA",
    companyName: "0021202 - FLOWPACK - SOUZA E MAIA",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499881122",
    value: 70_000,
    ageDays: 219,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
    isDelayed: true,
  },
  {
    id: "prev-deal-2",
    code: "0017247",
    title: "0017247 - FORTALEZA QUIMICA",
    companyName: "0017247 - FORTALEZA QUIMICA",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499883344",
    value: 230_000,
    ageDays: 218,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "60 DIAS",
    crmStage: "Proposta Enviada",
    isDelayed: true,
  },
  {
    id: "prev-deal-3",
    code: "0016479",
    title: "0016479 - CONTADORA - J B MAGALHAES LTDA",
    companyName: "0016479 - CONTADORA - J B MAGALHAES LTDA",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499885566",
    value: 139_000,
    ageDays: 197,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
    isDelayed: true,
  },
  {
    id: "prev-deal-4",
    code: "0020354",
    title: "0020354 - Empacotadora - Roberto",
    companyName: "0020354 - Empacotadora - Roberto",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499887788",
    value: 169_000,
    ageDays: 172,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
    hasDirectiveCompleted: true,
  },
  {
    id: "prev-deal-5",
    code: "20949",
    title: "20949 - MONTADORA - FELIPE",
    companyName: "20949 - MONTADORA - FELIPE",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499889900",
    value: 350_000,
    ageDays: 146,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "60 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-6",
    code: "21950",
    title: "21950 - PHITOS",
    companyName: "21950 - PHITOS",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499871122",
    value: 170_000,
    ageDays: 106,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-7",
    code: "21983",
    title: "21983 - SELADORA CONTINUA VACUO - Casa de Carnes Oriente",
    companyName: "21983 - SELADORA CONTINUA VACUO - Casa de Carnes Oriente",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499873344",
    value: 130_000,
    ageDays: 105,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-8",
    code: "22008",
    title: "22008 - ARLM160 - FARMACIA",
    companyName: "22008 - ARLM160 - FARMACIA",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499875566",
    value: 48_000,
    ageDays: 103,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "15 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-9",
    code: "22192",
    title: "22192 - ROTULADORA 450 - Henrique Schwabel",
    companyName: "22192 - ROTULADORA 450 - Henrique Schwabel",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499877788",
    value: 68_000,
    ageDays: 98,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-10",
    code: "22215",
    title: "22215 - Datador Térmico - Laticínio Serrano",
    companyName: "Laticínio Serrano Ltda",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499879900",
    value: 35_000,
    ageDays: 91,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "15 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-11",
    code: "22240",
    title: "22240 - Envasadora Automática - Alimentos Pura Soja",
    companyName: "Alimentos Pura Soja S.A.",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499861122",
    value: 125_000,
    ageDays: 85,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-12",
    code: "22290",
    title: "22290 - Seladora com Injeção de Gás - Indústria Bela Vista",
    companyName: "Indústria Bela Vista",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499863344",
    value: 82_000,
    ageDays: 78,
    horizonKey: "tier_hoje",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
  },

  // 15 DIAS (A Faturar - 8 negoc.)
  {
    id: "prev-deal-15d-1",
    code: "22310",
    title: "22310 - Linha Rotativa de Envase - Química Nova",
    companyName: "Química Nova Ltda",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499865566",
    value: 145_000,
    ageDays: 14,
    horizonKey: "tier_15d",
    faixaPrevisaoLabel: "15 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-15d-2",
    code: "22325",
    title: "22325 - Seladora Pneumática - Embalagens ABC",
    companyName: "Embalagens ABC",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499867788",
    value: 52_000,
    ageDays: 12,
    horizonKey: "tier_15d",
    faixaPrevisaoLabel: "15 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-15d-3",
    code: "22340",
    title: "22340 - Rotuladora Linear - Bebidas Vale Verde",
    companyName: "Bebidas Vale Verde",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499869900",
    value: 100_000,
    ageDays: 10,
    horizonKey: "tier_15d",
    faixaPrevisaoLabel: "15 DIAS",
    crmStage: "Proposta Enviada",
  },

  // 30 DIAS (A Faturar - 3 negoc.)
  {
    id: "prev-deal-30d-1",
    code: "22360",
    title: "22360 - Máquina Termoformadora - Plásticos União",
    companyName: "Plásticos União",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499851122",
    value: 180_000,
    ageDays: 28,
    horizonKey: "tier_30d",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
  },
  {
    id: "prev-deal-30d-2",
    code: "22375",
    title: "22375 - Fechadora de Caixas Automática - Distribuidora Sul",
    companyName: "Distribuidora Sul",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499853344",
    value: 80_000,
    ageDays: 25,
    horizonKey: "tier_30d",
    faixaPrevisaoLabel: "30 DIAS",
    crmStage: "Proposta Enviada",
  },

  // 60 DIAS (A Faturar - 1 negoc.)
  {
    id: "prev-deal-60d-1",
    code: "22400",
    title: "22400 - Linha Completa Industrial de Flowpack - Doces Brasil",
    companyName: "Doces Brasil Alimentos",
    sellerId: "diana-gimenes",
    sellerName: "Diana Gimenes",
    division: "personnalite",
    phone: "1499841122",
    value: 250_000,
    ageDays: 55,
    horizonKey: "tier_60d",
    faixaPrevisaoLabel: "60 DIAS",
    crmStage: "Proposta Enviada",
  },
];

export function getBaselinePrevistasDeals(sellerId?: string): PrevistasDealItem[] {
  if (!sellerId) return BASELINE_PREVISTAS_DEALS;
  const filtered = BASELINE_PREVISTAS_DEALS.filter((d) => d.sellerId === sellerId);
  if (filtered.length > 0) return filtered;

  // Fallback representativo para outros consultores
  const seller =
    BASELINE_PREVISTAS_PERSONNALITE.sellers.find((s) => s.sellerId === sellerId) ||
    BASELINE_PREVISTAS_SEMI_MAQUINAS.sellers.find((s) => s.sellerId === sellerId);

  const name = seller?.sellerName || "Consultor";
  const div = seller?.division || "personnalite";

  return [
    {
      id: `prev-${sellerId}-1`,
      code: "0025101",
      title: `0025101 - Linha de Envase - Cliente ${name}`,
      companyName: `Grupo Industrial ${name}`,
      sellerId: sellerId,
      sellerName: name,
      division: div,
      phone: "1499880011",
      value: 120_000,
      ageDays: 110,
      horizonKey: "tier_hoje",
      faixaPrevisaoLabel: "30 DIAS",
      crmStage: "Proposta Enviada",
      isDelayed: false,
    },
    {
      id: `prev-${sellerId}-2`,
      code: "0025102",
      title: `0025102 - Seladora Contínua - Parceiro ${name}`,
      companyName: `Comércio e Distribuição ${name}`,
      sellerId: sellerId,
      sellerName: name,
      division: div,
      phone: "1499882233",
      value: 85_000,
      ageDays: 145,
      horizonKey: "tier_hoje",
      faixaPrevisaoLabel: "15 DIAS",
      crmStage: "Proposta Enviada",
      isDelayed: true,
    },
  ];
}
