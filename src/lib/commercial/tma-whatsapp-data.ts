// ══════════════════════════════════════════════════════════════════════════════
// BASELINE OFICIAL: TMA WHATSAPP (CWR SLIDE 8 / TEMPO MÉDIO DE ATENDIMENTO)
// Calibrado com as fotos de referência enviadas pelo usuário:
// TMA Médio Hoje: 9 min (Dentro da meta de 15 min) • Taxa no SLA: 0% • Total Transferências: 0
// ══════════════════════════════════════════════════════════════════════════════

export interface TmaTimeBuckets {
  under5m: number;      // ≤ 5m (Verde)
  between5and15m: number; // 5-15m (Ciano / Verde claro)
  between15and30m: number; // 15-30m (Âmbar)
  over30m: number;       // > 30m (Vermelho)
}

export interface TmaConsultantRow {
  consultantId: string;
  name: string;
  division: "personnalite" | "maquinas";
  avatarUrl?: string;
  buckets: TmaTimeBuckets;
  totalAnswered: number;
  averageTimeFormatted?: string;
}

export interface TmaTeamGroup {
  teamKey: "personnalite" | "maquinas";
  teamLabel: string;
  badgeColorClass: string;
  consultants: TmaConsultantRow[];
}

export interface TmaKpis {
  averageMinutes: number; // 9 min
  targetMinutes: number; // 15 min
  slaPercent: number; // 0%
  totalTransfers: number; // 0
  firstContactCount: number; // 11
  waitingResponseCount: number; // 0
}

export interface TmaWaitingChatItem {
  id: string;
  conversationId: string;
  clientName: string;
  phone: string;
  consultantName: string;
  waitingSeconds: number;
  waitingFormatted: string;
  transferredAt: string;
}

export const BASELINE_TMA_KPIS: TmaKpis = {
  averageMinutes: 9,
  targetMinutes: 15,
  slaPercent: 0,
  totalTransfers: 0,
  firstContactCount: 11,
  waitingResponseCount: 0,
};

export const BASELINE_TMA_PERSONNALITE: TmaTeamGroup = {
  teamKey: "personnalite",
  teamLabel: "★ TIME PERSONNALITÉ",
  badgeColorClass: "text-[#f87171]",
  consultants: [
    {
      consultantId: "diana-gimenes",
      name: "Diana Gimenes",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
    {
      consultantId: "jhordan-rueda",
      name: "Jhordan Rueda",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
    {
      consultantId: "marcelo-nardelli",
      name: "Marcelo Nardelli",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
    {
      consultantId: "rosenvaldo-lucas",
      name: "Rosenvaldo Lucas",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
  ],
};

export const BASELINE_TMA_MAQUINAS: TmaTeamGroup = {
  teamKey: "maquinas",
  teamLabel: "⚍ TIME SEMI (MÁQUINAS)",
  badgeColorClass: "text-[#f59e0b]",
  consultants: [
    {
      consultantId: "andreia-camargo",
      name: "Andreia Camargo",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
    {
      consultantId: "beatriz-ribeiro",
      name: "Beatriz Ribeiro",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
    {
      consultantId: "denise-gomes",
      name: "Denise Gomes",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
    {
      consultantId: "melissa-gomes",
      name: "Melissa Gomes",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
    {
      consultantId: "mercado-livre-deborah",
      name: "MERCADO LIVRE / Deborah",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
    {
      consultantId: "victor-goes",
      name: "Victor Goes",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80",
      buckets: { under5m: 0, between5and15m: 0, between15and30m: 0, over30m: 0 },
      totalAnswered: 0,
    },
  ],
};

export const ALL_BASELINE_TMA_CONSULTANTS: TmaConsultantRow[] = [
  ...BASELINE_TMA_PERSONNALITE.consultants,
  ...BASELINE_TMA_MAQUINAS.consultants,
];
