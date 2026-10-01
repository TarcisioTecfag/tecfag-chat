import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Maximize2,
  MessageCircle,
  Search,
  Send,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePermissions } from "@/hooks/usePermissions";
import type { Conversation } from "@/lib/mockData";

function preview(text: string) {
  if (!text.startsWith("[MEDIA:") && !text.startsWith("[LOCAL_MEDIA:")) return text;
  const type = text.match(/^\[(?:LOCAL_)?MEDIA:([^\]]+)/)?.[1];
  const labels: Record<string, string> = {
    image: "Imagem",
    video: "Vídeo",
    audio: "Áudio",
    document: "Documento",
    sticker: "Figurinha",
  };
  const caption = text.includes("\n") ? text.slice(text.indexOf("\n") + 1).trim() : "";
  return `📎 ${labels[type || ""] || "Mídia"}${caption ? `: ${caption}` : ""}`;
}

function Avatar({ conversation }: { conversation: Conversation }) {
  return conversation.avatar ? (
    <img src={conversation.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
      {conversation.initials || conversation.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Uma lista e uma conversa por vez, usando as mesmas ações e dados do módulo Chat. */
export function CrmChatWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "thread">("list");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [metaWindowOpen, setMetaWindowOpen] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const {
    activeProvider,
    activeView,
    conversations,
    currentOperatorId,
    isAuthenticated,
    markAsRead,
    selectedChatId,
    sendMessage,
    setActiveView,
    setSelectedChatId,
    tenant,
  } = useChat();
  const { canAccessView, canViewCrm } = usePermissions();

  const inCrm =
    location.pathname.startsWith("/crm/deals/") ||
    (location.pathname === "/" && activeView === "crm");
  const visible =
    isAuthenticated &&
    !isMobile &&
    inCrm &&
    canAccessView("crm") &&
    canViewCrm &&
    canAccessView("chat");
  const assigned = conversations.filter(
    (conversation) =>
      conversation.queue === "meus" && conversation.operatorId === currentOperatorId,
  );
  const selected =
    view === "thread"
      ? assigned.find((conversation) => conversation.id === selectedChatId)
      : undefined;
  const query = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = assigned.filter(
    (conversation) =>
      !query ||
      conversation.name.toLocaleLowerCase("pt-BR").includes(query) ||
      conversation.phone?.includes(query),
  );
  const unread = assigned.reduce(
    (total, conversation) => total + (conversation.unreadCount || 0),
    0,
  );

  useEffect(() => {
    setOpen(false);
    setView("list");
    setDraft("");
    setSearch("");
  }, [tenant]);

  useEffect(() => {
    if (!open || !visible) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, visible]);

  useEffect(() => {
    if (!open || activeProvider !== "meta" || selected?.channel !== "whatsapp") {
      setMetaWindowOpen(null);
      return;
    }
    const conversationId = selected.id;
    let cancelled = false;
    setMetaWindowOpen(null);
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/whatsapp/meta-state?conversationId=${encodeURIComponent(conversationId)}`,
          { credentials: "include" },
        );
        const data = response.ok ? await response.json() : null;
        if (!cancelled)
          setMetaWindowOpen(
            data?.activeProvider === "meta" ? data.window?.open === true : response.ok,
          );
      } catch {
        if (!cancelled) setMetaWindowOpen(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, activeProvider, selected?.id, selected?.channel]);

  useEffect(() => {
    if (open && view === "thread") endRef.current?.scrollIntoView({ block: "end" });
  }, [open, view, selected?.id, selected?.messages.length]);

  if (!visible) return null;

  const openFullChat = () => {
    setOpen(false);
    setActiveView("chat");
    if (location.pathname !== "/") navigate({ to: "/" });
  };
  const selectConversation = (conversation: Conversation) => {
    setSelectedChatId(conversation.id);
    markAsRead(conversation.id);
    setDraft("");
    setView("thread");
  };
  const metaRestricted =
    activeProvider === "meta" && selected?.channel === "whatsapp" && metaWindowOpen !== true;
  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending || metaRestricted || !selected || selected.id !== selectedChatId) return;
    setSending(true);
    try {
      if (await sendMessage(text)) setDraft("");
    } finally {
      setSending(false);
    }
  };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <div
      className="fixed bottom-0 right-5 z-[100] flex w-[min(370px,calc(100vw-2.5rem))] flex-col items-end"
      data-crm-chat-widget
    >
      {open && (
        <section
          id="crm-chat-window"
          aria-label="Conversas no CRM"
          className="flex h-[min(510px,calc(100dvh-70px))] w-full flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-card shadow-2xl"
        >
          {selected ? (
            <>
              <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
                <button
                  type="button"
                  onClick={() => setView("list")}
                  aria-label="Voltar às conversas"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <Avatar conversation={selected} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {selected.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Atendimento em andamento</div>
                </div>
                <button
                  type="button"
                  onClick={openFullChat}
                  title="Abrir no Chat"
                  aria-label="Abrir no Chat"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-background px-3 py-3">
                {selected.messages.length === 0 && (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    Nenhuma mensagem nesta conversa.
                  </p>
                )}
                {selected.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.side === "out" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[86%] rounded-2xl px-3 py-2 text-xs shadow-sm ${message.isInternalNote ? "border border-amber-300/50 bg-amber-100 text-amber-950" : message.side === "out" ? "bg-primary-soft text-foreground" : "border border-border bg-card text-foreground"}`}
                    >
                      {message.isInternalNote && (
                        <div className="mb-1 text-[10px] font-semibold">Nota interna</div>
                      )}
                      <p className="whitespace-pre-wrap break-words">{preview(message.text)}</p>
                      <div className="mt-1 text-right text-[10px] text-muted-foreground">
                        {message.time}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="shrink-0 border-t border-border bg-card p-3">
                {metaRestricted && (
                  <p className="mb-2 text-xs text-amber-700">
                    {metaWindowOpen === null
                      ? "Verificando janela de atendimento..."
                      : "Janela encerrada. Abra o Chat para usar um modelo aprovado."}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    disabled={metaRestricted || sending}
                    rows={2}
                    placeholder="Escreva uma mensagem..."
                    aria-label="Mensagem para o cliente"
                    className="min-h-11 max-h-24 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!draft.trim() || sending || metaRestricted}
                    aria-label="Enviar mensagem"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="border-b border-border p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar conversa"
                    aria-label="Buscar conversa"
                    className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs text-foreground outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="px-5 py-10 text-center text-xs text-muted-foreground">
                    {search
                      ? "Nenhuma conversa encontrada."
                      : "Você não tem atendimentos ativos no momento."}
                  </p>
                ) : (
                  filtered.map((conversation) => {
                    const last = conversation.messages.at(-1);
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => selectConversation(conversation)}
                        className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left transition hover:bg-muted/60"
                      >
                        <Avatar conversation={conversation} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {conversation.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {conversation.lastMessageTime}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {last ? preview(last.text) : "Sem mensagens"}
                          </span>
                        </span>
                        {conversation.unreadCount > 0 && (
                          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                            {conversation.unreadCount}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="border-t border-border px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={openFullChat}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Abrir Chat completo
                </button>
              </div>
            </>
          )}
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls="crm-chat-window"
        aria-label={open ? "Recolher conversas" : "Abrir conversas"}
        className="flex h-9 min-w-36 items-center justify-between gap-2 rounded-t-lg bg-[#102b3f] px-3 text-xs font-semibold text-white shadow-lg hover:bg-[#173c55]"
      >
        <span className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          Conversas
        </span>
        <span className="flex items-center gap-1.5">
          {unread > 0 && (
            <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>
    </div>
  );
}
