import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import {
  Conversation,
  Channel,
  QueueType,
  Message,
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
};

export type Operator = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: "disponivel" | "pausa" | "desconectado";
  passwordHash: string;
  groupId: string;
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
  activeView: "chat" | "contacts" | "settings" | "groups";
  setActiveView: (view: "chat" | "contacts" | "settings" | "groups") => void;
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
  
  // Actions
  sendMessage: (text: string, isInternalNote?: boolean) => void;
  captureChat: (id: string) => void;
  transferChat: (id: string, department: string) => void;
  finishChat: (id: string) => void;
  updateTags: (id: string, tags: string[]) => void;
  updateClientInfo: (id: string, fields: Partial<Pick<Conversation, "name" | "phone" | "email" | "cnpj">>) => void;
  createContact: (name: string, phone: string, email: string, cnpj: string, channel: Channel) => string;
  
  // Configurations
  metaConfig: MetaConfig;
  setMetaConfig: React.Dispatch<React.SetStateAction<MetaConfig>>;
  baileysConfig: BaileysConfig;
  setBaileysConfig: React.Dispatch<React.SetStateAction<BaileysConfig>>;
  disconnectBaileys: () => void;
  connectBaileys: () => void;
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenantState] = useState<"tecfag" | "valem">("tecfag");
  const [activeQueue, setActiveQueue] = useState<QueueType>("meus");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [activeView, setActiveView] = useState<"chat" | "contacts" | "settings" | "groups">("chat");
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);

  // RBAC Setup
  const [accessGroups, setAccessGroups] = useState<AccessGroup[]>([
    {
      id: "group-admin",
      name: "Administradores",
      allowedTenants: ["tecfag", "valem"],
      allowedChannels: ["whatsapp", "instagram", "messenger"],
      canCreateUser: true,
      canResetPassword: true,
      canEditProfile: true,
    },
    {
      id: "group-valem-comercial",
      name: "Valem Comercial",
      allowedTenants: ["valem"],
      allowedChannels: ["whatsapp", "instagram", "messenger"],
      canCreateUser: true,
      canResetPassword: true,
      canEditProfile: true,
    },
    {
      id: "group-tecfag-vendedor",
      name: "Tecfag Vendedores",
      allowedTenants: ["tecfag"],
      allowedChannels: ["whatsapp", "instagram", "messenger"],
      canCreateUser: false,
      canResetPassword: false,
      canEditProfile: true,
    },
    {
      id: "group-whats-only",
      name: "Vendedores WhatsApp Only",
      allowedTenants: ["tecfag", "valem"],
      allowedChannels: ["whatsapp"],
      canCreateUser: false,
      canResetPassword: false,
      canEditProfile: true,
    },
  ]);

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

  // Restaurar dados do localStorage após a montagem do componente no cliente (evita Hydration Mismatch)
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

      const savedGroups = localStorage.getItem("rbac_access_groups");
      if (savedGroups) {
        try {
          setAccessGroups(JSON.parse(savedGroups));
        } catch (e) {}
      }

      const savedOperators = localStorage.getItem("rbac_operators");
      if (savedOperators) {
        try {
          setOperators(JSON.parse(savedOperators));
        } catch (e) {}
      }

      const savedOpId = localStorage.getItem("rbac_current_operator_id");
      if (savedOpId) {
        setCurrentOperatorId(savedOpId);
      }
    }
  }, []);

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
        localStorage.setItem("rbac_access_groups", JSON.stringify(accessGroups));
      } catch (e) {
        console.error("Erro ao persistir rbac_access_groups no localStorage:", e);
      }
    }
  }, [accessGroups, isClient]);

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

  const currentOperator = operators.find((op) => op.id === currentOperatorId) || operators[0];
  const currentGroup = accessGroups.find((g) => g.id === currentOperator.groupId) || accessGroups[0];

  const operatorProfile: OperatorProfile = {
    name: currentOperator.name,
    email: currentOperator.email,
    avatar: currentOperator.avatar,
    status: currentOperator.status,
  };

  const updateOperatorProfile = (fields: Partial<OperatorProfile>) => {
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
  const createOperator = (opData: Omit<Operator, "id" | "status" | "avatar">) => {
    const newOp: Operator = {
      ...opData,
      id: `op-${Date.now()}`,
      status: "disponivel",
      avatar: `https://i.pravatar.cc/80?img=${Math.floor(Math.random() * 70)}`,
    };
    setOperators((prev) => [...prev, newOp]);
  };

  const updateOperator = (id: string, fields: Partial<Operator>) => {
    setOperators((prev) =>
      prev.map((op) => (op.id === id ? { ...op, ...fields } : op))
    );
  };

  const deleteOperator = (id: string) => {
    if (id === currentOperatorId) return;
    setOperators((prev) => prev.filter((op) => op.id !== id));
  };

  const resetOperatorPassword = (id: string, newPasswordHash: string) => {
    setOperators((prev) =>
      prev.map((op) => (op.id === id ? { ...op, passwordHash: newPasswordHash } : op))
    );
  };

  // CRUD Access Groups
  const createAccessGroup = (groupData: Omit<AccessGroup, "id">) => {
    const newGroup: AccessGroup = {
      ...groupData,
      id: `group-${Date.now()}`,
    };
    setAccessGroups((prev) => [...prev, newGroup]);
  };

  const updateAccessGroup = (id: string, fields: Partial<AccessGroup>) => {
    setAccessGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...fields } : g))
    );
  };

  const deleteAccessGroup = (id: string) => {
    if (id === "group-admin") return;
    setAccessGroups((prev) => prev.filter((g) => g.id !== id));
    setOperators((prev) =>
      prev.map((op) => (op.groupId === id ? { ...op, groupId: "group-whats-only" } : op))
    );
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

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";
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
  const sendMessage = async (text: string, isInternalNote = false) => {
    if (!selectedChatId) return;

    const currentChat = conversations.find((c) => c.id === selectedChatId);
    if (!currentChat) return;

    const shouldSendReal =
      tenant === "valem" &&
      currentChat.channel === "whatsapp" &&
      !isInternalNote;

    if (shouldSendReal && currentChat.phone) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/baileys/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: "valem",
            phone: currentChat.phone,
            text,
            conversationId: selectedChatId,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Erro na resposta do envio de mensagem");
        }
      } catch (err: any) {
        console.error("Falha ao enviar mensagem de WhatsApp pelo backend:", err);
        toast.error(`Erro ao enviar mensagem: ${err.message || "Conexão falhou"}`);
      }
    }

    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      author: isInternalNote ? "Vendedor" : "Você",
      text,
      time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      side: "out",
      isInternalNote,
    };

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === selectedChatId) {
          return {
            ...c,
            lastMessageTime: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            messages: [...c.messages, newMessage],
          };
        }
        return c;
      })
    );
  };

  const captureChat = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          // Add system internal note
          const systemMsg: Message = {
            id: `sys-${Date.now()}`,
            author: "Sistema",
            text: `Conversa capturada por Vendedor Humano.`,
            time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            side: "out",
            isInternalNote: true,
          };
          return {
            ...c,
            queue: "meus",
            messages: [...c.messages, systemMsg],
          };
        }
        return c;
      })
    );
    setActiveQueue("meus");
    setSelectedChatId(id);
  };

  const transferChat = (id: string, department: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const systemMsg: Message = {
            id: `sys-${Date.now()}`,
            author: "Sistema",
            text: `Conversa transferida para o departamento: ${department}. Voltando para a Fila de Espera.`,
            time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            side: "out",
            isInternalNote: true,
          };
          return {
            ...c,
            queue: "fila",
            messages: [...c.messages, systemMsg],
          };
        }
        return c;
      })
    );
    setActiveQueue("fila");
    setSelectedChatId(id);
  };

  const finishChat = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const systemMsg: Message = {
            id: `sys-${Date.now()}`,
            author: "Sistema",
            text: `Conversa encerrada e movida para Finalizados.`,
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
  };

  const updateTags = (id: string, tags: string[]) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, tags } : c))
    );
  };

  const updateClientInfo = (id: string, fields: Partial<Pick<Conversation, "name" | "phone" | "email" | "cnpj">>) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...fields } : c))
    );
  };

  const createContact = (name: string, phone: string, email: string, cnpj: string, channel: Channel) => {
    const newId = `${tenant}-contact-${Date.now()}`;
    const initials = name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
    const colors = ["#e9d5b8", "#f2a6a6", "#c3f2a6", "#a6d6f2", "#d6a6f2"];
    const initialsBg = colors[Math.floor(Math.random() * colors.length)];

    const newConversation: Conversation = {
      id: newId,
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
    setSelectedChatId(newId);
    return newId;
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
        } else if (data.type === "qr") {
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.qr)}`;
          setBaileysConfig((prev) => ({
            ...prev,
            status: "qr_ready",
            qrCodeUrl: qrUrl,
          }));
        } else if (data.type === "contact_avatar") {
          setConversations((prev) =>
            prev.map((c) =>
              c.phone === data.phone
                ? { ...c, avatar: data.avatar }
                : c
            )
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
                queue: "fila",
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

        operators,
        accessGroups,
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
        
        sendMessage,
        captureChat,
        transferChat,
        finishChat,
        updateTags,
        updateClientInfo,
        createContact,
        
        metaConfig,
        setMetaConfig,
        baileysConfig,
        setBaileysConfig,
        disconnectBaileys,
        connectBaileys,
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
