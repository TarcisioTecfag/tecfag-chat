import React, { createContext, useContext, useState, useEffect, useRef } from "react";
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
import { ensureValentinaOperator, getDaysWithoutContact } from "@/lib/utils";

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
  allowedChannels: ("whatsapp" | "instagram" | "messenger")[];
  // Administração do painel
  canCreateUser: boolean;
  canResetPassword: boolean;
  canEditProfile: boolean;
  // ── Permissões de Atendimento (RBAC) ──────────────────────────────────────
  canCaptureChat: boolean;   // Pode puxar chats da fila para si
  canTransferChat: boolean;  // Pode transferir chats para outro operador
  canFinishChat: boolean;    // Pode encerrar conversas
  canViewAllChats: boolean;  // Vê chats de todos os operadores (somente leitura)
  canOverrideChat: boolean;  // Pode assumir chat de outro operador sem transferência prévia
  tenantId?: "tecfag" | "valem";
};

export type Operator = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: "disponivel" | "pausa" | "desconectado";
  passwordHash: string;
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
  activeView: "chat" | "contacts" | "wallet" | "settings" | "groups" | "monitor" | "analytics" | "tasks" | "valentina" | "ligacoes";
  setActiveView: (view: "chat" | "contacts" | "wallet" | "settings" | "groups" | "monitor" | "analytics" | "tasks" | "valentina" | "ligacoes") => void;
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
  sendMessage: (text: string, isInternalNote?: boolean, attachments?: File[], quotedMessage?: { id: string; sender: string; content: string } | null) => Promise<void>;
  captureChat: (id: string) => void;
  transferChat: (id: string, sectorName: string, targetOperatorId?: string | null) => void;
  finishChat: (id: string) => void;
  logSystemEvent: (chatId: string, eventText: string) => Promise<void>;
  updateTags: (id: string, tags: string[]) => void;
  updateClientInfo: (id: string, fields: Partial<Pick<Conversation, "name" | "phone" | "email" | "cnpj" | "cpf">>) => void;
  updateContactWallet: (contactId: string, walletOperatorId: string | null, targetOperatorId?: string | null) => Promise<void>;
  createContact: (name: string, phone: string, email: string, cnpj: string, channel: Channel) => string;
  markAsRead: (id: string) => void;
  markAsUnread: (id: string) => void;
  pinChat: (id: string) => void;
  
  // Configurations
  metaConfig: MetaConfig;
  setMetaConfig: React.Dispatch<React.SetStateAction<MetaConfig>>;
  baileysConfig: BaileysConfig;
  setBaileysConfig: React.Dispatch<React.SetStateAction<BaileysConfig>>;
  clientTypingStatus: Record<string, { status: "composing" | "recording"; timestamp: number } | null>;
  isValentinaTyping: boolean;
  disconnectBaileys: () => void;
  connectBaileys: (forceNew?: boolean) => void;
 
  // Authentication
  isAuthenticated: boolean;
  login: (email: string, passwordHash: string) => Promise<boolean>;
  logout: () => void;
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Tenant ativo. Fallback para 'valem' (tenant em produção) enquanto o localStorage ainda não foi lido.
  // O useEffect abaixo substitui o valor correto do localStorage logo na montagem.
  const [tenant, setTenantState] = useState<"tecfag" | "valem">("valem");
  const [activeQueue, setActiveQueue] = useState<QueueType>("meus");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [activeView, setActiveView] = useState<"chat" | "contacts" | "wallet" | "settings" | "groups" | "monitor" | "analytics" | "tasks" | "valentina" | "ligacoes">("chat");

  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);

  // Status de presença (digitando / gravando áudio) do cliente por conversa
  const [clientTypingStatus, setClientTypingStatus] = useState<Record<string, { status: "composing" | "recording"; timestamp: number } | null>>({});
  const [isValentinaTyping, setIsValentinaTyping] = useState(false);
  // Ref para controle de cancelamento da resposta da Valentina
  // Cada nova mensagem incrementa a geração e aborta o fetch anterior
  const valentinaPendingRef = useRef<{ controller: AbortController; generation: number } | null>(null);
  const valentinaGenerationRef = useRef(0);

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [accessGroups, setAccessGroups] = useState<AccessGroup[]>([]);
  const [quickResponses, setQuickResponses] = useState<QuickResponse[]>([]);
  const [templates, setTemplates] = useState<OperatorTemplate[]>([]);

  const [operators, setOperators] = useState<Operator[]>([
    {
      id: "op-valentina",
      name: "Valentina (I.A)",
      email: "valentina@valem.ai",
      avatar: "/valentina.png",
      status: "disponivel",
      passwordHash: "valentina_ai_hash",
      groupId: "group-valem-comercial",
      tenantId: "valem",
    },
    {
      id: "op-1",
      name: "Fagner F. (Admin)",
      email: "fagner@tecfag.com.br",
      avatar: "https://i.pravatar.cc/80?img=12",
      status: "disponivel",
      passwordHash: "123456",
      groupId: "group-admin",
    },
    {
      id: "op-2",
      name: "Tarcísio (Valem)",
      email: "tarcisio@valem.com.br",
      avatar: "https://i.pravatar.cc/80?img=60",
      status: "disponivel",
      passwordHash: "123456",
      groupId: "group-valem-comercial",
    },
    {
      id: "op-3",
      name: "Pedro (Tecfag)",
      email: "pedro@tecfag.com.br",
      avatar: "https://i.pravatar.cc/80?img=33",
      status: "disponivel",
      passwordHash: "123456",
      groupId: "group-tecfag-vendedor",
    },
    {
      id: "op-4",
      name: "Julia (Whats Only)",
      email: "julia@valem.com.br",
      avatar: "https://i.pravatar.cc/80?img=47",
      status: "disponivel",
      passwordHash: "123456",
      groupId: "group-whats-only",
    },
  ]);

  const [currentOperatorId, setCurrentOperatorId] = useState<string>("op-1");

  // Refs to avoid stale closures in SSE event listener
  const selectedChatIdRef = useRef(selectedChatId);
  const currentOperatorIdRef = useRef(currentOperatorId);
  const tenantRef = useRef(tenant);
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
  const [isClient, setIsClient] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  // Restaurar dados do localStorage após a montagem do componente no cliente (evita Hydration Mismatch)
  useEffect(() => {
    setIsClient(true);
    if (typeof window !== "undefined") {
      const savedAuth = localStorage.getItem("chat_is_authenticated");
      if (savedAuth === "true") {
        setIsAuthenticated(true);
      }

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

      const savedOperators = localStorage.getItem("rbac_operators");
      if (savedOperators) {
        try {
          setOperators(ensureValentinaOperator(JSON.parse(savedOperators)));
        } catch (e) {}
      }

      // Sincronizar operadores do banco — sempre com tenantId para evitar vazamento entre tenants.
      // Lê o tenant salvo no localStorage (ou usa 'valem' como fallback do tenant ativo).
      const tenantForFetch = (savedTenant === "valem" || savedTenant === "tecfag")
        ? savedTenant
        : "valem";
      fetch(`${BACKEND_URL}/api/operators?tenantId=${tenantForFetch}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            const listWithValentina = ensureValentinaOperator(data);
            setOperators(listWithValentina);
            try {
              localStorage.setItem("rbac_operators", JSON.stringify(listWithValentina));
            } catch (e) {}
          }
        })
        .catch((err) => console.error("Erro ao sincronizar operadores do banco:", err));

      const savedOpId = localStorage.getItem("rbac_current_operator_id");
      if (savedOpId) {
        setCurrentOperatorId(savedOpId);
      }
    }
  }, []);

  // Sincronizar grupos, setores, respostas rápidas e operadores do banco de dados quando o tenant mudar
  useEffect(() => {
    if (typeof window !== "undefined") {
      fetch(`${BACKEND_URL}/api/operators?tenantId=${tenant}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            const listWithValentina = ensureValentinaOperator(data);
            setOperators(listWithValentina);
            try {
              localStorage.setItem("rbac_operators", JSON.stringify(listWithValentina));
            } catch (e) {}
          }
        })
        .catch((err) => console.error("Erro ao sincronizar operadores do banco:", err));

      fetch(`${BACKEND_URL}/api/groups?tenantId=${tenant}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setAccessGroups(data);
          }
        })
        .catch((err) => console.error("Erro ao sincronizar grupos do banco:", err));

      fetch(`${BACKEND_URL}/api/sectors?tenantId=${tenant}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setSectors(data);
          }
        })
        .catch((err) => console.error("Erro ao sincronizar setores do banco:", err));

      fetch(`${BACKEND_URL}/api/quick-responses?tenantId=${tenant}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setQuickResponses(data);
          }
        })
        .catch((err) => console.error("Erro ao sincronizar respostas rápidas do banco:", err));
    }
  }, [tenant]);

  // Sincronizar templates individuais do operador quando o tenant ou o operador ativo mudar
  useEffect(() => {
    if (typeof window !== "undefined" && currentOperatorId) {
      fetch(`${BACKEND_URL}/api/templates?tenantId=${tenant}&operatorId=${currentOperatorId}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setTemplates(data);
          }
        })
        .catch((err) => console.error("Erro ao sincronizar templates do banco:", err));
    }
  }, [tenant, currentOperatorId]);

  // Garantir que currentOperatorId seja sempre um operador válido na lista do tenant.
  // Se o operador ativo salvo em localStorage não existir no tenant atual,
  // faz o fallback automático para o primeiro operador válido (ex: Fagner) em vez de travar em "Carregando...".
  useEffect(() => {
    if (operators.length > 0) {
      const exists = operators.some((op) => op.id === currentOperatorId);
      if (!exists) {
        console.warn(`[useChatState] Operador ativo '${currentOperatorId}' não encontrado no tenant '${tenant}'. Ajustando para '${operators[0].id}' (${operators[0].name}).`);
        setCurrentOperatorId(operators[0].id);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem("rbac_current_operator_id", operators[0].id);
          } catch (e) {}
        }
      }
    }
  }, [operators, currentOperatorId, tenant]);

  // Persistir alterações apenas após o cliente estar pronto
  useEffect(() => {
    if (isClient && typeof window !== "undefined") {
      try {
        localStorage.setItem("rbac_operators", JSON.stringify(operators));
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

  // Verificação periódica de inatividade de carteira (60 dias -> transferência para Valentina)
  useEffect(() => {
    if (typeof window === "undefined" || tenant !== "valem") return;
    const runInactivityCheck = () => {
      fetch(`${BACKEND_URL}/api/contacts/check-inactivity?tenantId=${tenant}`, { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data?.transferredCount > 0) {
            console.log(`[Carteira] ${data.transferredCount} cliente(s) inativo(s) transferidos para Valentina.`);
          }
        })
        .catch(() => {});
    };
    runInactivityCheck();
    const interval = setInterval(runInactivityCheck, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [tenant]);

  const defaultAdminGroup: AccessGroup = {
    id: "group-admin",
    name: "Administradores",
    allowedTenants: ["tecfag", "valem"],
    allowedChannels: ["whatsapp", "instagram", "messenger"],
    canCreateUser: true,
    canResetPassword: true,
    canEditProfile: true,
    canCaptureChat: true,
    canTransferChat: true,
    canFinishChat: true,
    canViewAllChats: true,
    canOverrideChat: true,
  };

  const defaultOperator: Operator = {
    id: "op-1",
    name: "Operador",
    email: "",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&fit=crop",
    status: "disponivel",
    passwordHash: "123456",
    groupId: "group-admin",
  };

  const currentOperator = operators.find((op) => op.id === currentOperatorId)
    || (operators.length > 0 ? operators[0] : defaultOperator);

  const currentGroup = accessGroups.find((g) => g.id === currentOperator.groupId) || defaultAdminGroup;

  const operatorProfile: OperatorProfile = {
    name: currentOperator.name,
    email: currentOperator.email,
    avatar: currentOperator.avatar,
    status: currentOperator.status,
  };

  const updateOperatorProfile = async (fields: Partial<OperatorProfile>) => {
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

    const targetOp = operators.find((op) => op.id === currentOperatorId);
    if (targetOp) {
      try {
        await fetch(`${BACKEND_URL}/api/operators`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentOperatorId,
            tenantId: (targetOp as any).tenantId || tenant,
            name: fields.name ?? targetOp.name,
            email: fields.email ?? targetOp.email,
            avatar: fields.avatar ?? targetOp.avatar,
            status: fields.status ?? targetOp.status,
            passwordHash: targetOp.passwordHash,
            role: (targetOp as any).role,
            groupId: targetOp.groupId,
          }),
        });
      } catch (err) {
        console.error("Erro ao sincronizar atualização de perfil de operador no DB:", err);
      }
    }
  };

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Impersonation
  const impersonateOperator = (id: string) => {
    const targetOp = operators.find((op) => op.id === id);
    if (!targetOp) return;
    setCurrentOperatorId(id);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("rbac_current_operator_id", id);
      } catch (e) {
        console.error("Erro ao persistir rbac_current_operator_id no localStorage:", e);
      }
    }
  };

  // CRUD Operators
  const createOperator = async (opData: Omit<Operator, "id" | "status" | "avatar">) => {
    const newOp: Operator = {
      ...opData,
      id: `op-${Date.now()}`,
      status: "disponivel",
      avatar: `https://i.pravatar.cc/80?img=${Math.floor(Math.random() * 70)}`,
      tenantId: tenant,
    };
    setOperators((prev) => {
      const updated = [...prev, newOp];
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("rbac_operators", JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });

    try {
      await fetch(`${BACKEND_URL}/api/operators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newOp),
      });
    } catch (err) {
      console.error("Erro ao criar operador no DB:", err);
    }
  };

  const updateOperator = async (id: string, fields: Partial<Operator>) => {
    setOperators((prev) => {
      const updated = prev.map((op) => (op.id === id ? { ...op, ...fields } : op));
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
        await fetch(`${BACKEND_URL}/api/operators`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...targetOp,
            ...fields,
          }),
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
      const res = await fetch(`${BACKEND_URL}/api/operators?id=${id}&tenantId=${tenant}`, {
        method: "DELETE",
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
    setOperators((prev) => {
      const updated = prev.map((op) => (op.id === id ? { ...op, passwordHash: newPasswordHash } : op));
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
        await fetch(`${BACKEND_URL}/api/operators`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...targetOp,
            passwordHash: newPasswordHash,
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
    };
    
    // Update local state optimistically
    setAccessGroups((prev) => [...prev, newGroup]);

    try {
      await fetch(`${BACKEND_URL}/api/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newGroup, tenantId: tenant }),
      });
      toast.success("Grupo de acesso criado com sucesso!");
    } catch (err) {
      console.error("Erro ao criar grupo de acesso no DB:", err);
      toast.error("Erro ao salvar grupo de acesso.");
    }
  };

  const updateAccessGroup = async (id: string, fields: Partial<AccessGroup>) => {
    setAccessGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...fields } : g)));

    const targetGroup = accessGroups.find((g) => g.id === id);
    if (targetGroup) {
      try {
        await fetch(`${BACKEND_URL}/api/groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...targetGroup,
            ...fields,
            tenantId: tenant,
          }),
        });
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
      await fetch(`${BACKEND_URL}/api/groups?id=${id}&tenantId=${tenant}`, {
        method: "DELETE",
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
      tenantId: tenant,
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
            tenantId: tenant,
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
      tenantId: tenant,
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
    const firstChat = currentConvs.find((c) => c.queue === activeQueue) || currentConvs[0];
    setSelectedChatId(firstChat ? firstChat.id : null);
  }, [tenant]);

  // Sync tab/queue changes to first chat in that queue if present
  useEffect(() => {
    const currentConvs = tenant === "tecfag" ? tecfagConvs : valemConvs;
    const firstInQueue = currentConvs.find((c) => c.queue === activeQueue);
    if (firstInQueue) {
      setSelectedChatId(firstInQueue.id);
    } else {
      setSelectedChatId(null);
    }
  }, [activeQueue]);

  // Re-verify tenant when operator or group changes.
  // IMPORTANTE: NÃO incluir `tenant` nas dependências para evitar loop infinito de pisca-pisca.
  // Usar tenantRef.current para ler o tenant atual sem disparar re-renders.
  useEffect(() => {
    // Se já sincronizamos o tenant para este operador, não fazer nada
    // Isso evita que a sincronização de dados do banco cause piscadas
    if (tenantSyncedRef.current) return;

    const currentTenant = tenantRef.current;
    const email = (currentOperator?.email || "").toLowerCase();
    const isValemUser = email.includes("@valempack") || email.includes("@valem") || currentOperator?.tenantId === "valem";
    const isTecfagUser = email.includes("@tecfag") || currentOperator?.tenantId === "tecfag";

    // Se o operador não tem tenant no email nem no tenantId, não forçar troca
    if (!isValemUser && !isTecfagUser && !currentGroup) return;

    let targetTenant: "tecfag" | "valem" | null = null;

    // Prioridade 1: grupo não tem acesso ao tenant atual → forçar para um válido
    if (currentGroup && !currentGroup.allowedTenants.includes(currentTenant)) {
      targetTenant = currentGroup.allowedTenants[0] || null;
    }

    // Prioridade 2: inferir pelo email/tenantId do operador
    if (!targetTenant) {
      if (isValemUser && currentTenant !== "valem" && (!currentGroup || currentGroup.allowedTenants.includes("valem"))) {
        targetTenant = "valem";
      } else if (isTecfagUser && currentTenant !== "tecfag" && (!currentGroup || currentGroup.allowedTenants.includes("tecfag"))) {
        targetTenant = "tecfag";
      }
    }

    if (targetTenant && targetTenant !== currentTenant) {
      tenantSyncedRef.current = true; // Marcar como sincronizado para não repetir
      setTenantState(targetTenant);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("chat_tenant", targetTenant);
        } catch (e) {
          console.error("Erro ao persistir chat_tenant no localStorage:", e);
        }
      }
      document.title = targetTenant === "tecfag" ? "Tec Chat — Meta API" : "Valem Chat — Baileys API";
    } else if (currentOperator?.id && currentOperator.id !== "op-1") {
      // Operador real carregado e tenant já está correto → marcar como sincronizado
      tenantSyncedRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOperatorId, currentGroup]);

  const setTenant = (newTenant: "tecfag" | "valem") => {
    if (currentGroup && !currentGroup.allowedTenants.includes(newTenant)) {
      toast.error(`Acesso bloqueado: você não tem permissão para acessar o tenant ${newTenant.toUpperCase()}`);
      return;
    }
    setTenantState(newTenant);
    setActiveView("chat");
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("chat_tenant", newTenant);
        localStorage.setItem("chat_active_view", "chat");
      } catch (e) {
        console.error("Erro ao persistir chat_tenant no localStorage:", e);
      }
    }
    document.title = newTenant === "tecfag" ? "Tec Chat — Meta API" : "Valem Chat — Baileys API";
    toast.success(`Tenant alterado para ${newTenant === "tecfag" ? "Tecfag Chat" : "Valem Chat"}`);
  };

  // Carregar conversas persistidas no banco (Railway)
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/chats?tenantId=${tenant}`)
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

          const valentinaDefault: Conversation = {
            id: "valentina",
            name: "Valentina",
            avatar: "/valentina.png",
            initials: "VL",
            initialsBg: "var(--primary)",
            phone: "IA",
            email: "valentina@valem.ai",
            cnpj: "",
            cpf: "",
            tags: ["IA", "Valem"],
            channel: "whatsapp",
            queue: "meus",
            messages: [
              {
                id: "val_welcome",
                author: "Valentina",
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
            responsibleName: "Valentina IA",
          };
          
          const chatsWithPinned = [valentinaDefault, ...data].map((c: any) => ({
            ...c,
            pinned: c.id === "valentina" ? true : pinnedIds.includes(c.id),
          }));
          setConversations(chatsWithPinned);
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
            author: r.direction === "to_agent" ? "Você" : "Valentina",
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
  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const activeChat = conversations.find((c) => c.id === selectedChatId) || null;

  // Actions
  const sendMessage = async (text: string, isInternalNote = false, attachments?: File[], quotedMessage?: { id: string; sender: string; content: string } | null) => {
    if (!selectedChatId) return;

    const currentChat = conversations.find((c) => c.id === selectedChatId);
    if (!currentChat) return;

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
              author: "Valentina",
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
              author: "Valentina",
              text: `${alert.type === "sla_warning" ? "⚠️" : "🔔"} ${alert.clientName || "Cliente"} está aguardando há ${alert.waitMinutes || "?"} minutos`,
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
            author: "Valentina",
            text: "Ops, tive um problema ao processar sua mensagem. Pode tentar de novo? 😅",
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

      return;
    }

    const shouldSendReal =
      tenant === "valem" &&
      currentChat.channel === "whatsapp" &&
      !isInternalNote;

    console.log("[SendMessage Frontend] Diagnóstico de envio:", {
      tenant,
      channel: currentChat.channel,
      isInternalNote,
      phone: currentChat.phone,
      selectedChatId,
      shouldSendReal,
      quotedMessage,
    });

    if (shouldSendReal && currentChat.phone) {
      let targetPhone = currentChat.phone.replace(/\D/g, "");
      // Adiciona o DDI 55 (Brasil) caso tenha sido salvo apenas com o DDD e número (10 ou 11 dígitos)
      if (targetPhone.length === 10 || targetPhone.length === 11) {
        targetPhone = `55${targetPhone}`;
      }

      try {
        // Só envia texto se houver conteúdo
        if (text.trim()) {
          const response = await fetch(`${BACKEND_URL}/api/baileys/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenantId: "valem",
              phone: targetPhone,
              text,
              conversationId: selectedChatId,
              senderName: operatorProfile.name,
              quotedMessageId: quotedMessage?.id || null,
              quotedMessageSender: quotedMessage?.sender || null,
              quotedMessageContent: quotedMessage?.content || null,
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || "Erro na resposta do envio de mensagem");
          }
        }

        // Enviar anexos (independente de ter texto)
        if (attachments && attachments.length > 0) {
          for (const file of attachments) {
            try {
              const formData = new FormData();
              formData.append("tenantId", "valem");
              formData.append("phone", targetPhone);
              formData.append("conversationId", selectedChatId);
              formData.append("senderName", operatorProfile.name);
              // Usa 3 argumentos para garantir que o filename seja enviado
              // mesmo quando `file` é um Blob puro (sem .name)
              const safeName = (file as any).name || file.name || "audio.webm";
              formData.append("file", file, safeName);
              const mediaRes = await fetch(`${BACKEND_URL}/api/baileys/send-media`, {
                method: "POST",
                body: formData,
              });
              if (!mediaRes.ok) {
                const errData = await mediaRes.json().catch(() => ({}));
                console.error("Falha ao enviar anexo:", errData.error);
              }
            } catch (err) {
              console.error("Falha ao enviar anexo:", err);
            }
          }
        }
      } catch (err: any) {
        console.error("Falha ao enviar mensagem de WhatsApp pelo backend:", err);
        toast.error(`Erro ao enviar mensagem: ${err.message || "Conexão falhou"}`);
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
            senderName: isInternalNote ? "Vendedor" : operatorProfile.name,
            content: text,
            isInternalNote,
            quotedMessageId: quotedMessage?.id || null,
            quotedMessageSender: quotedMessage?.sender || null,
            quotedMessageContent: quotedMessage?.content || null,
          }),
        });

        if (!response.ok) {
          console.error("Erro na resposta ao salvar mensagem local no banco");
        }
      } catch (err) {
        console.error("Falha ao salvar mensagem local no banco:", err);
      }
    }

    const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    // Mensagem de texto (só adiciona se tiver conteúdo)
    const messagesToAdd: Message[] = [];

    if (text.trim()) {
      messagesToAdd.push({
        id: `msg-${Date.now()}`,
        author: isInternalNote ? operatorProfile.name : "Você",
        text,
        time: now,
        side: "out",
        isInternalNote,
        quotedMessageId: quotedMessage?.id || null,
        quotedMessageSender: quotedMessage?.sender || null,
        quotedMessageContent: quotedMessage?.content || null,
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
          id: `msg-media-${Date.now()}-${i}`,
          author: "Você",
          // Formato especial para preview local: [LOCAL_MEDIA:type:url:filename]
          text: `[LOCAL_MEDIA:${mediaType}:${objectUrl}:${fileName}]`,
          time: now,
          side: "out",
          isInternalNote: false,
        });
      });
    }

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === selectedChatId) {
          return {
            ...c,
            lastMessageTime: now,
            messages: [...c.messages, ...messagesToAdd],
          };
        }
        return c;
      })
    );
  };

  const captureChat = async (id: string) => {
    // Guard: verificar permissão antes de qualquer estado
    if (!currentGroup.canCaptureChat) {
      console.warn("[captureChat] Sem permissão para capturar atendimentos.");
      return;
    }

    const textLog = `CONVERSA INICIADA POR ${operatorProfile.name.toUpperCase()}`;
    const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    // Snapshot do estado anterior para rollback em caso de falha
    const previousState = conversationsRef.current.find((c) => c.id === id);

    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const systemMsg: Message = {
            id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            author: "Sistema",
            text: textLog,
            time: now,
            side: "out",
            isInternalNote: true,
          };
          return {
            ...c,
            queue: "meus",
            operatorId: currentOperatorId,
            responsibleName: operatorProfile.name,
            messages: [...c.messages, systemMsg],
          };
        }
        return c;
      })
    );
    setActiveQueue("meus");
    setSelectedChatId(id);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chats/update-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: id,
          queueState: "meus",
          operatorId: currentOperatorId,
          systemMessageText: textLog,
        }),
      });

      if (res.status === 409) {
        // Outro operador capturou antes — rollback
        console.warn("[captureChat] Conflito: chat já foi capturado por outro operador.");
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
    } catch (err) {
      console.error("[captureChat] Erro ao persistir no DB — revertendo estado:", err);
      if (previousState) {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...previousState } : c))
        );
      }
      setSelectedChatId(null);
    }
  };

  const transferChat = async (id: string, sectorName: string, targetOperatorId?: string | null) => {
    const targetOp = targetOperatorId ? operators.find(o => o.id === targetOperatorId) : null;
    const targetQueueState = targetOp ? "meus" : "fila";
    const opName = targetOp ? targetOp.name : "Qualquer atendente";
    const textLog = `Conversa transferida para o setor: ${sectorName} (${opName}).`;
    const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    const targetSector = sectors.find(s => s.name === sectorName);
    const sectorId = targetSector ? targetSector.id : null;

    // Snapshot para rollback
    const previousState = conversationsRef.current.find((c) => c.id === id);

    // Optimistic update: atualiza a conversa localmente
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const systemMsg: Message = {
            id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            author: "Sistema",
            text: textLog,
            time: now,
            side: "out",
            isInternalNote: true,
          };
          return {
            ...c,
            queue: targetQueueState,
            operatorId: targetOperatorId || null,
            responsibleName: targetOp ? targetOp.name : "Na Fila",
            sectorId: sectorId,
            sectorName: sectorName,
            messages: [...c.messages, systemMsg],
          };
        }
        return c;
      })
    );

    // O operador que transferiu não é mais dono: deselecionar o chat
    // (ele vai sumir da aba "Meus" do operador de origem)
    setSelectedChatId(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chats/update-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: id,
          queueState: targetQueueState,
          operatorId: targetOperatorId || null,
          sectorId: sectorId,
          systemMessageText: textLog,
          isTransfer: true,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("[transferChat] Erro ao persistir no DB — revertendo estado:", err);
      // Rollback: restaurar estado anterior da conversa
      if (previousState) {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...previousState } : c))
        );
      }
    }
  };

  const finishChat = async (id: string) => {
    const textLog = "Conversa encerrada e movida para Finalizados.";
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
      await fetch(`${BACKEND_URL}/api/chats/update-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: id,
          queueState: "finalizados",
          systemMessageText: textLog,
        }),
      });
    } catch (err) {
      console.error("Erro ao persistir encerramento de chat no DB:", err);
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
          body: JSON.stringify({
            conversationId: activeConversation.id,
            queueState: newQueueState,
            operatorId: targetOperatorId,
            systemMessageText: logText,
            isTransfer: true,
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

  const createContact = (name: string, phone: string, email: string, cnpj: string, channel: Channel) => {
    const conversationId = `conv-${Date.now()}`;
    const contactId = `cont-${Date.now()}`;
    const initials = name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
    const colors = ["#e9d5b8", "#f2a6a6", "#c3f2a6", "#a6d6f2", "#d6a6f2"];
    const initialsBg = colors[Math.floor(Math.random() * colors.length)];

    const newConversation: Conversation = {
      id: conversationId,
      contactId,
      name,
      avatar: "",
      initials,
      initialsBg,
      phone,
      email,
      cnpj,
      tags: ["Novo Cadastro"],
      channel,
      queue: "meus",
      operatorId: currentOperatorId,
      unreadCount: 0,
      lastMessageTime: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      messages: [
        {
          id: `sys-${Date.now()}`,
          author: "Sistema",
          text: `Contato criado e atendimento iniciado.`,
          time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          side: "out",
          isInternalNote: true,
        },
      ],
    };

    setConversations((prev) => [newConversation, ...prev]);
    setSelectedChatId(conversationId);

    // Salvar no banco em segundo plano
    fetch(`${BACKEND_URL}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant,
        name,
        phone,
        email,
        cnpj,
        channel,
        operatorId: currentOperatorId,
        queueState: "meus",
        contactId,
        conversationId,
      }),
    })
      .then((res) => {
        if (!res.ok) {
          console.error("Erro ao salvar novo contato no banco");
        }
      })
      .catch((err) => console.error("Erro ao salvar novo contato no banco:", err));

    return conversationId;
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
        body: JSON.stringify({ tenantId: "valem" }),
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
        body: JSON.stringify({ tenantId: "valem", jid: currentChat.phone }),
      }).catch(() => {});
    }
  }, [selectedChatId, conversations]);

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
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const connectBaileys = (forceNew: boolean = false) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setBaileysConfig((prev) => ({
      ...prev,
      status: "connecting",
      qrCodeUrl: "",
    }));

    const url = `${BACKEND_URL}/api/baileys/connect?tenantId=valem${forceNew ? "&force=true" : ""}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Evento recebido do Baileys SSE:", data);

        if (data.type === "status") {
          setBaileysConfig((prev) => ({
            ...prev,
            status: data.status,
            pairedPhone: data.phone ? `+${data.phone}` : prev.pairedPhone,
          }));

          // Ao conectar, sincroniza fotos de contatos sem avatar em background
          if (data.status === "connected") {
            fetch(`${BACKEND_URL}/api/baileys/sync-avatars`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tenantId: "valem" }),
            })
              .then((r) => r.json())
              .then((result) =>
                console.log(`[sync-avatars] ${result.updated} fotos sincronizadas, ${result.failed} sem foto`)
              )
              .catch(() => {}); // Silencioso
          }
        } else if (data.type === "qr") {
          // Gera o QR Code localmente como Data URL — sem dependência de serviço externo
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
        } else if (data.type === "contact_avatar") {
          setConversations((prev) =>
            prev.map((c) => {
              // Tenta match por contactId primeiro (mais preciso), depois phone
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
              lastState = pObj.lastKnownPresence || pObj.presence || pObj.state;
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
          const tenantId = tenantRef.current;
          fetch(`${BACKEND_URL}/api/chats?tenantId=${tenantId}`)
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

          // Limpa o indicador de digitando quando a mensagem chega
          if (message?.conversationId) {
            setClientTypingStatus((prev) => ({ ...prev, [message.conversationId]: null }));
          }

          // Mostrar notificação Toast customizada
          // Regra de Notificação:
          // 1. Contato captado e conosco (queue === "meus" e operatorId === currentOperatorId)
          // 2. OU contato encerrado (queue === "finalizados"), porém na carteira do vendedor logado (walletOperatorId === currentOperatorId)
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

            // Formatar visualmente se for mídia
            let previewText = message.content || "";
            if (previewText.startsWith("[LOCAL_MEDIA:") || previewText.startsWith("[MEDIA:")) {
              if (previewText.includes("image")) previewText = "📷 Imagem";
              else if (previewText.includes("video")) previewText = "🎥 Vídeo";
              else if (previewText.includes("audio")) previewText = "🎵 Áudio";
              else if (previewText.includes("sticker")) previewText = "🪄 Figurinha";
              else if (previewText.includes("document")) {
                const parts = previewText.split(":");
                const rawName = parts[parts.length - 1] || "";
                previewText = `📄 ${rawName.split("]")[0] || "Documento"}`;
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
                  {/* Client Avatar */}
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

                  {/* Message Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">{clientName}</p>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">{previewText}</p>
                  </div>

                  {/* Actions */}
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
              {
                duration: 6000,
                position: "bottom-right",
              }
            );
          }
          
          setConversations((prev) => {
            const exists = prev.some((c) => c.id === message.conversationId);
            const timeStr = new Date(message.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            const incomingMsg: Message = {
              id: message.id,
              author: message.senderName,
              text: message.content,
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
                  const isCurrentOpen = message.conversationId === selectedChatId;
                  const newUnread = message.senderType === "client"
                    ? (isCurrentOpen ? 0 : c.unreadCount + 1)
                    : c.unreadCount;

                  if (isCurrentOpen && message.senderType === "client") {
                    // Marcar como lido no banco de dados de forma assíncrona
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
                    // Deduplicação: não adiciona a mensagem se ela já existe no array (ex: reconexão SSE)
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
              const initials = message.senderName
                .split(" ")
                .map((w: string) => w[0])
                .join("")
                .toUpperCase()
                .substring(0, 2);
              const initialsBg = "#a6d6f2";
              
              const isCurrentOpen = message.conversationId === selectedChatId;
              const newUnread = isCurrentOpen ? 0 : 1;

              if (isCurrentOpen && message.senderType === "client") {
                // Marcar como lido no banco de dados de forma assíncrona
                fetch(`${BACKEND_URL}/api/chats`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ conversationId: message.conversationId, unreadCount: 0 }),
                }).catch((e) => console.error("Erro ao marcar como lido via SSE para nova conversa:", e));
              }

              // Verificar se está fixada no localStorage
              const pinnedKey = `pinned_chats_${currentOperatorId || "global"}`;
              let pinnedIds: string[] = [];
              try {
                const stored = localStorage.getItem(pinnedKey);
                if (stored) pinnedIds = JSON.parse(stored);
              } catch (e) {}
              const isPinned = pinnedIds.includes(message.conversationId);

              const newConv: Conversation = {
                id: message.conversationId,
                name: message.senderName,
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
        } else if (data.type === "queue_update") {
          // Evento de atualização de fila: captura, transferência ou finalização.
          // Atualiza APENAS os campos de estado da conversa — sem criar balão de mensagem,
          // sem incrementar unreadCount, sem tocar som de notificação.
          const { conversationId, queueState, operatorId: newOperatorId, sectorId: newSectorId, responsibleName } = data;

          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== conversationId) return c;
              return {
                ...c,
                queue: queueState,
                operatorId: newOperatorId !== undefined ? newOperatorId : c.operatorId,
                sectorId: newSectorId !== undefined ? newSectorId : (c as any).sectorId,
                responsibleName: responsibleName !== undefined ? responsibleName : c.responsibleName,
              };
            })
          );

          // ── Auto-deselect ────────────────────────────────────────────────────
          // Se o chat que mudou é o que está selecionado AGORA e:
          //   a) o chat saiu do domínio do operador atual (foi transferido para outro), OU
          //   b) o chat foi finalizado
          // → deseleciona o chat para que o painel mostre estado neutro imediatamente,
          //   impedindo que o operador anterior continue enviando mensagens.
          const myId = currentOperatorIdRef.current;
          const isCurrentlyViewing = selectedChatIdRef.current === conversationId;

          if (isCurrentlyViewing) {
            const chatWasOwnedByMe = (() => {
              // Peek at the current conversations to check the previous owner
              // We can't read state directly here, so use the newOperatorId from the event
              return newOperatorId !== myId; // the new owner is NOT me
            })();

            const chatFinalized = queueState === "finalizados";
            const chatTransferredAway =
              (queueState === "fila" || queueState === "automacao") ||
              (queueState === "meus" && newOperatorId && newOperatorId !== myId);

            if (chatFinalized || chatTransferredAway) {
              // Deselect immediately so the previous owner's panel refreshes
              setSelectedChatId(null);
            }
          }
        }

      } catch (err) {
        console.error("Erro ao processar dados recebidos do SSE:", err);
      }
    };

    // Controle de tentativas de reconexão automática do SSE
    let sseErrorCount = 0;
    eventSource.onerror = (err) => {
      sseErrorCount++;
      console.warn(`[SSE] Erro/queda na conexão SSE (tentativa ${sseErrorCount}). O navegador tentará reconectar automaticamente.`, err);

      // Após 3 erros consecutivos sem reconexão bem-sucedida, alertar o usuário
      if (sseErrorCount === 3) {
        setBaileysConfig((prev) => ({
          ...prev,
          status: "disconnected",
        }));
        console.warn("[SSE] Muitas falhas consecutivas — marcando como desconectado.");
      }
    };

    // Quando o SSE reconectar após uma queda, resetar contador de erros
    eventSource.onopen = () => {
      if (sseErrorCount > 0) {
        console.log("[SSE] Conexão SSE restaurada após erro.");
        sseErrorCount = 0;
      }
    };
  };

  // Buscar status inicial do Baileys e limpar SSE ao desmontar
  useEffect(() => {
    if (tenant === "valem") {
      // Sempre abre o canal SSE para acordar a sessão e receber novas mensagens/status do Baileys
      connectBaileys();

      fetch(`${BACKEND_URL}/api/baileys/status?tenantId=valem`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.status) {
            setBaileysConfig((prev) => ({
              ...prev,
              status: data.status,
              pairedPhone: data.pairedPhone ? `+${data.pairedPhone}` : data.pairedPhone || "",
              // Não usar api.qrserver.com — QR é gerado localmente via biblioteca qrcode
            }));
          }
        })
        .catch((err) => console.error("Erro ao verificar status do Baileys:", err));
    } else {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  }, [tenant]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const login = async (email: string, passwordHash: string): Promise<boolean> => {
    console.log("[Login Debug] Tentativa de login no servidor para email:", email);
    
    try {
      // 1. Tentar autenticar via servidor PostgreSQL (/api/auth/login)
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: passwordHash }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.operator) {
          const matchedOp = data.operator;
          console.log("[Login Debug] Operador autenticado com sucesso pelo servidor:", matchedOp);

          // Atualizar estado de operadores incluindo o operador logado
          setOperators((prev) => {
            const exists = prev.some((o) => o.id === matchedOp.id);
            return exists ? prev.map((o) => (o.id === matchedOp.id ? matchedOp : o)) : [...prev, matchedOp];
          });

          setCurrentOperatorId(matchedOp.id);

          // Sincronizar o tenant ativo com o tenant do operador
          if (matchedOp.tenantId) {
            setTenantState(matchedOp.tenantId);
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem("chat_tenant", matchedOp.tenantId);
              } catch (e) {}
            }
            document.title = matchedOp.tenantId === "tecfag" ? "Tec Chat — Meta API" : "Valem Chat — Baileys API";

            // Buscar todos os operadores do tenant autenticado
            fetch(`${BACKEND_URL}/api/operators?tenantId=${matchedOp.tenantId}`)
              .then((res) => res.json())
              .then((opList) => {
                if (Array.isArray(opList) && opList.length > 0) {
                  setOperators(opList);
                  if (typeof window !== "undefined") {
                    try {
                      localStorage.setItem("rbac_operators", JSON.stringify(opList));
                    } catch (e) {}
                  }
                }
              })
              .catch((err) => console.error("Erro ao sincronizar operadores pós-login:", err));
          }

          setIsAuthenticated(true);
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem("chat_is_authenticated", "true");
              localStorage.setItem("rbac_current_operator_id", matchedOp.id);
            } catch (e) {
              console.error("Erro ao salvar dados de autenticação:", e);
            }
          }
          return true;
        }
      }
    } catch (err) {
      console.warn("[Login Debug] Erro ao conectar à API de autenticação, tentando fallback local:", err);
    }

    // Fallback local caso a API não esteja acessível (ex: offline)
    const matchedOp = operators.find(
      (op) => op.email.toLowerCase() === email.toLowerCase() && op.passwordHash === passwordHash
    );
    if (matchedOp) {
      setCurrentOperatorId(matchedOp.id);
      setIsAuthenticated(true);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("chat_is_authenticated", "true");
          localStorage.setItem("rbac_current_operator_id", matchedOp.id);
        } catch (e) {}
      }
      return true;
    }

    return false;
  };

  const logout = () => {
    setIsAuthenticated(false);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("chat_is_authenticated");
      } catch (e) {
        console.error("Erro ao limpar dados de autenticação:", e);
      }
    }
  };

  return (
    <ChatContext.Provider
      value={{
        tenant,
        setTenant,
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
        markAsRead,
        markAsUnread,
        pinChat,
        
        metaConfig,
        setMetaConfig,
        baileysConfig,
        setBaileysConfig,
        clientTypingStatus,
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
