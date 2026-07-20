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
  sender: "agent" | "client";
  text: string;
  time: string;
};

export type LiveConversation = {
  id: string;
  contactName: string;
  contactPhone: string;
  lastMessage: string;
  waitingMinutes: number;
  isUnanswered: boolean;
  messages: LiveMessage[];
};

export type LiveOperator = {
  operatorId: string;
  operatorName: string;
  status: "disponivel" | "ocupado" | "ausente";
  conversations: LiveConversation[];
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
  overdueCount: number;
  avgPerformanceScore: number | null;
  avgPerformanceScoreLastWeek: number | null;
  avgPerformanceScoreLastMonth: number | null;
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
      avgPerformanceScoreLastWeek: 89,
      avgPerformanceScoreLastMonth: 94,
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
      avgPerformanceScoreLastWeek: 85,
      avgPerformanceScoreLastMonth: 82,
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
      avgPerformanceScoreLastWeek: 78,
      avgPerformanceScoreLastMonth: 81,
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
      avgPerformanceScoreLastWeek: 83,
      avgPerformanceScoreLastMonth: 75,
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
      avgPerformanceScoreLastWeek: 64,
      avgPerformanceScoreLastMonth: 70,
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
