export type Channel = "whatsapp" | "instagram" | "messenger" | "livechat";
export type QueueType = "meus" | "todos" | "fila" | "automacao" | "finalizados";

export type RelatedConversationItem = {
  clientId: string;
  clientName: string;
  clientPhone?: string | null;
  company?: string | null;
  lastMessage?: string | null;
  waitMinutes?: number | null;
  isWaiting?: boolean;
  dealTitle?: string | null;
  funnelName?: string | null;
  temperature?: "quente" | "morno" | "frio" | null;
  statusLabel?: string | null;
};

export type RelatedDealItem = {
  dealId: string;
  title: string;
  value?: number | null;
  valueFormatted?: string | null;
  stageName?: string | null;
  pipelineName?: string | null;
  stageLabel?: string | null;
  accountName?: string | null;
  company?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  conversationId?: string | null;
  daysIdle?: number | null;
  status?: string | null;
  lastActivitySummary?: string | null;
};

export type RelatedCallActionItem = {
  id: string;
  clientName: string;
  phone: string;
  company?: string | null;
  dealId?: string | null;
  dealTitle?: string | null;
  dealValue?: number | null;
  dealValueFormatted?: string | null;
  stageLabel?: string | null;
  conversationId?: string | null;
  reason?: string | null;
};

export type Message = {
  conversationId?: string;
  whatsappConnectionId?: string | null;
  connectionName?: string;
  connectionPhone?: string | null;
  id: string;
  clientMessageId?: string;
  author: string;
  text: string;
  time: string;
  date?: string;
  sentAtISO?: string;
  side: "in" | "out";
  isInternalNote?: boolean;
  avatar?: string;
  externalId?: string | null;
  quotedMessageId?: string | null;
  quotedMessageSender?: string | null;
  quotedMessageContent?: string | null;
  reactions?: Array<{ emoji: string; from?: string }>;
  senderType?: string;
  /** Status de entrega: sending | accepted (✓) | delivered (✓✓) | read (✓✓ azul) | failed | unknown */
  status?: string;
  /** Provedor do envio. Checks só são exibidos para "meta", que tem confirmação real de entrega/leitura. */
  provider?: string | null;
  errorMessage?: string | null;
  isWarning?: boolean;
  warningType?: "delay" | "new_lead" | "overload";
  warningMetadata?: {
    clientId: string;
    clientName: string;
    lastMessage?: string;
    temperature?: "quente" | "morno" | "frio";
    interest?: string;
    dealId?: string;
    dealTitle?: string;
    taskId?: string;
    taskTitle?: string;
    conversations?: RelatedConversationItem[];
  };
  relatedConversations?: RelatedConversationItem[];
  relatedDeals?: RelatedDealItem[];
  relatedCalls?: RelatedCallActionItem[];
  thoughtTrace?: import("./valentina/agentic-thought-trace").AgenticThoughtTraceData;
  archivedByReset?: boolean;
  catalogPhoto?: Record<string, any> | null;
  knowledgeSources?: KnowledgeSourceItem[];
  knowledgeSourceStatus?: KnowledgeSourceStatus;
  knowledgeSourceStatusLabel?: string;
  knowledgeSourceStatusDescription?: string;
};

export type KnowledgeSourceStatus =
  | "verified"
  | "catalog_only"
  | "honest_unknown"
  | "unverified_technical"
  | "operational_or_chat";

export type KnowledgeSourceItem = {
  id: string;
  kind: "manual" | "catalog" | "document" | "photo" | "crm";
  title: string;
  code?: string;
  model?: string;
  folderOrCategory?: string;
  excerptOrDetail?: string;
  charCount?: number;
  fileId?: string;
  mediaUrl?: string;
  verified: boolean;
};

export type Conversation = {
  whatsappConnectionId?: string | null;
  id: string;
  contactId?: string;
  name: string;
  avatar: string;
  initials?: string;
  initialsBg?: string;
  phone?: string;
  whatsappUsername?: string;
  email?: string;
  cnpj?: string;
  cpf?: string;
  cnpjDetails?: Record<string, any>;
  tags: string[];
  channel: Channel;
  siteVisitorId?: string | null;
  hasSiteJourney?: boolean;
  siteContext?: any;
  siteContinuityCode?: string | null;
  queue: QueueType;
  messages: Message[];
  lastMessageTime: string;
  lastMessageAtISO?: string;
  lastClientMessageAtISO?: string;
  unreadCount: number;
  operatorId?: string | null;
  walletOperatorId?: string | null;
  sectorId?: string | null;
  sectorName?: string | null;
  responsibleName?: string;
  version?: number;
};

/**
 * Calcula o timestamp numérico de ordenação de uma conversa priorizando
 * sempre a última mensagem enviada pelo cliente (ou a última mensagem geral
 * caso a conversa ainda não possua mensagens recebidas do cliente).
 */
export function getConversationSortTimestamp(c: Conversation): number {
  let maxClientTs = 0;
  if (c.lastClientMessageAtISO) {
    const parsed = Date.parse(c.lastClientMessageAtISO);
    if (!Number.isNaN(parsed)) maxClientTs = parsed;
  }

  let maxAnyTs = 0;
  if (c.lastMessageAtISO) {
    const parsed = Date.parse(c.lastMessageAtISO);
    if (!Number.isNaN(parsed)) maxAnyTs = parsed;
  }

  if (Array.isArray(c.messages)) {
    for (const m of c.messages) {
      const iso = m.sentAtISO || (m as any).sentAt;
      if (!iso) continue;
      const ts = Date.parse(iso);
      if (Number.isNaN(ts)) continue;
      if (ts > maxAnyTs) maxAnyTs = ts;
      const isClient =
        m.side === "in" &&
        !m.isInternalNote &&
        m.author !== "Sistema" &&
        m.senderType !== "system" &&
        !m.isWarning;
      if (isClient && ts > maxClientTs) {
        maxClientTs = ts;
      }
    }
  }

  return maxClientTs > 0 ? maxClientTs : maxAnyTs;
}

export type OperatorTemplate = {
  id: string;
  tenantId: string;
  operatorId: string;
  title: string;
  text: string;
  createdAt?: string;
};

export type QuickResponse = {
  id?: string;
  tenantId?: string;
  shortcut: string;
  text: string;
  description: string;
  createdAt?: string | Date;
};

export const QUICK_RESPONSES: QuickResponse[] = [
  {
    shortcut: "/saudacao",
    text: "Olá! Tudo bem? Me chamo Fagner, consultor de atendimento. Como posso te ajudar hoje?",
    description: "Saudação inicial padrão",
  },
  {
    shortcut: "/cnpj",
    text: "Para que eu possa cadastrar sua oportunidade e verificar condições de faturamento, você poderia me informar o CNPJ da sua empresa, por favor?",
    description: "Solicitação de CNPJ",
  },
  {
    shortcut: "/dados_bancarios",
    text: "Claro! Seguem nossos dados para faturamento: PIX CNPJ: 12.345.678/0001-90 (Valem Chat & Tecfag Comércio Ltda) | Banco do Brasil, Agência: 3122-1, Conta: 44532-9.",
    description: "Dados bancários para pagamento",
  },
  {
    shortcut: "/suporte",
    text: "Compreendo a situação. Vou transferir este atendimento para a nossa equipe técnica especializada. Só um momento, por favor.",
    description: "Transferência para suporte técnico",
  },
];

export const TECFAG_MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "tec-1",
    name: "Pedro Silva",
    avatar: "https://i.pravatar.cc/80?img=12",
    phone: "(11) 98123-4567",
    email: "pedro.silva@industriasmart.com.br",
    cnpj: "42.112.983/0001-09",
    tags: ["Máquinas", "Interesse Comercial"],
    channel: "whatsapp",
    queue: "meus",
    unreadCount: 0,
    lastMessageTime: "10:45",
    operatorId: "op-1",
    sectorId: "sec-comercial",
    sectorName: "Comercial",
    messages: [
      {
        id: "t1-m1",
        author: "Pedro Silva",
        text: "Olá, vi a máquina seladora automática no site de vocês. Qual é o valor aproximado?",
        time: "10:30 AM",
        side: "in",
      },
      {
        id: "t1-m2",
        author: "Fagner (I.A)",
        text: "Olá Pedro! Que ótimo ver seu interesse em nossa seladora automática. Ela é excelente para aumentar a produtividade de embalagens.",
        time: "10:31 AM",
        side: "out",
      },
      {
        id: "t1-m3",
        author: "Pedro Silva",
        text: "Perfeito, preciso para selagem de sacos de café. Preciso de uma cotação.",
        time: "10:35 AM",
        side: "in",
      },
      {
        id: "t1-m4",
        author: "Vendedor Humano",
        text: "Entrei no atendimento para te passar as opções de faturamento. Qual a sua produção diária?",
        time: "10:40 AM",
        side: "out",
      },
      {
        id: "t1-m5",
        author: "Pedro Silva",
        text: "Cerca de 2000 sacos por dia.",
        time: "10:45 AM",
        side: "in",
      },
    ],
  },
  {
    id: "tec-2",
    name: "Mariana Souza",
    avatar: "https://i.pravatar.cc/80?img=47",
    phone: "",
    email: "mari.souza@gmail.com",
    tags: ["Suporte", "Instagram Lead"],
    channel: "instagram",
    queue: "meus",
    unreadCount: 0,
    lastMessageTime: "09:15",
    operatorId: "op-1",
    messages: [
      {
        id: "t2-m1",
        author: "Mariana Souza",
        text: "Oi, mandei uma mensagem ontem. Vocês vendem as peças de reposição da seladora manual?",
        time: "09:00 AM",
        side: "in",
      },
      {
        id: "t2-m2",
        author: "Vendedor",
        text: "Nota Interna: Cliente tem seladora antiga adquirida em 2024. Verificar estoque da resistência de 30cm.",
        time: "09:10 AM",
        side: "out",
        isInternalNote: true,
      },
      {
        id: "t2-m3",
        author: "Vendedor",
        text: "Olá Mariana! Sim, temos resistências, teflon e borrachas para seladora manual em estoque. Qual a largura da sua seladora?",
        time: "09:15 AM",
        side: "out",
      },
    ],
  },
  {
    id: "tec-3",
    name: "Alvo Distribuidora",
    avatar: "",
    initials: "AD",
    initialsBg: "#e9d5b8",
    phone: "(31) 97722-1100",
    email: "compras@alvodistribuidora.com",
    cnpj: "10.223.445/0001-99",
    tags: ["Aguardando CNPJ"],
    channel: "whatsapp",
    queue: "fila",
    unreadCount: 2,
    lastMessageTime: "10:50",
    messages: [
      {
        id: "t3-m1",
        author: "Alvo Distribuidora",
        text: "Preciso comprar 3 seladoras industriais com urgência. Vocês têm a pronta entrega?",
        time: "10:48 AM",
        side: "in",
      },
      {
        id: "t3-m2",
        author: "Alvo Distribuidora",
        text: "Por favor, me responda assim que puder.",
        time: "10:50 AM",
        side: "in",
      },
    ],
  },
  {
    id: "tec-4",
    name: "Carlos Ferreira",
    avatar: "https://i.pravatar.cc/80?img=33",
    phone: "",
    email: "carlos_f@outlook.com",
    tags: ["Dúvida Geral"],
    channel: "messenger",
    queue: "automacao",
    unreadCount: 0,
    lastMessageTime: "10:20",
    messages: [
      {
        id: "t4-m1",
        author: "Carlos Ferreira",
        text: "Olá! Vocês fazem entrega no estado do Rio de Janeiro?",
        time: "10:18 AM",
        side: "in",
      },
      {
        id: "t4-m2",
        author: "Fagner (I.A)",
        text: "Olá Carlos! Sim, a Tecfag atende e envia produtos para todo o território nacional, incluindo o estado do Rio de Janeiro! Deseja cotar o frete para algum produto específico?",
        time: "10:20 AM",
        side: "out",
      },
    ],
  },
  {
    id: "tec-5",
    name: "Jeroen Zoet",
    avatar: "https://i.pravatar.cc/80?img=59",
    phone: "(21) 98888-2233",
    email: "j.zoet@valem.com",
    tags: ["Concluído"],
    channel: "whatsapp",
    queue: "finalizados",
    unreadCount: 0,
    lastMessageTime: "Ontem",
    messages: [
      {
        id: "t5-m1",
        author: "Jeroen Zoet",
        text: "O rastreio deu que a mercadoria foi entregue. Muito obrigado!",
        time: "Ontem",
        side: "in",
      },
      {
        id: "t5-m2",
        author: "Vendedor",
        text: "Ficamos muito felizes em ajudar, Jeroen! Estarei encerrando nosso atendimento por aqui. Se precisar de mais alguma coisa, basta nos chamar.",
        time: "Ontem",
        side: "out",
      },
    ],
  },
];

export const VALEM_MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "val-1",
    name: "Tarcísio Júnior",
    avatar: "https://i.pravatar.cc/80?img=60",
    phone: "(81) 99876-5432",
    email: "tarcisio.jr@valem.com.br",
    cnpj: "30.400.500/0001-20",
    tags: ["Prioridade", "Valem Partner"],
    channel: "whatsapp",
    queue: "meus",
    unreadCount: 0,
    lastMessageTime: "10:52",
    operatorId: "op-2",
    sectorId: "sec-comercial",
    sectorName: "Comercial",
    messages: [
      {
        id: "v1-m1",
        author: "Tarcísio Júnior",
        text: "Bom dia! Como está a liberação da carga de embaladoras da Valem?",
        time: "10:45 AM",
        side: "in",
      },
      {
        id: "v1-m2",
        author: "Atendente Valem",
        text: "Nota Interna: Faturamento da Valem liberou o lote 45. Embalagem já em rota de despacho.",
        time: "10:48 AM",
        side: "out",
        isInternalNote: true,
      },
      {
        id: "v1-m3",
        author: "Atendente Valem",
        text: "Bom dia Tarcísio! O lote de embaladoras já foi faturado e está na transportadora. A previsão de chegada é até quinta-feira.",
        time: "10:50 AM",
        side: "out",
      },
      {
        id: "v1-m4",
        author: "Tarcísio Júnior",
        text: "Excelente! Consegue me mandar a nota fiscal por aqui?",
        time: "10:52 AM",
        side: "in",
      },
    ],
  },
  {
    id: "val-2",
    name: "Metalúrgica Recife",
    avatar: "",
    initials: "MR",
    initialsBg: "#f2a6a6",
    phone: "(81) 3444-5555",
    email: "vendas@metalrecife.com.br",
    cnpj: "18.273.847/0002-33",
    tags: ["Cotação de Serviços"],
    channel: "whatsapp",
    queue: "fila",
    unreadCount: 1,
    lastMessageTime: "10:40",
    messages: [
      {
        id: "v2-m1",
        author: "Metalúrgica Recife",
        text: "Olá, recebemos uma peça com as dimensões trocadas. Vocês conseguem mandar a correta hoje?",
        time: "10:40 AM",
        side: "in",
      },
    ],
  },
  {
    id: "val-3",
    name: "Clínica Saúde & Vida",
    avatar: "https://i.pravatar.cc/80?img=25",
    phone: "(81) 98777-6655",
    tags: ["Baileys Bot"],
    channel: "whatsapp",
    queue: "automacao",
    unreadCount: 0,
    lastMessageTime: "10:15",
    messages: [
      {
        id: "v3-m1",
        author: "Clínica Saúde & Vida",
        text: "Bom dia! Quais os horários de atendimento de vocês?",
        time: "10:10 AM",
        side: "in",
      },
      {
        id: "v3-m2",
        author: "Robô Valem (Baileys)",
        text: "Olá! O atendimento da Valem é de segunda a sexta, das 07:30 às 17:30. Como posso te auxiliar?",
        time: "10:15 AM",
        side: "out",
      },
    ],
  },
  {
    id: "val-4",
    name: "Distribuidora Nordeste",
    avatar: "https://i.pravatar.cc/80?img=62",
    phone: "(85) 99112-2334",
    email: "nordeste@distr.com",
    tags: ["Concluído"],
    channel: "whatsapp",
    queue: "finalizados",
    unreadCount: 0,
    lastMessageTime: "26/06",
    messages: [
      {
        id: "v4-m1",
        author: "Distribuidora Nordeste",
        text: "Ok, entendi. Já realizamos o pagamento da parcela.",
        time: "26/06",
        side: "in",
      },
      {
        id: "v4-m2",
        author: "Atendente Valem",
        text: "Confirmado aqui no sistema. Obrigado pelo envio do comprovante. Tenha uma ótima semana!",
        time: "26/06",
        side: "out",
      },
    ],
  },
];
