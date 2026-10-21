import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { JournalSnapshot } from "@/lib/triage/industrial-triage-journal";
import { IndustrialTriageReview } from "./IndustrialTriageReview";
import { SiteContextPanel } from "./SiteContextPanel";
import { buildIndustrialBriefing } from "@/lib/triage/industrial-briefing";

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
const date = (value: string) =>
  new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const button =
  "rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50 disabled:cursor-wait";

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
          { signal: controller.signal },
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
    [query],
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
    <div className="space-y-2 py-2">
      {page.loading && (
        <p className="flex gap-2 items-center text-xs" role="status">
          <Loader2 className="h-3 w-3 animate-spin" />
          Consultando…
        </p>
      )}
      {page.error && (
        <div role="alert">
          <p className="text-xs text-destructive">{page.error}</p>
          <button className={button} onClick={() => void page.load(page.data?.pageInfo.nextCursor)}>
            Tentar novamente
          </button>
        </div>
      )}
      {!page.loading && !page.error && page.data?.items.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum registro disponível.</p>
      )}
      {page.data?.pageInfo.nextCursor && !page.error && (
        <button
          className={button}
          disabled={page.loading}
          onClick={() => void page.load(page.data?.pageInfo.nextCursor)}
        >
          Carregar mais
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
  const conversations = useHistoryPage<Conversation>(
    open,
    new URLSearchParams({ mode: "conversations", q: query }).toString(),
  );
  const cycles = useHistoryPage<Cycle>(
    open && !!conversationId,
    new URLSearchParams({ mode: "cycles", conversationId }).toString(),
  );
  const events = useHistoryPage<Event>(
    open && !!selectedCycle,
    new URLSearchParams({
      mode: "events",
      conversationId,
      cycleId: selectedCycle?.snapshot.cycleId || "",
      refresh: String(revisionNumber),
    }).toString(),
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
      <DialogTrigger asChild>
        <button className={`${button} inline-flex items-center gap-2`}>
          <History className="h-3.5 w-3.5" />
          Histórico e notas
        </button>
      </DialogTrigger>
      <DialogContent className="w-[96vw] max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Histórico da triagem</DialogTitle>
          <DialogDescription>
            Consulte os ciclos e revise a coleta do atendimento atual conforme suas permissões.
            Horários de Brasília.
          </DialogDescription>
        </DialogHeader>
        <div className="grid md:grid-cols-[1fr_1fr_1.6fr] gap-4 min-h-0 overflow-y-auto">
          <section className="space-y-2 md:overflow-y-auto md:max-h-[65vh]">
            <h4 className="font-semibold text-sm">Atendimentos</h4>
            <form
              className="flex gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(search.trim());
              }}
            >
              <input
                aria-label="Buscar atendimento por nome ou telefone"
                placeholder="Nome ou telefone"
                value={search}
                maxLength={100}
                onChange={(event) => setSearch(event.target.value)}
                className="border rounded-md p-2 text-xs min-w-0 flex-1 bg-background"
              />
              <button className={button}>Buscar</button>
            </form>
            <p className="text-xs text-muted-foreground">
              Ordenados pela criação, do mais recente ao mais antigo.
            </p>
            {conversations.data?.items.map((item) => (
              <button
                key={item.id}
                className={`w-full text-left ${button} ${item.id === conversationId ? "bg-primary/10 border-primary" : ""}`}
                onClick={() => selectConversation(item.id)}
              >
                <span className="block font-medium break-words">{item.name}</span>
                <span className="text-muted-foreground">
                  {item.channel === "livechat" ? "Site" : item.channel}
                </span>
              </button>
            ))}
            <PageControls page={conversations} />
          </section>
          <section className="space-y-2 md:overflow-y-auto md:max-h-[65vh]">
            <h4 className="font-semibold text-sm">Ciclos do atendimento</h4>
            {!conversationId && (
              <p className="text-xs text-muted-foreground">Selecione um atendimento.</p>
            )}
            {cycles.data?.items.map((item) => (
              <button
                key={item.snapshot.cycleId}
                onClick={() => setSelectedCycle(item)}
                className={`w-full text-left ${button} ${selectedCycle?.snapshot.cycleId === item.snapshot.cycleId ? "bg-primary/10 border-primary" : ""}`}
              >
                <span className="block font-medium">{date(item.snapshot.startedAt)}</span>
                <span className="block">
                  {item.isCurrent ? "Ciclo atual · " : "Ciclo anterior · "}
                  {item.snapshot.currentStep || item.snapshot.outcome || "Registrado"}
                </span>
                {!item.dataAvailable && (
                  <span className="text-amber-700 dark:text-amber-400">Somente resumo legado</span>
                )}
              </button>
            ))}
            {conversationId && <PageControls page={cycles} />}
          </section>
          <section className="space-y-3 md:overflow-y-auto md:max-h-[65vh]">
            <h4 className="font-semibold text-sm">Dados e notas progressivas</h4>
            {!selectedCycle && (
              <p className="text-xs text-muted-foreground">
                Selecione um ciclo para consultar os dados preservados.
              </p>
            )}
            {selectedCycle && (
              <>
                <SiteContextPanel context={selectedCycle.snapshot.siteContext} />
                {!selectedCycle.isCurrent && selectedCycle.dataAvailable && (
                  <pre className="text-xs font-sans whitespace-pre-wrap break-words rounded-md border p-3">
                    {buildIndustrialBriefing(selectedCycle.snapshot).text}
                  </pre>
                )}
                {selectedCycle.isCurrent && selectedCycle.dataAvailable && (
                  <IndustrialTriageReview
                    key={`${tenantId}:${conversationId}:${selectedCycle.snapshot.cycleId}`}
                    tenantId={tenantId}
                    conversationId={conversationId}
                    cycleId={selectedCycle.snapshot.cycleId}
                    onSaved={(snapshot) => {
                      setSelectedCycle((previous) =>
                        previous ? { ...previous, snapshot } : previous,
                      );
                      setRevisionNumber((previous) => previous + 1);
                    }}
                  />
                )}
                {!selectedCycle.dataAvailable && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    O registro antigo preservou somente um resumo. Os dados completos e as notas
                    dessa época não estão disponíveis.
                  </p>
                )}
                <p className="text-xs">
                  Destino: {selectedCycle.snapshot.targetFunnel || "Ainda não definido"}
                  {selectedCycle.snapshot.responsible &&
                    ` · Responsável: ${selectedCycle.snapshot.responsible.name || selectedCycle.snapshot.responsible.id}`}
                </p>
                {Object.entries(selectedCycle.snapshot.collectedData).length > 0 && (
                  <dl className="rounded-md border divide-y text-xs">
                    {Object.entries(selectedCycle.snapshot.collectedData).map(([key, field]) => (
                      <div key={key} className="p-2">
                        <dt className="font-medium">{key}</dt>
                        <dd className="text-muted-foreground break-words whitespace-pre-wrap">
                          {field.status === "filled" ? field.value : "Aguardando confirmação"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {events.data?.items.map((item) => (
                  <article key={item.id} className="border-l-2 pl-3 py-1">
                    <time className="text-xs text-muted-foreground">{date(item.at)}</time>
                    <p className="text-xs whitespace-pre-wrap break-words mt-1">{item.text}</p>
                  </article>
                ))}
                <PageControls page={events} />
              </>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
