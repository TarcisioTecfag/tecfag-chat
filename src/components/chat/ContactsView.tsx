import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { useChat } from "@/hooks/useChatState";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "./ChatList";
import { formatPhoneNumber, formatCPF, formatCNPJ, maskCPF, maskCNPJ } from "@/lib/utils";
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
} from "lucide-react";
import { Channel, Conversation } from "@/lib/mockData";
import { usePermissions } from "@/hooks/usePermissions";

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
      className={`grid ${size} place-items-center rounded-full text-xs font-bold text-foreground shrink-0`}
      style={{ background: initialsBg || "#eee" }}
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
    updateClientInfo,
    setSelectedChatId,
    setActiveView,
    updateTags,
    operators,
    currentOperatorId,
  } = useChat();

  const { canCreateContact, canEditContact, contactScope } = usePermissions();

  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Conversation | null>(null);

  // ── Global Conversation Search ──────────────────────────────────────────
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const globalSearchRef = useRef<HTMLInputElement>(null);

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
    return conversations
      .map((conv) => {
        const matchedMessages = conv.messages.filter((m) =>
          m.text.toLowerCase().includes(q)
        );
        return matchedMessages.length > 0 ? { conv, matchedMessages } : null;
      })
      .filter(Boolean) as { conv: Conversation; matchedMessages: Conversation["messages"] }[];
  }, [globalSearch, conversations]);

  const [addForm, setAddForm] = useState({
    name: "",
    phone: "",
    email: "",
    cnpj: "",
    channel: "whatsapp" as Channel,
  });

  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    email: "",
    cnpj: "",
    cpf: "",
    tagsInput: "",
  });

  const filteredContacts = conversations.filter((c) => {
    if (contactScope === "wallet_only" && c.walletOperatorId !== currentOperatorId) return false;
    if (channelFilter !== "all" && c.channel !== channelFilter) return false;
    if (search.trim() !== "") {
      const q = search.toLowerCase();
      const matchName = c.name.toLowerCase().includes(q);
      const matchPhone = c.phone?.toLowerCase().includes(q) || false;
      const matchEmail = c.email?.toLowerCase().includes(q) || false;
      const matchCnpj = c.cnpj?.toLowerCase().includes(q) || false;
      const matchTags = c.tags.some((t) => t.toLowerCase().includes(q));
      const matchResponsible = c.responsibleName?.toLowerCase().includes(q) || false;
      return matchName || matchPhone || matchEmail || matchCnpj || matchTags || matchResponsible;
    }
    return true;
  });

  const handleStartChat = (id: string) => {
    setSelectedChatId(id);
    setActiveView("chat");
  };

  const handleOpenFromSearch = (id: string) => {
    setShowSearchModal(false);
    setSelectedChatId(id);
    setActiveView("chat");
  };

  const handleCreateContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) return;
    const newId = createContact(addForm.name, addForm.phone, addForm.email, addForm.cnpj, addForm.channel);
    setAddForm({ name: "", phone: "", email: "", cnpj: "", channel: "whatsapp" });
    setShowAddModal(false);
    setSelectedChatId(newId);
    setActiveView("chat");
  };

  const startEditing = (c: Conversation) => {
    setEditingContact(c);
    setEditForm({
      name: c.name,
      phone: c.phone || "",
      email: c.email || "",
      cnpj: maskCNPJ(c.cnpj || ""),
      cpf: maskCPF((c as any).cpf || ""),
      tagsInput: c.tags.join(", "),
    });
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact) return;
    updateClientInfo(editingContact.id, {
      name: editForm.name,
      phone: editForm.phone,
      email: editForm.email,
      cnpj: editForm.cnpj,
      cpf: editForm.cpf,
    });
    const tagsArray = editForm.tagsInput.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    updateTags(editingContact.id, tagsArray);
    setEditingContact(null);
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
              onClick={() => setShowAddModal(true)}
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
          <motion.button whileTap={{ scale: 0.92 }} onClick={() => setChannelFilter("all")} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer ${channelFilter === "all" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-border"}`}>Todos</motion.button>
          <motion.button whileTap={{ scale: 0.92 }} onClick={() => setChannelFilter("whatsapp")} className={`grid h-8 w-8 place-items-center rounded-lg transition cursor-pointer ${channelFilter === "whatsapp" ? "bg-emerald-500 text-white shadow-soft" : "bg-muted text-emerald-600 hover:bg-emerald-50"}`}><WhatsappLogo className="h-4.5 w-4.5" /></motion.button>
          <motion.button whileTap={{ scale: 0.92 }} onClick={() => setChannelFilter("instagram")} className={`grid h-8 w-8 place-items-center rounded-lg transition cursor-pointer ${channelFilter === "instagram" ? "bg-gradient-to-tr from-yellow-500 to-purple-600 text-white shadow-soft" : "bg-muted text-purple-600 hover:bg-purple-50"}`}><InstagramLogo className="h-4.5 w-4.5" /></motion.button>
          <motion.button whileTap={{ scale: 0.92 }} onClick={() => setChannelFilter("messenger")} className={`grid h-8 w-8 place-items-center rounded-lg transition cursor-pointer ${channelFilter === "messenger" ? "bg-blue-600 text-white shadow-soft" : "bg-muted text-blue-600 hover:bg-blue-50"}`}><MessengerLogo className="h-4.5 w-4.5" /></motion.button>
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
                      </span>
                    </td>
                    <td className="py-3.5 px-4 space-y-0.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        <span>{formatPhoneNumber(c.phone)}</span>
                      </div>
                      {c.email && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          <span className="truncate max-w-[150px]">{c.email}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {c.cnpj ? (
                        <div>
                          <div className="flex items-center gap-1 text-foreground font-mono">
                            <Building className="h-3 w-3 text-muted-foreground" />
                            {formatCNPJ(c.cnpj)}
                          </div>
                          <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/15 px-1 py-0.2 rounded border border-emerald-500/30 mt-0.5 inline-block">Validado</span>
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
                        {(() => {
                          const isValentina = c.id === "valentina" || c.name.toLowerCase().includes("valentina");
                          return isValentina ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="grid h-8 w-8 place-items-center rounded-lg border border-primary/20 bg-primary-soft/40 text-primary cursor-not-allowed">
                                  <Shield className="h-3.5 w-3.5" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top">Assistente IA permanente do sistema</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button onClick={() => startEditing(c)} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer">
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Editar Cadastro</TooltipContent>
                            </Tooltip>
                          );
                        })()}
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
            const isValentina = c.id === "valentina" || c.name.toLowerCase().includes("valentina");
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
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {displayName === "Na Fila" ? "🟡 Na Fila de Espera" : `🟢 ${displayName}`}
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

                {/* Dados do Contato: Telefone, Email, CNPJ */}
                <div className="bg-muted/40 rounded-xl p-3 text-xs space-y-1.5 border border-border/50">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-primary" />
                      <span className="font-semibold text-foreground">{formatPhoneNumber(c.phone)}</span>
                    </span>
                    {c.cnpj && (
                      <span className="text-[10px] text-emerald-600 font-mono bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                        {formatCNPJ(c.cnpj)}
                      </span>
                    )}
                  </div>
                  {c.email && (
                    <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                      <Mail className="h-3 w-3" />
                      <span className="truncate">{c.email}</span>
                    </div>
                  )}
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
                  {!isValentina && (
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

                {/* Sem resultados */}
                {globalSearch.trim() && globalResults.length === 0 && (
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
                {globalResults.length > 0 && (
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

      {/* MODAL: NOVO CONTATO */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 280 }}
              className="w-full max-w-md rounded-3xl bg-card p-6 border border-border shadow-card flex flex-col"
            >
              <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
                <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-primary" />
                  Cadastrar Novo Contato
                </h3>
                <button onClick={() => setShowAddModal(false)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer">
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
              <form onSubmit={handleCreateContact} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Nome Completo</label>
                  <input type="text" required placeholder="Ex: Joao da Silva" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Telefone</label>
                    <input type="text" placeholder="Ex: (81) 99876-5432" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground">CNPJ</label>
                    <input type="text" placeholder="Ex: 12.345.678/0001-90" value={addForm.cnpj} onChange={(e) => setAddForm({ ...addForm, cnpj: maskCNPJ(e.target.value) })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">E-mail</label>
                  <input type="email" placeholder="Ex: joao@empresa.com" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Canal Principal de Envio</label>
                  <div className="flex gap-2">
                    {(["whatsapp", "instagram", "messenger"] as Channel[]).map((ch) => (
                      <button key={ch} type="button" onClick={() => setAddForm({ ...addForm, channel: ch })} className={`flex-1 flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition cursor-pointer ${addForm.channel === ch ? "bg-primary border-primary text-primary-foreground shadow-soft" : "bg-card border-border text-muted-foreground hover:bg-muted"}`}>
                        {ch === "whatsapp" && <WhatsappLogo className="h-3.5 w-3.5" />}
                        {ch === "instagram" && <InstagramLogo className="h-3.5 w-3.5" />}
                        {ch === "messenger" && <MessengerLogo className="h-3.5 w-3.5" />}
                        <span className="capitalize">{ch === "whatsapp" ? "WhatsApp" : ch}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pt-4 border-t border-line flex justify-end gap-3">
                  <button type="button" onClick={() => setShowAddModal(false)} className="h-10 rounded-xl border border-border bg-card px-5 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer">Cancelar</button>
                  <button type="submit" className="h-10 rounded-xl bg-primary px-6 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft">Criar e Iniciar Chat</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: EDITAR CONTATO */}
      <AnimatePresence>
        {editingContact && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 280 }}
              className="w-full max-w-md rounded-3xl bg-card p-6 border border-border shadow-card flex flex-col"
            >
              <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
                <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                  <Edit2 className="h-4.5 w-4.5 text-primary" />
                  Editar Cadastro de Cliente
                </h3>
                <button onClick={() => setEditingContact(null)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer">
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
              <form onSubmit={handleSaveEdit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Nome Completo</label>
                  <input type="text" required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Telefone</label>
                    <input type="text" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground">CNPJ</label>
                    <input type="text" value={editForm.cnpj} onChange={(e) => setEditForm({ ...editForm, cnpj: maskCNPJ(e.target.value) })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase text-muted-foreground">CPF</label>
                    <input type="text" value={editForm.cpf} onChange={(e) => setEditForm({ ...editForm, cpf: maskCPF(e.target.value) })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">E-mail</label>
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-extrabold uppercase text-muted-foreground">Tags (Separadas por virgula)</label>
                  <input type="text" placeholder="Ex: Prioridade, Maquinas, Pos-Venda" value={editForm.tagsInput} onChange={(e) => setEditForm({ ...editForm, tagsInput: e.target.value })} className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent" />
                </div>
                <div className="pt-4 border-t border-line flex justify-end gap-3">
                  <button type="button" onClick={() => setEditingContact(null)} className="h-10 rounded-xl border border-border bg-card px-5 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer">Cancelar</button>
                  <button type="submit" className="h-10 rounded-xl bg-primary px-6 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft">Salvar Cadastro</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </section>
  );
}
