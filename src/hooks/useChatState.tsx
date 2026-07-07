import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Conversation,
  Channel,
  QueueType,
  Message,
  QuickResponse,
  OperatorTemplate,
} from "@/lib/mockData";

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
  canCreateUser: boolean;
  canResetPassword: boolean;
  canEditProfile: boolean;
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
  activeView: "chat" | "contacts" | "wallet" | "settings" | "groups" | "monitor" | "analytics" | "tasks";
  setActiveView: (view: "chat" | "contacts" | "wallet" | "settings" | "groups" | "monitor" | "analytics" | "tasks") => void;
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
  updateTags: (id: string, tags: string[]) => void;
  updateClientInfo: (id: string, fields: Partial<Pick<Conversation, "name" | "phone" | "email" | "cnpj" | "cpf">>) => void;
  updateContactWallet: (contactId: string, walletOperatorId: string | null) => Promise<void>;
  createContact: (name: string, phone: string, email: string, cnpj: string, channel: Channel) => string;
  markAsRead: (id: string) => void;
  markAsUnread: (id: string) => void;
  pinChat: (id: string) => void;
  
  // Configurations
  metaConfig: MetaConfig;
  setMetaConfig: React.Dispatch<React.SetStateAction<MetaConfig>>;
  baileysConfig: BaileysConfig;
  setBaileysConfig: React.Dispatch<React.SetStateAction<BaileysConfig>>;
  disconnectBaileys: () => void;
  connectBaileys: () => void;
 
  // Authentication
  isAuthenticated: boolean;
  login: (email: string, passwordHash: string) => Promise<boolean>;
  logout: () => void;
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenantState] = useState<"tecfag" | "valem">("tecfag");
  const [activeQueue, setActiveQueue] = useState<QueueType>("meus");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [activeView, setActiveView] = useState<"chat" | "contacts" | "wallet" | "settings" | "groups" | "monitor" | "analytics" | "tasks">("chat");
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [accessGroups, setAccessGroups] = useState<AccessGroup[]>([]);
  const [quickResponses, setQuickResponses] = useState<QuickResponse[]>([]);
  const [templates, setTemplates] = useState<OperatorTemplate[]>([]);

  const [operators, setOperators] = useState<Operator[]>([
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
          setOperators(JSON.parse(savedOperators));
        } catch (e) {}
      }

      // Sincronizar operadores do banco
      fetch(`${BACKEND_URL}/api/operators`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            setOperators(data);
            try {
              localStorage.setItem("rbac_operators", JSON.stringify(data));
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

  // Sincronizar grupos, setores e respostas rápidas do banco de dados quando o tenant mudar
  useEffect(() => {
    if (typeof window !== "undefined") {
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

  // Persistir alterações apenas após o cliente estar pronto (evita sobrescrever dados com o padrão de render)
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

  const defaultAdminGroup: AccessGroup = {
    id: "group-admin",
    name: "Administradores",
    allowedTenants: ["tecfag", "valem"],
    allowedChannels: ["whatsapp", "instagram", "messenger"],
    canCreateUser: true,
    canResetPassword: true,
    canEditProfile: true,
  };

  const defaultOperator: Operator = {
    id: "op-1",
    name: "Carregando...",
    email: "",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&fit=crop",
    status: "disponivel",
    passwordHash: "123456",
    groupId: "group-admin",
  };

  const currentOperator = operators.find((op) => op.id === currentOperatorId) || operators[0] || defaultOperator;
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
    setOperators((prev) => {
      const updated = prev.filter((op) => op.id !== id);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("rbac_operators", JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });

    try {
      await fetch(`${BACKEND_URL}/api/operators?id=${id}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("Erro ao deletar operador no DB:", err);
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
      await fetch(`${BACKEND_URL}/api/groups?id=${id}`, {
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

  // Re-verify tenant when operator or group changes
  useEffect(() => {
    if (currentGroup) {
      if (!currentGroup.allowedTenants.includes(tenant)) {
        const firstAllowed = currentGroup.allowedTenants[0];
        if (firstAllowed) {
          setTenantState(firstAllowed);
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem("chat_tenant", firstAllowed);
            } catch (e) {
              console.error("Erro ao persistir chat_tenant no localStorage:", e);
            }
          }
          document.title = firstAllowed === "tecfag" ? "Tec Chat — Meta API" : "Valem Chat — Baileys API";
        }
      }
    }
  }, [currentOperatorId, currentGroup, tenant]);

  const setTenant = (newTenant: "tecfag" | "valem") => {
    if (currentGroup && !currentGroup.allowedTenants.includes(newTenant)) {
      return; // Tenant block
    }
    setTenantState(newTenant);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("chat_tenant", newTenant);
      } catch (e) {
        console.error("Erro ao persistir chat_tenant no localStorage:", e);
      }
    }
    // Sync view reset
    setActiveView("chat");
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("chat_active_view", "chat");
      } catch (e) {
        console.error("Erro ao persistir chat_active_view no localStorage:", e);
      }
    }
    // Change document title for visual cues
    document.title = newTenant === "tecfag" ? "Tec Chat — Meta API" : "Valem Chat — Baileys API";
  };

  // Carregar conversas persistidas no banco (Railway)
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/chats?tenantId=${tenant}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setConversations(data);
        }
      })
      .catch((err) => console.error("Erro ao sincronizar conversas do banco:", err));
  }, [tenant]);

  const rawConversations = tenant === "tecfag" ? tecfagConvs : valemConvs;
  const conversations = rawConversations.filter((c) =>
    currentGroup.allowedChannels.includes(c.channel)
  );
  const setConversations = tenant === "tecfag" ? setTecfagConvs : setValemConvs;

  const activeChat = conversations.find((c) => c.id === selectedChatId) || null;

  // Actions
  const sendMessage = async (text: string, isInternalNote = false, attachments?: File[], quotedMessage?: { id: string; sender: string; content: string } | null) => {
    if (!selectedChatId) return;

    const currentChat = conversations.find((c) => c.id === selectedChatId);
    if (!currentChat) return;

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
    const textLog = `CONVERSA INICIADA POR ${operatorProfile.name.toUpperCase()}`;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          // Add system internal note
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
            queue: "meus",
            operatorId: currentOperatorId,
            messages: [...c.messages, systemMsg],
          };
        }
        return c;
      })
    );
    setActiveQueue("meus");
    setSelectedChatId(id);

    try {
      await fetch(`${BACKEND_URL}/api/chats/update-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: id,
          queueState: "meus",
          operatorId: currentOperatorId,
          systemMessageText: textLog,
        }),
      });
    } catch (err) {
      console.error("Erro ao persistir captura de chat no DB:", err);
    }
  };

  const transferChat = async (id: string, sectorName: string, targetOperatorId?: string | null) => {
    const targetOp = targetOperatorId ? operators.find(o => o.id === targetOperatorId) : null;
    const targetQueueState = targetOp ? "meus" : "fila";
    const opName = targetOp ? targetOp.name : "Qualquer atendente";
    const textLog = `Conversa transferida para o setor: ${sectorName} (${opName}).`;
    
    const targetSector = sectors.find(s => s.name === sectorName);
    const sectorId = targetSector ? targetSector.id : null;

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
            queue: targetQueueState,
            operatorId: targetOperatorId || null,
            sectorId: sectorId,
            sectorName: sectorName,
            messages: [...c.messages, systemMsg],
          };
        }
        return c;
      })
    );
    setActiveQueue(targetQueueState);
    setSelectedChatId(id);

    try {
      await fetch(`${BACKEND_URL}/api/chats/update-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: id,
          queueState: targetQueueState,
          operatorId: targetOperatorId || null,
          sectorId: sectorId,
          systemMessageText: textLog,
        }),
      });
    } catch (err) {
      console.error("Erro ao persistir transferência de chat no DB:", err);
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
  };

  const markAsUnread = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: Math.max(c.unreadCount, 1) } : c))
    );
  };

  const pinChat = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !(c as any).pinned } : c))
    );
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

  const updateContactWallet = async (contactId: string, walletOperatorId: string | null) => {
    // 1. Atualiza estado local imediatamente (optimistic update)
    setConversations((prev) =>
      prev.map((c) =>
        c.contactId === contactId || c.id === contactId
          ? { ...c, walletOperatorId }
          : c
      )
    );

    // 2. Persiste no banco de dados
    try {
      const res = await fetch(`${BACKEND_URL}/api/contacts/update-wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, walletOperatorId }),
      });
      if (!res.ok) {
        console.error("[updateContactWallet] Erro ao persistir no DB");
      }
    } catch (err) {
      console.error("[updateContactWallet] Erro na requisição:", err);
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

  const connectBaileys = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setBaileysConfig((prev) => ({
      ...prev,
      status: prev.status === "connected" ? "connected" : "connecting",
      qrCodeUrl: prev.status === "connected" ? "" : prev.qrCodeUrl,
    }));

    const eventSource = new EventSource(`${BACKEND_URL}/api/baileys/connect?tenantId=valem`);
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
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.qr)}`;
          setBaileysConfig((prev) => ({
            ...prev,
            status: "qr_ready",
            qrCodeUrl: qrUrl,
          }));
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
        } else if (data.type === "message") {
          const { message } = data;
          
          setConversations((prev) => {
            const exists = prev.some((c) => c.id === message.conversationId);
            const timeStr = new Date(message.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            const incomingMsg: Message = {
              id: message.id,
              author: message.senderName,
              text: message.content,
              time: timeStr,
              side: message.senderType === "client" ? "in" : "out",
              quotedMessageId: message.quotedMessageId || null,
              quotedMessageSender: message.quotedMessageSender || null,
              quotedMessageContent: message.quotedMessageContent || null,
            };

            if (exists) {
              return prev.map((c) => {
                if (c.id === message.conversationId) {
                  return {
                    ...c,
                    lastMessageTime: timeStr,
                    unreadCount: message.senderType === "client" ? c.unreadCount + 1 : c.unreadCount,
                    messages: [...c.messages, incomingMsg],
                    phone: message.phone || c.phone,
                    avatar: message.avatar || c.avatar,
                    queue: message.queue || c.queue,
                    operatorId: message.operatorId !== undefined ? message.operatorId : c.operatorId,
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
                unreadCount: 1,
                lastMessageTime: timeStr,
                messages: [incomingMsg],
              };
              return [newConv, ...prev];
            }
          });
        }
      } catch (err) {
        console.error("Erro ao processar dados recebidos do SSE:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("Erro ou oscilação na conexão SSE do Baileys (o navegador tentará reconectar):", err);
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
              qrCodeUrl: data.qr ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.qr)}` : "",
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
    console.log("[Login Debug] Tentativa de login para email:", email);
    console.log("[Login Debug] Lista de emails de operadores cadastrados:", operators.map(o => o.email));
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
          
          // Sincronizar o tenant ativo com base no grupo de acesso do operador
          const opGroup = accessGroups.find((g) => g.id === matchedOp.groupId);
          if (opGroup) {
            const firstAllowed = opGroup.allowedTenants[0];
            if (firstAllowed) {
              setTenantState(firstAllowed);
              localStorage.setItem("chat_tenant", firstAllowed);
              document.title = firstAllowed === "tecfag" ? "Tec Chat — Meta API" : "Valem Chat — Baileys API";
            }
          }
        } catch (e) {
          console.error("Erro ao salvar dados de autenticação:", e);
        }
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
