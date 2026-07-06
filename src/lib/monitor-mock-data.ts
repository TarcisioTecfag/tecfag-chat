/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MONITOR MOCK DATA — Dados simulados para apresentação do sistema de gestão
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Para ATIVAR: definir DEMO_MODE = true em MonitorView.tsx
 * Para DESATIVAR: definir DEMO_MODE = false em MonitorView.tsx
 *
 * Todos os dados abaixo representam um dia típico de operação da Valem.
 */

// ── Tipos (espelhando MonitorView.tsx) ────────────────────────────────────────

export type OverviewData = {
  today: string;
  activeConversations: number;
  overdueAlerts: number;
  avgResponseTimeFormatted: string;
  teamPerformanceScore: number | null;
  operators: OperatorMetric[];
};

export type OperatorMetric = {
  operatorId: string;
  operatorName: string;
  operatorAvatar: string | null;
  status: string;
  totalConversations: number;
  avgResponseTimeFormatted: string;
  overdueCount: number;
  avgPerformanceScore: number | null;
  satisfiedCount: number;
  neutralCount: number;
  frustratedCount: number;
  trafficLight: "green" | "yellow" | "red";
};

export type AlertItem = {
  logId: string;
  conversationId: string;
  contactName: string;
  contactPhone: string | null;
  operatorName: string;
  waitingMinutes: number;
  waitingSeconds: number;
  isOverdue: boolean;
  isCritical: boolean;
};

export type AuditItem = {
  id: string;
  conversationId: string;
  contactName: string | null;
  operatorName: string;
  performanceScore: number | null;
  clientSentiment: string | null;
  hadLongResponseGap: boolean;
  hadMissedObjection: boolean;
  hadRudeLanguage: boolean;
  hadNoFollowUp: boolean;
  summary: string | null;
  strengths: string | null;
  weaknesses: string | null;
  actionableInsight: string | null;
  flagCount: number;
  auditedAt: string | null;
};

// ── Mock: Visão Geral ─────────────────────────────────────────────────────────

export const MOCK_OVERVIEW: OverviewData = {
  today: new Date().toISOString().split("T")[0],
  activeConversations: 9,
  overdueAlerts: 2,
  avgResponseTimeFormatted: "4min 18s",
  teamPerformanceScore: 84,
  operators: [
    {
      operatorId: "op-mock-1",
      operatorName: "Faggner Silva",
      operatorAvatar: null,
      status: "disponivel",
      totalConversations: 6,
      avgResponseTimeFormatted: "2min 45s",
      overdueCount: 0,
      avgPerformanceScore: 92,
      satisfiedCount: 5,
      neutralCount: 1,
      frustratedCount: 0,
      trafficLight: "green",
    },
    {
      operatorId: "op-mock-2",
      operatorName: "Ana Paula",
      operatorAvatar: null,
      status: "disponivel",
      totalConversations: 8,
      avgResponseTimeFormatted: "3min 52s",
      overdueCount: 0,
      avgPerformanceScore: 88,
      satisfiedCount: 6,
      neutralCount: 2,
      frustratedCount: 0,
      trafficLight: "green",
    },
    {
      operatorId: "op-mock-3",
      operatorName: "Pedro Henrique",
      operatorAvatar: null,
      status: "ocupado",
      totalConversations: 11,
      avgResponseTimeFormatted: "7min 10s",
      overdueCount: 1,
      avgPerformanceScore: 74,
      satisfiedCount: 7,
      neutralCount: 3,
      frustratedCount: 1,
      trafficLight: "yellow",
    },
    {
      operatorId: "op-mock-4",
      operatorName: "Juliana Costa",
      operatorAvatar: null,
      status: "disponivel",
      totalConversations: 5,
      avgResponseTimeFormatted: "5min 03s",
      overdueCount: 0,
      avgPerformanceScore: 79,
      satisfiedCount: 3,
      neutralCount: 2,
      frustratedCount: 0,
      trafficLight: "green",
    },
    {
      operatorId: "op-mock-5",
      operatorName: "Marcos Vinícius",
      operatorAvatar: null,
      status: "ausente",
      totalConversations: 4,
      avgResponseTimeFormatted: "18min 42s",
      overdueCount: 1,
      avgPerformanceScore: 58,
      satisfiedCount: 2,
      neutralCount: 1,
      frustratedCount: 1,
      trafficLight: "red",
    },
  ],
};

// ── Mock: Alertas SLA ─────────────────────────────────────────────────────────

export const MOCK_ALERTS: AlertItem[] = [
  {
    logId: "log-001",
    conversationId: "conv-001",
    contactName: "Roberto Almeida",
    contactPhone: "(11) 98456-7231",
    operatorName: "Marcos Vinícius",
    waitingMinutes: 23,
    waitingSeconds: 1380,
    isOverdue: true,
    isCritical: true,
  },
  {
    logId: "log-002",
    conversationId: "conv-002",
    contactName: "Fernanda Souza",
    contactPhone: "(31) 99712-4856",
    operatorName: "Pedro Henrique",
    waitingMinutes: 17,
    waitingSeconds: 1020,
    isOverdue: true,
    isCritical: false,
  },
  {
    logId: "log-003",
    conversationId: "conv-003",
    contactName: "Carla Mendonça",
    contactPhone: "(41) 98123-9960",
    operatorName: "Ana Paula",
    waitingMinutes: 11,
    waitingSeconds: 660,
    isOverdue: false,
    isCritical: false,
  },
  {
    logId: "log-004",
    conversationId: "conv-004",
    contactName: "Diego Furtado",
    contactPhone: "(21) 97534-0021",
    operatorName: "Juliana Costa",
    waitingMinutes: 8,
    waitingSeconds: 480,
    isOverdue: false,
    isCritical: false,
  },
];

// ── Mock: Auditorias IA ───────────────────────────────────────────────────────

export const MOCK_AUDITS: AuditItem[] = [
  {
    id: "audit-001",
    conversationId: "conv-101",
    contactName: "Lucas Ferreira",
    operatorName: "Faggner Silva",
    performanceScore: 96,
    clientSentiment: "satisfeito",
    hadLongResponseGap: false,
    hadMissedObjection: false,
    hadRudeLanguage: false,
    hadNoFollowUp: false,
    summary:
      "Atendimento exemplar. O operador identificou rapidamente a necessidade do cliente, apresentou as opções do plano Premium com clareza e fechou a venda em menos de 8 minutos. Tom amigável e profissional durante todo o contato.",
    strengths:
      "Abordagem consultiva desde a primeira mensagem. Antecipou objeções de preço antes de o cliente levantá-las. Proposta enviada com todos os detalhes sem precisar de solicitação adicional.",
    weaknesses:
      "Poderia ter mencionado o programa de fidelidade como diferencial adicional para reforçar o valor percebido.",
    actionableInsight:
      "Usar essa conversa como modelo de treinamento — especialmente a forma de apresentar o plano Premium.",
    flagCount: 0,
    auditedAt: new Date(Date.now() - 18 * 60000).toISOString(),
  },
  {
    id: "audit-002",
    conversationId: "conv-102",
    contactName: "Patrícia Lima",
    operatorName: "Ana Paula",
    performanceScore: 83,
    clientSentiment: "satisfeito",
    hadLongResponseGap: false,
    hadMissedObjection: true,
    hadRudeLanguage: false,
    hadNoFollowUp: false,
    summary:
      "Bom atendimento no geral. O cliente perguntou sobre desconto para pagamento anual e o operador não explorou essa abertura para fechar um plano de maior valor. Problema resolvido com satisfação do cliente.",
    strengths:
      "Resposta rápida e cordial. Domínio do produto. Cliente satisfeito ao final.",
    weaknesses:
      "Deixou passar oportunidade de upsell quando o cliente mencionou pagamento anual às 14h32 — poderia ter apresentado o plano Business com 20% de desconto à vista.",
    actionableInsight:
      "Treinar Ana Paula para identificar sinais de upsell — pagamento anual e volume de usuários são os principais gatilhos.",
    flagCount: 1,
    auditedAt: new Date(Date.now() - 35 * 60000).toISOString(),
  },
  {
    id: "audit-003",
    conversationId: "conv-103",
    contactName: "Rodrigo Campos",
    operatorName: "Pedro Henrique",
    performanceScore: 61,
    clientSentiment: "neutro",
    hadLongResponseGap: true,
    hadMissedObjection: false,
    hadRudeLanguage: false,
    hadNoFollowUp: true,
    summary:
      "Atendimento demorado com gaps de resposta de até 12 minutos. Cliente solicitou proposta e não recebeu confirmação de próximo passo. Conversa encerrada sem comprometimento claro do operador.",
    strengths:
      "Informações técnicas corretas. Não houve conflito ou mal-entendido.",
    weaknesses:
      "Gap de 12 minutos entre 10h14 e 10h26 sem qualquer mensagem. Conversa encerrada sem confirmação de envio de proposta nem data de follow-up.",
    actionableInsight:
      "Cobrar Pedro Henrique sobre o follow-up pendente com Rodrigo Campos HOJE. Estabelecer regra: toda conversa encerrada deve ter um próximo passo explícito.",
    flagCount: 2,
    auditedAt: new Date(Date.now() - 52 * 60000).toISOString(),
  },
  {
    id: "audit-004",
    conversationId: "conv-104",
    contactName: "Mariana Rocha",
    operatorName: "Juliana Costa",
    performanceScore: 91,
    clientSentiment: "satisfeito",
    hadLongResponseGap: false,
    hadMissedObjection: false,
    hadRudeLanguage: false,
    hadNoFollowUp: false,
    summary:
      "Renovação de contrato conduzida com excelência. Juliana usou histórico do cliente para personalizar a abordagem e conseguiu upgrade do plano sem esforço adicional.",
    strengths:
      "Referenciou o histórico de uso do cliente para justificar o upgrade. Proposta enviada em menos de 3 minutos. Cliente aceitou na mesma conversa.",
    weaknesses: "Sem pontos críticos identificados.",
    actionableInsight:
      "Documentar abordagem de Juliana como playbook de renovação — especialmente o uso de histórico de uso como argumento.",
    flagCount: 0,
    auditedAt: new Date(Date.now() - 78 * 60000).toISOString(),
  },
  {
    id: "audit-005",
    conversationId: "conv-105",
    contactName: "Thiago Moraes",
    operatorName: "Marcos Vinícius",
    performanceScore: 44,
    clientSentiment: "frustrado",
    hadLongResponseGap: true,
    hadMissedObjection: true,
    hadRudeLanguage: false,
    hadNoFollowUp: true,
    summary:
      "Cliente manifestou interesse em cancelamento por falta de suporte. O operador demorou 21 minutos para responder a mensagem inicial e não apresentou solução concreta para o problema relatado. Cliente encerrou insatisfeito.",
    strengths: "Não houve linguagem inadequada.",
    weaknesses:
      "Gap crítico de 21 minutos sem resposta. Cliente mencionou cancelamento e o operador não ativou protocolo de retenção. Sem next step definido.",
    actionableInsight:
      "URGENTE: Ativar protocolo de retenção para Thiago Moraes — ligar hoje. Verificar disponibilidade de Marcos Vinícius para atendimentos ou redistribuir sua fila.",
    flagCount: 3,
    auditedAt: new Date(Date.now() - 95 * 60000).toISOString(),
  },
  {
    id: "audit-006",
    conversationId: "conv-106",
    contactName: "Beatriz Alves",
    operatorName: "Faggner Silva",
    performanceScore: 88,
    clientSentiment: "satisfeito",
    hadLongResponseGap: false,
    hadMissedObjection: false,
    hadRudeLanguage: false,
    hadNoFollowUp: false,
    summary:
      "Nova aquisição via indicação. Faggner conduziu o onboarding inicial com clareza, explicou os planos disponíveis e agendou demonstração sem pressionar o cliente.",
    strengths:
      "Tom consultivo e sem pressão. Enviou comparativo de planos proativamente. Agendamento de demo confirmado com link e data.",
    weaknesses:
      "Poderia ter solicitado o contato do indicador para formalizar o programa de indicações.",
    actionableInsight:
      "Lembrar operadores de sempre formalizar indicações — oportunidade de pipeline qualificado sendo perdida.",
    flagCount: 0,
    auditedAt: new Date(Date.now() - 120 * 60000).toISOString(),
  },
  {
    id: "audit-007",
    conversationId: "conv-107",
    contactName: "Carlos Eduardo",
    operatorName: "Ana Paula",
    performanceScore: 77,
    clientSentiment: "neutro",
    hadLongResponseGap: false,
    hadMissedObjection: false,
    hadRudeLanguage: false,
    hadNoFollowUp: true,
    summary:
      "Cliente com dúvidas técnicas sobre integração via API. Ana Paula resolveu as dúvidas corretamente mas encerrou a conversa sem confirmar se o cliente conseguiu implementar a solução.",
    strengths:
      "Conhecimento técnico demonstrado. Enviou link da documentação correta.",
    weaknesses:
      "Não agendou check-in de 24h para confirmar se a integração funcionou — perda de oportunidade de fidelização pós-suporte.",
    actionableInsight:
      "Instituir check-in automático de 24h após tickets técnicos — pode ser uma mensagem template no WhatsApp.",
    flagCount: 1,
    auditedAt: new Date(Date.now() - 145 * 60000).toISOString(),
  },
  {
    id: "audit-008",
    conversationId: "conv-108",
    contactName: "Simone Tavares",
    operatorName: "Juliana Costa",
    performanceScore: 94,
    clientSentiment: "satisfeito",
    hadLongResponseGap: false,
    hadMissedObjection: false,
    hadRudeLanguage: false,
    hadNoFollowUp: false,
    summary:
      "Tratativa de reclamação revertida em oportunidade. Cliente insatisfeita com prazo de entrega; Juliana ofereceu compensação de forma proativa e transformou a situação em renovação de contrato.",
    strengths:
      "Reconheceu o problema sem defensividade. Ofereceu compensação antes de ser solicitada. Cliente saiu com NPS declarado de 9.",
    weaknesses: "Sem pontos críticos identificados.",
    actionableInsight:
      "Compartilhar com toda a equipe a abordagem de Juliana para tratativa de reclamações — modelo de reversão de churn.",
    flagCount: 0,
    auditedAt: new Date(Date.now() - 180 * 60000).toISOString(),
  },
];
