import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Maximize2, MessageCircle, Minus } from "lucide-react";
import { ChatList } from "@/components/chat/ChatList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SharedFiles } from "@/components/chat/SharedFiles";
import { useChat } from "@/hooks/useChatState";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePermissions } from "@/hooks/usePermissions";

/** O CRM e o atendimento usam a mesma sessão, conversas e ações do ChatProvider. */
export function CrmChatWidget() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const {
    activeView,
    conversations,
    currentOperatorId,
    isAuthenticated,
    rightSidebarOpen,
    selectedChatId,
    setActiveView,
    tenant,
  } = useChat();
  const { canAccessView, canViewCrm } = usePermissions();

  const inCrm = location.pathname.startsWith("/crm/deals/") ||
    (location.pathname === "/" && activeView === "crm");
  const visible = isAuthenticated && !isMobile && inCrm &&
    canAccessView("crm") && canViewCrm && canAccessView("chat");

  // Ao alternar a empresa, reabrir a janela deve ser uma ação explícita.
  useEffect(() => setOpen(false), [tenant]);

  useEffect(() => {
    if (!open || !visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, visible]);

  if (!visible) return null;

  const unread = conversations
    .filter((conversation) => conversation.queue === "meus" && conversation.operatorId === currentOperatorId)
    .reduce((total, conversation) => total + (conversation.unreadCount || 0), 0);
  const showDetails = rightSidebarOpen && selectedChatId !== "valentina";

  const openFullChat = () => {
    setOpen(false);
    setActiveView("chat");
    if (location.pathname !== "/") navigate({ to: "/" });
  };

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex max-w-[calc(100vw-2.5rem)] flex-col items-end" data-crm-chat-widget>
      {open && (
        <section
          id="crm-chat-window"
          aria-label="Atendimentos no CRM"
          className={`mb-3 flex h-[min(720px,calc(100dvh-100px))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ${showDetails ? "w-[min(1180px,calc(100vw-2.5rem))]" : "w-[min(900px,calc(100vw-2.5rem))]"}`}
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
            <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-foreground">
              <MessageCircle className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">Atendimentos no CRM</span>
              {unread > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={openFullChat} title="Abrir módulo de chat" aria-label="Abrir módulo de chat" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                <Maximize2 className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setOpen(false)} title="Minimizar chat" aria-label="Minimizar chat" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                <Minus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 gap-2 bg-background p-2">
            <ChatList embedded />
            <ChatPanel embedded />
            {showDetails && <SharedFiles />}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls="crm-chat-window"
        aria-label={open ? "Minimizar conversas" : "Abrir conversas no CRM"}
        className="flex h-11 items-center gap-2 rounded-xl border border-primary/20 bg-card px-4 text-sm font-semibold text-foreground shadow-xl transition hover:border-primary/50 hover:bg-primary-soft"
      >
        <MessageCircle className="h-4 w-4 text-primary" />
        <span>Conversas</span>
        {unread > 0 && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
