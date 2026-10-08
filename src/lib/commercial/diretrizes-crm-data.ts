// ══════════════════════════════════════════════════════════════════════════════
// BASELINE OFICIAL: DIRETRIZES CRM (CWR SLIDE 7 / GESTÃO COMERCIAL)
// Dados fiéis e calibrados com as 4 telas de referência do usuário:
// 14 deals sob gestão • R$ 455.000 • 100% Taxa de Execução • 0 em atraso
// ══════════════════════════════════════════════════════════════════════════════

export interface DiretrizDealDetail {
  id: string;
  dealId: string;
  title: string;
  companyName: string;
  consultantId: string;
  consultantName: string;
  division: "personnalite" | "maquinas";
  status: "concluida" | "hoje" | "atrasada";
  value: number;
  formattedValue: string;
  crmStage: string;
  assignedAt: string;
  gestorDirective: string;
  consultantResponse: string;
  channel?: "LIGAÇÃO" | "E-MAIL" | "WHATSAPP";
}

export interface DiretrizesConsultantRow {
  consultantId: string;
  name: string;
  division: "personnalite" | "maquinas";
  avatarUrl?: string;
  totalDirectives: number;
  concluidas: number;
  pendenteHoje: number;
  atrasadas: number;
  taxaExecucaoPercent: number | null; // 100 ou null (para exibir "—")
  totalValue: number;
  formattedValue: string;
  deals: DiretrizDealDetail[];
}

export interface DiretrizesTeamGroup {
  teamKey: "personnalite" | "maquinas";
  teamLabel: string;
  badgeColorClass: string;
  consultants: DiretrizesConsultantRow[];
}

export interface DiretrizesKpis {
  totalDeals: number;
  totalValue: number;
  formattedTotalValue: string;
  taxaExecucaoPercent: number;
  concluidasCount: number;
  totalCount: number;
  atrasoCount: number;
  atrasoLabel: string;
}

export const BASELINE_DIRETRIZES_KPIS: DiretrizesKpis = {
  totalDeals: 14,
  totalValue: 455_000,
  formattedTotalValue: "R$ 455.000",
  taxaExecucaoPercent: 100,
  concluidasCount: 14,
  totalCount: 14,
  atrasoCount: 0,
  atrasoLabel: "Tudo no prazo",
};

// ─── DEALS DETALHADOS DE DIANA GIMENES (FOTO 2) ───
const DIANA_DEALS: DiretrizDealDetail[] = [
  {
    id: "deal-diana-1",
    dealId: "101",
    title: "(Cópia) Tarcísio Silva — triagem nova TESTE",
    companyName: "(Cópia) Tarcísio Silva — triagem nova TESTE",
    consultantId: "diana-gimenes",
    consultantName: "Diana Gimenes",
    division: "personnalite",
    status: "concluida",
    value: 12_000,
    formattedValue: "R$ 12.000,00",
    crmStage: "Leads Recebidos (Faltam 15d p/ maturar)",
    assignedAt: "2026-10-01",
    gestorDirective: "GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO DIANA VIA LIGAÇÃO: responsavel",
    channel: "LIGAÇÃO",
  },
  {
    id: "deal-diana-2",
    dealId: "102",
    title: "Tarcísio Silva — triagem nova TESTE",
    companyName: "Tarcísio Silva — triagem nova TESTE",
    consultantId: "diana-gimenes",
    consultantName: "Diana Gimenes",
    division: "personnalite",
    status: "concluida",
    value: 10_000,
    formattedValue: "R$ 10.000,00",
    crmStage: "Leads Recebidos (Faltam 10d p/ maturar)",
    assignedAt: "2026-10-01",
    gestorDirective: "GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO DIANA VIA E-MAIL: Tratativa finalizada. Evidência arquivada no portal.",
    channel: "E-MAIL",
  },
];

// ─── DEALS DETALHADOS DE MELISSA GOMES (4 DEALS = R$ 86.000) ───
const MELISSA_DEALS: DiretrizDealDetail[] = [
  {
    id: "deal-melissa-1",
    dealId: "201",
    title: "Cosméticos Bella — Linha Envasadora Rotativa",
    companyName: "Cosméticos Bella S/A",
    consultantId: "melissa-gomes",
    consultantName: "Melissa Gomes",
    division: "maquinas",
    status: "concluida",
    value: 28_000,
    formattedValue: "R$ 28.000,00",
    crmStage: "Proposta Comercial",
    assignedAt: "2026-10-02",
    gestorDirective: "CONFIRMAR PRAZO DE ENTREGA E NEGOCIAR CONDIÇÃO ESPECIAL",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELA MELISSA VIA WHATSAPP: Proposta técnica aceita, aguardando faturamento.",
    channel: "WHATSAPP",
  },
  {
    id: "deal-melissa-2",
    dealId: "202",
    title: "PharmaLab Distribuidora — Seladora Contínua Horizontal",
    companyName: "PharmaLab Distribuidora Ltda",
    consultantId: "melissa-gomes",
    consultantName: "Melissa Gomes",
    division: "maquinas",
    status: "concluida",
    value: 22_000,
    formattedValue: "R$ 22.000,00",
    crmStage: "Qualificação Técnica",
    assignedAt: "2026-10-03",
    gestorDirective: "VERIFICAR COMPATIBILIDADE DE TENSÃO ELÉTRICA E BANCADA",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELA MELISSA VIA LIGAÇÃO: Alinhado com engenharia de produção, 220V trifásico aprovado.",
    channel: "LIGAÇÃO",
  },
  {
    id: "deal-melissa-3",
    dealId: "203",
    title: "Agro Indústria S/A — Datador Inkjet e Embaladora",
    companyName: "Agro Indústria Paulista S/A",
    consultantId: "melissa-gomes",
    consultantName: "Melissa Gomes",
    division: "maquinas",
    status: "concluida",
    value: 19_000,
    formattedValue: "R$ 19.000,00",
    crmStage: "Abordagem Comercial",
    assignedAt: "2026-10-04",
    gestorDirective: "APRESENTAR DEMONSTRAÇÃO EM VÍDEO DO DATADOR INDUSTRIAL",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELA MELISSA VIA E-MAIL: Vídeos de testes com as embalagens do cliente enviados com sucesso.",
    channel: "E-MAIL",
  },
  {
    id: "deal-melissa-4",
    dealId: "204",
    title: "Valem Alimentos — Termoencolhedora Compacta",
    companyName: "Valem Indústria Alimentícia",
    consultantId: "melissa-gomes",
    consultantName: "Melissa Gomes",
    division: "maquinas",
    status: "concluida",
    value: 17_000,
    formattedValue: "R$ 17.000,00",
    crmStage: "Fechamento",
    assignedAt: "2026-10-05",
    gestorDirective: "URGÊNCIA NO ENVIO DE CONTRATO MINUTA E DADOS BANCÁRIOS",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELA MELISSA VIA WHATSAPP: Minuta de contrato validada pela diretoria do cliente.",
    channel: "WHATSAPP",
  },
];

// ─── DEALS DETALHADOS DE VICTOR GOES (8 DEALS = R$ 347.000) ───
const VICTOR_DEALS: DiretrizDealDetail[] = [
  {
    id: "deal-victor-1",
    dealId: "301",
    title: "Frigorífico Boi Gordo — Embaladora a Vácuo Dupla",
    companyName: "Frigorífico Boi Gordo S/A",
    consultantId: "victor-goes",
    consultantName: "Victor Goes",
    division: "maquinas",
    status: "concluida",
    value: 68_000,
    formattedValue: "R$ 68.000,00",
    crmStage: "Fechamento",
    assignedAt: "2026-10-01",
    gestorDirective: "ACOMPANHAR LIBERAÇÃO DE CRÉDITO BNDES JUNTO AO GERENTE",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO VICTOR VIA LIGAÇÃO: Financiamento liberado pelo banco parceiro, contrato emitido.",
    channel: "LIGAÇÃO",
  },
  {
    id: "deal-victor-2",
    dealId: "302",
    title: "Bebidas do Sul — Linha de Envase Automática",
    companyName: "Bebidas do Sul Indústria",
    consultantId: "victor-goes",
    consultantName: "Victor Goes",
    division: "maquinas",
    status: "concluida",
    value: 62_000,
    formattedValue: "R$ 62.000,00",
    crmStage: "Proposta Enviada",
    assignedAt: "2026-10-02",
    gestorDirective: "VALIDAR LAYOUT DA FÁBRICA COM ENGENHARIA DE PRODUTO",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO VICTOR VIA E-MAIL: Desenho técnico validado pelo gestor de fábrica.",
    channel: "E-MAIL",
  },
  {
    id: "deal-victor-3",
    dealId: "303",
    title: "Química Moderna — Fechadora de Caixas Automática",
    companyName: "Química Moderna do Brasil",
    consultantId: "victor-goes",
    consultantName: "Victor Goes",
    division: "maquinas",
    status: "concluida",
    value: 54_000,
    formattedValue: "R$ 54.000,00",
    crmStage: "Qualificado",
    assignedAt: "2026-10-02",
    gestorDirective: "APRESENTAR CÁLCULO DE PAYBACK E RETORNO DE INVESTIMENTO",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO VICTOR VIA LIGAÇÃO: Payback em 4.5 meses demonstrado à gerência financeira.",
    channel: "LIGAÇÃO",
  },
  {
    id: "deal-victor-4",
    dealId: "304",
    title: "Café Colonial — Empacotadora Vertical com Balança",
    companyName: "Café Colonial Torrefação",
    consultantId: "victor-goes",
    consultantName: "Victor Goes",
    division: "maquinas",
    status: "concluida",
    value: 48_000,
    formattedValue: "R$ 48.000,00",
    crmStage: "Fechamento",
    assignedAt: "2026-10-03",
    gestorDirective: "FECHAMENTO CONDICIONADO A TREINAMENTO OPERACIONAL INCLUSO",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO VICTOR VIA WHATSAPP: Aditivo de instalação e treinamento incluso, acordo fechado.",
    channel: "WHATSAPP",
  },
  {
    id: "deal-victor-5",
    dealId: "305",
    title: "Laticínios Vale Verde — Seladora em L com Túnel",
    companyName: "Laticínios Vale Verde",
    consultantId: "victor-goes",
    consultantName: "Victor Goes",
    division: "maquinas",
    status: "concluida",
    value: 39_000,
    formattedValue: "R$ 39.000,00",
    crmStage: "Abordagem Comercial",
    assignedAt: "2026-10-04",
    gestorDirective: "REVISAR TABELA DE FRETE CIF/FOB PARA ENTREGA NO INTERIOR",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO VICTOR VIA LIGAÇÃO: Condição FOB ajustada com desconto especial de frete.",
    channel: "LIGAÇÃO",
  },
  {
    id: "deal-victor-6",
    dealId: "306",
    title: "Indústria de Plásticos SP — Detector de Metais Industrial",
    companyName: "Plásticos São Paulo Ltda",
    consultantId: "victor-goes",
    consultantName: "Victor Goes",
    division: "maquinas",
    status: "concluida",
    value: 32_000,
    formattedValue: "R$ 32.000,00",
    crmStage: "Proposta Enviada",
    assignedAt: "2026-10-04",
    gestorDirective: "ENVIAR CERTIFICADOS DE CALIBRAÇÃO E NORMAS DE SEGURANÇA",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO VICTOR VIA E-MAIL: Certificados de conformidade enviados e aceitos pelo cliente.",
    channel: "E-MAIL",
  },
  {
    id: "deal-victor-7",
    dealId: "307",
    title: "Doces & Geleias — Rotuladora Semi-Automática",
    companyName: "Doces & Conservas da Serra",
    consultantId: "victor-goes",
    consultantName: "Victor Goes",
    division: "maquinas",
    status: "concluida",
    value: 24_000,
    formattedValue: "R$ 24.000,00",
    crmStage: "Leads Recebidos",
    assignedAt: "2026-10-05",
    gestorDirective: "CONTATO IMEDIATO COM DIRETOR INDUSTRIAL PARA TESTE EM AMOSTRA",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO VICTOR VIA WHATSAPP: Amostras enviadas para nosso laboratório de testes.",
    channel: "WHATSAPP",
  },
  {
    id: "deal-victor-8",
    dealId: "308",
    title: "Grãos do Cerrado — Ensacadeira e Costuradora",
    companyName: "Cooperativa Grãos do Cerrado",
    consultantId: "victor-goes",
    consultantName: "Victor Goes",
    division: "maquinas",
    status: "concluida",
    value: 20_000,
    formattedValue: "R$ 20.000,00",
    crmStage: "Qualificado",
    assignedAt: "2026-10-05",
    gestorDirective: "NEGOCIAR ENTRADA DE 30% + PARCELAMENTO DIRETO",
    consultantResponse: "EXECUÇÃO CONCLUÍDA PELO VICTOR VIA LIGAÇÃO: Sinal pago e aprovação do comitê financeiro.",
    channel: "LIGAÇÃO",
  },
];

// ─── CONSULTANTS DATA (TODOS OS 10 CONSULTORES DAS 2 EQUIPES) ───
export const BASELINE_DIRETRIZES_PERSONNALITE: DiretrizesTeamGroup = {
  teamKey: "personnalite",
  teamLabel: "★ TIME PERSONNALITÉ",
  badgeColorClass: "text-[#f87171]",
  consultants: [
    {
      consultantId: "diana-gimenes",
      name: "Diana Gimenes",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 2,
      concluidas: 2,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: 100,
      totalValue: 22_000,
      formattedValue: "R$ 22k",
      deals: DIANA_DEALS,
    },
    {
      consultantId: "jhordan-rueda",
      name: "Jhordan Rueda",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 0,
      concluidas: 0,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: null,
      totalValue: 0,
      formattedValue: "R$ 0",
      deals: [],
    },
    {
      consultantId: "marcelo-nardelli",
      name: "Marcelo Nardelli",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 0,
      concluidas: 0,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: null,
      totalValue: 0,
      formattedValue: "R$ 0",
      deals: [],
    },
    {
      consultantId: "rosenvaldo-lucas",
      name: "Rosenvaldo Lucas",
      division: "personnalite",
      avatarUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 0,
      concluidas: 0,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: null,
      totalValue: 0,
      formattedValue: "R$ 0",
      deals: [],
    },
  ],
};

export const BASELINE_DIRETRIZES_MAQUINAS: DiretrizesTeamGroup = {
  teamKey: "maquinas",
  teamLabel: "🗝 TIME MÁQUINAS / SEMI",
  badgeColorClass: "text-[#f59e0b]",
  consultants: [
    {
      consultantId: "andreia-camargo",
      name: "Andreia Camargo",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 0,
      concluidas: 0,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: null,
      totalValue: 0,
      formattedValue: "R$ 0",
      deals: [],
    },
    {
      consultantId: "beatriz-ribeiro",
      name: "Beatriz Ribeiro",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 0,
      concluidas: 0,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: null,
      totalValue: 0,
      formattedValue: "R$ 0",
      deals: [],
    },
    {
      consultantId: "denise-gomes",
      name: "Denise Gomes",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 0,
      concluidas: 0,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: null,
      totalValue: 0,
      formattedValue: "R$ 0",
      deals: [],
    },
    {
      consultantId: "melissa-gomes",
      name: "Melissa Gomes",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 4,
      concluidas: 4,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: 100,
      totalValue: 86_000,
      formattedValue: "R$ 86k",
      deals: MELISSA_DEALS,
    },
    {
      consultantId: "mercado-livre-deborah",
      name: "MERCADO LIVRE / Deborah",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 0,
      concluidas: 0,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: null,
      totalValue: 0,
      formattedValue: "R$ 0",
      deals: [],
    },
    {
      consultantId: "victor-goes",
      name: "Victor Goes",
      division: "maquinas",
      avatarUrl: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80",
      totalDirectives: 8,
      concluidas: 8,
      pendenteHoje: 0,
      atrasadas: 0,
      taxaExecucaoPercent: 100,
      totalValue: 347_000,
      formattedValue: "R$ 347k",
      deals: VICTOR_DEALS,
    },
  ],
};

export const ALL_BASELINE_DIRETRIZES_CONSULTANTS: DiretrizesConsultantRow[] = [
  ...BASELINE_DIRETRIZES_PERSONNALITE.consultants,
  ...BASELINE_DIRETRIZES_MAQUINAS.consultants,
];

export function getAllDiretrizesDeals(): DiretrizDealDetail[] {
  return ALL_BASELINE_DIRETRIZES_CONSULTANTS.flatMap((c) => c.deals);
}

export function getConsultantDiretrizes(consultantId: string): DiretrizesConsultantRow | undefined {
  return ALL_BASELINE_DIRETRIZES_CONSULTANTS.find((c) => c.consultantId === consultantId);
}
