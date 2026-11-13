import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { ConversationDealsPanel } from "./ConversationDealsPanel";
import { InlineChatNoteComposer } from "@/components/chat/InlineChatNoteComposer";
import { usePermissions } from "@/hooks/usePermissions";
import {
  cachedDealRequirement,
  fetchDealRequirement,
  type ConversationDealRequirementState,
} from "@/lib/crm/conversation-deal-client";

export function useConversationDealRequirement(conversationId?: string) {
  const [state, setState] = useState<ConversationDealRequirementState>(
    () =>
      cachedDealRequirement(conversationId) || {
        id: "",
        pending: false,
        currentRequired: false,
        error: "",
      },
  );
  useEffect(() => {
    if (!conversationId || conversationId === "valentina") return;
    let cancelled = false;
    const cached = cachedDealRequirement(conversationId);
    if (cached) {
      setState(cached);
    }
    const refresh = async () => {
      const latestCached = cachedDealRequirement(conversationId);
      if (latestCached && !cancelled) {
        setState(latestCached);
      }
      try {
        const nextState = await fetchDealRequirement(conversationId);
        if (!cancelled) {
          setState(nextState);
        }
      } catch (e) {
        if (!cancelled) {
          const fallback = cachedDealRequirement(conversationId);
          if (fallback && !fallback.pending) {
            setState(fallback);
          } else {
            setState({
              id: conversationId,
              pending: true,
              currentRequired: false,
              error: e instanceof Error ? e.message : "Falha ao verificar negociação.",
            });
          }
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("crm-deals-changed", refresh);
    window.addEventListener("conversation-deal-context-changed", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("crm-deals-changed", refresh);
      window.removeEventListener("conversation-deal-context-changed", refresh);
    };
  }, [conversationId]);
  if (!conversationId || conversationId === "valentina")
    return { pending: false, currentRequired: false, error: "" };
  if (state.id === conversationId) return state;
  const cached = cachedDealRequirement(conversationId);
  if (cached) return cached;
  return { pending: false, currentRequired: false, error: "" };
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
  const { canSendInternalNotes } = usePermissions();
  const [showNoteComposer, setShowNoteComposer] = useState(false);

  useEffect(() => {
    setShowNoteComposer(false);
  }, [conversationId]);

  return (
    <div className="w-full max-h-[76vh] space-y-3 overflow-y-auto rounded-2xl border-2 border-red-600/70 dark:border-red-500/70 bg-card p-4 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="min-w-0">
          <p role="alert" className="text-sm font-bold text-foreground">
            {selectionRequired
              ? "Escolha a negociação atual deste atendimento"
              : "Vincule uma negociação para iniciar o atendimento"}
          </p>
          <p className="text-xs text-muted-foreground">
            {selectionRequired
              ? "Há negociações disponíveis (em andamento ou pausadas), mas nenhuma foi escolhida como atual. Selecione pelo menu suspenso ou clique em \"Escolher essa\" diretamente em um dos cards abaixo."
              : "As mensagens recebidas estão preservadas. Associe um card ou crie uma negociação para continuar."}
          </p>
        </div>
        {canSendInternalNotes && conversationId !== "valentina" && (
          <button
            type="button"
            data-chat-annotation-trigger="deal-requirement"
            onClick={() => setShowNoteComposer((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0 ${
              showNoteComposer
                ? "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "border-border/90 bg-background hover:bg-muted/70 hover:border-amber-500/50 text-foreground"
            }`}
          >
            <Lock className="h-3.5 w-3.5 text-amber-500" />
            <span>{showNoteComposer ? "Fechar Anotação" : "Anotação"}</span>
          </button>
        )}
      </div>
      {showNoteComposer && canSendInternalNotes && conversationId !== "valentina" && (
        <InlineChatNoteComposer
          conversationId={conversationId}
          onClose={() => setShowNoteComposer(false)}
        />
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <ConversationDealsPanel
        conversationId={conversationId}
        contactId={contactId}
        customerName={customerName}
        variant="chat"
      />
    </div>
  );
}
