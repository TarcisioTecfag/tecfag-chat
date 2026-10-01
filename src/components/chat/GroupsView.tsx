import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, SystemTooltip } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useChat, Operator, AccessGroup } from "@/hooks/useChatState";
import { MultiTenantAccessPanel } from "./MultiTenantAccessPanel";

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
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => handleOpenChat(client)}
                            className="grid h-7 w-7 place-items-center rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition cursor-pointer border-0"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Abrir conversa</TooltipContent>
                      </Tooltip>

                      {/* 2. Transferir de Carteira */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setTransferTarget(client)}
                            className="grid h-7 w-7 place-items-center rounded-lg hover:bg-amber-500/10 text-muted-foreground hover:text-amber-500 transition cursor-pointer border-0"
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Transferir para outra carteira</TooltipContent>
                      </Tooltip>

                      {/* 3. Remover da Carteira */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => updateContactWallet(client.contactId || client.id, null, null)}
                            className="grid h-7 w-7 place-items-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition cursor-pointer border-0"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Remover da carteira</TooltipContent>
                      </Tooltip>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleAdd}
                  className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 cursor-pointer shadow-soft transition-transform active:scale-95 shrink-0 border-0"
                >
                  <Plus className="h-4.5 w-4.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Vincular à carteira</TooltipContent>
            </Tooltip>
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
  ArrowLeftRight,
  Bot,
  PhoneCall,
  BarChart2,
  Settings,
  ClipboardCheck,
  Tag,
  FileText,
  Coins,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Zap,
  Filter,
  Globe,
  Lock,
  Sliders,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  GroupPermissions,
  ROLE_PRESETS,
  DEFAULT_ADMIN_PERMISSIONS,
  normalizeGroupPermissions,
} from "@/lib/rbac";

export function GroupsView() {
  const {
    operators,
    accessGroups,
    sectors,
    currentOperatorId,
    currentGroup,
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
    deleteQuickResponse,
    tenant,
  } = useChat();

  // Active sub-views / tabs
  const [activeTab, setActiveTab] = useState<"users" | "groups" | "sectors" | "wallets" | "templates">("users");

  // Modal de confirmação de exclusão de operador
  const [deleteConfirm, setDeleteConfirm] = useState<{
    operatorId: string;
    operatorName: string;
    linkedCount: number;
    activeCount: number;
    loading: boolean;
  } | null>(null);

  const handleDeleteClick = async (op: any) => {
    // Consulta o backend: quantos atendimentos estão vinculados a este operador
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || "";
      const res = await fetch(`${backendUrl}/api/operators?action=count-linked&id=${op.id}&tenantId=${tenant}`);
      const data = res.ok ? await res.json() : { total: 0, active: 0 };
      setDeleteConfirm({
        operatorId: op.id,
        operatorName: op.name,
        linkedCount: data.total ?? 0,
        activeCount: data.active ?? 0,
        loading: false,
      });
    } catch {
      // Se falhar, abre o modal com count 0 mesmo assim
      setDeleteConfirm({ operatorId: op.id, operatorName: op.name, linkedCount: 0, activeCount: 0, loading: false });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleteConfirm((prev) => prev ? { ...prev, loading: true } : null);
    await deleteOperator(deleteConfirm.operatorId);
    toast.success(`Operador "${deleteConfirm.operatorName}" excluído. Atendimentos desvinculados.`);
    setDeleteConfirm(null);
  };

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

  const emptySector = {
    id: "",
    tenantId: "" as any,
    name: "Carregando Setor...",
    operatorIds: [] as string[],
  };

  const selectedSectorObj = sectors.find(s => s.id === selectedSectorId) || sectors[0] || emptySector;

  // Group Form States
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupForm, setGroupForm] = useState({
    name: "",
    allowedTenants: [] as ("tecfag" | "valem")[],
    allowedChannels: [] as ("whatsapp" | "instagram" | "messenger")[],
    canCreateUser: false,
    canResetPassword: false,
    canEditProfile: true,
    canCaptureChat: false,
    canTransferChat: false,
    canFinishChat: false,
    canViewAllChats: false,
    canOverrideChat: false,
  });

  // Password Reset States
  const [resetOpId, setResetOpId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const emptyGroup: AccessGroup = {
    id: "",
    tenantId: "" as any,
    name: "Carregando Grupo...",
    allowedTenants: [] as ("tecfag" | "valem")[],
    allowedChannels: [] as ("whatsapp" | "instagram" | "messenger")[],
    canCreateUser: false,
    canResetPassword: false,
    canEditProfile: false,
    canCaptureChat: false,
    canTransferChat: false,
    canFinishChat: false,
    canViewAllChats: false,
    canOverrideChat: false,
  };

  // Selected Group for Editing Details
  const [selectedGroupId, setSelectedGroupId] = useState<string>(accessGroups[0]?.id || "");
  const selectedGroupObj = accessGroups.find(g => g.id === selectedGroupId) || accessGroups[0] || emptyGroup;

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
    if (groupForm.allowedChannels.length === 0) {
      toast.error("Selecione pelo menos um canal permitido.");
      return;
    }
    createAccessGroup({
      name: groupForm.name,
      allowedTenants: [tenant],
      allowedChannels: groupForm.allowedChannels,
      canCreateUser: groupForm.canCreateUser,
      canResetPassword: groupForm.canResetPassword,
      canEditProfile: groupForm.canEditProfile,
      canCaptureChat: groupForm.canCaptureChat ?? false,
      canTransferChat: groupForm.canTransferChat ?? false,
      canFinishChat: groupForm.canFinishChat ?? false,
      canViewAllChats: groupForm.canViewAllChats ?? false,
      canOverrideChat: groupForm.canOverrideChat ?? false,
    });
    setGroupForm({
      name: "",
      allowedTenants: [],
      allowedChannels: [],
      canCreateUser: false,
      canResetPassword: false,
      canEditProfile: true,
      canCaptureChat: false,
      canTransferChat: false,
      canFinishChat: false,
      canViewAllChats: false,
      canOverrideChat: false,
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

  const toggleChannelSelection = (channel: "whatsapp" | "instagram" | "messenger") => {
    setGroupForm(prev => {
      const alreadySelected = prev.allowedChannels.includes(channel);
      const allowedChannels = alreadySelected
        ? prev.allowedChannels.filter(c => c !== channel)
        : [...prev.allowedChannels, channel];
      return { ...prev, allowedChannels };
    });
  };

  const [permissionSearch, setPermissionSearch] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tenants: true,
    channels: true,
    views: true,
    chat: true,
    contacts: true,
    valentina: true,
    ligacoes: true,
    monitor: true,
    analytics: true,
    security: true,
    settings: true,
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const updateGroupGranular = (groupId: string, category: keyof GroupPermissions, key: string, value: any) => {
    const targetGroup = accessGroups.find(g => g.id === groupId);
    if (!targetGroup) return;

    const currentPerms = normalizeGroupPermissions(targetGroup);
    const updatedPerms: GroupPermissions = {
      ...currentPerms,
      [category]: {
        ...(currentPerms[category] as any),
        [key]: value,
      },
    };

    const legacyUpdates: Partial<AccessGroup> = {
      permissions: updatedPerms,
      canCreateUser: updatedPerms.security.canManageUsers,
      canResetPassword: updatedPerms.security.canResetUserPasswords,
      canEditProfile: updatedPerms.chat.canEditClientInfo,
      canCaptureChat: updatedPerms.chat.canCaptureChat,
      canTransferChat: updatedPerms.chat.canTransferChat,
      canFinishChat: updatedPerms.chat.canFinishChat,
      canViewAllChats: updatedPerms.chat.canViewAllChats,
      canOverrideChat: updatedPerms.chat.canOverrideChat,
    };

    updateAccessGroup(groupId, legacyUpdates);
  };

  const applyRolePreset = (groupId: string, presetKey: string) => {
    const preset = ROLE_PRESETS[presetKey];
    if (!preset) return;

    const legacyUpdates: Partial<AccessGroup> = {
      permissions: preset.permissions,
      canCreateUser: preset.permissions.security.canManageUsers,
      canResetPassword: preset.permissions.security.canResetUserPasswords,
      canEditProfile: preset.permissions.chat.canEditClientInfo,
      canCaptureChat: preset.permissions.chat.canCaptureChat,
      canTransferChat: preset.permissions.chat.canTransferChat,
      canFinishChat: preset.permissions.chat.canFinishChat,
      canViewAllChats: preset.permissions.chat.canViewAllChats,
      canOverrideChat: preset.permissions.chat.canOverrideChat,
    };

    updateAccessGroup(groupId, legacyUpdates);
    toast.success(`Perfil "${preset.name}" aplicado!`);
  };

  const toggleCategoryAll = (groupId: string, category: keyof GroupPermissions, value: boolean) => {
    const targetGroup = accessGroups.find(g => g.id === groupId);
    if (!targetGroup) return;

    const currentPerms = normalizeGroupPermissions(targetGroup);
    const catObj = { ...(currentPerms[category] as any) };
    for (const k of Object.keys(catObj)) {
      if (typeof catObj[k] === "boolean") {
        catObj[k] = value;
      }
    }

    const updatedPerms: GroupPermissions = {
      ...currentPerms,
      [category]: catObj,
    };

    const legacyUpdates: Partial<AccessGroup> = {
      permissions: updatedPerms,
      canCreateUser: updatedPerms.security.canManageUsers,
      canResetPassword: updatedPerms.security.canResetUserPasswords,
      canEditProfile: updatedPerms.chat.canEditClientInfo,
      canCaptureChat: updatedPerms.chat.canCaptureChat,
      canTransferChat: updatedPerms.chat.canTransferChat,
      canFinishChat: updatedPerms.chat.canFinishChat,
      canViewAllChats: updatedPerms.chat.canViewAllChats,
      canOverrideChat: updatedPerms.chat.canOverrideChat,
    };

    updateAccessGroup(groupId, legacyUpdates);
    toast.success(`Categoria atualizada.`);
  };

  const updateGroupPermission = (groupId: string, field: keyof AccessGroup, value: any) => {
    if (field === "allowedTenants") {
      toast.info("O acesso a outras empresas é configurado no grupo multiempresa acima.");
      return;
    }
    // Prevent removing admin permission entirely
    if (groupId === "group-admin" && field === "allowedChannels" && value.length === 0) {
      toast.warning("O grupo Administradores precisa ter acesso a pelo menos um canal.");
      return;
    }
    updateAccessGroup(groupId, { [field]: value });
    toast.success("Permissões do grupo atualizadas.");
  };

  const tabs = [
    { id: "users" as const,     label: "Operadores & Usuários", icon: Users },
    { id: "groups" as const,    label: "Grupos de Acesso",      icon: FolderLock },
    { id: "sectors" as const,   label: "Setores",               icon: Building2 },
    { id: "wallets" as const,   label: "Carteiras Globais",     icon: Wallet },
    { id: "templates" as const, label: "Templates Globais",     icon: LayoutTemplate },
  ];

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-soft overflow-hidden select-none">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
        <div>
          <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Grupos de Acesso
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">Segurança & Acessos — operadores, grupos, setores e carteiras</p>
        </div>
      </div>

      {/* Pill Tab Bar */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-line bg-muted/30 shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">

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
                  <div className="flex-1">
                    <Select
                      value={opForm.groupId}
                      onValueChange={(val) => setOpForm({ ...opForm, groupId: val })}
                    >
                      <SelectTrigger className="h-10 w-full rounded-xl bg-muted border-transparent text-xs text-foreground px-3.5 focus:ring-1 focus:ring-primary">
                        <SelectValue placeholder="Selecione um grupo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {accessGroups.map(g => (
                          <SelectItem key={g.id} value={g.id} className="text-xs">
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="submit"
                        className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 cursor-pointer shadow-soft transition-transform active:scale-95 shrink-0"
                      >
                        <Check className="h-5 w-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Confirmar Cadastro</TooltipContent>
                  </Tooltip>
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div 
                          onClick={() => handleAvatarClick(op.id)} 
                          className="relative group cursor-pointer h-12 w-12 shrink-0 rounded-full overflow-hidden border border-border shadow-xs"
                        >
                          {op.avatar ? (
                            <img
                              src={op.avatar}
                              alt={op.name}
                              className="h-full w-full object-cover border-0"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                                const parent = e.currentTarget.parentElement;
                                if (parent) {
                                  const fallback = parent.querySelector('[data-initials]') as HTMLElement;
                                  if (fallback) fallback.style.display = "flex";
                                }
                              }}
                            />
                          ) : null}
                          <div
                            data-initials
                            style={{ display: op.avatar ? "none" : "flex" }}
                            className="absolute inset-0 items-center justify-center bg-primary/10 text-primary font-black text-sm select-none"
                          >
                            {op.name.trim().split(/\s+/).map((w: string) => w[0]).filter(Boolean).join("").toUpperCase().slice(0, 2)}
                          </div>
                          <div className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Camera className="h-4 w-4 text-white animate-in zoom-in-75 duration-100" />
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top">Alterar Foto do Operador</TooltipContent>
                    </Tooltip>
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            setResetOpId(op.id);
                            setNewPassword("");
                            setShowPassword(false);
                          }}
                          className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                        >
                          <Key className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Redefinir Senha</TooltipContent>
                    </Tooltip>
                    
                    <button
                      disabled={isMe}
                      onClick={() => {
                        if (!isMe) handleDeleteClick(op);
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
          <MultiTenantAccessPanel />
          
          {/* Left Column: Access Groups List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-foreground">Grupos Ativos</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Clique em um grupo para editar permissões.</p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowGroupForm(!showGroupForm)}
                    className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer transition-transform duration-100 active:scale-95"
                  >
                    {showGroupForm ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Novo Grupo</TooltipContent>
              </Tooltip>
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

          {/* Right Column: Comprehensive RBAC Permissions Manager for Selected Group */}
          {(() => {
            const perms = normalizeGroupPermissions(selectedGroupObj);
            const searchLower = permissionSearch.toLowerCase().trim();

            const matchesSearch = (text: string, desc?: string) => {
              if (!searchLower) return true;
              return text.toLowerCase().includes(searchLower) || (desc && desc.toLowerCase().includes(searchLower));
            };

            return (
              <div className="lg:col-span-2 rounded-3xl bg-card border border-border shadow-soft p-6 space-y-6 flex flex-col">
                {/* Header do Grupo e Ações Rápidas */}
                <header className="border-b border-line pb-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider bg-primary/10 text-primary px-2.5 py-0.5 rounded-md">
                          Controle de Acesso RBAC
                        </span>
                        <span className="text-xs text-muted-foreground">ID: {selectedGroupObj.id}</span>
                      </div>
                      <h4 className="text-lg font-black text-foreground flex items-center gap-2 mt-1">
                        <ShieldCheck className="h-5 w-5 text-primary" /> {selectedGroupObj.name}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Defina com precisão cirúrgica os limites de visualização, operação e governança de cada perfil.
                      </p>
                    </div>

                    {/* Busca Rápida de Permissões */}
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Buscar permissão (ex: sdr, custos)..."
                        value={permissionSearch}
                        onChange={(e) => setPermissionSearch(e.target.value)}
                        className="w-full h-9 pl-8 pr-8 rounded-xl bg-muted text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-transparent"
                      />
                      {permissionSearch && (
                        <button
                          onClick={() => setPermissionSearch("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Barra de Perfis Pré-configurados (Presets Rápidos) */}
                  <div className="p-3.5 rounded-2xl bg-muted/40 border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        Modelos de Papéis Recomendados (1-Click Presets)
                      </span>
                      <span className="text-[10px] text-muted-foreground">Substitui as permissões do grupo instantaneamente</span>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {Object.entries(ROLE_PRESETS).map(([key, preset]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => applyRolePreset(selectedGroupId, key)}
                          className="px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-primary hover:text-primary-foreground hover:border-primary text-xs font-semibold text-foreground transition-all cursor-pointer shadow-soft flex items-center gap-1.5"
                          title={preset.description}
                        >
                          <span>{preset.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </header>

                {/* Blocos Granulares de Permissões */}
                <div className="space-y-4 max-h-[calc(100vh-320px)] overflow-y-auto pr-1 scrollbar-thin">

                  <div className="rounded-2xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
                    Este grupo define permissões somente em {tenant === "tecfag" ? "Tecfag" : "Valem"}. O acesso às duas empresas é configurado em Acesso multiempresa acima.
                  </div>

                  {/* ── Bloco 2: Boundary de Canais ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleSection("channels")}
                      className="w-full px-4 py-3 bg-muted/20 hover:bg-muted/40 flex items-center justify-between text-left transition"
                    >
                      <div className="flex items-center gap-2">
                        <Smartphone className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">Boundary de Canais de Entrada</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${openSections.channels ? "rotate-180" : ""}`} />
                    </button>

                    {openSections.channels && (
                      <div className="p-4 space-y-3">
                        <p className="text-[11px] text-muted-foreground">
                          Habilite ou desabilite canais de atendimento. O operador não verá chats dos canais não autorizados.
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
                            className={`rounded-xl p-3 border transition cursor-pointer flex items-center gap-3 ${
                              selectedGroupObj.allowedChannels.includes("whatsapp")
                                ? "border-emerald-500 bg-emerald-50/10 text-emerald-600 font-bold"
                                : "border-border bg-card text-muted-foreground opacity-60"
                            }`}
                          >
                            <Smartphone className="h-4 w-4 shrink-0" />
                            <div>
                              <span className="text-xs font-bold block text-foreground">WhatsApp</span>
                              <span className="text-[9px] text-muted-foreground block font-normal">Mensagens e Áudios</span>
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
                            className={`rounded-xl p-3 border transition cursor-pointer flex items-center gap-3 ${
                              selectedGroupObj.allowedChannels.includes("instagram")
                                ? "border-purple-500 bg-purple-50/10 text-purple-600 font-bold"
                                : "border-border bg-card text-muted-foreground opacity-60"
                            }`}
                          >
                            <Instagram className="h-4 w-4 shrink-0" />
                            <div>
                              <span className="text-xs font-bold block text-foreground">Instagram</span>
                              <span className="text-[9px] text-muted-foreground block font-normal">Directs e Stories</span>
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
                            className={`rounded-xl p-3 border transition cursor-pointer flex items-center gap-3 ${
                              selectedGroupObj.allowedChannels.includes("messenger")
                                ? "border-blue-500 bg-blue-50/10 text-blue-600 font-bold"
                                : "border-border bg-card text-muted-foreground opacity-60"
                            }`}
                          >
                            <Send className="h-4 w-4 shrink-0" />
                            <div>
                              <span className="text-xs font-bold block text-foreground">Messenger</span>
                              <span className="text-[9px] text-muted-foreground block font-normal">Facebook Mensagens</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Bloco 3: Visibilidade de Módulos (Sidebar) ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleSection("views")}
                        className="flex items-center gap-2 text-left flex-1"
                      >
                        <Eye className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">1. Módulos Visíveis no Menu Lateral</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "views", true)}
                          className="text-[10px] font-bold text-primary hover:underline"
                        >
                          Marcar Todos
                        </button>
                        <span className="text-muted-foreground text-xs">|</span>
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "views", false)}
                          className="text-[10px] font-bold text-muted-foreground hover:underline"
                        >
                          Desmarcar
                        </button>
                        <ChevronDown
                          onClick={() => toggleSection("views")}
                          className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${openSections.views ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {openSections.views && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { key: "chat",      label: "Conversas / Atendimento", desc: "Acesso à fila e tela de mensagens" },
                          { key: "tasks",     label: "Tarefas & Compromissos", desc: "Acesso ao kanban de tarefas do operador" },
                          { key: "contacts",  label: "Base de Contatos", desc: "Acesso à lista e fichas de clientes" },
                          { key: "wallets",   label: "Carteiras Globais", desc: "Acesso à gestão de carteiras comerciais" },
                          { key: "valentina", label: "Valentina IA Hub", desc: "Acesso ao SDR, Rodízio e Base de Conhecimento" },
                          { key: "ligacoes",  label: "Ligações & Telefonia", desc: "Acesso ao módulo de voz Twilio IA" },
                          { key: "monitor",   label: "Monitoramento & QA", desc: "Acesso ao espião, alertas e auditorias" },
                          { key: "analytics", label: "Estatísticas & BI", desc: "Acesso às métricas, SLA e relatórios" },
                          { key: "groups",    label: "Grupos & Equipe", desc: "Acesso à gestão de usuários e permissões" },
                          { key: "settings",  label: "Ajustes & Conexões", desc: "Acesso às configurações de integração" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.views[key as keyof typeof perms.views] ?? true;
                          return (
                            <label key={key} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "views", key, !!checked)}
                                className="shrink-0 mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-bold block text-foreground">{label}</span>
                                <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Bloco 4: Operações de Atendimento (Chat) ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleSection("chat")}
                        className="flex items-center gap-2 text-left flex-1"
                      >
                        <MessageSquare className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">2. Operações de Atendimento (Chat)</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "chat", true)}
                          className="text-[10px] font-bold text-primary hover:underline"
                        >
                          Marcar Todos
                        </button>
                        <span className="text-muted-foreground text-xs">|</span>
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "chat", false)}
                          className="text-[10px] font-bold text-muted-foreground hover:underline"
                        >
                          Desmarcar
                        </button>
                        <ChevronDown
                          onClick={() => toggleSection("chat")}
                          className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${openSections.chat ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {openSections.chat && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { key: "canCaptureChat",           label: "Capturar Atendimentos", desc: "Puxar conversas da fila de espera ou IA para si" },
                          { key: "canTransferChat",          label: "Transferir Atendimentos", desc: "Redirecionar conversas para outro operador ou setor" },
                          { key: "canFinishChat",            label: "Encerrar Atendimentos", desc: "Finalizar atendimentos ativos e arquivar" },
                          { key: "canViewAllChats",          label: "Visualizar Todos os Chats", desc: "Ver conversas atribuídas a outros (leitura)" },
                          { key: "canOverrideChat",          label: "Assumir Atendimento Alheio", desc: "Forçar controle de conversa alheia (Admin/Supervisor)" },
                          { key: "canSendInternalNotes",     label: "Enviar Notas Internas", desc: "Criar recados e anotações ocultas para a equipe" },
                          { key: "canEditClientInfo",        label: "Editar Cadastro no Chat", desc: "Alterar CNPJ, Razão Social, E-mail na barra lateral" },
                          { key: "canManageTags",            label: "Gerenciar Tags", desc: "Adicionar ou remover etiquetas de clientes" },
                          { key: "canManageRdCrm",           label: "Criar Oportunidade RD CRM", desc: "Disparar lead para o funil do RD Station CRM" },
                          { key: "canChangeWalletOperator",  label: "Alterar Carteira no Chat", desc: "Reatribuir a titularidade do cliente diretamente na conversa" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.chat[key as keyof typeof perms.chat] ?? false;
                          const isAdminOnly = key === "canOverrideChat";
                          return (
                            <label key={key} className={`flex items-start gap-3 rounded-xl border p-3 transition cursor-pointer ${
                              isAdminOnly ? "border-red-200 bg-red-50/20 hover:bg-red-50/40" : "border-border bg-muted/20 hover:bg-muted/30"
                            }`}>
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "chat", key, !!checked)}
                                className={`shrink-0 mt-0.5 ${isAdminOnly ? "border-red-400 data-[state=checked]:bg-red-500 data-[state=checked]:text-white" : ""}`}
                              />
                              <div>
                                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                  {label}
                                  {isAdminOnly && <span className="text-[9px] font-bold text-red-500 bg-red-100 px-1 py-0.2 rounded">Crítico</span>}
                                </span>
                                <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Bloco 5: Base de Clientes & Carteira ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleSection("contacts")}
                        className="flex items-center gap-2 text-left flex-1"
                      >
                        <Users className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">3. Base de Clientes & Contatos</span>
                      </button>
                      <ChevronDown
                        onClick={() => toggleSection("contacts")}
                        className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${openSections.contacts ? "rotate-180" : ""}`}
                      />
                    </div>

                    {openSections.contacts && (
                      <div className="p-4 space-y-3">
                        {/* Escopo de Visualização */}
                        <div className="p-3 rounded-xl border border-border bg-muted/30 space-y-2">
                          <span className="text-[11px] font-extrabold text-foreground block">Escopo de Visualização de Contatos:</span>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => updateGroupGranular(selectedGroupId, "contacts", "contactScope", "all")}
                              className={`flex items-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold border transition cursor-pointer ${
                                perms.contacts.contactScope === "all"
                                  ? "bg-primary text-primary-foreground border-primary shadow-soft"
                                  : "bg-card text-muted-foreground border-border hover:bg-muted"
                              }`}
                            >
                              <Globe className="h-3.5 w-3.5" />
                              <span>Todos os Contatos da Empresa</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => updateGroupGranular(selectedGroupId, "contacts", "contactScope", "wallet_only")}
                              className={`flex items-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold border transition cursor-pointer ${
                                perms.contacts.contactScope === "wallet_only"
                                  ? "bg-primary text-primary-foreground border-primary shadow-soft"
                                  : "bg-card text-muted-foreground border-border hover:bg-muted"
                              }`}
                            >
                              <Lock className="h-3.5 w-3.5" />
                              <span>Somente Minha Carteira</span>
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {[
                            { key: "canCreateContact",  label: "Criar Novos Contatos", desc: "Cadastrar contatos manualmente" },
                            { key: "canEditContact",    label: "Editar Ficha de Contatos", desc: "Alterar telefones, e-mails e CNPJ" },
                            { key: "canDeleteContact",  label: "Excluir Contatos", desc: "Remover clientes permanentemente da base" },
                            { key: "canExportContacts", label: "Exportar Base CSV/Excel", desc: "Download da lista completa de contatos" },
                          ].map(({ key, label, desc }) => {
                            if (!matchesSearch(label, desc)) return null;
                            const isChecked = perms.contacts[key as keyof typeof perms.contacts] ?? false;
                            return (
                              <label key={key} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                                <Checkbox
                                  checked={Boolean(isChecked)}
                                  onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "contacts", key, !!checked)}
                                  className="shrink-0 mt-0.5"
                                />
                                <div>
                                  <span className="text-xs font-bold block text-foreground">{label}</span>
                                  <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Bloco 6: Valentina IA Hub ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleSection("valentina")}
                        className="flex items-center gap-2 text-left flex-1"
                      >
                        <Bot className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">4. Valentina IA Hub</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "valentina", true)}
                          className="text-[10px] font-bold text-primary hover:underline"
                        >
                          Marcar Todos
                        </button>
                        <span className="text-muted-foreground text-xs">|</span>
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "valentina", false)}
                          className="text-[10px] font-bold text-muted-foreground hover:underline"
                        >
                          Desmarcar
                        </button>
                        <ChevronDown
                          onClick={() => toggleSection("valentina")}
                          className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${openSections.valentina ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {openSections.valentina && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { key: "canAccessChat",      label: "Chat com a Valentina", desc: "Conversar diretamente com a assistente de IA" },
                          { key: "canAccessSdr",       label: "Visualizar Leads SDR", desc: "Ver a fila de triagem e captação de leads" },
                          { key: "canManageSdr",       label: "Gerenciar & Pausar SDR", desc: "Alterar comportamento ou pausar bot SDR" },
                          { key: "canAccessRodizio",   label: "Visualizar Rodízio de Leads", desc: "Acompanhar distribuição e pesos de fila" },
                          { key: "canManageRodizio",   label: "Configurar Rodízio & Pesos", desc: "Adicionar/remover atendentes do rodízio" },
                          { key: "canAccessSupervisor",label: "Valentina Supervisor", desc: "Consultar IA para análise operacional" },
                          { key: "canAccessKnowledge", label: "Consultar Base de Conhecimento", desc: "Ler manuais, PDFs e FAQs ingeridos" },
                          { key: "canManageKnowledge", label: "Ingerir Base de Conhecimento", desc: "Upload de novos documentos e treinar RAG" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.valentina[key as keyof typeof perms.valentina] ?? false;
                          return (
                            <label key={key} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "valentina", key, !!checked)}
                                className="shrink-0 mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-bold block text-foreground">{label}</span>
                                <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Bloco 7: Ligações & Voz IA ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleSection("ligacoes")}
                        className="flex items-center gap-2 text-left flex-1"
                      >
                        <PhoneCall className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">5. Ligações & Voz IA (Twilio)</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "ligacoes", true)}
                          className="text-[10px] font-bold text-primary hover:underline"
                        >
                          Marcar Todos
                        </button>
                        <span className="text-muted-foreground text-xs">|</span>
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "ligacoes", false)}
                          className="text-[10px] font-bold text-muted-foreground hover:underline"
                        >
                          Desmarcar
                        </button>
                        <ChevronDown
                          onClick={() => toggleSection("ligacoes")}
                          className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${openSections.ligacoes ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {openSections.ligacoes && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { key: "canAccessDashboard",  label: "Dashboard de Ligações", desc: "Visão em tempo real de chamadas ativas" },
                          { key: "canAccessAgenda",     label: "Agenda de Ligações", desc: "Ver compromissos e agendamentos telefônicos" },
                          { key: "canAccessHistorico",  label: "Histórico & Transcrições", desc: "Ouvir gravações e ler transcrições da IA" },
                          { key: "canAccessClientes",   label: "Base de Clientes de Voz", desc: "Listagem de contatos qualificados para ligação" },
                          { key: "canTriggerTestCall",  label: "Disparar Teste de Ligação", desc: "Fazer ligação de teste imediata com a Valentina" },
                          { key: "canManageCampanhas",  label: "Gerenciar Campanhas em Massa", desc: "Criar e disparar disparos de voz para listas" },
                          { key: "canManageObjetivos",  label: "Definir Objetivos da IA", desc: "Configurar metas e prompts de ligação" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.ligacoes[key as keyof typeof perms.ligacoes] ?? false;
                          return (
                            <label key={key} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "ligacoes", key, !!checked)}
                                className="shrink-0 mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-bold block text-foreground">{label}</span>
                                <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Bloco 8: Monitoramento & QA ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleSection("monitor")}
                        className="flex items-center gap-2 text-left flex-1"
                      >
                        <ClipboardCheck className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">6. Monitoramento & Qualidade QA</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "monitor", true)}
                          className="text-[10px] font-bold text-primary hover:underline"
                        >
                          Marcar Todos
                        </button>
                        <span className="text-muted-foreground text-xs">|</span>
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "monitor", false)}
                          className="text-[10px] font-bold text-muted-foreground hover:underline"
                        >
                          Desmarcar
                        </button>
                        <ChevronDown
                          onClick={() => toggleSection("monitor")}
                          className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${openSections.monitor ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {openSections.monitor && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { key: "canAccessLive",       label: "Espião ao Vivo", desc: "Acompanhar conversas em tempo real sem interferir" },
                          { key: "canAccessAlerts",     label: "Alertas & Gargalos de SLA", desc: "Ver atendimentos com tempo de espera estourado" },
                          { key: "canAccessOperators",  label: "Ranking de Operadores", desc: "Comparativo de produtividade da equipe" },
                          { key: "canAccessAudits",     label: "Auditorias de Atendimento", desc: "Ver notas e pareceres da IA avaliadora" },
                          { key: "canManageAudits",     label: "Aprovar / Recalibrar Auditorias", desc: "Validar notas e enviar feedback para operadores" },
                          { key: "canAccessSite",       label: "Visitantes do Site (Live Chat)", desc: "Ver fluxo de visitantes online navegando na loja" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.monitor[key as keyof typeof perms.monitor] ?? false;
                          return (
                            <label key={key} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "monitor", key, !!checked)}
                                className="shrink-0 mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-bold block text-foreground">{label}</span>
                                <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Bloco 9: Estatísticas & Custos ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleSection("analytics")}
                        className="flex items-center gap-2 text-left flex-1"
                      >
                        <BarChart2 className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">7. Estatísticas, Relatórios & Custos</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "analytics", true)}
                          className="text-[10px] font-bold text-primary hover:underline"
                        >
                          Marcar Todos
                        </button>
                        <span className="text-muted-foreground text-xs">|</span>
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "analytics", false)}
                          className="text-[10px] font-bold text-muted-foreground hover:underline"
                        >
                          Desmarcar
                        </button>
                        <ChevronDown
                          onClick={() => toggleSection("analytics")}
                          className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${openSections.analytics ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {openSections.analytics && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { key: "canAccessOverview",    label: "Visão Geral & Volumetria", desc: "Gráficos de total de atendimentos e canais" },
                          { key: "canAccessPerformance", label: "Desempenho por Setor", desc: "Eficiência de times e conversão" },
                          { key: "canAccessSla",         label: "SLA & Tempos de Espera", desc: "Métricas de TMA, TME e conformidade" },
                          { key: "canAccessContacts",    label: "Analytics de Clientes", desc: "Frequência de recompra e inatividade" },
                          { key: "canAccessReports",     label: "Relatórios Executivos IA", desc: "Geração de resumos e relatórios analíticos" },
                          { key: "canAccessCosts",       label: "Painel de Custos de IA", desc: "Gastos com Vertex AI, tokens e transcrições" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.analytics[key as keyof typeof perms.analytics] ?? false;
                          const isCost = key === "canAccessCosts";
                          return (
                            <label key={key} className={`flex items-start gap-3 rounded-xl border p-3 transition cursor-pointer ${
                              isCost ? "border-amber-200 bg-amber-50/20 hover:bg-amber-50/40" : "border-border bg-muted/20 hover:bg-muted/30"
                            }`}>
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "analytics", key, !!checked)}
                                className="shrink-0 mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                  {label}
                                  {isCost && <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1 py-0.2 rounded">Financeiro</span>}
                                </span>
                                <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Bloco 10: Gestão de Equipe & Segurança ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleSection("security")}
                        className="flex items-center gap-2 text-left flex-1"
                      >
                        <Shield className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">8. Gestão de Equipe & Segurança</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "security", true)}
                          className="text-[10px] font-bold text-primary hover:underline"
                        >
                          Marcar Todos
                        </button>
                        <span className="text-muted-foreground text-xs">|</span>
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "security", false)}
                          className="text-[10px] font-bold text-muted-foreground hover:underline"
                        >
                          Desmarcar
                        </button>
                        <ChevronDown
                          onClick={() => toggleSection("security")}
                          className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${openSections.security ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {openSections.security && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { key: "canManageUsers",        label: "Criar & Editar Operadores", desc: "Cadastrar novos usuários e definir senhas" },
                          { key: "canResetUserPasswords", label: "Redefinir Senhas de Outros", desc: "Trocar senhas de membros da equipe" },
                          { key: "canImpersonateUsers",   label: "Assumir Sessão de Operador", desc: "Fazer login como outro operador (Super Admin)" },
                          { key: "canManageGroups",       label: "Criar & Editar Grupos", desc: "Modificar permissões e criar novos papéis" },
                          { key: "canManageSectors",      label: "Gerenciar Setores", desc: "Criar e editar departamentos de atendimento" },
                          { key: "canManageWallets",      label: "Gerenciar Carteiras Globais", desc: "Distribuir carteiras comerciais de clientes" },
                          { key: "canManageTemplates",    label: "Gerenciar Templates Globais", desc: "Criar respostas rápidas compartilhadas" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.security[key as keyof typeof perms.security] ?? false;
                          return (
                            <label key={key} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "security", key, !!checked)}
                                className="shrink-0 mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-bold block text-foreground">{label}</span>
                                <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Bloco 11: Ajustes & Conexões ── */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleSection("settings")}
                        className="flex items-center gap-2 text-left flex-1"
                      >
                        <Settings className="h-4 w-4 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">9. Ajustes & Conexões Técnicas</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "settings", true)}
                          className="text-[10px] font-bold text-primary hover:underline"
                        >
                          Marcar Todos
                        </button>
                        <span className="text-muted-foreground text-xs">|</span>
                        <button
                          type="button"
                          onClick={() => toggleCategoryAll(selectedGroupId, "settings", false)}
                          className="text-[10px] font-bold text-muted-foreground hover:underline"
                        >
                          Desmarcar
                        </button>
                        <ChevronDown
                          onClick={() => toggleSection("settings")}
                          className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${openSections.settings ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {openSections.settings && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { key: "canAccessWhatsappSettings", label: "Conexões WhatsApp", desc: "Configurar QR Code Baileys ou Meta API" },
                          { key: "canAccessVozSettings",      label: "Telefonia & Twilio", desc: "Configurar credenciais e números de voz" },
                          { key: "canAccessRdSettings",       label: "Integração RD CRM", desc: "Conectar OAuth da RD Station" },
                          { key: "canAccessEmailSettings",    label: "E-mail & SMTP", desc: "Configurar servidor de envio de relatórios" },
                          { key: "canAccessLiveChatSettings", label: "Widget Live Chat", desc: "Configurar script do chat no site" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.settings[key as keyof typeof perms.settings] ?? false;
                          return (
                            <label key={key} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition cursor-pointer">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "settings", key, !!checked)}
                                className="mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-bold block text-foreground">{label}</span>
                                <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            );
          })()}
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowSectorForm(!showSectorForm)}
                    className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer transition-transform duration-100 active:scale-95 animate-in fade-in"
                  >
                    {showSectorForm ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Novo Setor</TooltipContent>
              </Tooltip>
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
                    
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSector(s.id);
                            setSelectedSectorId(sectors.find(sec => sec.id !== s.id)?.id || "");
                          }}
                          className="h-7 w-7 grid place-items-center rounded hover:bg-red-50 text-red-500 transition cursor-pointer"
                        >
                          <Trash className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Excluir Setor</TooltipContent>
                    </Tooltip>
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
                          <Checkbox
                            checked={isMember}
                            onCheckedChange={(checked) => {
                              const isChecked = !!checked;
                              const newOperatorIds = isChecked
                                ? [...selectedSectorObj.operatorIds, op.id]
                                : selectedSectorObj.operatorIds.filter(id => id !== op.id);
                              updateSector(selectedSectorObj.id, { operatorIds: newOperatorIds });
                            }}
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleOpenEditQrModal(qr)}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary-soft hover:text-primary transition cursor-pointer"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Editar</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => qr.id && handleDeleteQr(qr.id)}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition cursor-pointer"
                        >
                          <Trash className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Excluir</TooltipContent>
                    </Tooltip>
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
      {/* Modal de Confirmação de Exclusão de Operador */}
      {deleteConfirm && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !deleteConfirm.loading) setDeleteConfirm(null); }}
        >
          <div
            className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "var(--card, #fff)", border: "1px solid var(--border, #e5e7eb)" }}
          >
            {/* Cabeçalho verde */}
            <div className="flex items-center gap-3 px-6 pt-6 pb-4" style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ background: "rgba(var(--primary-rgb, 22,163,74), 0.12)" }}
              >
                <Trash className="h-5 w-5" style={{ color: "var(--primary, #16a34a)" }} />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: "var(--foreground)" }}>
                  Excluir Atendente
                </h3>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  Esta ação não pode ser desfeita
                </p>
              </div>
            </div>

            {/* Corpo */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm" style={{ color: "var(--foreground)" }}>
                Você está prestes a excluir o atendente{" "}
                <span className="font-semibold">"{deleteConfirm.operatorName}"</span>.
              </p>

              {deleteConfirm.linkedCount > 0 ? (
                <div
                  className="rounded-xl p-4 space-y-1.5"
                  style={{ background: "rgba(var(--primary-rgb, 22,163,74), 0.07)", border: "1px solid rgba(var(--primary-rgb, 22,163,74), 0.2)" }}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ background: "var(--primary, #16a34a)" }} />
                    <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                      {deleteConfirm.linkedCount} atendimento{deleteConfirm.linkedCount !== 1 ? "s" : ""} vinculado{deleteConfirm.linkedCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {deleteConfirm.activeCount > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ background: "#f59e0b" }} />
                      <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                        {deleteConfirm.activeCount} em andamento ou na fila
                      </p>
                    </div>
                  )}
                  <p className="text-xs pt-1" style={{ color: "var(--muted-foreground)" }}>
                    Todos os atendimentos serão movidos para <strong>Sem Responsável</strong> automaticamente.
                  </p>
                </div>
              ) : (
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                  Este atendente não possui atendimentos vinculados.
                </p>
              )}
            </div>

            {/* Rodapé */}
            <div className="flex items-center justify-end gap-3 px-6 pb-6">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleteConfirm.loading}
                className="rounded-xl px-4 py-2 text-sm font-medium transition cursor-pointer"
                style={{
                  background: "var(--muted, #f3f4f6)",
                  color: "var(--muted-foreground)",
                  opacity: deleteConfirm.loading ? 0.5 : 1,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleteConfirm.loading}
                className="flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white transition cursor-pointer"
                style={{
                  background: deleteConfirm.loading ? "var(--primary, #16a34a)" : "#dc2626",
                  opacity: deleteConfirm.loading ? 0.7 : 1,
                  boxShadow: "0 2px 8px rgba(220,38,38,0.25)",
                }}
              >
                {deleteConfirm.loading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Excluindo...
                  </>
                ) : (
                  <>
                    <Trash className="h-4 w-4" />
                    Sim, excluir
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      </div>{/* /flex-1 scrollable content */}
    </div>
  );
}
