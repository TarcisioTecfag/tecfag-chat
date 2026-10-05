import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { getChatLinkKey } from "@/lib/chat-link";
import { Index } from "../index";

export const Route = createFileRoute("/chat/$chatKey")({
  component: ChatLinkPage,
});

function ChatLinkPage() {
  const { chatKey } = Route.useParams();
  const navigate = useNavigate();
  const {
    activeChat, activeView, conversations, isAuthenticated, selectedChatId, setActiveQueue,
    setActiveView, setSelectedChatId, refreshConversations,
  } = useChat();
  const [resolved, setResolved] = useState<{ key: string; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setError(null);
    // Uma troca feita na lista já atualizou o chat no estado compartilhado.
    // Navegar para a nova URL não precisa buscar nem remontar a tela inteira.
    if (activeChat && (activeChat.id === chatKey || getChatLinkKey(activeChat, conversations) === chatKey)) {
      setResolved({ key: chatKey, id: activeChat.id });
      return;
    }
    setResolved(null);
    (async () => {
      try {
        const response = await fetch(`/api/chats/resolve?key=${encodeURIComponent(chatKey)}`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível abrir este atendimento.");
        if (!conversations.some((chat) => chat.id === data.conversationId)) {
          await refreshConversations(data.conversationId);
        }
        if (cancelled) return;
        setActiveQueue("todos");
        setActiveView("chat");
        setSelectedChatId(data.conversationId);
        setResolved({ key: chatKey, id: data.conversationId });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível abrir este atendimento.");
      }
    })();
    return () => { cancelled = true; };
  }, [chatKey, isAuthenticated]);

  useEffect(() => {
    if (!resolved || resolved.key !== chatKey) return;
    if (activeView !== "chat" || selectedChatId === null || selectedChatId === "valentina") {
      navigate({ to: "/", replace: true });
    } else if (selectedChatId !== resolved.id && activeChat?.id === selectedChatId) {
      navigate({ to: "/chat/$chatKey", params: { chatKey: getChatLinkKey(activeChat, conversations) } });
    }
  }, [activeChat, activeView, chatKey, conversations, navigate, resolved, selectedChatId]);

  return (
    <>
      <Index />
      {error && (
        <div role="alert" className="fixed bottom-6 left-1/2 z-[100] flex max-w-[90vw] -translate-x-1/2 items-center gap-4 rounded-xl border border-border bg-card px-5 py-3 text-sm text-foreground shadow-xl">
          <span>{error}</span>
          <button className="shrink-0 font-semibold text-primary" onClick={() => navigate({ to: "/" })}>
            Voltar
          </button>
        </div>
      )}
    </>
  );
}
