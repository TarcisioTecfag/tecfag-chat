import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

type Candidate = {
  id: string;
  subject?: string;
  sentAt?: string;
  startedAt?: string;
  direction?: string;
  durationSeconds?: number;
  content?: string;
  senderName?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};
type EvidenceData = {
  emails: Candidate[];
  calls: Candidate[];
  whatsapp: Candidate[];
  deal: { status: string; lossReason: string | null } | null;
  tasks: Array<{ id: string; title: string; dueDate: string }>;
};

export function CommercialEvidenceDialog({
  directive,
  onClose,
  onCompleted,
  onOpenDeal,
}: {
  directive: { id: string; dealTitle: string; instruction: string };
  onClose: () => void;
  onCompleted: () => void;
  onOpenDeal: () => void;
}) {
  const [data, setData] = useState<EvidenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<"call" | "email" | "whatsapp">("call");
  const [source, setSource] = useState<"internal_record" | "manual_report">("manual_report");
  const [recordId, setRecordId] = useState("");
  const [messageIds, setMessageIds] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [emailContent, setEmailContent] = useState("");
  const [nextAction, setNextAction] = useState<"" | "won" | "lost" | "continue">("");
  const [nextActionActivityId, setNextActionActivityId] = useState("");
  const [nextTaskTitle, setNextTaskTitle] = useState("");
  const [nextTaskDescription, setNextTaskDescription] = useState("");
  const [nextTaskDueAt, setNextTaskDueAt] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/commercial/directives/${encodeURIComponent(directive.id)}/evidence`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Falha ao buscar registros.");
        return body as EvidenceData;
      })
      .then((body) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Falha ao buscar registros.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [directive.id]);

  const records =
    channel === "call" ? data?.calls : channel === "email" ? data?.emails : data?.whatsapp;
  const channelLabel = channel === "call" ? "ligação" : channel === "email" ? "e-mail" : "mensagem";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/commercial/directives/${encodeURIComponent(directive.id)}/evidence`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel,
            source,
            summary,
            nextAction,
            nextActionActivityId:
              nextActionActivityId === "__new__" ? undefined : nextActionActivityId,
            nextActionTask:
              nextAction === "continue" && nextActionActivityId === "__new__"
                ? {
                    title: nextTaskTitle,
                    description: nextTaskDescription,
                    dueAt: new Date(nextTaskDueAt).toISOString(),
                  }
                : undefined,
            emailContent:
              source === "manual_report" && channel === "email" ? emailContent : undefined,
            callId: source === "internal_record" && channel === "call" ? recordId : undefined,
            emailId: source === "internal_record" && channel === "email" ? recordId : undefined,
            messageIds:
              source === "internal_record" && channel === "whatsapp" ? messageIds : undefined,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao concluir diretriz.");
      onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao concluir diretriz.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Concluir diretriz comercial"
    >
      <div className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
              Evidência comercial
            </p>
            <h2 className="mt-1 text-xl font-extrabold text-foreground">{directive.dealTitle}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{directive.instruction}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {loading ? (
          <div className="flex h-36 items-center justify-center text-primary">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-foreground">
                Canal
                <select
                  value={channel}
                  onChange={(event) => {
                    const next = event.target.value as typeof channel;
                    setChannel(next);
                    if (next === "whatsapp") setSource("internal_record");
                    setRecordId("");
                    setMessageIds([]);
                  }}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                >
                  <option value="call">Ligação</option>
                  <option value="email">E-mail</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </label>
              <label className="text-xs font-bold text-foreground">
                Origem
                <select
                  value={source}
                  disabled={channel === "whatsapp"}
                  onChange={(event) => {
                    setSource(event.target.value as typeof source);
                    setRecordId("");
                    setMessageIds([]);
                  }}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm disabled:opacity-60"
                >
                  <option value="manual_report">Relato manual</option>
                  <option value="internal_record">Registro interno</option>
                </select>
              </label>
            </div>
            {source === "internal_record" && (
              <div>
                <p className="mb-2 text-xs font-bold text-foreground">
                  Selecione{" "}
                  {channel === "whatsapp" ? "as mensagens" : `o registro de ${channelLabel}`}
                </p>
                {!records?.length ? (
                  <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">
                    Nenhum registro interno vinculado a esta negociação. Use um relato manual se a
                    interação ocorreu fora do sistema.
                  </p>
                ) : channel === "whatsapp" ? (
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                    {records.map((item) => (
                      <label
                        key={item.id}
                        className="flex gap-2 rounded-lg p-2 text-xs hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={messageIds.includes(item.id)}
                          onChange={(event) =>
                            setMessageIds((current) =>
                              event.target.checked
                                ? [...current, item.id]
                                : current.filter((id) => id !== item.id),
                            )
                          }
                        />
                        <span>
                          <strong>{item.senderName}</strong> · {item.content?.slice(0, 180)}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <select
                    required
                    value={recordId}
                    onChange={(event) => setRecordId(event.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  >
                    <option value="">Selecionar {channelLabel}</option>
                    {records.map((item) => (
                      <option key={item.id} value={item.id}>
                        {channel === "email"
                          ? `${item.subject}${item.metadata?.source === "manual" ? " · registro lançado manualmente no CRM" : ""}`
                          : `${new Date(item.startedAt || "").toLocaleString("pt-BR")} · ${item.durationSeconds || 0}s`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <label className="block text-xs font-bold text-foreground">
              Resumo do que foi feito
              <textarea
                required
                minLength={3}
                maxLength={2000}
                rows={4}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder={
                  source === "manual_report"
                    ? "Descreva a interação e seu resultado. Este item ficará identificado como relato manual."
                    : "Descreva o resultado do registro selecionado."
                }
                className="mt-1 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              />
            </label>
            <div className="rounded-xl border border-border p-4">
              <label className="block text-xs font-bold text-foreground">
                Próximo passo obrigatório
                <select
                  required
                  value={nextAction}
                  onChange={(event) => {
                    setNextAction(event.target.value as typeof nextAction);
                    setNextActionActivityId("");
                  }}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                >
                  <option value="">Selecionar próximo passo</option>
                  <option value="won">Negociação ganha</option>
                  <option value="lost">Negociação perdida</option>
                  <option value="continue">Continuar com tarefa futura</option>
                </select>
              </label>
              {nextAction === "won" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Status atual no CRM:{" "}
                  {data?.deal?.status === "won"
                    ? "Ganha ✓"
                    : "Ainda não está ganha. Atualize no CRM primeiro."}
                </p>
              )}
              {nextAction === "lost" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {data?.deal?.status === "lost" && data.deal.lossReason
                    ? `Motivo registrado: ${data.deal.lossReason}`
                    : "Registre a perda e o motivo no CRM primeiro."}
                </p>
              )}
              {nextAction === "continue" && (
                <label className="mt-3 block text-xs font-bold text-foreground">
                  Tarefa futura desta negociação
                  <select
                    required
                    value={nextActionActivityId}
                    onChange={(event) => setNextActionActivityId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  >
                    <option value="">Selecionar tarefa</option>
                    <option value="__new__">Criar nova tarefa agora</option>
                    {data?.tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title} · {new Date(task.dueDate).toLocaleString("pt-BR")}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {nextAction === "continue" && nextActionActivityId === "__new__" && (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs font-bold text-foreground">
                    Título da próxima tarefa
                    <input
                      required
                      minLength={3}
                      maxLength={160}
                      value={nextTaskTitle}
                      onChange={(event) => setNextTaskTitle(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs font-bold text-foreground">
                    Prazo futuro
                    <input
                      required
                      type="datetime-local"
                      value={nextTaskDueAt}
                      onChange={(event) => setNextTaskDueAt(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs font-bold text-foreground">
                    Detalhes (opcional)
                    <textarea
                      maxLength={2000}
                      value={nextTaskDescription}
                      onChange={(event) => setNextTaskDescription(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              )}
              {nextAction && (
                <button
                  type="button"
                  onClick={onOpenDeal}
                  className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-bold text-primary"
                >
                  Abrir negociação para registrar próximo passo
                </button>
              )}
            </div>
            {source === "manual_report" && channel === "email" && (
              <label className="block text-xs font-bold text-foreground">
                Conteúdo do e-mail (se disponível)
                <textarea
                  maxLength={20000}
                  rows={4}
                  value={emailContent}
                  onChange={(event) => setEmailContent(event.target.value)}
                  className="mt-1 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                />
              </label>
            )}
            {source === "manual_report" && (
              <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Relato manual, declarado por você. Não será apresentado como chamada, e-mail ou
                mensagem verificados.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-foreground"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  saving ||
                  !nextAction ||
                  (nextAction === "continue" &&
                    (!nextActionActivityId ||
                      (nextActionActivityId === "__new__" &&
                        (nextTaskTitle.trim().length < 3 ||
                          !nextTaskDueAt ||
                          !Number.isFinite(new Date(nextTaskDueAt).getTime()) ||
                          new Date(nextTaskDueAt) <= new Date())))) ||
                  (source === "internal_record" &&
                    (channel === "whatsapp" ? messageIds.length === 0 : !recordId))
                }
                className="rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Concluir com evidência"}
              </button>
            </div>
          </form>
        )}
        {!loading && error && !data && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
