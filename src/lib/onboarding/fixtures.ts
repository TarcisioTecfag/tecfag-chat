import { getAiPersona } from "@/lib/ai-persona";

export type KnowledgeSourceStatusDemo =
  | "verified"
  | "catalog_only"
  | "honest_unknown"
  | "unverified_technical"
  | "operational_or_chat";

export interface DemoKnowledgeSourceEntry {
  status: KnowledgeSourceStatusDemo;
  label: string;
  documentName?: string;
  erpCode?: string;
  sku?: string;
  excerpt: string;
}

export const DEMO_KNOWLEDGE_SOURCE_STATES: Record<
  KnowledgeSourceStatusDemo,
  DemoKnowledgeSourceEntry
> = {
  verified: {
    status: "verified",
    label: "Manual Técnico Verificado (PDF)",
    documentName: "[PAMQGPAU079] VSF - MANUAL.pdf",
    erpCode: "PAMQGPAU079",
    sku: "865",
    excerpt:
      "Envasadora Semiautomática de Pós VSF — Tensão 220V monofásica, acionamento por pedal e rosca dosadora helicoidal em aço inox 304.",
  },
  catalog_only: {
    status: "catalog_only",
    label: "Ficha do Catálogo Oficial (Sem Manual Vinculado)",
    erpCode: "PAMQSLAU088",
    sku: "112",
    excerpt:
      "Seladora Contínua Pratic Seal TC-20 — Velocidade ajustável até 12 m/min e controle eletrônico de temperatura. Valide requisitos especiais no manual físico.",
  },
  honest_unknown: {
    status: "honest_unknown",
    label: "Limitação Declarada com Sinceridade",
    excerpt:
      "A documentação técnica consultada não especifica a viscosidade máxima em cP para este insumo específico. Recomendo validar com a Engenharia antes de confirmar ao cliente.",
  },
  unverified_technical: {
    status: "unverified_technical",
    label: "Informação Técnica Pendente de Validação",
    excerpt:
      "Referência preliminar de bancada; confirme o dimensional do bico dosador na ficha técnica do lote antes de enviar especificação formal.",
  },
  operational_or_chat: {
    status: "operational_or_chat",
    label: "Contexto Operacional / Conversa",
    excerpt:
      "Orientação de atendimento e organização de carteira baseada nos cards vinculados ao operador.",
  },
};

export interface DemoDirectiveItem {
  id: string;
  dealId: string;
  dealTitle: string;
  accountName: string;
  contactName: string;
  contactPhone: string;
  stageName: string;
  value: number;
  priority: "Alta" | "Média" | "Normal";
  status: "pending" | "overdue" | "today" | "completed";
  dueDateLabel: string;
  instruction: string;
  evidenceSummary?: string;
}

export interface DemoConversationItem {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  whatsappUsername?: string;
  companyName: string;
  cnpj?: string;
  channel: "whatsapp" | "instagram" | "messenger" | "livechat";
  queueState: "meus" | "todos" | "fila" | "automacao" | "finalizados";
  ownerMode: "self" | "colleague" | "none";
  ownerName: string;
  unreadCount: number;
  pinned: boolean;
  tags: string[];
  lastMessagePreview: string;
  lastMessageTime: string;
  metaWindowState: "open" | "closed" | "checking";
  senderConnectionId: string;
  senderConnectionLabel: string;
  currentDealId: string | null;
}

export interface DemoDealItem {
  id: string;
  title: string;
  accountId: string;
  accountName: string;
  accountType: "PJ" | "PF";
  accountDocument: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  status: "open" | "won" | "lost" | "paused";
  value: number;
  rating: number;
  ownerName: string;
  coolingDays: number;
  nextTaskTitle: string | null;
  nextTaskOverdue: boolean;
  source: string;
  campaign: string;
  conversationsCount: number;
  aiPriorityLabel: string;
  aiPriorityJustification: string;
}

export interface DemoTaskItem {
  id: string;
  dealId: string;
  dealTitle: string;
  accountName: string;
  contactName: string;
  subject: string;
  description: string;
  type: "Tarefa" | "Ligação" | "Reunião" | "Almoço / Visita";
  status: "pending" | "overdue" | "completed" | "cancelled" | "note";
  dateISO: string;
  timeLabel: string;
  periodBucket: "overdue" | "morning" | "afternoon" | "evening" | "completed";
  ownerName: string;
}

export interface DemoContactItem {
  id: string;
  name: string;
  phone: string;
  whatsappUsername: string;
  email: string;
  channel: "whatsapp" | "instagram" | "messenger" | "livechat";
  accountId: string;
  accountName: string;
  accountType: "PJ" | "PF";
  document: string;
  tags: string[];
  hasSiteJourney: boolean;
  walletOwnerMode: "self" | "colleague" | "none";
  attendanceOwnerName: string;
  inactiveDays: number;
}

export interface DemoPersonalTemplate {
  id: string;
  title: string;
  text: string;
  isGlobal?: boolean;
}

export function createOnboardingDemoFixtures(tenantId: string | null, operatorName?: string) {
  const persona = getAiPersona(tenantId || "tecfag");
  const safeOperatorName = operatorName?.trim() || "Consultor Demo";

  const directives: DemoDirectiveItem[] = [
    {
      id: "demo:directive-1",
      dealId: "demo:deal-1",
      dealTitle: "Linha de Envase de Pós VSF — Café Torrado",
      accountName: "Indústria de Alimentos Vale Verde Ltda (Demonstração)",
      contactName: "Carlos Eduardo Mendes (Fictício)",
      contactPhone: "+55 11 90000-0101",
      stageName: "Qualificação Técnica",
      value: 28831.72,
      priority: "Alta",
      status: "pending",
      dueDateLabel: "Hoje, 16:00",
      instruction:
        "Confirmar granulometria do pó e tensão 220V da planta antes de avançar para negociação.",
    },
    {
      id: "demo:directive-2",
      dealId: "demo:deal-2",
      dealTitle: "Seladora Contínua Pratic Seal TC-20",
      accountName: "Empório Grãos do Sul S.A. (Demonstração)",
      contactName: "Fernanda Rocha (Fictício)",
      contactPhone: "+55 41 90000-0202",
      stageName: "Negociação",
      value: 4890.0,
      priority: "Alta",
      status: "overdue",
      dueDateLabel: "Atrasada (2 dias)",
      instruction: "Retomar contato sobre prazo de entrega e registrar evidência da tratativa.",
    },
    {
      id: "demo:directive-3",
      dealId: "demo:deal-3",
      dealTitle: "Datador Inkjet Industrial TIJ",
      accountName: "Laticínios Serra Azul (Demonstração)",
      contactName: "Roberto Tavares (Fictício)",
      contactPhone: "+55 31 90000-0303",
      stageName: "Fechamento",
      value: 14500.0,
      priority: "Normal",
      status: "completed",
      dueDateLabel: "Concluída ontem",
      instruction: "Validar amostra de impressão em embalagem BOPP.",
      evidenceSummary: "Evidência registrada via WhatsApp com confirmação de leitura.",
    },
  ];

  const conversations: DemoConversationItem[] = [
    {
      id: "demo:conv-1",
      contactId: "demo:contact-1",
      contactName: "Carlos Eduardo Mendes (Fictício)",
      contactPhone: "+55 11 90000-0101",
      whatsappUsername: "@carlos.valeverde.demo",
      companyName: "Indústria de Alimentos Vale Verde Ltda",
      cnpj: "12.345.678/0001-95",
      channel: "whatsapp",
      queueState: "meus",
      ownerMode: "self",
      ownerName: safeOperatorName,
      unreadCount: 2,
      pinned: true,
      tags: ["Envasadora VSF", "Prioridade"],
      lastMessagePreview: "Pode me confirmar se a VSF atende pacotes de 500g a 1kg?",
      lastMessageTime: "14:20",
      metaWindowState: "open",
      senderConnectionId: "demo:conn-corporate",
      senderConnectionLabel: "WhatsApp Oficial da Empresa",
      currentDealId: "demo:deal-1",
    },
    {
      id: "demo:conv-2",
      contactId: "demo:contact-2",
      contactName: "Fernanda Rocha (Fictício)",
      contactPhone: "+55 41 90000-0202",
      whatsappUsername: "@fernanda.graos.demo",
      companyName: "Empório Grãos do Sul S.A.",
      cnpj: "98.765.432/0001-10",
      channel: "livechat",
      queueState: "fila",
      ownerMode: "none",
      ownerName: "Aguardando na Fila",
      unreadCount: 1,
      pinned: false,
      tags: ["Site", "Seladora"],
      lastMessagePreview: "Estou vendo a Seladora Pratic Seal no site e tenho uma dúvida.",
      lastMessageTime: "14:05",
      metaWindowState: "open",
      senderConnectionId: "demo:conn-corporate",
      senderConnectionLabel: "Canal Site",
      currentDealId: "demo:deal-2",
    },
    {
      id: "demo:conv-3",
      contactId: "demo:contact-3",
      contactName: "Roberto Tavares (Fictício)",
      contactPhone: "+55 31 90000-0303",
      companyName: "Laticínios Serra Azul",
      channel: "whatsapp",
      queueState: "todos",
      ownerMode: "colleague",
      ownerName: "Colega Comercial (Demo)",
      unreadCount: 0,
      pinned: false,
      tags: ["Em atendimento por colega"],
      lastMessagePreview: "Perfeito, vou aguardar o retorno técnico.",
      lastMessageTime: "Ontem",
      metaWindowState: "closed",
      senderConnectionId: "demo:conn-personal",
      senderConnectionLabel: "WhatsApp Individual do Consultor",
      currentDealId: "demo:deal-3",
    },
    {
      id: "demo:conv-4",
      contactId: "demo:contact-4",
      contactName: "Juliana Paiva (Fictício)",
      contactPhone: "+55 19 90000-0404",
      companyName: "Cosméticos BioFlora",
      channel: "instagram",
      queueState: "automacao",
      ownerMode: "none",
      ownerName: `${persona.name} (Triagem Demo)`,
      unreadCount: 0,
      pinned: false,
      tags: ["Instagram", "Triagem"],
      lastMessagePreview: "Qual a produção estimada por hora?",
      lastMessageTime: "11:30",
      metaWindowState: "open",
      senderConnectionId: "demo:conn-corporate",
      senderConnectionLabel: "Instagram Oficial",
      currentDealId: null,
    },
    {
      id: "demo:conv-5",
      contactId: "demo:contact-5",
      contactName: "Marcos Vinícius (Fictício)",
      contactPhone: "+55 21 90000-0505",
      companyName: "Panificadora Pão Dourado",
      channel: "messenger",
      queueState: "finalizados",
      ownerMode: "none",
      ownerName: "Atendimento Finalizado",
      unreadCount: 0,
      pinned: false,
      tags: ["Finalizado"],
      lastMessagePreview: "Obrigado pelo esclarecimento!",
      lastMessageTime: "24/10",
      metaWindowState: "closed",
      senderConnectionId: "demo:conn-corporate",
      senderConnectionLabel: "Messenger Oficial",
      currentDealId: null,
    },
  ];

  const deals: DemoDealItem[] = [
    {
      id: "demo:deal-1",
      title: "Linha de Envase de Pós VSF — Café Torrado",
      accountId: "demo:account-1",
      accountName: "Indústria de Alimentos Vale Verde Ltda (Demonstração)",
      accountType: "PJ",
      accountDocument: "12.345.678/0001-95",
      contactId: "demo:contact-1",
      contactName: "Carlos Eduardo Mendes (Fictício)",
      contactPhone: "+55 11 90000-0101",
      pipelineId: "demo:pipeline-1",
      pipelineName: "Funil Industrial — Máquinas",
      stageId: "demo:stage-1",
      stageName: "Qualificação Técnica",
      status: "open",
      value: 28831.72,
      rating: 5,
      ownerName: safeOperatorName,
      coolingDays: 0,
      nextTaskTitle: "Ligar para validar tensão 220V e altura do pé-direito",
      nextTaskOverdue: false,
      source: "Site VTEX",
      campaign: "Busca Orgânica — Envasadoras",
      conversationsCount: 2,
      aiPriorityLabel: "Prioridade Alta (Demo)",
      aiPriorityJustification:
        "Cliente consultou a página da Envasadora VSF por 4m20s e solicitou confirmação de faixa de dosagem.",
    },
    {
      id: "demo:deal-2",
      title: "Seladora Contínua Pratic Seal TC-20",
      accountId: "demo:account-2",
      accountName: "Empório Grãos do Sul S.A. (Demonstração)",
      accountType: "PJ",
      accountDocument: "98.765.432/0001-10",
      contactId: "demo:contact-2",
      contactName: "Fernanda Rocha (Fictício)",
      contactPhone: "+55 41 90000-0202",
      pipelineId: "demo:pipeline-1",
      pipelineName: "Funil Industrial — Máquinas",
      stageId: "demo:stage-2",
      stageName: "Negociação",
      status: "open",
      value: 4890.0,
      rating: 4,
      ownerName: safeOperatorName,
      coolingDays: 6,
      nextTaskTitle: "Retomar contato após avaliação de embalagem",
      nextTaskOverdue: true,
      source: "WhatsApp Direto",
      campaign: "Feira Industrial",
      conversationsCount: 1,
      aiPriorityLabel: "Atenção — Esfriando (Demo)",
      aiPriorityJustification: "Sem interação registrada há 6 dias e com tarefa vencida.",
    },
    {
      id: "demo:deal-3",
      title: "Datador Inkjet Industrial TIJ",
      accountId: "demo:account-3",
      accountName: "Produtor Rural João Batista (Demonstração PF)",
      accountType: "PF",
      accountDocument: "123.456.789-00",
      contactId: "demo:contact-3",
      contactName: "João Batista (Fictício)",
      contactPhone: "+55 31 90000-0303",
      pipelineId: "demo:pipeline-1",
      pipelineName: "Funil Industrial — Máquinas",
      stageId: "demo:stage-3",
      stageName: "Fechamento",
      status: "won",
      value: 14500.0,
      rating: 5,
      ownerName: safeOperatorName,
      coolingDays: 0,
      nextTaskTitle: null,
      nextTaskOverdue: false,
      source: "Indicação",
      campaign: "Carteira Ativa",
      conversationsCount: 1,
      aiPriorityLabel: "Venda Confirmada (Demo)",
      aiPriorityJustification: "Negócio concluído na demonstração.",
    },
  ];

  const tasks: DemoTaskItem[] = [
    {
      id: "demo:task-1",
      dealId: "demo:deal-1",
      dealTitle: "Linha de Envase de Pós VSF — Café Torrado",
      accountName: "Indústria de Alimentos Vale Verde Ltda",
      contactName: "Carlos Eduardo Mendes (Fictício)",
      subject: "Ligar para validar tensão 220V e altura do pé-direito",
      description: "Conferir especificações do manual PAMQGPAU079 com o responsável de manutenção.",
      type: "Ligação",
      status: "pending",
      dateISO: "2026-10-27",
      timeLabel: "10:30",
      periodBucket: "morning",
      ownerName: safeOperatorName,
    },
    {
      id: "demo:task-2",
      dealId: "demo:deal-2",
      dealTitle: "Seladora Contínua Pratic Seal TC-20",
      accountName: "Empório Grãos do Sul S.A.",
      contactName: "Fernanda Rocha (Fictício)",
      subject: "Retomar contato após avaliação de embalagem",
      description: "Cliente pediu retorno sobre velocidade da esteira.",
      type: "Tarefa",
      status: "overdue",
      dateISO: "2026-10-25",
      timeLabel: "15:00",
      periodBucket: "overdue",
      ownerName: safeOperatorName,
    },
    {
      id: "demo:task-3",
      dealId: "demo:deal-1",
      dealTitle: "Linha de Envase de Pós VSF — Café Torrado",
      accountName: "Indústria de Alimentos Vale Verde Ltda",
      contactName: "Carlos Eduardo Mendes (Fictício)",
      subject: "Reunião de alinhamento técnico",
      description: "Apresentar vídeos de operação da linha VSF.",
      type: "Reunião",
      status: "completed",
      dateISO: "2026-10-27",
      timeLabel: "14:00",
      periodBucket: "completed",
      ownerName: safeOperatorName,
    },
  ];

  const contacts: DemoContactItem[] = [
    {
      id: "demo:contact-1",
      name: "Carlos Eduardo Mendes (Fictício)",
      phone: "+55 11 90000-0101",
      whatsappUsername: "@carlos.valeverde.demo",
      email: "carlos.demo@valeverde.exemplo.br",
      channel: "whatsapp",
      accountId: "demo:account-1",
      accountName: "Indústria de Alimentos Vale Verde Ltda",
      accountType: "PJ",
      document: "12.345.678/0001-95",
      tags: ["Envasadora VSF", "Industrial"],
      hasSiteJourney: true,
      walletOwnerMode: "self",
      attendanceOwnerName: safeOperatorName,
      inactiveDays: 12,
    },
    {
      id: "demo:contact-2",
      name: "Fernanda Rocha (Fictício)",
      phone: "+55 41 90000-0202",
      whatsappUsername: "@fernanda.graos.demo",
      email: "fernanda.demo@graosdosul.exemplo.br",
      channel: "livechat",
      accountId: "demo:account-2",
      accountName: "Empório Grãos do Sul S.A.",
      accountType: "PJ",
      document: "98.765.432/0001-10",
      tags: ["Site", "Seladora"],
      hasSiteJourney: true,
      walletOwnerMode: "self",
      attendanceOwnerName: "Em atendimento com Colega (Demo)",
      inactiveDays: 54,
    },
    {
      id: "demo:contact-3",
      name: "João Batista (Fictício)",
      phone: "+55 31 90000-0303",
      whatsappUsername: "@joao.produtor.demo",
      email: "joao.demo@produtor.exemplo.br",
      channel: "whatsapp",
      accountId: "demo:account-3",
      accountName: "Produtor Rural João Batista (PF)",
      accountType: "PF",
      document: "123.456.789-00",
      tags: ["Pessoa Física", "Datador"],
      hasSiteJourney: false,
      walletOwnerMode: "self",
      attendanceOwnerName: safeOperatorName,
      inactiveDays: 63,
    },
  ];

  const personalTemplates: DemoPersonalTemplate[] = [
    {
      id: "demo:quick-1",
      title: "Saudação Consultiva Técnica",
      text: "Olá, {{nome}}! Aqui é {{operador}}, consultor da equipe referente à {{empresa}}. Como posso ajudar no dimensionamento do seu equipamento hoje?",
      isGlobal: false,
    },
    {
      id: "demo:quick-2",
      title: "Solicitação de Dados de Embalagem",
      text: "Para indicar o modelo exato, poderia me informar o produto que será envasado, o peso por pacote e a produção estimada por hora?",
      isGlobal: true,
    },
  ];

  return {
    personaName: persona.name,
    operatorName: safeOperatorName,
    directives,
    conversations,
    deals,
    tasks,
    contacts,
    personalTemplates,
    knowledgeSources: DEMO_KNOWLEDGE_SOURCE_STATES,
  };
}

const DEFAULT_DEMO_BUNDLE = createOnboardingDemoFixtures("tecfag", "Consultor Demo");

export const DEMO_DIRECTIVES = DEFAULT_DEMO_BUNDLE.directives;
export const DEMO_CONVERSATIONS = DEFAULT_DEMO_BUNDLE.conversations;
export const DEMO_DEALS = DEFAULT_DEMO_BUNDLE.deals;
export const DEMO_TASKS = DEFAULT_DEMO_BUNDLE.tasks;
export const DEMO_CONTACTS = DEFAULT_DEMO_BUNDLE.contacts;
export const DEMO_PERSONAL_TEMPLATES = DEFAULT_DEMO_BUNDLE.personalTemplates;

export const DEMO_ACCOUNTS = [
  {
    id: "demo:account-1",
    name: "Indústria de Alimentos Vale Verde Ltda",
    legalName: "Vale Verde Industrial de Alimentos Ltda",
    cnpj: "12.345.678/0001-95",
    segment: "Alimentos & Café",
    city: "São Paulo",
    state: "SP",
  },
  {
    id: "demo:account-2",
    name: "Empório Grãos do Sul S.A.",
    legalName: "Empório Grãos do Sul Comércio S.A.",
    cnpj: "98.765.432/0001-10",
    segment: "Grãos & Cereais",
    city: "Curitiba",
    state: "PR",
  },
] as const;

export const DEMO_WALLET_CLIENTS = DEFAULT_DEMO_BUNDLE.contacts.map((c) => ({
  id: c.id,
  name: c.name,
  company: c.accountName,
  phone: c.phone,
  inactiveDays: c.inactiveDays,
  status: c.inactiveDays > 45 ? ("inactivity_risk" as const) : ("active" as const),
}));

export const DEMO_FAGNER_TECHNICAL_STATES = DEMO_KNOWLEDGE_SOURCE_STATES;
export const FAGNER_DEMO_SOURCE_RESPONSES: Record<
  KnowledgeSourceStatusDemo,
  DemoKnowledgeSourceEntry & { badge: string; answer: string; sourceRef: string }
> = {
  verified: {
    ...DEMO_KNOWLEDGE_SOURCE_STATES.verified,
    badge: DEMO_KNOWLEDGE_SOURCE_STATES.verified.label,
    answer: DEMO_KNOWLEDGE_SOURCE_STATES.verified.excerpt,
    sourceRef: `${DEMO_KNOWLEDGE_SOURCE_STATES.verified.documentName} · SKU ${DEMO_KNOWLEDGE_SOURCE_STATES.verified.sku}`,
  },
  catalog_only: {
    ...DEMO_KNOWLEDGE_SOURCE_STATES.catalog_only,
    badge: DEMO_KNOWLEDGE_SOURCE_STATES.catalog_only.label,
    answer: DEMO_KNOWLEDGE_SOURCE_STATES.catalog_only.excerpt,
    sourceRef: `Catálogo Oficial · ERP ${DEMO_KNOWLEDGE_SOURCE_STATES.catalog_only.erpCode}`,
  },
  honest_unknown: {
    ...DEMO_KNOWLEDGE_SOURCE_STATES.honest_unknown,
    badge: DEMO_KNOWLEDGE_SOURCE_STATES.honest_unknown.label,
    answer: DEMO_KNOWLEDGE_SOURCE_STATES.honest_unknown.excerpt,
    sourceRef: "Transparência Técnica — Consultar Engenharia",
  },
  unverified_technical: {
    ...DEMO_KNOWLEDGE_SOURCE_STATES.unverified_technical,
    badge: DEMO_KNOWLEDGE_SOURCE_STATES.unverified_technical.label,
    answer: DEMO_KNOWLEDGE_SOURCE_STATES.unverified_technical.excerpt,
    sourceRef: "Referência Técnica Pendente de Homologação",
  },
  operational_or_chat: {
    ...DEMO_KNOWLEDGE_SOURCE_STATES.operational_or_chat,
    badge: DEMO_KNOWLEDGE_SOURCE_STATES.operational_or_chat.label,
    answer: DEMO_KNOWLEDGE_SOURCE_STATES.operational_or_chat.excerpt,
    sourceRef: "Contexto Operacional do Atendimento",
  },
};

