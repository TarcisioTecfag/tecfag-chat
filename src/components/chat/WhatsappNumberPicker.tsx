import { useEffect, useState } from "react";
import { Check, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { useWhatsappConnections, whatsappConnectionAction } from "@/hooks/useWhatsappConnections";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";

export function WhatsappNumberPicker({
  conversationId,
  version,
  connectionId,
  onPrepared,
  onChoosing,
}: {
  conversationId: string;
  version: number;
  connectionId?: string | null;
  onPrepared: (id: string, queueState: string) => Promise<void>;
  onChoosing: (choosing: boolean) => void;
}) {
  const { tenant } = useChat();
  const { enabled, connections, refresh, canSwitchDuringAttendance } =
    useWhatsappConnections(tenant);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(connectionId || "corporate");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => onChoosing(false), [onChoosing]);
  if (!enabled) return null;
  const available = connections.filter(
    (row) => row.enabled && row.canSend === true && row.status === "connected",
  );
  const current = connections.find((row) => row.id === (connectionId || "corporate"));
  const chooseOpen = (value: boolean) => {
    if (busy) return;
    setSelected(connectionId || "corporate");
    setOpen(value);
    onChoosing(value);
    if (value) void refresh().catch(() => toast.error("Não foi possível atualizar os números."));
  };
  return (
    <Popover open={open} onOpenChange={chooseOpen}>
      <SystemTooltip content={`Escolher número de WhatsApp${current ? ` · ${current.name}` : ""}`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Escolher número de WhatsApp"
            className="grid h-8 w-8 md:h-9 md:w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          >
            <Smartphone className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </SystemTooltip>
      <PopoverContent
        align="end"
        className="w-[300px] max-w-[calc(100vw-24px)] space-y-3 rounded-xl p-4"
      >
        <h4 className="text-sm font-bold">Número para este atendimento</h4>
        <div role="radiogroup" aria-label="Números disponíveis" className="space-y-1">
          {available.map((row) => (
            <button
              type="button"
              role="radio"
              aria-checked={selected === row.id}
              key={row.id}
              disabled={busy}
              onClick={() => setSelected(row.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border p-2.5 text-left text-xs ${selected === row.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{row.name}</span>
                <span className="block truncate text-muted-foreground">
                  {row.phone || (row.corporate ? "Número da empresa" : "Número da equipe")}
                </span>
              </span>
              {selected === row.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          ))}
        </div>
        {!available.length && (
          <p className="text-xs text-muted-foreground">
            Nenhum número conectado disponível para o seu acesso.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {canSwitchDuringAttendance
            ? "Como administrador master, você pode escolher outro número sem finalizar. Cada número mantém seu próprio atendimento e responsável."
            : "Salve a escolha e depois capture o atendimento. Para trocar durante um atendimento, finalize-o primeiro."}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => chooseOpen(false)}
            className="rounded-lg border border-border px-3 py-2 text-xs"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !available.some((row) => row.id === selected)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              try {
                const result = await whatsappConnectionAction({
                  action: "prepare",
                  sourceConversationId: conversationId,
                  expectedVersion: version,
                  connectionId: selected,
                });
                await onPrepared(result.conversationId, result.queueState);
                setOpen(false);
                onChoosing(false);
                toast.success(
                  result.queueState === "meus"
                    ? "Conversa do número selecionado aberta."
                    : "Número salvo. Capture o atendimento para iniciar.",
                );
              } catch (cause) {
                toast.error(
                  cause instanceof Error ? cause.message : "Não foi possível salvar o número.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Salvar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
