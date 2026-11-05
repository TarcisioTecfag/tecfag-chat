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

// ── Tipos Live View ───────────────────────────────────────────────────────────

export type LiveMessage = {
  id: string;
  conversationId?: string;
  senderType?: "client" | "agent" | "bot" | "system";
  senderName?: string;
  sender?: string;
  text?: string;
  time?: string;
  content?: string;        // texto puro ou [MEDIA:image|video|audio|document|sticker]msgId
  sentAt?: string;         // ISO string
  isInternalNote?: boolean;
  mediaInterpretation?: string | null;
  status?: string;
  errorMessage?: string | null;
  quotedMessageId?: string | null;
  quotedMessageSender?: string | null;
  quotedMessageContent?: string | null;
  metaDetails?: Record<string, unknown> | null;
};

export type LiveDealSummary = {
  id: string;
  title: string;
  value: number | null;
  status: string;
  pipelineId?: string | null;
  pipelineName: string | null;
  stageId?: string | null;
  stageName: string | null;
  rating?: number;
};

export type LiveTaskItem = {
  id: string;
  title: string;
  dueDate?: string | null;
  type?: string | null;
  isOverdue: boolean;
  dealTitle?: string | null;
};

export type LivePipelineOption = {
  id: string;
  name: string;
  count: number;
  totalValue: number;
};

export type LiveActivityCategory =
  | "waiting_reply"
  | "active_today"
  | "recent_active"
  | "awaiting_first_contact"
  | "dormant";

export type LiveConversation = {
  id: string;
  contactId?: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail?: string | null;
  contactAvatar?: string | null;
  accountName?: string | null;
  accountDocument?: string | null;
  queueState?: string;
  lastMessage: string;
  lastMessageTime?: string;
  waitingMinutes: number;
  isUnanswered: boolean;
  hasRealInteraction?: boolean;
  isActiveToday?: boolean;
  activityCategory?: LiveActivityCategory;
  lastClientMessageAt?: string | null;
  metaWindowOpen?: boolean;
  metaWindowRemainingMinutes?: number | null;
  activeDeal?: LiveDealSummary | null;
  openTasksCount?: number;
  overdueTasksCount?: number;
  nextTaskTitle?: string | null;
  tasks?: LiveTaskItem[];
  failedMessagesCount?: number;
  operatorId?: string | null;
  operatorName?: string | null;
  messages: LiveMessage[];
};

export type LiveOperator = {
  operatorId: string;
  operatorName: string;
  operatorAvatar?: string | null;
  status: "disponivel" | "ocupado" | "ausente";
  isOnline?: boolean;
  lastSeenAt?: string | null;
  usageSecondsToday?: number;
  sentMessagesToday?: number;
  avgResponseMinutesToday?: number | null;
  failedDeliveriesCount?: number;
  expiringWindowCount?: number;
  waitingReplyCount?: number;
  criticalWaitCount?: number;
  activeTodayCount?: number;
  awaitingFirstContactCount?: number;
  dormantCount?: number;
  maxWaitMinutes?: number;
  activeDealsValue?: number;
  conversations: LiveConversation[];
};

export type LiveSummary = {
  totalOperators: number;
  onlineOperators: number;
  unassignedQueueCount: number;
  automationCount: number;
  waitingReplyCount: number;
  criticalWaitCount: number;
  activeTodayCount: number;
  awaitingFirstContactCount: number;
  dormantCount: number;
  maxWaitMinutes: number;
  avgWaitMinutes: number;
  activePipelineValue: number;
  openDealsInLiveCount: number;
  failedDeliveriesCount: number;
  expiringWindowsCount: number;
  overdueTasksConversationsCount: number;
  totalSentMessagesToday: number;
};

export type LiveData = {
  operators: LiveOperator[];
  unassigned: LiveConversation[];   // Na fila sem operador
  automation: LiveConversation[];   // Com Valentina/Fagner (automação)
  summary?: LiveSummary;
  pipelines?: LivePipelineOption[];
};


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
  avgResponseTimeLastWeekFormatted?: string;
  avgResponseTimeLastMonthFormatted?: string;
  overdueCount: number;
  overdueCountLastWeek?: number;
  overdueCountLastMonth?: number;
  avgPerformanceScore: number | null;
  avgPerformanceScoreLastWeek: number | null;
  avgPerformanceScoreLastMonth: number | null;
  satisfiedCount: number;
  neutralCount: number;
  frustratedCount: number;
  satisfiedPctLastWeek?: number;
  satisfiedPctLastMonth?: number;
  trafficLight: "green" | "yellow" | "red" | "gray";
};

export type AlertCategoryTag =
  | "sla_critical"
  | "sla_warning"
  | "unassigned_queue"
  | "conflict_risk"
  | "meta_window_expiring"
  | "delivery_failed"
  | "overdue_task";

export type AlertPrimaryType =
  | "sla"
  | "conflict"
  | "queue"
  | "meta_window"
  | "delivery_failure"
  | "overdue_task";

export type AlertItem = {
  logId: string;
  conversationId: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail?: string | null;
  contactAvatar?: string | null;
  accountName?: string | null;
  accountDocument?: string | null;
  operatorId?: string | null;
  operatorName: string;
  operatorAvatar?: string | null;
  operatorIsOnline?: boolean;
  operatorStatus?: "disponivel" | "ocupado" | "ausente";
  operatorLastSeenAt?: string | null;
  queueState?: string;
  waitingMinutes: number;
  waitingSeconds: number;
  clientMessageAt?: string | null;
  isOverdue: boolean;
  isCritical: boolean;
  isUnanswered?: boolean;
  alertType?: AlertPrimaryType;
  alertTags?: AlertCategoryTag[];
  conflictTriggerText?: string | null;
  lastMessagePreview?: string;
  lastMessageRaw?: string | null;
  lastMessageMediaType?: string | null;
  lastMessageMediaId?: string | null;
  lastMessageTranscription?: string | null;
  lastMessageSenderType?: "client" | "agent" | "bot" | "system";
  lastMessageStatus?: string | null;
  lastMessageError?: string | null;
  failedMessagesCount?: number;
  metaWindowOpen?: boolean;
  metaWindowRemainingMinutes?: number | null;
  activeDeal?: LiveDealSummary | null;
  crmCardUrl?: string | null;
  openTasksCount?: number;
  overdueTasksCount?: number;
  nextTaskTitle?: string | null;
  clientSentiment?: string | null;
  conversationStartedAt?: string;
  recentMessages?: LiveMessage[];
};

export type AlertOperatorBottleneck = {
  operatorId: string;
  operatorName: string;
  operatorAvatar?: string | null;
  isOnline: boolean;
  status: "disponivel" | "ocupado" | "ausente";
  totalAlerts: number;
  criticalCount: number;
  overdueCount: number;
  conflictCount: number;
  maxWaitMinutes: number;
  pipelineAtRiskValue: number;
};

export type AlertsExecutiveSummary = {
  totalAlerts: number;
  criticalCount: number;
  overdueCount: number;
  warningCount: number;
  unassignedQueueCount: number;
  conflictRiskCount: number;
  metaWindowExpiringCount: number;
  deliveryFailureCount: number;
  overdueTasksAlertsCount: number;
  maxWaitMinutes: number;
  avgWaitMinutes: number;
  pipelineAtRiskValue: number;
  dealsAtRiskCount: number;
  offlineOperatorsWithAlertsCount: number;
  slaCompliancePctToday: number | null;
  slaCyclesTodayTotal: number;
  slaCyclesTodayWithinLimit: number;
};

export type AlertsApiResponse = {
  alerts: AlertItem[];
  summary: AlertsExecutiveSummary;
  operatorBottlenecks: AlertOperatorBottleneck[];
};

export type AuditPillarScores = {
  agility: number;
  qualification: number;
  objectionHandling: number;
  closingNextStep: number;
};

export type AuditSlaMetrics = {
  avgResponseSeconds: number | null;
  maxResponseSeconds: number | null;
  overdueCyclesCount: number;
  messageCount: number;
  clientMessageCount: number;
  agentMessageCount: number;
};

export type AuditDirectorReview = {
  verdict: "approved" | "approved_with_caveats" | "rejected_wrong";
  comment: string;
  learnedRule?: string | null;
  adjustedScore?: number | null;
  originalAiScore?: number | null;
  reviewedByOperatorId: string;
  reviewedByOperatorName: string;
  reviewedAt: string;
};

export type AuditLearnedRuleItem = {
  auditId: string;
  conversationId: string;
  contactName: string | null;
  operatorName: string | null;
  verdict: "approved_with_caveats" | "rejected_wrong";
  comment: string;
  learnedRule: string;
  originalAiScore: number | null;
  adjustedScore: number | null;
  reviewedByOperatorName: string;
  reviewedAt: string;
};

export type AuditItem = {
  id: string;
  conversationId: string;
  operatorId?: string | null;
  contactId?: string | null;
  contactName: string | null;
  contactPhone?: string | null;
  contactAvatar?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  queueState?: string;
  operatorName: string;
  operatorAvatar?: string | null;
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
  coachingMessageSuggestion?: string | null;
  pillarScores?: AuditPillarScores;
  detectedStage?: string | null;
  commercialRiskLevel?: "baixo" | "medio" | "alto" | "critico";
  deal?: (LiveDealSummary & { lossReason?: string | null; winReason?: string | null }) | null;
  slaMetrics?: AuditSlaMetrics;
  recentMessages?: LiveMessage[];
  directorReview?: AuditDirectorReview | null;
  isLikelyTest?: boolean;
  flagCount: number;
  status?: string;
  errorMessage?: string | null;
  auditedAt: string | null;
  createdAt?: string | null;
};

export type AuditStatusCounts = {
  done: number;
  pending: number;
  processing: number;
  error: number;
  eligibleUnauditedCount: number;
  dismissedTestCount?: number;
  likelyTestCount?: number;
};

export type AuditOperatorRankingItem = {
  operatorId: string;
  operatorName: string;
  operatorAvatar: string | null;
  isOnline: boolean;
  auditedCount: number;
  avgScore: number;
  criticalCount: number;
  excellentCount: number;
  satisfiedCount: number;
  frustratedCount: number;
  flagCount: number;
  longGapCount: number;
  missedObjectionCount: number;
  noFollowUpCount: number;
  rudeLanguageCount: number;
  pipelineValue: number;
  atRiskValue: number;
};

export type AuditsExecutiveSummary = {
  totalAudited: number;
  avgScore: number | null;
  excellentCount: number;
  attentionCount: number;
  criticalCount: number;
  satisfiedCount: number;
  neutralCount: number;
  frustratedCount: number;
  satisfactionPct: number | null;
  totalFlagsCount: number;
  longGapCount: number;
  missedObjectionCount: number;
  noFollowUpCount: number;
  rudeLanguageCount: number;
  topFailureLabel: string;
  auditedPipelineValue: number;
  atRiskPipelineValue: number;
  atRiskDealsCount: number;
  wonDealsAuditedCount: number;
  lostDealsAuditedCount: number;
  avgPillarScores: AuditPillarScores;
  reviewedCount?: number;
  approvedCount?: number;
  caveatsCount?: number;
  rejectedCount?: number;
  pendingReviewCount?: number;
  learnedRulesCount?: number;
};

export type AuditsApiResponse = {
  audits: AuditItem[];
  statusCounts: AuditStatusCounts;
  summary: AuditsExecutiveSummary;
  operatorRanking: AuditOperatorRankingItem[];
  learnedRules?: AuditLearnedRuleItem[];
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
      avgResponseTimeLastWeekFormatted: "3min 12s",
      avgResponseTimeLastMonthFormatted: "4min 05s",
      overdueCount: 0,
      overdueCountLastWeek: 1,
      overdueCountLastMonth: 3,
      avgPerformanceScore: 92,
      avgPerformanceScoreLastWeek: 89,
      avgPerformanceScoreLastMonth: 94,
      satisfiedCount: 5,
      neutralCount: 1,
      frustratedCount: 0,
      satisfiedPctLastWeek: 85,
      satisfiedPctLastMonth: 88,
      trafficLight: "green",
    },
    {
      operatorId: "op-mock-2",
      operatorName: "Ana Paula",
      operatorAvatar: null,
      status: "disponivel",
      totalConversations: 8,
      avgResponseTimeFormatted: "3min 52s",
      avgResponseTimeLastWeekFormatted: "3min 40s",
      avgResponseTimeLastMonthFormatted: "4min 15s",
      overdueCount: 0,
      overdueCountLastWeek: 0,
      overdueCountLastMonth: 2,
      avgPerformanceScore: 88,
      avgPerformanceScoreLastWeek: 85,
      avgPerformanceScoreLastMonth: 82,
      satisfiedCount: 6,
      neutralCount: 2,
      frustratedCount: 0,
      satisfiedPctLastWeek: 80,
      satisfiedPctLastMonth: 82,
      trafficLight: "green",
    },
    {
      operatorId: "op-mock-3",
      operatorName: "Pedro Henrique",
      operatorAvatar: null,
      status: "ocupado",
      totalConversations: 11,
      avgResponseTimeFormatted: "7min 10s",
      avgResponseTimeLastWeekFormatted: "6min 30s",
      avgResponseTimeLastMonthFormatted: "5min 50s",
      overdueCount: 1,
      overdueCountLastWeek: 4,
      overdueCountLastMonth: 12,
      avgPerformanceScore: 74,
      avgPerformanceScoreLastWeek: 78,
      avgPerformanceScoreLastMonth: 81,
      satisfiedCount: 7,
      neutralCount: 3,
      frustratedCount: 1,
      satisfiedPctLastWeek: 72,
      satisfiedPctLastMonth: 75,
      trafficLight: "yellow",
    },
    {
      operatorId: "op-mock-4",
      operatorName: "Juliana Costa",
      operatorAvatar: null,
      status: "disponivel",
      totalConversations: 5,
      avgResponseTimeFormatted: "5min 03s",
      avgResponseTimeLastWeekFormatted: "4min 45s",
      avgResponseTimeLastMonthFormatted: "4min 20s",
      overdueCount: 0,
      overdueCountLastWeek: 1,
      overdueCountLastMonth: 4,
      avgPerformanceScore: 79,
      avgPerformanceScoreLastWeek: 83,
      avgPerformanceScoreLastMonth: 75,
      satisfiedCount: 3,
      neutralCount: 2,
      frustratedCount: 0,
      satisfiedPctLastWeek: 78,
      satisfiedPctLastMonth: 72,
      trafficLight: "green",
    },
    {
      operatorId: "op-mock-5",
      operatorName: "Marcos Vinícius",
      operatorAvatar: null,
      status: "ausente",
      totalConversations: 4,
      avgResponseTimeFormatted: "18min 42s",
      avgResponseTimeLastWeekFormatted: "15min 30s",
      avgResponseTimeLastMonthFormatted: "12min 10s",
      overdueCount: 1,
      overdueCountLastWeek: 6,
      overdueCountLastMonth: 22,
      avgPerformanceScore: 58,
      avgPerformanceScoreLastWeek: 64,
      avgPerformanceScoreLastMonth: 70,
      satisfiedCount: 2,
      neutralCount: 1,
      frustratedCount: 1,
      satisfiedPctLastWeek: 60,
      satisfiedPctLastMonth: 65,
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
    alertType: "sla",
    lastMessagePreview: "boa tarde alguem pode me atender?????",
    crmCardUrl: "https://crm.rdstation.com.br/deals/102948",
    conversationStartedAt: "20/07/2026 14:15",
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
    alertType: "conflict",
    lastMessagePreview: "nao tenho mais interesse em realizar nenhuma compra com vcs, que atendimento horrivel",
    crmCardUrl: null,
    conversationStartedAt: "20/07/2026 14:02",
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
    alertType: "sla",
    lastMessagePreview: "Preciso do boleto atualizado para pagar hoje, pode gerar?",
    crmCardUrl: "https://crm.rdstation.com.br/deals/102951",
    conversationStartedAt: "20/07/2026 14:50",
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
    alertType: "conflict",
    lastMessagePreview: "Vocês prometeram entregar ontem e até agora nada. Quero cancelar o pedido!",
    crmCardUrl: "https://crm.rdstation.com.br/deals/102955",
    conversationStartedAt: "20/07/2026 14:45",
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

// ── Mock: Ao Vivo (atendimentos em tempo real) ─────────────────────────────────

export const MOCK_LIVE: LiveOperator[] = [
  {
    operatorId: "op-mock-1",
    operatorName: "Faggner Silva",
    status: "disponivel",
    conversations: [
      {
        id: "lconv-001",
        contactName: "Lucas Ferreira",
        contactPhone: "(11) 98456-7231",
        lastMessage: "Perfeito! Aguardo a proposta então. 👍",
        waitingMinutes: 2,
        isUnanswered: true,
        messages: [
          { id: "m1", sender: "client", text: "Olá! Vi a indicação de vocês pelo Carlos.", time: "10:18" },
          { id: "m2", sender: "agent", text: "Boa tarde, Lucas! Que ótimo ter você aqui. Como posso ajudá-lo hoje?", time: "10:19" },
          { id: "m3", sender: "client", text: "Estou precisando de um sistema de atendimento para minha equipe. Somos 6 vendedores.", time: "10:20" },
          { id: "m4", sender: "agent", text: "Perfeito! Nosso plano Business foi feito exatamente pra isso. Posso te mostrar como funciona?", time: "10:21" },
          { id: "m5", sender: "client", text: "Sim, com certeza. Qual é o valor?", time: "10:22" },
          { id: "m6", sender: "agent", text: "Para 6 usuários sai R$ 297/mês. Inclui relatórios, auditoria por IA e acesso ao histórico completo. Posso preparar uma proposta personalizada?", time: "10:23" },
          { id: "m7", sender: "client", text: "Sim! Manda por aqui mesmo.", time: "10:24" },
          { id: "m8", sender: "agent", text: "Vou preparar agora e mando em instantes. 📄", time: "10:25" },
          { id: "m9", sender: "client", text: "Perfeito! Aguardo a proposta então. 👍", time: "10:26" },
        ],
      },
      {
        id: "lconv-002",
        contactName: "Beatriz Rocha",
        contactPhone: "(21) 99821-4430",
        lastMessage: "Ok, até mais tarde então!",
        waitingMinutes: 6,
        isUnanswered: false,
        messages: [
          { id: "m1", sender: "client", text: "Boa tarde! Quero renovar meu plano. Vence semana que vem.", time: "10:05" },
          { id: "m2", sender: "agent", text: "Oi Beatriz! Que bom falar com você. 😊 Vou verificar seu plano atual.", time: "10:06" },
          { id: "m3", sender: "client", text: "Estou no plano básico há 8 meses.", time: "10:07" },
          { id: "m4", sender: "agent", text: "Vi aqui! Você usou 94% da capacidade no mês passado. Já pensou em fazer upgrade pro plano Pro? Cabe mais usuários e temos a IA de auditoria.", time: "10:08" },
          { id: "m5", sender: "client", text: "Quanto custa a diferença?", time: "10:09" },
          { id: "m6", sender: "agent", text: "A diferença é de R$78/mês. Considerando o que você usa, o Pro se paga pela eficiência nos atendimentos. Vou te mandar a comparação detalhada.", time: "10:10" },
          { id: "m7", sender: "client", text: "Ok, me manda. Vou analisar com calma.", time: "10:11" },
          { id: "m8", sender: "agent", text: "📊 Aqui está a comparação. Qualquer dúvida, é só falar!", time: "10:11" },
          { id: "m9", sender: "client", text: "Ok, até mais tarde então!", time: "10:12" },
        ],
      },
    ],
  },
  {
    operatorId: "op-mock-2",
    operatorName: "Ana Paula",
    status: "disponivel",
    conversations: [
      {
        id: "lconv-003",
        contactName: "Roberto Almeida",
        contactPhone: "(11) 98456-7231",
        lastMessage: "Faz mais de 20 minutos que enviei a mensagem...",
        waitingMinutes: 23,
        isUnanswered: true,
        messages: [
          { id: "m1", sender: "client", text: "Oi, boa tarde! Preciso de ajuda com o sistema.", time: "09:58" },
          { id: "m2", sender: "agent", text: "Olá Roberto! Pois não, como posso ajudar?", time: "10:00" },
          { id: "m3", sender: "client", text: "Não estou conseguindo acessar o painel de relatórios. Dá erro 403.", time: "10:01" },
          { id: "m4", sender: "agent", text: "Entendido. Pode me passar seu usuário de acesso?", time: "10:02" },
          { id: "m5", sender: "client", text: "roberto@empresa.com.br", time: "10:02" },
          { id: "m6", sender: "client", text: "Faz mais de 20 minutos que enviei a mensagem...", time: "10:21" },
        ],
      },
      {
        id: "lconv-004",
        contactName: "Carla Mendonça",
        contactPhone: "(41) 98123-9960",
        lastMessage: "Tá bom! Vou pensar e te dou um retorno amanhã.",
        waitingMinutes: 11,
        isUnanswered: false,
        messages: [
          { id: "m1", sender: "client", text: "Olá! Gostaria de contratar o plano para minha empresa.", time: "10:04" },
          { id: "m2", sender: "agent", text: "Oi Carla, tudo bem? Fico feliz com o interesse! Qual o tamanho da sua equipe?", time: "10:05" },
          { id: "m3", sender: "client", text: "Somos 4 pessoas hoje, mas planejamos crescer para 10 até o final do ano.", time: "10:06" },
          { id: "m4", sender: "agent", text: "Ótimo! Recomendo o plano Business — ele cresce com você e tem desconto no plano anual. Posso montar uma simulação?", time: "10:07" },
          { id: "m5", sender: "client", text: "Pode sim. Mas tem desconto para pagamento anual?", time: "10:08" },
          { id: "m6", sender: "agent", text: "Tem sim! 20% de desconto. Ou seja, você pagaria o equivalente a R$238/mês ao invés de R$297.", time: "10:09" },
          { id: "m7", sender: "client", text: "Hmm, interessante. Mas preciso conversar com meu sócio antes.", time: "10:10" },
          { id: "m8", sender: "agent", text: "Claro, sem pressão! Se quiser, posso enviar um resumo por e-mail para vocês analisarem juntos?", time: "10:10" },
          { id: "m9", sender: "client", text: "Tá bom! Vou pensar e te dou um retorno amanhã.", time: "10:11" },
        ],
      },
    ],
  },
  {
    operatorId: "op-mock-3",
    operatorName: "Pedro Henrique",
    status: "ocupado",
    conversations: [
      {
        id: "lconv-005",
        contactName: "Diego Furtado",
        contactPhone: "(21) 97534-0021",
        lastMessage: "Qual é o prazo para ativar o sistema?",
        waitingMinutes: 8,
        isUnanswered: true,
        messages: [
          { id: "m1", sender: "client", text: "Bom dia! Quero contratar o plano Enterprise.", time: "10:15" },
          { id: "m2", sender: "agent", text: "Bom dia Diego! Que ótima escolha! Qual o tamanho da operação?", time: "10:16" },
          { id: "m3", sender: "client", text: "Temos 25 atendentes. Precisamos de multicanal e API.", time: "10:17" },
          { id: "m4", sender: "agent", text: "Perfeito, o Enterprise cobre tudo isso. Vou preparar a proposta customizada para vocês.", time: "10:18" },
          { id: "m5", sender: "client", text: "Qual é o prazo para ativar o sistema?", time: "10:19" },
        ],
      },
      {
        id: "lconv-006",
        contactName: "Fernanda Souza",
        contactPhone: "(31) 99712-4856",
        lastMessage: "Recebi sim. Vou analisar com a equipe.",
        waitingMinutes: 17,
        isUnanswered: false,
        messages: [
          { id: "m1", sender: "client", text: "Boa tarde, preciso cancelar meu plano.", time: "09:45" },
          { id: "m2", sender: "agent", text: "Oi Fernanda! Sinto muito ouvir isso. Pode me contar o motivo? Quero entender se consigo ajudar.", time: "09:46" },
          { id: "m3", sender: "client", text: "Achei caro para o que usa.", time: "09:47" },
          { id: "m4", sender: "agent", text: "Entendo. Posso te oferecer 30% de desconto pelo próximo trimestre enquanto você usa mais os recursos. O que acha?", time: "09:49" },
          { id: "m5", sender: "client", text: "Hmm... Quanto ficaria?", time: "09:50" },
          { id: "m6", sender: "agent", text: "De R$197 para R$138/mês pelos próximos 3 meses. Depois volta ao normal ou você decide migrar de plano.", time: "09:52" },
          { id: "m7", sender: "client", text: "Ok, vou aceitar. Mas preciso que vocês me ensinem a usar os relatórios.", time: "09:53" },
          { id: "m8", sender: "agent", text: "Combinado! Vou agendar um treinamento de 30min com nossa equipe. Qual melhor horário?", time: "09:54" },
          { id: "m9", sender: "client", text: "Recebi sim. Vou analisar com a equipe.", time: "10:05" },
        ],
      },
      {
        id: "lconv-007",
        contactName: "Thiago Moraes",
        contactPhone: "(19) 98765-4321",
        lastMessage: "Sim, estou interessado em saber mais.",
        waitingMinutes: 4,
        isUnanswered: false,
        messages: [
          { id: "m1", sender: "agent", text: "Oi Thiago! Passando para ver se posso ajudá-lo com alguma dúvida sobre o sistema.", time: "10:18" },
          { id: "m2", sender: "client", text: "Oi! Sim, estou interessado em saber mais.", time: "10:19" },
        ],
      },
    ],
  },
  {
    operatorId: "op-mock-4",
    operatorName: "Juliana Costa",
    status: "disponivel",
    conversations: [
      {
        id: "lconv-008",
        contactName: "Mariana Rocha",
        contactPhone: "(48) 99234-8821",
        lastMessage: "Fechado então! Quando ativo?",
        waitingMinutes: 3,
        isUnanswered: true,
        messages: [
          { id: "m1", sender: "client", text: "Boa tarde Juliana! Quero renovar e já aproveitar para fazer upgrade.", time: "10:22" },
          { id: "m2", sender: "agent", text: "Oi Mariana! Que ótimo! Você está no básico há 14 meses, sabia que economiza 20% no anual?", time: "10:23" },
          { id: "m3", sender: "client", text: "Não sabia! Quanto fica o Pro anual?", time: "10:24" },
          { id: "m4", sender: "agent", text: "R$2.856/ano (R$238/mês). Você paga 10 meses e ganha 2. E ainda tem a IA de auditoria incluída.", time: "10:25" },
          { id: "m5", sender: "client", text: "Fechado então! Quando ativo?", time: "10:26" },
        ],
      },
      {
        id: "lconv-009",
        contactName: "Carlos Eduardo",
        contactPhone: "(11) 97654-3210",
        lastMessage: "Funcionou! Muito obrigado pela ajuda.",
        waitingMinutes: 9,
        isUnanswered: false,
        messages: [
          { id: "m1", sender: "client", text: "Oi! Estou com dificuldade na integração da API com nosso CRM.", time: "10:08" },
          { id: "m2", sender: "agent", text: "Oi Carlos! Pode me passar qual CRM vocês usam?", time: "10:09" },
          { id: "m3", sender: "client", text: "HubSpot.", time: "10:09" },
          { id: "m4", sender: "agent", text: "Temos integração nativa com HubSpot! Vou te enviar o guia de 3 passos.", time: "10:10" },
          { id: "m5", sender: "agent", text: "📎 Aqui está: [doc.valem.app/hubspot-integration]. Em 10 minutos você já estará configurado.", time: "10:10" },
          { id: "m6", sender: "client", text: "Deixa eu testar...", time: "10:12" },
          { id: "m7", sender: "client", text: "Funcionou! Muito obrigado pela ajuda.", time: "10:14" },
        ],
      },
    ],
  },
];

// ── Tipos & Mock: Tarefas Globais da Operação (Diretoria) ──────────────────────

export type GlobalTaskAssignedOperator = {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
};

export type GlobalTaskItem = {
  id: string;
  name: string;
  type: string;
  status: "pending" | "done";
  dueDate: string | null;
  completedAt?: string | null;
  description: string | null;
  createdAt: string | null;
  deal: {
    id: string;
    name: string | null;
    value?: string | number | null;
    numericValue?: number | null;
    status?: "open" | "won" | "lost";
    pipelineId?: string | null;
    pipelineName?: string | null;
    stageId?: string | null;
    stageName?: string | null;
  } | null;
  client: {
    name: string | null;
    phone: string | null;
    companyName?: string | null;
    accountId?: string | null;
  };
  chatContactId: string | null;
  chatConversationId: string | null;
  source?: "kanban";
  operatorId: string | null;
  operatorName: string;
  operatorEmail: string | null;
  operatorAvatar: string | null;
  operatorIsOnline?: boolean;
  assignedOperatorId?: string | null;
  assignedOperatorIds?: string[];
  assignedOperatorName?: string | null;
  assignedOperatorNames?: string[];
  assignedOperators?: GlobalTaskAssignedOperator[];
  isShared?: boolean;
  creatorOperatorId?: string | null;
  creatorOperatorName?: string | null;
  dealOperatorId?: string | null;
  dealOwnerName?: string | null;
  lastMessagePreview?: string | null;
  lastMessageSenderType?: "client" | "agent" | "bot" | "system" | null;
  lastMessageSentAt?: string | null;
  lastMessageMediaType?: string | null;
  lastMessageMediaId?: string | null;
  lastMessageTranscription?: string | null;
  recentMessages?: LiveMessage[];
};

export type GlobalTaskOperatorBreakdown = {
  operatorId: string;
  operatorName: string;
  operatorEmail: string | null;
  operatorAvatar: string | null;
  isOnline: boolean;
  presenceLabel: string;
  overdueCount: number;
  overdueValueAtRisk: number;
  todayTotal: number;
  todayDone: number;
  todayPending: number;
  upcoming7dCount: number;
  totalPending: number;
  totalDone: number;
  openDealsCount: number;
  openDealsWithoutTaskCount: number;
  executionRatePct: number;
};

export type GlobalTasksExecutiveSummary = {
  totalTasks: number;
  pendingTasksCount: number;
  completedTasksCount: number;
  overdueTasksCount: number;
  overdueOpenDealsTasksCount: number;
  overduePipelineValueAtRisk: number;
  avgOverdueHours: number;
  todayTotalCount: number;
  todayCompletedCount: number;
  todayPendingCount: number;
  todayOverdueCount: number;
  todayExecutionRatePct: number;
  upcoming7dCount: number;
  consultantsWithoutFutureTasksCount: number;
  openDealsCount: number;
  openDealsWithoutTasksCount: number;
  byType: {
    call: number;
    whatsapp: number;
    meeting: number;
    visit: number;
    email: number;
    lunch: number;
    task: number;
  };
};

export type GlobalTasksApiResponse = {
  tasks: GlobalTaskItem[];
  summary: GlobalTasksExecutiveSummary;
  operatorBreakdown: GlobalTaskOperatorBreakdown[];
  pipelines: Array<{ id: string; name: string }>;
  operators: Array<{
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
    isOnline: boolean;
  }>;
};

export const MOCK_GLOBAL_TASKS_RESPONSE: GlobalTasksApiResponse = {
  tasks: [
    {
      id: "gtask-001",
      name: "Retornar proposta técnica da Envasadora Automática",
      type: "call",
      status: "pending",
      dueDate: new Date(Date.now() - 4 * 3600_000).toISOString(),
      completedAt: null,
      description: "Cliente pediu revisão do prazo de entrega e condição em 12x.",
      createdAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
      deal: {
        id: "deal-mock-1",
        name: "Envasadora Industrial 4 Bicos Inox",
        value: 84500,
        numericValue: 84500,
        status: "open",
        pipelineId: "pipe-maq",
        pipelineName: "Funil Máquinas",
        stageId: "stg-prop",
        stageName: "Proposta Enviada",
      },
      client: {
        name: "Roberto Almeida",
        phone: "5511984567231",
        companyName: "Almeida Alimentos Ltda",
        accountId: "acc-mock-1",
      },
      chatContactId: "cont-mock-1",
      chatConversationId: "lconv-003",
      source: "kanban",
      operatorId: "op-mock-2",
      operatorName: "Ana Paula",
      operatorEmail: "anapaula@tecfag.com.br",
      operatorAvatar: null,
      operatorIsOnline: true,
      assignedOperatorId: "op-mock-2",
      assignedOperatorIds: ["op-mock-2"],
      assignedOperators: [
        { id: "op-mock-2", name: "Ana Paula", email: "anapaula@tecfag.com.br", avatar: null },
      ],
      isShared: false,
      creatorOperatorId: "op-mock-1",
      creatorOperatorName: "Faggner Silva",
      lastMessagePreview: "Faz mais de 20 minutos que enviei a mensagem...",
      lastMessageSenderType: "client",
      recentMessages: [
        { id: "m1", sender: "client", text: "Bom dia, conseguiu ver a condição com a diretoria?", time: "09:40" },
        { id: "m2", sender: "agent", text: "Estou validando com o financeiro e já te ligo, Roberto!", time: "09:55" },
      ],
    },
    {
      id: "gtask-002",
      name: "Reunião de fechamento Seladora Contínua",
      type: "meeting",
      status: "pending",
      dueDate: new Date(Date.now() + 2 * 3600_000).toISOString(),
      completedAt: null,
      description: "Apresentar comparativo de produtividade com vídeo técnico.",
      createdAt: new Date(Date.now() - 24 * 3600_000).toISOString(),
      deal: {
        id: "deal-mock-2",
        name: "Seladora Contínua c/ Datador",
        value: 18900,
        numericValue: 18900,
        status: "open",
        pipelineId: "pipe-maq",
        pipelineName: "Funil Máquinas",
        stageId: "stg-neg",
        stageName: "Em Negociação",
      },
      client: {
        name: "Lucas Ferreira",
        phone: "5511984567231",
        companyName: "Ferreira Embalagens",
        accountId: "acc-mock-2",
      },
      chatContactId: "cont-mock-2",
      chatConversationId: "lconv-001",
      source: "kanban",
      operatorId: "op-mock-1",
      operatorName: "Faggner Silva",
      operatorEmail: "faggner@tecfag.com.br",
      operatorAvatar: null,
      operatorIsOnline: true,
      assignedOperatorId: "op-mock-1",
      assignedOperatorIds: ["op-mock-1"],
      assignedOperators: [
        { id: "op-mock-1", name: "Faggner Silva", email: "faggner@tecfag.com.br", avatar: null },
      ],
      isShared: false,
      lastMessagePreview: "Perfeito! Aguardo a proposta então.",
      lastMessageSenderType: "client",
    },
  ],
  summary: {
    totalTasks: 2,
    pendingTasksCount: 2,
    completedTasksCount: 0,
    overdueTasksCount: 1,
    overdueOpenDealsTasksCount: 1,
    overduePipelineValueAtRisk: 84500,
    avgOverdueHours: 4,
    todayTotalCount: 2,
    todayCompletedCount: 0,
    todayPendingCount: 2,
    todayOverdueCount: 1,
    todayExecutionRatePct: 0,
    upcoming7dCount: 1,
    consultantsWithoutFutureTasksCount: 1,
    openDealsCount: 12,
    openDealsWithoutTasksCount: 3,
    byType: {
      call: 1,
      whatsapp: 0,
      meeting: 1,
      visit: 0,
      email: 0,
      lunch: 0,
      task: 0,
    },
  },
  operatorBreakdown: [
    {
      operatorId: "op-mock-2",
      operatorName: "Ana Paula",
      operatorEmail: "anapaula@tecfag.com.br",
      operatorAvatar: null,
      isOnline: true,
      presenceLabel: "ONLINE",
      overdueCount: 1,
      overdueValueAtRisk: 84500,
      todayTotal: 1,
      todayDone: 0,
      todayPending: 1,
      upcoming7dCount: 0,
      totalPending: 1,
      totalDone: 0,
      openDealsCount: 6,
      openDealsWithoutTaskCount: 2,
      executionRatePct: 0,
    },
    {
      operatorId: "op-mock-1",
      operatorName: "Faggner Silva",
      operatorEmail: "faggner@tecfag.com.br",
      operatorAvatar: null,
      isOnline: true,
      presenceLabel: "ONLINE",
      overdueCount: 0,
      overdueValueAtRisk: 0,
      todayTotal: 1,
      todayDone: 0,
      todayPending: 1,
      upcoming7dCount: 1,
      totalPending: 1,
      totalDone: 0,
      openDealsCount: 6,
      openDealsWithoutTaskCount: 1,
      executionRatePct: 0,
    },
  ],
  pipelines: [{ id: "pipe-maq", name: "Funil Máquinas" }],
  operators: [
    { id: "op-mock-1", name: "Faggner Silva", email: "faggner@tecfag.com.br", avatar: null, isOnline: true },
    { id: "op-mock-2", name: "Ana Paula", email: "anapaula@tecfag.com.br", avatar: null, isOnline: true },
  ],
};
