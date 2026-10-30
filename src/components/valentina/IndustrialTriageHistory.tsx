import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  History,
  Loader2,
  Search,
  X,
  MessageSquare,
  Globe,
  CheckCircle2,
  Clock,
  ArrowRightLeft,
  AlertCircle,
  PlayCircle,
  UserCheck,
  Layers,
  CalendarClock,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SystemTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { JournalSnapshot } from "@/lib/triage/industrial-triage-journal";
import { IndustrialTriageReview } from "./IndustrialTriageReview";
import { SiteContextPanel } from "./SiteContextPanel";
import { VtexEvidencePanel } from "./VtexEvidencePanel";
import { buildIndustrialBriefing } from "@/lib/triage/industrial-briefing";
import { formatSystemAnnotation } from "@/lib/triage/format-system-annotation";

interface Page<T> {
  items: T[];
  pageInfo: { nextCursor: string | null; asOf: string };
}
interface Conversation {
  id: string;
  name: string;
  channel: string;
}
interface Cycle {
  snapshot: JournalSnapshot;
  source: string;
  isCurrent: boolean;
  dataAvailable: boolean;
}
interface Event {
  id: string;
  text: string;
  at: string;
  snapshot: JournalSnapshot | null;
}

const formatBrtDateTime = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

function getCycleStatusMeta(snapshot: JournalSnapshot) {
  const outcome = (snapshot.outcome || "").toLowerCase();
  const step = (snapshot.currentStep || "").toLowerCase();

  if (outcome === "transferred" || step.includes("transfer")) {
    return {
      label: "Transferido",
      badgeClass: "bg-sky-500/12 text-sky-600 dark:text-sky-400 border-sky-500/25",
      icon: ArrowRightLeft,
    };
  }
  if (outcome === "completed" || step.includes("conclu")) {
    return {
      label: "Concluído",
      badgeClass: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
      icon: CheckCircle2,
    };
  }
  if (outcome === "abandoned" || step.includes("sem resposta")) {
    return {
      label: "Sem Resposta",
      badgeClass: "bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25",
      icon: Clock,
    };
  }
  if (outcome === "stopped") {
    return {
      label: "Interrompido",
      badgeClass: "bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/25",
      icon: AlertCircle,
    };
  }
  return {
    label: snapshot.currentStep || "Em Qualificação",
    badgeClass: "bg-primary/12 text-primary border-primary/25",
    icon: PlayCircle,
  };
}

function useHistoryPage<T>(enabled: boolean, query: string) {
  const [data, setData] = useState<Page<T> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor?: string | null) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/valentina/triage-history?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          { signal: controller.signal }
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Não foi possível consultar o histórico.");
        if (!controller.signal.aborted)
          setData((previous) => ({
            ...result,
            items: cursor ? [...(previous?.items || []), ...result.items] : result.items,
          }));
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Falha na consulta.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [query]
  );
  useEffect(() => {
    request.current?.abort();
    setData(null);
    setError("");
    setLoading(false);
    if (enabled) void load();
    return () => request.current?.abort();
  }, [enabled, load]);
  return { data, error, loading, load };
}

function PageControls({ page }: { page: ReturnType<typeof useHistoryPage<unknown>> }) {
  return (
    <div className="space-y-2 py-1.5">
      {page.loading && (
        <p className="flex gap-2 items-center justify-center py-3 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          Carregando registros…
        </p>
      )}
      {page.error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-2.5 space-y-2">
          <p className="text-xs text-destructive font-semibold">{page.error}</p>
          <button
            type="button"
            className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-bold hover:bg-muted transition cursor-pointer"
            onClick={() => void page.load(page.data?.pageInfo.nextCursor)}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {!page.loading && !page.error && page.data?.items.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/15 px-3 py-6 text-center">
          <p className="text-xs font-medium text-muted-foreground">Nenhum registro encontrado.</p>
        </div>
      )}
      {page.data?.pageInfo.nextCursor && !page.error && (
        <button
          type="button"
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-muted/60 disabled:opacity-50 transition cursor-pointer"
          disabled={page.loading}
          onClick={() => void page.load(page.data?.pageInfo.nextCursor)}
        >
          Carregar mais registros
        </button>
      )}
    </div>
  );
}

export function IndustrialTriageHistory({
  tenantId,
  initialConversationId,
}: {
  tenantId: string;
  initialConversationId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [selectedCycle, setSelectedCycle] = useState<Cycle | null>(null);
  const [revisionNumber, setRevisionNumber] = useState(0);

  // Debounce automático na busca
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const conversations = useHistoryPage<Conversation>(
    open,
    new URLSearchParams({ mode: "conversations", q: query }).toString()
  );
  const cycles = useHistoryPage<Cycle>(
    open && !!conversationId,
    new URLSearchParams({ mode: "cycles", conversationId }).toString()
  );
  const events = useHistoryPage<Event>(
    open && !!selectedCycle,
    new URLSearchParams({
      mode: "events",
      conversationId,
      cycleId: selectedCycle?.snapshot.cycleId || "",
      refresh: String(revisionNumber),
    }).toString()
  );

  useEffect(() => {
    setOpen(false);
    setSelectedCycle(null);
    setConversationId("");
    setSearch("");
    setQuery("");
  }, [tenantId]);

  function selectConversation(id: string) {
    setConversationId(id);
    setSelectedCycle(null);
  }

  // Auto-seleciona o 1º atendimento quando abrir sem atendimento pré-selecionado
  useEffect(() => {
    if (!open) return;
    const list = conversations.data?.items || [];
    if (list.length > 0 && !conversationId) {
      selectConversation(list[0].id);
    }
  }, [open, conversations.data, conversationId]);

  // Auto-seleciona o ciclo atual (mais recente) assim que os ciclos do atendimento carregarem
  useEffect(() => {
    if (!open || !conversationId) return;
    const cycleList = cycles.data?.items || [];
    if (cycleList.length > 0 && !selectedCycle) {
      const currentOrLatest = cycleList.find((c) => c.isCurrent) || cycleList[0];
      setSelectedCycle(currentOrLatest);
    }
  }, [open, conversationId, cycles.data, selectedCycle]);

  const selectedConversationObj = useMemo(
    () => conversations.data?.items.find((c) => c.id === conversationId) || null,
    [conversations.data, conversationId]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          selectConversation(initialConversationId || "");
        }
      }}
    >
      <SystemTooltip content="Consultar histórico de ciclos, dados coletados e auditoria da triagem">
        <DialogTrigger asChild>
          <button
            type="button"
            className="px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border border-border bg-card text-foreground hover:bg-muted/60 cursor-pointer shadow-soft"
          >
            <History className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">Histórico e notas</span>
          </button>
        </DialogTrigger>
      </SystemTooltip>

      <DialogContent className="w-[96vw] max-w-6xl max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0 rounded-3xl border border-border bg-card shadow-2xl">
        {/* Header do Modal */}
        <DialogHeader className="px-6 py-4 border-b border-border/80 bg-muted/15 shrink-0">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/12 border border-primary/25 text-primary shrink-0">
                <History className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-extrabold text-foreground">
                  Histórico e Auditoria da Triagem
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Inspecione ciclos de atendimento, revise dados coletados pela IA e acompanhe os eventos progressivos (Horário de Brasília).
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Corpo em 3 Colunas */}
        <div className="grid md:grid-cols-[270px_260px_1fr] divide-y md:divide-y-0 md:divide-x divide-border/70 min-h-0 flex-1 overflow-hidden">
          {/* ── COLUNA 1: ATENDIMENTOS ─────────────────────────────────────────── */}
          <section className="flex flex-col min-h-0 bg-muted/5">
            <div className="p-3.5 border-b border-border/60 space-y-2.5 shrink-0">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                  1. Atendimentos
                </h4>
                {conversations.data?.items && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                    {conversations.data.items.length}
                  </span>
                )}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setQuery(search.trim());
                }}
                className="relative flex items-center"
              >
                <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-3 pointer-events-none" />
                <input
                  aria-label="Buscar atendimento por nome ou telefone"
                  placeholder="Buscar por nome ou telefone..."
                  value={search}
                  maxLength={100}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full rounded-xl border border-border bg-background pl-8 pr-8 py-2 text-xs font-medium text-foreground placeholder:text-muted-foreground focus:border-primary outline-none transition"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setQuery("");
                    }}
                    className="absolute right-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </form>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              {conversations.data?.items.map((item) => {
                const isSelected = item.id === conversationId;
                const isSite = item.channel === "livechat" || item.channel === "site";
                const initials = (item.name || "CL")
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0])
                  .join("")
                  .toUpperCase();

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectConversation(item.id)}
                    className={cn(
                      "w-full text-left rounded-2xl border p-2.5 transition-all cursor-pointer flex items-center gap-2.5",
                      isSelected
                        ? "bg-primary/12 border-primary/40 shadow-xs"
                        : "bg-card border-border/60 hover:bg-muted/50 hover:border-border"
                    )}
                  >
                    <div
                      className={cn(
                        "grid h-8 w-8 place-items-center rounded-full text-[10px] font-extrabold shrink-0 border",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-border"
                      )}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-xs truncate",
                          isSelected ? "font-extrabold text-primary" : "font-bold text-foreground"
                        )}
                      >
                        {item.name}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.2 text-[9px] font-bold border",
                            isSite
                              ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          )}
                        >
                          {isSite ? (
                            <>
                              <Globe className="h-2.5 w-2.5" /> Site
                            </>
                          ) : (
                            <>
                              <MessageSquare className="h-2.5 w-2.5" /> WhatsApp
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
              <PageControls page={conversations} />
            </div>
          </section>

          {/* ── COLUNA 2: CICLOS DO ATENDIMENTO ────────────────────────────────── */}
          <section className="flex flex-col min-h-0 bg-muted/5">
            <div className="p-3.5 border-b border-border/60 shrink-0">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                  2. Ciclos da Triagem
                </h4>
                {cycles.data?.items && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                    {cycles.data.items.length}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {selectedConversationObj
                  ? selectedConversationObj.name
                  : "Selecione um atendimento ao lado"}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {!conversationId && (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/15 px-3 py-8 text-center">
                  <p className="text-xs text-muted-foreground">
                    Selecione um atendimento na coluna à esquerda.
                  </p>
                </div>
              )}

              {cycles.data?.items.map((item, idx) => {
                const isSelected = selectedCycle?.snapshot.cycleId === item.snapshot.cycleId;
                const statusMeta = getCycleStatusMeta(item.snapshot);
                const StatusIcon = statusMeta.icon;

                return (
                  <button
                    key={item.snapshot.cycleId}
                    type="button"
                    onClick={() => setSelectedCycle(item)}
                    className={cn(
                      "w-full text-left rounded-2xl border p-3 transition-all cursor-pointer space-y-2",
                      isSelected
                        ? "bg-primary/12 border-primary/45 shadow-xs"
                        : "bg-card border-border/60 hover:bg-muted/50 hover:border-border"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider border",
                          item.isCurrent
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted text-muted-foreground border-border"
                        )}
                      >
                        {item.isCurrent ? "Ciclo Atual" : `Ciclo #${cycles.data!.items.length - idx}`}
                      </span>

                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold border",
                          statusMeta.badgeClass
                        )}
                      >
                        <StatusIcon className="h-2.5 w-2.5" />
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-foreground tabular-nums">
                        <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {formatBrtDateTime(item.snapshot.startedAt)}
                      </span>
                      {item.snapshot.targetFunnel && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                          <Layers className="h-3 w-3 text-primary shrink-0" />
                          Funil: <strong className="text-foreground">{item.snapshot.targetFunnel}</strong>
                        </span>
                      )}
                    </div>

                    {!item.dataAvailable && (
                      <span className="inline-block rounded-md bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        Somente resumo legado
                      </span>
                    )}
                  </button>
                );
              })}
              {conversationId && <PageControls page={cycles} />}
            </div>
          </section>

          {/* ── COLUNA 3: DOSSIÊ DO CICLO, REVISÃO E LINHA DO TEMPO ────────────── */}
          <section className="flex flex-col min-h-0 bg-card">
            <div className="p-3.5 border-b border-border/60 shrink-0 flex items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                  3. Dossiê do Ciclo & Linha do Tempo
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {selectedCycle
                    ? `Iniciado em ${formatBrtDateTime(selectedCycle.snapshot.startedAt)}`
                    : "Selecione um ciclo para visualizar os detalhes"}
                </p>
              </div>
              {selectedCycle && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-bold border",
                    getCycleStatusMeta(selectedCycle.snapshot).badgeClass
                  )}
                >
                  {getCycleStatusMeta(selectedCycle.snapshot).label}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {!selectedCycle && (
                <div className="rounded-2xl border border-dashed border-border/70 bg-muted/15 px-4 py-12 text-center">
                  <Sparkles className="h-6 w-6 text-primary mx-auto mb-2 opacity-70" />
                  <p className="text-xs font-semibold text-muted-foreground">
                    Selecione um atendimento e um ciclo para inspecionar os dados coletados e as notas progressivas.
                  </p>
                </div>
              )}

              {selectedCycle && (
                <>
                  {/* Cards Executivos de Resumo Rápido */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                      <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                        <Layers className="h-3 w-3 text-primary" /> Destino / Funil
                      </span>
                      <p className="text-xs font-extrabold text-foreground mt-1 truncate">
                        {selectedCycle.snapshot.targetFunnel || "Ainda não definido"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                      <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                        <UserCheck className="h-3 w-3 text-primary" /> Responsável
                      </span>
                      <p className="text-xs font-extrabold text-foreground mt-1 truncate">
                        {selectedCycle.snapshot.responsible?.name ||
                          selectedCycle.snapshot.responsible?.id ||
                          "Triagem Automática"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 col-span-2 sm:col-span-1">
                      <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                        <Clock className="h-3 w-3 text-primary" /> Última Atualização
                      </span>
                      <p className="text-xs font-extrabold text-foreground mt-1 tabular-nums truncate">
                        {formatBrtDateTime(
                          selectedCycle.snapshot.completedAt ||
                            selectedCycle.snapshot.lastInteractionAt ||
                            selectedCycle.snapshot.startedAt
                        )}
                      </p>
                    </div>
                  </div>

                  <SiteContextPanel context={selectedCycle.snapshot.siteContext} />
                  <VtexEvidencePanel evidence={selectedCycle.snapshot.vtexLookup} />

                  {/* Revisão Humana (Ciclo Atual) ou Dados do Ciclo Anterior */}
                  {selectedCycle.isCurrent && selectedCycle.dataAvailable && (
                    <IndustrialTriageReview
                      key={`${tenantId}:${conversationId}:${selectedCycle.snapshot.cycleId}`}
                      tenantId={tenantId}
                      conversationId={conversationId}
                      cycleId={selectedCycle.snapshot.cycleId}
                      onSaved={(snapshot) => {
                        setSelectedCycle((previous) =>
                          previous ? { ...previous, snapshot } : previous
                        );
                        setRevisionNumber((previous) => previous + 1);
                      }}
                    />
                  )}

                  {!selectedCycle.isCurrent && selectedCycle.dataAvailable && (
                    <div className="rounded-2xl border border-border bg-card/80 p-4 space-y-3 shadow-xs">
                      <h5 className="text-xs font-extrabold text-foreground">
                        Dados Coletados no Ciclo Anterior
                      </h5>
                      {Object.entries(selectedCycle.snapshot.collectedData).length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {Object.entries(selectedCycle.snapshot.collectedData).map(
                            ([key, field]) => {
                              const isFilled =
                                field.status === "filled" && Boolean(field.value?.trim());
                              return (
                                <div
                                  key={key}
                                  className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2"
                                >
                                  <span className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                                    {key}
                                  </span>
                                  <span className="text-xs font-bold text-foreground break-words">
                                    {isFilled ? field.value : "Não informado"}
                                  </span>
                                </div>
                              );
                            }
                          )}
                        </div>
                      ) : (
                        <pre className="text-xs font-sans whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-muted/20 p-3">
                          {buildIndustrialBriefing(selectedCycle.snapshot).text}
                        </pre>
                      )}
                    </div>
                  )}

                  {!selectedCycle.dataAvailable && (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
                      Este ciclo antigo preservou apenas o resumo básico. Os campos detalhados não estão disponíveis para edição.
                    </div>
                  )}

                  {/* Linha do Tempo de Eventos Progressivos */}
                  <div className="space-y-2.5 pt-1">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                        Linha do Tempo do Ciclo
                      </h5>
                      {events.data?.items && (
                        <span className="text-[10px] font-bold text-muted-foreground">
                          {events.data.items.length} evento(s)
                        </span>
                      )}
                    </div>

                    <div className="relative pl-4 border-l-2 border-border/70 space-y-2.5">
                      {events.data?.items.map((item) => {
                        const formatted = formatSystemAnnotation(item.text);
                        const isTransfer = /transfer|encaminhad/i.test(formatted.badgeTitle);
                        const isClosed = /encerrad|sem resposta|conclu/i.test(formatted.badgeTitle);

                        return (
                          <article
                            key={item.id}
                            className="relative rounded-2xl border border-border/80 bg-muted/25 px-3.5 py-2.5 space-y-1.5 transition hover:border-border"
                          >
                            <span
                              className={cn(
                                "absolute -left-[21px] top-3.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                                isTransfer
                                  ? "bg-sky-500"
                                  : isClosed
                                  ? "bg-amber-500"
                                  : "bg-primary"
                              )}
                            />
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider border",
                                  isTransfer
                                    ? "bg-sky-500/12 text-sky-600 dark:text-sky-400 border-sky-500/25"
                                    : isClosed
                                    ? "bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25"
                                    : "bg-primary/12 text-primary border-primary/25"
                                )}
                              >
                                {formatted.badgeTitle}
                              </span>
                              <time className="text-[10px] font-semibold text-muted-foreground tabular-nums">
                                {formatBrtDateTime(item.at)}
                              </time>
                            </div>
                            {formatted.isSingleLine ? (
                              <p className="text-xs text-foreground/90 break-words">
                                {formatted.singleLineText}
                              </p>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-xs pt-0.5">
                                {formatted.items.map((field, idx) => (
                                  <div
                                    key={`${field.label}-${idx}`}
                                    className={field.fullWidth ? "sm:col-span-2" : ""}
                                  >
                                    <span className="font-semibold text-muted-foreground">
                                      {field.label}:{" "}
                                    </span>
                                    <span className="font-bold text-foreground break-words">
                                      {field.value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                    <PageControls page={events} />
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
