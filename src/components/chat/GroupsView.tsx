import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useChat, Operator, AccessGroup } from "@/hooks/useChatState";

interface OperatorWalletCardProps {
  op: Operator;
}

function OperatorWalletCard({ op }: OperatorWalletCardProps) {
  const {
    conversations,
    operators,
    updateContactWallet,
    setSelectedChatId,
    setActiveView,
    setActiveQueue,
  } = useChat();

  // Dropdown de busca para adicionar cliente
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Modal de transferência de carteira (portal)
  const [transferTarget, setTransferTarget] = useState<any | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const opClients = conversations.filter(c => c.walletOperatorId === op.id);
  const availableClients = conversations.filter(c => c.walletOperatorId !== op.id);
  const otherOperators = operators.filter(o => o.id !== op.id);

  const filteredClients = availableClients.filter(c => {
    const searchLower = search.toLowerCase();
    const matchesName = c.name?.toLowerCase().includes(searchLower);
    const matchesPhone = c.phone?.toLowerCase().includes(searchLower);
    return matchesName || matchesPhone;
  });

  const handleSelectClient = (c: any) => {
    setSelectedClientId(c.contactId || c.id);
    setSearch(`${c.name} (${c.phone || "Sem tel"})`);
    setIsOpen(false);
  };

  const handleAdd = () => {
    if (selectedClientId) {
      updateContactWallet(selectedClientId, op.id);
      setSelectedClientId(null);
      setSearch("");
    } else {
      toast.warning("Selecione um cliente da lista primeiro.");
    }
  };

  // Abre a conversa ativa do cliente no módulo de chat
  const handleOpenChat = (client: any) => {
    const activeConv = conversations.find(
      (c) =>
        (c.contactId === client.contactId || c.id === client.id) &&
        c.queue !== "finalizados"
    );
    if (!activeConv) {
      toast.info("Este cliente não possui atendimento ativo no momento.");
      return;
    }
    setActiveQueue(activeConv.queue);
    setSelectedChatId(activeConv.id);
    setActiveView("chat");
  };

  // Confirma a transferência de carteira (e atendimento ativo) para outro operador
  const handleConfirmTransfer = async (client: any, targetOp: Operator) => {
    setTransferTarget(null);
    const contactId = client.contactId || client.id;
    await updateContactWallet(contactId, targetOp.id, targetOp.id);
    toast.success(`${client.name} transferido(a) para a carteira de ${targetOp.name}.`);
  };

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between min-h-[320px] relative">
        <div>
          {/* Cabecalho do Operador */}
          <div className="flex items-center gap-3 border-b border-line pb-3 mb-4">
            <img
              src={op.avatar || "https://i.pravatar.cc/80"}
              alt={op.name}
              className="h-10 w-10 rounded-full object-cover border border-border shadow-xs"
            />
            <div>
              <h4 className="font-bold text-sm text-foreground">{op.name}</h4>
              <span className="text-[10px] text-muted-foreground block">{op.email}</span>
            </div>
          </div>

          {/* Lista de Clientes da Carteira */}
          <div className="space-y-2 max-h-[160px] overflow-y-auto scrollbar-thin pr-1 mb-4">
            <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block mb-1">
              Clientes na Carteira ({opClients.length})
            </span>
            {opClients.length > 0 ? (
              opClients.map((client) => {
                const hasActive = conversations.some(
                  (c) =>
                    (c.contactId === client.contactId || c.id === client.id) &&
                    c.queue !== "finalizados"
                );
                return (
                  <div
                    key={client.id}
                    className="group flex items-center justify-between gap-2 bg-muted/40 hover:bg-muted/70 rounded-xl px-3 py-2 border border-border/40 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold text-foreground block truncate">{client.name}</span>
                      <span className="text-[10px] text-muted-foreground block truncate">
                        {client.phone || "Sem telefone"}
                        {hasActive && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-emerald-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                            ativo
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Botões de Ação — visíveis no hover */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {/* 1. Abrir Conversa */}
                      <button
                        onClick={() => handleOpenChat(client)}
                        className="grid h-7 w-7 place-items-center rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition cursor-pointer border-0"
                        title="Abrir conversa"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>

                      {/* 2. Transferir de Carteira */}
                      <button
                        onClick={() => setTransferTarget(client)}
                        className="grid h-7 w-7 place-items-center rounded-lg hover:bg-amber-500/10 text-muted-foreground hover:text-amber-500 transition cursor-pointer border-0"
                        title="Transferir para outra carteira"
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                      </button>

                      {/* 3. Remover da Carteira */}
                      <button
                        onClick={() => updateContactWallet(client.contactId || client.id, null, null)}
                        className="grid h-7 w-7 place-items-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition cursor-pointer border-0"
                        title="Remover da carteira"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-6 text-xs text-muted-foreground italic">
                Nenhum cliente associado a esta carteira.
              </div>
            )}
          </div>
        </div>

        {/* Form para Adicionar Cliente à Carteira (Searchable Dropdown) */}
        <div className="border-t border-line pt-3 mt-auto relative" ref={dropdownRef}>
          <span className="text-[9px] font-extrabold uppercase text-muted-foreground tracking-wider block mb-1.5">
            Adicionar Cliente
          </span>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedClientId(null);
                    setIsOpen(true);
                  }}
                  onFocus={() => setIsOpen(true)}
                  placeholder="Buscar por nome ou telefone..."
                  className="h-9 w-full rounded-xl bg-muted pl-3 pr-10 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary border border-transparent transition"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                  <Search className="h-3.5 w-3.5" />
                </span>
              </div>

              {isOpen && (
                <div className="absolute left-0 right-0 bottom-full mb-1 z-35 max-h-[180px] overflow-y-auto rounded-xl bg-card border border-border shadow-card py-1.5 scrollbar-thin animate-in fade-in slide-in-from-bottom-2 duration-150">
                  {filteredClients.length > 0 ? (
                    filteredClients.map((c) => {
                      const owner = c.walletOperatorId ? operators.find(o => o.id === c.walletOperatorId) : null;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectClient(c)}
                          className="flex w-full flex-col text-left px-3.5 py-2 hover:bg-muted/80 transition cursor-pointer border-0"
                        >
                          <span className="text-xs font-bold text-foreground block truncate">{c.name}</span>
                          <span className="text-[10px] text-muted-foreground block truncate">
                            {c.phone || "Sem tel"} {owner ? `• Carteira de: ${owner.name}` : ""}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-3.5 py-3 text-center text-xs text-muted-foreground italic">
                      Nenhum cliente disponível
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={handleAdd}
              className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 cursor-pointer shadow-soft transition-transform active:scale-95 shrink-0 border-0"
              title="Vincular à carteira"
            >
              <Plus className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Transferência de Carteira — renderizado via portal para não ser cortado pelo overflow */}
      {transferTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4"
            onClick={() => setTransferTarget(null)}
          >
            <div
              className="w-full max-w-sm rounded-3xl bg-card border border-border p-6 shadow-card animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-extrabold text-foreground">Transferir Carteira</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Mover <span className="font-bold text-foreground">{transferTarget.name}</span> para:
                  </p>
                </div>
                <button
                  onClick={() => setTransferTarget(null)}
                  className="grid h-8 w-8 place-items-center rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer border-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Lista de operadores destino */}
              <div className="space-y-2 max-h-[260px] overflow-y-auto scrollbar-thin">
                {otherOperators.length > 0 ? (
                  otherOperators.map((targetOp) => (
                    <button
                      key={targetOp.id}
                      onClick={() => handleConfirmTransfer(transferTarget, targetOp)}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-muted/40 hover:bg-primary/10 border border-border/40 hover:border-primary/30 transition cursor-pointer text-left group"
                    >
                      <img
                        src={targetOp.avatar || "https://i.pravatar.cc/40"}
                        alt={targetOp.name}
                        className="h-8 w-8 rounded-full object-cover border border-border shrink-0"
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-foreground block truncate group-hover:text-primary transition">
                          {targetOp.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground block truncate">{targetOp.email}</span>
                      </div>
                      <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition ml-auto shrink-0" />
                    </button>
                  ))
                ) : (
                  <p className="text-center text-xs text-muted-foreground italic py-4">
                    Nenhum outro operador disponível.
                  </p>
                )}
              </div>

              <p className="text-[10px] text-muted-foreground mt-4 text-center">
                Se houver atendimento ativo, ele será movido automaticamente.
              </p>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
import { 
  Shield, 
  Users, 
  Key, 
  Trash, 
  Plus, 
  Check, 
  AlertCircle, 
  UserPlus, 
  FolderLock, 
  Smartphone, 
  Instagram, 
  Send,
  Eye,
  EyeOff,
  UserCheck,
  Building2,
  Lock,
  Edit,
  ChevronDown,
  Camera,
  Wallet,
  LayoutTemplate,
  X,
  Search,
  MessageSquare,
  ArrowLeftRight
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export function GroupsView() {
  const {
    operators,
    accessGroups,
    sectors,
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
    conversations,
    updateContactWallet,
    quickResponses,
    createQuickResponse,
    updateQuickResponse,
    deleteQuickResponse
  } = useChat();

  // Active sub-views / tabs
  const [activeTab, setActiveTab] = useState<"users" | "groups" | "sectors" | "wallets" | "templates">("users");

  // Quick Responses Form States
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrModalMode, setQrModalMode] = useState<"create" | "edit">("create");
  const [editingQr, setEditingQr] = useState<any | null>(null);
  const [qrForm, setQrForm] = useState({
    shortcut: "",
    text: "",
    description: ""
  });

  const handleOpenCreateQrModal = () => {
    setQrForm({ shortcut: "", text: "", description: "" });
    setQrModalMode("create");
    setEditingQr(null);
    setShowQrModal(true);
  };

  const handleOpenEditQrModal = (qr: any) => {
    setQrForm({
      shortcut: qr.shortcut,
      text: qr.text,
      description: qr.description || ""
    });
    setQrModalMode("edit");
    setEditingQr(qr);
    setShowQrModal(true);
  };

  const handleSaveQr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrForm.shortcut.startsWith("/")) {
      toast.warning("O atalho deve começar com barra '/' (Ex: /saudacao)");
      return;
    }

    if (qrModalMode === "create") {
      createQuickResponse({
        shortcut: qrForm.shortcut,
        text: qrForm.text,
        description: qrForm.description || ""
      });
    } else if (qrModalMode === "edit" && editingQr) {
      updateQuickResponse(editingQr.id, {
        shortcut: qrForm.shortcut,
        text: qrForm.text,
        description: qrForm.description || ""
      });
      toast.success("Resposta rápida atualizada!");
    }
    setShowQrModal(false);
  };

  const handleDeleteQr = (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta resposta rápida global?")) {
      deleteQuickResponse(id);
    }
  };

  // Operator Form States
  const [showOpForm, setShowOpForm] = useState(false);
  const [opForm, setOpForm] = useState({
    name: "",
    email: "",
    password: "",
    groupId: accessGroups[0]?.id || ""
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedOpIdForAvatar, setSelectedOpIdForAvatar] = useState<string | null>(null);

  const handleAvatarClick = (opId: string) => {
    setSelectedOpIdForAvatar(opId);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 50);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedOpIdForAvatar) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            
            const size = 120;
            canvas.width = size;
            canvas.height = size;
            
            if (ctx) {
              const minSize = Math.min(img.width, img.height);
              const sx = (img.width - minSize) / 2;
              const sy = (img.height - minSize) / 2;
              
              ctx.drawImage(img, sx, sy, minSize, minSize, 0, 0, size, size);
              const compressedBase64 = canvas.toDataURL("image/jpeg", 0.75);
              
              updateOperator(selectedOpIdForAvatar, { avatar: compressedBase64 });
              toast.success("Foto de perfil atualizada!");
            }
          };
          img.src = reader.result;
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Sector Form States
  const [showSectorForm, setShowSectorForm] = useState(false);
  const [sectorFormName, setSectorFormName] = useState("");
  const [selectedSectorId, setSelectedSectorId] = useState<string>("");

  // Initialize selectedSectorId on load or default
  React.useEffect(() => {
    if (sectors.length > 0 && !selectedSectorId) {
      setSelectedSectorId(sectors[0].id);
    }
  }, [sectors, selectedSectorId]);

  const selectedSectorObj = sectors.find(s => s.id === selectedSectorId) || sectors[0];

  // Group Form States
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupForm, setGroupForm] = useState({
    name: "",
    allowedTenants: [] as ("tecfag" | "valem")[],
    allowedChannels: [] as ("whatsapp" | "instagram" | "messenger")[],
    canCreateUser: false,
    canResetPassword: false,
    canEditProfile: true
  });

  // Password Reset States
  const [resetOpId, setResetOpId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Selected Group for Editing Details
  const [selectedGroupId, setSelectedGroupId] = useState<string>(accessGroups[0]?.id || "");
  const selectedGroupObj = accessGroups.find(g => g.id === selectedGroupId) || accessGroups[0];

  const handleCreateOperator = (e: React.FormEvent) => {
    e.preventDefault();
    if (!opForm.name || !opForm.email || !opForm.password || !opForm.groupId) {
      toast.error("Por favor, preencha todos os campos obrigatórios.");
      return;
    }
    createOperator({
      name: opForm.name,
      email: opForm.email,
      passwordHash: opForm.password,
      groupId: opForm.groupId
    });
    setOpForm({
      name: "",
      email: "",
      password: "",
      groupId: accessGroups[0]?.id || ""
    });
    setShowOpForm(false);
    toast.success("Operador criado com sucesso!");
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.name) {
      toast.error("Por favor, preencha o nome do grupo.");
      return;
    }
    if (groupForm.allowedTenants.length === 0) {
      toast.error("Selecione pelo menos uma empresa permitida.");
      return;
    }
    if (groupForm.allowedChannels.length === 0) {
      toast.error("Selecione pelo menos um canal permitido.");
      return;
    }
    createAccessGroup({
      name: groupForm.name,
      allowedTenants: groupForm.allowedTenants,
      allowedChannels: groupForm.allowedChannels,
      canCreateUser: groupForm.canCreateUser,
      canResetPassword: groupForm.canResetPassword,
      canEditProfile: groupForm.canEditProfile
    });
    setGroupForm({
      name: "",
      allowedTenants: [],
      allowedChannels: [],
      canCreateUser: false,
      canResetPassword: false,
      canEditProfile: true
    });
    setShowGroupForm(false);
    toast.success("Grupo de acesso criado com sucesso!");
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetOpId || !newPassword) return;
    resetOperatorPassword(resetOpId, newPassword);
    setResetOpId(null);
    setNewPassword("");
    toast.success("Senha redefinida com sucesso!");
  };

  const handleCreateSector = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sectorFormName) {
      toast.error("Por favor, preencha o nome do setor.");
      return;
    }
    createSector(sectorFormName);
    setSectorFormName("");
    setShowSectorForm(false);
  };

  const toggleTenantSelection = (tenant: "tecfag" | "valem") => {
    setGroupForm(prev => {
      const alreadySelected = prev.allowedTenants.includes(tenant);
      const allowedTenants = alreadySelected
        ? prev.allowedTenants.filter(t => t !== tenant)
        : [...prev.allowedTenants, tenant];
      return { ...prev, allowedTenants };
    });
  };

  const toggleChannelSelection = (channel: "whatsapp" | "instagram" | "messenger") => {
    setGroupForm(prev => {
      const alreadySelected = prev.allowedChannels.includes(channel);
      const allowedChannels = alreadySelected
        ? prev.allowedChannels.filter(c => c !== channel)
        : [...prev.allowedChannels, channel];
      return { ...prev, allowedChannels };
    });
  };

  const updateGroupPermission = (groupId: string, field: keyof AccessGroup, value: any) => {
    // Prevent removing admin permission entirely
    if (groupId === "group-admin" && (field === "allowedTenants" || field === "allowedChannels") && value.length === 0) {
      toast.warning("O grupo Administradores precisa ter acesso a pelo menos um tenant/canal.");
      return;
    }
    updateAccessGroup(groupId, { [field]: value });
    toast.success("Permissões do grupo atualizadas.");
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-chat-panel p-6 shadow-soft overflow-y-auto scrollbar-thin select-none">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
      
      {/* 1. Header & Perms Simulation Banner */}
      <header className="mb-6 shrink-0">
        <span className="text-xs font-bold uppercase tracking-wider text-primary">
          Segurança & Acessos
        </span>
        <h2 className="text-2xl font-black text-foreground mt-0.5">
          Painel de Controle de Grupos de Acesso
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie usuários cadastrados, defina senhas e controle limites de visibilidade por tenant e canal.
        </p>
      </header>

      {/* Simulator Section */}
      <div className="mb-6 rounded-2xl bg-primary p-5 text-white shadow-soft relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div className="absolute right-0 top-0 h-32 w-32 translate-x-8 -translate-y-8 rounded-full bg-white/10 blur-xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-white/20 text-white">
            <UserCheck className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="text-base font-bold">Modo de Simulação de Permissões</h3>
            <p className="text-xs text-white/80 max-w-lg mt-0.5">
              Simule a experiência do sistema operando sob o perfil de outro usuário. Veja a barra de tenants, lista de chats e filtros de canal se reconfigurarem instantaneamente.
            </p>
          </div>
        </div>
        <div className="relative flex items-center gap-3 self-start md:self-auto shrink-0 bg-white/10 hover:bg-white/20 p-2 rounded-xl border border-white/20 transition-all duration-200">
          <label className="text-xs font-extrabold uppercase tracking-wide whitespace-nowrap pl-1">
            Operador Ativo:
          </label>
          <div className="relative flex items-center">
            <select
              value={currentOperatorId}
              onChange={(e) => impersonateOperator(e.target.value)}
              className="appearance-none bg-card text-foreground rounded-lg pl-3 pr-8 py-1.5 text-xs font-bold outline-none border border-transparent focus:border-white/30 cursor-pointer select-none"
            >
              {operators.map((op) => {
                const group = accessGroups.find(g => g.id === op.groupId);
                return (
                  <option key={op.id} value={op.id} className="text-foreground font-semibold">
                    {op.name} ({group?.name || "Sem Grupo"})
                  </option>
                );
              })}
            </select>
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-foreground/75">
              <ChevronDown className="h-3 w-3" />
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-line mb-6 gap-6 shrink-0 relative">
        <button
          onClick={() => setActiveTab("users")}
          className={`pb-3 text-sm font-extrabold tracking-tight relative transition-all duration-200 cursor-pointer ${
            activeTab === "users" ? "text-primary font-black" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Operadores & Usuários
          </span>
          {activeTab === "users" && (
            <motion.span
              layoutId="activeGroupsTabIndicator"
              className="absolute bottom-0 left-0 right-0 h-[3px] rounded bg-primary"
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab("groups")}
          className={`pb-3 text-sm font-extrabold tracking-tight relative transition-all duration-200 cursor-pointer ${
            activeTab === "groups" ? "text-primary font-black" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2">
            <FolderLock className="h-4 w-4" /> Grupos de Acesso
          </span>
          {activeTab === "groups" && (
            <motion.span
              layoutId="activeGroupsTabIndicator"
              className="absolute bottom-0 left-0 right-0 h-[3px] rounded bg-primary"
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab("sectors")}
          className={`pb-3 text-sm font-extrabold tracking-tight relative transition-all duration-200 cursor-pointer ${
            activeTab === "sectors" ? "text-primary font-black" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Setores
          </span>
          {activeTab === "sectors" && (
            <motion.span
              layoutId="activeGroupsTabIndicator"
              className="absolute bottom-0 left-0 right-0 h-[3px] rounded bg-primary"
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab("wallets")}
          className={`pb-3 text-sm font-extrabold tracking-tight relative transition-all duration-200 cursor-pointer ${
            activeTab === "wallets" ? "text-primary font-black" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Carteiras Globais
          </span>
          {activeTab === "wallets" && (
            <motion.span
              layoutId="activeGroupsTabIndicator"
              className="absolute bottom-0 left-0 right-0 h-[3px] rounded bg-primary"
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab("templates")}
          className={`pb-3 text-sm font-extrabold tracking-tight relative transition-all duration-200 cursor-pointer ${
            activeTab === "templates" ? "text-primary font-black" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4" /> Templates Globais
          </span>
          {activeTab === "templates" && (
            <motion.span
              layoutId="activeGroupsTabIndicator"
              className="absolute bottom-0 left-0 right-0 h-[3px] rounded bg-primary"
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
            />
          )}
        </button>
      </div>


      {/* Tab Contents */}
      {activeTab === "users" ? (
        /* USERS / OPERATORS TAB */
        <div className="space-y-6">
          {/* Header Action */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-extrabold text-foreground">Operadores Cadastrados</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Gerenciamento de contas e credenciais dos atendentes.</p>
            </div>
            <button
              onClick={() => setShowOpForm(!showOpForm)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer transition-transform duration-150 active:scale-95"
            >
              <UserPlus className="h-4 w-4" />
              {showOpForm ? "Fechar Cadastro" : "Adicionar Operador"}
            </button>
          </div>

          {/* New Operator Form */}
          {showOpForm && (
            <form onSubmit={handleCreateOperator} className="p-5 rounded-2xl bg-card border border-border shadow-soft grid grid-cols-1 md:grid-cols-4 gap-4 animate-in fade-in slide-in-from-top-3 duration-200">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={opForm.name}
                  onChange={(e) => setOpForm({ ...opForm, name: e.target.value })}
                  placeholder="Ex: Carlos Santos"
                  className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-transparent"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">E-mail Corporativo</label>
                <input
                  type="email"
                  required
                  value={opForm.email}
                  onChange={(e) => setOpForm({ ...opForm, email: e.target.value })}
                  placeholder="carlos@empresa.com"
                  className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-transparent"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">Senha Inicial</label>
                <input
                  type="password"
                  required
                  value={opForm.password}
                  onChange={(e) => setOpForm({ ...opForm, password: e.target.value })}
                  placeholder="******"
                  className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-transparent"
                />
              </div>
              <div className="space-y-1 flex flex-col justify-between">
                <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">Grupo de Acesso</label>
                <div className="flex gap-2">
                  <div className="relative flex-1 flex items-center">
                    <select
                      value={opForm.groupId}
                      onChange={(e) => setOpForm({ ...opForm, groupId: e.target.value })}
                      className="appearance-none h-10 w-full rounded-xl bg-muted pl-3.5 pr-10 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-transparent cursor-pointer select-none"
                    >
                      {accessGroups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                      <ChevronDown className="h-4 w-4" />
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 cursor-pointer shadow-soft transition-transform active:scale-95 shrink-0"
                    title="Confirmar Cadastro"
                  >
                    <Check className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Password Reset Modal Panel */}
          {resetOpId && (
            <div className="p-5 rounded-2xl bg-card border-2 border-primary/20 bg-primary-soft/10 shadow-card animate-in zoom-in-95 duration-150">
              <form onSubmit={handleResetPassword} className="flex flex-col md:flex-row items-end gap-4">
                <div className="flex-1 space-y-1.5">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-primary">
                    Redefinir Senha do Operador: {operators.find(o => o.id === resetOpId)?.name}
                  </h4>
                  <div className="relative mt-1">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Insira a nova senha segura..."
                      className="h-10 w-full rounded-xl bg-muted px-3.5 pr-10 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-transparent bg-card"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="h-10 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer"
                  >
                    Salvar Nova Senha
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResetOpId(null);
                      setNewPassword("");
                    }}
                    className="h-10 rounded-xl border border-border bg-card px-4 text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Operators Grid/List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {operators.map((op) => {
              const group = accessGroups.find(g => g.id === op.groupId);
              const isMe = op.id === currentOperatorId;
              
              return (
                <div 
                  key={op.id} 
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl bg-card p-4 border transition-all duration-200 ${
                    isMe ? "border-primary/40 shadow-soft bg-primary-soft/5" : "border-border shadow-xs hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div 
                      onClick={() => handleAvatarClick(op.id)} 
                      className="relative group cursor-pointer h-12 w-12 shrink-0 rounded-full overflow-hidden border border-border shadow-xs"
                      title="Alterar Foto do Operador"
                    >
                      <img
                        src={op.avatar || "https://i.pravatar.cc/80"}
                        alt={op.name}
                        className="h-full w-full object-cover border-0"
                      />
                      <div className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera className="h-4 w-4 text-white animate-in zoom-in-75 duration-100" />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-foreground">{op.name}</span>
                        {isMe && (
                          <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[8px] font-black uppercase text-primary tracking-wide">
                            Você / Ativo
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground block">{op.email}</span>
                      
                      {/* Active Permissions Badges */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold text-foreground capitalize border border-border">
                          Grupo: {group?.name || "Sem Grupo"}
                        </span>
                        
                        {/* Display channels allowed */}
                        {group?.allowedChannels.map(c => (
                          <span 
                            key={c}
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold border ${
                              c === "whatsapp" 
                                ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
                                : c === "instagram" 
                                ? "bg-purple-50 text-purple-600 border-purple-100"
                                : "bg-blue-50 text-blue-600 border-blue-100"
                            }`}
                          >
                            {c === "whatsapp" ? "whats" : c}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Actions Buttons */}
                  <div className="flex items-center gap-1.5 self-end sm:self-auto pt-2 sm:pt-0">
                    <button
                      onClick={() => {
                        setResetOpId(op.id);
                        setNewPassword("");
                        setShowPassword(false);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                      title="Redefinir Senha"
                    >
                      <Key className="h-4 w-4" />
                    </button>
                    
                    <button
                      disabled={isMe}
                      onClick={() => {
                        deleteOperator(op.id);
                        toast.success("Operador excluído.");
                      }}
                      className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                        isMe 
                          ? "text-muted-foreground/30 cursor-not-allowed" 
                          : "hover:bg-red-50 text-red-500 hover:text-red-600 cursor-pointer"
                      }`}
                      title={isMe ? "Você não pode se excluir" : "Excluir Atendente"}
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeTab === "groups" ? (
        /* ACCESS GROUPS TAB */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column: Access Groups List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-foreground">Grupos Ativos</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Clique em um grupo para editar permissões.</p>
              </div>
              <button
                onClick={() => setShowGroupForm(!showGroupForm)}
                className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer transition-transform duration-100 active:scale-95"
                title="Novo Grupo"
              >
                {showGroupForm ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </button>
            </div>

            {/* Create Group Form */}
            {showGroupForm && (
              <form onSubmit={handleCreateGroup} className="p-4 rounded-2xl bg-card border border-border shadow-soft space-y-4 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">Nome do Grupo</label>
                  <input
                    type="text"
                    required
                    value={groupForm.name}
                    onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                    placeholder="Ex: Comercial WhatsApp"
                    className="h-9 w-full rounded-xl bg-muted px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-transparent"
                  />
                </div>

                {/* Tenants Selectors */}
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">Empresas Permitidas</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => toggleTenantSelection("tecfag")}
                      className={`flex-1 h-8 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                        groupForm.allowedTenants.includes("tecfag")
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-transparent hover:bg-border"
                      }`}
                    >
                      Tecfag Chat
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleTenantSelection("valem")}
                      className={`flex-1 h-8 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                        groupForm.allowedTenants.includes("valem")
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-transparent hover:bg-border"
                      }`}
                    >
                      Valem Chat
                    </button>
                  </div>
                </div>

                {/* Channels Selectors */}
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">Canais Permitidos</label>
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => toggleChannelSelection("whatsapp")}
                      className={`flex-1 h-8 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer min-w-[70px] ${
                        groupForm.allowedChannels.includes("whatsapp")
                          ? "bg-emerald-500 border-emerald-500 text-white shadow-soft"
                          : "bg-muted text-muted-foreground border-transparent hover:bg-border"
                      }`}
                    >
                      Whats
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleChannelSelection("instagram")}
                      className={`flex-1 h-8 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer min-w-[70px] ${
                        groupForm.allowedChannels.includes("instagram")
                          ? "bg-purple-600 border-purple-600 text-white shadow-soft"
                          : "bg-muted text-muted-foreground border-transparent hover:bg-border"
                      }`}
                    >
                      Insta
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleChannelSelection("messenger")}
                      className={`flex-1 h-8 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer min-w-[70px] ${
                        groupForm.allowedChannels.includes("messenger")
                          ? "bg-blue-600 border-blue-600 text-white shadow-soft"
                          : "bg-muted text-muted-foreground border-transparent hover:bg-border"
                      }`}
                    >
                      Messenger
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-line flex justify-end gap-2">
                  <button
                    type="submit"
                    className="h-8 rounded-lg bg-primary px-4 text-[10px] font-bold text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGroupForm(false)}
                    className="h-8 rounded-lg border border-border bg-card px-3 text-[10px] font-bold text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {/* List groups items */}
            <div className="space-y-2">
              {accessGroups.map((g) => {
                const isSelected = g.id === selectedGroupId;
                const membersCount = operators.filter(o => o.groupId === g.id).length;
                
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGroupId(g.id)}
                    className={`w-full flex items-center justify-between rounded-xl p-3 text-left border transition-all ${
                      isSelected
                        ? "bg-primary-soft/40 border-primary text-foreground"
                        : "bg-card border-border hover:border-muted-foreground/20 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                        isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}>
                        <Lock className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="font-extrabold text-xs block text-foreground">{g.name}</span>
                        <span className="text-[10px] text-muted-foreground">{membersCount} membro(s)</span>
                      </div>
                    </div>
                    {g.id !== "group-admin" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAccessGroup(g.id);
                          setSelectedGroupId("group-admin");
                          toast.success("Grupo de acesso excluído.");
                        }}
                        className="h-7 w-7 grid place-items-center rounded hover:bg-red-50 text-red-500 transition cursor-pointer"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Permissions Settings Panel for Selected Group */}
          <div className="lg:col-span-2 rounded-2xl bg-card border border-border shadow-soft p-6 space-y-6">
            <header className="border-b border-line pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-extrabold text-foreground flex items-center gap-1.5">
                  <Shield className="h-4.5 w-4.5 text-primary" /> Permissões de Acesso: <span className="text-primary font-black">{selectedGroupObj.name}</span>
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">Edite em tempo real as autorizações concedidas a este grupo.</p>
              </div>
            </header>

            <div className="space-y-6">
              
              {/* Allowed Tenants boundary settings */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-primary" />
                  <h5 className="text-xs font-black text-foreground uppercase tracking-wide">Boundary de Tenants (Empresas)</h5>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Determine quais Tenants as contas deste grupo estão autorizadas a acessar e monitorar.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div 
                    onClick={() => {
                      const alreadySelected = selectedGroupObj.allowedTenants.includes("tecfag");
                      const allowedTenants = alreadySelected
                        ? selectedGroupObj.allowedTenants.filter(t => t !== "tecfag")
                        : [...selectedGroupObj.allowedTenants, "tecfag"];
                      updateGroupPermission(selectedGroupId, "allowedTenants", allowedTenants);
                    }}
                    className={`rounded-2xl p-4 border-2 transition cursor-pointer hover:bg-muted/10 ${
                      selectedGroupObj.allowedTenants.includes("tecfag")
                        ? "border-primary bg-primary-soft/5"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <img src="/logo_tecfag.png" alt="Tecfag logo" className="h-8 w-8 rounded-lg object-cover bg-white" />
                      <div>
                        <span className="font-extrabold text-xs block text-foreground">Tecfag Chat</span>
                        <span className="text-[10px] text-muted-foreground">Acesso ao Meta Cloud API</span>
                      </div>
                    </div>
                  </div>

                  <div 
                    onClick={() => {
                      const alreadySelected = selectedGroupObj.allowedTenants.includes("valem");
                      const allowedTenants = alreadySelected
                        ? selectedGroupObj.allowedTenants.filter(t => t !== "valem")
                        : [...selectedGroupObj.allowedTenants, "valem"];
                      updateGroupPermission(selectedGroupId, "allowedTenants", allowedTenants);
                    }}
                    className={`rounded-2xl p-4 border-2 transition cursor-pointer hover:bg-muted/10 ${
                      selectedGroupObj.allowedTenants.includes("valem")
                        ? "border-primary bg-primary-soft/5"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <img src="/logo_valem.jpg" alt="Valem logo" className="h-8 w-8 rounded-lg object-cover bg-white" />
                      <div>
                        <span className="font-extrabold text-xs block text-foreground">Valem Chat</span>
                        <span className="text-[10px] text-muted-foreground">Acesso ao Baileys API</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Allowed Channels settings */}
              <div className="space-y-3 pt-4 border-t border-line">
                <div className="flex items-center gap-1.5">
                  <Smartphone className="h-4 w-4 text-primary" />
                  <h5 className="text-xs font-black text-foreground uppercase tracking-wide">Boundary de Canais (Atendimento)</h5>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Habilite ou desabilite canais de entrada. Usuários sem acesso a um canal não visualizam as mensagens e filtros do mesmo.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* WhatsApp */}
                  <div 
                    onClick={() => {
                      const alreadySelected = selectedGroupObj.allowedChannels.includes("whatsapp");
                      const allowedChannels = alreadySelected
                        ? selectedGroupObj.allowedChannels.filter(c => c !== "whatsapp")
                        : [...selectedGroupObj.allowedChannels, "whatsapp"];
                      updateGroupPermission(selectedGroupId, "allowedChannels", allowedChannels);
                    }}
                    className={`rounded-xl p-3 border transition cursor-pointer hover:bg-muted/10 flex items-center gap-3 ${
                      selectedGroupObj.allowedChannels.includes("whatsapp")
                        ? "border-emerald-500 bg-emerald-50/10 text-emerald-600 font-bold"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    <Smartphone className="h-5 w-5 shrink-0" />
                    <div>
                      <span className="text-xs font-extrabold block text-foreground">WhatsApp</span>
                      <span className="text-[9px] text-muted-foreground block font-normal">Envio e recepção</span>
                    </div>
                  </div>

                  {/* Instagram */}
                  <div 
                    onClick={() => {
                      const alreadySelected = selectedGroupObj.allowedChannels.includes("instagram");
                      const allowedChannels = alreadySelected
                        ? selectedGroupObj.allowedChannels.filter(c => c !== "instagram")
                        : [...selectedGroupObj.allowedChannels, "instagram"];
                      updateGroupPermission(selectedGroupId, "allowedChannels", allowedChannels);
                    }}
                    className={`rounded-xl p-3 border transition cursor-pointer hover:bg-muted/10 flex items-center gap-3 ${
                      selectedGroupObj.allowedChannels.includes("instagram")
                        ? "border-purple-500 bg-purple-50/10 text-purple-600 font-bold"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    <Instagram className="h-5 w-5 shrink-0" />
                    <div>
                      <span className="text-xs font-extrabold block text-foreground">Instagram</span>
                      <span className="text-[9px] text-muted-foreground block font-normal">DMs e Comentários</span>
                    </div>
                  </div>

                  {/* Messenger */}
                  <div 
                    onClick={() => {
                      const alreadySelected = selectedGroupObj.allowedChannels.includes("messenger");
                      const allowedChannels = alreadySelected
                        ? selectedGroupObj.allowedChannels.filter(c => c !== "messenger")
                        : [...selectedGroupObj.allowedChannels, "messenger"];
                      updateGroupPermission(selectedGroupId, "allowedChannels", allowedChannels);
                    }}
                    className={`rounded-xl p-3 border transition cursor-pointer hover:bg-muted/10 flex items-center gap-3 ${
                      selectedGroupObj.allowedChannels.includes("messenger")
                        ? "border-blue-500 bg-blue-50/10 text-blue-600 font-bold"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    <Send className="h-5 w-5 shrink-0" />
                    <div>
                      <span className="text-xs font-extrabold block text-foreground">Messenger</span>
                      <span className="text-[9px] text-muted-foreground block font-normal">Facebook inbox</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Functional permissions checkboxes */}
              <div className="space-y-3 pt-4 border-t border-line">
                <div className="flex items-center gap-1.5">
                  <Lock className="h-4 w-4 text-primary" />
                  <h5 className="text-xs font-black text-foreground uppercase tracking-wide">Ações & Operações no Sistema</h5>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Defina os limites de controle e administração para membros deste grupo de acesso.
                </p>
                <div className="space-y-2">
                  {/* Create Users */}
                  <label className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedGroupObj.canCreateUser}
                      onChange={(e) => updateGroupPermission(selectedGroupId, "canCreateUser", e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-extrabold block text-foreground">Criar e Gerenciar Atendentes</span>
                      <span className="text-[10px] text-muted-foreground block">Autoriza criar novos perfis de operadores e definir senhas.</span>
                    </div>
                  </label>

                  {/* Reset Password */}
                  <label className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedGroupObj.canResetPassword}
                      onChange={(e) => updateGroupPermission(selectedGroupId, "canResetPassword", e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-extrabold block text-foreground">Redefinição de Senha de Terceiros</span>
                      <span className="text-[10px] text-muted-foreground block">Autoriza redefinir senhas de outros atendentes do painel.</span>
                    </div>
                  </label>

                  {/* Edit Profile */}
                  <label className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedGroupObj.canEditProfile}
                      onChange={(e) => updateGroupPermission(selectedGroupId, "canEditProfile", e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-extrabold block text-foreground">Edição de Perfis Ativos</span>
                      <span className="text-[10px] text-muted-foreground block">Permite aos atendentes editarem suas próprias fotos e dados cadastrais.</span>
                    </div>
                  </label>
                </div>
              </div>

            </div>
          </div>
        </div>
      ) : activeTab === "sectors" ? (
        /* SECTORS TAB */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column: Sectors List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-foreground">Setores Ativos</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Clique em um setor para gerenciar membros.</p>
              </div>
              <button
                onClick={() => setShowSectorForm(!showSectorForm)}
                className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer transition-transform duration-100 active:scale-95 animate-in fade-in"
                title="Novo Setor"
              >
                {showSectorForm ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </button>
            </div>

            {/* Create Sector Form */}
            {showSectorForm && (
              <form onSubmit={handleCreateSector} className="p-4 rounded-2xl bg-card border border-border shadow-soft space-y-4 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">Nome do Setor</label>
                  <input
                    type="text"
                    required
                    value={sectorFormName}
                    onChange={(e) => setSectorFormName(e.target.value)}
                    placeholder="Ex: Suporte Nível 2"
                    className="h-9 w-full rounded-xl bg-muted px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-transparent"
                  />
                </div>
                <div className="pt-2 border-t border-line flex justify-end gap-2">
                  <button
                    type="submit"
                    className="h-8 rounded-lg bg-primary px-4 text-[10px] font-bold text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSectorForm(false)}
                    className="h-8 rounded-lg border border-border bg-card px-3 text-[10px] font-bold text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {/* List Sectors Items */}
            <div className="space-y-2">
              {sectors.map((s) => {
                const isSelected = s.id === selectedSectorId;
                
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSectorId(s.id)}
                    className={`w-full flex items-center justify-between rounded-xl p-3 text-left border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-primary-soft/40 border-primary text-foreground font-bold"
                        : "bg-card border-border hover:border-muted-foreground/20 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                        isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}>
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="font-extrabold text-xs block text-foreground">{s.name}</span>
                        <span className="text-[10px] text-muted-foreground">{s.operatorIds.length} operador(es)</span>
                      </div>
                    </div>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSector(s.id);
                        setSelectedSectorId(sectors.find(sec => sec.id !== s.id)?.id || "");
                      }}
                      className="h-7 w-7 grid place-items-center rounded hover:bg-red-50 text-red-500 transition cursor-pointer"
                      title="Excluir Setor"
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </button>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Sector Members Details Panel */}
          <div className="lg:col-span-2 rounded-2xl bg-card border border-border shadow-soft p-6 space-y-6">
            {selectedSectorObj ? (
              <>
                <header className="border-b border-line pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-primary shrink-0" />
                      <input
                        type="text"
                        value={selectedSectorObj.name}
                        onChange={(e) => updateSector(selectedSectorObj.id, { name: e.target.value })}
                        className="text-sm font-extrabold text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-1 py-0.5 transition w-full max-w-sm"
                        title="Clique para editar o nome do setor"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Gerencie os atendentes associados a este setor de operação.</p>
                  </div>
                </header>

                <div className="space-y-4">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-primary" />
                    <h5 className="text-xs font-black text-foreground uppercase tracking-wide">Membros do Setor</h5>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Selecione quais operadores realizam atendimentos neste setor. Eles aparecerão no fluxo de transferência.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {operators.map((op) => {
                      const isMember = selectedSectorObj.operatorIds.includes(op.id);
                      const group = accessGroups.find(g => g.id === op.groupId);
                      
                      return (
                        <label
                          key={op.id}
                          className={`flex items-center gap-3 rounded-xl border p-3 hover:bg-muted/30 transition cursor-pointer ${
                            isMember ? "border-primary bg-primary-soft/5" : "border-border bg-card"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isMember}
                            onChange={() => {
                              const newOperatorIds = isMember
                                ? selectedSectorObj.operatorIds.filter(id => id !== op.id)
                                : [...selectedSectorObj.operatorIds, op.id];
                              updateSector(selectedSectorObj.id, { operatorIds: newOperatorIds });
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0 cursor-pointer"
                          />
                          <img src={op.avatar} alt={op.name} className="h-8 w-8 rounded-full object-cover shrink-0" />
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-bold block text-foreground truncate">{op.name}</span>
                            <span className="text-[10px] text-muted-foreground block truncate">{group?.name || "Sem Grupo"}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                <Building2 className="h-12 w-12 text-muted-foreground/30 mb-2" />
                <p className="text-sm font-semibold">Nenhum setor selecionado</p>
                <p className="text-xs">Crie ou selecione um setor no painel ao lado.</p>
              </div>
            )}
          </div>
        </div>
      ) : activeTab === "wallets" ? (
        /* TAB CARTEIRAS GLOBAIS */
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-extrabold text-foreground">Carteirização Global</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Gerencie os clientes associados à carteira de cada vendedor.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {operators.map((op) => (
              <OperatorWalletCard
                key={op.id}
                op={op}
              />
            ))}
          </div>
        </div>
      ) : (
        /* TAB TEMPLATES GLOBAIS */
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-extrabold text-foreground">Respostas Rápidas Globais</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Respostas automáticas gerais que aparecem para todos os atendentes ao digitar "/".</p>
            </div>
            <button
              onClick={handleOpenCreateQrModal}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer transition-transform duration-150 active:scale-95"
            >
              <Plus className="h-4 w-4" />
              Adicionar Resposta Rápida
            </button>
          </div>

          {quickResponses.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in duration-200">
              {quickResponses.map((qr) => (
                <div key={qr.id} className="rounded-2xl border border-border bg-card p-4 shadow-xs flex flex-col justify-between hover:border-muted-foreground/30 transition-all duration-200">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-xs font-black text-primary px-2 py-0.5 bg-primary-soft rounded-lg">
                        {qr.shortcut}
                      </span>
                      {qr.description && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={qr.description}>
                          {qr.description}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground leading-relaxed line-clamp-3 bg-muted/40 p-2.5 rounded-xl border border-border/30 font-medium">
                      {qr.text}
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-line mt-3 pt-2">
                    <button
                      onClick={() => handleOpenEditQrModal(qr)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary-soft hover:text-primary transition cursor-pointer"
                      title="Editar"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => qr.id && handleDeleteQr(qr.id)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition cursor-pointer"
                      title="Excluir"
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-6 text-center">
              <LayoutTemplate className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <h3 className="text-sm font-semibold text-foreground">Nenhuma resposta rápida criada</h3>
              <p className="text-xs text-muted-foreground max-w-sm mt-1">
                Adicione mensagens gerais/templates globais para agilizar os atendimentos da sua equipe.
              </p>
              <button
                onClick={handleOpenCreateQrModal}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-95 transition cursor-pointer shadow-soft"
              >
                <Plus className="h-4 w-4" />
                Criar Primeira Resposta Rápida
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Quick Response Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-6 shadow-card animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
              <h2 className="text-md font-bold text-foreground">
                {qrModalMode === "create" ? "Nova Resposta Rápida Global" : "Editar Resposta Rápida Global"}
              </h2>
              <button
                onClick={() => setShowQrModal(false)}
                className="rounded-lg p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQr} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">Atalho (Shortcut)</label>
                <input
                  type="text"
                  placeholder="Ex: /saudacao"
                  value={qrForm.shortcut}
                  onChange={(e) => setQrForm({ ...qrForm, shortcut: e.target.value })}
                  className="rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:bg-card focus:shadow-soft"
                  required
                />
                <span className="text-[9px] text-muted-foreground">Deve iniciar com barra "/" (ex: `/cnpj`).</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">Descrição (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: Envia as chaves PIX da empresa"
                  value={qrForm.description}
                  onChange={(e) => setQrForm({ ...qrForm, description: e.target.value })}
                  className="rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:bg-card focus:shadow-soft"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">Texto da Mensagem</label>
                <textarea
                  placeholder="Olá! Como posso te ajudar?"
                  value={qrForm.text}
                  onChange={(e) => setQrForm({ ...qrForm, text: e.target.value })}
                  rows={4}
                  className="rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:bg-card focus:shadow-soft resize-none scrollbar-thin leading-relaxed"
                  required
                />
              </div>

              {/* Dica de Variáveis Dinâmicas */}
              <div className="rounded-2xl bg-muted/50 p-3 border border-border/60">
                <span className="text-[9px] font-extrabold uppercase tracking-wide text-primary block mb-2 text-center">
                  Tags Dinâmicas Disponíveis
                </span>
                <div className="grid grid-cols-2 gap-2 text-[9px] text-muted-foreground font-medium">
                  <div className="flex items-center justify-between gap-1.5 bg-card rounded-lg px-2 py-1 border border-border/40">
                    <code className="text-primary font-bold font-mono">{"<<1>>"}</code>
                    <span>Nome do Vendedor</span>
                  </div>
                  <div className="flex items-center justify-between gap-1.5 bg-card rounded-lg px-2 py-1 border border-border/40">
                    <code className="text-primary font-bold font-mono">{"<<2>>"}</code>
                    <span>Nome do Cliente</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-line pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => setShowQrModal(false)}
                  className="rounded-2xl border border-border px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-2xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-95 transition cursor-pointer shadow-soft"
                >
                  <Check className="h-4 w-4" />
                  Salvar Resposta Rápida
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
