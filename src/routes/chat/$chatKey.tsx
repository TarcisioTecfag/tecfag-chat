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
    setResolved(null);
    (async () => {
      try {
        const response = await fetch(`/api/chats/resolve?key=${encodeURIComponent(chatKey)}`, { credentials: "include" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível abrir este atendimento.");
        await refreshConversations(data.conversationId);
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

  if (!isAuthenticated) return <Index />;
  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-foreground">{error}</p>
        <button className="rounded-lg bg-primary px-4 py-2 text-primary-foreground" onClick={() => navigate({ to: "/" })}>
          Voltar aos atendimentos
        </button>
      </main>
    );
  }
  if (!resolved || resolved.key !== chatKey) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Abrindo atendimento...</div>;
  }
  return <Index />;
}
