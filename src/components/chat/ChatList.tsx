import React from "react";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { Search, MessageSquare, Phone, Instagram, Send, Star, User, Pin, BookOpen, Bot, LogOut, FileText, Camera, Video, Mic, Smile } from "lucide-react";
import { Channel, QueueType } from "@/lib/mockData";
import { motion, AnimatePresence } from "framer-motion";

/** Converte conteúdo de mídia em label legível para o preview da lista */
function formatLastMessage(text: string): { mediaType?: "document" | "image" | "video" | "audio" | "sticker"; label: string } {
  if (!text) return { label: "Sem mensagens" };
  if (text.startsWith("[LOCAL_MEDIA:") || text.startsWith("[MEDIA:")) {
    const newlineIndex = text.indexOf("\n");
    const caption = newlineIndex !== -1 ? text.slice(newlineIndex + 1).trim() : "";
    
    let mediaType: "document" | "image" | "video" | "audio" | "sticker" = "document";
    let typeLabel = "Documento";

    if (text.includes(":image]"))       { mediaType = "image"; typeLabel = "Imagem"; }
    else if (text.includes(":video]"))   { mediaType = "video"; typeLabel = "Vídeo"; }
    else if (text.includes(":audio]"))   { mediaType = "audio"; typeLabel = "Áudio"; }
    else if (text.includes(":sticker]")) { mediaType = "sticker"; typeLabel = "Figurinha"; }

    return {
      mediaType,
      label: caption ? `${typeLabel}: ${caption}` : typeLabel
    };
  }
  return { label: text };
}

function renderMediaIcon(type?: string) {
  switch (type) {
    case "image": return <Camera className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    case "video": return <Video className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    case "audio": return <Mic className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    case "sticker": return <Smile className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    case "document": return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    default: return null;
  }
}

// Premium Inline SVGs for Channel Logos
export function WhatsappLogo({ className = "h-4.5 w-4.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.96 9.96 0 001.37 5.053L2 21.855l5.023-1.317a9.927 9.927 0 004.988 1.325h.004c5.505 0 9.989-4.478 9.99-9.984C22 6.478 17.518 2 12.012 2zm0 18.29h-.003a8.266 8.266 0 01-4.224-1.163l-.303-.18-3.138.823.838-3.06-.197-.314a8.273 8.273 0 01-1.267-4.409c.001-4.566 3.717-8.278 8.29-8.278 2.217.001 4.3 0.865 5.867 2.435a8.223 8.223 0 012.424 5.85c-.001 4.567-3.717 8.279-8.288 8.279z" />
    </svg>
  );
}

export function InstagramLogo({ className = "h-4.5 w-4.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export function MessengerLogo({ className = "h-4.5 w-4.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} fill="currentColor">
      <path d="M14 2C7.14 2 1.5 7.24 1.5 13.8c0 3.37 1.48 6.4 3.9 8.52a.85.85 0 0 1 .28.66l-.08 2.37a.85.85 0 0 0 1.25.79l2.76-1.57a.84.84 0 0 1 .53-.1c1.22.34 2.52.53 3.86.53 6.86 0 12.5-5.24 12.5-11.8S20.86 2 14 2zm1.68 15.06l-2.9-3.1-5.65 3.1 6.22-6.6 2.95 3.1 5.6-3.1-6.22 6.6z" />
    </svg>
  );
}

export function ChatList({ embedded = false }: { embedded?: boolean }) {
  const {
    tenant,
    activeView,
    activeQueue,
    setActiveQueue,
    selectedChatId,
    setSelectedChatId,
    conversations,
    searchQuery,
    setSearchQuery,
    channelFilter,
    setChannelFilter,
    setActiveView,
    operatorProfile,
    updateOperatorProfile,
    setIsProfileModalOpen,
    currentGroup,
    currentOperatorId,
    markAsRead,
    markAsUnread,
    pinChat,
    logout,
  } = useChat();
  const aiPersona = getAiPersona(tenant);

  const [showStatusDropdown, setShowStatusDropdown] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<{ chatId: string; x: number; y: number } | null>(null);

  // Fecha o context menu ao clicar em qualquer lugar
  React.useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  React.useEffect(() => {
    if (currentGroup && channelFilter !== "all" && !currentGroup.allowedChannels.includes(channelFilter)) {
      setChannelFilter("all");
    }
  }, [currentGroup, channelFilter]);

  const queues = [
    { id: "meus", label: "Meus" },
    { id: "todos", label: "Todos" },
    { id: "fila", label: "Fila" },
    { id: "automacao", label: "Bot" },
    { id: "finalizados", label: "Fim" },
  ];

  // Filter conversations based on UI selections
  const filteredConvs = conversations.filter((c) => c.id !== "valentina").filter((c) => {
    // 1. Queue Filter
    if (activeQueue !== "todos" && c.queue !== activeQueue) return false;

    // Se for a fila 'meus', apenas exibir se pertencer ao operador ativo
    if (activeQueue === "meus" && c.operatorId !== currentOperatorId) return false;

    // 2. Channel Filter
    if (channelFilter !== "all" && c.channel !== channelFilter) return false;

    // 3. Search Query Filter
    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      const matchName = c.name.toLowerCase().includes(q);
      const matchPhone = c.phone?.toLowerCase().includes(q) || false;
      const matchUsername = c.whatsappUsername?.toLowerCase().includes(q.replace(/^@/, "")) || false;
      const matchCnpj = c.cnpj?.toLowerCase().includes(q) || false;
      const matchTags = c.tags.some((t) => t.toLowerCase().includes(q));
      return matchName || matchPhone || matchUsername || matchCnpj || matchTags;
    }

    return true;
  });

  return (
    <>
    <aside className="flex h-full w-full md:w-[260px] md:shrink-0 flex-col rounded-3xl bg-card px-4 py-6 shadow-soft select-none border border-border">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground tracking-tight">Atendimentos</h2>
      </div>

      <div className="my-4 h-px bg-line" />

      {/* Vendedor Info */}
      <div className="flex flex-col items-center relative">
        <button
          onClick={() => setIsProfileModalOpen(true)}
          className="relative block cursor-pointer transition hover:scale-105"
          title="Editar Meu Perfil"
        >
          <img
            src={operatorProfile.avatar}
            alt="Atendente"
            className="h-[80px] w-[80px] rounded-full object-cover ring-2 ring-primary/20"
          />
          <span className={`absolute bottom-0 right-1.5 h-3.5 w-3.5 rounded-full border-2 border-card ${
            operatorProfile.status === "disponivel"
              ? "bg-emerald-500"
              : operatorProfile.status === "pausa"
              ? "bg-amber-500"
              : "bg-gray-400"
          }`} />
        </button>
        <h3 className="mt-2 text-[15px] font-bold text-foreground">{operatorProfile.name}</h3>
        
        {/* Clickable Status Badge */}
        <div className="relative mt-1">
          <button
            onClick={() => setShowStatusDropdown(!showStatusDropdown)}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold transition hover:opacity-90 cursor-pointer capitalize ${
              operatorProfile.status === "disponivel"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                : operatorProfile.status === "pausa"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                : "bg-muted text-muted-foreground border border-border"
            }`}
          >
            {operatorProfile.status === "disponivel" ? "Disponível" : operatorProfile.status === "pausa" ? "Em Pausa" : "Desconectado"}
          </button>
          
          <AnimatePresence>
            {showStatusDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStatusDropdown(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  transition={{ type: "spring", damping: 20, stiffness: 350 }}
                  className="absolute top-6 left-1/2 -translate-x-1/2 z-50 w-32 rounded-xl bg-card p-1 border border-border shadow-card text-[11px] font-bold origin-top"
                >
                  {(["disponivel", "pausa", "desconectado"] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => {
                        updateOperatorProfile({ status: st });
                        setShowStatusDropdown(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-foreground hover:bg-muted transition capitalize cursor-pointer"
                    >
                      <span className={`h-2 w-2 rounded-full ${
                        st === "disponivel" ? "bg-emerald-500" : st === "pausa" ? "bg-amber-500" : "bg-gray-400"
                      }`} />
                      {st === "disponivel" ? "Disponível" : st === "pausa" ? "Em Pausa" : "Desconectado"}
                    </button>
                  ))}
                  <div className="my-1 border-t border-border/60" />
                  <button
                    onClick={() => {
                      setShowStatusDropdown(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-destructive hover:bg-destructive/10 transition cursor-pointer"
                  >
                    <LogOut className="h-3 w-3" />
                    <span>Sair</span>
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* Search Input */}
      <div className="relative mt-4">
        <Search className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
        <input
          placeholder="Buscar contato, CNPJ, tag..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 w-full rounded-xl bg-muted px-3 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
        />
      </div>

      {/* Channels Filter Row */}
      <div className="mt-4 flex items-center justify-between gap-1 border-b border-line pb-3">
        <button
          onClick={() => setChannelFilter("all")}
          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer ${
            channelFilter === "all"
              ? "bg-primary text-primary-foreground shadow-soft"
              : "bg-muted text-muted-foreground hover:bg-border hover:text-foreground"
          }`}
        >
          Todos
        </button>
        {(!currentGroup || currentGroup.allowedChannels.includes("whatsapp")) && (
          <button
            onClick={() => setChannelFilter("whatsapp")}
            className={`grid h-7 w-7 place-items-center rounded-lg transition cursor-pointer ${
              channelFilter === "whatsapp"
                ? "bg-emerald-500 text-white shadow-soft"
                : "bg-muted text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
            }`}
            title="WhatsApp Only"
          >
            <WhatsappLogo className="h-4 w-4" />
          </button>
        )}
        {(!currentGroup || currentGroup.allowedChannels.includes("instagram")) && (
          <button
            onClick={() => setChannelFilter("instagram")}
            className={`grid h-7 w-7 place-items-center rounded-lg transition cursor-pointer ${
              channelFilter === "instagram"
                ? "bg-gradient-to-tr from-yellow-500 to-purple-600 text-white shadow-soft"
                : "bg-muted text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
            }`}
            title="Instagram Only"
          >
            <InstagramLogo className="h-4 w-4" />
          </button>
        )}
        {(!currentGroup || currentGroup.allowedChannels.includes("messenger")) && (
          <button
            onClick={() => setChannelFilter("messenger")}
            className={`grid h-7 w-7 place-items-center rounded-lg transition cursor-pointer ${
              channelFilter === "messenger"
                ? "bg-blue-600 text-white shadow-soft"
                : "bg-muted text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
            }`}
            title="Messenger Only"
          >
            <MessengerLogo className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Queue Tabs */}
      <div className="mt-4 flex items-center gap-1 rounded-xl bg-muted p-1 relative">
        {queues.map((q) => {
          const isActive = activeQueue === q.id;
          return (
            <button
              key={q.id}
              onClick={() => {
                setActiveQueue(q.id as QueueType);
                setSelectedChatId(null);
                if (!embedded) setActiveView("chat");
              }}
              className={`relative flex-1 rounded-lg py-1.5 text-center text-xs font-semibold transition-colors duration-200 cursor-pointer z-10 ${
                isActive
                  ? "text-foreground font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="activeQueueIndicator"
                  className="absolute inset-0 bg-card rounded-lg shadow-soft -z-10"
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                />
              )}
              {q.label}
            </button>
          );
        })}
      </div>

      {/* Chat List */}
      <div className="mt-3 flex-1 overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
        <AnimatePresence initial={false}>
          {/* Assistente do tenant */}
          <motion.div
            layout
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative"
          >
            <button
              onClick={() => {
                setSelectedChatId("valentina");
                if (!embedded) setActiveView("chat");
              }}
              className={`flex w-full items-center gap-2 rounded-2xl p-2 text-left transition-colors duration-150 cursor-pointer ${
                selectedChatId === "valentina" && (embedded || activeView === "chat") ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              {/* Avatar da IA com indicador de canal/presença */}
              <div className="relative shrink-0">
                <span aria-label={aiPersona.name} className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-primary-soft text-lg">{aiPersona.avatar}</span>
                
                {/* Indicador Online Pulsante como Channel Badge */}
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-card bg-primary text-primary-foreground shadow-soft">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
                </span>
              </div>

              {/* Info Text */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-bold text-primary flex items-center gap-1.5">
                    {aiPersona.name}
                    <span className="px-1.5 py-0.2 rounded bg-primary text-primary-foreground text-[8px] font-black uppercase tracking-wider">
                      IA
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground font-medium">Agora</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="truncate text-[10px] text-primary font-bold">
                    Online
                  </p>
                </div>
              </div>
            </button>
          </motion.div>

          {filteredConvs.length > 0 ? (
            filteredConvs
              .sort((a, b) => ((b as any).pinned ? 1 : 0) - ((a as any).pinned ? 1 : 0))
              .map((c) => {
                const isSelected = c.id === selectedChatId;
                const lastMsg = c.messages[c.messages.length - 1];
                const { mediaType: msgMediaType, label: msgLabel } = formatLastMessage(lastMsg?.text || "");
                return (
                  <motion.div
                    key={c.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    className="relative"
                    onContextMenu={(e) => {
                      if (c.queue !== "meus") return;
                      e.preventDefault();
                      setContextMenu({ chatId: c.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <button
                      onClick={() => {
                        setSelectedChatId(c.id);
                        if (!embedded) setActiveView("chat");
                        markAsRead(c.id);
                      }}
                      className={`flex w-full items-center gap-2 rounded-2xl p-2 text-left transition-colors duration-150 ${
                        isSelected ? "bg-muted" : "hover:bg-muted/50"
                      }`}
                    >
                      {/* Avatar with Channel Badge Overlay */}
                      <div className="relative shrink-0">
                        {c.avatar ? (
                          <img src={c.avatar} alt={c.name} className="h-8 w-8 rounded-full object-cover border border-border" />
                        ) : (
                          <div
                            className="grid h-8 w-8 place-items-center rounded-full text-[10px] font-bold text-foreground"
                            style={{ background: c.initialsBg || "#eee" }}
                          >
                            {c.initials || <User className="h-3 w-3 text-muted-foreground" />}
                          </div>
                        )}

                        {/* Channel Badge */}
                        <span className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-card text-white shadow-soft ${
                          c.channel === "whatsapp"
                            ? "bg-emerald-500"
                            : c.channel === "instagram"
                            ? "bg-gradient-to-tr from-yellow-500 to-purple-600"
                            : "bg-blue-600"
                        }`}>
                          {c.channel === "whatsapp" && <WhatsappLogo className="h-2 w-2" />}
                          {c.channel === "instagram" && <InstagramLogo className="h-2 w-2" />}
                          {c.channel === "messenger" && <MessengerLogo className="h-2 w-2" />}
                        </span>

                        {/* Pin indicator */}
                        {(c as any).pinned && (
                          <span className="absolute -top-0.5 -left-0.5 grid h-3 w-3 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Pin className="h-1.5 w-1.5" />
                          </span>
                        )}
                      </div>

                      {/* Info Text */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-xs font-bold text-foreground">{c.name}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground font-medium">{(c as any).time || c.lastMessageTime}</span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="truncate text-[10px] text-muted-foreground pr-2 flex items-center gap-1">
                            {lastMsg?.isInternalNote && (
                              <span className="text-amber-500 font-semibold shrink-0">[Nota]</span>
                            )}
                            {renderMediaIcon(msgMediaType)}
                            <span className="truncate">{msgLabel}</span>
                          </p>

                          {/* Unread Count Badge */}
                          {c.unreadCount > 0 && (
                            <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                              {c.unreadCount}
                            </span>
                          )}
                        </div>

                        {/* Render tags below preview */}
                        {((c.tags && c.tags.length > 0) || c.sectorName) && (
                          <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                            {c.sectorName && (
                              <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-md border ${
                                c.sectorName === "Comercial"
                                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                                  : c.sectorName === "Suporte"
                                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                                  : c.sectorName === "Financeiro"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                  : "bg-muted text-muted-foreground border-border"
                              }`}>
                                {c.sectorName}
                              </span>
                            )}
                            {c.tags && c.tags.slice(0, 2).map((tag, idx) => (
                              <span 
                                key={idx} 
                                className="text-[9px] font-extrabold uppercase bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-md"
                              >
                                {tag}
                              </span>
                            ))}
                            {c.tags && c.tags.length > 2 && (
                              <span className="text-[9px] font-bold text-muted-foreground px-1 py-0.5">
                                +{c.tags.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  </motion.div>
                );
              })
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center text-center py-12 text-muted-foreground"
            >
              <MessageSquare className="h-8 w-8 text-muted-foreground/30 mb-2" strokeWidth={1.5} />
              <p className="text-xs font-semibold">Nenhum atendimento</p>
              <p className="text-[10px] mt-0.5 max-w-[180px]">Não há conversas nesta fila com os filtros aplicados.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </aside>

    {/* Context Menu (right-click) */}
    <AnimatePresence>
      {contextMenu && (() => {
        const chat = conversations.find((c) => c.id === contextMenu.chatId);
        if (!chat) return null;
        return (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="fixed z-[9999] min-w-[180px] rounded-xl bg-card border border-border shadow-card p-1"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { pinChat(chat.id); setContextMenu(null); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition"
            >
              <Pin className="h-3.5 w-3.5 text-primary" />
              {(chat as any).pinned ? "Desafixar Chat" : "Fixar Chat"}
            </button>
            <button
              onClick={() => { markAsUnread(chat.id); setContextMenu(null); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition"
            >
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              Marcar como não lido
            </button>
          </motion.div>
        );
      })()}
    </AnimatePresence>
    </>
  );
}
