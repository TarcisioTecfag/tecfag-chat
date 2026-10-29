import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, SystemTooltip } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useChat, Operator, AccessGroup } from "@/hooks/useChatState";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { CrmGroupPermissions } from "./CrmGroupPermissions";
import { WhatsappGroupPermissions } from "./WhatsappGroupPermissions";
import { OWN_CONVERSATIONS_PRESET } from "@/lib/access-control/conversation-policy";
import { MultiTenantAccessPanel } from "./MultiTenantAccessPanel";
import { MetaTemplatesManager } from "./MetaTemplatesManager";
import { getAiPersona } from "@/lib/ai-persona";
import { usePermissions } from "@/hooks/usePermissions";
import { getInitialTabFromUrl, useSyncModuleTabWithUrl } from "@/lib/app-routes";
import {
  getDefaultSectorCopilotConfig,
  interpolateCopilotWelcomeMessage,
  resolveSectorCopilotConfig,
} from "@/lib/valentina/sector-copilot-config";

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

  const isInternalAiRow = (c: any) =>
    c.id === "valentina" ||
    c.id === "fagner" ||
    c.contactId === "valentina" ||
    c.contactId === "fagner" ||
    c.phone === "IA";

  const opClients = conversations.filter(c => !isInternalAiRow(c) && c.walletOperatorId === op.id);
  const availableClients = conversations.filter(c => !isInternalAiRow(c) && c.walletOperatorId !== op.id);
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
  KeyRound,
  Trash, 
  Plus, 
  Check, 
  AlertCircle, 
  UserPlus, 
  FolderLock, 
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Loader2,
  Smartphone, 
  Instagram, 
  Send,
  Eye,
  EyeOff,
  Building2,
  Briefcase,
  CheckSquare,
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
  Sliders,
  ChevronRight,
  Clock,
  LogOut,
  RotateCcw,
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
  const { canManageGlobalTemplates } = usePermissions();
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
    refreshOperators,
    completeOperatorWizard,
    toggleOperatorPasswordReset,
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

  const aiPersona = getAiPersona(tenant || "valem");

  // Active sub-views / tabs
  const [activeTab, setActiveTab] = useState<"users" | "groups" | "sectors" | "wallets" | "templates">(() =>
    getInitialTabFromUrl("groups", "users", ["users", "groups", "sectors", "wallets", "templates"] as const),
  );

  const [completingWizardOpId, setCompletingWizardOpId] = useState<string | null>(null);
  const [togglingResetOpId, setTogglingResetOpId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== "users") return;
    void refreshOperators();
    const interval = window.setInterval(() => {
      void refreshOperators();
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [activeTab, refreshOperators]);

  const formatOperatorUsageToday = (seconds?: number) => {
    const safe = Math.max(0, Math.floor(Number(seconds || 0)));
    if (safe === 0) return "0 min";
    if (safe < 60) return "< 1 min";
    const totalMinutes = Math.floor(safe / 60);
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const formatOperatorLastSeen = (lastSeenAt?: string | null, isOnline?: boolean) => {
    if (isOnline) return "Agora mesmo";
    if (!lastSeenAt) return "Sem registro";
    const parsed = new Date(lastSeenAt);
    if (Number.isNaN(parsed.getTime())) return "Sem registro";

    const now = new Date();
    const diffSec = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 1000));
    if (diffSec < 60) return "há poucos seg";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `há ${diffMin} min`;

    const timeStr = parsed.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const isSameDay =
      parsed.getDate() === now.getDate() &&
      parsed.getMonth() === now.getMonth() &&
      parsed.getFullYear() === now.getFullYear();
    if (isSameDay) return `Hoje às ${timeStr}`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      parsed.getDate() === yesterday.getDate() &&
      parsed.getMonth() === yesterday.getMonth() &&
      parsed.getFullYear() === yesterday.getFullYear();
    if (isYesterday) return `Ontem às ${timeStr}`;

    const dateStr = parsed.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });
    return `${dateStr} às ${timeStr}`;
  };

  const handleAutoCompleteWizard = async (op: Operator) => {
    if (completingWizardOpId) return;
    setCompletingWizardOpId(op.id);
    try {
      const res = await completeOperatorWizard(op.id);
      if (res.success) {
        toast.success(`Wizard de "${op.name}" marcado como 100% concluído!`);
      }
    } finally {
      setCompletingWizardOpId(null);
    }
  };

  const handleTogglePasswordResetOnLogin = async (op: Operator) => {
    if (togglingResetOpId) return;
    const nextEnabled = !op.mustChangePassword;
    setTogglingResetOpId(op.id);
    try {
      const res = await toggleOperatorPasswordReset(op.id, nextEnabled);
      if (res.success) {
        if (nextEnabled) {
          toast.success(
            `"${op.name}" foi desconectado e precisará definir uma nova senha ao entrar novamente.`,
          );
        } else {
          toast.info(`Exigência de redefinição de senha desativada para "${op.name}".`);
        }
      }
    } finally {
      setTogglingResetOpId(null);
    }
  };

  // Modal de confirmação de exclusão de operador
  // Delete Operator Confirmation State (com auditoria e transferência de patrimônio)
  const [deleteConfirm, setDeleteConfirm] = useState<{
    operatorId: string;
    operatorName: string;
    linkedCount: number;
    activeCount: number;
    dealsCount: number;
    openDealsCount: number;
    contactsCount: number;
    tasksCount: number;
    pendingTasksCount: number;
    totalItems: number;
    targetOperatorId: string;
    actionType: "transfer" | "unassign";
    loading: boolean;
  } | null>(null);

  const handleDeleteClick = async (op: any) => {
    // Consulta o backend: auditoria completa de vínculos do operador
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || "";
      const res = await fetch(`${backendUrl}/api/operators?action=count-linked&id=${op.id}`);
      const data = res.ok ? await res.json() : null;

      const convs = data?.conversations?.total ?? data?.total ?? 0;
      const activeConvs = data?.conversations?.active ?? data?.active ?? 0;
      const deals = data?.deals?.total ?? 0;
      const openDeals = data?.deals?.open ?? 0;
      const contactsCount = data?.contacts?.total ?? 0;
      const tasksCount = data?.tasks?.total ?? 0;
      const pendingTasksCount = data?.tasks?.pending ?? 0;
      const totalItems = data?.totalItems ?? (convs + deals + contactsCount + tasksCount);

      // Pré-selecionar o primeiro operador disponível diferente do operador que está sendo excluído
      const otherOps = operators.filter(o => o.id !== op.id);
      const defaultTarget = otherOps.find(o => o.id === currentOperatorId) || otherOps[0];

      setDeleteConfirm({
        operatorId: op.id,
        operatorName: op.name,
        linkedCount: convs,
        activeCount: activeConvs,
        dealsCount: deals,
        openDealsCount: openDeals,
        contactsCount: contactsCount,
        tasksCount: tasksCount,
        pendingTasksCount: pendingTasksCount,
        totalItems,
        targetOperatorId: defaultTarget?.id || "",
        actionType: totalItems > 0 && defaultTarget ? "transfer" : "unassign",
        loading: false,
      });
    } catch {
      const otherOps = operators.filter(o => o.id !== op.id);
      const defaultTarget = otherOps[0];
      setDeleteConfirm({
        operatorId: op.id,
        operatorName: op.name,
        linkedCount: 0,
        activeCount: 0,
        dealsCount: 0,
        openDealsCount: 0,
        contactsCount: 0,
        tasksCount: 0,
        pendingTasksCount: 0,
        totalItems: 0,
        targetOperatorId: defaultTarget?.id || "",
        actionType: "unassign",
        loading: false,
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleteConfirm((prev) => (prev ? { ...prev, loading: true } : null));

    const targetId =
      deleteConfirm.actionType === "transfer" && deleteConfirm.targetOperatorId
        ? deleteConfirm.targetOperatorId
        : undefined;

    const res = await deleteOperator(deleteConfirm.operatorId, targetId);

    if (res.success) {
      if (deleteConfirm.actionType === "transfer" && targetId) {
        const dest = operators.find((o) => o.id === targetId)?.name || "novo atendente";
        toast.success(
          `Atendente "${deleteConfirm.operatorName}" excluído. Todo o patrimônio foi transferido para ${dest}.`
        );
      } else {
        toast.success(
          `Atendente "${deleteConfirm.operatorName}" excluído. Atendimentos e negociações movidos para Fila / Sem Responsável.`
        );
      }
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm((prev) => (prev ? { ...prev, loading: false } : null));
    }
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
  const [isCreatingOperator, setIsCreatingOperator] = useState(false);
  const [opForm, setOpForm] = useState({
    name: "",
    email: "",
    password: "",
    groupId: accessGroups[0]?.id || "",
    sectorIds: [] as string[],
  });

  // Search & Filtering States for Operators & Users Tab
  const [operatorSearch, setOperatorSearch] = useState("");
  const [selectedSectorFolder, setSelectedSectorFolder] = useState<string>("all"); // "all" | "unassigned" | sector.id
  const [operatorGroupFilter, setOperatorGroupFilter] = useState<string>("all"); // "all" | group.id
  const [operatorViewMode, setOperatorViewMode] = useState<"folders" | "grid">("folders");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [sectorMemberSearch, setSectorMemberSearch] = useState("");
  const [walletOperatorSearch, setWalletOperatorSearch] = useState("");

  // Edit Operator Modal State
  const [editingOperator, setEditingOperator] = useState<{
    id: string;
    name: string;
    email: string;
    avatar: string;
    groupId: string;
    status: "disponivel" | "pausa" | "desconectado";
    password: string;
    sectorIds: string[];
  } | null>(null);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [isSavingOperatorEdit, setIsSavingOperatorEdit] = useState(false);

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
              
              void updateOperator(selectedOpIdForAvatar, { avatar: compressedBase64 }).then((res) => {
                if (res.success) {
                  toast.success("Foto de perfil atualizada!");
                }
              });
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
    copilotWelcomeMessage: "",
    copilotSuggestions: [] as string[],
  };

  const selectedSectorObj = sectors.find(s => s.id === selectedSectorId) || sectors[0] || emptySector;

  // Sector Copilot Configuration States
  const [sectorWelcomeDraft, setSectorWelcomeDraft] = useState<string>("");
  const [sectorSuggestionsDraft, setSectorSuggestionsDraft] = useState<string[]>([]);
  const [isSavingSectorCopilot, setIsSavingSectorCopilot] = useState(false);

  React.useEffect(() => {
    if (!selectedSectorObj?.id) return;
    const resolved = resolveSectorCopilotConfig({
      name: selectedSectorObj.name,
      copilotWelcomeMessage: selectedSectorObj.copilotWelcomeMessage,
      copilotSuggestions: selectedSectorObj.copilotSuggestions,
    });
    setSectorWelcomeDraft(resolved.welcomeMessage);
    setSectorSuggestionsDraft(resolved.suggestions);
  }, [
    selectedSectorObj?.id,
    selectedSectorObj?.name,
    selectedSectorObj?.copilotWelcomeMessage,
    selectedSectorObj?.copilotSuggestions,
  ]);

  const handleSaveSectorCopilot = async () => {
    if (!selectedSectorObj?.id || isSavingSectorCopilot) return;
    const cleanedWelcome = sectorWelcomeDraft.trim();
    const cleanedSuggestions = sectorSuggestionsDraft
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (!cleanedWelcome) {
      toast.warning("A mensagem inicial do copiloto não pode ficar vazia.");
      return;
    }
    if (cleanedSuggestions.length === 0) {
      toast.warning("Adicione pelo menos 1 sugestão de pergunta para o setor.");
      return;
    }

    setIsSavingSectorCopilot(true);
    try {
      await updateSector(selectedSectorObj.id, {
        copilotWelcomeMessage: cleanedWelcome,
        copilotSuggestions: cleanedSuggestions,
      });
      setSectorSuggestionsDraft(cleanedSuggestions);
      toast.success(`Copiloto ${aiPersona.name} configurado para o setor "${selectedSectorObj.name}"!`);
    } finally {
      setIsSavingSectorCopilot(false);
    }
  };

  const handleRestoreSectorCopilotDefault = async () => {
    if (!selectedSectorObj?.id || isSavingSectorCopilot) return;
    const defaults = getDefaultSectorCopilotConfig(selectedSectorObj.name);
    setSectorWelcomeDraft(defaults.welcomeMessage);
    setSectorSuggestionsDraft(defaults.suggestions);
    setIsSavingSectorCopilot(true);
    try {
      await updateSector(selectedSectorObj.id, {
        copilotWelcomeMessage: defaults.welcomeMessage,
        copilotSuggestions: defaults.suggestions,
      });
      toast.success(`Padrão recomendado do setor "${selectedSectorObj.name}" restaurado!`);
    } finally {
      setIsSavingSectorCopilot(false);
    }
  };

  const handleInsertSectorWelcomeVar = (token: string) => {
    setSectorWelcomeDraft((prev) => `${prev}${prev.endsWith(" ") || !prev ? "" : " "}${token}`);
  };

  // Group Form States
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupForm, setGroupForm] = useState({
    name: "",
    allowedTenants: [] as ("tecfag" | "valem")[],
    allowedChannels: [] as ("whatsapp" | "instagram" | "messenger" | "livechat")[],
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
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const emptyGroup: AccessGroup = {
    id: "",
    tenantId: "" as any,
    name: "Carregando Grupo...",
    allowedTenants: [] as ("tecfag" | "valem")[],
    allowedChannels: [] as ("whatsapp" | "instagram" | "messenger" | "livechat")[],
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

  const handleCreateOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opForm.name.trim() || !opForm.email.trim() || !opForm.password.trim() || !opForm.groupId) {
      toast.error("Por favor, preencha todos os campos obrigatórios.");
      return;
    }
    setIsCreatingOperator(true);
    try {
      const result = await createOperator({
        name: opForm.name.trim(),
        email: opForm.email.trim(),
        passwordHash: opForm.password.trim(),
        groupId: opForm.groupId,
      });
      if (!result.success) return;

      const createdId = result.operator?.id;
      if (createdId && opForm.sectorIds.length > 0) {
        for (const sectorId of opForm.sectorIds) {
          const sec = sectors.find((s) => s.id === sectorId);
          if (sec && !sec.operatorIds.includes(createdId)) {
            updateSector(sec.id, { operatorIds: [...sec.operatorIds, createdId] });
          }
        }
      }

      setOpForm({
        name: "",
        email: "",
        password: "",
        groupId: accessGroups[0]?.id || "",
        sectorIds: [],
      });
      setShowOpForm(false);
      toast.success("Operador criado com sucesso!");
    } finally {
      setIsCreatingOperator(false);
    }
  };

  const handleOpenEditOperator = (op: Operator) => {
    const opSectorIds = sectors
      .filter((s) => s.operatorIds.includes(op.id))
      .map((s) => s.id);
    setEditingOperator({
      id: op.id,
      name: op.name,
      email: op.email,
      avatar: op.avatar || "",
      groupId: op.groupId || accessGroups[0]?.id || "",
      status: op.status || "disponivel",
      password: "",
      sectorIds: opSectorIds,
    });
    setShowEditPassword(false);
  };

  const handleSaveOperatorEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOperator) return;
    if (!editingOperator.name.trim() || !editingOperator.email.trim() || !editingOperator.groupId) {
      toast.error("Nome, e-mail e grupo de acesso são obrigatórios.");
      return;
    }

    setIsSavingOperatorEdit(true);
    try {
      const cleanPassword = editingOperator.password.trim();
      const res = await updateOperator(editingOperator.id, {
        name: editingOperator.name.trim(),
        email: editingOperator.email.trim().toLowerCase(),
        avatar: editingOperator.avatar.trim() || undefined,
        groupId: editingOperator.groupId,
        status: editingOperator.status,
        ...(cleanPassword ? { password: cleanPassword } : {}),
      });

      if (!res.success) return;

      // Sincronizar vínculo com setores (pastas)
      for (const sec of sectors) {
        const currentlyIn = sec.operatorIds.includes(editingOperator.id);
        const shouldBeIn = editingOperator.sectorIds.includes(sec.id);
        if (shouldBeIn && !currentlyIn) {
          updateSector(sec.id, { operatorIds: [...sec.operatorIds, editingOperator.id] });
        } else if (!shouldBeIn && currentlyIn) {
          updateSector(sec.id, {
            operatorIds: sec.operatorIds.filter((id) => id !== editingOperator.id),
          });
        }
      }

      toast.success(
        cleanPassword
          ? `Dados e senha de "${editingOperator.name.trim()}" atualizados com sucesso!`
          : `Operador "${editingOperator.name.trim()}" atualizado com sucesso!`,
      );
      setEditingOperator(null);
    } finally {
      setIsSavingOperatorEdit(false);
    }
  };

  const handleQuickGroupChange = async (op: Operator, newGroupId: string) => {
    if (!newGroupId || newGroupId === op.groupId) return;
    const targetGroup = accessGroups.find((g) => g.id === newGroupId);
    const res = await updateOperator(op.id, { groupId: newGroupId });
    if (res.success) {
      toast.success(`Grupo de "${op.name}" alterado para "${targetGroup?.name || newGroupId}"!`);
    }
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
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetOpId || !newPassword.trim()) {
      toast.error("Informe uma nova senha para o operador.");
      return;
    }
    setIsResettingPassword(true);
    try {
      const res = await resetOperatorPassword(resetOpId, newPassword.trim());
      if (res.success) {
        const opName = operators.find((o) => o.id === resetOpId)?.name || "Operador";
        setResetOpId(null);
        setNewPassword("");
        toast.success(`Senha de "${opName}" redefinida com sucesso!`);
      }
    } finally {
      setIsResettingPassword(false);
    }
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

  const toggleChannelSelection = (channel: "whatsapp" | "instagram" | "messenger" | "livechat") => {
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

  const updateGroupCategoryPatch = <K extends keyof GroupPermissions>(
    groupId: string,
    category: K,
    patch: Partial<GroupPermissions[K]>
  ) => {
    const targetGroup = accessGroups.find(g => g.id === groupId);
    if (!targetGroup) return;

    const currentPerms = normalizeGroupPermissions(targetGroup);
    const updatedPerms: GroupPermissions = {
      ...currentPerms,
      [category]: {
        ...(currentPerms[category] as any),
        ...patch,
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

  const applyRolePreset = async (groupId: string, presetKey: string) => {
    const preset = ROLE_PRESETS[presetKey];
    if (!preset) return;

    const legacyUpdates: Partial<AccessGroup> = {
      permissions: normalizeGroupPermissions({ permissions: preset.permissions }),
      canCreateUser: preset.permissions.security.canManageUsers,
      canResetPassword: preset.permissions.security.canResetUserPasswords,
      canEditProfile: preset.permissions.chat.canEditClientInfo,
      canCaptureChat: preset.permissions.chat.canCaptureChat,
      canTransferChat: preset.permissions.chat.canTransferChat,
      canFinishChat: preset.permissions.chat.canFinishChat,
      canViewAllChats: preset.permissions.chat.canViewAllChats,
      canOverrideChat: preset.permissions.chat.canOverrideChat,
    };

    if (!await updateAccessGroup(groupId, legacyUpdates)) return;
    toast.success(`Perfil "${preset.name}" aplicado!`);
  };

  const toggleCategoryAll = async (groupId: string, category: keyof GroupPermissions, value: boolean) => {
    const targetGroup = accessGroups.find(g => g.id === groupId);
    if (!targetGroup) return;

    const currentPerms = normalizeGroupPermissions(targetGroup);
    const catObj = { ...(currentPerms[category] as any) };
    for (const k of Object.keys(catObj)) {
      if (typeof catObj[k] === "boolean") {
        catObj[k] = k === "restrictToOwnChats" ? !value : value;
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

    if (!await updateAccessGroup(groupId, legacyUpdates)) return;
    toast.success(`Categoria atualizada.`);
  };

  const updateGroupPermission = async (groupId: string, field: keyof AccessGroup, value: any) => {
    if (field === "allowedTenants") {
      toast.info("O acesso a outras empresas é configurado no grupo multiempresa acima.");
      return;
    }
    // Prevent removing admin permission entirely
    if (groupId === "group-admin" && field === "allowedChannels" && value.length === 0) {
      toast.warning("O grupo Administradores precisa ter acesso a pelo menos um canal.");
      return;
    }
    if (!await updateAccessGroup(groupId, { [field]: value })) return;
    toast.success("Permissões do grupo atualizadas.");
  };

  const tabs = [
    { id: "users" as const,     label: "Operadores & Usuários", icon: Users },
    { id: "groups" as const,    label: "Grupos de Acesso",      icon: FolderLock },
    { id: "sectors" as const,   label: "Setores",               icon: Building2 },
    { id: "wallets" as const,   label: "Carteiras Globais",     icon: Wallet },
    ...(canManageGlobalTemplates ? [{ id: "templates" as const, label: "Templates Globais", icon: LayoutTemplate }] : []),
  ];

  const groupTabIds = useMemo(() => tabs.map((t) => t.id), [tabs]);
  useTabNavigation({
    tabs: groupTabIds,
    activeTab,
    onChange: setActiveTab,
  });

  useSyncModuleTabWithUrl({
    viewId: "groups",
    activeTab,
    setActiveTab,
    allowedTabs: groupTabIds,
  });

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
      <div className="flex items-center justify-between px-4 md:px-6 py-3.5 md:py-4 border-b border-line shrink-0">
        <div>
          <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Grupos de Acesso
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">Segurança & Acessos — operadores, grupos, setores e carteiras</p>
        </div>
      </div>

      {/* Pill Tab Bar */}
      <div className="flex items-center gap-1 px-3 md:px-5 py-2.5 border-b border-line bg-muted/30 shrink-0 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6">

      {/* Tab Contents */}
      {activeTab === "users" ? (
        /* USERS / OPERATORS TAB */
        (() => {
          const searchNormalized = operatorSearch.trim().toLowerCase();
          const getOperatorSectors = (opId: string) =>
            sectors.filter((sec) => sec.operatorIds.includes(opId));

          const unassignedOperatorsCount = operators.filter(
            (op) => getOperatorSectors(op.id).length === 0,
          ).length;

          const filteredOperators = operators.filter((op) => {
            const opGroup = accessGroups.find((g) => g.id === op.groupId);
            const opSectors = getOperatorSectors(op.id);

            if (operatorGroupFilter !== "all" && op.groupId !== operatorGroupFilter) {
              return false;
            }

            if (selectedSectorFolder === "unassigned") {
              if (opSectors.length > 0) return false;
            } else if (selectedSectorFolder !== "all") {
              if (!opSectors.some((s) => s.id === selectedSectorFolder)) return false;
            }

            if (searchNormalized) {
              const matchName = op.name.toLowerCase().includes(searchNormalized);
              const matchEmail = op.email.toLowerCase().includes(searchNormalized);
              const matchGroup = (opGroup?.name || "").toLowerCase().includes(searchNormalized);
              const matchSector = opSectors.some((s) =>
                s.name.toLowerCase().includes(searchNormalized),
              );
              if (!matchName && !matchEmail && !matchGroup && !matchSector) {
                return false;
              }
            }

            return true;
          });

          const renderOperatorCard = (op: Operator) => {
            const group = accessGroups.find((g) => g.id === op.groupId);
            const opSectors = getOperatorSectors(op.id);
            const isMe = op.id === currentOperatorId;
            const isOnlineNow = Boolean(op.isOnline);
            const wizardTotal = Math.max(1, Number(op.wizardTotalSteps || 9));
            const wizardCompleted = Math.min(
              wizardTotal,
              Math.max(0, Number(op.wizardCompletedSteps || 0)),
            );
            const wizardPct =
              op.wizardStatus === "completed"
                ? 100
                : Math.min(
                    100,
                    Math.max(
                      0,
                      typeof op.wizardCompletionPct === "number"
                        ? op.wizardCompletionPct
                        : Math.round((wizardCompleted / wizardTotal) * 100),
                    ),
                  );
            const isWizardDone = wizardPct >= 100 || op.wizardStatus === "completed";
            const isCompletingThisWizard = completingWizardOpId === op.id;
            const isTogglingThisReset = togglingResetOpId === op.id;
            const mustResetPassword = Boolean(op.mustChangePassword);

            return (
              <div
                key={op.id}
                className={`flex flex-col justify-between gap-3 rounded-2xl bg-card p-4 border transition-all duration-200 ${
                  isMe
                    ? "border-primary/40 shadow-soft bg-primary-soft/5"
                    : "border-border shadow-xs hover:border-primary/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          onClick={() => handleAvatarClick(op.id)}
                          className="relative group cursor-pointer h-12 w-12 shrink-0"
                        >
                          <div className="h-12 w-12 rounded-full overflow-hidden border border-border shadow-xs relative">
                            {op.avatar ? (
                              <img
                                src={op.avatar}
                                alt={op.name}
                                className="h-full w-full object-cover border-0"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                  const parent = e.currentTarget.parentElement;
                                  if (parent) {
                                    const fallback = parent.querySelector(
                                      "[data-initials]",
                                    ) as HTMLElement;
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
                              {op.name
                                .trim()
                                .split(/\s+/)
                                .map((w: string) => w[0])
                                .filter(Boolean)
                                .join("")
                                .toUpperCase()
                                .slice(0, 2)}
                            </div>
                            <div className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <Camera className="h-4 w-4 text-white animate-in zoom-in-75 duration-100" />
                            </div>
                          </div>
                          <span
                            className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-card ${
                              isOnlineNow ? "bg-emerald-500" : "bg-muted-foreground/40"
                            }`}
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top">Alterar Foto do Operador</TooltipContent>
                    </Tooltip>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm text-foreground truncate">
                          {op.name}
                        </span>
                        {isMe && (
                          <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[8px] font-black uppercase text-primary tracking-wide">
                            Você / Ativo
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border ${
                            op.status === "disponivel"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                              : op.status === "pausa"
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                : "bg-muted text-muted-foreground border-border"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              op.status === "disponivel"
                                ? "bg-emerald-500"
                                : op.status === "pausa"
                                  ? "bg-amber-500"
                                  : "bg-muted-foreground"
                            }`}
                          />
                          {op.status === "disponivel"
                            ? "Disponível"
                            : op.status === "pausa"
                              ? "Em Pausa"
                              : "Offline"}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground block truncate mt-0.5">
                        {op.email}
                      </span>

                      {/* Pastas / Setores & Canais Permitidos */}
                      <div className="flex flex-wrap items-center gap-1 mt-2">
                        {opSectors.length > 0 ? (
                          opSectors.map((sec) => (
                            <SystemTooltip
                              key={sec.id}
                              content={`Filtrar pela pasta do setor ${sec.name}`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedSectorFolder(sec.id)}
                                className="inline-flex items-center gap-1 rounded-md bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 px-1.5 py-0.5 text-[9px] font-bold transition cursor-pointer"
                              >
                                <Folder className="h-2.5 w-2.5 shrink-0" />
                                {sec.name}
                              </button>
                            </SystemTooltip>
                          ))
                        ) : (
                          <SystemTooltip content="Clique para vincular este operador a um setor">
                            <button
                              type="button"
                              onClick={() => handleOpenEditOperator(op)}
                              className="inline-flex items-center gap-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground border border-border px-1.5 py-0.5 text-[9px] font-semibold transition cursor-pointer"
                            >
                              <FolderPlus className="h-2.5 w-2.5 shrink-0" />
                              Sem Setor
                            </button>
                          </SystemTooltip>
                        )}

                        {group?.allowedChannels.map((c) => (
                          <span
                            key={c}
                            className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold border ${
                              c === "whatsapp"
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : c === "instagram"
                                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                                  : c === "messenger"
                                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                                    : "bg-primary/10 text-primary border-primary/20"
                            }`}
                          >
                            {c === "whatsapp"
                              ? "whats"
                              : c === "livechat"
                                ? "site"
                                : c}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Botões de Ação */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleOpenEditOperator(op)}
                          className="grid h-8 w-8 place-items-center rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition cursor-pointer"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Editar Usuário (Nome, E-mail, Grupo, Setores e Senha)
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
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
                      <TooltipContent side="top">Redefinir Senha Rápida</TooltipContent>
                    </Tooltip>

                    {/* Ícone para Habilitar Logout Imediato + Redefinição de Senha no Próximo Login */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={isTogglingThisReset}
                          onClick={() => void handleTogglePasswordResetOnLogin(op)}
                          className={`grid h-8 w-8 place-items-center rounded-lg border transition cursor-pointer ${
                            mustResetPassword
                              ? "bg-primary/15 text-primary border-primary/30 shadow-2xs"
                              : "border-transparent hover:bg-primary/10 text-muted-foreground hover:text-primary"
                          } ${isTogglingThisReset ? "opacity-60 cursor-wait" : ""}`}
                        >
                          {isTogglingThisReset ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <div className="relative flex items-center justify-center">
                              <LogOut className="h-3.5 w-3.5" />
                              <KeyRound className="h-2.5 w-2.5 -ml-1 -mt-2" />
                            </div>
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px] text-center">
                        {mustResetPassword
                          ? "Redefinição de senha obrigatória ATIVA no próximo login (clique para desabilitar)"
                          : "Desconectar usuário agora e exigir que redefina a própria senha no próximo login"}
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={isMe}
                          onClick={() => {
                            if (!isMe) handleDeleteClick(op);
                          }}
                          className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                            isMe
                              ? "text-muted-foreground/30 cursor-not-allowed"
                              : "hover:bg-destructive/10 text-muted-foreground hover:text-destructive cursor-pointer"
                          }`}
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {isMe ? "Você não pode excluir sua própria conta" : "Excluir Operador"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Bloco de Telemetria de Presença, Uso Diário e Progresso do Wizard */}
                <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 space-y-2">
                  {/* Linha 1: Status Online Agora, Última vez online e Tempo de uso hoje */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold border ${
                          isOnlineNow
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-card text-muted-foreground border-border/70"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isOnlineNow ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50"
                          }`}
                        />
                        {isOnlineNow ? "Online agora" : "Offline"}
                      </span>

                      <span className="text-[10px] text-muted-foreground truncate">
                        {isOnlineNow
                          ? "Ativo neste momento"
                          : `Última vez: ${formatOperatorLastSeen(op.lastSeenAt, isOnlineNow)}`}
                      </span>
                    </div>

                    <SystemTooltip content="Tempo acumulado de uso ativo do sistema hoje">
                      <div className="inline-flex items-center gap-1 rounded-md bg-card border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground shrink-0">
                        <Clock className="h-3 w-3 text-primary shrink-0" />
                        <span>Hoje:</span>
                        <strong className="font-extrabold text-foreground">
                          {formatOperatorUsageToday(op.usageSecondsToday)}
                        </strong>
                      </div>
                    </SystemTooltip>
                  </div>

                  {mustResetPassword && (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-primary/10 border border-primary/20 px-2 py-1 text-[10px] text-primary font-bold">
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <KeyRound className="h-3 w-3 shrink-0" />
                        Redefinição de senha obrigatória no próximo acesso
                      </span>
                      <button
                        type="button"
                        disabled={isTogglingThisReset}
                        onClick={() => void handleTogglePasswordResetOnLogin(op)}
                        className="text-[10px] font-extrabold underline hover:opacity-80 shrink-0 cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}

                  {/* Linha 2: Barra de Progresso do Wizard + Opção para Completar Automaticamente */}
                  <div className="space-y-1.5 pt-1 border-t border-border/50">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Sparkles className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                          Wizard:
                        </span>
                        <span
                          className={`text-[11px] font-extrabold ${
                            isWizardDone
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-foreground"
                          }`}
                        >
                          {wizardPct}%
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          ({isWizardDone ? `${wizardTotal}/${wizardTotal}` : `${wizardCompleted}/${wizardTotal}`} etapas)
                        </span>
                      </div>

                      {isWizardDone ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold shrink-0">
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                          Concluído
                        </span>
                      ) : (
                        <SystemTooltip content="Completar automaticamente todas as etapas do Wizard para este usuário">
                          <button
                            type="button"
                            disabled={isCompletingThisWizard}
                            onClick={() => void handleAutoCompleteWizard(op)}
                            className="inline-flex items-center gap-1 rounded-md bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 px-2 py-0.5 text-[10px] font-bold transition cursor-pointer shrink-0 disabled:opacity-60"
                          >
                            {isCompletingThisWizard ? (
                              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3 shrink-0" />
                            )}
                            Completar Wizard
                          </button>
                        </SystemTooltip>
                      )}
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isWizardDone ? "bg-emerald-500" : "bg-primary"
                        }`}
                        style={{ width: `${wizardPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Rodapé do Card: Troca Direta de Grupo de Acesso + Atalho Editar */}
                <div className="pt-2.5 border-t border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground shrink-0 flex items-center gap-1">
                      <Shield className="h-3 w-3 text-primary" />
                      Grupo:
                    </span>
                    <div className="flex-1 max-w-[230px]">
                      <Select
                        value={op.groupId || ""}
                        onValueChange={(val) => void handleQuickGroupChange(op, val)}
                      >
                        <SelectTrigger className="h-7 w-full rounded-lg bg-muted/60 hover:bg-muted border border-border/70 text-[11px] font-bold text-foreground px-2.5 py-0 focus:ring-1 focus:ring-primary">
                          <SelectValue placeholder="Selecionar grupo..." />
                        </SelectTrigger>
                        <SelectContent>
                          {accessGroups.map((g) => (
                            <SelectItem key={g.id} value={g.id} className="text-xs">
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenEditOperator(op)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline cursor-pointer self-end sm:self-auto"
                  >
                    <Edit className="h-3 w-3" />
                    Editar cadastro / senha
                  </button>
                </div>
              </div>
            );
          };

          return (
            <div className="space-y-6">
              {/* Header Action */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-extrabold text-foreground">
                    Operadores & Usuários Cadastrados
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Gerencie contas, credenciais, grupos de acesso e organize atendentes em pastas por setor.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab("sectors")}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border bg-card hover:bg-muted px-3.5 text-xs font-bold text-foreground shadow-xs cursor-pointer transition"
                  >
                    <FolderPlus className="h-3.5 w-3.5 text-primary" />
                    Gerenciar Setores
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOpForm(!showOpForm)}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer transition-transform duration-150 active:scale-95"
                  >
                    <UserPlus className="h-4 w-4" />
                    {showOpForm ? "Fechar Cadastro" : "Adicionar Operador"}
                  </button>
                </div>
              </div>

              {/* New Operator Form */}
              {showOpForm && (
                <form
                  onSubmit={handleCreateOperator}
                  className="p-5 rounded-2xl bg-card border border-border shadow-soft space-y-4 animate-in fade-in slide-in-from-top-3 duration-200"
                >
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                        Nome Completo
                      </label>
                      <input
                        type="text"
                        required
                        value={opForm.name}
                        onChange={(e) => setOpForm({ ...opForm, name: e.target.value })}
                        placeholder="Ex: Carlos Santos"
                        className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-border/60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                        E-mail Corporativo
                      </label>
                      <input
                        type="email"
                        required
                        value={opForm.email}
                        onChange={(e) => setOpForm({ ...opForm, email: e.target.value })}
                        placeholder="carlos@empresa.com"
                        className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-border/60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                        Senha Inicial
                      </label>
                      <input
                        type="password"
                        required
                        value={opForm.password}
                        onChange={(e) => setOpForm({ ...opForm, password: e.target.value })}
                        placeholder="******"
                        className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-border/60"
                      />
                    </div>
                    <div className="space-y-1 flex flex-col justify-between">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                        Grupo de Acesso
                      </label>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Select
                            value={opForm.groupId}
                            onValueChange={(val) => setOpForm({ ...opForm, groupId: val })}
                          >
                            <SelectTrigger className="h-10 w-full rounded-xl bg-muted border-border/60 text-xs text-foreground px-3.5 focus:ring-1 focus:ring-primary">
                              <SelectValue placeholder="Selecione um grupo..." />
                            </SelectTrigger>
                            <SelectContent>
                              {accessGroups.map((g) => (
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
                              disabled={isCreatingOperator}
                              className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 cursor-pointer shadow-soft transition-transform active:scale-95 shrink-0 disabled:opacity-50"
                            >
                              {isCreatingOperator ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-5 w-5" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Confirmar Cadastro</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>

                  {/* Seletor de Pastas / Setores já na criação */}
                  {sectors.length > 0 && (
                    <div className="pt-3 border-t border-border/60 space-y-2">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
                        <Folder className="h-3 w-3 text-primary" />
                        Vincular às Pastas de Setores (Opcional):
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {sectors.map((sec) => {
                          const selected = opForm.sectorIds.includes(sec.id);
                          return (
                            <button
                              key={sec.id}
                              type="button"
                              onClick={() =>
                                setOpForm((prev) => ({
                                  ...prev,
                                  sectorIds: selected
                                    ? prev.sectorIds.filter((id) => id !== sec.id)
                                    : [...prev.sectorIds, sec.id],
                                }))
                              }
                              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold border transition cursor-pointer ${
                                selected
                                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                                  : "bg-muted/60 text-muted-foreground border-border hover:text-foreground hover:bg-muted"
                              }`}
                            >
                              {selected ? (
                                <FolderOpen className="h-3.5 w-3.5" />
                              ) : (
                                <Folder className="h-3.5 w-3.5" />
                              )}
                              {sec.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </form>
              )}

              {/* Password Reset Inline Panel */}
              {resetOpId && (
                <div className="p-5 rounded-2xl bg-card border-2 border-primary/30 shadow-card animate-in zoom-in-95 duration-150">
                  <form
                    onSubmit={handleResetPassword}
                    className="flex flex-col md:flex-row items-end gap-4"
                  >
                    <div className="flex-1 space-y-1.5 w-full">
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-primary flex items-center gap-1.5">
                        <Key className="h-3.5 w-3.5" />
                        Redefinir Senha do Operador:{" "}
                        {operators.find((o) => o.id === resetOpId)?.name}
                      </h4>
                      <div className="relative mt-1">
                        <input
                          type={showPassword ? "text" : "password"}
                          required
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Insira a nova senha segura..."
                          className="h-10 w-full rounded-xl bg-muted px-3.5 pr-10 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary border border-border"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={isResettingPassword}
                        className="inline-flex items-center gap-2 h-10 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground hover:opacity-90 shadow-soft cursor-pointer disabled:opacity-50"
                      >
                        {isResettingPassword && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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

              {/* Barra de Busca + Filtro de Grupo + Alternador de Visão (Pastas vs Grade) */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl border border-border bg-muted/20 p-3.5">
                {/* Search Input */}
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={operatorSearch}
                    onChange={(e) => setOperatorSearch(e.target.value)}
                    placeholder="Buscar operador por nome, e-mail, grupo de acesso ou setor..."
                    className="h-10 w-full rounded-xl bg-card pl-10 pr-9 text-xs text-foreground placeholder:text-muted-foreground border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none transition"
                  />
                  {operatorSearch && (
                    <button
                      type="button"
                      onClick={() => setOperatorSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Limpar busca"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Filters & View Mode */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Filtro por Grupo de Acesso */}
                  <div className="w-full sm:w-52">
                    <Select
                      value={operatorGroupFilter}
                      onValueChange={(val) => setOperatorGroupFilter(val)}
                    >
                      <SelectTrigger className="h-10 w-full rounded-xl bg-card border border-border text-xs font-semibold text-foreground px-3.5">
                        <SelectValue placeholder="Filtrar por grupo..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs font-semibold">
                          Todos os Grupos ({operators.length})
                        </SelectItem>
                        {accessGroups.map((g) => {
                          const count = operators.filter((o) => o.groupId === g.id).length;
                          return (
                            <SelectItem key={g.id} value={g.id} className="text-xs">
                              {g.name} ({count})
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Alternador: Visão em Pastas vs Grade */}
                  <div className="inline-flex items-center rounded-xl border border-border bg-card p-1">
                    <button
                      type="button"
                      onClick={() => setOperatorViewMode("folders")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition cursor-pointer ${
                        operatorViewMode === "folders"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Agrupar operadores dentro das pastas de cada Setor"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Pastas
                    </button>
                    <button
                      type="button"
                      onClick={() => setOperatorViewMode("grid")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition cursor-pointer ${
                        operatorViewMode === "grid"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Exibir operadores em grade contínua"
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                      Grade
                    </button>
                  </div>

                  {(operatorSearch ||
                    selectedSectorFolder !== "all" ||
                    operatorGroupFilter !== "all") && (
                    <button
                      type="button"
                      onClick={() => {
                        setOperatorSearch("");
                        setSelectedSectorFolder("all");
                        setOperatorGroupFilter("all");
                      }}
                      className="inline-flex items-center gap-1 h-10 rounded-xl border border-border bg-card hover:bg-muted px-3 text-xs font-bold text-muted-foreground hover:text-foreground transition cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                      Limpar Filtros
                    </button>
                  )}
                </div>
              </div>

              {/* Navegação de Pastas por Setor (Cada Setor criado na aba Setores = 1 Pasta) */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5 text-primary" />
                    Pastas por Setor ({sectors.length} setor{sectors.length === 1 ? "" : "es"})
                  </span>
                  <span className="text-[11px] text-muted-foreground font-semibold">
                    Exibindo <strong className="text-foreground">{filteredOperators.length}</strong>{" "}
                    de <strong className="text-foreground">{operators.length}</strong> operador(es)
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                  {/* Pasta: Todos os Operadores */}
                  <button
                    type="button"
                    onClick={() => setSelectedSectorFolder("all")}
                    className={`group flex flex-col justify-between rounded-2xl border p-3 text-left transition-all cursor-pointer ${
                      selectedSectorFolder === "all"
                        ? "border-primary bg-primary/10 text-foreground shadow-soft"
                        : "border-border bg-card hover:border-primary/40 hover:bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={`grid h-8 w-8 place-items-center rounded-xl transition ${
                          selectedSectorFolder === "all"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground group-hover:text-primary"
                        }`}
                      >
                        {selectedSectorFolder === "all" ? (
                          <FolderOpen className="h-4 w-4" />
                        ) : (
                          <Folder className="h-4 w-4" />
                        )}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                          selectedSectorFolder === "all"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {operators.length}
                      </span>
                    </div>
                    <div className="mt-2.5">
                      <span className="text-xs font-extrabold text-foreground block truncate">
                        Todos os Setores
                      </span>
                      <span className="text-[10px] text-muted-foreground block truncate">
                        Visão completa
                      </span>
                    </div>
                  </button>

                  {/* Pastas Dinâmicas de cada Setor criado na aba Setores */}
                  {sectors.map((sec) => {
                    const isSelected = selectedSectorFolder === sec.id;
                    const sectorOps = operators.filter((op) =>
                      sec.operatorIds.includes(op.id),
                    );
                    return (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() =>
                          setSelectedSectorFolder(isSelected ? "all" : sec.id)
                        }
                        className={`group flex flex-col justify-between rounded-2xl border p-3 text-left transition-all cursor-pointer ${
                          isSelected
                            ? "border-primary bg-primary/10 text-foreground shadow-soft"
                            : "border-border bg-card hover:border-primary/40 hover:bg-muted/30 text-muted-foreground"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div
                            className={`grid h-8 w-8 place-items-center rounded-xl transition ${
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground group-hover:text-primary"
                            }`}
                          >
                            {isSelected ? (
                              <FolderOpen className="h-4 w-4" />
                            ) : (
                              <Folder className="h-4 w-4" />
                            )}
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground"
                            }`}
                          >
                            {sectorOps.length}
                          </span>
                        </div>
                        <div className="mt-2.5">
                          <span
                            className="text-xs font-extrabold text-foreground block truncate"
                            title={sec.name}
                          >
                            {sec.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground block truncate">
                            {sectorOps.length === 1
                              ? "1 operador na pasta"
                              : `${sectorOps.length} operadores`}
                          </span>
                        </div>
                      </button>
                    );
                  })}

                  {/* Pasta: Sem Setor */}
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedSectorFolder(
                        selectedSectorFolder === "unassigned" ? "all" : "unassigned",
                      )
                    }
                    className={`group flex flex-col justify-between rounded-2xl border p-3 text-left transition-all cursor-pointer ${
                      selectedSectorFolder === "unassigned"
                        ? "border-primary bg-primary/10 text-foreground shadow-soft"
                        : "border-dashed border-border bg-card/70 hover:border-primary/40 hover:bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={`grid h-8 w-8 place-items-center rounded-xl transition ${
                          selectedSectorFolder === "unassigned"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground group-hover:text-primary"
                        }`}
                      >
                        <Folder className="h-4 w-4" />
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                          selectedSectorFolder === "unassigned"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {unassignedOperatorsCount}
                      </span>
                    </div>
                    <div className="mt-2.5">
                      <span className="text-xs font-extrabold text-foreground block truncate">
                        Sem Setor
                      </span>
                      <span className="text-[10px] text-muted-foreground block truncate">
                        Não alocados
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Listagem de Operadores: Agrupada por Pastas de Setores ou em Grade */}
              {filteredOperators.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center space-y-2">
                  <Users className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                  <h4 className="text-sm font-bold text-foreground">
                    Nenhum operador encontrado para os filtros aplicados
                  </h4>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Tente ajustar o termo de busca ou selecionar outra pasta de setor / grupo de acesso.
                  </p>
                </div>
              ) : operatorViewMode === "folders" && selectedSectorFolder === "all" && sectors.length > 0 ? (
                <div className="space-y-4">
                  {sectors.map((sec) => {
                    const opsInFolder = filteredOperators.filter((op) =>
                      sec.operatorIds.includes(op.id),
                    );
                    if (opsInFolder.length === 0 && (operatorSearch || operatorGroupFilter !== "all")) {
                      return null;
                    }
                    const isCollapsed = !!collapsedFolders[sec.id];
                    return (
                      <div
                        key={sec.id}
                        className="rounded-2xl border border-border bg-card/60 overflow-hidden shadow-xs"
                      >
                        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border/60">
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedFolders((prev) => ({
                                ...prev,
                                [sec.id]: !prev[sec.id],
                              }))
                            }
                            className="flex items-center gap-2.5 text-left flex-1 cursor-pointer"
                          >
                            <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                              {isCollapsed ? (
                                <Folder className="h-4 w-4" />
                              ) : (
                                <FolderOpen className="h-4 w-4" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-extrabold text-foreground">
                                  {sec.name}
                                </span>
                                <span className="rounded-full bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[10px] font-black">
                                  {opsInFolder.length} operador(es)
                                </span>
                              </div>
                              <span className="text-[10px] text-muted-foreground block">
                                Pasta do setor · Clique para {isCollapsed ? "expandir" : "recolher"}
                              </span>
                            </div>
                          </button>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSectorId(sec.id);
                                setActiveTab("sectors");
                              }}
                              className="text-[10px] font-bold text-primary hover:underline cursor-pointer px-2 py-1"
                            >
                              Gerenciar membros
                            </button>
                            <ChevronDown
                              onClick={() =>
                                setCollapsedFolders((prev) => ({
                                  ...prev,
                                  [sec.id]: !prev[sec.id],
                                }))
                              }
                              className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${
                                isCollapsed ? "-rotate-90" : ""
                              }`}
                            />
                          </div>
                        </div>

                        {!isCollapsed && (
                          <div className="p-4">
                            {opsInFolder.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {opsInFolder.map((op) => renderOperatorCard(op))}
                              </div>
                            ) : (
                              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                                Nenhum operador vinculado a esta pasta ainda.{" "}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedSectorId(sec.id);
                                    setActiveTab("sectors");
                                  }}
                                  className="font-bold text-primary hover:underline cursor-pointer ml-1"
                                >
                                  Adicionar membros
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Pasta Sem Setor na visão de pastas */}
                  {(() => {
                    const unassignedFiltered = filteredOperators.filter(
                      (op) => getOperatorSectors(op.id).length === 0,
                    );
                    if (unassignedFiltered.length === 0) return null;
                    const isCollapsed = !!collapsedFolders["__unassigned__"];
                    return (
                      <div className="rounded-2xl border border-dashed border-border bg-card/40 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 bg-muted/20 border-b border-border/60">
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedFolders((prev) => ({
                                ...prev,
                                __unassigned__: !prev["__unassigned__"],
                              }))
                            }
                            className="flex items-center gap-2.5 text-left flex-1 cursor-pointer"
                          >
                            <div className="grid h-8 w-8 place-items-center rounded-xl bg-muted text-muted-foreground border border-border">
                              <Folder className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-extrabold text-foreground">
                                  Sem Setor Vinculado
                                </span>
                                <span className="rounded-full bg-muted text-foreground border border-border px-2 py-0.5 text-[10px] font-black">
                                  {unassignedFiltered.length} operador(es)
                                </span>
                              </div>
                              <span className="text-[10px] text-muted-foreground block">
                                Operadores que ainda não foram alocados em uma pasta de setor
                              </span>
                            </div>
                          </button>
                          <ChevronDown
                            onClick={() =>
                              setCollapsedFolders((prev) => ({
                                ...prev,
                                __unassigned__: !prev["__unassigned__"],
                              }))
                            }
                            className={`h-4 w-4 text-muted-foreground cursor-pointer transition-transform ${
                              isCollapsed ? "-rotate-90" : ""
                            }`}
                          />
                        </div>
                        {!isCollapsed && (
                          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {unassignedFiltered.map((op) => renderOperatorCard(op))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedSectorFolder !== "all" && (
                    <div className="flex items-center justify-between rounded-2xl border border-primary/25 bg-primary/5 px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4 text-primary" />
                        <span className="text-xs font-extrabold text-foreground">
                          Pasta ativa:{" "}
                          {selectedSectorFolder === "unassigned"
                            ? "Sem Setor Vinculado"
                            : sectors.find((s) => s.id === selectedSectorFolder)?.name || "Setor"}
                        </span>
                        <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-black">
                          {filteredOperators.length} operador(es)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedSectorFolder("all")}
                        className="text-xs font-bold text-primary hover:underline cursor-pointer"
                      >
                        Ver todas as pastas
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredOperators.map((op) => renderOperatorCard(op))}
                  </div>
                </div>
              )}
            </div>
          );
        })()
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
                    <button type="button" onClick={() => toggleChannelSelection("livechat")}
                      className={`flex-1 h-8 rounded-lg text-[10px] font-bold border cursor-pointer ${groupForm.allowedChannels.includes("livechat") ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      Site
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
                        className="h-7 w-7 grid place-items-center rounded hover:bg-destructive/15 text-destructive transition cursor-pointer"
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                                ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-500 font-bold"
                                : "border-border bg-card text-muted-foreground opacity-60 hover:opacity-100"
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
                                ? "border-purple-500/60 bg-purple-500/10 text-purple-500 font-bold"
                                : "border-border bg-card text-muted-foreground opacity-60 hover:opacity-100"
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
                                ? "border-blue-500/60 bg-blue-500/10 text-blue-500 font-bold"
                                : "border-border bg-card text-muted-foreground opacity-60 hover:opacity-100"
                            }`}
                          >
                            <Send className="h-4 w-4 shrink-0" />
                            <div>
                              <span className="text-xs font-bold block text-foreground">Messenger</span>
                              <span className="text-[9px] text-muted-foreground block font-normal">Facebook Mensagens</span>
                            </div>
                          </div>

                          {/* Site / Live Chat */}
                          <div
                            onClick={() => {
                              const channels = selectedGroupObj.allowedChannels;
                              updateGroupPermission(
                                selectedGroupId,
                                "allowedChannels",
                                channels.includes("livechat") ? channels.filter(c => c !== "livechat") : [...channels, "livechat"],
                              );
                            }}
                            className={`rounded-xl p-3 border transition cursor-pointer flex items-center gap-3 ${
                              selectedGroupObj.allowedChannels.includes("livechat")
                                ? "border-primary/60 bg-primary/10 text-primary font-bold"
                                : "border-border bg-card text-muted-foreground opacity-60 hover:opacity-100"
                            }`}
                          >
                            <Globe className="h-4 w-4 shrink-0" />
                            <div>
                              <span className="text-xs font-bold block text-foreground">Site / Live Chat</span>
                              <span className="text-[9px] text-muted-foreground block font-normal">Widget na Loja</span>
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
                          ...(tenant === "tecfag" ? [{ key: "commercialHome", label: "Início Comercial", desc: "Cockpit pessoal do consultor" }] : []),
                          ...(tenant === "tecfag" ? [
                            { key: "commercialManagement", label: "Gestão Comercial", desc: "Gestão de equipes, metas e diretrizes" },
                            { key: "commercialBi", label: "War Room Comercial", desc: "Indicadores comerciais consolidados" },
                          ] : []),
                          { key: "crm",       label: "Negociações", desc: "Acesso ao CRM próprio" },
                          { key: "tasks",     label: "Tarefas & Compromissos", desc: "Acesso ao kanban de tarefas do operador" },
                          { key: "contacts",  label: "Base de Contatos", desc: "Acesso à lista e fichas de clientes" },
                          { key: "wallet",   label: "Carteiras Globais", desc: "Acesso à gestão de carteiras comerciais" },
                          { key: "valentina", label: `${aiPersona.name} IA Hub`, desc: "Acesso ao SDR, Rodízio e Base de Conhecimento" },
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
                        <button type="button" className="sm:col-span-2 rounded-xl border border-border p-3 text-left text-xs font-bold hover:bg-muted"
                          onClick={() => { void updateAccessGroup(selectedGroupId, { permissions: { ...perms, chat: { ...perms.chat, ...OWN_CONVERSATIONS_PRESET } }, canViewAllChats: false }); }}>
                          Aplicar visibilidade: somente Meus
                        </button>
                        {[
                          { key: "canCaptureChat",           label: "Capturar Atendimentos", desc: "Puxar conversas da fila de espera ou IA para si" },
                          { key: "canTransferChat",          label: "Transferir Atendimentos", desc: "Enviar diretamente a um operador ou para a fila de um setor; atendimento alheio também exige Assumir Atendimento Alheio" },
                          { key: "canFinishChat",            label: "Encerrar Atendimentos", desc: "Finalizar atendimentos ativos e arquivar" },
                          { key: "canViewAllChats",          label: "Visualizar Todos os Chats", desc: "Ver conversas atribuídas a outros (leitura)" },
                          { key: "restrictToOwnChats",       label: "Restringir somente aos próprios atendimentos", desc: "Bloqueia conversas sem responsável e de outros operadores, inclusive na visão Todos" },
                          { key: "canViewQueueMine",         label: "Visualizar fila Meus", desc: "Permitir conversas em atendimento humano dentro do alcance concedido" },
                          { key: "canViewQueueWaiting",      label: "Visualizar fila de espera", desc: "Permitir consultar e capturar conversas da fila, se tiver direito de captura" },
                          { key: "canViewQueueBot",          label: "Visualizar Automação", desc: "Permitir consultar conversas que estão com o bot" },
                          { key: "canViewQueueClosed",       label: "Visualizar Finalizados", desc: "Permitir consultar históricos encerrados dentro do alcance concedido" },
                          { key: "canOverrideChat",          label: "Assumir Atendimento Alheio", desc: "Permite tomar ou transferir conversa de outro operador dentro da visibilidade concedida" },
                          { key: "canSendInternalNotes",     label: "Enviar Notas Internas", desc: "Criar recados e anotações ocultas para a equipe" },
                          { key: "canEditClientInfo",        label: "Editar Cadastro no Chat", desc: "Alterar CNPJ, Razão Social, E-mail na barra lateral" },
                          { key: "canManageTags",            label: "Gerenciar Tags", desc: "Adicionar ou remover etiquetas de clientes" },
                          { key: "canManageRdCrm",           label: "Criar Oportunidade RD CRM", desc: "Disparar lead para o funil do RD Station CRM" },
                          { key: "canChangeWallet",  label: "Alterar Carteira no Chat", desc: "Reatribuir a titularidade do cliente diretamente na conversa" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.chat[key as keyof typeof perms.chat] ?? false;
                          const isAdminOnly = key === "canOverrideChat";
                          return (
                            <label key={key} className={`flex items-start gap-3 rounded-xl border p-3 transition cursor-pointer ${
                              isAdminOnly ? "border-destructive/30 bg-destructive/10 hover:bg-destructive/15" : "border-border bg-muted/20 hover:bg-muted/30"
                            }`}>
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "chat", key, !!checked)}
                                className={`shrink-0 mt-0.5 ${isAdminOnly ? "border-destructive data-[state=checked]:bg-destructive data-[state=checked]:text-destructive-foreground" : ""}`}
                              />
                              <div>
                                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                  {label}
                                  {isAdminOnly && <span className="text-[9px] font-bold text-destructive bg-destructive/15 border border-destructive/20 px-1.5 py-0.5 rounded">Crítico</span>}
                                </span>
                                <span className="text-[10px] text-muted-foreground block leading-snug">{desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <WhatsappGroupPermissions key={`${tenant}:${selectedGroupObj.id}`} groupId={selectedGroupObj.id} search={permissionSearch} />

                  <CrmGroupPermissions
                    permissions={perms.crm}
                    search={permissionSearch}
                    onChange={(key, value) => updateGroupGranular(selectedGroupId, "crm", key, value)}
                    onPatch={(patch) => updateGroupCategoryPatch(selectedGroupId, "crm", patch)}
                  />

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
                        <span className="text-xs font-black uppercase tracking-wide text-foreground">4. {aiPersona.name} IA Hub</span>
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
                          { key: "canAccessChat",      label: `Chat com ${aiPersona.gender === "female" ? "a" : "o"} ${aiPersona.name}`, desc: "Conversar diretamente com a assistente de IA" },
                          { key: "canAccessSdr",       label: "Visualizar Leads SDR", desc: "Ver a fila de triagem e captação de leads" },
                          { key: "canManageSdr",       label: "Gerenciar & Pausar SDR", desc: "Alterar comportamento ou pausar bot SDR" },
                          { key: "canAccessRodizio",   label: "Visualizar Rodízio de Leads", desc: "Acompanhar distribuição e pesos de fila" },
                          { key: "canManageRodizio",   label: "Configurar Rodízio & Pesos", desc: "Adicionar/remover atendentes do rodízio" },
                          { key: "canAccessSupervisor",label: `${aiPersona.name} Supervisor`, desc: "Consultar IA para análise operacional" },
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
                          { key: "canAccessHistory",  label: "Histórico & Transcrições", desc: "Ouvir gravações e ler transcrições da IA" },
                          { key: "canAccessClients",   label: "Base de Clientes de Voz", desc: "Listagem de contatos qualificados para ligação" },
                          { key: "canTriggerTestCall",  label: "Disparar Teste de Ligação", desc: `Fazer ligação de teste imediata com ${aiPersona.gender === "female" ? "a" : "o"} ${aiPersona.name}` },
                          { key: "canManageCampaigns",  label: "Gerenciar Campanhas em Massa", desc: "Criar e disparar disparos de voz para listas" },
                          { key: "canManageObjectives",  label: "Definir Objetivos da IA", desc: "Configurar metas e prompts de ligação" },
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
                          { key: "canAccessRanking",  label: "Ranking de Operadores", desc: "Comparativo de produtividade da equipe" },
                          { key: "canAccessAudits",     label: "Auditorias de Atendimento", desc: "Ver notas e pareceres da IA avaliadora" },
                          { key: "canManageAudits",     label: "Aprovar / Recalibrar Auditorias", desc: "Validar notas e enviar feedback para operadores" },
                          { key: "canAccessSiteVisitors",       label: "Visitantes do Site (Live Chat)", desc: "Ver fluxo de visitantes online navegando na loja" },
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
                          { key: "canAccessAiReports",     label: "Relatórios Executivos IA", desc: "Geração de resumos e relatórios analíticos" },
                          { key: "canAccessCosts",       label: "Painel de Custos de IA", desc: "Gastos com Vertex AI, tokens e transcrições" },
                        ].map(({ key, label, desc }) => {
                          if (!matchesSearch(label, desc)) return null;
                          const isChecked = perms.analytics[key as keyof typeof perms.analytics] ?? false;
                          const isCost = key === "canAccessCosts";
                          return (
                            <label key={key} className={`flex items-start gap-3 rounded-xl border p-3 transition cursor-pointer ${
                              isCost ? "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15" : "border-border bg-muted/20 hover:bg-muted/30"
                            }`}>
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => updateGroupGranular(selectedGroupId, "analytics", key, !!checked)}
                                className="shrink-0 mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                  {label}
                                  {isCost && <span className="text-[9px] font-bold text-amber-500 bg-amber-500/15 border border-amber-500/20 px-1.5 py-0.5 rounded">Financeiro</span>}
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
                          { key: "canManageAccessGroups",       label: "Criar & Editar Grupos", desc: "Modificar permissões e criar novos papéis" },
                          { key: "canManageSectors",      label: "Gerenciar Setores", desc: "Criar e editar departamentos de atendimento" },
                          { key: "canManageWallets",      label: "Gerenciar Carteiras Globais", desc: "Distribuir carteiras comerciais de clientes" },
                          { key: "canManageGlobalTemplates", label: "Gerenciar Templates Globais", desc: "Criar respostas rápidas e templates oficiais da Meta" },
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
                          { key: "canManageWhatsapp", label: "Conexões WhatsApp", desc: "Configurar QR Code Baileys ou Meta API" },
                          { key: "canManageVoiceSettings",      label: "Telefonia & Twilio", desc: "Configurar credenciais e números de voz" },
                          { key: "canManageRdCrmSettings",       label: "Integração RD CRM", desc: "Conectar OAuth da RD Station" },
                          { key: "canManageEmailSmtp",    label: "E-mail & SMTP", desc: "Configurar servidor de envio de relatórios" },
                          { key: "canManageLiveChatSettings", label: "Widget Live Chat", desc: "Configurar script do chat no site" },
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
                          className="h-7 w-7 grid place-items-center rounded hover:bg-destructive/15 text-destructive transition cursor-pointer"
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
                      <SystemTooltip content="Clique para editar o nome do setor">
                        <input
                          type="text"
                          value={selectedSectorObj.name}
                          onChange={(e) => updateSector(selectedSectorObj.id, { name: e.target.value })}
                          className="text-sm font-extrabold text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-1 py-0.5 transition w-full max-w-sm"
                        />
                      </SystemTooltip>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Gerencie os atendentes e a personalização do Copiloto {aiPersona.name} para este setor de operação.
                    </p>
                  </div>
                </header>

                {/* Configuração do Copiloto IA do Setor */}
                <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-4 sm:p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-border/60 pb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Sparkles className="h-4 w-4 text-primary shrink-0" />
                        <h5 className="text-xs font-black text-foreground uppercase tracking-wide">
                          Copiloto {aiPersona.name} — Boas-vindas &amp; Sugestões do Setor
                        </h5>
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                          Setor: {selectedSectorObj.name}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Personalize a mensagem inicial e os botões de perguntas sugeridas exibidos quando um colaborador deste setor abre o Copiloto {aiPersona.name}.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <SystemTooltip content="Restaurar mensagem inicial e perguntas recomendadas originalmente para este setor">
                        <button
                          type="button"
                          onClick={handleRestoreSectorCopilotDefault}
                          disabled={isSavingSectorCopilot || !selectedSectorObj.id}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground hover:border-primary/40 transition cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Restaurar padrão
                        </button>
                      </SystemTooltip>
                      <button
                        type="button"
                        onClick={handleSaveSectorCopilot}
                        disabled={isSavingSectorCopilot || !selectedSectorObj.id}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-[11px] font-bold text-primary-foreground shadow-sm hover:opacity-95 transition cursor-pointer disabled:opacity-50"
                      >
                        {isSavingSectorCopilot ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Salvar Copiloto
                      </button>
                    </div>
                  </div>

                  {/* Mensagem Inicial */}
                  <div className="space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                      <label className="text-[11px] font-extrabold text-foreground uppercase tracking-wide">
                        Mensagem Inicial do Copiloto
                      </label>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground font-medium">Variáveis:</span>
                        {[
                          { token: "{{saudacao}}", desc: "Insere Bom dia / Boa tarde / Boa noite automaticamente" },
                          { token: "{{nome}}", desc: "Insere o primeiro nome do operador logado" },
                          { token: "{{ia}}", desc: `Insere o nome do copiloto (${aiPersona.name})` },
                          { token: "{{setor}}", desc: `Insere o nome deste setor (${selectedSectorObj.name})` },
                        ].map((v) => (
                          <SystemTooltip key={v.token} content={v.desc}>
                            <button
                              type="button"
                              onClick={() => handleInsertSectorWelcomeVar(v.token)}
                              className="rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-primary hover:bg-primary/20 transition cursor-pointer"
                            >
                              + {v.token}
                            </button>
                          </SystemTooltip>
                        ))}
                      </div>
                    </div>

                    <textarea
                      rows={3}
                      value={sectorWelcomeDraft}
                      onChange={(e) => setSectorWelcomeDraft(e.target.value)}
                      placeholder="Digite a mensagem inicial que o copiloto enviará para os colaboradores deste setor..."
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none transition resize-y"
                    />

                    {/* Pré-visualização ao vivo */}
                    <div className="rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Pré-visualização para o operador
                        </span>
                        <span className="text-[10px] text-primary font-semibold">
                          {aiPersona.name} • {selectedSectorObj.name}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/90 leading-relaxed">
                        {interpolateCopilotWelcomeMessage(sectorWelcomeDraft || "", {
                          operatorName:
                            operators.find((o) => o.id === currentOperatorId)?.name || "Colaborador",
                          aiName: aiPersona.name,
                          sectorName: selectedSectorObj.name,
                        })}
                      </p>
                    </div>
                  </div>

                  {/* Sugestões de Perguntas Iniciais */}
                  <div className="space-y-2.5 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <label className="text-[11px] font-extrabold text-foreground uppercase tracking-wide block">
                          Sugestões de Perguntas Iniciais ({sectorSuggestionsDraft.length})
                        </label>
                        <span className="text-[10px] text-muted-foreground">
                          Botões rápidos exibidos logo abaixo da mensagem inicial do Copiloto {aiPersona.name}.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSectorSuggestionsDraft((prev) => [
                            ...prev,
                            `Nova sugestão para ${selectedSectorObj.name}`,
                          ])
                        }
                        disabled={sectorSuggestionsDraft.length >= 8}
                        className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-primary/20 transition cursor-pointer disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Adicionar pergunta
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {sectorSuggestionsDraft.map((suggestion, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 focus-within:border-primary transition"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-extrabold text-primary">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={suggestion}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSectorSuggestionsDraft((prev) =>
                                prev.map((item, i) => (i === idx ? val : item)),
                              );
                            }}
                            placeholder="Ex: Quais chamados estão aguardando retorno?"
                            className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                          />
                          {sectorSuggestionsDraft.length > 1 && (
                            <SystemTooltip content="Remover esta sugestão">
                              <button
                                type="button"
                                onClick={() =>
                                  setSectorSuggestionsDraft((prev) =>
                                    prev.filter((_, i) => i !== idx),
                                  )
                                }
                                className="p-1 text-muted-foreground hover:text-destructive transition cursor-pointer shrink-0"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </SystemTooltip>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Users className="h-4 w-4 text-primary" />
                        <h5 className="text-xs font-black text-foreground uppercase tracking-wide">Membros do Setor</h5>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Selecione quais operadores realizam atendimentos neste setor. Eles aparecerão na pasta deste setor e receberão o Copiloto configurado acima.
                      </p>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Buscar operador no setor..."
                        value={sectorMemberSearch}
                        onChange={(e) => setSectorMemberSearch(e.target.value)}
                        className="h-9 w-full rounded-xl bg-muted/60 pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-primary focus:bg-card transition"
                      />
                      {sectorMemberSearch && (
                        <button
                          type="button"
                          onClick={() => setSectorMemberSearch("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {operators
                      .filter((op) => {
                        const q = sectorMemberSearch.toLowerCase().trim();
                        if (!q) return true;
                        const group = accessGroups.find(g => g.id === op.groupId);
                        return (
                          op.name.toLowerCase().includes(q) ||
                          op.email.toLowerCase().includes(q) ||
                          (group?.name || "").toLowerCase().includes(q)
                        );
                      })
                      .map((op) => {
                        const isMember = selectedSectorObj.operatorIds.includes(op.id);
                        const group = accessGroups.find(g => g.id === op.groupId);
                        
                        return (
                          <label
                            key={op.id}
                            className={`flex items-center gap-3 rounded-xl border p-3 hover:bg-muted/30 transition cursor-pointer ${
                              isMember ? "border-primary bg-primary/10" : "border-border bg-card"
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
                            <img src={op.avatar} alt={op.name} className="h-8 w-8 rounded-full object-cover shrink-0 border border-border" />
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-foreground">Carteirização Global</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Gerencie os clientes associados à carteira de cada vendedor.</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar vendedor por nome ou e-mail..."
                value={walletOperatorSearch}
                onChange={(e) => setWalletOperatorSearch(e.target.value)}
                className="h-10 w-full rounded-xl bg-card pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-primary transition shadow-2xs"
              />
              {walletOperatorSearch && (
                <button
                  type="button"
                  onClick={() => setWalletOperatorSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {operators
              .filter((op) => {
                const q = walletOperatorSearch.toLowerCase().trim();
                if (!q) return true;
                return op.name.toLowerCase().includes(q) || op.email.toLowerCase().includes(q);
              })
              .map((op) => (
                <OperatorWalletCard
                  key={op.id}
                  op={op}
                />
              ))}
          </div>
        </div>
      ) : canManageGlobalTemplates ? (
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
          <MetaTemplatesManager tenant={tenant} />
        </div>
      ) : null}

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
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">Texto da Mensagem</label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setQrForm((prev) => ({ ...prev, text: `${prev.text}{{nome}}` }))}
                      className="rounded-lg bg-primary-soft/60 hover:bg-primary-soft border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary transition cursor-pointer"
                    >
                      + {"{{nome}}"} Cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrForm((prev) => ({ ...prev, text: `${prev.text}{{operador}}` }))}
                      className="rounded-lg bg-primary-soft/60 hover:bg-primary-soft border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary transition cursor-pointer"
                    >
                      + {"{{operador}}"} Meu Nome
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrForm((prev) => ({ ...prev, text: `${prev.text}{{empresa}}` }))}
                      className="rounded-lg bg-primary-soft/60 hover:bg-primary-soft border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary transition cursor-pointer"
                    >
                      + {"{{empresa}}"} Empresa
                    </button>
                  </div>
                </div>
                <textarea
                  placeholder="Olá! {{nome}}, meu nome é {{operador}} faço parte do time da {{empresa}}, como posso te ajudar hoje?"
                  value={qrForm.text}
                  onChange={(e) => setQrForm({ ...qrForm, text: e.target.value })}
                  rows={4}
                  className="rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:bg-card focus:shadow-soft resize-none scrollbar-thin leading-relaxed"
                  required
                />
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

      {/* Modal Completo de Edição de Operador / Usuário */}
      {editingOperator && createPortal(
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSavingOperatorEdit) {
              setEditingOperator(null);
            }
          }}
        >
          <div className="relative w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden bg-card border border-border text-foreground animate-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]">
            {/* Cabeçalho */}
            <div className="flex items-center gap-3.5 px-6 pt-5 pb-4 border-b border-border bg-muted/20 shrink-0">
              <div className="relative shrink-0">
                <img
                  src={editingOperator.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(editingOperator.name || "OP")}`}
                  alt={editingOperator.name}
                  className="h-12 w-12 rounded-full object-cover border-2 border-primary/30 bg-muted"
                />
                <span
                  className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full ring-2 ring-card ${
                    editingOperator.status === "disponivel"
                      ? "bg-emerald-500"
                      : editingOperator.status === "pausa"
                        ? "bg-amber-500"
                        : "bg-muted-foreground"
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-md border border-primary/20">
                    Editar Usuário
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono truncate">
                    ID: {editingOperator.id}
                  </span>
                </div>
                <h3 className="text-base font-extrabold text-foreground truncate mt-0.5">
                  {editingOperator.name || "Operador"}
                </h3>
              </div>
              <button
                type="button"
                disabled={isSavingOperatorEdit}
                onClick={() => setEditingOperator(null)}
                className="h-8 w-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Formulário de Edição */}
            <form onSubmit={handleSaveOperatorEdit} className="flex flex-col flex-1 overflow-hidden">
              <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1 scrollbar-thin">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Nome */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                      Nome Completo
                    </label>
                    <input
                      type="text"
                      required
                      value={editingOperator.name}
                      onChange={(e) => setEditingOperator({ ...editingOperator, name: e.target.value })}
                      placeholder="Ex: Maria Oliveira"
                      className="h-10 w-full rounded-xl bg-muted/60 px-3.5 text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-primary focus:bg-card transition"
                    />
                  </div>

                  {/* E-mail */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                      E-mail de Login
                    </label>
                    <input
                      type="email"
                      required
                      value={editingOperator.email}
                      onChange={(e) => setEditingOperator({ ...editingOperator, email: e.target.value })}
                      placeholder="maria@empresa.com.br"
                      className="h-10 w-full rounded-xl bg-muted/60 px-3.5 text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-primary focus:bg-card transition"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Grupo de Acesso */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider flex items-center gap-1">
                      <Shield className="h-3 w-3 text-primary" />
                      Grupo de Acesso (RBAC)
                    </label>
                    <Select
                      value={editingOperator.groupId}
                      onValueChange={(val) => setEditingOperator({ ...editingOperator, groupId: val })}
                    >
                      <SelectTrigger className="h-10 w-full rounded-xl bg-muted/60 px-3.5 text-xs font-bold text-foreground border border-border focus:ring-1 focus:ring-primary">
                        <SelectValue placeholder="Selecione o Grupo" />
                      </SelectTrigger>
                      <SelectContent className="z-[10000]">
                        {accessGroups.map((g) => (
                          <SelectItem key={g.id} value={g.id} className="text-xs">
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Status Operacional */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                      Status Operacional
                    </label>
                    <Select
                      value={editingOperator.status}
                      onValueChange={(val: Operator["status"]) =>
                        setEditingOperator({ ...editingOperator, status: val })
                      }
                    >
                      <SelectTrigger className="h-10 w-full rounded-xl bg-muted/60 px-3.5 text-xs font-bold text-foreground border border-border focus:ring-1 focus:ring-primary">
                        <SelectValue placeholder="Selecione o status" />
                      </SelectTrigger>
                      <SelectContent className="z-[10000]">
                        <SelectItem value="disponivel" className="text-xs">Online (Disponível)</SelectItem>
                        <SelectItem value="pausa" className="text-xs">Pausado (Ausente)</SelectItem>
                        <SelectItem value="desconectado" className="text-xs">Offline (Desconectado)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Pastas / Setores de Atendimento */}
                <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-extrabold uppercase text-foreground tracking-wider flex items-center gap-1.5">
                      <Folder className="h-3.5 w-3.5 text-primary" />
                      Pastas de Setores Vinculadas
                    </label>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {editingOperator.sectorIds.length} selecionado(s)
                    </span>
                  </div>
                  {sectors.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {sectors.map((sec) => {
                        const isSelected = editingOperator.sectorIds.includes(sec.id);
                        return (
                          <button
                            key={sec.id}
                            type="button"
                            onClick={() => {
                              setEditingOperator({
                                ...editingOperator,
                                sectorIds: isSelected
                                  ? editingOperator.sectorIds.filter((id) => id !== sec.id)
                                  : [...editingOperator.sectorIds, sec.id],
                              });
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold border transition cursor-pointer ${
                              isSelected
                                ? "bg-primary text-primary-foreground border-primary shadow-soft"
                                : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                            }`}
                          >
                            {isSelected ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
                            <span>{sec.name}</span>
                            {isSelected && <Check className="h-3 w-3 ml-0.5" />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Nenhum setor criado. Crie setores na aba Setores para organizá-los em pastas.
                    </p>
                  )}
                </div>

                {/* Alterar Senha Direto na Edição */}
                <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-extrabold uppercase text-foreground tracking-wider flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-primary" />
                      Alterar Senha de Acesso (Opcional)
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      Deixe em branco para manter a atual
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type={showEditPassword ? "text" : "password"}
                      value={editingOperator.password}
                      onChange={(e) => setEditingOperator({ ...editingOperator, password: e.target.value })}
                      placeholder="Digite a nova senha (mín. 4 caracteres)..."
                      autoComplete="new-password"
                      className="h-10 w-full rounded-xl bg-card px-3.5 pr-9 text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-primary transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPassword(!showEditPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {showEditPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Ao definir uma nova senha, a credencial do usuário e a conta multiempresa vinculada são atualizadas imediatamente.
                  </p>
                </div>

                {/* URL da Foto / Avatar (Opcional) */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                    URL da Foto de Perfil (Opcional)
                  </label>
                  <input
                    type="text"
                    value={editingOperator.avatar}
                    onChange={(e) => setEditingOperator({ ...editingOperator, avatar: e.target.value })}
                    placeholder="https://..."
                    className="h-9 w-full rounded-xl bg-muted/60 px-3.5 text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-primary focus:bg-card transition"
                  />
                </div>
              </div>

              {/* Rodapé */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/20 border-t border-border shrink-0">
                <button
                  type="button"
                  disabled={isSavingOperatorEdit}
                  onClick={() => setEditingOperator(null)}
                  className="h-10 rounded-xl px-4 text-xs font-bold border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingOperatorEdit}
                  className="inline-flex items-center gap-2 h-10 rounded-xl px-5 text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 shadow-soft transition cursor-pointer disabled:opacity-50"
                >
                  {isSavingOperatorEdit ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Salvar Alterações</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Confirmação de Exclusão de Operador com Transferência de Custódia (Opção A) */}
      {deleteConfirm && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !deleteConfirm.loading) setDeleteConfirm(null); }}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden bg-card border border-border text-foreground animate-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]"
          >
            {/* Cabeçalho */}
            <div className="flex items-center gap-3.5 px-6 pt-5 pb-4 border-b border-border bg-muted/20 shrink-0">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20"
              >
                <Trash className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-extrabold text-foreground truncate">
                  Excluir Atendente
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  Auditoria de patrimônio e transferência de custódia
                </p>
              </div>
              <button
                type="button"
                disabled={deleteConfirm.loading}
                onClick={() => setDeleteConfirm(null)}
                className="h-8 w-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Corpo com Scroll */}
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1 scrollbar-thin">
              <div className="p-3.5 rounded-xl bg-muted/40 border border-border/80 flex items-center gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary font-extrabold flex items-center justify-center border border-primary/20 text-xs">
                  {deleteConfirm.operatorName.substring(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                    Atendente a ser excluído
                  </span>
                  <span className="text-sm font-bold text-foreground truncate block">
                    {deleteConfirm.operatorName}
                  </span>
                </div>
              </div>

              {/* Quadro de Auditoria de Patrimônio */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-foreground uppercase tracking-wide">
                    Patrimônio Vinculado no Sistema
                  </span>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Total: {deleteConfirm.totalItems} registro{deleteConfirm.totalItems !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {/* Negociações no CRM */}
                  <div className="p-3 rounded-xl bg-card border border-border/70 space-y-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Negócios CRM</span>
                      <Briefcase className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="text-lg font-black text-foreground">
                      {deleteConfirm.dealsCount}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {deleteConfirm.openDealsCount} em andamento
                    </p>
                  </div>

                  {/* Clientes na Carteira */}
                  <div className="p-3 rounded-xl bg-card border border-border/70 space-y-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Carteira</span>
                      <Users className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="text-lg font-black text-foreground">
                      {deleteConfirm.contactsCount}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      clientes vinculados
                    </p>
                  </div>

                  {/* Conversas no Chat */}
                  <div className="p-3 rounded-xl bg-card border border-border/70 space-y-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Atendimentos</span>
                      <MessageSquare className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="text-lg font-black text-foreground">
                      {deleteConfirm.linkedCount}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {deleteConfirm.activeCount} ativos no chat
                    </p>
                  </div>

                  {/* Tarefas Agendadas */}
                  <div className="p-3 rounded-xl bg-card border border-border/70 space-y-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tarefas</span>
                      <CheckSquare className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="text-lg font-black text-foreground">
                      {deleteConfirm.tasksCount}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {deleteConfirm.pendingTasksCount} pendentes
                    </p>
                  </div>
                </div>
              </div>

              {/* Seletor de Ação e Destinação */}
              {deleteConfirm.totalItems > 0 ? (
                <div className="space-y-2.5 pt-1">
                  <label className="text-xs font-extrabold text-foreground block">
                    Destinação do patrimônio antes da exclusão:
                  </label>

                  {/* Opção A: Transferir Custódia */}
                  <div
                    onClick={() => setDeleteConfirm({ ...deleteConfirm, actionType: "transfer" })}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      deleteConfirm.actionType === "transfer"
                        ? "border-primary bg-primary/5 shadow-xs"
                        : "border-border bg-card hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="deleteActionType"
                        checked={deleteConfirm.actionType === "transfer"}
                        onChange={() => setDeleteConfirm({ ...deleteConfirm, actionType: "transfer" })}
                        className="mt-1 accent-primary cursor-pointer"
                      />
                      <div className="flex-1 space-y-2.5">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-extrabold text-foreground">
                              Transferir patrimônio para outro atendente
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">
                              Recomendado
                            </span>
                          </div>
                          <span className="text-[11px] text-muted-foreground block mt-0.5 leading-relaxed">
                            Reatribui atomicamente todas as negociações, contatos, tarefas e conversas para o novo atendente sem perder histórico.
                          </span>
                        </div>

                        {deleteConfirm.actionType === "transfer" && (
                          <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                            <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block mb-1">
                              Selecionar Novo Atendente Responsável
                            </label>
                            <Select
                              value={deleteConfirm.targetOperatorId}
                              onValueChange={(val) => setDeleteConfirm({ ...deleteConfirm, targetOperatorId: val })}
                            >
                              <SelectTrigger className="h-10 w-full rounded-xl bg-card border border-border text-xs text-foreground px-3.5 focus:ring-1 focus:ring-primary shadow-xs">
                                <SelectValue placeholder="Escolha um atendente ativo..." />
                              </SelectTrigger>
                              <SelectContent className="z-[10000]">
                                {operators
                                  .filter((o) => o.id !== deleteConfirm.operatorId)
                                  .map((dest) => (
                                    <SelectItem key={dest.id} value={dest.id} className="text-xs py-2">
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-foreground">{dest.name}</span>
                                        <span className="text-muted-foreground text-[10px]">({dest.email})</span>
                                      </div>
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Opção B: Desvincular sem transferir */}
                  <div
                    onClick={() => setDeleteConfirm({ ...deleteConfirm, actionType: "unassign" })}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      deleteConfirm.actionType === "unassign"
                        ? "border-primary bg-primary/5 shadow-xs"
                        : "border-border bg-card hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="deleteActionType"
                        checked={deleteConfirm.actionType === "unassign"}
                        onChange={() => setDeleteConfirm({ ...deleteConfirm, actionType: "unassign" })}
                        className="mt-1 accent-primary cursor-pointer"
                      />
                      <div>
                        <span className="text-xs font-extrabold text-foreground block">
                          Não transferir (Deixar Sem Responsável e Fila Geral)
                        </span>
                        <span className="text-[11px] text-muted-foreground block mt-0.5 leading-relaxed">
                          Os cards no Kanban ficarão com responsável vazio, contatos serão marcados como "Na Fila" e conversas ativas serão devolvidas à fila geral.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl p-4 bg-muted/30 border border-border/80 text-xs text-muted-foreground leading-relaxed">
                  Este atendente não possui negociações, contatos na carteira ou atendimentos pendentes vinculados. A exclusão de credencial pode ser efetuada com total segurança.
                </div>
              )}
            </div>

            {/* Rodapé com Ações */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/20 border-t border-border shrink-0">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleteConfirm.loading}
                className="h-10 rounded-xl px-4 text-xs font-bold border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={
                  deleteConfirm.loading ||
                  (deleteConfirm.actionType === "transfer" && deleteConfirm.totalItems > 0 && !deleteConfirm.targetOperatorId)
                }
                className="flex items-center gap-2 h-10 rounded-xl px-5 text-xs font-bold text-destructive-foreground bg-destructive hover:opacity-90 shadow-soft transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteConfirm.loading ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>Processando...</span>
                  </>
                ) : (
                  <>
                    <Trash className="h-4 w-4" />
                    <span>
                      {deleteConfirm.actionType === "transfer" && deleteConfirm.totalItems > 0
                        ? "Transferir Patrimônio e Excluir"
                        : "Confirmar Exclusão"}
                    </span>
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
