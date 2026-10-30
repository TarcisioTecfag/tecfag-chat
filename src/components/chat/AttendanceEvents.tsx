import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { attendanceEventLabels, type AttendanceEventDTO } from "@/lib/attendance-event-types";

function renderAttendanceEventDescription(raw?: string | null) {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\(sent\)/gi, "(enviada)")
    .replace(/\(delivered\)/gi, "(entregue)")
    .replace(/\(read\)/gi, "(lida)")
    .replace(/\(received\)/gi, "(recebida)");

  const mediaMatch = cleaned.match(/^(.*?)\[MEDIA:(image|video|audio|document|sticker)\]([^\s:]+)(?::([^\n]+))?(?:\n([\s\S]*))?$/i);
  if (!mediaMatch) {
    return (
      <p className="text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
        {cleaned}
      </p>
    );
  }

  const [, prefix, rawType, messageId, extraName, caption] = mediaMatch;
  const type = rawType.toLowerCase();
  const mediaUrl = `/api/baileys/media?messageId=${encodeURIComponent(messageId)}`;
  const fileName = (extraName || "arquivo").trim();

  return (
    <div className="space-y-1.5">
      {prefix && prefix.trim() && (
        <p className="text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
          {prefix.trim()}
        </p>
      )}
      {(type === "image" || type === "sticker") && (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block max-w-full overflow-hidden rounded-lg border border-border bg-muted/20 hover:border-primary/50 transition-colors"
        >
          <img
            src={mediaUrl}
            alt={fileName}
            className="max-h-36 max-w-full object-contain rounded-lg block"
            loading="lazy"
          />
        </a>
      )}
      {type === "audio" && (
        <audio controls preload="metadata" src={mediaUrl} className="h-8 w-full max-w-[260px]" />
      )}
      {type === "video" && (
        <video
          controls
          preload="metadata"
          src={mediaUrl}
          className="max-h-44 max-w-full rounded-lg border border-border bg-black/5"
        />
      )}
      {type === "document" && (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 max-w-xs">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-bold text-foreground">{fileName}</p>
            <p className="text-[9px] text-muted-foreground uppercase font-semibold">Arquivo</p>
          </div>
          <SystemTooltip content="Baixar arquivo">
            <a
              href={mediaUrl}
              download={fileName}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          </SystemTooltip>
        </div>
      )}
      {caption && caption.trim() && (
        <p className="text-[11px] whitespace-pre-wrap break-words text-foreground/90">
          {caption.trim()}
        </p>
      )}
    </div>
  );
}

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
              {renderAttendanceEventDescription(event.description)}
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
