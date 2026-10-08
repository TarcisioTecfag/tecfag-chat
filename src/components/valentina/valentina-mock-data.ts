// ══════════════════════════════════════════════════════════════════════════════
// 🤖 VALENTINA — Dados Mock para o módulo de agentes IA
// ══════════════════════════════════════════════════════════════════════════════

// ── Tipos ───────────────────────────────────────────────────────────────────

export type ValentinaTab = "chat" | "sdr" | "rodizio" | "fluxos" | "supervisor" | "vendedor" | "knowledge";

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
    content: "Olá! Sou a Valentina, sua assistente inteligente. Estou aqui para te ajudar com informações sobre leads, métricas, clientes e muito mais. O que você precisa?",
    timestamp: new Date(Date.now() - 60_000 * 5).toISOString(),
    type: "text",
  },
];

export const VALENTINA_MOCK_RESPONSES: string[] = [
  "Claro! Vou buscar essas informações para você. Um momento...",
  "Encontrei 12 leads qualificados hoje. Desses, 3 foram transferidos para vendedores e 2 aguardam follow-up. Quer que eu detalhe algum?",
  "O tempo médio de resposta da equipe hoje está em 2min 34s — dentro do SLA.",
  "O lead 'Carlos Mendes — Indústria SM' foi qualificado há 15 minutos pelo SDR. Score: 87/100. Deseja iniciar a transferência para um vendedor?",
  "Entendido! Vou gerar um relatório consolidado com as métricas de ontem e enviar aqui.",
  "A conversa com 'Maria Joaquina' teve sentimento negativo detectado às 14:23. Recomendo atenção especial nesse atendimento.",
  "Atualmente temos 4 triagens SDR ativas e 2 aguardando resposta do cliente. O pipeline está fluindo bem!",
  "Posso te ajudar com: Métricas de equipe, Status de leads, Alertas SLA, Resumo do dia. É só pedir!",
  "O operador Denys tem 8 conversas ativas e nenhum SLA estourado. Performance excelente hoje!",
  "Acabei de detectar um lead com alto potencial: 'Tech Solutions Ltda' — budget declarado de R$ 45.000/mês. Prioridade alta!",
  "Seu resumo da tarde: 23 atendimentos finalizados, NPS médio de 8.7, 5 leads transferidos com sucesso.",
  "A triagem do lead 'Fernando Costa' foi concluída com sucesso. Todos os 6 campos obrigatórios preenchidos. Pronto para transferência!",
  "Detectei que o cliente 'Ana Oliveira' não responde há 48h. Deseja que eu agende um follow-up automático?",
  "Análise de sentimento da última hora: 78% positivo, 15% neutro, 7% negativo. Tendência estável.",
  "O Agente Vendedor ainda está em desenvolvimento, mas posso adiantar que ele vai automatizar propostas e follow-ups de vendas!",
];

// ── Sessões SDR (triagem de leads) ──────────────────────────────────────────

export const SDR_TRIAGE_SESSIONS: SdrTriageSession[] = [
  {
    id: "sdr-001",
    contactName: "Carlos Mendes",
    company: "Indústria SM Ltda",
    currentStep: "TIPO DE QUALIFICAÇÃO",
    stepNumber: 4,
    totalSteps: 7,
    collectedData: {
      "NOME COMPLETO": { value: "Carlos Mendes", status: "filled" },
      "EMPRESA": { value: "Indústria SM Ltda", status: "filled" },
      "CNPJ OU CPF": { value: "45.187.902/0001-44", status: "filled" },
      "QUALIFICAÇÃO (TEMPERATURA)": { value: "4 - Alta intenção - QUENTE", status: "filled" },
      "TIPO DE QUALIFICAÇÃO": { value: "", status: "pending" },
      "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO": { value: "", status: "pending" },
      "QUAL O TIPO DE PRODUTO?": { value: "", status: "pending" },
    },
    startedAt: new Date(Date.now() - 60_000 * 12).toISOString(),
    status: "active",
    messages: [
      { sender: "bot", text: "Olá Carlos! Obrigado pelo interesse. Para direcioná-lo ao especialista ideal, preciso de algumas informações rápidas. Qual é o seu nome completo?", time: "14:32" },
      { sender: "client", text: "Carlos Mendes", time: "14:33" },
      { sender: "bot", text: "Perfeito, Carlos! Qual empresa você representa?", time: "14:33" },
      { sender: "client", text: "Indústria SM Ltda", time: "14:34" },
      { sender: "bot", text: "Ótimo! Poderia nos informar o CNPJ ou CPF para cadastro?", time: "14:34" },
      { sender: "client", text: "45.187.902/0001-44", time: "14:35" },
      { sender: "bot", text: "Certo. Como você avalia a intenção de compra imediata? (1 a 5)", time: "14:35" },
      { sender: "client", text: "4 - Alta intenção - QUENTE", time: "14:36" },
      { sender: "bot", text: "Excelente! Qual o seu tipo de qualificação?", time: "14:36" },
    ],
  },
  {
    id: "sdr-002",
    contactName: "Fernanda Alves",
    company: "Tech Solutions",
    currentStep: "PROJETO OU DESENVOLVIMENTO?",
    stepNumber: 5,
    totalSteps: 7,
    collectedData: {
      "NOME COMPLETO": { value: "Fernanda Alves", status: "filled" },
      "EMPRESA": { value: "Tech Solutions", status: "filled" },
      "CNPJ OU CPF": { value: "12.345.678/0001-90", status: "filled" },
      "QUALIFICAÇÃO (TEMPERATURA)": { value: "5 - Altíssima intenção - QUENTE", status: "filled" },
      "TIPO DE QUALIFICAÇÃO": { value: "Industrial - Recorrência: Cliente que já produz e precisa de lote recorrente", status: "filled" },
      "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO": { value: "", status: "pending" },
      "QUAL O TIPO DE PRODUTO?": { value: "", status: "pending" },
    },
    startedAt: new Date(Date.now() - 60_000 * 25).toISOString(),
    status: "active",
    messages: [
      { sender: "bot", text: "Olá Fernanda! Prazer em conhecê-la. Vamos qualificar seu interesse rapidamente. Qual é o seu nome completo?", time: "14:10" },
      { sender: "client", text: "Fernanda Alves", time: "14:11" },
      { sender: "bot", text: "Qual é a empresa?", time: "14:11" },
      { sender: "client", text: "Tech Solutions", time: "14:12" },
      { sender: "bot", text: "Poderia nos informar o CNPJ ou CPF?", time: "14:12" },
      { sender: "client", text: "12.345.678/0001-90", time: "14:13" },
      { sender: "bot", text: "Como você avalia a intenção de compra? (1 a 5)", time: "14:13" },
      { sender: "client", text: "5 - Altíssima intenção - QUENTE", time: "14:14" },
      { sender: "bot", text: "Qual o tipo de qualificação do lead?", time: "14:14" },
      { sender: "client", text: "Industrial - Recorrência: Cliente que já produz e precisa de lote recorrente", time: "14:15" },
      { sender: "bot", text: "O seu interesse é para Projeto ou Desenvolvimento? Sim ou Não?", time: "14:15" },
    ],
  },
  {
    id: "sdr-003",
    contactName: "Ricardo Souza",
    company: "Consultoria RS",
    currentStep: "Concluído",
    stepNumber: 7,
    totalSteps: 7,
    collectedData: {
      "NOME COMPLETO": { value: "Ricardo Souza", status: "filled" },
      "EMPRESA": { value: "Consultoria RS", status: "filled" },
      "CNPJ OU CPF": { value: "33.221.109/0001-88", status: "filled" },
      "QUALIFICAÇÃO (TEMPERATURA)": { value: "3 - Média intenção - MORNO", status: "filled" },
      "TIPO DE QUALIFICAÇÃO": { value: "Industrial - Primeira compra: Cliente que vai começar a produzir", status: "filled" },
      "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO": { value: "Sim", status: "filled" },
      "QUAL O TIPO DE PRODUTO?": { value: "Válvulas (Aerosol / Spray)", status: "filled" },
    },
    startedAt: new Date(Date.now() - 60_000 * 60).toISOString(),
    status: "completed",
    outcome: "Transferido para vendedor Denys",
    messages: [
      { sender: "bot", text: "Olá Ricardo! Vamos agilizar a qualificação. Qual o seu nome completo?", time: "13:35" },
      { sender: "client", text: "Ricardo Souza", time: "13:35" },
      { sender: "bot", text: "Empresa?", time: "13:36" },
      { sender: "client", text: "Consultoria RS", time: "13:36" },
      { sender: "bot", text: "CNPJ ou CPF?", time: "13:36" },
      { sender: "client", text: "33.221.109/0001-88", time: "13:37" },
      { sender: "bot", text: "Qual a sua intenção de compra? (1 a 5)", time: "13:37" },
      { sender: "client", text: "3 - Média intenção - MORNO", time: "13:38" },
      { sender: "bot", text: "Qual o tipo de qualificação?", time: "13:38" },
      { sender: "client", text: "Industrial - Primeira compra: Cliente que vai começar a produzir", time: "13:39" },
      { sender: "bot", text: "Trata-se de Projeto ou Desenvolvimento? Sim ou Não?", time: "13:39" },
      { sender: "client", text: "Sim", time: "13:40" },
      { sender: "bot", text: "E qual o tipo de produto?", time: "13:40" },
      { sender: "client", text: "Válvulas (Aerosol / Spray)", time: "13:41" },
      { sender: "bot", text: "Perfeito, Ricardo! ✅ Sua qualificação foi concluída. Estou transferindo você para o vendedor especialista agora. Obrigado!", time: "13:41" },
    ],
  },
  {
    id: "sdr-004",
    contactName: "Patrícia Lima",
    company: "Grupo PL",
    currentStep: "Abandonado",
    stepNumber: 1,
    totalSteps: 7,
    collectedData: {
      "NOME COMPLETO": { value: "Patrícia Lima", status: "filled" },
      "EMPRESA": { value: "", status: "pending" },
      "CNPJ OU CPF": { value: "", status: "pending" },
      "QUALIFICAÇÃO (TEMPERATURA)": { value: "", status: "pending" },
      "TIPO DE QUALIFICAÇÃO": { value: "", status: "pending" },
      "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO": { value: "", status: "pending" },
      "QUAL O TIPO DE PRODUTO?": { value: "", status: "pending" },
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
  content?: string | null;
  uploadedAt: string;
  folderId: string;
};

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
};

export const INITIAL_FOLDERS: Folder[] = [
  { id: "f-1", name: "Catálogos & Produtos", parentId: null },
];

export const INITIAL_KNOWLEDGE_FILES: KnowledgeFile[] = [];

