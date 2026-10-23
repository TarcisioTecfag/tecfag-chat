import { useCallback, useEffect, useId, useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { toast } from "sonner";
import { isCurrentDealEligible } from "@/lib/crm/conversation-deal-policy";
import {
  fetchDealContext,
  type ConversationDealContext as Context,
} from "@/lib/crm/conversation-deal-client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Columns3,
  Loader2,
  Lock,
} from "lucide-react";

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

function getHistoricalStatusLabel(status: string, isLinked?: boolean) {
  if (isLinked === false) return "Desvinculada";
  if (status === "won") return "Vendido";
  if (status === "lost") return "Perdido";
  if (status === "paused") return "Pausado";
  return "Histórico";
}

export function ConversationDealContext({
  conversationId,
  onSelected,
  compactWhenSelected = false,
}: {
  conversationId: string;
  onSelected?: (version: number) => void;
  compactWhenSelected?: boolean;
}) {
  const { data, error, refresh } = useConversationDealContext(conversationId);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const selectId = useId();

  if (error)
    return (
      <p role="alert" className="text-xs text-destructive">
        {error}{" "}
        <button onClick={refresh} className="underline cursor-pointer">
          Tentar novamente
        </button>
      </p>
    );
  if (!data)
    return <p className="text-xs text-muted-foreground">Carregando negociação do atendimento…</p>;

  const eligibleDeals = data.deals.filter(isCurrentDealEligible);
  const historicalDeals = data.deals.filter((deal) => !isCurrentDealEligible(deal));
  const needsSelection = !data.hasCurrentDeal && data.editable;

  const handleSelectDeal = async (dealId: string) => {
    if (!dealId || saving || !data.editable) return;
    if (dealId === data.currentDeal?.id) {
      setOpen(false);
      return;
    }
    setOpen(false);
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao selecionar negociação.");
    } finally {
      setSaving(false);
      void refresh();
    }
  };

  const triggerLabel = data.currentDeal?.title
    ? data.currentDeal.title
    : data.hasCurrentDeal
      ? "Negociação selecionada (acesso restrito)"
      : "Selecione uma negociação em andamento";

  return (
    <div
      role={needsSelection ? "alert" : undefined}
      className={`w-full rounded-xl border transition-all text-xs ${
        needsSelection
          ? "border-2 border-red-600/85 bg-red-600/15 dark:border-red-500/85 dark:bg-red-600/20 p-3 shadow-sm space-y-2"
          : compactWhenSelected
            ? "border-primary/25 bg-primary/5 px-3 py-2"
            : "border-primary/25 bg-primary/5 p-2.5 space-y-1.5"
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          {needsSelection ? (
            <div className="flex items-center gap-1.5 font-bold text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <span>
                {eligibleDeals.length > 0
                  ? "Selecione a negociação atual para continuar"
                  : "Nenhuma negociação em andamento disponível"}
              </span>
            </div>
          ) : (
            <label
              className="flex items-center gap-1.5 font-bold text-foreground cursor-pointer"
              htmlFor={selectId}
            >
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span>Negociação deste atendimento</span>
            </label>
          )}
          <p className="text-[11px] text-muted-foreground leading-snug">
            {data.hasCurrentDeal
              ? "Notas e ações serão registradas neste card. Transferências mantêm esta seleção."
              : data.previousDeal
                ? `Última negociação: ${data.previousDeal.title}. Confira o assunto antes de continuar.`
                : "Escolha pelo menu suspenso ou clique no botão \"Escolher essa\" em um dos cards abaixo."}
          </p>
        </div>

        {/* Menu suspenso customizado com Popover + SystemTooltip */}
        <div className="w-full md:w-[380px] lg:w-[440px] shrink-0">
          <Popover open={open} onOpenChange={(next) => !saving && data.editable && setOpen(next)}>
            <SystemTooltip
              content={
                !data.editable
                  ? "Assuma o atendimento para alterar a negociação atual"
                  : data.currentDeal?.title
                    ? `Negociação ativa: ${data.currentDeal.title} (clique para trocar)`
                    : "Clique para escolher a negociação em andamento deste atendimento"
              }
            >
              <PopoverTrigger asChild>
                <button
                  id={selectId}
                  type="button"
                  aria-label="Negociação deste atendimento"
                  disabled={saving || !data.editable}
                  className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                    needsSelection
                      ? "border-red-500/70 bg-card text-foreground hover:border-red-500 shadow-xs ring-2 ring-red-500/15"
                      : "border-border bg-card text-foreground hover:border-primary/50 shadow-2xs"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-red-500" />
                    ) : (
                      <Columns3
                        className={`h-3.5 w-3.5 shrink-0 ${
                          needsSelection ? "text-red-500" : "text-primary"
                        }`}
                      />
                    )}
                    <span
                      className={`truncate ${
                        !data.currentDeal && !data.hasCurrentDeal
                          ? "text-muted-foreground font-medium"
                          : "text-foreground font-bold"
                      }`}
                    >
                      {triggerLabel}
                    </span>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                      needsSelection ? "text-red-500" : "text-muted-foreground"
                    } ${open ? "rotate-180" : ""}`}
                  />
                </button>
              </PopoverTrigger>
            </SystemTooltip>

            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-(--radix-popover-trigger-width) min-w-[320px] max-w-[560px] rounded-2xl border border-border bg-card p-2 text-foreground shadow-2xl z-[10100]"
            >
              <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5 scrollbar-thin">
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-2.5 py-1">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-red-500">
                      Em andamento — disponíveis para seleção
                    </span>
                    <span className="rounded-full bg-red-600/15 px-1.5 py-0.5 text-[9px] font-bold text-red-500">
                      {eligibleDeals.length}
                    </span>
                  </div>

                  {eligibleDeals.length === 0 ? (
                    <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground italic">
                      Nenhuma negociação em andamento vinculada para seleção.
                    </div>
                  ) : (
                    eligibleDeals.map((deal) => {
                      const isSelected = data.currentDeal?.id === deal.id;
                      return (
                        <SystemTooltip
                          key={deal.id}
                          content={`Definir "${deal.title}" como negociação atual`}
                          side="left"
                        >
                          <button
                            type="button"
                            onClick={() => void handleSelectDeal(deal.id)}
                            className={`group w-full flex items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-all cursor-pointer ${
                              isSelected
                                ? "bg-red-600 text-white font-bold shadow-xs"
                                : "text-foreground hover:bg-red-600/12 hover:text-red-500 font-semibold"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span
                                className={`h-2 w-2 rounded-full shrink-0 ${
                                  isSelected ? "bg-white" : "bg-red-500"
                                }`}
                              />
                              <span className="line-clamp-2 leading-snug">{deal.title}</span>
                            </div>
                            {isSelected ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white shrink-0">
                                <Check className="h-3 w-3" />
                                Atual
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-lg bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-2xs group-hover:bg-red-700 transition-colors shrink-0">
                                Escolher essa
                              </span>
                            )}
                          </button>
                        </SystemTooltip>
                      );
                    })
                  )}
                </div>

                {historicalDeals.length > 0 && (
                  <div className="space-y-1 border-t border-border/60 pt-2">
                    <div className="px-2.5 py-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Histórico — não pode ser definido como atual
                      </span>
                    </div>
                    {historicalDeals.map((deal) => (
                      <SystemTooltip
                        key={deal.id}
                        content="Negociações encerradas, pausadas ou desvinculadas não podem ser definidas como negociação atual"
                        side="left"
                      >
                        <div className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs text-muted-foreground/70 bg-muted/20 cursor-not-allowed">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Lock className="h-3 w-3 shrink-0 opacity-60" />
                            <span className="truncate">{deal.title}</span>
                          </div>
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0">
                            {getHistoricalStatusLabel(deal.status, deal.isLinked)}
                          </span>
                        </div>
                      </SystemTooltip>
                    ))}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {!data.editable && (
        <p className="text-[11px] text-muted-foreground">
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
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setSelected("");
  }, [conversationId]);
  if (!data)
    return <p className="text-xs text-muted-foreground">{error || "Carregando negociação…"}</p>;

  const eligibleDeals = data.deals.filter(isCurrentDealEligible);
  const selectedDeal = eligibleDeals.find((d) => d.id === selected);
  const defaultLabel = data.hasCurrentDeal
    ? `Manter: ${data.currentDeal?.title || "negociação atual"}`
    : "Escolha a negociação do atendimento";

  return (
    <div className="block space-y-1.5 text-xs">
      <span className="font-semibold block">Negociação após a transferência</span>
      <Popover open={open} onOpenChange={setOpen}>
        <SystemTooltip content="Defina qual negociação ficará ativa após concluir a transferência">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Negociação após a transferência"
              className="w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-primary/50 transition-colors cursor-pointer"
            >
              <span className="truncate text-left">
                {selectedDeal ? selectedDeal.title : defaultLabel}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>
          </PopoverTrigger>
        </SystemTooltip>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-(--radix-popover-trigger-width) min-w-[280px] rounded-2xl border border-border bg-card p-1.5 text-foreground shadow-2xl z-[10100]"
        >
          <div className="max-h-60 overflow-y-auto space-y-1">
            <button
              type="button"
              onClick={() => {
                setSelected("");
                onChange(undefined);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                selected === ""
                  ? "bg-red-600/15 text-red-500 font-bold"
                  : "text-foreground hover:bg-muted font-medium"
              }`}
            >
              <span className="truncate">{defaultLabel}</span>
              {selected === "" && <Check className="h-3.5 w-3.5 shrink-0 text-red-500" />}
            </button>
            {eligibleDeals.map((deal) => {
              const isSelected = selected === deal.id;
              return (
                <button
                  key={deal.id}
                  type="button"
                  onClick={() => {
                    setSelected(deal.id);
                    onChange({ dealId: deal.id, expectedVersion: data.version });
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-red-600 text-white font-bold"
                      : "text-foreground hover:bg-red-600/12 hover:text-red-500 font-semibold"
                  }`}
                >
                  <span className="line-clamp-2">{deal.title}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <span className="block text-muted-foreground">
        A transferência fica no card de origem. A troca vale para as próximas ações e só é aplicada
        ao concluir a transferência.
      </span>
    </div>
  );
}

