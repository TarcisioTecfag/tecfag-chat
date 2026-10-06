import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import React, { useState, useMemo, useEffect, useRef } from "react";
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
  MessagesSquare,
  Edit2,
  Trash2,
  X,
  Check,
  UserPlus,
  ArrowRight,
  Shield,
  Building2,
  Loader2,
} from "lucide-react";
import { Channel, Conversation, QueueType } from "@/lib/mockData";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";
import { AccountPicker } from "@/components/crm/AccountPicker";
import type { CrmAccountDTO } from "@/lib/crm/crm-types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type ContactListItem = {
  id: string;
  name: string;
  phone: string;
  whatsappUsername: string;
  email: string;
  accountId: string | null;
  accountName: string | null;
  accountDocument: string | null;
  accountType: string | null;
  cnpj: string;
  cpf: string;
  avatar: string | null;
  initials?: string;
  initialsBg?: string;
  tags: string[];
  channel: Channel | "livechat";
  operatorId: string | null;
  walletOperatorId: string | null;
  responsibleName: string;
  latestConversationId: string | null;
};

// ─── helper de highlight ──────────────────────────────────────────────────
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <span>{text}</span>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-300 text-yellow-900 rounded px-0.5 not-italic font-bold">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

function ContactAvatar({ avatar, name, initials, initialsBg, size = "h-9 w-9" }: { avatar?: string | null; name: string; initials?: string; initialsBg?: string; size?: string }) {
  const [imgError, setImgError] = useState(false);
  const displayInitials = initials || name.slice(0, 2).toUpperCase() || "U";

  if (avatar && !imgError) {
    return (
      <img
        src={avatar}
        alt=""
        className={`${size} rounded-full object-cover border border-border shrink-0`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={`grid ${size} place-items-center rounded-full text-xs font-bold text-primary bg-primary/10 border border-primary/20 shrink-0`}
    >
      {displayInitials}
    </div>
  );
}

export function ContactsView() {
  const {
    tenant,
    conversations,
    createContact,
    refreshConversations,
    setActiveQueue,
    setSelectedChatId,
    setActiveView,
    operators,
    currentGroup,
  } = useChat();

  const { canCreateContact, canEditContact } = usePermissions();

  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactListItem | null>(null);
  const [contactRows, setContactRows] = useState<ContactListItem[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [newAccount, setNewAccount] = useState<CrmAccountDTO | null>(null);
  const [editAccount, setEditAccount] = useState<CrmAccountDTO | null>(null);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const contactsRequestRevision = useRef(0);

  const loadContacts = async (offset = 0, signal?: AbortSignal) => {
    const revision = contactsRequestRevision.current;
    const params = new URLSearchParams({ limit: "50", offset: String(offset) });
    if (search.trim()) params.set("search", search.trim());
    if (channelFilter !== "all") params.set("channel", channelFilter);
    const response = await fetch(`/api/contacts?${params}`, { credentials: "include", signal });
    if (!response.ok) throw new Error("Não foi possível carregar a base de clientes.");
    const result = await response.json();
    if (revision !== contactsRequestRevision.current) return;
    const rows: ContactListItem[] = (result.contacts || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      phone: item.phone || "",
      whatsappUsername: item.whatsappUsername || "",
      email: item.email || "",
      accountId: item.accountId || null,
      accountName: item.accountName || null,
      accountDocument: item.accountDocument || null,
      accountType: item.accountType || null,
      cnpj: item.cnpj || "",
      cpf: item.cpf || "",
      avatar: item.avatar || null,
      tags: item.tags || [],
      channel: item.mainChannel || "whatsapp",
      operatorId: item.latestOperatorId || null,
      walletOperatorId: item.walletOperatorId || null,
      responsibleName: item.responsibleName || "Na Fila",
      latestConversationId: item.latestConversationId || null,
    }));
    setContactRows((previous) => offset === 0 ? rows : [...previous, ...rows]);
    setTotalContacts(result.total || 0);
  };

  useEffect(() => {
    const controller = new AbortController();
    contactsRequestRevision.current += 1;
    setLoadingContacts(true);
    const timer = window.setTimeout(() => {
      loadContacts(0, controller.signal)
        .catch((error) => { if (!controller.signal.aborted) toast.error(error.message); })
        .finally(() => { if (!controller.signal.aborted) setLoadingContacts(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [tenant, search, channelFilter]);

  // ── Global Conversation Search ──────────────────────────────────────────
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchConversations, setSearchConversations] = useState<Conversation[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const globalSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showSearchModal) return;
    const controller = new AbortController();
    setSearchConversations([]);
    setSearchLoading(true);
    fetch("/api/chats?limit=150&includeRecent=1", { credentials: "include", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Não foi possível carregar as mensagens para busca.");
        return response.json();
      })
      .then((items) => { if (Array.isArray(items)) setSearchConversations(items); })
      .catch((error) => { if (!controller.signal.aborted) toast.error(error.message); })
      .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    return () => controller.abort();
  }, [showSearchModal, tenant]);

  useEffect(() => {
    if (showSearchModal) {
      setTimeout(() => globalSearchRef.current?.focus(), 80);
    } else {
      setGlobalSearch("");
    }
  }, [showSearchModal]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSearchModal(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const globalResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];
    return searchConversations
      .filter((conv) => currentGroup.allowedChannels.includes(conv.channel))
      .map((conv) => {
        const matchedMessages = conv.messages.filter((m) =>
          m.text.toLowerCase().includes(q)
        );
        return matchedMessages.length > 0 ? { conv, matchedMessages } : null;
      })
      .filter(Boolean) as { conv: Conversation; matchedMessages: Conversation["messages"] }[];
  }, [globalSearch, searchConversations, currentGroup.allowedChannels]);

  const [addForm, setAddForm] = useState({
    name: "",
    phone: "",
    email: "",
    channel: "whatsapp" as Channel,
  });

  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    whatsappUsername: "",
    email: "",
    tagsInput: "",
  });

  // Criação rápida de empresa dentro do Drawer de Contato
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    name: "",
    tradeName: "",
    document: "",
    type: "company" as "company" | "person",
    phone: "",
    email: "",
  });
  const [savingCompany, setSavingCompany] = useState(false);

  const handleSaveQuickCompany = async () => {
    if (!companyForm.name.trim()) {
      toast.error("Informe o nome ou razão social da empresa.");
      return;
    }
    setSavingCompany(true);
    try {
      const response = await fetch("/api/crm/accounts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: companyForm.name.trim(),
          type: companyForm.type,
          tradeName: companyForm.tradeName.trim() || undefined,
          document: companyForm.document.trim() || undefined,
          phone: companyForm.phone.trim() || undefined,
          email: companyForm.email.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível criar a empresa.");
      const createdAcc: CrmAccountDTO = data.account;
      if (editingContact) {
        setEditAccount(createdAcc);
        setEditAccountId(createdAcc.id);
      } else {
        setNewAccount(createdAcc);
      }
      setCreatingCompany(false);
      toast.success(`Empresa "${createdAcc.name}" cadastrada e vinculada!`);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao cadastrar empresa.");
    } finally {
      setSavingCompany(false);
    }
  };

  const filteredContacts = contactRows;

  const handleStartChat = async (contactId: string) => {
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/conversations`, { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível abrir o atendimento.");
      await refreshConversations(result.conversationId);
      const queue: QueueType = result.readOnly
        ? result.queueState === "fila" ? "fila" : result.queueState === "automacao" ? "automacao" : "todos"
        : "meus";
      setActiveQueue(queue);
      setSelectedChatId(result.conversationId);
      setActiveView("chat");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar atendimento.");
    }
  };

  const handleOpenFromSearch = (id: string) => {
    setShowSearchModal(false);
    setActiveQueue("todos");
    setSelectedChatId(id);
    setActiveView("chat");
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) return;
    setSavingContact(true);
    try {
      const result = await createContact(addForm.name, addForm.phone, addForm.email, newAccount?.id || null, addForm.channel);
      setAddForm({ name: "", phone: "", email: "", channel: "whatsapp" });
      setNewAccount(null);
      setShowAddModal(false);
      if (!result.chatReady) {
        try { await loadContacts(0); }
        catch (error) { console.warn("Contato criado, mas a lista não atualizou:", error); }
        toast.warning("Contato criado. Abra o atendimento pela lista de contatos.");
        return;
      }
      setActiveQueue(result.queueState);
      setSelectedChatId(result.conversationId);
      setActiveView("chat");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o contato.");
    } finally {
      setSavingContact(false);
    }
  };

  const startEditing = (c: ContactListItem) => {
    setEditingContact(c);
    setEditAccount(
      c.accountId
        ? {
            id: c.accountId,
            tenantId: tenant || "",
            name: c.accountName || "Empresa vinculada",
            tradeName: null,
            document: c.accountDocument || null,
            type: (c.accountType as "company" | "person") || "company",
          }
        : null
    );
    setEditAccountId(c.accountId);
    setCreatingCompany(false);
    setEditForm({
      name: c.name,
      phone: c.phone || "",
      whatsappUsername: c.whatsappUsername || "",
      email: c.email || "",
      tagsInput: c.tags.join(", "),
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact) return;
    const tagsArray = editForm.tagsInput.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    setSavingContact(true);
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(editingContact.id)}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editForm.name, phone: editForm.phone, whatsappUsername: editForm.whatsappUsername, email: editForm.email, accountId: editAccountId, tags: tagsArray }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar o contato.");
      setEditingContact(null);
      toast.success("Contato atualizado.");
      try {
        await loadContacts(0);
        if (editingContact.latestConversationId) await refreshConversations(editingContact.latestConversationId);
      } catch (error) {
        console.warn("Contato atualizado, mas a visualização não atualizou:", error);
        toast.warning("Contato salvo. Atualize a página para ver os dados mais recentes.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o contato.");
    } finally {
      setSavingContact(false);
    }
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-chat-panel p-8 shadow-soft relative overflow-hidden select-none">

      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Cadastro Geral</span>
          <h2 className="text-2xl font-bold text-foreground mt-0.5">
            Base de Clientes — {tenant === "tecfag" ? "Tecfag" : "Valem"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Veja, edite ou crie contatos para iniciar conversas ativas multicanais.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Botao Conversas */}
          <button
            onClick={() => setShowSearchModal(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold text-foreground transition hover:bg-muted cursor-pointer shadow-soft"
          >
            <MessagesSquare className="h-4 w-4 text-primary" />
            Conversas
          </button>
          {/* Botao Novo Contato */}
          {canCreateContact && (
            <button
              onClick={() => {
                setCreatingCompany(false);
                setNewAccount(null);
                setAddForm({ name: "", phone: "", email: "", channel: "whatsapp" });
                setShowAddModal(true);
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 cursor-pointer shadow-soft"
            >
              <UserPlus className="h-4.5 w-4.5" />
              Novo Contato
            </button>
          )}
        </div>
      </header>

      {/* Filters Row */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6 bg-card p-4 rounded-2xl border border-border shadow-soft">
        <div className="relative w-full sm:w-80">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
          <input
            placeholder="Filtrar por nome, CNPJ, tag, telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-xl bg-muted px-4 pr-10 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
          />
        </div>
        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <span className="text-xs text-muted-foreground font-semibold mr-1">Canal:</span>
          <motion.button whileTap={{ scale: 0.92 }} onClick={() => setChannelFilter("all")} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer ${channelFilter === "all" ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-muted-foreground hover:bg-border hover:text-primary"}`}>Todos</motion.button>
          <motion.button whileTap={{ scale: 0.92 }} onClick={() => setChannelFilter("whatsapp")} className={`grid h-8 w-8 place-items-center rounded-lg transition cursor-pointer ${channelFilter === "whatsapp" ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-muted-foreground hover:bg-border hover:text-primary"}`}><WhatsappLogo className="h-4.5 w-4.5" /></motion.button>
          <motion.button whileTap={{ scale: 0.92 }} onClick={() => setChannelFilter("instagram")} className={`grid h-8 w-8 place-items-center rounded-lg transition cursor-pointer ${channelFilter === "instagram" ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-muted-foreground hover:bg-border hover:text-primary"}`}><InstagramLogo className="h-4.5 w-4.5" /></motion.button>
          <motion.button whileTap={{ scale: 0.92 }} onClick={() => setChannelFilter("messenger")} className={`grid h-8 w-8 place-items-center rounded-lg transition cursor-pointer ${channelFilter === "messenger" ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-muted-foreground hover:bg-border hover:text-primary"}`}><MessengerLogo className="h-4.5 w-4.5" /></motion.button>
        </div>
      </div>

      {/* Main Table (Desktop View) */}
      <div className="hidden md:flex flex-1 bg-card rounded-2xl border border-border shadow-soft overflow-hidden flex-col">
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground bg-muted/40">
                <th className="py-4 px-6">Nome / Cliente</th>
                <th className="py-4 px-4">Canal</th>
                <th className="py-4 px-4">Contato</th>
                <th className="py-4 px-4">CNPJ</th>
                <th className="py-4 px-4">Marcadores (Tags)</th>
                <th className="py-4 px-4">Responsável</th>
                <th className="py-4 px-6 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredContacts.length > 0 ? (
                filteredContacts.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/10 transition text-xs font-semibold text-foreground/90">
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-3">
                        <ContactAvatar avatar={c.avatar} name={c.name} initials={c.initials} initialsBg={c.initialsBg} size="h-9 w-9" />
                        <div>
                          <span className="block font-bold text-foreground">{c.name}</span>
                          <span className="text-[10px] text-muted-foreground font-medium">Cadastrado</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white shadow-soft ${c.channel === "whatsapp" ? "bg-emerald-500" : c.channel === "instagram" ? "bg-gradient-to-tr from-yellow-500 to-purple-600" : "bg-blue-600"}`}>
                        {c.channel === "whatsapp" && <><WhatsappLogo className="h-3 w-3" /> WhatsApp</>}
                        {c.channel === "instagram" && <><InstagramLogo className="h-3 w-3" /> Instagram</>}
                        {c.channel === "messenger" && <><MessengerLogo className="h-3 w-3" /> Messenger</>}
                        {c.channel === "livechat" && <>Live Chat</>}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 space-y-0.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        <span>{c.phone ? formatPhoneNumber(c.phone) : "Número não informado"}</span>
                      </div>
                      {c.whatsappUsername && c.channel === "whatsapp" && (
                        <div className="text-primary font-semibold">@{c.whatsappUsername}</div>
                      )}
                      {c.email && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          <span className="truncate max-w-[150px]">{c.email}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {c.accountName ? (
                        <div>
                          <div className="flex items-center gap-1 text-foreground">
                            <Building className="h-3 w-3 text-muted-foreground" />
                            {c.accountName}
                          </div>
                          {c.accountDocument && <span className="text-[10px] text-muted-foreground font-mono">{c.accountType === "company" ? formatCNPJ(c.accountDocument) : formatCPF(c.accountDocument)}</span>}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic font-medium">Nenhum</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {c.tags.map((tag) => (
                          <span key={tag} className="rounded bg-primary-soft/50 px-1.5 py-0.5 text-[9px] font-bold text-primary border border-primary/10">{tag}</span>
                        ))}
                        {c.tags.length === 0 && <span className="text-muted-foreground italic font-medium text-[10px]">Sem tags</span>}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      {(() => {
                        const opName = c.operatorId ? operators.find(o => o.id === c.operatorId)?.name : null;
                        const displayName = opName || (c.responsibleName === "Na Fila" || !c.responsibleName ? "Na Fila" : c.responsibleName);
                        
                        return displayName === "Na Fila" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                            Na Fila
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-bold text-foreground">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                            {displayName}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canEditContact && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button onClick={() => startEditing(c)} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer">
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Editar Cadastro</TooltipContent>
                            </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button onClick={() => handleStartChat(c.id)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft">
                              <MessageSquare className="h-3.5 w-3.5" />
                              Conversar
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Iniciar Atendimento</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground font-medium">
                    Nenhum cliente encontrado com os filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Native Cards View (Exibido apenas em telas menores) */}
      <div className="flex flex-col gap-3 md:hidden mt-2 pb-10">
        {filteredContacts.length > 0 ? (
          filteredContacts.map((c) => {
            const opName = c.operatorId ? operators.find(o => o.id === c.operatorId)?.name : null;
            const displayName = opName || (c.responsibleName === "Na Fila" || !c.responsibleName ? "Na Fila" : c.responsibleName);

            return (
              <div key={c.id} className="bg-card rounded-2xl p-4 border border-border shadow-soft flex flex-col gap-3">
                {/* Linha Topo: Avatar + Nome + Badge Canal */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ContactAvatar avatar={c.avatar} name={c.name} initials={c.initials} initialsBg={c.initialsBg} size="h-10 w-10" />
                    <div>
                      <span className="block font-bold text-sm text-foreground leading-tight">{c.name}</span>
                      <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                        <span className={`h-1.5 w-1.5 rounded-full ${displayName === "Na Fila" ? "bg-amber-500" : "bg-emerald-500"}`} />
                        {displayName === "Na Fila" ? "Na Fila de Espera" : displayName}
                      </span>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold text-white ${c.channel === "whatsapp" ? "bg-emerald-500" : c.channel === "instagram" ? "bg-gradient-to-tr from-yellow-500 to-purple-600" : "bg-blue-600"}`}>
                    {c.channel === "whatsapp" && <WhatsappLogo className="h-3 w-3" />}
                    {c.channel === "instagram" && <InstagramLogo className="h-3 w-3" />}
                    {c.channel === "messenger" && <MessengerLogo className="h-3 w-3" />}
                    <span className="capitalize">{c.channel}</span>
                  </span>
                </div>

                {/* Dados do contato e cliente vinculado */}
                <div className="bg-muted/40 rounded-xl p-3 text-xs space-y-1.5 border border-border/50">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-primary" />
                      <span className="font-semibold text-foreground">{c.phone ? formatPhoneNumber(c.phone) : "Número não informado"}</span>
                    </span>
                    {c.accountName && (
                      <span className="text-[10px] text-emerald-600 font-mono bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                        {c.accountName}
                      </span>
                    )}
                  </div>
                  {c.email && (
                    <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                      <Mail className="h-3 w-3" />
                      <span className="truncate">{c.email}</span>
                    </div>
                  )}
                  {c.whatsappUsername && c.channel === "whatsapp" && <div className="font-semibold text-primary">@{c.whatsappUsername}</div>}
                </div>

                {/* Tags */}
                {c.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-primary-soft/60 px-2 py-0.5 text-[10px] font-bold text-primary border border-primary/20">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Ações */}
                <div className="flex items-center gap-2 pt-1 border-t border-border/60">
                  {canEditContact && (
                    <button
                      onClick={() => startEditing(c)}
                      className="flex-1 py-2 px-3 rounded-xl border border-border bg-card hover:bg-muted text-foreground text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      <span>Editar</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleStartChat(c.id)}
                    className="flex-1 py-2 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center gap-1.5 shadow-soft hover:opacity-90 transition cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Iniciar Chat</span>
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-8 text-center text-xs text-muted-foreground font-medium bg-card rounded-2xl border border-border">
            Nenhum cliente encontrado com os filtros aplicados.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-3 text-xs text-muted-foreground">
        <span>{loadingContacts ? "Carregando contatos..." : `${contactRows.length} de ${totalContacts} contatos`}</span>
        {contactRows.length < totalContacts && (
          <button type="button" disabled={loadingContacts} onClick={async () => {
            setLoadingContacts(true);
            try { await loadContacts(contactRows.length); }
            catch (error) { toast.error(error instanceof Error ? error.message : "Erro ao carregar contatos."); }
            finally { setLoadingContacts(false); }
          }} className="rounded-lg border border-border px-3 py-2 font-semibold text-primary hover:bg-muted disabled:opacity-50">
            Carregar mais
          </button>
        )}
      </div>

      {/* MODAL: BUSCA GLOBAL DE CONVERSAS */}
      <AnimatePresence>
        {showSearchModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSearchModal(false)}
            className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 pt-20"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -12 }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl rounded-3xl bg-card border border-border shadow-2xl flex flex-col overflow-hidden"
              style={{ maxHeight: "75vh" }}
            >
              {/* Search Input Bar */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-card">
                <Search className="h-5 w-5 text-primary shrink-0" strokeWidth={2.5} />
                <input
                  ref={globalSearchRef}
                  type="text"
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  placeholder="Digite aqui o que esta procurando..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none font-medium"
                />
                {globalSearch && (
                  <button onClick={() => setGlobalSearch("")} className="grid h-6 w-6 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <button onClick={() => setShowSearchModal(false)} className="grid h-7 w-7 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer shrink-0 ml-1">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Results */}
              <div className="flex-1 overflow-y-auto scrollbar-thin">

                {/* Estado inicial */}
                {!globalSearch.trim() && (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                    <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                      <MessagesSquare className="h-7 w-7 text-primary" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-bold text-foreground">Busca em todas as conversas</p>
                    <p className="text-xs text-muted-foreground mt-1.5 max-w-sm">
                      Pesquise por qualquer palavra, frase ou trecho de mensagem em todos os atendimentos registrados no sistema.
                    </p>
                  </div>
                )}

                {globalSearch.trim() && searchLoading && (
                  <div className="py-16 text-center text-xs font-semibold text-muted-foreground">Carregando mensagens para busca...</div>
                )}

                {/* Sem resultados */}
                {globalSearch.trim() && !searchLoading && globalResults.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                    <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                      <Search className="h-7 w-7 text-muted-foreground/50" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-bold text-foreground">Nenhum atendimento encontrado</p>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Nao encontramos mensagens com <span className="font-semibold text-foreground">"{globalSearch}"</span>.
                    </p>
                  </div>
                )}

                {/* Lista de resultados */}
                {!searchLoading && globalResults.length > 0 && (
                  <div className="p-3 space-y-2">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground px-2 py-1">
                      {globalResults.length} atendimento{globalResults.length !== 1 ? "s" : ""} encontrado{globalResults.length !== 1 ? "s" : ""}
                    </p>
                    {globalResults.map(({ conv, matchedMessages }) => (
                      <div key={conv.id} className="rounded-2xl border border-border bg-card/60 hover:bg-muted/30 transition overflow-hidden">
                        {/* Header do resultado */}
                        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/50">
                          <div className="flex items-center gap-3 min-w-0">
                            <ContactAvatar avatar={conv.avatar} name={conv.name} initials={conv.initials} initialsBg={conv.initialsBg} size="h-9 w-9" />
                            <div className="min-w-0">
                              <span className="block font-bold text-sm text-foreground truncate">{conv.name}</span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold text-white ${conv.channel === "whatsapp" ? "bg-emerald-500" : conv.channel === "instagram" ? "bg-gradient-to-tr from-yellow-500 to-purple-600" : "bg-blue-600"}`}>
                                  {conv.channel === "whatsapp" && <WhatsappLogo className="h-2.5 w-2.5" />}
                                  {conv.channel === "instagram" && <InstagramLogo className="h-2.5 w-2.5" />}
                                  {conv.channel === "messenger" && <MessengerLogo className="h-2.5 w-2.5" />}
                                  {conv.channel === "whatsapp" ? "WhatsApp" : conv.channel === "instagram" ? "Instagram" : "Messenger"}
                                </span>
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  {matchedMessages.length} mensagem{matchedMessages.length !== 1 ? "ns" : ""}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleOpenFromSearch(conv.id)}
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft"
                          >
                            Abrir Atendimento
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {/* Mensagens encontradas */}
                        <div className="divide-y divide-border/40">
                          {matchedMessages.slice(0, 3).map((msg) => (
                            <div key={msg.id} className="px-4 py-2.5 flex items-start gap-2.5">
                              <div className={`mt-0.5 shrink-0 rounded-full h-1.5 w-1.5 ${msg.side === "in" ? "bg-emerald-500" : "bg-primary"}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2 mb-0.5">
                                  <span className="text-[10px] font-extrabold text-muted-foreground truncate">{msg.author}</span>
                                  <span className="text-[9px] text-muted-foreground/60 shrink-0">{msg.time}</span>
                                </div>
                                <p className="text-xs text-foreground/80 leading-relaxed line-clamp-2">
                                  <HighlightedText text={msg.text} query={globalSearch} />
                                </p>
                              </div>
                            </div>
                          ))}
                          {matchedMessages.length > 3 && (
                            <div className="px-4 py-2 text-[10px] text-muted-foreground font-medium">
                              + {matchedMessages.length - 3} mensagem{matchedMessages.length - 3 !== 1 ? "ns" : ""} com esta palavra
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DRAWER: NOVO CONTATO */}
      <Sheet
        open={showAddModal}
        onOpenChange={(open) => {
          setShowAddModal(open);
          if (!open) {
            setCreatingCompany(false);
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full w-full max-w-[500px] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-[500px] shadow-2xl border-l border-border"
        >
          <SheetHeader className="flex h-16 shrink-0 flex-row items-center justify-between border-b border-border px-6 bg-card space-y-0">
            <SheetTitle className="text-base font-extrabold text-foreground flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Cadastrar Novo Contato
            </SheetTitle>
          </SheetHeader>

          <form onSubmit={handleCreateContact} className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Nome Completo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: João da Silva"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Telefone</label>
                <input
                  type="text"
                  placeholder="Ex: (81) 99876-5432"
                  value={addForm.phone}
                  onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                  className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                />
              </div>

              {/* Seção da Empresa / Cliente Vinculado */}
              {creatingCompany ? (
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3.5 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-primary/20 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20 text-primary">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-foreground">Nova Empresa / Conta</p>
                        <p className="text-[10px] text-muted-foreground">Cadastre para vincular ao contato</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCreatingCompany(false)}
                      className="text-[11px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Voltar à busca
                    </button>
                  </div>

                  {/* Tipo PJ ou PF */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCompanyForm((prev) => ({ ...prev, type: "company" }))}
                      className={`py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                        companyForm.type === "company"
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-card border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Pessoa Jurídica (PJ)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompanyForm((prev) => ({ ...prev, type: "person" }))}
                      className={`py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                        companyForm.type === "person"
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-card border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Pessoa Física (PF)
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground">
                      {companyForm.type === "company" ? "Razão Social / Nome da Empresa *" : "Nome Completo *"}
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder={companyForm.type === "company" ? "Ex: Tecfag Máquinas Ltda" : "Ex: Maria Oliveira"}
                      value={companyForm.name}
                      onChange={(e) => setCompanyForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                    />
                  </div>

                  {companyForm.type === "company" && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Nome Fantasia</label>
                      <input
                        type="text"
                        placeholder="Ex: Tecfag"
                        value={companyForm.tradeName}
                        onChange={(e) => setCompanyForm((prev) => ({ ...prev, tradeName: e.target.value }))}
                        className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground">
                      {companyForm.type === "company" ? "CNPJ" : "CPF"}
                    </label>
                    <input
                      type="text"
                      placeholder={companyForm.type === "company" ? "00.000.000/0000-00" : "000.000.000-00"}
                      value={companyForm.document}
                      onChange={(e) => setCompanyForm((prev) => ({ ...prev, document: e.target.value }))}
                      className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Telefone</label>
                      <input
                        type="text"
                        placeholder="(00) 0000-0000"
                        value={companyForm.phone}
                        onChange={(e) => setCompanyForm((prev) => ({ ...prev, phone: e.target.value }))}
                        className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground">E-mail</label>
                      <input
                        type="email"
                        placeholder="contato@empresa.com"
                        value={companyForm.email}
                        onChange={(e) => setCompanyForm((prev) => ({ ...prev, email: e.target.value }))}
                        className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-primary/20">
                    <button
                      type="button"
                      onClick={() => setCreatingCompany(false)}
                      className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground hover:bg-muted cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={savingCompany || !companyForm.name.trim()}
                      onClick={handleSaveQuickCompany}
                      className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shadow-xs"
                    >
                      {savingCompany && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {savingCompany ? "Cadastrando..." : "Salvar e Vincular"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Empresa / cliente vinculado</label>
                    <button
                      type="button"
                      onClick={() => {
                        setCompanyForm({ name: "", tradeName: "", document: "", type: "company", phone: "", email: "" });
                        setCreatingCompany(true);
                      }}
                      className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      Nova empresa
                    </button>
                  </div>
                  <AccountPicker
                    value={newAccount?.id || null}
                    selectedAccount={newAccount}
                    onSelectAccount={setNewAccount}
                    lookupUrl="/api/contacts/account-options"
                    placeholder="Buscar empresa por nome ou CNPJ..."
                    onAddNew={(initialQuery) => {
                      setCompanyForm({
                        name: initialQuery || "",
                        tradeName: "",
                        document: "",
                        type: "company",
                        phone: "",
                        email: "",
                      });
                      setCreatingCompany(true);
                    }}
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold uppercase text-muted-foreground">E-mail</label>
                <input
                  type="email"
                  placeholder="Ex: joao@empresa.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Canal Principal de Envio</label>
                <div className="flex gap-2">
                  {(["whatsapp", "instagram", "messenger"] as Channel[]).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setAddForm({ ...addForm, channel: ch })}
                      className={`flex-1 flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                        addForm.channel === ch
                          ? "bg-primary border-primary text-primary-foreground shadow-soft"
                          : "bg-card border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {ch === "whatsapp" && <WhatsappLogo className="h-3.5 w-3.5" />}
                      {ch === "instagram" && <InstagramLogo className="h-3.5 w-3.5" />}
                      {ch === "messenger" && <MessengerLogo className="h-3.5 w-3.5" />}
                      <span className="capitalize">{ch === "whatsapp" ? "WhatsApp" : ch}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-border bg-card px-6 py-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setCreatingCompany(false);
                }}
                className="h-10 rounded-xl border border-border bg-card px-5 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingContact || creatingCompany}
                className="h-10 rounded-xl bg-primary px-6 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft disabled:opacity-50 flex items-center gap-2"
              >
                {savingContact && <Loader2 className="h-4 w-4 animate-spin" />}
                {savingContact ? "Salvando..." : "Criar e Iniciar Chat"}
              </button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* DRAWER: EDITAR CONTATO */}
      <Sheet
        open={editingContact !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingContact(null);
            setCreatingCompany(false);
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full w-full max-w-[500px] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-[500px] shadow-2xl border-l border-border"
        >
          <SheetHeader className="flex h-16 shrink-0 flex-row items-center justify-between border-b border-border px-6 bg-card space-y-0">
            <SheetTitle className="text-base font-extrabold text-foreground flex items-center gap-2">
              <Edit2 className="h-4.5 w-4.5 text-primary" />
              Editar Cadastro de Cliente
            </SheetTitle>
          </SheetHeader>

          {editingContact && (
            <form onSubmit={handleSaveEdit} className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden">
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-xs">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Telefone</label>
                  <input
                    type="text"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                  />
                </div>

                {editingContact.channel === "whatsapp" && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Nome de usuário no WhatsApp</label>
                    <input
                      type="text"
                      placeholder="@usuario"
                      value={editForm.whatsappUsername}
                      onChange={(e) => setEditForm({ ...editForm, whatsappUsername: e.target.value })}
                      className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                    />
                    <p className="text-[10px] text-muted-foreground">O nome é para identificação. O envio depende do identificador recebido do WhatsApp ou do telefone.</p>
                  </div>
                )}

                {/* Seção da Empresa / Cliente Vinculado */}
                {creatingCompany ? (
                  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3.5 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between border-b border-primary/20 pb-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20 text-primary">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-foreground">Nova Empresa / Conta</p>
                          <p className="text-[10px] text-muted-foreground">Cadastre para vincular ao contato</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCreatingCompany(false)}
                        className="text-[11px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        Voltar à busca
                      </button>
                    </div>

                    {/* Tipo PJ ou PF */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCompanyForm((prev) => ({ ...prev, type: "company" }))}
                        className={`py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                          companyForm.type === "company"
                            ? "bg-primary text-primary-foreground border-primary shadow-xs"
                            : "bg-card border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        Pessoa Jurídica (PJ)
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompanyForm((prev) => ({ ...prev, type: "person" }))}
                        className={`py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                          companyForm.type === "person"
                            ? "bg-primary text-primary-foreground border-primary shadow-xs"
                            : "bg-card border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        Pessoa Física (PF)
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground">
                        {companyForm.type === "company" ? "Razão Social / Nome da Empresa *" : "Nome Completo *"}
                      </label>
                      <input
                        type="text"
                        required
                        autoFocus
                        placeholder={companyForm.type === "company" ? "Ex: Tecfag Máquinas Ltda" : "Ex: Maria Oliveira"}
                        value={companyForm.name}
                        onChange={(e) => setCompanyForm((prev) => ({ ...prev, name: e.target.value }))}
                        className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                      />
                    </div>

                    {companyForm.type === "company" && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Nome Fantasia</label>
                        <input
                          type="text"
                          placeholder="Ex: Tecfag"
                          value={companyForm.tradeName}
                          onChange={(e) => setCompanyForm((prev) => ({ ...prev, tradeName: e.target.value }))}
                          className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                        />
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground">
                        {companyForm.type === "company" ? "CNPJ" : "CPF"}
                      </label>
                      <input
                        type="text"
                        placeholder={companyForm.type === "company" ? "00.000.000/0000-00" : "000.000.000-00"}
                        value={companyForm.document}
                        onChange={(e) => setCompanyForm((prev) => ({ ...prev, document: e.target.value }))}
                        className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Telefone</label>
                        <input
                          type="text"
                          placeholder="(00) 0000-0000"
                          value={companyForm.phone}
                          onChange={(e) => setCompanyForm((prev) => ({ ...prev, phone: e.target.value }))}
                          className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-extrabold uppercase text-muted-foreground">E-mail</label>
                        <input
                          type="email"
                          placeholder="contato@empresa.com"
                          value={companyForm.email}
                          onChange={(e) => setCompanyForm((prev) => ({ ...prev, email: e.target.value }))}
                          className="h-9 w-full rounded-xl bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-primary/20">
                      <button
                        type="button"
                        onClick={() => setCreatingCompany(false)}
                        className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground hover:bg-muted cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={savingCompany || !companyForm.name.trim()}
                        onClick={handleSaveQuickCompany}
                        className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shadow-xs"
                      >
                        {savingCompany && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {savingCompany ? "Cadastrando..." : "Salvar e Vincular"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Empresa / cliente vinculado</label>
                      <button
                        type="button"
                        onClick={() => {
                          setCompanyForm({ name: "", tradeName: "", document: "", type: "company", phone: "", email: "" });
                          setCreatingCompany(true);
                        }}
                        className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                        Nova empresa
                      </button>
                    </div>
                    <AccountPicker
                      value={editAccountId}
                      selectedAccount={editAccount || undefined}
                      onSelectAccount={(account) => {
                        setEditAccount(account);
                        setEditAccountId(account?.id || null);
                      }}
                      lookupUrl="/api/contacts/account-options"
                      placeholder="Buscar empresa por nome ou CNPJ..."
                      onAddNew={(initialQuery) => {
                        setCompanyForm({
                          name: initialQuery || "",
                          tradeName: "",
                          document: "",
                          type: "company",
                          phone: "",
                          email: "",
                        });
                        setCreatingCompany(true);
                      }}
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">E-mail</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Tags (Separadas por vírgula)</label>
                  <input
                    type="text"
                    placeholder="Ex: Prioridade, Máquinas, Pós-Venda"
                    value={editForm.tagsInput}
                    onChange={(e) => setEditForm({ ...editForm, tagsInput: e.target.value })}
                    className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                  />
                </div>
              </div>

              <div className="shrink-0 border-t border-border bg-card px-6 py-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditingContact(null);
                    setCreatingCompany(false);
                  }}
                  className="h-10 rounded-xl border border-border bg-card px-5 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingContact || creatingCompany}
                  className="h-10 rounded-xl bg-primary px-6 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft disabled:opacity-50 flex items-center gap-2"
                >
                  {savingContact && <Loader2 className="h-4 w-4 animate-spin" />}
                  {savingContact ? "Salvando..." : "Salvar Cadastro"}
                </button>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>

    </section>
  );
}
