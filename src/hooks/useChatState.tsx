import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  Conversation,
  Channel,
  QueueType,
  Message,
  QuickResponse,
  OperatorTemplate,
} from "@/lib/mockData";
import { GroupPermissions, DEFAULT_ADMIN_PERMISSIONS, normalizeGroupPermissions } from "@/lib/rbac";
import { getAiPersona } from "@/lib/ai-persona";

export type MetaConfig = {
  businessAccountId: string;
  phoneNumberId: string;
  accessToken: string;
  webhookVerifyToken: string;
  status: "connected" | "disconnected" | "error";
};

export type BaileysConfig = {
  status: "disconnected" | "connecting" | "qr_ready" | "connected";
  pairedPhone: string;
  qrCodeUrl: string;
};

export type OperatorProfile = {
  name: string;
  email: string;
  avatar: string;
  status: "disponivel" | "pausa" | "desconectado";
};

export type AccessGroup = {
  id: string;
  name: string;
  allowedTenants: ("tecfag" | "valem")[];
  allowedChannels: ("whatsapp" | "instagram" | "messenger" | "livechat")[];
  // Administração do painel (legado)
  canCreateUser: boolean;
  canResetPassword: boolean;
  canEditProfile: boolean;
  // ── Permissões de Atendimento (RBAC legado) ──────────────────────────────
  canCaptureChat: boolean;   // Pode puxar chats da fila para si
  canTransferChat: boolean;  // Pode transferir chats para outro operador
  canFinishChat: boolean;    // Pode encerrar conversas
  canViewAllChats: boolean;  // Vê chats de todos os operadores (somente leitura)
  canOverrideChat: boolean;  // Pode assumir chat de outro operador sem transferência prévia
  // ── Matriz Granular de 10 Blocos ──────────────────────────────────────────
  permissions?: GroupPermissions;
  tenantId?: "tecfag" | "valem";
};

export type Operator = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: "disponivel" | "pausa" | "desconectado";
  /** @deprecated NUNCA persista no localStorage nem envie ao servidor. Campo mantido para compatibilidade de tipo. */
  passwordHash?: string;
  groupId: string;
  tenantId?: "tecfag" | "valem";
};

export type Sector = {
  id: string;
  name: string;
  operatorIds: string[];
  tenantId?: "tecfag" | "valem";
};

type ChatContextType = {
  tenant: "tecfag" | "valem";
  setTenant: (tenant: "tecfag" | "valem") => void;
  availableTenants: ("tecfag" | "valem")[];
  activeQueue: QueueType;
  setActiveQueue: (queue: QueueType) => void;
  selectedChatId: string | null;
  setSelectedChatId: (id: string | null) => void;
  conversations: Conversation[];
  activeChat: Conversation | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  channelFilter: Channel | "all";
  setChannelFilter: (filter: Channel | "all") => void;
  activeView: "chat" | "crm" | "contacts" | "wallet" | "settings" | "groups" | "monitor" | "analytics" | "tasks" | "valentina" | "ligacoes";
  setActiveView: (view: "chat" | "crm" | "contacts" | "wallet" | "settings" | "groups" | "monitor" | "analytics" | "tasks" | "valentina" | "ligacoes") => void;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: (open: boolean) => void;
  
  // Operator Profile State
  operatorProfile: OperatorProfile;
  updateOperatorProfile: (profile: Partial<OperatorProfile>) => void;
  isProfileModalOpen: boolean;
  setIsProfileModalOpen: (open: boolean) => void;

  // RBAC State & Operations
  operators: Operator[];
  accessGroups: AccessGroup[];
  sectors: Sector[];
  currentOperatorId: string;
  currentGroup: AccessGroup;
  sessionPermissions: GroupPermissions | null;
  sessionRole: string | null;
  impersonateOperator: (id: string) => void;
  createOperator: (operator: Omit<Operator, "id" | "status" | "avatar">) => void;
  updateOperator: (id: string, fields: Partial<Operator>) => void;
  deleteOperator: (id: string) => void;
  resetOperatorPassword: (id: string, newPasswordHash: string) => void;
  createAccessGroup: (group: Omit<AccessGroup, "id">) => void;
  updateAccessGroup: (id: string, fields: Partial<AccessGroup>) => void;
  deleteAccessGroup: (id: string) => void;
  createSector: (name: string) => void;
  updateSector: (id: string, fields: Partial<Sector>) => void;
  deleteSector: (id: string) => void;
  
  // Quick Responses State & Operations
  quickResponses: QuickResponse[];
  createQuickResponse: (qr: Omit<QuickResponse, "id">) => void;
  updateQuickResponse: (id: string, fields: Partial<QuickResponse>) => void;
  deleteQuickResponse: (id: string) => void;
  
  // Individual Templates State & Operations
  templates: OperatorTemplate[];
  createTemplate: (title: string, text: string) => Promise<void>;
  updateTemplate: (id: string, title: string, text: string) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  
  // Actions
  sendMessage: (text: string, isInternalNote?: boolean, attachments?: File[], quotedMessage?: { id: string; sender: string; content: string } | null, metaTemplate?: { name: string; language: string; parameters: string[] }) => Promise<boolean>;
  captureChat: (id: string) => void;
  transferChat: (id: string, sectorName: string | null, targetOperatorId?: string | null) => Promise<boolean>;
  finishChat: (id: string) => void;
  logSystemEvent: (chatId: string, eventText: string) => Promise<void>;
  updateTags: (id: string, tags: string[]) => void;
  updateClientInfo: (id: string, fields: Partial<Pick<Conversation, "name" | "phone" | "email" | "cnpj" | "cpf">>) => void;
  updateContactWallet: (contactId: string, walletOperatorId: string | null, targetOperatorId?: string | null) => Promise<void>;
  createContact: (name: string, phone: string, email: string, cnpj: string, channel: Channel) => Promise<{ contactId: string; conversationId: string; chatReady: boolean; queueState: QueueType }>;
  refreshConversations: (conversationId?: string) => Promise<void>;
  markAsRead: (id: string) => void;
  markAsUnread: (id: string) => void;
  pinChat: (id: string) => void;
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => Promise<void>;
  
  // Configurations
  activeProvider: "baileys" | "meta";
  setActiveProvider: React.Dispatch<React.SetStateAction<"baileys" | "meta">>;
  metaConfig: MetaConfig;
  setMetaConfig: React.Dispatch<React.SetStateAction<MetaConfig>>;
  baileysConfig: BaileysConfig;
  setBaileysConfig: React.Dispatch<React.SetStateAction<BaileysConfig>>;
  clientTypingStatus: Record<string, { status: "composing" | "recording"; timestamp: number } | null>;
  /** Status de entrega/leitura recebidos em tempo real (SSE), por id da mensagem. Prevalecem sobre o histórico carregado. */
  messageStatusOverrides: Record<string, { status: string; error?: string | null }>;
  /** Outro operador digitando na conversa (visível a quem acompanha o atendimento). */
  operatorTypingStatus: Record<string, { operatorId: string; operatorName: string; timestamp: number } | null>;
  isValentinaTyping: boolean;
  disconnectBaileys: () => void;
  connectBaileys: (forceNew?: boolean) => void;
 
  // Authentication
  isAuthenticated: boolean;
  login: (tenantOrEmail: "tecfag" | "valem" | string, emailOrPass: string, maybePass?: string) => Promise<boolean>;
  logout: () => void;
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

// Atualiza dinamicamente o favicon da aba do navegador conforme o tenant ativo
export const updateFavicon = (currentTenant: string | null) => {
  if (typeof document === "undefined") return;
  const isTecfag = currentTenant === "tecfag";
  const iconHref = isTecfag ? "/logo_tecfag.png" : "/favicon.png";

  const head = document.head || document.getElementsByTagName("head")[0];
  if (!head) return;

  // Remove apenas os favicons da aba para atualização dinâmica sem sobrescrever o ícone do app mobile
  const oldIcons = document.querySelectorAll<HTMLLinkElement>(
    "link[rel='icon'], link[rel='shortcut icon']"
  );
  oldIcons.forEach((el) => el.parentNode?.removeChild(el));

  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = iconHref;
  head.appendChild(link);

  // Garante que o ícone de atalho mobile (PWA / tela de início) permaneça com a logo oficial do app
  let appleLink = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
  if (!appleLink) {
    appleLink = document.createElement("link");
    appleLink.rel = "apple-touch-icon";
    appleLink.href = "/apple-touch-icon.png";
    head.appendChild(appleLink);
  }
};

// Atualiza dinamicamente o título do documento e o favicon sem fixar canal por tenant
export const updateDocumentTitle = (currentTenant: string | null, _provider?: "baileys" | "meta") => {
  if (typeof document === "undefined") return;
  const tName = currentTenant === "tecfag" ? "Tecfag Chat" : "Valem Chat";
  document.title = tName;
  updateFavicon(currentTenant);
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Provedor ativo de WhatsApp do tenant ('baileys' ou 'meta')
  const [activeProvider, setActiveProvider] = useState<"baileys" | "meta">("baileys");

  // Tenant ativo. Inicializado como null antes do login se não houver sessão salva no localStorage (regras do MVP)
  const [tenant, setTenantState] = useState<"tecfag" | "valem" | null>(() => {
    if (typeof window !== "undefined") {
      const savedTenant = localStorage.getItem("chat_tenant");
      if (savedTenant === "valem" || savedTenant === "tecfag") {
        return savedTenant;
      }
    }
    return null;
  });
  const [availableTenants, setAvailableTenants] = useState<("tecfag" | "valem")[]>([]);
  const switchingTenantRef = useRef(false);
  const [activeQueue, setActiveQueue] = useState<QueueType>(() => {
    if (typeof window !== "undefined") {
      const savedQueue = localStorage.getItem("chat_active_queue");
      if (savedQueue) return savedQueue as QueueType;
    }
    return "meus";
  });
  const [selectedChatId, setSelectedChatId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("chat_selected_id");
    }
    return null;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [activeView, setActiveView] = useState<"chat" | "crm" | "contacts" | "wallet" | "settings" | "groups" | "monitor" | "analytics" | "tasks" | "valentina" | "ligacoes">(() => {
    if (typeof window !== "undefined") {
      const savedView = localStorage.getItem("chat_active_view");
      if (savedView) return savedView as any;
    }
    return "chat";
  });

  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);

  // Status de presença (digitando / gravando áudio) do cliente por conversa
  const [clientTypingStatus, setClientTypingStatus] = useState<Record<string, { status: "composing" | "recording"; timestamp: number } | null>>({});
  const [messageStatusOverrides, setMessageStatusOverrides] = useState<Record<string, { status: string; error?: string | null }>>({});
  const [operatorTypingStatus, setOperatorTypingStatus] = useState<Record<string, { operatorId: string; operatorName: string; timestamp: number } | null>>({});
  const [isValentinaTyping, setIsValentinaTyping] = useState(false);
  // Ref para controle de cancelamento da resposta da Valentina
  // Cada nova mensagem incrementa a geração e aborta o fetch anterior
  const valentinaPendingRef = useRef<{ controller: AbortController; generation: number } | null>(null);
  const valentinaGenerationRef = useRef(0);

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [accessGroups, setAccessGroups] = useState<AccessGroup[]>([]);
  const [quickResponses, setQuickResponses] = useState<QuickResponse[]>([]);
  const [templates, setTemplates] = useState<OperatorTemplate[]>([]);

  // Inicializar lista de operadores do localStorage se disponível (sem forçar op-1 tecfag hardcoded)
  const [operators, setOperators] = useState<Operator[]>(() => {
    if (typeof window !== "undefined") {
      const savedOperators = localStorage.getItem("rbac_operators");
      if (savedOperators) {
        try {
          const parsed = JSON.parse(savedOperators);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch (e) {}
      }
    }
    return [];
  });

  // A identidade de escrita vem sempre da sessão do servidor, nunca do localStorage.
  const [currentOperatorId, setCurrentOperatorId] = useState("");
  const [sessionPermissions, setSessionPermissions] = useState<GroupPermissions | null>(null);
  const [sessionRole, setSessionRole] = useState<string | null>(null);

  // Refs to avoid stale closures in SSE event listener
  const selectedChatIdRef = useRef(selectedChatId);
  const currentOperatorIdRef = useRef(currentOperatorId);
  const tenantRef = useRef(tenant);
  const refreshAssignedChatRef = useRef<(conversationId: string) => Promise<void>>(async () => {});
  const conversationsRef = useRef<Conversation[]>([]);
  // Flag para evitar loop de troca de tenant: só sincroniza UMA vez por login
  const tenantSyncedRef = useRef(false);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    currentOperatorIdRef.current = currentOperatorId;
  }, [currentOperatorId]);

  useEffect(() => {
    tenantRef.current = tenant;
  }, [tenant]);

  // Cookies são compartilhados entre abas; todas precisam acompanhar a troca real de sessão.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "chat_tenant" && event.newValue !== tenantRef.current) {
        window.location.reload();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Sincroniza título e favicon do navegador com o tenant ativo
  useEffect(() => {
    if (tenant) {
      updateDocumentTitle(tenant, activeProvider);
    }
  }, [tenant, activeProvider]);

  const [isClient, setIsClient] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  // Restaurar dados da sessão do servidor após montagem no cliente
  useEffect(() => {
    setIsClient(true);
    if (typeof window !== "undefined") {
      const savedTenant = localStorage.getItem("chat_tenant");
      if (savedTenant === "valem" || savedTenant === "tecfag") {
        setTenantState(savedTenant as any);
      }

      const savedQueue = localStorage.getItem("chat_active_queue");
      if (savedQueue) {
        setActiveQueue(savedQueue as QueueType);
      }

      const savedView = localStorage.getItem("chat_active_view");
      if (savedView) {
        setActiveView(savedView as any);
      }

      // Validar sessão ativa no servidor com cookie HttpOnly
      fetch(`${BACKEND_URL}/api/auth/session`, {
        credentials: "include",
      })
        .then((res) => {
          if (!res.ok) throw new Error("Sessão inválida ou não autenticado");
          return res.json();
        })
        .then((data) => {
          if (data && (data.authenticated || data.success) && data.operator) {
            setIsAuthenticated(true);
            const activeTenant = data.tenantId || (data.operator.tenantId as "tecfag" | "valem") || null;
            if (activeTenant) {
              setTenantState(activeTenant);
              setAvailableTenants(Array.isArray(data.availableTenants) ? data.availableTenants : [activeTenant]);
            }
            if (data.channelConfig?.activeProvider) {
              setActiveProvider(data.channelConfig.activeProvider);
              updateDocumentTitle(activeTenant, data.channelConfig.activeProvider);
            } else if (activeTenant) {
              updateDocumentTitle(activeTenant, "baileys");
            }
            setCurrentOperatorId(data.operator.id);
            setSessionPermissions(data.permissions || null);
            setSessionRole(data.operator.role || null);

            setOperators((prev) => {
              const exists = prev.some((o) => o.id === data.operator.id);
              return exists ? prev.map((o) => (o.id === data.operator.id ? data.operator : o)) : [data.operator, ...prev];
            });

            // Sincronizar lista de operadores do tenant autenticado — sem ?tenantId= na URL
            fetch(`${BACKEND_URL}/api/operators`, {
              credentials: "include",
            })
              .then((res) => res.json())
              .then((opList) => {
                if (Array.isArray(opList) && opList.length > 0) {
                  setOperators(opList); // servidor já retorna sanitizado (sem passwordHash)
                }
              })
              .catch((err) => console.error("Erro ao sincronizar operadores da sessão:", err));
          } else {
            setIsAuthenticated(false);
            setSessionPermissions(null);
            setSessionRole(null);
            localStorage.removeItem("chat_is_authenticated");
            localStorage.removeItem("rbac_operators");
          }
        })
        .catch(() => {
          setIsAuthenticated(false);
          setSessionPermissions(null);
          setSessionRole(null);
          localStorage.removeItem("chat_is_authenticated");
          localStorage.removeItem("rbac_operators");
        });
    }
  }, []);

  // Sincronizar grupos, setores, respostas rápidas e operadores do banco de dados quando o tenant mudar.
  // O tenantId não é mais enviado na URL — o servidor usa a sessão autenticada como autoridade.
  useEffect(() => {
    if (typeof window !== "undefined") {
      fetch(`${BACKEND_URL}/api/operators`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            setOperators(data); // servidor já retorna sanitizado (sem passwordHash)
            try {
              const safeOps = data.map(({ passwordHash: _ph, ...rest }: any) => rest);
              localStorage.setItem("rbac_operators", JSON.stringify(safeOps));
            } catch (e) {}
          }
        })
        .catch((err) => console.error("Erro ao sincronizar operadores do banco:", err));

      fetch(`${BACKEND_URL}/api/groups`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setAccessGroups(data);
          }
        })
        .catch((err) => console.error("Erro ao sincronizar grupos do banco:", err));

      fetch(`${BACKEND_URL}/api/sectors`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setSectors(data);
          }
        })
        .catch((err) => console.error("Erro ao sincronizar setores do banco:", err));

      fetch(`${BACKEND_URL}/api/quick-responses`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setQuickResponses(data);
          }
        })
        .catch((err) => console.error("Erro ao sincronizar respostas rápidas do banco:", err));
    }
  }, [tenant]);

  // Sincronizar templates individuais do operador quando o tenant ou o operador ativo mudar.
  // tenantId e operatorId são resolvidos pelo servidor a partir da sessão autenticada.
  useEffect(() => {
    if (typeof window !== "undefined" && currentOperatorId) {
      fetch(`${BACKEND_URL}/api/templates`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setTemplates(data);
          }
        })
        .catch((err) => console.error("Erro ao sincronizar templates do banco:", err));
    }
  }, [tenant, currentOperatorId]);

  // SSE é imediato, mas pode perder eventos entre instâncias do servidor.
  // Reconcilia somente a atribuição, sem recarregar mensagens nem sobrescrever rascunhos.
  useEffect(() => {
    if (!isAuthenticated || !currentOperatorId) return;
    let disposed = false;
    const reconcileOwnership = async () => {
      if (disposed || document.hidden) return;
      try {
        const response = await fetch(`${BACKEND_URL}/api/chats?ownership=1`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data.operatorId !== currentOperatorIdRef.current) {
          window.location.reload();
          return;
        }
        setSessionRole(data.role || null);
        if (data.permissions) {
          setSessionPermissions((previous) =>
            JSON.stringify(previous) === JSON.stringify(data.permissions) ? previous : data.permissions
          );
        }
        const byId = new Map<string, any>((data.ownership || []).map((item: any) => [item.id, item]));
        if (disposed) return;
        setConversations((previous) => previous.map((chat) => {
          const latest = byId.get(chat.id);
          if (!latest || (chat.operatorId === latest.operatorId && chat.queue === latest.queueState && chat.version === latest.version)) return chat;
          return {
            ...chat,
            operatorId: latest.operatorId,
            queue: latest.queueState,
            responsibleName: latest.responsibleName,
            sectorId: latest.sectorId,
            version: latest.version,
          };
        }));
        const knownIds = new Set(conversationsRef.current.map((chat) => chat.id));
        const newlyAssigned = (data.ownership || []).filter((item: any) =>
          item.queueState === "meus" && item.operatorId === currentOperatorIdRef.current && !knownIds.has(item.id)
        ).slice(0, 10);
        for (const item of newlyAssigned) {
          if (disposed) break;
          await refreshAssignedChatRef.current(item.id).catch((error) =>
            console.warn("Falha ao carregar atendimento transferido:", error)
          );
        }
      } catch (error) {
        console.warn("[Chat] Falha temporária ao reconciliar responsáveis:", error);
      }
    };
    void reconcileOwnership();
    const timer = window.setInterval(reconcileOwnership, 12000);
    const onFocus = () => void reconcileOwnership();
    const onVisibility = () => { if (!document.hidden) void reconcileOwnership(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isAuthenticated, currentOperatorId, tenant]);

  // Persistir alterações apenas após o cliente estar pronto.
  // passwordHash é explicitamente excluído — NUNCA deve ficar no localStorage.
  useEffect(() => {
    if (isClient && typeof window !== "undefined") {
      try {
        const safeOperators = operators.map(({ passwordHash: _ph, ...rest }) => rest);
        localStorage.setItem("rbac_operators", JSON.stringify(safeOperators));
      } catch (e) {
        console.error("Erro ao persistir rbac_operators no localStorage:", e);
      }
    }
  }, [operators, isClient]);

  useEffect(() => {
    if (isClient && typeof window !== "undefined") {
      try {
        localStorage.setItem("chat_active_queue", activeQueue);
      } catch (e) {
        console.error("Erro ao persistir chat_active_queue no localStorage:", e);
      }
    }
  }, [activeQueue, isClient]);

  useEffect(() => {
    if (isClient && typeof window !== "undefined") {
      try {
        localStorage.setItem("chat_active_view", activeView);
      } catch (e) {
        console.error("Erro ao persistir chat_active_view no localStorage:", e);
      }
    }
  }, [activeView, isClient]);

  useEffect(() => {
    if (isClient && typeof window !== "undefined") {
      try {
        if (selectedChatId) {
          localStorage.setItem("chat_selected_id", selectedChatId);
        } else {
          localStorage.removeItem("chat_selected_id");
        }
      } catch (e) {
        console.error("Erro ao persistir chat_selected_id no localStorage:", e);
      }
    }
  }, [selectedChatId, isClient]);

  const defaultAdminGroup: AccessGroup = {
    id: "group-admin",
    name: "Administradores",
    allowedTenants: tenant ? [tenant] : [],
    allowedChannels: ["whatsapp", "instagram", "messenger", "livechat"],
    canCreateUser: true,
    canResetPassword: true,
    canEditProfile: true,
    canCaptureChat: true,
    canTransferChat: true,
    canFinishChat: true,
    canViewAllChats: true,
    canOverrideChat: true,
    permissions: DEFAULT_ADMIN_PERMISSIONS,
  };

  const defaultOperator: Operator = {
    id: "op-1",
    name: "Operador",
    email: "",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&fit=crop",
    status: "disponivel",
    groupId: "group-admin",
  };

  const currentOperator = operators.find((op) => op.id === currentOperatorId)
    || (operators.length > 0 ? operators[0] : defaultOperator);

  const rawGroup = accessGroups.find((g) => g.id === currentOperator.groupId) || defaultAdminGroup;
  const currentGroup: AccessGroup = {
    ...rawGroup,
    permissions: normalizeGroupPermissions(rawGroup),
  };

  const operatorProfile: OperatorProfile = {
    name: currentOperator.name,
    email: currentOperator.email,
    avatar: currentOperator.avatar,
    status: currentOperator.status,
  };

  const updateOperatorProfile = async (fields: Partial<OperatorProfile>) => {
    // Snapshot do estado antes da atualização otimista — necessário para rollback
    const previousOperators = operators;

    setOperators((prev) =>
      prev.map((op) =>
        op.id === currentOperatorId
          ? {
              ...op,
              name: fields.name ?? op.name,
              email: fields.email ?? op.email,
              avatar: fields.avatar ?? op.avatar,
              status: fields.status ?? op.status,
            }
          : op
      )
    );

    try {
      // PATCH /api/operators/profile — rota específica para auto-edição de perfil
      // Não requer admin; tenantId e operatorId vêm da sessão no servidor.
      // passwordHash NUNCA é enviado.
      const res = await fetch(`${BACKEND_URL}/api/operators/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.name,
          email: fields.email,
          avatar: fields.avatar,
          status: fields.status,
        }),
      });

      if (!res.ok) {
        // Reverter estado se o servidor rejeitar
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        console.error("[updateOperatorProfile] Servidor rejeitou a atualização:", errBody);
        setOperators(previousOperators);
        toast.error(`Erro ao salvar perfil: ${errBody.error || res.statusText}`);
      }
    } catch (err) {
      console.error("Erro ao sincronizar atualização de perfil de operador no DB:", err);
      setOperators(previousOperators);
      toast.error("Erro de conexão ao salvar perfil.");
    }
  };

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Impersonation
  const impersonateOperator = (id: string) => {
    if (id !== currentOperatorId) toast.error("Troque de conta para atuar como outro operador.");
  };

  // CRUD Operators
  const createOperator = async (opData: Omit<Operator, "id" | "status" | "avatar">) => {
    // Extrair passwordHash do opData — não deve entrar no estado React nem no localStorage
    const { passwordHash, ...opFields } = opData;

    const newOp: Operator = {
      ...opFields,
      id: `op-${Date.now()}`,
      status: "disponivel",
      avatar: `https://i.pravatar.cc/80?img=${Math.floor(Math.random() * 70)}`,
      tenantId: tenant ?? undefined,
    };

    try {
      // Envia ao servidor ANTES de atualizar o estado — padrão pessimista
      const res = await fetch(`${BACKEND_URL}/api/operators`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Envia 'password' em claro para o servidor fazer o hash; nunca envia passwordHash
        body: JSON.stringify({ ...newOp, password: passwordHash }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        console.error("[createOperator] Falha na API:", errBody);
        toast.error(`Erro ao criar operador: ${errBody.error || res.statusText}`);
        return; // Não atualiza o estado — operador não foi criado
      }

      // Só adiciona ao estado local após confirmação do servidor
      setOperators((prev) => [...prev, newOp]);
    } catch (err) {
      console.error("Erro ao criar operador no DB:", err);
      toast.error("Erro de conexão ao criar operador.");
    }
  };

  const updateOperator = async (id: string, fields: Partial<Operator>) => {
    // Strippear passwordHash dos fields antes de aplicar ao estado local
    const { passwordHash: _ph, ...safeFields } = fields;

    setOperators((prev) => {
      const updated = prev.map((op) => (op.id === id ? { ...op, ...safeFields } : op));
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("rbac_operators", JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });

    const targetOp = operators.find((op) => op.id === id);
    if (targetOp) {
      try {
        // Strippear passwordHash do payload — nunca enviar hash ao servidor via update
        const { passwordHash: _hash, ...safeTarget } = targetOp;
        await fetch(`${BACKEND_URL}/api/operators`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...safeTarget, ...safeFields }),
        });
      } catch (err) {
        console.error("Erro ao atualizar operador no DB:", err);
      }
    }
  };

  const deleteOperator = async (id: string) => {
    if (id === currentOperatorId) return;

    // Otimista: remove da UI imediatamente
    const previousOperators = operators;
    setOperators((prev) => {
      const updated = prev.filter((op) => op.id !== id);
      if (typeof window !== "undefined") {
        try { localStorage.setItem("rbac_operators", JSON.stringify(updated)); } catch (e) {}
      }
      return updated;
    });

    try {
      // Sem ?tenantId= — o servidor usa a sessão autenticada como autoridade
      const res = await fetch(`${BACKEND_URL}/api/operators?id=${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        // ── DELETE falhou no backend → reverter estado ──────────────────────
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        console.error("[deleteOperator] Erro no backend:", errBody);
        // Rollback: restaura lista anterior
        setOperators(previousOperators);
        if (typeof window !== "undefined") {
          try { localStorage.setItem("rbac_operators", JSON.stringify(previousOperators)); } catch (e) {}
        }
        toast.error(`Erro ao excluir operador: ${errBody.error || res.statusText}`);
      }
    } catch (err) {
      console.error("[deleteOperator] Falha na requisição:", err);
      // Rollback em caso de erro de rede
      setOperators(previousOperators);
      if (typeof window !== "undefined") {
        try { localStorage.setItem("rbac_operators", JSON.stringify(previousOperators)); } catch (e) {}
      }
      toast.error("Erro de conexão ao tentar excluir o operador.");
    }
  };


  const resetOperatorPassword = async (id: string, newPasswordHash: string) => {
    // NÃO salvar passwordHash no estado React/localStorage — o servidor faz o hash
    // O estado local do operador permanece inalterado (sem campo de senha)

    const targetOp = operators.find((op) => op.id === id);
    if (targetOp) {
      try {
        await fetch(`${BACKEND_URL}/api/operators`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          // Envia como 'password' (texto plano) para o servidor fazer o hash
          body: JSON.stringify({
            ...targetOp,
            password: newPasswordHash,
          }),
        });
      } catch (err) {
        console.error("Erro ao redefinir senha de operador no DB:", err);
      }
    }
  };

  // CRUD Access Groups
  const createAccessGroup = async (groupData: Omit<AccessGroup, "id">) => {
    const id = `group-${Date.now()}`;
    const newGroup: AccessGroup = {
      ...groupData,
      id,
      allowedTenants: tenant ? [tenant] : [],
    };
    
    // Update local state optimistically
    setAccessGroups((prev) => [...prev, newGroup]);

    try {
      const response = await fetch(`${BACKEND_URL}/api/groups`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newGroup),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      toast.success("Grupo de acesso criado com sucesso!");
    } catch (err) {
      console.error("Erro ao criar grupo de acesso no DB:", err);
      setAccessGroups((prev) => prev.filter((group) => group.id !== id));
      toast.error("Erro ao salvar grupo de acesso.");
    }
  };

  const updateAccessGroup = async (id: string, fields: Partial<AccessGroup>) => {
    const safeFields = { ...fields, allowedTenants: tenant ? [tenant] : [] };
    setAccessGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...safeFields } : g)));

    const targetGroup = accessGroups.find((g) => g.id === id);
    if (targetGroup) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/groups`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...targetGroup,
            ...safeFields,
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (err) {
        console.error("Erro ao atualizar grupo de acesso no DB:", err);
      }
    }
  };

  const deleteAccessGroup = async (id: string) => {
    if (id === "group-admin") return;
    
    setAccessGroups((prev) => prev.filter((g) => g.id !== id));
    setOperators((prev) => prev.map((op) => (op.groupId === id ? { ...op, groupId: "group-whats-only" } : op)));

    try {
      await fetch(`${BACKEND_URL}/api/groups?id=${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      toast.success("Grupo de acesso excluído com sucesso!");
    } catch (err) {
      console.error("Erro ao excluir grupo de acesso no DB:", err);
      toast.error("Erro ao excluir grupo de acesso.");
    }
  };

  // CRUD Sectors
  const createSector = async (name: string) => {
    const id = `sec-${Date.now()}`;
    const newSector: Sector = {
      id,
      name,
      operatorIds: [],
    };

    setSectors((prev) => [...prev, newSector]);

    try {
      await fetch(`${BACKEND_URL}/api/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newSector, tenantId: tenant }),
      });
      toast.success("Setor criado com sucesso!");
    } catch (err) {
      console.error("Erro ao criar setor no DB:", err);
      toast.error("Erro ao salvar setor.");
    }
  };

  const updateSector = async (id: string, fields: Partial<Sector>) => {
    setSectors((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));

    const targetSector = sectors.find((s) => s.id === id);
    if (targetSector) {
      try {
        await fetch(`${BACKEND_URL}/api/sectors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...targetSector,
            ...fields,
            tenantId: tenant,
          }),
        });
      } catch (err) {
        console.error("Erro ao atualizar setor no DB:", err);
      }
    }
  };

  const deleteSector = async (id: string) => {
    setSectors((prev) => prev.filter((s) => s.id !== id));

    try {
      await fetch(`${BACKEND_URL}/api/sectors?id=${id}`, {
        method: "DELETE",
      });
      toast.success("Setor excluído com sucesso!");
    } catch (err) {
      console.error("Erro ao excluir setor no DB:", err);
      toast.error("Erro ao excluir setor.");
    }
  };

  // CRUD Quick Responses
  const createQuickResponse = async (qrData: Omit<QuickResponse, "id">) => {
    const id = `qr-${Date.now()}`;
    const newQr: QuickResponse = {
      ...qrData,
      id,
      tenantId: tenant ?? undefined,
    };

    setQuickResponses((prev) => [...prev, newQr]);

    try {
      await fetch(`${BACKEND_URL}/api/quick-responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newQr),
      });
      toast.success("Resposta rápida criada com sucesso!");
    } catch (err) {
      console.error("Erro ao criar resposta rápida no DB:", err);
      toast.error("Erro ao salvar resposta rápida.");
    }
  };

  const updateQuickResponse = async (id: string, fields: Partial<QuickResponse>) => {
    setQuickResponses((prev) => prev.map((qr) => (qr.id === id ? { ...qr, ...fields } : qr)));

    const targetQr = quickResponses.find((qr) => qr.id === id);
    if (targetQr) {
      try {
        await fetch(`${BACKEND_URL}/api/quick-responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...targetQr,
            ...fields,
            tenantId: tenant ?? undefined,
          }),
        });
      } catch (err) {
        console.error("Erro ao atualizar resposta rápida no DB:", err);
      }
    }
  };

  const deleteQuickResponse = async (id: string) => {
    setQuickResponses((prev) => prev.filter((qr) => qr.id !== id));

    try {
      await fetch(`${BACKEND_URL}/api/quick-responses?id=${id}`, {
        method: "DELETE",
      });
      toast.success("Resposta rápida excluída com sucesso!");
    } catch (err) {
      console.error("Erro ao excluir resposta rápida no DB:", err);
      toast.error("Erro ao excluir resposta rápida.");
    }
  };

  const createTemplate = async (title: string, text: string) => {
    const id = `tpl-${Date.now()}`;
    const newTpl: OperatorTemplate = {
      id,
      tenantId: tenant || "valem",
      operatorId: currentOperatorId,
      title,
      text,
    };
    setTemplates((prev) => [...prev, newTpl]);

    try {
      await fetch(`${BACKEND_URL}/api/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTpl),
      });
      toast.success("Template criado com sucesso!");
    } catch (err) {
      console.error("Erro ao criar template no DB:", err);
      toast.error("Erro ao criar template.");
    }
  };

  const updateTemplate = async (id: string, title: string, text: string) => {
    setTemplates((prev) => prev.map((tpl) => (tpl.id === id ? { ...tpl, title, text } : tpl)));

    try {
      await fetch(`${BACKEND_URL}/api/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          tenantId: tenant,
          operatorId: currentOperatorId,
          title,
          text,
        }),
      });
      toast.success("Template atualizado com sucesso!");
    } catch (err) {
      console.error("Erro ao atualizar template no DB:", err);
      toast.error("Erro ao atualizar template.");
    }
  };

  const deleteTemplate = async (id: string) => {
    setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));

    try {
      await fetch(`${BACKEND_URL}/api/templates?id=${id}`, {
        method: "DELETE",
      });
      toast.success("Template excluído com sucesso!");
    } catch (err) {
      console.error("Erro ao excluir template no DB:", err);
      toast.error("Erro ao excluir template.");
    }
  };

  // Keep state for both tenants separately
  const [tecfagConvs, setTecfagConvs] = useState<Conversation[]>([]);
  const [valemConvs, setValemConvs] = useState<Conversation[]>([]);

  // Configuration States
  const [metaConfig, setMetaConfig] = useState<MetaConfig>({
    businessAccountId: "act_meta_88329910243",
    phoneNumberId: "phone_9918239023",
    accessToken: "EAAGzo...T4ZD",
    webhookVerifyToken: "tecfag_chat_secret_token_2026",
    status: "connected",
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  const [baileysConfig, setBaileysConfig] = useState<BaileysConfig>({
    status: "disconnected",
    pairedPhone: "",
    qrCodeUrl: "",
  });

  // Load default selected chat when tenant changes
  useEffect(() => {
    const currentConvs = tenant === "tecfag" ? tecfagConvs : valemConvs;
    if (currentConvs.length === 0) return;
    const savedSelectedId = typeof window !== "undefined" ? localStorage.getItem("chat_selected_id") : null;
    if (savedSelectedId && currentConvs.some((c) => c.id === savedSelectedId)) {
      setSelectedChatId(savedSelectedId);
      return;
    }
    const firstChat = currentConvs.find((c) => (activeQueue === "todos" || c.queue === activeQueue) && (activeQueue !== "meus" || c.operatorId === currentOperatorId)) || currentConvs[0];
    setSelectedChatId(firstChat ? firstChat.id : null);
  }, [tenant]);

  // Sync tab/queue changes to first chat in that queue if present
  useEffect(() => {
    const currentConvs = tenant === "tecfag" ? tecfagConvs : valemConvs;
    if (currentConvs.length === 0) return;
    if (selectedChatId && currentConvs.some((c) =>
      c.id === selectedChatId && (activeQueue === "todos" || c.queue === activeQueue) &&
      (activeQueue !== "meus" || c.operatorId === currentOperatorId)
    )) return;
    const firstInQueue = currentConvs.find((c) => (activeQueue === "todos" || c.queue === activeQueue) && (activeQueue !== "meus" || c.operatorId === currentOperatorId));
    if (firstInQueue) {
      setSelectedChatId(firstInQueue.id);
    } else {
      setSelectedChatId(null);
    }
  }, [activeQueue]);

  // Re-verify tenant quando o operador logado for carregado ou mudar.
  // IMPORTANTE: Só executa quando isAuthenticated for true e a lista de operadores contiver o operador ativo.
  useEffect(() => {
    if (!isAuthenticated || !currentOperatorId || operators.length === 0) return;
    if (tenantSyncedRef.current) return;

    const activeOp = operators.find((op) => op.id === currentOperatorId);
    if (!activeOp) return; // Esperar a lista carregar o operador ativo antes de inferir tenant!

    const currentTenant = tenantRef.current;
    let targetTenant: "tecfag" | "valem" | null = null;

    // Prioridade 1: usar tenantId explícito do operador no banco
    if (activeOp.tenantId === "valem" || activeOp.tenantId === "tecfag") {
      targetTenant = activeOp.tenantId;
    } else {
      const email = (activeOp.email || "").toLowerCase();
      if (email.includes("@valempack") || email.includes("@valem")) {
        targetTenant = "valem";
      } else if (email.includes("@tecfag")) {
        targetTenant = "tecfag";
      }
    }

    if (targetTenant && targetTenant !== currentTenant) {
      console.log(`[useChatState] Sincronizando tenant do operador '${activeOp.name}': ${currentTenant} -> ${targetTenant}`);
      tenantSyncedRef.current = true;
      setTenantState(targetTenant);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("chat_tenant", targetTenant);
        } catch (e) {}
      }
      updateDocumentTitle(targetTenant, activeProvider);
    } else {
      tenantSyncedRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOperatorId, operators, isAuthenticated]);

  const setTenant = async (newTenant: "tecfag" | "valem") => {
    if (newTenant === tenant) return;
    if (switchingTenantRef.current) return;
    if (!availableTenants.includes(newTenant)) {
      toast.error(`Acesso bloqueado: você não tem permissão para acessar o tenant ${newTenant.toUpperCase()}`);
      return;
    }
    switchingTenantRef.current = true;
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/switch-tenant`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: newTenant }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Acesso negado.");
      // Recarregar encerra conexões em tempo real e limpa estados do tenant anterior.
      localStorage.setItem("chat_tenant", newTenant);
      localStorage.setItem("chat_active_view", "chat");
      localStorage.removeItem("rbac_operators");
      window.location.reload();
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível alternar a empresa.");
    } finally {
      switchingTenantRef.current = false;
    }
  };

  // Carregar conversas persistidas no banco (Railway)
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch(`${BACKEND_URL}/api/chats?limit=150`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const pinnedKey = `pinned_chats_${currentOperatorId || "global"}`;
          let pinnedIds: string[] = [];
          try {
            const stored = localStorage.getItem(pinnedKey);
            if (stored) pinnedIds = JSON.parse(stored);
          } catch (e) {
            console.error("Erro ao ler pinned_chats do localStorage:", e);
          }

          const aiPersona = getAiPersona(tenant || "valem");
          const valentinaDefault: Conversation = {
            id: "valentina",
            name: aiPersona.name,
            avatar: aiPersona.avatarUrl,
            initials: aiPersona.name.substring(0, 2).toUpperCase(),
            initialsBg: "var(--primary)",
            phone: "IA",
            email: `${aiPersona.name.toLowerCase()}@${tenant || "valem"}.ai`,
            cnpj: "",
            cpf: "",
            tags: ["IA", aiPersona.company],
            channel: "whatsapp",
            queue: "meus",
            messages: [
              {
                id: "val_welcome",
                author: aiPersona.name,
                text: (() => {
                  const brtHourStr = new Intl.DateTimeFormat("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                    hour: "numeric",
                    hour12: false,
                  }).format(new Date());
                  const hour = parseInt(brtHourStr, 10);
                  const greeting = hour >= 5 && hour < 12 ? "Bom dia" : hour >= 12 && hour < 18 ? "Boa tarde" : "Boa noite";
                  const name = operatorProfile?.name || "operador";
                  return `Olá! ${greeting} ${name}, como posso te ajudar hoje no seu atendimento?`;
                })(),
                time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                side: "in",
                isInternalNote: false,
              }
            ],
            lastMessageTime: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            unreadCount: 0,
            operatorId: currentOperatorId,
            walletOperatorId: currentOperatorId,
            sectorId: null,
            sectorName: null,
            responsibleName: `${aiPersona.name} IA`,
          };
          
          const chatsWithPinned = [valentinaDefault, ...data].map((c: any) => ({
            ...c,
            pinned: c.id === "valentina" ? true : pinnedIds.includes(c.id),
          }));
          setConversations(chatsWithPinned);

          // Restaurar atendimento selecionado pós-deploy ou selecionar o primeiro disponível na fila ativa
          const savedSelectedId = typeof window !== "undefined" ? localStorage.getItem("chat_selected_id") : null;
          if (savedSelectedId && chatsWithPinned.some((c: any) => c.id === savedSelectedId)) {
            setSelectedChatId(savedSelectedId);
          } else if (!selectedChatIdRef.current) {
            const firstInQueue = chatsWithPinned.find((c: any) => (activeQueue === "todos" || c.queue === activeQueue) && (activeQueue !== "meus" || c.operatorId === currentOperatorId));
            if (firstInQueue) {
              setSelectedChatId(firstInQueue.id);
            }
          }
        }
      })
      .catch((err) => console.error("Erro ao sincronizar conversas do banco:", err));
  }, [tenant, currentOperatorId]);

  // Carrega histórico do chat individual do operador com Valentina (scope=operator)
  useEffect(() => {
    if (!currentOperatorId) return;
    (async () => {
      try {
        const res = await fetch(`/api/valentina/messages?tenantId=${tenant}&operatorId=${currentOperatorId}&scope=operator`);
        if (!res.ok) return;
        const rows: any[] = await res.json();
        if (rows.length > 0) {
          const mappedMessages: Message[] = rows.map((r) => ({
            id: r.id,
            author: r.direction === "to_agent" ? "Você" : getAiPersona(tenant || "valem").name,
            text: r.content,
            time: new Date(r.createdAt || Date.now()).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            side: r.direction === "to_agent" ? "out" : "in",
            isInternalNote: false,
          }));

          setConversations((prev) =>
            prev.map((c) => (c.id === "valentina" ? { ...c, messages: mappedMessages } : c))
          );
        }
      } catch (e) {
        console.error("Erro ao carregar histórico do chat do operador:", e);
      }
    })();
  }, [tenant, currentOperatorId]);

  const rawConversations = tenant === "tecfag" ? tecfagConvs : valemConvs;
  const conversations = rawConversations.filter((c) =>
    currentGroup.allowedChannels.includes(c.channel)
  );
  const setConversations = tenant === "tecfag" ? setTecfagConvs : setValemConvs;

  // Ref to track latest conversations and avoid stale closures in event listeners
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const activeChat = conversations.find((c) => c.id === selectedChatId) || null;

  // Actions
  const sendMessage = async (text: string, isInternalNote = false, attachments?: File[], quotedMessage?: { id: string; sender: string; content: string } | null, metaTemplate?: { name: string; language: string; parameters: string[] }) => {
    if (!selectedChatId) return false;

    const currentChat = conversations.find((c) => c.id === selectedChatId);
    if (!currentChat) return false;

    if (selectedChatId === "valentina") {
      const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const userMsg: Message = {
        id: `msg-${Date.now()}`,
        author: "Você",
        text,
        time: now,
        side: "out",
        isInternalNote,
        quotedMessageId: quotedMessage?.id || null,
        quotedMessageSender: quotedMessage?.sender || null,
        quotedMessageContent: quotedMessage?.content || null,
      };

      // Adicionar mensagem do operador imediatamente
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === "valentina") {
            return {
              ...c,
              lastMessageTime: now,
              messages: [...c.messages, userMsg],
            };
          }
          return c;
        })
      );

      // ── Valentina: cancela a chamada anterior antes de iniciar nova ──────────
      // Aborta o fetch em andamento (AbortController) e incrementa a "geração"
      // para que fragmentos de respostas antigas sejam descartados.
      if (valentinaPendingRef.current) {
        valentinaPendingRef.current.controller.abort();
      }
      const myGeneration = ++valentinaGenerationRef.current;
      const controller = new AbortController();
      valentinaPendingRef.current = { controller, generation: myGeneration };

      // Chamar API real /api/valentina/messages (com signal de cancelamento)
      (async () => {
        setIsValentinaTyping(true);
        const currentPersona = getAiPersona(tenant || "valem");
        try {
          const res = await fetch("/api/valentina/messages", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenantId: tenant,
              operatorId: currentOperatorId,
              content: text,
              scope: "operator",
            }),
          });

          // Se uma nova mensagem foi enviada enquanto aguardávamos, descartar esta resposta
          if (valentinaGenerationRef.current !== myGeneration) return;

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          // Processar fragmentos com delays incrementais para simular digitação
          const fragments = data.fragments || [];
          const alerts = data.alerts || [];

          for (let i = 0; i < fragments.length; i++) {
            // Verificar cancelamento antes de cada fragmento
            if (valentinaGenerationRef.current !== myGeneration) return;

            const frag = fragments[i];
            const delay = frag.delay || (i * 800);

            // Aguardar delay cancelável — rejeita se o sinal foi abortado
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, Math.max(delay, 400));
              controller.signal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
              }, { once: true });
            });

            // Verificar cancelamento novamente após o delay
            if (valentinaGenerationRef.current !== myGeneration) return;

            const respTime = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            const valentinaMsg: Message = {
              id: frag.id || `msg-val-${Date.now()}-${i}`,
              author: currentPersona.name,
              text: frag.content || frag.text || "",
              time: respTime,
              side: "in",
              isInternalNote: false,
            };

            setConversations((prev) =>
              prev.map((c) => {
                if (c.id === "valentina") {
                  return {
                    ...c,
                    lastMessageTime: respTime,
                    messages: [...c.messages, valentinaMsg],
                  };
                }
                return c;
              })
            );
          }

          // Processar alertas como mensagens de warning
          for (const alert of alerts) {
            if (valentinaGenerationRef.current !== myGeneration) return;
            const respTime = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            const alertMsg: Message = {
              id: `msg-alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              author: currentPersona.name,
              text: `[${alert.type === "sla_warning" ? "SLA" : "Alerta"}] ${alert.clientName || "Cliente"} está aguardando há ${alert.waitMinutes || "?"} minutos`,
              time: respTime,
              side: "in",
              isInternalNote: false,
              isWarning: true,
              warningType: "delay" as const,
              warningMetadata: {
                clientId: alert.conversationId || "",
                clientName: alert.clientName || "Cliente",
                lastMessage: alert.lastMessage || "",
              },
            };

            setConversations((prev) =>
              prev.map((c) => {
                if (c.id === "valentina") {
                  return {
                    ...c,
                    lastMessageTime: respTime,
                    messages: [...c.messages, alertMsg],
                  };
                }
                return c;
              })
            );
          }
        } catch (err: any) {
          // AbortError é intencional (nova mensagem enviada) — não mostrar erro
          if (err?.name === "AbortError") return;
          console.error("[useChatState] Erro ao chamar API Valentina:", err);
          // Fallback local em caso de erro de rede real
          if (valentinaGenerationRef.current !== myGeneration) return;
          const fallbackTime = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          const fallbackMsg: Message = {
            id: `msg-val-fallback-${Date.now()}`,
            author: currentPersona.name,
            text: "Ops, tive um problema ao processar sua mensagem. Pode tentar de novo?",
            time: fallbackTime,
            side: "in",
            isInternalNote: false,
          };
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id === "valentina") {
                return { ...c, lastMessageTime: fallbackTime, messages: [...c.messages, fallbackMsg] };
              }
              return c;
            })
          );
        } finally {
          // Só desligar o indicador se esta geração ainda é a ativa
          if (valentinaGenerationRef.current === myGeneration) {
            setIsValentinaTyping(false);
          }
        }
      })();

      return true;
    }

    if (currentChat.queue !== "meus" || currentChat.operatorId !== currentOperatorId) {
      toast.error("Capture o atendimento antes de enviar mensagens.");
      return false;
    }

    const shouldSendReal =
      currentChat.channel === "whatsapp" &&
      !isInternalNote;
    let sentTextMessageId: string | undefined;
    let sentTextStatus: string | undefined;
    let sentRenderedText: string | undefined;
    const sentAttachmentMessageIds: string[] = [];
    const sentAttachmentStatuses: string[] = [];

    console.log("[SendMessage Frontend] Diagnóstico de envio:", {
      tenant,
      channel: currentChat.channel,
      isInternalNote,
      phone: currentChat.phone,
      selectedChatId,
      shouldSendReal,
      quotedMessage,
    });

    if (shouldSendReal) {
      const clientMessageId = `cmsg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      let partAlreadySent = false;

      try {
        // Envia mensagem pelo endpoint unificado /api/whatsapp/send (Baileys ou Meta conforme activeProvider)
        if (text.trim() || metaTemplate) {
          const response = await fetch(`${BACKEND_URL}/api/whatsapp/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              conversationId: selectedChatId,
              text,
              clientMessageId,
              quotedMessageId: quotedMessage?.id || null,
              ...(metaTemplate ? {
                templateName: metaTemplate.name,
                templateLanguage: metaTemplate.language,
                templateComponents: metaTemplate.parameters.length ? [{
                  type: "body",
                  parameters: metaTemplate.parameters.map((value) => ({ type: "text", text: value })),
                }] : [],
              } : {}),
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || "Erro na resposta do envio de mensagem");
          }
          const sendResult = await response.json().catch(() => ({}));
          sentTextMessageId = sendResult.messageId;
          sentTextStatus = sendResult.status;
          sentRenderedText = typeof sendResult.renderedText === "string" ? sendResult.renderedText : undefined;
          partAlreadySent = true;
        }

        // Enviar anexos via endpoint unificado /api/whatsapp/send (funciona para Baileys e Meta)
        if (attachments && attachments.length > 0) {
          for (const [attachmentIndex, file] of attachments.entries()) {
            try {
              const formData = new FormData();
              formData.append("conversationId", selectedChatId);
              formData.append("clientMessageId", `${clientMessageId}-att-${attachmentIndex}`);
              const safeName = (file as any).name || file.name || "arquivo";
              formData.append("file", file, safeName);
              if (quotedMessage?.id) {
                formData.append("quotedMessageId", quotedMessage.id);
              }

              const mediaRes = await fetch(`${BACKEND_URL}/api/whatsapp/send`, {
                method: "POST",
                credentials: "include",
                body: formData,
              });
              if (!mediaRes.ok) {
                const errData = await mediaRes.json().catch(() => ({}));
                throw new Error(errData.error || "Falha ao enviar anexo pelo canal unificado");
              }
              const mediaResult = await mediaRes.json().catch(() => ({}));
              sentAttachmentMessageIds.push(mediaResult.messageId || "");
              sentAttachmentStatuses.push(mediaResult.status || "");
              partAlreadySent = true;
            } catch (err) {
              console.error("Falha ao enviar anexo:", err);
              throw err;
            }
          }
        }
      } catch (err: any) {
        console.error("Falha ao enviar mensagem de WhatsApp pelo backend:", err);
        toast.error(partAlreadySent
          ? `Envio parcial: ${err.message || "um anexo falhou"}. Confira o histórico antes de repetir.`
          : `Erro ao enviar mensagem: ${err.message || "Conexão falhou"}`);
        return partAlreadySent;
      }
    } else {
      // Para mensagens internas, outras plataformas ou outros inquilinos (ex: Tecfag), persistir no banco de dados local
      try {
        const response = await fetch(`${BACKEND_URL}/api/chats`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant,
            conversationId: selectedChatId,
            senderType: "agent",
            senderName: operatorProfile.name,
            senderEmail: operatorProfile.email,
            content: text,
            isInternalNote,
            quotedMessageId: quotedMessage?.id || null,
            quotedMessageSender: quotedMessage?.sender || null,
            quotedMessageContent: quotedMessage?.content || null,
          }),
        });

        if (!response.ok) {
          toast.error("Erro ao salvar mensagem local no banco.");
          return false;
        }
        const savedMessage = await response.json().catch(() => ({}));
        sentTextMessageId = savedMessage.id;
      } catch (err) {
        console.error("Falha ao salvar mensagem local no banco:", err);
        toast.error("Falha ao salvar mensagem local no banco.");
        return false;
      }
    }

    const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    // Mensagem de texto (só adiciona se tiver conteúdo)
    const messagesToAdd: Message[] = [];

    // Provedor real do envio: os checks (✓/✓✓/azul) só aparecem para a Meta, que confirma entrega/leitura.
    const sentProvider = shouldSendReal ? activeProvider : null;

    if (text.trim() || metaTemplate) {
      messagesToAdd.push({
        id: sentTextMessageId || `msg-${Date.now()}`,
        author: isInternalNote ? operatorProfile.name : "Você",
        text: metaTemplate ? sentRenderedText || `[Template Meta: ${metaTemplate.name}]` : text,
        time: now,
        side: "out",
        isInternalNote,
        quotedMessageId: quotedMessage?.id || null,
        quotedMessageSender: quotedMessage?.sender || null,
        quotedMessageContent: quotedMessage?.content || null,
        status: sentTextStatus,
        provider: sentProvider,
      });
    }

    // Mensagens de mídia — preview local com objectURL
    if (attachments && attachments.length > 0) {
      attachments.forEach((file, i) => {
        const objectUrl = URL.createObjectURL(file);
        const mime = file.type || "application/octet-stream";
        const fileName = file.name || "arquivo";

        let mediaType = "document";
        if (mime.startsWith("image/")) mediaType = "image";
        else if (mime.startsWith("video/")) mediaType = "video";
        else if (mime.startsWith("audio/")) mediaType = "audio";

        messagesToAdd.push({
          id: sentAttachmentMessageIds[i] || `msg-media-${Date.now()}-${i}`,
          author: "Você",
          // Formato especial para preview local: [LOCAL_MEDIA:type:url:filename]
          text: `[LOCAL_MEDIA:${mediaType}:${objectUrl}:${fileName}]`,
          time: now,
          side: "out",
          isInternalNote: false,
          status: sentAttachmentStatuses[i] || undefined,
          provider: sentProvider,
        });
      });
    }

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === selectedChatId) {
          return {
            ...c,
            lastMessageTime: now,
            messages: [
              ...c.messages,
              ...messagesToAdd.filter((message) => !c.messages.some((existing) => existing.id === message.id)),
            ],
          };
        }
        return c;
      })
    );
    return true;
  };

  const captureChat = async (id: string) => {
    const previousState = conversationsRef.current.find((c) => c.id === id);
    const isTakingFromAnother = !!previousState?.operatorId && previousState.operatorId !== currentOperatorId;
    if (!previousState || (isTakingFromAnother
      ? sessionRole !== "admin" && !sessionPermissions?.chat.canOverrideChat
      : sessionRole !== "admin" && !sessionPermissions?.chat.canCaptureChat)) {
      toast.error("Sem permissão para assumir este atendimento.");
      return;
    }

    const textLog = `CONVERSA INICIADA POR ${operatorProfile.name.toUpperCase()}`;
    try {
      const res = await fetch(`${BACKEND_URL}/api/chats/update-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          conversationId: id,
          queueState: "meus",
          operatorId: currentOperatorId,
          systemMessageText: textLog,
          expectedVersion: previousState?.version ?? 1,
        }),
      });

      if (res.status === 409) {
        toast.error("Este atendimento mudou. Atualizei o responsável; tente novamente se ainda tiver permissão.");
        await refreshConversations(id);
        return;
      }

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      const updated = await res.json();
      await refreshConversations(id);
      setConversations((prev) => prev.map((c) => c.id === id ? {
        ...c,
        queue: updated.queueState,
        operatorId: updated.operatorId,
        responsibleName: updated.responsibleName,
        version: updated.version,
      } : c));
      setActiveQueue("meus");
      setSelectedChatId(id);
    } catch (err) {
      console.error("[captureChat] Erro ao assumir atendimento:", err);
      toast.error(err instanceof Error ? err.message : "Não foi possível assumir o atendimento.");
    }
  };

  const transferChat = async (id: string, sectorName: string | null, targetOperatorId?: string | null): Promise<boolean> => {
    const previousState = conversationsRef.current.find((c) => c.id === id);
    const targetOp = targetOperatorId ? operators.find((op) => op.id === targetOperatorId) : null;
    if (!previousState || (targetOperatorId && !targetOp)) {
      toast.error("Atendimento ou operador de destino não encontrado.");
      return false;
    }
    const canTransfer = sessionRole === "admin" || sessionPermissions?.chat.canTransferChat === true;
    const canOverride = sessionRole === "admin" || sessionPermissions?.chat.canOverrideChat === true;
    if (!canTransfer || (previousState.operatorId && previousState.operatorId !== currentOperatorId && !canOverride)) {
      toast.error("Sem permissão para transferir este atendimento.");
      return false;
    }
    const targetQueueState = targetOp ? "meus" : "fila";
    const targetSector = sectorName ? sectors.find((sector) => sector.name === sectorName) : null;
    const sectorId = sectorName ? targetSector?.id ?? null : undefined;
    const textLog = targetOp
      ? `Atendimento transferido diretamente para ${targetOp.name} por ${operatorProfile.name}.`
      : `Atendimento transferido para a fila do setor ${sectorName || "geral"} por ${operatorProfile.name}.`;
    try {
      const res = await fetch(`${BACKEND_URL}/api/chats/update-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          conversationId: id,
          queueState: targetQueueState,
          operatorId: targetOperatorId || null,
          ...(sectorId !== undefined ? { sectorId } : {}),
          systemMessageText: textLog,
          isTransfer: true,
          expectedVersion: previousState?.version ?? 1,
        }),
      });

      if (res.status === 409) {
        toast.error("Este atendimento mudou. Atualizei o responsável; tente novamente se ainda tiver permissão.");
        await refreshConversations(id);
        return false;
      }

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      const updated = await res.json();
      setConversations((prev) => prev.map((chat) => chat.id === id ? {
        ...chat,
        queue: updated.queueState,
        operatorId: updated.operatorId,
        responsibleName: updated.responsibleName,
        sectorId: updated.sectorId,
        sectorName: sectorName || chat.sectorName,
        version: updated.version,
      } : chat));
      setActiveQueue("todos");
      setSelectedChatId(id);
      void refreshConversations(id).catch((error) => console.warn("Atendimento transferido; falha ao recarregar o histórico:", error));
      toast.success(targetOp ? `Atendimento transferido para ${targetOp.name}.` : "Atendimento enviado para a fila.");
      return true;
    } catch (err) {
      console.error("[transferChat] Erro ao transferir atendimento:", err);
      toast.error(err instanceof Error ? err.message : "Não foi possível transferir o atendimento.");
      return false;
    }
  };

  const finishChat = async (id: string) => {
    const textLog = "Conversa encerrada e movida para Finalizados.";
    const previousState = conversationsRef.current.find((c) => c.id === id);

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const systemMsg: Message = {
            id: `sys-${Date.now()}`,
            author: "Sistema",
            text: textLog,
            time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            side: "out",
            isInternalNote: true,
          };
          return {
            ...c,
            queue: "finalizados",
            responsibleName: "Na Fila",
            messages: [...c.messages, systemMsg],
          };
        }
        return c;
      })
    );
    setActiveQueue("finalizados");
    setSelectedChatId(id);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chats/update-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          conversationId: id,
          queueState: "finalizados",
          systemMessageText: textLog,
          expectedVersion: previousState?.version ?? 1,
        }),
      });

      if (res.status === 409) {
        console.warn("[finishChat] Conflito: chat já foi finalizado ou alterado por outro operador.");
        toast.error("Conflito: Esta conversa já foi alterada por outro atendente.");
        if (previousState) {
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...previousState } : c))
          );
        }
        setSelectedChatId(null);
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const updated = await res.json();
      setConversations((prev) => prev.map((c) => c.id === id ? { ...c, version: updated.version } : c));
    } catch (err) {
      console.error("Erro ao persistir encerramento de chat no DB:", err);
      if (previousState) {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...previousState } : c))
        );
      }
    }
  };

  const logSystemEvent = async (chatId: string, eventText: string) => {
    const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const systemMsg: Message = {
      id: `sys-${Date.now()}`,
      author: "Sistema",
      text: eventText,
      time: now,
      side: "out",
      isInternalNote: true,
      senderType: "system",
    };

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === chatId) {
          return {
            ...c,
            lastMessageTime: now,
            messages: [...c.messages, systemMsg],
          };
        }
        return c;
      })
    );

    try {
      await fetch(`${BACKEND_URL}/api/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          conversationId: chatId,
          senderType: "system",
          senderName: "Sistema",
          content: eventText,
          isInternalNote: true,
        }),
      });
    } catch (err) {
      console.error("Erro ao salvar log de evento no banco:", err);
    }
  };

  const updateTags = async (id: string, tags: string[]) => {
    // 1. Atualizar estado local imediatamente
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, tags } : c))
    );

    // 2. Obter contactId e persistir no banco de dados via API
    const conv = rawConversations.find((c) => c.id === id);
    const contactId = (conv as any)?.contactId as string | undefined;

    if (!contactId) {
      console.warn("[updateTags] Sem contactId para conversa:", id);
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[updateTags] Erro ao persistir tags:", err);
      } else {
        console.log("[updateTags] Tags persistidas com sucesso para o contato:", contactId);
      }
    } catch (e) {
      console.error("[updateTags] Falha ao enviar requisição de tags:", e);
    }
  };

  const markAsRead = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
    );

    // Persistir no banco de dados via PATCH
    fetch(`${BACKEND_URL}/api/chats`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id, unreadCount: 0 }),
    }).catch((e) => {
      console.error("[markAsRead] Falha ao atualizar unreadCount no servidor:", e);
    });
  };

  const markAsUnread = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: Math.max(c.unreadCount, 1) } : c))
    );

    // Persistir no banco de dados via PATCH
    fetch(`${BACKEND_URL}/api/chats`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id, unreadCount: 1 }),
    }).catch((e) => {
      console.error("[markAsUnread] Falha ao atualizar unreadCount no servidor:", e);
    });
  };

  const pinChat = (id: string) => {
    setConversations((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, pinned: !(c as any).pinned } : c));
      
      // Persistir no localStorage
      const pinnedKey = `pinned_chats_${currentOperatorId || "global"}`;
      const nextPinnedIds = updated.filter((c) => (c as any).pinned).map((c) => c.id);
      try {
        localStorage.setItem(pinnedKey, JSON.stringify(nextPinnedIds));
      } catch (e) {
        console.error("Erro ao salvar pinned_chats no localStorage:", e);
      }
      
      return updated;
    });
  };

  const toggleReaction = useCallback(async (conversationId: string, messageId: string, emoji: string) => {
    // 1. Atualização otimista imediata na conversa ativa
    setConversations((prev) =>
      prev.map((c) =>
        c.id !== conversationId
          ? c
          : {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id !== messageId) return m;
                const existing = m.reactions || [];
                const filtered = existing.filter((r) => r.from !== "operator");
                const nextReactions = emoji
                  ? [...filtered, { emoji, from: "operator" }]
                  : filtered;
                return { ...m, reactions: nextReactions };
              }),
            }
      )
    );

    // 2. Dispara requisição ao servidor para persistir e propagar via Meta/Baileys
    try {
      await fetch(`${BACKEND_URL}/api/whatsapp/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ conversationId, messageId, emoji }),
      });
    } catch (err) {
      console.error("[useChatState.toggleReaction] Erro ao enviar reação:", err);
    }
  }, []);

  const updateClientInfo = async (id: string, fields: Partial<Pick<Conversation, "name" | "phone" | "email" | "cnpj" | "cpf">>) => {
    // 1. Atualiza estado local imediatamente (optimistic update)
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...fields } : c))
    );

    // 2. Persiste no banco via API usando o contactId da conversa
    const conv = rawConversations.find((c) => c.id === id);
    const contactId = (conv as any)?.contactId as string | undefined;

    if (!contactId) {
      console.warn("[updateClientInfo] Sem contactId para conversa:", id);
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[updateClientInfo] Erro ao persistir:", err);
      } else {
        console.log("[updateClientInfo] Contato atualizado com sucesso:", contactId);
      }
    } catch (e) {
      console.error("[updateClientInfo] Falha na requisição:", e);
    }
  };

  const updateContactWallet = async (
    contactId: string,
    walletOperatorId: string | null,
    targetOperatorId?: string | null,
  ) => {
    // 1. Identifica a conversa ativa do contato (não finalizada) antes de alterar o estado
    const activeConversation = conversations.find(
      (c) =>
        (c.contactId === contactId || c.id === contactId) &&
        c.queue !== "finalizados"
    );

    // Determina o novo estado da fila com base no operador-alvo
    const targetOp = targetOperatorId
      ? operators.find((o) => o.id === targetOperatorId)
      : null;
    const newQueueState = targetOp ? "meus" : walletOperatorId ? "fila" : "fila";
    const logText = targetOp
      ? `Carteira transferida para ${targetOp.name}. Atendimento movido automaticamente.`
      : walletOperatorId
      ? `Cliente adicionado à carteira.`
      : `Cliente removido da carteira. Atendimento retornou para a fila.`;

    // 2. Optimistic update: carteira + conversa ativa (se existir)
    setConversations((prev) =>
      prev.map((c) => {
        const isContact = c.contactId === contactId || c.id === contactId;
        if (!isContact) return c;

        const isActive = c.queue !== "finalizados";
        if (isActive && activeConversation && c.id === activeConversation.id) {
          const systemMsg: Message = {
            id: `sys-${Date.now()}`,
            author: "Sistema",
            text: logText,
            time: new Date().toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            side: "out",
            isInternalNote: true,
          };
          return {
            ...c,
            walletOperatorId,
            operatorId: targetOperatorId !== undefined ? targetOperatorId : c.operatorId,
            queue: newQueueState,
            messages: [...c.messages, systemMsg],
          };
        }

        return { ...c, walletOperatorId };
      })
    );

    const previousActiveConvState = activeConversation ? { ...activeConversation } : null;

    // 3. Persiste carteira no banco de dados
    try {
      const res = await fetch(`${BACKEND_URL}/api/contacts/update-wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, walletOperatorId }),
      });
      if (!res.ok) {
        console.error("[updateContactWallet] Erro ao persistir no DB");
        // Rollback do estado local (ambos carteira e conversa ativa)
        setConversations((prev) =>
          prev.map((c) => {
            const isContact = c.contactId === contactId || c.id === contactId;
            if (!isContact) return c;
            if (previousActiveConvState && c.id === previousActiveConvState.id) {
              return { ...previousActiveConvState };
            }
            return { ...c, walletOperatorId: activeConversation?.walletOperatorId ?? null };
          })
        );
        return;
      }
    } catch (err) {
      console.error("[updateContactWallet] Erro na requisição:", err);
      // Rollback
      setConversations((prev) =>
        prev.map((c) => {
          const isContact = c.contactId === contactId || c.id === contactId;
          if (!isContact) return c;
          if (previousActiveConvState && c.id === previousActiveConvState.id) {
            return { ...previousActiveConvState };
          }
          return { ...c, walletOperatorId: activeConversation?.walletOperatorId ?? null };
        })
      );
      return;
    }

    // 4. Se há conversa ativa e um operador-alvo, sincroniza o atendimento via update-queue
    if (activeConversation && targetOperatorId !== undefined) {
      try {
        const res = await fetch(`${BACKEND_URL}/api/chats/update-queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            conversationId: activeConversation.id,
            queueState: newQueueState,
            operatorId: targetOperatorId,
            systemMessageText: logText,
            isTransfer: true,
            expectedVersion: activeConversation.version ?? 1,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        console.error("[updateContactWallet] Erro ao sincronizar atendimento:", err);
        // Rollback da parte da conversa
        if (previousActiveConvState) {
          setConversations((prev) =>
            prev.map((c) => (c.id === previousActiveConvState.id ? { ...previousActiveConvState } : c))
          );
        }
      }
    }
  };

  const refreshConversations = async (conversationId?: string) => {
    const params = conversationId ? `conversationId=${encodeURIComponent(conversationId)}` : "limit=100";
    const response = await fetch(`${BACKEND_URL}/api/chats?${params}`, { credentials: "include" });
    if (!response.ok) throw new Error("Não foi possível atualizar os atendimentos.");
    const freshChats = await response.json() as Conversation[];
    if (!Array.isArray(freshChats)) throw new Error("Resposta inválida ao atualizar atendimentos.");
    if (conversationId && freshChats.length === 0) throw new Error("Atendimento não encontrado.");
    setConversations((previous) => {
      const previousById = new Map(previous.map((item) => [item.id, item]));
      if (conversationId) {
        const fresh = freshChats[0];
        const current = previousById.get(conversationId);
        const updated = { ...fresh, pinned: (current as any)?.pinned || false, messages: current?.messages || fresh.messages };
        return current ? previous.map((item) => item.id === conversationId ? updated : item) : [updated, ...previous];
      }
      const aiChat = previous.find((item) => item.id === "valentina");
      const freshIds = new Set(freshChats.map((item) => item.id));
      return [
        ...(aiChat ? [aiChat] : []),
        ...freshChats.map((item) => ({
          ...item,
          pinned: (previousById.get(item.id) as any)?.pinned || false,
          messages: previousById.get(item.id)?.messages || item.messages,
        })),
        ...previous.filter((item) => item.id !== "valentina" && !freshIds.has(item.id)),
      ];
    });
  };
  refreshAssignedChatRef.current = refreshConversations;

  const createContact = async (name: string, phone: string, email: string, cnpj: string, channel: Channel) => {
    const response = await fetch(`${BACKEND_URL}/api/contacts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, email, cnpj, channel }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível criar o contato.");
    let chatReady = false;
    try {
      await refreshConversations(result.conversationId);
      chatReady = true;
    } catch (error) {
      console.warn("Contato criado, mas a lista de atendimentos não atualizou:", error);
    }
    if (chatReady) setSelectedChatId(result.conversationId);
    const queueState: QueueType = result.queueState === "fila" ? "fila" : "meus";
    return { contactId: result.contactId as string, conversationId: result.conversationId as string, chatReady, queueState };
  };

  const disconnectBaileys = async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      await fetch(`${BACKEND_URL}/api/baileys/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant }),
      });
    } catch (e) {
      console.error("Erro ao desconectar do Baileys no backend:", e);
    }

    setBaileysConfig({
      status: "disconnected",
      pairedPhone: "",
      qrCodeUrl: "",
    });
  };
  // Subscrever presença no Baileys quando o operador seleciona um chat ativo
  useEffect(() => {
    if (!selectedChatId) return;
    const currentChat = conversations.find((c) => c.id === selectedChatId);
    if (currentChat && currentChat.phone && (currentChat.channel === "whatsapp" || !currentChat.channel)) {
      fetch(`${BACKEND_URL}/api/baileys/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, jid: currentChat.phone }),
      }).catch(() => {});
    }
  }, [selectedChatId, conversations, tenant]);

  // Auto-limpar estados de "digitando" / "gravando" antigos (> 5s) caso evento 'paused' falhe
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setClientTypingStatus((prev) => {
        let changed = false;
        const updated = { ...prev };
        for (const [key, value] of Object.entries(updated)) {
          if (value && now - value.timestamp > 5000) {
            updated[key] = null;
            changed = true;
          }
        }
        return changed ? updated : prev;
      });
      setOperatorTypingStatus((prev) => {
        let changed = false;
        const updated = { ...prev };
        for (const [key, value] of Object.entries(updated)) {
          if (value && now - value.timestamp > 6000) {
            updated[key] = null;
            changed = true;
          }
        }
        return changed ? updated : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // ── Extração do processador de eventos SSE recebidos ─────────────────────
  const handleIncomingSseEvent = useCallback((data: any) => {
    try {
      if (!data) return;

      if (data.type === "status") {
        if (activeProvider === "baileys") {
          setBaileysConfig((prev) => ({
            ...prev,
            status: data.status,
            pairedPhone: data.phone ? `+${data.phone}` : prev.pairedPhone,
            qrCodeUrl: data.status === "qr_ready" ? prev.qrCodeUrl : "",
          }));

          // Ao conectar, sincroniza fotos de contatos sem avatar em background
          if (data.status === "connected") {
            const tenantId = tenantRef.current;
            fetch(`${BACKEND_URL}/api/baileys/sync-avatars`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tenantId }),
            })
              .then((r) => r.json())
              .then((result) =>
                console.log(`[sync-avatars] ${result.updated} fotos sincronizadas, ${result.failed} sem foto`)
              )
              .catch(() => {});
          }
        } else if (activeProvider === "meta") {
          setMetaConfig((prev) => ({
            ...prev,
            status: data.status === "connected" ? "connected" : "disconnected",
          }));
        }
      } else if (data.type === "channel_switched" && data.provider) {
        console.log(`[SSE] Provedor alternado via servidor para '${data.provider}'`);
        setActiveProvider(data.provider);
        updateDocumentTitle(tenantRef.current, data.provider);
      } else if (data.type === "qr" && activeProvider === "baileys") {
        QRCode.toDataURL(data.qr, { width: 250, margin: 1, errorCorrectionLevel: "M" })
          .then((qrUrl) => {
            setBaileysConfig((prev) => ({
              ...prev,
              status: "qr_ready",
              qrCodeUrl: qrUrl,
            }));
          })
          .catch((err) => {
            console.error("[QRCode] Erro ao gerar QR Code local:", err);
          });
      } else if (data.type === "error" && activeProvider === "baileys") {
        const message = data.message || "Falha ao iniciar a conexão WhatsApp.";
        console.error("[Baileys]", message);
        toast.error(message);
        setBaileysConfig((prev) => ({ ...prev, status: "disconnected", qrCodeUrl: "" }));
      } else if (data.type === "contact_avatar") {
        setConversations((prev) =>
          prev.map((c) => {
            const matchById = data.contactId && c.id.includes(data.contactId);
            const matchByPhone = c.phone && data.phone &&
              c.phone.replace(/\D/g, "").endsWith(data.phone.replace(/\D/g, "").slice(-8));
            return matchById || matchByPhone
              ? { ...c, avatar: data.avatar }
              : c;
          })
        );
      } else if (data.type === "chat_updated" && data.chat) {
        const updatedChat = data.chat;
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id === updatedChat.id) {
              return {
                ...c,
                queue: updatedChat.queue || c.queue,
                operatorId: updatedChat.operatorId !== undefined ? updatedChat.operatorId : c.operatorId,
                walletOperatorId: updatedChat.walletOperatorId !== undefined ? updatedChat.walletOperatorId : c.walletOperatorId,
                responsibleName: updatedChat.responsibleName || c.responsibleName,
              };
            }
            return c;
          })
        );
      } else if (data.type === "presence_update" && data.id) {
        const presenceId = data.id;
        let lastState: string | undefined;

        if (data.presences) {
          const pObj = data.presences[presenceId] || Object.values(data.presences)[0];
          if (pObj && typeof pObj === "object") {
            lastState = (pObj as any).lastKnownPresence || (pObj as any).presence || (pObj as any).state;
          }
        }

        setClientTypingStatus((prev) => {
          const cleanPresence = presenceId.replace(/\D/g, "");
          const targetConv = conversationsRef.current.find((c) => {
            if (!c.phone) return false;
            const cleanPhone = c.phone.replace(/\D/g, "");
            if (!cleanPresence || !cleanPhone) return false;
            const last8Presence = cleanPresence.slice(-8);
            const last8Phone = cleanPhone.slice(-8);
            return last8Presence === last8Phone || c.id === presenceId;
          });

          if (targetConv) {
            if (lastState === "composing" || lastState === "recording") {
              return { ...prev, [targetConv.id]: { status: lastState as "composing" | "recording", timestamp: Date.now() } };
            } else {
              return { ...prev, [targetConv.id]: null };
            }
          }
          return prev;
        });
      } else if (data.type === "contact_updated" && data.contact) {
        fetch(`${BACKEND_URL}/api/chats`, { credentials: "include" })
          .then((res) => res.json())
          .then((freshChats) => {
            if (Array.isArray(freshChats)) {
              setConversations((prev) => {
                const map = new Map(freshChats.map((item: any) => [item.id, item]));
                return prev.map((c) => {
                  const fresh = map.get(c.id);
                  return fresh ? { ...c, ...fresh, messages: c.messages } : c;
                });
              });
            }
          })
          .catch(() => {});
      } else if (data.type === "message") {
        const { message } = data;

        if (message?.conversationId) {
          setClientTypingStatus((prev) => ({ ...prev, [message.conversationId]: null }));
          if (message.senderType !== "client") {
            setOperatorTypingStatus((prev) => (prev[message.conversationId] ? { ...prev, [message.conversationId]: null } : prev));
          }
        }

        const currentOperatorId = currentOperatorIdRef.current;
        const selectedChatId = selectedChatIdRef.current;
        const currentConvs = conversationsRef.current;

        const existingConv = currentConvs.find((c) => c.id === message.conversationId);
        const operatorId = message.operatorId !== undefined
          ? message.operatorId
          : (existingConv ? existingConv.operatorId : null);

        const queueState = message.queue !== undefined
          ? message.queue
          : (existingConv ? existingConv.queue : null);

        const walletOperatorId = message.walletOperatorId !== undefined
          ? message.walletOperatorId
          : (existingConv ? existingConv.walletOperatorId : null);

        const isAssignedToMe = !!currentOperatorId && operatorId === currentOperatorId;
        const isInMyWallet = !!currentOperatorId && walletOperatorId === currentOperatorId;

        const isCapturedAndWithMe = isAssignedToMe && queueState === "meus";
        const isFinalizedInMyWallet = isInMyWallet && queueState === "finalizados";

        const shouldNotify = isCapturedAndWithMe || isFinalizedInMyWallet;
        const isCurrentOpen = message.conversationId === selectedChatId;

        if (shouldNotify && message.senderType === "client" && !isCurrentOpen) {
          const clientName = existingConv?.name || message.senderName || "Cliente";
          const clientAvatar = existingConv?.avatar || message.avatar || "";
          const initials = clientName
            .split(" ")
            .map((w: string) => w[0])
            .join("")
            .toUpperCase()
            .substring(0, 2) || "C";

          let previewText = message.content || "";
          if (previewText.startsWith("[LOCAL_MEDIA:") || previewText.startsWith("[MEDIA:")) {
            if (previewText.includes("image")) previewText = "Imagem";
            else if (previewText.includes("video")) previewText = "Vídeo";
            else if (previewText.includes("audio")) previewText = "Áudio";
            else if (previewText.includes("sticker")) previewText = "Figurinha";
            else if (previewText.includes("document")) {
              const parts = previewText.split(":");
              const rawName = parts[parts.length - 1] || "";
              previewText = rawName.split("]")[0] || "Documento";
            }
          }

          const isTecfag = tenantRef.current === "tecfag";
          const primaryColor = isTecfag ? "#df3d3d" : "#2dc4a0";
          const primarySoftBg = isTecfag ? "#fde8e8" : "#d8f1ea";

          toast.custom(
            (t) => (
              <div 
                className="flex items-center gap-3 w-[340px] bg-card border border-border rounded-2xl p-3 shadow-lg animate-in slide-in-from-bottom-5 duration-200 border-l-4"
                style={{ borderLeftColor: primaryColor }}
              >
                <div className="relative shrink-0">
                  {clientAvatar ? (
                    <img
                      src={clientAvatar}
                      alt={clientName}
                      className="h-10 w-10 rounded-full object-cover border border-border"
                    />
                  ) : (
                    <div 
                      className="grid h-10 w-10 place-items-center rounded-full text-xs font-bold border"
                      style={{
                        backgroundColor: primarySoftBg,
                        borderColor: `${primaryColor}20`,
                        color: primaryColor
                      }}
                    >
                      {initials}
                    </div>
                  )}
                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border border-card" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground truncate">{clientName}</p>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{previewText}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => {
                      setSelectedChatId(message.conversationId);
                      setActiveView("chat");
                      markAsRead(message.conversationId);
                      toast.dismiss(t);
                    }}
                    className="px-2.5 py-1.5 rounded-lg text-white text-[10px] font-bold transition duration-155 cursor-pointer shadow-sm hover:opacity-90"
                    style={{ backgroundColor: primaryColor }}
                  >
                    Abrir
                  </button>
                  <button
                    onClick={() => toast.dismiss(t)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ),
            { duration: 6000, position: "bottom-right" }
          );
        }
        
        setConversations((prev) => {
          const exists = prev.some((c) => c.id === message.conversationId);
          const timeStr = new Date(message.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          const incomingMsg: Message = {
            id: message.id,
            author: message.senderName,
            text: message.content ?? "",
            time: timeStr,
            side: message.senderType === "client" ? "in" : "out",
            isInternalNote: !!message.isInternalNote,
            senderType: message.senderType,
            quotedMessageId: message.quotedMessageId || null,
            quotedMessageSender: message.quotedMessageSender || null,
            quotedMessageContent: message.quotedMessageContent || null,
          };

          if (exists) {
            return prev.map((c) => {
              if (c.id === message.conversationId) {
                if (!incomingMsg.quotedMessageContent && incomingMsg.quotedMessageId) {
                  const quoted = c.messages.find((m) => m.id === incomingMsg.quotedMessageId || (m as any).externalId === incomingMsg.quotedMessageId);
                  if (quoted) {
                    incomingMsg.quotedMessageContent = quoted.text;
                    incomingMsg.quotedMessageSender = quoted.author || (quoted.side === "out" ? "Você" : c.name);
                  }
                }

                const isCurrentOpen = message.conversationId === selectedChatId;
                const newUnread = message.senderType === "client"
                  ? (isCurrentOpen ? 0 : c.unreadCount + 1)
                  : c.unreadCount;

                if (isCurrentOpen && message.senderType === "client") {
                  fetch(`${BACKEND_URL}/api/chats`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ conversationId: c.id, unreadCount: 0 }),
                  }).catch((e) => console.error("Erro ao marcar como lido via SSE:", e));
                }

                return {
                  ...c,
                  lastMessageTime: timeStr,
                  unreadCount: newUnread,
                  messages: c.messages.some((m) => m.id === incomingMsg.id)
                    ? c.messages
                    : [...c.messages, incomingMsg],
                  phone: message.phone || c.phone,
                  avatar: message.avatar || c.avatar,
                  queue: message.queue || c.queue,
                  operatorId: message.operatorId !== undefined ? message.operatorId : c.operatorId,
                  walletOperatorId: message.walletOperatorId !== undefined ? message.walletOperatorId : c.walletOperatorId,
                };
              }
              return c;
            });
          } else {
            const initials = String(message.senderName || "Contato")
              .split(" ")
              .map((w: string) => w[0])
              .join("")
              .toUpperCase()
              .substring(0, 2);
            const initialsBg = "#a6d6f2";
            
            const isCurrentOpen = message.conversationId === selectedChatId;
            const newUnread = isCurrentOpen ? 0 : 1;

            if (isCurrentOpen && message.senderType === "client") {
              fetch(`${BACKEND_URL}/api/chats`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: message.conversationId, unreadCount: 0 }),
              }).catch((e) => console.error("Erro ao marcar como lido via SSE para nova conversa:", e));
            }

            const pinnedKey = `pinned_chats_${currentOperatorId || "global"}`;
            let pinnedIds: string[] = [];
            try {
              const stored = localStorage.getItem(pinnedKey);
              if (stored) pinnedIds = JSON.parse(stored);
            } catch (e) {}
            const isPinned = pinnedIds.includes(message.conversationId);

            const newConv: Conversation = {
              id: message.conversationId,
              name: message.senderName || message.phone || "Contato",
              avatar: message.avatar || "",
              initials,
              initialsBg,
              phone: message.phone || "",
              tags: ["WhatsApp Inbound"],
              channel: "whatsapp",
              queue: message.queue || "fila",
              operatorId: message.operatorId || null,
              walletOperatorId: message.walletOperatorId || null,
              unreadCount: newUnread,
              lastMessageTime: timeStr,
              messages: [incomingMsg],
              pinned: isPinned,
            } as any;
            return [newConv, ...prev];
          }
        });
      } else if (data.type === "message_reaction") {
        const { conversationId, messageId, reactions } = data;
        setConversations((prev) =>
          prev.map((c) =>
            c.id !== conversationId
              ? c
              : {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, reactions: Array.isArray(reactions) ? reactions : [] } : m
                  ),
                }
          )
        );
      } else if (data.type === "message_status" && data.messageId && data.status) {
        // Guarda mesmo se a mensagem ainda não estiver na tela: o webhook "delivered" pode
        // chegar antes da resposta do POST /send que adiciona o balão.
        const { conversationId, messageId, status, error } = data;
        setMessageStatusOverrides((prev) => ({ ...prev, [messageId]: { status, error: error || null } }));
        setConversations((prev) =>
          prev.map((c) =>
            c.id !== conversationId
              ? c
              : { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, status, errorMessage: error || null } : m)) }
          )
        );
      } else if (data.type === "operator_typing" && data.conversationId) {
        if (data.operatorId && data.operatorId === currentOperatorIdRef.current) return;
        setOperatorTypingStatus((prev) => ({
          ...prev,
          [data.conversationId]: {
            operatorId: data.operatorId,
            operatorName: data.operatorName || "Operador",
            timestamp: Date.now(),
          },
        }));
      } else if (data.type === "queue_update") {
        const { conversationId, queueState, operatorId: newOperatorId, sectorId: newSectorId, responsibleName, version } = data;

        if (queueState === "meus" && newOperatorId === currentOperatorIdRef.current &&
            !conversationsRef.current.some((chat) => chat.id === conversationId)) {
          void refreshAssignedChatRef.current(conversationId).catch((error) =>
            console.warn("Falha ao carregar atendimento recebido:", error)
          );
        }

        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== conversationId) return c;
            return {
              ...c,
              queue: queueState,
              operatorId: newOperatorId !== undefined ? newOperatorId : c.operatorId,
              sectorId: newSectorId !== undefined ? newSectorId : (c as any).sectorId,
              responsibleName: responsibleName !== undefined ? responsibleName : c.responsibleName,
              version: version !== undefined ? version : (c.version ? c.version + 1 : 1),
            };
          })
        );

        // Quem estava lendo a conversa continua vendo o histórico. O composer
        // muda para somente leitura quando o operador responsável muda.
      }
    } catch (err) {
      console.error("Erro ao processar dados recebidos do SSE:", err);
    }
  }, [activeProvider, markAsRead, setActiveView, setConversations, setSelectedChatId]);

  // ── Conexão SSE Universal (/api/events) com reconexão exponencial ──────────
  const universalSseRef = useRef<EventSource | null>(null);
  const sseRetryCountRef = useRef<number>(0);
  const sseRetryTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Mantém referência estável do handler para evitar que re-renders do componente reconectem o SSE
  const handleIncomingSseEventRef = useRef(handleIncomingSseEvent);
  useEffect(() => {
    handleIncomingSseEventRef.current = handleIncomingSseEvent;
  }, [handleIncomingSseEvent]);

  useEffect(() => {
    if (!isAuthenticated) {
      if (universalSseRef.current) {
        universalSseRef.current.close();
        universalSseRef.current = null;
      }
      if (sseRetryTimerRef.current) {
        clearTimeout(sseRetryTimerRef.current);
        sseRetryTimerRef.current = null;
      }
      sseRetryCountRef.current = 0;
      return;
    }

    let isCurrentMount = true;

    const connectUniversal = () => {
      if (!isCurrentMount) return;
      if (universalSseRef.current) {
        universalSseRef.current.close();
        universalSseRef.current = null;
      }

      const url = `${BACKEND_URL}/api/events`;
      const es = new EventSource(url, { withCredentials: true });
      universalSseRef.current = es;

      es.onopen = () => {
        console.log("[SSE Universal] Conectado ao stream /api/events");
        const wasReconnecting = sseRetryCountRef.current > 0;
        sseRetryCountRef.current = 0;

        // Na reconexão, reconcilia conversas para garantir que nenhuma mensagem foi perdida
        if (wasReconnecting) {
          fetch(`${BACKEND_URL}/api/chats`, { credentials: "include" })
            .then((r) => r.json())
            .then((freshChats) => {
              if (Array.isArray(freshChats)) {
                setConversations((prev) => {
                  const map = new Map(freshChats.map((c: any) => [c.id, c]));
                  return prev.map((c) => {
                    const f = map.get(c.id);
                    return f ? { ...c, ...f, messages: c.messages } : c;
                  });
                });
              }
            })
            .catch(() => {});
        }
      };

      es.onmessage = (event) => {
        try {
          if (!event.data || event.data.trim() === "" || event.data.trim() === ": ping") return;
          const data = JSON.parse(event.data);
          handleIncomingSseEventRef.current(data);
        } catch (e) {
          console.error("[SSE Universal] Erro ao analisar evento recebido:", e);
        }
      };

      es.onerror = (err) => {
        console.warn(`[SSE Universal] Queda no stream /api/events (tentativa ${sseRetryCountRef.current + 1}):`, err);
        es.close();
        universalSseRef.current = null;

        // Backoff exponencial: 1s, 2s, 4s, 8s, 16s, máx 30s
        const delay = Math.min(1000 * Math.pow(2, sseRetryCountRef.current), 30000);
        sseRetryCountRef.current += 1;

        if (sseRetryTimerRef.current) clearTimeout(sseRetryTimerRef.current);
        sseRetryTimerRef.current = setTimeout(() => {
          if (isCurrentMount) {
            connectUniversal();
          }
        }, delay);
      };
    };

    connectUniversal();

    return () => {
      isCurrentMount = false;
      if (universalSseRef.current) {
        universalSseRef.current.close();
        universalSseRef.current = null;
      }
      if (sseRetryTimerRef.current) {
        clearTimeout(sseRetryTimerRef.current);
        sseRetryTimerRef.current = null;
      }
    };
  }, [isAuthenticated, setConversations]);

  // ── Conexão Baileys (habilitada apenas quando activeProvider === 'baileys') ─
  const connectBaileys = (forceNew: boolean = false) => {
    if (activeProvider === "meta") {
      console.info("[Baileys] Bloqueado: Provedor ativo é 'meta'. O chat opera via SSE universal.");
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setBaileysConfig((prev) => ({
      ...prev,
      status: "connecting",
      qrCodeUrl: "",
    }));

    const targetTenant = tenant || "valem";
    const url = `${BACKEND_URL}/api/baileys/connect?tenantId=${targetTenant}${forceNew ? "&force=true" : ""}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleIncomingSseEvent(data);
      } catch (err) {
        console.error("[Baileys SSE] Erro ao processar dados recebidos:", err);
      }
    };

    let sseErrorCount = 0;
    eventSource.onerror = (err) => {
      sseErrorCount++;
      console.warn(`[Baileys SSE] Queda na conexão Baileys (tentativa ${sseErrorCount}).`, err);

      if (sseErrorCount === 3) {
        setBaileysConfig((prev) => ({
          ...prev,
          status: "disconnected",
        }));
      }
    };

    eventSource.onopen = () => {
      if (sseErrorCount > 0) {
        console.log("[Baileys SSE] Conexão Baileys restaurada.");
        sseErrorCount = 0;
      }
    };
  };

  // Buscar status inicial do Baileys apenas quando activeProvider === 'baileys'
  useEffect(() => {
    if (!isAuthenticated) return;

    if (activeProvider === "baileys") {
      connectBaileys();

      const targetTenant = tenant || "valem";
      fetch(`${BACKEND_URL}/api/baileys/status?tenantId=${targetTenant}`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => {
          if (data && data.status) {
            setBaileysConfig((prev) => ({
              ...prev,
              status: data.status,
              pairedPhone: data.pairedPhone ? `+${data.pairedPhone}` : data.pairedPhone || "",
            }));
          }
        })
        .catch((err) => console.error("Erro ao verificar status do Baileys:", err));
    } else {
      // Se estiver em modo Meta, fecha qualquer conexão Baileys remanescente
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setBaileysConfig({
        status: "disconnected",
        pairedPhone: "",
        qrCodeUrl: "",
      });
    }
  }, [tenant, isAuthenticated, activeProvider]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const login = async (
    tenantOrEmail: "tecfag" | "valem" | string,
    emailOrPass: string,
    maybePass?: string
  ): Promise<boolean> => {
    let targetTenant: "tecfag" | "valem";
    let targetEmail: string;
    let targetPassword: string;

    if (maybePass !== undefined) {
      targetTenant = (tenantOrEmail === "valem" ? "valem" : "tecfag");
      targetEmail = emailOrPass.trim();
      targetPassword = maybePass;
    } else {
      targetEmail = tenantOrEmail.trim();
      targetPassword = emailOrPass;
      targetTenant = targetEmail.toLowerCase().includes("valem") ? "valem" : "tecfag";
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          tenantId: targetTenant,
          email: targetEmail,
          password: targetPassword,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.operator) {
          const matchedOp = data.operator;
          setAvailableTenants(Array.isArray(data.availableTenants) ? data.availableTenants : [matchedOp.tenantId]);

          // Atualizar estado de operadores incluindo o operador logado sanitizado
          setOperators((prev) => {
            const exists = prev.some((o) => o.id === matchedOp.id);
            return exists ? prev.map((o) => (o.id === matchedOp.id ? matchedOp : o)) : [...prev, matchedOp];
          });

          setCurrentOperatorId(matchedOp.id);
          setSessionRole(matchedOp.role || null);
          setSessionPermissions(null);

          if (matchedOp.tenantId) {
            setTenantState(matchedOp.tenantId);
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem("chat_tenant", matchedOp.tenantId);
                localStorage.setItem("rbac_current_operator_id", matchedOp.id);
                // Remove rbac_operators que podia conter hashes de senha legadas
                localStorage.removeItem("rbac_operators");
              } catch (e) {}
            }
            updateDocumentTitle(matchedOp.tenantId, activeProvider);

            // Buscar operadores atualizados e sanitizados do tenant autenticado — sem ?tenantId=
            fetch(`${BACKEND_URL}/api/operators`, {
              credentials: "include",
            })
              .then((res) => res.json())
              .then((opList) => {
                if (Array.isArray(opList) && opList.length > 0) {
                  setOperators(opList); // servidor retorna sanitizado (sem passwordHash)
                }
              })
              .catch((err) => console.error("Erro ao sincronizar operadores pós-login:", err));

            // Sincronizar o activeProvider configurado para o canal
            fetch(`${BACKEND_URL}/api/settings/whatsapp`, { credentials: "include" })
              .then((res) => res.json())
              .then((cfgData) => {
                if (cfgData?.activeProvider) {
                  setActiveProvider(cfgData.activeProvider);
                  updateDocumentTitle(matchedOp.tenantId, cfgData.activeProvider);
                }
              })
              .catch(() => {});
          }

          const sessionResponse = await fetch(`${BACKEND_URL}/api/auth/session`, { credentials: "include" });
          if (!sessionResponse.ok) throw new Error("Não foi possível confirmar as permissões da sessão.");
          const confirmedSession = await sessionResponse.json();
          setCurrentOperatorId(confirmedSession.operator.id);
          setSessionRole(confirmedSession.operator.role || null);
          setSessionPermissions(confirmedSession.permissions || null);
          setIsAuthenticated(true);
          return true;
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        console.warn("[Login] Falha de autenticação:", errData.error || response.statusText);
      }
    } catch (err) {
      console.error("[Login] Erro ao conectar ao serviço de autenticação:", err);
    }

    return false;
  };

  const logout = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (e) {
      console.error("Erro ao efetuar logout no servidor:", e);
    } finally {
      setIsAuthenticated(false);
      setSessionPermissions(null);
      setSessionRole(null);
      setTenantState(null);
      setAvailableTenants([]);
      setCurrentOperatorId("");
      setSelectedChatId(null);
      if (universalSseRef.current) {
        universalSseRef.current.close();
        universalSseRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("chat_tenant");
          localStorage.removeItem("chat_is_authenticated");
          localStorage.removeItem("rbac_current_operator_id");
          localStorage.removeItem("rbac_operators");
        } catch (e) {
          console.error("Erro ao limpar dados de autenticação:", e);
        }
      }
    }
  };

  return (
    <ChatContext.Provider
      value={{
        tenant: (tenant || "valem") as "tecfag" | "valem",
        setTenant,
        availableTenants,
        activeQueue,
        setActiveQueue,
        selectedChatId,
        setSelectedChatId,
        conversations,
        activeChat,
        searchQuery,
        setSearchQuery,
        channelFilter,
        setChannelFilter,
        activeView,
        setActiveView,
        rightSidebarOpen,
        setRightSidebarOpen,
        operatorProfile,
        updateOperatorProfile,
        isProfileModalOpen,
        setIsProfileModalOpen,

        operators: operators.filter((op) => op.tenantId === tenant),
        accessGroups: accessGroups.filter((g) => g.tenantId === tenant),
        sectors: sectors.filter((s) => s.tenantId === tenant),
        currentOperatorId,
        currentGroup,
        sessionPermissions,
        sessionRole,
        impersonateOperator,
        createOperator,
        updateOperator,
        deleteOperator,
        resetOperatorPassword,
        createAccessGroup,
        updateAccessGroup,
        deleteAccessGroup,
        createSector,
        updateSector,
        deleteSector,
        
        quickResponses: quickResponses.filter((qr) => qr.tenantId === tenant),
        createQuickResponse,
        updateQuickResponse,
        deleteQuickResponse,
        
        templates: templates.filter((tpl) => tpl.tenantId === tenant),
        createTemplate,
        updateTemplate,
        deleteTemplate,
        
        sendMessage,
        captureChat,
        transferChat,
        finishChat,
        logSystemEvent,
        updateTags,
        updateClientInfo,
        updateContactWallet,
        createContact,
        refreshConversations,
        markAsRead,
        markAsUnread,
        pinChat,
        toggleReaction,
        
        metaConfig,
        setMetaConfig,
        baileysConfig,
        setBaileysConfig,
        activeProvider,
        setActiveProvider,
        clientTypingStatus,
        messageStatusOverrides,
        operatorTypingStatus,
        isValentinaTyping,
        disconnectBaileys,
        connectBaileys,

        isAuthenticated,
        login,
        logout,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};
