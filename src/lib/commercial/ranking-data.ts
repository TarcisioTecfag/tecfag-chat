export interface RankingOperatorRow {
  position: number; // 1 a 10
  operatorId: string;
  name: string;
  division: "Máquinas" | "Personnalité";
  avatarUrl?: string;
  averageTime: string; // ex: "— min" ou "2m 14s"
  slaPercent: number; // ex: 100
  bestTime: string; // ex: "32s"
  bestClient: string; // ex: "Valem Cosméticos"
  worstTime: string; // ex: "4m 12s"
  worstClient: string; // ex: "Embalagens Paulista"
  totalCalls?: number;
}

export const BASELINE_RANKING_OPERATORS: RankingOperatorRow[] = [
  // ─── 1º LUGAR: ANDREIA CAMARGO (MÁQUINAS) ───
  {
    position: 1,
    operatorId: "andreia-camargo",
    name: "Andreia Camargo",
    division: "Máquinas",
    avatarUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "32s",
    bestClient: "Valem Cosméticos",
    worstTime: "4m 12s",
    worstClient: "Embalagens Paulista",
    totalCalls: 38,
  },
  // ─── 2º LUGAR: BEATRIZ RIBEIRO (MÁQUINAS) ───
  {
    position: 2,
    operatorId: "beatriz-ribeiro",
    name: "Beatriz Ribeiro",
    division: "Máquinas",
    avatarUrl: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "41s",
    bestClient: "Perfumes Brasil",
    worstTime: "5m 30s",
    worstClient: "Farmacêutica Lins",
    totalCalls: 42,
  },
  // ─── 3º LUGAR: DENISE GOMES (MÁQUINAS) ───
  {
    position: 3,
    operatorId: "denise-gomes",
    name: "Denise Gomes",
    division: "Máquinas",
    avatarUrl: "https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "48s",
    bestClient: "Química Suprema",
    worstTime: "6m 15s",
    worstClient: "Alimentos Bela Vista",
    totalCalls: 31,
  },
  // ─── 4º LUGAR: DIANA GIMENES (PERSONNALITÉ) ───
  {
    position: 4,
    operatorId: "diana-gimenes",
    name: "Diana Gimenes",
    division: "Personnalité",
    avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "55s",
    bestClient: "Indústrias Matarazzo",
    worstTime: "7m 20s",
    worstClient: "Tecno Embalagens",
    totalCalls: 35,
  },
  // ─── 5º LUGAR: JHORDAN RUEDA (PERSONNALITÉ) ───
  {
    position: 5,
    operatorId: "jhordan-rueda",
    name: "Jhordan Rueda",
    division: "Personnalité",
    avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "1m 05s",
    bestClient: "Aerosol Express",
    worstTime: "8m 45s",
    worstClient: "Nutrientes do Brasil",
    totalCalls: 45,
  },
  // ─── 6º LUGAR: MARCELO NARDELLI (PERSONNALITÉ) ───
  {
    position: 6,
    operatorId: "marcelo-nardelli",
    name: "Marcelo Nardelli",
    division: "Personnalité",
    avatarUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "1m 12s",
    bestClient: "Frascos & Tampas SA",
    worstTime: "9m 10s",
    worstClient: "Cosméticos da Mata",
    totalCalls: 39,
  },
  // ─── 7º LUGAR: MELISSA GOMES (MÁQUINAS) ───
  {
    position: 7,
    operatorId: "melissa-gomes",
    name: "Melissa Gomes",
    division: "Máquinas",
    avatarUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "1m 20s",
    bestClient: "Linha Branca Industrial",
    worstTime: "10m 15s",
    worstClient: "Auto Peças Silva",
    totalCalls: 28,
  },
  // ─── 8º LUGAR: MERCADO LIVRE / DEBORAH (MÁQUINAS) ───
  {
    position: 8,
    operatorId: "mercado-livre-deborah",
    name: "MERCADO LIVRE / Deborah",
    division: "Máquinas",
    avatarUrl: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "1m 35s",
    bestClient: "Válvulas Premium ML",
    worstTime: "11m 40s",
    worstClient: "Distribuidora Santos",
    totalCalls: 53,
  },
  // ─── 9º LUGAR: ROSENVALDO LUCAS (PERSONNALITÉ) ───
  {
    position: 9,
    operatorId: "rosenvaldo-lucas",
    name: "Rosenvaldo Lucas",
    division: "Personnalité",
    avatarUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "1m 40s",
    bestClient: "Agro Soluções SP",
    worstTime: "12m 50s",
    worstClient: "Gráfica & Embalagens",
    totalCalls: 24,
  },
  // ─── 10º LUGAR: VICTOR GOES (MÁQUINAS) ───
  {
    position: 10,
    operatorId: "victor-goes",
    name: "Victor Goes",
    division: "Máquinas",
    avatarUrl: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80",
    averageTime: "— min",
    slaPercent: 100,
    bestTime: "1m 50s",
    bestClient: "Bebidas e Envases",
    worstTime: "14m 10s",
    worstClient: "Cervejaria Artesanal",
    totalCalls: 33,
  },
];
