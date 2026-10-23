import { useCallback, useEffect, useId, useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { toast } from "sonner";
import { isCurrentDealEligible } from "@/lib/crm/conversation-deal-policy";
import {
  fetchDealContext,
  type ConversationDealContext as Context,
} from "@/lib/crm/conversation-deal-client";

export function useConversationDealContext(conversationId?: string) {
  const { tenant, currentOperatorId } = useChat();
  const requestKey = JSON.stringify([tenant, currentOperatorId, conversationId]);
  const [state, setState] = useState<{ id: string; data?: Context; error?: string }>({ id: "" });
  const refresh = useCallback(async () => {
    if (!conversationId || conversationId === "valentina" || !tenant || !currentOperatorId) return;
    try {
      const data = await fetchDealContext(tenant, currentOperatorId, conversationId);
      setState({ id: requestKey, data });
      return data;
    } catch (error) {
      setState({
        id: requestKey,
        error: error instanceof Error ? error.message : "Falha ao carregar negociação.",
      });
    }
  }, [conversationId, tenant, currentOperatorId, requestKey]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("crm-deals-changed", refresh);
    window.addEventListener("conversation-deal-context-changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("crm-deals-changed", refresh);
      window.removeEventListener("conversation-deal-context-changed", refresh);
    };
  }, [refresh]);
  return {
    data: state.id === requestKey ? state.data : undefined,
    error: state.id === requestKey ? state.error : undefined,
    refresh,
  };
}

export function ConversationDealContext({
  conversationId,
  onSelected,
}: {
  conversationId: string;
  onSelected?: (version: number) => void;
}) {
  const { data, error, refresh } = useConversationDealContext(conversationId);
  const [saving, setSaving] = useState(false);
  const selectId = useId();
  if (error)
    return (
      <p role="alert" className="text-xs text-destructive">
        {error}{" "}
        <button onClick={refresh} className="underline">
          Tentar novamente
        </button>
      </p>
    );
  if (!data)
    return <p className="text-xs text-muted-foreground">Carregando negociação do atendimento…</p>;
  return (
    <div
      role={!data.hasCurrentDeal && data.editable ? "alert" : undefined}
      className={`space-y-1 rounded-lg border p-2 text-xs ${!data.hasCurrentDeal && data.editable ? "border-amber-500/50 bg-amber-500/10" : "border-primary/20 bg-primary/5"}`}
    >
      {!data.hasCurrentDeal && data.editable && (
        <p className="font-semibold">
          {data.deals.some(isCurrentDealEligible)
            ? "Selecione a negociação atual para continuar"
            : "Nenhuma negociação em andamento disponível"}
        </p>
      )}
      <label className="block font-semibold" htmlFor={selectId}>
        Negociação deste atendimento
      </label>
      <select
        id={selectId}
        aria-label="Negociação deste atendimento"
        className="w-full rounded border border-border bg-background p-1.5 text-foreground"
        value={data.currentDeal?.id || ""}
        disabled={saving || !data.editable}
        onChange={async (event) => {
          const dealId = event.target.value;
          if (!dealId) return;
          setSaving(true);
          try {
            const res = await fetch(
              `/api/chats/${encodeURIComponent(conversationId)}/deal-context`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dealId, expectedVersion: data.version }),
              },
            );
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || "Falha ao selecionar negociação.");
            await refresh();
            onSelected?.(result.version);
            window.dispatchEvent(new Event("conversation-deal-context-changed"));
            toast.success("As próximas ações serão registradas na negociação selecionada.");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Falha ao selecionar negociação.");
          } finally {
            setSaving(false);
            void refresh();
          }
        }}
      >
        <option value="" disabled>
          {data.hasCurrentDeal
            ? "Negociação selecionada (acesso restrito)"
            : "Selecione uma negociação em andamento"}
        </option>
        <optgroup label="Em andamento — disponíveis para seleção">
          {data.deals.filter(isCurrentDealEligible).map((deal) => (
            <option key={deal.id} value={deal.id}>
              {deal.title}
            </option>
          ))}
        </optgroup>
        {data.deals.some((deal) => !isCurrentDealEligible(deal)) && (
          <optgroup label="Histórico — não pode ser definido como atual">
            {data.deals
              .filter((deal) => !isCurrentDealEligible(deal))
              .map((deal) => (
                <option key={deal.id} value={deal.id} disabled>
                  {deal.title} (
                  {deal.status === "won"
                    ? "Vendido"
                    : deal.status === "lost"
                      ? "Perdido"
                      : deal.status === "paused"
                        ? "Pausado"
                        : "Desvinculada"}
                  )
                </option>
              ))}
          </optgroup>
        )}
      </select>
      <p className="text-muted-foreground">
        {data.hasCurrentDeal
          ? "Notas e ações serão registradas neste card. Transferências mantêm esta seleção."
          : data.previousDeal
            ? `Última negociação: ${data.previousDeal.title}. Confira o assunto antes de continuar.`
            : "Escolha o card que corresponde ao assunto do atendimento."}
      </p>
      {!data.editable && (
        <p className="text-muted-foreground">
          O responsável pode alterar a seleção após assumir o atendimento.
        </p>
      )}
    </div>
  );
}

export function ConversationDealTransferContext({
  conversationId,
  onChange,
}: {
  conversationId: string;
  onChange: (selection: { dealId: string; expectedVersion: number } | undefined) => void;
}) {
  const { data, error } = useConversationDealContext(conversationId);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setSelected("");
  }, [conversationId]);
  if (!data)
    return <p className="text-xs text-muted-foreground">{error || "Carregando negociação…"}</p>;
  return (
    <label className="block space-y-1 text-xs">
      <span className="font-semibold">Negociação após a transferência</span>
      <select
        aria-label="Negociação após a transferência"
        className="w-full rounded border border-border bg-background p-2"
        value={selected}
        onChange={(event) => {
          setSelected(event.target.value);
          onChange(
            event.target.value
              ? { dealId: event.target.value, expectedVersion: data.version }
              : undefined,
          );
        }}
      >
        <option value="">
          {data.hasCurrentDeal
            ? `Manter: ${data.currentDeal?.title || "negociação atual"}`
            : "Escolha a negociação do atendimento"}
        </option>
        {data.deals.filter(isCurrentDealEligible).map((deal) => (
          <option key={deal.id} value={deal.id}>
            {deal.title}
          </option>
        ))}
      </select>
      <span className="block text-muted-foreground">
        A transferência fica no card de origem. A troca vale para as próximas ações e só é aplicada
        ao concluir a transferência.
      </span>
    </label>
  );
}
