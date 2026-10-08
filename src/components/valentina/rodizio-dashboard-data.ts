// ══════════════════════════════════════════════════════════════════════════════
// 📊 DADOS E HELPERS DO DASHBOARD DE RODÍZIO (Fagner / Valentina)
// ══════════════════════════════════════════════════════════════════════════════

import {
  RodizioStats,
  LeadByDay,
  LeadByFunnel,
  OperatorRow,
  CrmDeal,
  SectorConfig,
} from "./rodizio-dashboard-types";

export const SECTOR_CONFIGS: Record<string, SectorConfig> = {
  sdr: {
    key: "sdr",
    label: "⭐ SDR / Análise",
    shortLabel: "SDR",
    color: "from-violet-500 to-purple-600",
    accent: "#8b5cf6",
    bgLight: "bg-violet-50/50",
    bgDark: "dark:bg-violet-950/20",
    borderLight: "border-violet-200",
    borderDark: "dark:border-violet-800/40",
    badgeBg: "bg-violet-100 dark:bg-violet-900/40",
    badgeText: "text-violet-700 dark:text-violet-300",
  },
  personalite: {
    key: "personalite",
    label: "✨ Personnalité",
    shortLabel: "Personnalité",
    color: "from-pink-500 to-rose-500",
    accent: "#ec4899",
    bgLight: "bg-pink-50/40",
    bgDark: "dark:bg-pink-950/20",
    borderLight: "border-pink-200/70",
    borderDark: "dark:border-pink-800/40",
    badgeBg: "bg-pink-100 dark:bg-pink-900/40",
    badgeText: "text-pink-700 dark:text-pink-300",
  },
  maquinas: {
    key: "maquinas",
    label: "🔧 Máquinas",
    shortLabel: "Máquinas",
    color: "from-blue-500 to-indigo-500",
    accent: "#3b82f6",
    bgLight: "bg-blue-50/40",
    bgDark: "dark:bg-blue-950/20",
    borderLight: "border-blue-200/70",
    borderDark: "dark:border-blue-800/40",
    badgeBg: "bg-blue-100 dark:bg-blue-900/40",
    badgeText: "text-blue-700 dark:text-blue-300",
  },
  "pos venda": {
    key: "pos venda",
    label: "📦 Pós Venda",
    shortLabel: "Pós Venda",
    color: "from-amber-500 to-orange-500",
    accent: "#f59e0b",
    bgLight: "bg-amber-50/40",
    bgDark: "dark:bg-amber-950/20",
    borderLight: "border-amber-200/70",
    borderDark: "dark:border-amber-800/40",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40",
    badgeText: "text-amber-700 dark:text-amber-300",
  },
  financeiro: {
    key: "financeiro",
    label: "💰 Financeiro",
    shortLabel: "Financeiro",
    color: "from-emerald-500 to-teal-500",
    accent: "#10b981",
    bgLight: "bg-emerald-50/40",
    bgDark: "dark:bg-emerald-950/20",
    borderLight: "border-emerald-200/70",
    borderDark: "dark:border-emerald-800/40",
    badgeBg: "bg-emerald-100 dark:bg-emerald-900/40",
    badgeText: "text-emerald-700 dark:text-emerald-300",
  },
  pecas: {
    key: "pecas",
    label: "⚙️ Peças",
    shortLabel: "Peças",
    color: "from-red-500 to-rose-500",
    accent: "#ef4444",
    bgLight: "bg-red-50/40",
    bgDark: "dark:bg-red-950/20",
    borderLight: "border-red-200/70",
    borderDark: "dark:border-red-800/40",
    badgeBg: "bg-red-100 dark:bg-red-900/40",
    badgeText: "text-red-700 dark:text-red-300",
  },
};

export const FUNNEL_LABELS: Record<string, string> = {
  maquinas: "Máquinas",
  "sem-resposta": "sem-resposta",
  pecas: "Peças",
  "pos-venda": "Pós Venda",
  personalite: "Personnalité",
  comercial: "COMERCIAL",
  financeiro: "Financeiro",
  triagem: "Triagem",
  outros: "Outros",
};

export const FUNNEL_COLORS: Record<string, string> = {
  maquinas: "#f43f5e",
  "sem-resposta": "#1e293b",
  pecas: "#06b6d4",
  "pos-venda": "#10b981",
  personalite: "#f59e0b",
  comercial: "#8b5cf6",
  financeiro: "#10b981",
  outros: "#64748b",
};

export function getOperatorSector(op: {
  name: string;
  sector?: string | null;
  allowed_subflows?: string[] | null;
  is_sdr?: boolean;
}): string {
  if (op.is_sdr) return "sdr";

  if (op.allowed_subflows && Array.isArray(op.allowed_subflows)) {
    const subflows = op.allowed_subflows.map((s) => s.toLowerCase());
    if (subflows.includes("pecas") || subflows.includes("peças")) return "pecas";
    if (subflows.includes("maquinas") || subflows.includes("máquinas")) return "maquinas";
    if (subflows.includes("personalite") || subflows.includes("personnalite")) return "personalite";
    if (subflows.includes("financeiro")) return "financeiro";
    if (
      subflows.includes("pos venda") ||
      subflows.includes("pos-venda") ||
      subflows.includes("posvenda") ||
      subflows.includes("assistencia") ||
      subflows.includes("assist. tec.")
    ) {
      return "pos venda";
    }
  }

  if (op.sector) {
    const s = op.sector.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (s.includes("sdr") || s.includes("triagem") || s.includes("analise")) return "sdr";
    if (s.includes("personalite")) return "personalite";
    if (s.includes("maquina")) return "maquinas";
    if (s.includes("pos venda") || s.includes("pos-venda") || s.includes("posvenda") || s.includes("assistencia") || s.includes("suporte")) return "pos venda";
    if (s.includes("financeiro") || s.includes("faturamento") || s.includes("cobranca")) return "financeiro";
    if (s.includes("peca")) return "pecas";
  }

  // Identificação inteligente por nome para garantir aderência ao time
  const normName = op.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normName.includes("diana") || normName.includes("jhordan") || normName.includes("rosenvaldo") || normName.includes("marcelo")) {
    return "personalite";
  }
  if (normName.includes("denise") || normName.includes("beatriz") || normName.includes("victor") || normName.includes("andreia")) {
    return "maquinas";
  }
  if (normName.includes("deborah") || normName.includes("raiane") || normName.includes("maria vitoria") || normName.includes("lucimara")) {
    return "pos venda";
  }
  if (normName.includes("jessica")) {
    return "financeiro";
  }
  if (normName.includes("guilherme") || normName.includes("keicy")) {
    return "pecas";
  }
  if (normName.includes("rafaela")) {
    return "pecas";
  }

  return "maquinas";
}

// ─── Benchmark / High-Fidelity Data Generator ────────────────────────────────

export function getBenchmarkRodizioData(tenantId: string = "tecfag"): {
  stats: RodizioStats;
  byDay: LeadByDay[];
  byFunnel: LeadByFunnel[];
  operators: OperatorRow[];
  deals: CrmDeal[];
} {
  // 1. Gera 30 dias de distribuição diária
  const byDay: LeadByDay[] = [];
  const baseDate = new Date();
  const daysCount = 30;

  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    // Distribuição realista simulando a barra de gráfico do screenshot
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const count = isWeekend ? Math.floor(18 + Math.random() * 25) : Math.floor(65 + Math.random() * 70);
    byDay.push({ day: dayStr, count });
  }

  // 2. Funis (Distribuição por Funil do screenshot)
  const byFunnel: LeadByFunnel[] = [
    { funnel: "maquinas", count: 2378 },
    { funnel: "sem-resposta", count: 1297 },
    { funnel: "pecas", count: 937 },
    { funnel: "pos-venda", count: 865 },
    { funnel: "personalite", count: 721 },
    { funnel: "comercial", count: 288 },
  ];

  // 3. Operadores reais e seus cards (1:1 com o screenshot)
  const operators: OperatorRow[] = [
    // SDR / Análise
    {
      id: "op-sdr-rafaela",
      name: "Rafaela Lima",
      email: "rafaela.lima@tecfag.com.br",
      count: 3,
      compensation: 0,
      sector: "sdr",
      is_sdr: true,
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-sdr-1",
          name: "FUND DE APOIO AO ENSINO PESQ EAS...",
          company: "FUNDAÇÃO DE APOIO",
          created_at: "Hoje às 11:24",
          chatId: "conv-sdr-1",
        },
        {
          id: "card-sdr-2",
          name: "Elvis",
          company: "BEBIDAS BORGES",
          created_at: "Hoje às 10:45",
          chatId: "conv-sdr-2",
        },
        {
          id: "card-sdr-3",
          name: "PAULO AL",
          company: "AL ENGENHARIA",
          created_at: "Hoje às 09:12",
          chatId: "conv-sdr-3",
        },
      ],
    },

    // Personnalité
    {
      id: "op-tf-diana.gimenes.93",
      name: "Diana Gimenes - 93",
      email: "diana.gimenes@tecfag.com.br",
      count: 1,
      compensation: 2,
      sector: "personalite",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pers-1",
          name: "Caroline",
          company: "INDÚSTRIA DE COSMÉTICOS CAROLINE",
          created_at: "Hoje às 12:05",
          chatId: "conv-pers-1",
        },
      ],
    },
    {
      id: "op-tf-jhordan.rueda.102",
      name: "Jhordan Rueda - 102",
      email: "jhordan.rueda@tecfag.com.br",
      count: 1,
      compensation: 1,
      sector: "personalite",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pers-2",
          name: "Renato",
          company: "CONDICIONAMENTO BIOTECNOLOGI...",
          created_at: "Hoje às 11:50",
          chatId: "conv-pers-2",
        },
      ],
    },
    {
      id: "op-tf-rosenvaldo.lucas.121",
      name: "Rosenvaldo Lucas - 121",
      email: "rosenvaldo.lucas@tecfag.com.br",
      count: 1,
      compensation: 1,
      sector: "personalite",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pers-3",
          name: "Fernando",
          company: "ADEGA ARAGUARI LTDA",
          created_at: "Hoje às 10:15",
          chatId: "conv-pers-3",
        },
      ],
    },

    // Máquinas
    {
      id: "op-tf-denise.gomes.34",
      name: "Denise Gomes - 34",
      email: "denise.gomes@tecfag.com.br",
      count: 3,
      compensation: 2,
      sector: "maquinas",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-maq-1",
          name: "Camila Karifam",
          company: "PHARMASTHETICS DO BRASIL...",
          created_at: "Hoje às 12:10",
          chatId: "conv-maq-1",
        },
        {
          id: "card-maq-2",
          name: "Magno - CADLEX MINAS...",
          company: "CADLEX MINAS LTDA",
          created_at: "Hoje às 11:30",
          chatId: "conv-maq-2",
        },
        {
          id: "card-maq-3",
          name: "Nascino",
          company: "EMBALAGENS NASCINO",
          created_at: "Hoje às 10:02",
          chatId: "conv-maq-3",
        },
      ],
    },
    {
      id: "op-tf-beatriz.ribeiro.96",
      name: "Beatriz Ribeiro - 96",
      email: "beatriz.ribeiro@tecfag.com.br",
      count: 3,
      compensation: 2,
      sector: "maquinas",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-maq-4",
          name: "Colonia Porto",
          company: "COLONIA PORTO COMÉRCIO E S...",
          created_at: "Hoje às 11:45",
          chatId: "conv-maq-4",
        },
        {
          id: "card-maq-5",
          name: "Sergio",
          company: "CASA FLORALTO",
          created_at: "Hoje às 10:20",
          chatId: "conv-maq-5",
        },
        {
          id: "card-maq-6",
          name: "Antonio Mendonça",
          company: "AGROPECUÁRIA MENDONÇA",
          created_at: "Hoje às 09:35",
          chatId: "conv-maq-6",
        },
      ],
    },
    {
      id: "op-tf-victor.goes.95",
      name: "Victor Goes - 95",
      email: "victor.goes@tecfag.com.br",
      count: 2,
      compensation: 1,
      sector: "maquinas",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-maq-7",
          name: "Sidinei",
          company: "SIDINEI TRANSPORTES E LOG...",
          created_at: "Hoje às 11:05",
          chatId: "conv-maq-7",
        },
      ],
    },

    // Pós Venda
    {
      id: "op-tf-deborah.alves.94",
      name: "Deborah Alves - 94",
      email: "deborah.alves@tecfag.com.br",
      count: 3,
      compensation: 2,
      sector: "pos venda",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pos-1",
          name: "GROWTH SUPPLEMENTS...",
          company: "GROWTH SUPPLEMENTS PRODUTOS...",
          created_at: "Hoje às 12:20",
          chatId: "conv-pos-1",
        },
        {
          id: "card-pos-2",
          name: "JUNQUEIRA E LORDI SILV...",
          company: "JUNQUEIRA E LORDI SOLUÇÕES...",
          created_at: "Hoje às 11:15",
          chatId: "conv-pos-2",
        },
        {
          id: "card-pos-3",
          name: "Eliana",
          company: "FARMÁCIA CENTRAL",
          created_at: "Hoje às 09:50",
          chatId: "conv-pos-3",
        },
      ],
    },
    {
      id: "op-tf-raiane.aguiar.114",
      name: "Raiane Aguiar - 114",
      email: "raiane.aguiar@tecfag.com.br",
      count: 2,
      compensation: 1,
      sector: "pos venda",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pos-4",
          name: "Felipe",
          company: "SUPERPINUS MADEIRAS E ALUMIN...",
          created_at: "Hoje às 11:40",
          chatId: "conv-pos-4",
        },
        {
          id: "card-pos-5",
          name: "Pamela Felisbino Pereira...",
          company: "DISTRIBUIDORA PEREIRA",
          created_at: "Hoje às 10:30",
          chatId: "conv-pos-5",
        },
      ],
    },
    {
      id: "op-tf-maria.vitoria",
      name: "Maria Vitoria",
      email: "maria.vitoria@tecfag.com.br",
      count: 1,
      compensation: 0,
      sector: "pos venda",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pos-6",
          name: "Mauricio",
          company: "INDÚSTRIA MAURICIO",
          created_at: "Hoje às 11:22",
          chatId: "conv-pos-6",
        },
      ],
    },
    {
      id: "op-tf-lucimara.dal.mora",
      name: "Lucimara Dal Mora",
      email: "lucimara.dal.mora@tecfag.com.br",
      count: 1,
      compensation: 1,
      sector: "pos venda",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pos-7",
          name: "Cláudia",
          company: "LABORATÓRIO SÃO PAULO",
          created_at: "Hoje às 09:15",
          chatId: "conv-pos-7",
        },
      ],
    },

    // Financeiro
    {
      id: "op-tf-jessica",
      name: "Jessica Pimentel",
      email: "jessica.pimentel@tecfag.com.br",
      count: 3,
      compensation: 1,
      sector: "financeiro",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-fin-1",
          name: "Marcela",
          company: "PACK TO YOU INDUSTRIA E COMERC...",
          created_at: "Hoje às 12:15",
          chatId: "conv-fin-1",
        },
        {
          id: "card-fin-2",
          name: "Rodrigo - Blumenau Química",
          company: "Blumenau Química",
          created_at: "Hoje às 11:00",
          chatId: "conv-fin-2",
        },
        {
          id: "card-fin-3",
          name: "TOLLING DE INSUMOS AGRI...",
          company: "TOLLING DE INSUMOS AGRICOLAS L...",
          created_at: "Hoje às 09:40",
          chatId: "conv-fin-3",
        },
      ],
    },

    // Peças
    {
      id: "op-tf-rafaela.pecas",
      name: "Rafaela Lima",
      email: "rafaela.lima@tecfag.com.br",
      count: 3,
      compensation: 2,
      sector: "pecas",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pec-1",
          name: "FUND DE APOIO AO ENSI...",
          company: "FUNDAÇÃO DE APOIO",
          created_at: "Hoje às 11:24",
          chatId: "conv-pec-1",
        },
        {
          id: "card-pec-2",
          name: "Elvis",
          company: "BEBIDAS BORGES",
          created_at: "Hoje às 10:45",
          chatId: "conv-pec-2",
        },
        {
          id: "card-pec-3",
          name: "PAULO AL",
          company: "AL ENGENHARIA",
          created_at: "Hoje às 09:12",
          chatId: "conv-pec-3",
        },
      ],
    },
    {
      id: "op-tf-guilherme.bertola.115",
      name: "Guilherme Bertola - 115",
      email: "guilherme.bertola@tecfag.com.br",
      count: 2,
      compensation: 1,
      sector: "pecas",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pec-4",
          name: "Paulo",
          company: "M.F. EMBALAGENS LTDA",
          created_at: "Hoje às 11:35",
          chatId: "conv-pec-4",
        },
        {
          id: "card-pec-5",
          name: "Reinaldo",
          company: "REINALDO B. CONCEIÇÃO E CIA...",
          created_at: "Hoje às 10:10",
          chatId: "conv-pec-5",
        },
      ],
    },
    {
      id: "op-tf-keicy.cardoso",
      name: "Keicy Cardoso",
      email: "keicy.cardoso@tecfag.com.br",
      count: 2,
      compensation: 1,
      sector: "pecas",
      isParticipating: true,
      isOnLeave: false,
      isPenalized: false,
      cards: [
        {
          id: "card-pec-6",
          name: "Elisangela",
          company: "R.E. COMÉRCIO DE SUPRIMENTO...",
          created_at: "Hoje às 11:18",
          chatId: "conv-pec-6",
        },
        {
          id: "card-pec-7",
          name: "LUIZ PAULO",
          company: "TEXTIL ELASTAN IND E COM...",
          created_at: "Hoje às 09:55",
          chatId: "conv-pec-7",
        },
      ],
    },
  ];

  // 4. CRM Deals (para o modal "Deals no CRM")
  const deals: CrmDeal[] = [
    {
      id: "deal-1",
      name: "Seladora Automática Contínua 500w",
      company: "PHARMASTHETICS DO BRASIL LTDA",
      phone: "+5511998765432",
      rd_deal_id: "66f4a8b1c9",
      operator_name: "Denise Gomes - 34",
      sector: "maquinas",
      funnel: "maquinas",
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
    {
      id: "deal-2",
      name: "Envasadora Rotativa Alta Precisão",
      company: "INDÚSTRIA DE COSMÉTICOS CAROLINE",
      phone: "+5519981234567",
      rd_deal_id: "66f4a8b2d1",
      operator_name: "Diana Gimenes - 93",
      sector: "personalite",
      funnel: "personalite",
      created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    },
    {
      id: "deal-3",
      name: "Lote Válvulas Spray Recorrente 100k",
      company: "CONDICIONAMENTO BIOTECNOLOGI...",
      phone: "+5541999887766",
      rd_deal_id: "66f4a8b3e2",
      operator_name: "Jhordan Rueda - 102",
      sector: "personalite",
      funnel: "personalite",
      created_at: new Date(Date.now() - 3600000 * 6).toISOString(),
    },
    {
      id: "deal-4",
      name: "Kit Peças de Reposição Linha Vácuo",
      company: "M.F. EMBALAGENS LTDA",
      phone: "+5531987654321",
      rd_deal_id: "66f4a8b4f3",
      operator_name: "Guilherme Bertola - 115",
      sector: "pecas",
      funnel: "pecas",
      created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    },
    {
      id: "deal-5",
      name: "Manutenção Preventiva Seladora 2026",
      company: "GROWTH SUPPLEMENTS PRODUTOS...",
      phone: "+5547998877665",
      rd_deal_id: "66f4a8b5a4",
      operator_name: "Deborah Alves - 94",
      sector: "pos venda",
      funnel: "pos-venda",
      created_at: new Date(Date.now() - 3600000 * 10).toISOString(),
    },
    {
      id: "deal-6",
      name: "Condições Faturamento e Parcelamento 6x",
      company: "Blumenau Química",
      phone: "+5547987654321",
      rd_deal_id: "66f4a8b6b5",
      operator_name: "Jessica Pimentel",
      sector: "financeiro",
      funnel: "financeiro",
      created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    },
  ];

  return {
    stats: {
      totalLeads: 7207,
      syncedToCrm: 6052,
      triageDone: 5925,
      triageRate: 82,
      activeSessions: 0,
      avgScore: "2.6",
      costPerLead: 0.12,
      totalCost30d: 864.84,
      leadsWithCnpj: 4892,
    },
    byDay,
    byFunnel,
    operators,
    deals,
  };
}

// ─── Export CSV Helpers ──────────────────────────────────────────────────────

export function downloadDealsCSV(deals: CrmDeal[], period: string) {
  const headers = ["Nome", "Empresa", "Operador", "Setor", "Data", "ID Deal", "Telefone"];
  const rows = deals.map((d) => [
    d.name ?? "",
    d.company ?? "",
    d.operator_name ?? "",
    d.sector ?? "",
    new Date(d.created_at).toLocaleDateString("pt-BR"),
    d.rd_deal_id ?? "",
    d.phone ?? "",
  ]);
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(escape).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deals-crm-${period}d-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadOperatorsCSV(operators: OperatorRow[], periodStr: string) {
  const headers = ["Setor", "Operador", "Leads no Período", "Compensação Rodízio", "Status", "Cards Ativos"];
  const rows = operators.map((op) => {
    const sec = getOperatorSector(op);
    const secLabel = SECTOR_CONFIGS[sec]?.label || sec;
    const status = op.isOnLeave ? "Em Folga" : op.isPenalized ? "Penalizado" : op.isParticipating ? "Participando" : "Inativo";
    const cardsNames = (op.cards || []).map((c) => c.name).join(" | ");
    return [
      secLabel,
      op.name,
      String(op.count),
      String(op.compensation),
      status,
      cardsNames,
    ];
  });
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(escape).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `relatorio-rodizio-operadores-${periodStr}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
