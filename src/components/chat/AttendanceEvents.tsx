import { useCallback, useEffect, useRef, useState } from "react";
import { attendanceEventLabels, type AttendanceEventDTO } from "@/lib/attendance-event-types";

export function AttendanceEvents({ conversationId }: { conversationId: string }) {
  const [events, setEvents] = useState<AttendanceEventDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const load = useCallback(
    async (next?: string, refresh = false) => {
      if (pending.current) return;
      pending.current = true;
      setLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch(
          `${import.meta.env.VITE_BACKEND_URL || ""}/api/chats/${encodeURIComponent(conversationId)}/events${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Falha ao carregar eventos.");
        if (controller.signal.aborted) return;
        setEvents((old) =>
          refresh
            ? [
                ...data.events,
                ...old.filter(
                  (existing) =>
                    !data.events.some((item: AttendanceEventDTO) => item.id === existing.id),
                ),
              ]
            : next
              ? [
                  ...old,
                  ...data.events.filter(
                    (item: AttendanceEventDTO) => !old.some((existing) => existing.id === item.id),
                  ),
                ]
              : data.events,
        );
        if (!refresh) setCursor(data.nextCursor);
        setError(undefined);
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "Falha ao carregar eventos.");
      } finally {
        if (abortRef.current === controller) {
          pending.current = false;
          if (!controller.signal.aborted) setLoading(false);
        }
      }
    },
    [conversationId],
  );
  useEffect(() => {
    void load();
    const refresh = () => {
      if (!document.hidden) void load(undefined, true);
    };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => {
      abortRef.current?.abort();
      pending.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  // A atualização explícita retorna aos eventos recentes; as demais páginas continuam acessíveis.
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-[10px] font-bold text-muted-foreground uppercase">
          Linha do tempo
        </span>
        <button
          className="text-xs text-primary underline disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
        >
          Atualizar
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive mb-2">
          {error}
        </p>
      )}
      <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin">
        <ol className="relative border-l border-line ml-2 pl-4 space-y-3">
          {events.map((event) => (
            <li key={event.id} className="rounded-xl border border-line bg-muted/40 p-3 space-y-1">
              <p className="text-xs font-bold">
                {attendanceEventLabels[event.eventType] || "Ação no atendimento"}
              </p>
              <p className="text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
                {event.description}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {event.actorName} · {new Date(event.createdAt).toLocaleString("pt-BR")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {event.legacy
                  ? "Histórico anterior"
                  : event.pendingBinding
                    ? "Sem negociação definida neste atendimento"
                    : event.dealId
                      ? "Registrado também no card vinculado à ação"
                      : "Destino histórico indisponível"}
              </p>
            </li>
          ))}
        </ol>
        {!events.length && !loading && !error && (
          <p className="text-center py-12 text-xs text-muted-foreground">
            Nenhum evento registrado neste atendimento.
          </p>
        )}
        {loading && (
          <p role="status" className="text-xs p-3">
            Carregando eventos…
          </p>
        )}
        {cursor && (
          <button
            disabled={loading}
            className="w-full text-xs text-primary p-3 underline"
            onClick={() => void load(cursor)}
          >
            Carregar eventos anteriores
          </button>
        )}
      </div>
    </div>
  );
}
