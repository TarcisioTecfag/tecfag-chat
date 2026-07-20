// ══════════════════════════════════════════════════════════════════════════════
// 🤖 VALENTINA — Dados Mock para o módulo de agentes IA
// ══════════════════════════════════════════════════════════════════════════════

// ── Tipos ───────────────────────────────────────────────────────────────────

export type ValentinaTab = "chat" | "sdr" | "rodizio" | "supervisor" | "vendedor" | "knowledge";

export type InternalMessage = {
  id: string;
  direction: "to_agent" | "from_agent";
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
};

export type SdrTriageSession = {
  id: string;
  contactName: string;
  company: string;
  currentStep: string;
  stepNumber: number;
  totalSteps: number;
  collectedData: Record<string, { value: string; status: "filled" | "pending" }>;
  startedAt: string;
  status: "active" | "completed" | "abandoned";
  outcome?: string;
  messages: { sender: "bot" | "client"; text: string; time: string }[];
};

export type SupervisorNotification = {
  id: string;
  type: "lead_transfer" | "sla_alert" | "no_response" | "daily_summary" | "sentiment_alert";
  title: string;
  description: string;
  operatorName: string;
  timestamp: string;
  priority: "high" | "medium" | "low";
};

export type AgentStatus = {
  type: "sdr" | "supervisor" | "vendedor";
  name: string;
  enabled: boolean;
  status: "active" | "inactive" | "coming_soon";
  todayMetrics: { label: string; value: string | number }[];
};

// ── Mensagens de boas-vindas da Valentina ───────────────────────────────────

export type ValentinaChatMessage = {
  id: string;
  sender: "valentina" | "operator";
  content: string;
  timestamp: string;
  type?: "text" | "lead_card" | "sla_card" | "metric_card";
  cardData?: Record<string, any>;
};

export const VALENTINA_WELCOME_MESSAGES: ValentinaChatMessage[] = [
  {
    id: "v-welcome-1",
    sender: "valentina",
    content: "Olá! 👋 Sou a Valentina, sua assistente inteligente. Estou aqui para te ajudar com informações sobre leads, métricas, clientes e muito mais. O que você precisa?",
    timestamp: new Date(Date.now() - 60_000 * 5).toISOString(),
    type: "text",
  },
];

export const VALENTINA_MOCK_RESPONSES: string[] = [
  "Claro! Vou buscar essas informações para você. Um momento... 🔍",
  "Encontrei 12 leads qualificados hoje. Desses, 3 foram transferidos para vendedores e 2 aguardam follow-up. Quer que eu detalhe algum?",
  "O tempo médio de resposta da equipe hoje está em 2min 34s — dentro do SLA. 🎯",
  "O lead 'Carlos Mendes — Indústria SM' foi qualificado há 15 minutos pelo SDR. Score: 87/100. Deseja iniciar a transferência para um vendedor?",
  "Entendido! Vou gerar um relatório consolidado com as métricas de ontem e enviar aqui. ⏳",
  "A conversa com 'Maria Joaquina' teve sentiment negativo detectado às 14:23. Recomendo atenção especial nesse atendimento. ⚠️",
  "Atualmente temos 4 triagens SDR ativas e 2 aguardando resposta do cliente. O pipeline está fluindo bem!",
  "Posso te ajudar com: 📊 Métricas de equipe, 👥 Status de leads, 🔔 Alertas SLA, 📋 Resumo do dia. É só pedir!",
  "O operador Denys tem 8 conversas ativas e nenhum SLA estourado. Performance excelente hoje! ⭐",
  "Acabei de detectar um lead com alto potencial: 'Tech Solutions Ltda' — budget declarado de R$ 45.000/mês. Prioridade alta!",
  "Seu resumo da tarde: 23 atendimentos finalizados, NPS médio de 8.7, 5 leads transferidos com sucesso. 📈",
  "A triagem do lead 'Fernando Costa' foi concluída com sucesso. Todos os 6 campos obrigatórios preenchidos. Pronto para transferência!",
  "Detectei que o cliente 'Ana Oliveira' não responde há 48h. Deseja que eu agende um follow-up automático?",
  "Análise de sentimento da última hora: 78% positivo, 15% neutro, 7% negativo. Tendência estável. 😊",
  "O Agente Vendedor ainda está em desenvolvimento, mas posso adiantar que ele vai automatizar propostas e follow-ups de vendas!",
];

// ── Sessões SDR (triagem de leads) ──────────────────────────────────────────

export const SDR_TRIAGE_SESSIONS: SdrTriageSession[] = [
  {
    id: "sdr-001",
    contactName: "Carlos Mendes",
    company: "Indústria SM Ltda",
    currentStep: "Tamanho da equipe",
    stepNumber: 4,
    totalSteps: 6,
    collectedData: {
      "Nome completo": { value: "Carlos Mendes", status: "filled" },
      "Empresa": { value: "Indústria SM Ltda", status: "filled" },
      "Cargo": { value: "Diretor Comercial", status: "filled" },
      "Tamanho da equipe": { value: "", status: "pending" },
      "Budget mensal": { value: "", status: "pending" },
      "Prazo de decisão": { value: "", status: "pending" },
    },
    startedAt: new Date(Date.now() - 60_000 * 12).toISOString(),
    status: "active",
    messages: [
      { sender: "bot", text: "Olá Carlos! Obrigado pelo interesse. Para direcioná-lo ao especialista ideal, preciso de algumas informações rápidas. Qual é o seu nome completo?", time: "14:32" },
      { sender: "client", text: "Carlos Mendes", time: "14:33" },
      { sender: "bot", text: "Perfeito, Carlos! Qual empresa você representa?", time: "14:33" },
      { sender: "client", text: "Indústria SM Ltda", time: "14:34" },
      { sender: "bot", text: "Ótimo! E qual é o seu cargo na Indústria SM?", time: "14:34" },
      { sender: "client", text: "Sou Diretor Comercial", time: "14:35" },
      { sender: "bot", text: "Excelente! Quantas pessoas tem na sua equipe de vendas atualmente?", time: "14:35" },
    ],
  },
  {
    id: "sdr-002",
    contactName: "Fernanda Alves",
    company: "Tech Solutions",
    currentStep: "Budget mensal",
    stepNumber: 5,
    totalSteps: 6,
    collectedData: {
      "Nome completo": { value: "Fernanda Alves", status: "filled" },
      "Empresa": { value: "Tech Solutions", status: "filled" },
      "Cargo": { value: "CEO", status: "filled" },
      "Tamanho da equipe": { value: "25 pessoas", status: "filled" },
      "Budget mensal": { value: "", status: "pending" },
      "Prazo de decisão": { value: "", status: "pending" },
    },
    startedAt: new Date(Date.now() - 60_000 * 25).toISOString(),
    status: "active",
    messages: [
      { sender: "bot", text: "Olá Fernanda! Prazer em conhecê-la. Vamos qualificar seu interesse rapidamente. Qual é o seu nome completo?", time: "14:10" },
      { sender: "client", text: "Fernanda Alves", time: "14:11" },
      { sender: "bot", text: "Qual é a empresa?", time: "14:11" },
      { sender: "client", text: "Tech Solutions", time: "14:12" },
      { sender: "bot", text: "Seu cargo?", time: "14:12" },
      { sender: "client", text: "CEO", time: "14:13" },
      { sender: "bot", text: "Quantas pessoas na equipe?", time: "14:13" },
      { sender: "client", text: "25 pessoas", time: "14:14" },
      { sender: "bot", text: "Ótimo! Qual é o budget mensal disponível para essa solução?", time: "14:14" },
    ],
  },
  {
    id: "sdr-003",
    contactName: "Ricardo Souza",
    company: "Consultoria RS",
    currentStep: "Concluído",
    stepNumber: 6,
    totalSteps: 6,
    collectedData: {
      "Nome completo": { value: "Ricardo Souza", status: "filled" },
      "Empresa": { value: "Consultoria RS", status: "filled" },
      "Cargo": { value: "Gerente de Operações", status: "filled" },
      "Tamanho da equipe": { value: "12 pessoas", status: "filled" },
      "Budget mensal": { value: "R$ 15.000", status: "filled" },
      "Prazo de decisão": { value: "30 dias", status: "filled" },
    },
    startedAt: new Date(Date.now() - 60_000 * 60).toISOString(),
    status: "completed",
    outcome: "Transferido para vendedor Denys",
    messages: [
      { sender: "bot", text: "Olá Ricardo! Vamos agilizar a qualificação. Qual o seu nome completo?", time: "13:35" },
      { sender: "client", text: "Ricardo Souza", time: "13:35" },
      { sender: "bot", text: "Empresa?", time: "13:36" },
      { sender: "client", text: "Consultoria RS", time: "13:36" },
      { sender: "bot", text: "Cargo?", time: "13:36" },
      { sender: "client", text: "Gerente de Operações", time: "13:37" },
      { sender: "bot", text: "Tamanho da equipe?", time: "13:37" },
      { sender: "client", text: "12 pessoas", time: "13:38" },
      { sender: "bot", text: "Budget mensal?", time: "13:38" },
      { sender: "client", text: "R$ 15.000", time: "13:39" },
      { sender: "bot", text: "E quando pretendem tomar a decisão?", time: "13:39" },
      { sender: "client", text: "Nos próximos 30 dias", time: "13:40" },
      { sender: "bot", text: "Perfeito, Ricardo! ✅ Sua qualificação foi concluída. Estou transferindo você para o vendedor especialista agora. Obrigado!", time: "13:40" },
    ],
  },
  {
    id: "sdr-004",
    contactName: "Patrícia Lima",
    company: "Grupo PL",
    currentStep: "Abandonado",
    stepNumber: 2,
    totalSteps: 6,
    collectedData: {
      "Nome completo": { value: "Patrícia Lima", status: "filled" },
      "Empresa": { value: "", status: "pending" },
      "Cargo": { value: "", status: "pending" },
      "Tamanho da equipe": { value: "", status: "pending" },
      "Budget mensal": { value: "", status: "pending" },
      "Prazo de decisão": { value: "", status: "pending" },
    },
    startedAt: new Date(Date.now() - 60_000 * 120).toISOString(),
    status: "abandoned",
    outcome: "Cliente não respondeu após 2h",
    messages: [
      { sender: "bot", text: "Olá! Obrigado pelo contato. Para direcionar melhor, qual o seu nome completo?", time: "12:15" },
      { sender: "client", text: "Patrícia Lima", time: "12:16" },
      { sender: "bot", text: "Obrigado, Patrícia! Qual empresa você representa?", time: "12:16" },
    ],
  },
];

// ── Notificações do Supervisor ──────────────────────────────────────────────

export const SUPERVISOR_NOTIFICATIONS: SupervisorNotification[] = [
  {
    id: "notif-01",
    type: "lead_transfer",
    title: "Lead transferido com sucesso",
    description: "Ricardo Souza (Consultoria RS) foi transferido para o vendedor Denys após qualificação completa. Score: 92/100.",
    operatorName: "SDR Bot",
    timestamp: new Date(Date.now() - 60_000 * 5).toISOString(),
    priority: "medium",
  },
  {
    id: "notif-02",
    type: "sla_alert",
    title: "⚠️ SLA em risco — Conversa #4821",
    description: "O cliente 'Marcos Vieira' está aguardando resposta há 8 minutos. SLA de 10min pode ser estourado.",
    operatorName: "Amanda",
    timestamp: new Date(Date.now() - 60_000 * 8).toISOString(),
    priority: "high",
  },
  {
    id: "notif-03",
    type: "sentiment_alert",
    title: "Sentimento negativo detectado",
    description: "A conversa com 'Maria Joaquina' apresentou padrão de frustração nas últimas 3 mensagens. Recomenda-se intervenção.",
    operatorName: "Lucas",
    timestamp: new Date(Date.now() - 60_000 * 15).toISOString(),
    priority: "high",
  },
  {
    id: "notif-04",
    type: "no_response",
    title: "Cliente sem resposta há 48h",
    description: "O lead 'Ana Oliveira' não interage desde 12/07. Follow-up automático sugerido.",
    operatorName: "Denys",
    timestamp: new Date(Date.now() - 60_000 * 30).toISOString(),
    priority: "medium",
  },
  {
    id: "notif-05",
    type: "lead_transfer",
    title: "Lead qualificado pronto",
    description: "Fernanda Alves (Tech Solutions) completou 83% da triagem. Budget potencial: R$ 45.000/mês.",
    operatorName: "SDR Bot",
    timestamp: new Date(Date.now() - 60_000 * 35).toISOString(),
    priority: "medium",
  },
  {
    id: "notif-06",
    type: "daily_summary",
    title: "📊 Resumo da manhã",
    description: "Período 08:00–12:00: 15 atendimentos, TMA 3min 12s, NPS 8.4, 3 leads qualificados, 1 SLA estourado.",
    operatorName: "Sistema",
    timestamp: new Date(Date.now() - 60_000 * 120).toISOString(),
    priority: "low",
  },
  {
    id: "notif-07",
    type: "sla_alert",
    title: "🚨 SLA estourado — Conversa #4798",
    description: "O cliente 'José Eduardo' aguardou 14 minutos sem resposta. Operador notificado.",
    operatorName: "Amanda",
    timestamp: new Date(Date.now() - 60_000 * 45).toISOString(),
    priority: "high",
  },
  {
    id: "notif-08",
    type: "sentiment_alert",
    title: "Elogio detectado",
    description: "O cliente 'Roberto Campos' elogiou o atendimento: 'Vocês são incríveis, muito rápidos!'. Sentimento positivo.",
    operatorName: "Denys",
    timestamp: new Date(Date.now() - 60_000 * 50).toISOString(),
    priority: "low",
  },
  {
    id: "notif-09",
    type: "lead_transfer",
    title: "Lead de alta prioridade",
    description: "Carlos Mendes (Indústria SM) está em triagem com SDR. Empresa com +200 funcionários. Atenção especial.",
    operatorName: "SDR Bot",
    timestamp: new Date(Date.now() - 60_000 * 55).toISOString(),
    priority: "high",
  },
  {
    id: "notif-10",
    type: "no_response",
    title: "Follow-up necessário",
    description: "3 leads do dia anterior não receberam follow-up: Ana Oliveira, Pedro Santos, Julia Martins.",
    operatorName: "Sistema",
    timestamp: new Date(Date.now() - 60_000 * 70).toISOString(),
    priority: "medium",
  },
  {
    id: "notif-11",
    type: "daily_summary",
    title: "📊 Resumo do dia anterior",
    description: "Total: 42 atendimentos, TMA 2min 48s, NPS 8.9, 7 leads qualificados, 2 SLAs estourados, 5 transferências.",
    operatorName: "Sistema",
    timestamp: new Date(Date.now() - 60_000 * 600).toISOString(),
    priority: "low",
  },
  {
    id: "notif-12",
    type: "sla_alert",
    title: "⚠️ Alerta preventivo",
    description: "Operador Lucas tem 6 conversas simultâneas. Risco de degradação de SLA. Considere redistribuição.",
    operatorName: "Sistema",
    timestamp: new Date(Date.now() - 60_000 * 90).toISOString(),
    priority: "medium",
  },
];

// ── Status dos Agentes ──────────────────────────────────────────────────────

export const AGENT_STATUSES: AgentStatus[] = [
  {
    type: "sdr",
    name: "Agente SDR",
    enabled: true,
    status: "active",
    todayMetrics: [
      { label: "Triagens iniciadas", value: 8 },
      { label: "Completadas", value: 5 },
      { label: "Taxa de conclusão", value: "62%" },
      { label: "TMA triagem", value: "4min 30s" },
    ],
  },
  {
    type: "supervisor",
    name: "Agente Supervisor",
    enabled: true,
    status: "active",
    todayMetrics: [
      { label: "Notificações enviadas", value: 12 },
      { label: "Alertas SLA", value: 3 },
      { label: "Perguntas respondidas", value: 27 },
      { label: "Leads transferidos", value: 5 },
    ],
  },
  {
    type: "vendedor",
    name: "Agente Vendedor",
    enabled: false,
    status: "coming_soon",
    todayMetrics: [
      { label: "Propostas enviadas", value: "—" },
      { label: "Follow-ups", value: "—" },
      { label: "Conversões", value: "—" },
      { label: "Receita gerada", value: "—" },
    ],
  },
];

// ── Perguntas mais frequentes (para a tab Supervisor) ───────────────────────

export const TOP_QUESTIONS = [
  { question: "Qual o status dos leads de hoje?", count: 14 },
  { question: "Quantos atendimentos tivemos?", count: 11 },
  { question: "Qual o TMA da equipe?", count: 9 },
  { question: "Tem algum SLA estourado?", count: 8 },
  { question: "Resume o dia de ontem", count: 7 },
  { question: "Quem é o operador mais performático?", count: 5 },
  { question: "Quantos leads foram qualificados?", count: 4 },
];

// ── Base de Conhecimento Types & Mock Data ───────────────────────────────────

export type KnowledgeFile = {
  id: string;
  name: string;
  size: string;
  type: "pdf" | "word" | "image" | "txt";
  format: "embeddings" | "real";
  uploadedAt: string;
  folderId: string;
};

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
};

export const INITIAL_FOLDERS: Folder[] = [
  { id: "f-1", name: "Catálogos & Manuais", parentId: null },
  { id: "f-2", name: "Políticas da Empresa", parentId: null },
  { id: "f-3", name: "Válvulas Reguladoras", parentId: "f-1" },
  { id: "f-4", name: "Válvulas de Retenção", parentId: "f-1" },
  { id: "f-5", name: "Treinamentos Comerciais", parentId: "f-2" },
];

export const INITIAL_KNOWLEDGE_FILES: KnowledgeFile[] = [
  {
    id: "kf-1",
    name: "Tabela_Precos_Valvulas_2026.pdf",
    size: "2.4 MB",
    type: "pdf",
    format: "real",
    uploadedAt: "16/07/2026",
    folderId: "f-3",
  },
  {
    id: "kf-2",
    name: "Manual_Instalacao_Reguladora_Pressao.pdf",
    size: "4.8 MB",
    type: "pdf",
    format: "embeddings",
    uploadedAt: "15/07/2026",
    folderId: "f-3",
  },
  {
    id: "kf-3",
    name: "Script_Vendas_Valem_Conversao.docx",
    size: "1.2 MB",
    type: "word",
    format: "embeddings",
    uploadedAt: "14/07/2026",
    folderId: "f-5",
  },
  {
    id: "kf-4",
    name: "Esquema_Conexao_Valvula_Globo.png",
    size: "720 KB",
    type: "image",
    format: "real",
    uploadedAt: "16/07/2026",
    folderId: "f-4",
  },
  {
    id: "kf-5",
    name: "Políticas_Gerais_De_Descontos.txt",
    size: "15 KB",
    type: "txt",
    format: "embeddings",
    uploadedAt: "10/07/2026",
    folderId: "f-2",
  },
];
