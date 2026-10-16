import { useEffect, useState } from "react";
import { ConversationDealsPanel } from "./ConversationDealsPanel";

export function useConversationDealRequirement(conversationId?: string) {
  const [state, setState] = useState({ id: "", pending: true, error: "" });
  useEffect(() => {
    if (!conversationId || conversationId === "valentina") return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const res = await fetch(
          `/api/chats/${encodeURIComponent(conversationId)}/deals?statusOnly=1`,
          { signal: controller.signal },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Não foi possível verificar a negociação.");
        if (!controller.signal.aborted)
          setState({ id: conversationId, pending: data.dealRequired !== false, error: "" });
      } catch (e) {
        if (!controller.signal.aborted)
          setState({
            id: conversationId,
            pending: true,
            error: e instanceof Error ? e.message : "Falha ao verificar negociação.",
          });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("crm-deals-changed", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("crm-deals-changed", refresh);
    };
  }, [conversationId]);
  if (!conversationId || conversationId === "valentina") return { pending: false, error: "" };
  return state.id === conversationId ? state : { pending: true, error: "" };
}

export function ConversationDealRequirement({
  conversationId,
  contactId,
  customerName,
  error,
}: {
  conversationId: string;
  contactId?: string;
  customerName?: string;
  error?: string;
}) {
  return (
    <div className="mx-auto max-h-[50vh] max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-primary/30 bg-card p-4">
      <p className="text-sm font-semibold">Vincule uma negociação para iniciar o atendimento</p>
      <p className="text-xs text-muted-foreground">
        As mensagens recebidas estão preservadas. Associe o card do RD Marketing ou crie uma
        negociação para continuar.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <ConversationDealsPanel
        conversationId={conversationId}
        contactId={contactId}
        customerName={customerName}
      />
    </div>
  );
}
