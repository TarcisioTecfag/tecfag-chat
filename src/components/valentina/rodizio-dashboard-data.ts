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
    label: "SDR / Análise",
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
    label: "Personnalité",
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
    label: "Máquinas",
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
    label: "Pós Venda",
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
    label: "Financeiro",
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
    label: "Peças",
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
  "sem-resposta": "Sem Resposta",
  sem_resposta: "Sem Resposta",
  pecas: "Peças",
  "pos-venda": "Pós Venda",
  pos_venda: "Pós Venda",
  "assistencia-tecnica": "Assistência Técnica",
  assistencia_tecnica: "Assistência Técnica",
  personalite: "Personnalité",
  comercial: "Comercial",
  financeiro: "Financeiro",
  triagem: "Em Triagem (IA)",
  outros: "Outros",
};

export const FUNNEL_COLORS: Record<string, string> = {
  maquinas: "#3b82f6",
  "sem-resposta": "#64748b",
  sem_resposta: "#64748b",
  pecas: "#ef4444",
  "pos-venda": "#f59e0b",
  pos_venda: "#f59e0b",
  "assistencia-tecnica": "#0284c7",
  assistencia_tecnica: "#0284c7",
  personalite: "#ec4899",
  comercial: "#8b5cf6",
  financeiro: "#10b981",
  triagem: "#8b5cf6",
  outros: "#94a3b8",
};

export function getOperatorSector(op: {
  name: string;
  sector?: string | null;
  allowed_subflows?: string[] | null;
  is_sdr?: boolean;
}): string {
  if (op.is_sdr) return "sdr";

  if (op.sector) {
    const s = op.sector.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (s === "sdr" || s.includes("sdr") || s.includes("triagem") || s.includes("analise")) return "sdr";
    if (s.includes("personalite") || s.includes("personnalite")) return "personalite";
    if (s.includes("maquina")) return "maquinas";
    if (
      s.includes("pos venda") ||
      s.includes("pos-venda") ||
      s.includes("pos_venda") ||
      s.includes("posvenda") ||
      s.includes("assistencia") ||
      s.includes("tecnica") ||
      s.includes("suporte")
    ) {
      return "pos venda";
    }
    if (s.includes("financeiro") || s.includes("faturamento") || s.includes("cobranca") || s.includes("boleto")) {
      return "financeiro";
    }
    if (s.includes("peca")) return "pecas";
  }

  if (op.allowed_subflows && Array.isArray(op.allowed_subflows)) {
    const subflows = op.allowed_subflows.map((s) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
    );
    if (subflows.some((s) => s.includes("peca"))) return "pecas";
    if (subflows.some((s) => s.includes("personalite") || s.includes("personnalite"))) return "personalite";
    if (subflows.some((s) => s.includes("financeiro") || s.includes("boleto") || s.includes("nota fiscal"))) return "financeiro";
    if (
      subflows.some(
        (s) =>
          s.includes("pos venda") ||
          s.includes("pos-venda") ||
          s.includes("posvenda") ||
          s.includes("assistencia") ||
          s.includes("rastreio")
      )
    ) {
      return "pos venda";
    }
    if (subflows.some((s) => s.includes("maquina"))) return "maquinas";
  }

  const normName = op.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normName.includes("rafaela")) {
    return "sdr";
  }
  if (normName.includes("diana") || normName.includes("jhordan") || normName.includes("rosenvaldo") || normName.includes("marcelo")) {
    return "personalite";
  }
  if (normName.includes("denise") || normName.includes("beatriz") || normName.includes("victor") || normName.includes("andreia") || normName.includes("melissa")) {
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

  return "maquinas";
}

// ─── Estado Inicial Vazio (100% Sem Mock Data) ───────────────────────────────

export function getEmptyRodizioData(): {
  stats: RodizioStats;
  byDay: LeadByDay[];
  byFunnel: LeadByFunnel[];
  operators: OperatorRow[];
  deals: CrmDeal[];
} {
  return {
    stats: {
      totalLeads: 0,
      syncedToCrm: 0,
      triageDone: 0,
      triageRate: 0,
      activeSessions: 0,
      avgScore: "0.0",
      costPerLead: 0,
      totalCost30d: 0,
      leadsWithCnpj: 0,
    },
    byDay: [],
    byFunnel: [],
    operators: [],
    deals: [],
  };
}

/**
 * @deprecated Mantido apenas por compatibilidade de assinatura — retorna estado zerado sem dados fictícios.
 */
export function getBenchmarkRodizioData(_tenantId: string = "tecfag") {
  return getEmptyRodizioData();
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
