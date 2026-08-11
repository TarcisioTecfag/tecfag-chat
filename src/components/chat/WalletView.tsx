import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import React, { useState, useRef, useEffect } from "react";
import { useChat } from "@/hooks/useChatState";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "./ChatList";
import { formatPhoneNumber, formatCPF, formatCNPJ } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  User,
  Phone,
  Mail,
  Building,
  Tag,
  MessageSquare,
  Edit2,
  Trash2,
  X,
  PlusCircle,
  Briefcase,
  LayoutTemplate,
  Check,
  ChevronRight,
  ExternalLink,
  UserMinus,
  Shield,
  Bot,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { Conversation, OperatorTemplate } from "@/lib/mockData";
import { toast } from "sonner";

export function WalletView() {
  const {
    tenant,
    conversations,
    operators,
    currentOperatorId,
    templates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    updateContactWallet,
    setSelectedChatId,
    setActiveView,
    setActiveQueue,
  } = useChat();

  const [activeTab, setActiveTab] = useState<"wallet" | "templates">("wallet");

  // KPI de inatividade — busca do servidor (apenas para a aba carteira)
  const [inactivityKpi, setInactivityKpi] = useState<{ over50Count: number; over60Count: number } | null>(null);

  useEffect(() => {
    if (activeTab !== "wallet" || !tenant) return;
    fetch(`/api/contacts/check-inactivity?tenantId=${tenant}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setInactivityKpi({ over50Count: data.over50Count, over60Count: data.over60Count });
      })
      .catch(() => {}); // silencia erros de rede — KPI é informativo
  }, [activeTab, tenant]);
  const [search, setSearch] = useState("");
  
  // Custom Modals
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingTemplate, setEditingTemplate] = useState<OperatorTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({
    title: "",
    text: "",
  });

  const [confirmRemoveClient, setConfirmRemoveClient] = useState<Conversation | null>(null);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInsertTag = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = templateForm.text;

    const newText = currentText.substring(0, start) + tag + currentText.substring(end);
    setTemplateForm({ ...templateForm, text: newText });

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 50);
  };

  // Filter clients in the wallet (walletOperatorId === currentOperatorId)
  const walletClients = conversations.filter((c) => {
    const isInWallet = c.walletOperatorId === currentOperatorId;
    if (!isInWallet) return false;

    if (search.trim() !== "") {
      const q = search.toLowerCase();
      const matchName = c.name.toLowerCase().includes(q);
      const matchPhone = c.phone?.toLowerCase().includes(q) || false;
      const matchEmail = c.email?.toLowerCase().includes(q) || false;
      const matchCnpj = c.cnpj?.toLowerCase().includes(q) || false;
      const matchCpf = c.cpf?.toLowerCase().includes(q) || false;
      return matchName || matchPhone || matchEmail || matchCnpj || matchCpf;
    }
    return true;
  });

  // Filter templates of the operator
  const filteredTemplates = templates.filter((tpl) => {
    if (search.trim() !== "") {
      const q = search.toLowerCase();
      return (
        tpl.title.toLowerCase().includes(q) || tpl.text.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const activeAttendancesCount = walletClients.filter(
    (c) => c.queue === "meus" && c.operatorId === currentOperatorId
  ).length;

  const handleOpenCreateModal = () => {
    setModalMode("create");
    setTemplateForm({ title: "", text: "" });
    setShowModal(true);
  };

  const handleOpenEditModal = (tpl: OperatorTemplate) => {
    setModalMode("edit");
    setEditingTemplate(tpl);
    setTemplateForm({ title: tpl.title, text: tpl.text });
    setShowModal(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.title.trim() || !templateForm.text.trim()) return;

    if (modalMode === "create") {
      await createTemplate(templateForm.title, templateForm.text);
    } else if (modalMode === "edit" && editingTemplate) {
      await updateTemplate(editingTemplate.id, templateForm.title, templateForm.text);
    }

    setShowModal(false);
  };

  const getAttendanceStatus = (c: Conversation) => {
    if (c.queue === "finalizados") {
      return { text: "Sem atendimento ativo", color: "text-muted-foreground bg-muted/50 border-muted-foreground/20" };
    }
    if (c.queue === "fila") {
      return { text: "Aguardando na fila", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
    }
    if (c.queue === "meus") {
      if (c.operatorId === currentOperatorId) {
        return { text: "Atendimento com você", color: "text-primary bg-primary-soft border-primary/20" };
      } else {
        const op = operators.find((o) => o.id === c.operatorId);
        return { text: `Atendimento com ${op?.name ?? "outro"}`, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
      }
    }
    return { text: "Em automação", color: "text-blue-500 bg-blue-500/10 border-blue-500/20" };
  };

  const handleGoToChat = (c: Conversation) => {
    setSelectedChatId(c.id);
    setActiveView("chat");
    if (c.queue === "meus" && c.operatorId === currentOperatorId) {
      setActiveQueue("meus");
    } else if (c.queue === "fila") {
      setActiveQueue("fila");
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col gap-4 p-4 lg:p-6 overflow-hidden">
        {/* Header Banner */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <div>
            <h1 className="text-xl font-bold text-foreground">Minha Carteira & Templates</h1>
            <p className="text-xs text-muted-foreground">
              Gerencie seus clientes vinculados e configure suas respostas rápidas personalizadas.
            </p>
          </div>

          {/* Tab Toggle */}
          <div className="flex items-center gap-1 rounded-2xl bg-muted/60 p-1 border border-border self-start sm:self-auto">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveTab("wallet")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "wallet"
                  ? "bg-card text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Briefcase className="h-4 w-4" />
              Clientes da Carteira
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveTab("templates")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "templates"
                  ? "bg-card text-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutTemplate className="h-4 w-4" />
              Meus Templates
            </motion.button>
          </div>
        </div>

        {/* Stats KPI Section (Visible in Wallet Tab) */}
        {activeTab === "wallet" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-soft">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary border border-border">
                <Briefcase className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Clientes em Carteira
                </div>
                <div className="text-lg font-bold text-foreground">{walletClients.length}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-soft">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 border border-border">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Atendimentos Ativos
                </div>
                <div className="text-lg font-bold text-foreground">{activeAttendancesCount}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-soft">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 border border-border">
                <LayoutTemplate className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Meus Templates
                </div>
                <div className="text-lg font-bold text-foreground">{templates.length}</div>
              </div>
            </div>

            {/* KPI de Inatividade ≥50 dias */}
            {inactivityKpi !== null && inactivityKpi.over50Count > 0 && (
              <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3.5 shadow-soft col-span-1 sm:col-span-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500 border border-amber-500/20 shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    Clientes sem contato há mais de 50 dias
                  </div>
                  <div className="text-sm text-amber-700 dark:text-amber-300 font-medium mt-0.5">
                    <span className="text-lg font-bold">{inactivityKpi.over50Count}</span> cliente{inactivityKpi.over50Count !== 1 ? "s" : ""} em risco de inatividade
                    {inactivityKpi.over60Count > 0 && (
                      <span className="ml-2 text-[10px] font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 rounded-full px-2 py-0.5">
                        {inactivityKpi.over60Count} acima de 60 dias → serão transferidos automaticamente
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Bar (Search & Create) */}
        <div className="flex items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={
                activeTab === "wallet"
                  ? "Buscar cliente por nome, telefone ou CNPJ/CPF..."
                  : "Buscar template por título ou conteúdo..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-2xl border border-border bg-muted/40 py-2.5 pl-10 pr-4 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:bg-card focus:shadow-soft"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {activeTab === "templates" && (
            <button
              onClick={handleOpenCreateModal}
              className="flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition-all hover:opacity-95 active:scale-98 shadow-soft cursor-pointer"
            >
              <PlusCircle className="h-4 w-4" />
              Criar Template
            </button>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin pr-1">
          <AnimatePresence mode="wait">
            {activeTab === "wallet" ? (
              <motion.div
                key="wallet-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                {walletClients.length > 0 ? (
                  <>
                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto rounded-2xl border border-border bg-card">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-line bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <th className="p-4">Cliente</th>
                            <th className="p-4">Canais / Contato</th>
                            <th className="p-4">CPF / CNPJ</th>
                            <th className="p-4">Status de Atendimento</th>
                            <th className="p-4 text-right">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line text-xs">
                          {walletClients.map((c) => {
                            const statusInfo = getAttendanceStatus(c);
                            const isValentina = c.id === "valentina" || c.contactId === "valentina" || c.name.toLowerCase().includes("valentina");
                            const initials = c.name
                              .split(" ")
                              .map((w) => w[0])
                              .join("")
                              .toUpperCase()
                              .substring(0, 2);

                            return (
                              <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                                <td className="p-4">
                                  <div className="flex items-center gap-3">
                                    {c.avatar ? (
                                      <img
                                        src={c.avatar}
                                        alt={c.name}
                                        className="h-9 w-9 rounded-xl object-cover border border-border"
                                      />
                                    ) : (
                                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-xs font-bold text-primary border border-border">
                                        {initials}
                                      </div>
                                    )}
                                    <div>
                                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                                        {c.name}
                                        {isValentina && (
                                          <span className="inline-flex items-center gap-1 bg-primary/15 text-primary text-[9px] font-black px-1.5 py-0.5 rounded-md border border-primary/20">
                                            <Bot className="h-2.5 w-2.5" /> IA
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                        {c.channel === "whatsapp" && <WhatsappLogo className="h-3 w-3 inline text-emerald-500" />}
                                        {c.channel === "instagram" && <InstagramLogo className="h-3 w-3 inline text-pink-500" />}
                                        {c.channel === "messenger" && <MessengerLogo className="h-3 w-3 inline text-blue-500" />}
                                        <span className="capitalize">{c.channel}</span>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="p-4">
                                  <div className="flex flex-col gap-0.5">
                                    {c.phone && (
                                      <span className="font-medium text-foreground flex items-center gap-1">
                                        <Phone className="h-3 w-3 text-muted-foreground" />
                                        {formatPhoneNumber(c.phone)}
                                      </span>
                                    )}
                                    {c.email && (
                                      <span className="text-muted-foreground flex items-center gap-1">
                                        <Mail className="h-3 w-3 text-muted-foreground" />
                                        {c.email}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-4">
                                  {c.cnpj ? (
                                    <span className="font-medium text-foreground flex items-center gap-1">
                                      <Building className="h-3.5 w-3.5 text-muted-foreground" />
                                      {formatCNPJ(c.cnpj)}
                                    </span>
                                  ) : c.cpf ? (
                                    <span className="font-medium text-foreground flex items-center gap-1">
                                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                                      {formatCPF(c.cpf)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground italic">-</span>
                                  )}
                                </td>
                                <td className="p-4">
                                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusInfo.color}`}>
                                    {statusInfo.text}
                                  </span>
                                </td>
                                <td className="p-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    {!isValentina && (
                                      <button
                                        onClick={() => setConfirmRemoveClient(c)}
                                        className="inline-flex items-center gap-1 rounded-xl bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer border border-red-200 dark:border-red-800"
                                      >
                                        <UserMinus className="h-3.5 w-3.5" />
                                        Remover
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleGoToChat(c)}
                                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 shadow-soft cursor-pointer"
                                    >
                                      <MessageSquare className="h-3.5 w-3.5" />
                                      Atendimento
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Native Cards View */}
                    <div className="flex flex-col gap-3 md:hidden">
                      {walletClients.map((c) => {
                        const statusInfo = getAttendanceStatus(c);
                        const isValentina = c.id === "valentina" || c.contactId === "valentina" || c.name.toLowerCase().includes("valentina");
                        const initials = c.name
                          .split(" ")
                          .map((w) => w[0])
                          .join("")
                          .toUpperCase()
                          .substring(0, 2);

                        return (
                          <div key={c.id} className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                {c.avatar ? (
                                  <img src={c.avatar} alt="" className="h-10 w-10 rounded-xl object-cover border border-border" />
                                ) : (
                                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-xs font-bold text-primary border border-border">
                                    {initials}
                                  </div>
                                )}
                                <div>
                                  <span className="font-bold text-sm text-foreground block">{c.name}</span>
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusInfo.color}`}>
                                    {statusInfo.text}
                                  </span>
                                </div>
                              </div>

                              <span className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 capitalize">
                                {c.channel === "whatsapp" && <WhatsappLogo className="h-3 w-3 text-emerald-500" />}
                                {c.channel}
                              </span>
                            </div>

                            <div className="bg-muted/40 rounded-xl p-3 text-xs space-y-1 border border-border/50">
                              {c.phone && (
                                <div className="flex items-center justify-between text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Phone className="h-3 w-3 text-primary" />
                                    <span className="font-semibold text-foreground">{formatPhoneNumber(c.phone)}</span>
                                  </span>
                                  {c.cnpj && <span className="font-mono text-[10px]">{formatCNPJ(c.cnpj)}</span>}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 pt-1 border-t border-border/60">
                              {!isValentina && (
                                <button
                                  onClick={() => setConfirmRemoveClient(c)}
                                  className="flex-1 py-2 px-3 rounded-xl border border-red-200 text-red-600 bg-red-50 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                                >
                                  <UserMinus className="h-3.5 w-3.5" />
                                  <span>Remover</span>
                                </button>
                              )}
                              <button
                                onClick={() => handleGoToChat(c)}
                                className="flex-1 py-2 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center gap-1.5 shadow-soft hover:opacity-90 transition cursor-pointer"
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                                <span>Ir para Atendimento</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-6 text-center">
                    <Briefcase className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <h3 className="text-sm font-semibold text-foreground">Sua carteira está vazia</h3>
                    <p className="text-xs text-muted-foreground max-w-sm mt-1">
                      Clientes serão vinculados automaticamente a você assim que você capturar ou iniciar um atendimento para eles.
                    </p>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="templates-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                {filteredTemplates.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredTemplates.map((tpl) => (
                      <div
                        key={tpl.id}
                        className="group flex flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-soft transition-all hover:shadow-md hover:border-primary/30"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <h3 className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                              {tpl.title}
                            </h3>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleOpenEditModal(tpl)}
                                className="p-1 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition cursor-pointer"
                                title="Editar Template"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmDeleteTemplateId(tpl.id)}
                                className="p-1 text-muted-foreground hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
                                title="Excluir Template"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 bg-muted/30 p-3 rounded-xl border border-border/50 font-mono">
                            {tpl.text}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-6 text-center">
                    <LayoutTemplate className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <h3 className="text-sm font-semibold text-foreground">Nenhum template encontrado</h3>
                    <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
                      Crie respostas rápidas para economizar tempo no atendimento do dia a dia.
                    </p>
                    <button
                      onClick={handleOpenCreateModal}
                      className="flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-soft transition hover:opacity-95 cursor-pointer"
                    >
                      <PlusCircle className="h-4 w-4" />
                      Criar Meu Primeiro Template
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── MODAL SISTEMA: Confirmação de Remoção de Cliente ─────────────────── */}
        {confirmRemoveClient && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fadeIn">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-amber-500/15 text-amber-600 grid place-items-center shrink-0">
                  <UserMinus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-foreground">Remover Cliente da Carteira</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Deseja remover <strong className="text-foreground">{confirmRemoveClient.name}</strong> da sua carteira?
                  </p>
                </div>
              </div>

              <div className="bg-muted/40 rounded-2xl p-3 border border-border/60 text-[11px] text-muted-foreground leading-relaxed">
                Quando o cliente enviar mensagem no WhatsApp, ele não entrará em "Meus", mas sim na automação da <strong>Valentina IA</strong>.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <button
                  onClick={() => setConfirmRemoveClient(null)}
                  className="px-4 py-2 rounded-2xl border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    const client = confirmRemoveClient;
                    setConfirmRemoveClient(null);
                    if (client) {
                      const contactId = client.contactId || client.id;
                      await updateContactWallet(contactId, null);
                      toast.success(`${client.name} foi removido da carteira! Retornado para a Valentina IA.`);
                    }
                  }}
                  className="px-4 py-2 rounded-2xl bg-red-600 hover:bg-red-700 text-xs font-extrabold text-white transition cursor-pointer shadow-soft"
                >
                  Remover Cliente
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── MODAL SISTEMA: Confirmação de Exclusão de Template ───────────────── */}
        {confirmDeleteTemplateId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fadeIn">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-red-500/15 text-red-600 grid place-items-center shrink-0">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-foreground">Excluir Resposta Rápida</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tem certeza que deseja excluir este template? Esta ação não pode ser desfeita.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <button
                  onClick={() => setConfirmDeleteTemplateId(null)}
                  className="px-4 py-2 rounded-2xl border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    const id = confirmDeleteTemplateId;
                    setConfirmDeleteTemplateId(null);
                    if (id) {
                      await deleteTemplate(id);
                      toast.success("Template excluído com sucesso!");
                    }
                  }}
                  className="px-4 py-2 rounded-2xl bg-red-600 hover:bg-red-700 text-xs font-extrabold text-white transition cursor-pointer shadow-soft"
                >
                  Excluir Template
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Create/Edit Template Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-fadeIn">
            <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-xl animate-scaleIn">
              <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
                <h2 className="text-base font-bold text-foreground">
                  {modalMode === "create" ? "Criar Resposta Rápida" : "Editar Resposta Rápida"}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-xl p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSaveTemplate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Título do Template
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Boas-vindas Orçamento"
                    value={templateForm.title}
                    onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })}
                    className="w-full rounded-2xl border border-border bg-muted/40 px-3.5 py-2 text-xs text-foreground outline-none focus:border-primary focus:bg-card"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-foreground">
                      Conteúdo da Mensagem
                    </label>
                    <span className="text-[10px] text-muted-foreground">Variáveis disponíveis:</span>
                  </div>

                  {/* Variable Tags */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <button
                      type="button"
                      onClick={() => handleInsertTag("{{nome}}")}
                      className="rounded-lg bg-primary-soft/60 hover:bg-primary-soft border border-primary/20 px-2 py-1 text-[10px] font-bold text-primary transition cursor-pointer"
                    >
                      + {"{{nome}}"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertTag("{{empresa}}")}
                      className="rounded-lg bg-primary-soft/60 hover:bg-primary-soft border border-primary/20 px-2 py-1 text-[10px] font-bold text-primary transition cursor-pointer"
                    >
                      + {"{{empresa}}"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertTag("{{operador}}")}
                      className="rounded-lg bg-primary-soft/60 hover:bg-primary-soft border border-primary/20 px-2 py-1 text-[10px] font-bold text-primary transition cursor-pointer"
                    >
                      + {"{{operador}}"}
                    </button>
                  </div>

                  <textarea
                    ref={textareaRef}
                    rows={5}
                    placeholder="Digite o texto do template aqui..."
                    value={templateForm.text}
                    onChange={(e) => setTemplateForm({ ...templateForm, text: e.target.value })}
                    className="w-full rounded-2xl border border-border bg-muted/40 p-3.5 text-xs font-mono text-foreground outline-none focus:border-primary focus:bg-card resize-none"
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="rounded-2xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-2xl bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-95 cursor-pointer shadow-soft"
                  >
                    Salvar Template
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
