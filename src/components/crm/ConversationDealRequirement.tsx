import { useEffect, useState } from "react";
import { ConversationDealsPanel } from "./ConversationDealsPanel";

export function useConversationDealRequirement(conversationId?: string) {
  const [state, setState] = useState({ id: "", pending: true, currentRequired: false, error: "" });
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
          setState({
            id: conversationId,
            pending: data.dealRequired !== false || data.currentDealRequired === true,
            currentRequired: data.currentDealRequired === true,
            error: "",
          });
      } catch (e) {
        if (!controller.signal.aborted)
          setState({
            id: conversationId,
            pending: true,
            currentRequired: false,
            error: e instanceof Error ? e.message : "Falha ao verificar negociação.",
          });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("crm-deals-changed", refresh);
    window.addEventListener("conversation-deal-context-changed", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("crm-deals-changed", refresh);
      window.removeEventListener("conversation-deal-context-changed", refresh);
    };
  }, [conversationId]);
  if (!conversationId || conversationId === "valentina")
    return { pending: false, currentRequired: false, error: "" };
  return state.id === conversationId ? state : { pending: true, currentRequired: false, error: "" };
}

export function ConversationDealRequirement({
  conversationId,
  contactId,
  customerName,
  error,
  selectionRequired,
}: {
  conversationId: string;
  contactId?: string;
  customerName?: string;
  error?: string;
  selectionRequired?: boolean;
}) {
  return (
    <div className="mx-auto max-h-[50vh] max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-primary/30 bg-card p-4">
      <p role="alert" className="text-sm font-semibold">
        {selectionRequired
          ? "Escolha a negociação atual deste atendimento"
          : "Vincule uma negociação para iniciar o atendimento"}
      </p>
      <p className="text-xs text-muted-foreground">
        {selectionRequired
          ? "Há negociações em andamento, mas nenhuma foi escolhida como atual. Selecione abaixo o card que corresponde ao assunto deste atendimento."
          : "As mensagens recebidas estão preservadas. Associe um card ou crie uma negociação para continuar."}
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
