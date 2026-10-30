import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Edit3,
  RefreshCw,
  Save,
  X,
  FileText,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { JournalSnapshot } from "@/lib/triage/industrial-triage-journal";
import { cn } from "@/lib/utils";
import { SystemTooltip } from "@/components/ui/tooltip";

interface Field {
  value: string;
  status: "filled" | "pending";
}
interface ReviewState {
  snapshot: JournalSnapshot;
  revision: string;
  fields: Record<string, Field>;
  access: { editable: boolean; reason: string | null };
  briefing: { text: string; final: boolean };
}

export function IndustrialTriageReview({
  tenantId,
  conversationId,
  cycleId,
  onSaved,
}: {
  tenantId: string;
  conversationId: string;
  cycleId: string;
  onSaved: (snapshot: JournalSnapshot) => void;
}) {
  const [state, setState] = useState<ReviewState | null>(null);
  const formId = useId();
  const [draft, setDraft] = useState<Record<string, Field>>({});
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [showBriefingText, setShowBriefingText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/valentina/triage-review?${new URLSearchParams({ conversationId, cycleId })}`,
        { signal: controller.signal }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao consultar revisão.");
      if (!controller.signal.aborted) {
        setState(result);
        setDraft(result.fields);
        setEditing(false);
        setReason("");
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "Falha ao consultar revisão.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [conversationId, cycleId]);

  useEffect(() => {
    setState(null);
    setEditing(false);
    setReason("");
    void load();
    return () => request.current?.abort();
  }, [load, tenantId]);

  async function save() {
    if (!state || busy) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    const fields = Object.fromEntries(
      Object.entries(draft).filter(
        ([key, field]) => JSON.stringify(field) !== JSON.stringify(state.fields[key])
      )
    );
    try {
      const response = await fetch("/api/valentina/triage-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId,
          cycleId,
          expectedRevision: state.revision,
          fields,
          reason,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar a revisão.");
      if (!controller.signal.aborted) {
        setState(result);
        setDraft(result.fields);
        setEditing(false);
        setReason("");
        setNotice("Revisão registrada com sucesso no histórico.");
        onSaved(result.snapshot);
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "Falha ao salvar revisão.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const fieldEntries = state ? Object.entries(state.fields || {}) : [];
  const filledCount = fieldEntries.filter(
    ([, f]) => f.status === "filled" && f.value && f.value.trim() !== ""
  ).length;

  return (
    <section className="rounded-2xl border border-border bg-card/80 p-4 space-y-3.5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-xl bg-primary/12 border border-primary/25 text-primary">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h5 className="text-xs font-extrabold text-foreground">
                Coleta da Triagem & Revisão Humana
              </h5>
              {state && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                  {filledCount}/{fieldEntries.length} preenchidos
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Dados extraídos na conversa e síntese para encaminhamento
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {state?.briefing?.text && (
            <button
              type="button"
              onClick={() => setShowBriefingText((v) => !v)}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/40 px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <span>Resumo textual</span>
              {showBriefingText ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          )}

          {state?.access.editable && !editing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground shadow-xs hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
            >
              <Edit3 className="h-3 w-3" />
              <span>Revisar dados</span>
            </button>
          )}

          <SystemTooltip content="Atualizar dados do ciclo">
            <button
              type="button"
              disabled={busy}
              onClick={() => void load()}
              className="grid h-7 w-7 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition cursor-pointer"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
            </button>
          </SystemTooltip>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {state && (
        <>
          {/* Visualização em Grade dos Campos quando não está editando */}
          {!editing && fieldEntries.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {fieldEntries.map(([key, field]) => {
                const isFilled =
                  field.status === "filled" &&
                  Boolean(field.value && field.value.trim() && !/aguardando/i.test(field.value));
                return (
                  <div
                    key={key}
                    className={cn(
                      "rounded-xl border px-3 py-2 transition-colors",
                      isFilled
                        ? "border-border/80 bg-muted/25"
                        : "border-border/40 bg-muted/10 opacity-75"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-0.5">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground truncate">
                        {key}
                      </span>
                      {isFilled ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 border border-emerald-500/25 px-1.5 py-0.2 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Coletado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted border border-border px-1.5 py-0.2 text-[9px] font-semibold text-muted-foreground shrink-0">
                          <Clock className="h-2.5 w-2.5" /> Pendente
                        </span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "text-xs break-words",
                        isFilled ? "font-bold text-foreground" : "text-muted-foreground italic"
                      )}
                    >
                      {isFilled ? field.value : "Não informado neste ciclo"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Resumo Textual Expansível (Briefing) */}
          {showBriefingText && state.briefing?.text && (
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <span className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-1">
                Briefing Consolidado
              </span>
              <pre className="text-xs font-sans text-foreground/90 whitespace-pre-wrap break-words max-h-56 overflow-y-auto leading-relaxed">
                {state.briefing.text}
              </pre>
            </div>
          )}

          {!state.access.editable && state.access.reason && (
            <p className="text-[11px] text-muted-foreground">{state.access.reason}</p>
          )}

          {/* Formulário de Revisão / Edição Humana (sem <select> nativo) */}
          {editing && (
            <form
              className="space-y-3 pt-1 border-t border-border/60"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <p className="text-[11px] text-muted-foreground">
                Ajuste os campos coletados abaixo e informe o motivo da revisão para registrar na auditoria do ciclo.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {Object.entries(draft).map(([key, field], index) => {
                  const isFilled = field.status === "filled";
                  return (
                    <div
                      key={key}
                      className="rounded-xl border border-border/80 bg-muted/20 p-2.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label
                          className="text-[10px] font-extrabold uppercase tracking-wider text-foreground truncate"
                          htmlFor={`${formId}-${index}`}
                        >
                          {key}
                        </label>
                        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                [key]: { ...field, status: "filled" },
                              }))
                            }
                            className={cn(
                              "rounded-md px-1.5 py-0.5 text-[9px] font-bold transition cursor-pointer",
                              isFilled
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            Preenchido
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                [key]: { ...field, status: "pending" },
                              }))
                            }
                            className={cn(
                              "rounded-md px-1.5 py-0.5 text-[9px] font-bold transition cursor-pointer",
                              !isFilled
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            Pendente
                          </button>
                        </div>
                      </div>
                      <input
                        id={`${formId}-${index}`}
                        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:border-primary outline-none transition"
                        value={field.value}
                        placeholder="Informe o valor..."
                        maxLength={2000}
                        disabled={busy}
                        onChange={(event) =>
                          setDraft((previous) => ({
                            ...previous,
                            [key]: {
                              ...field,
                              value: event.target.value,
                              status: event.target.value.trim() ? "filled" : field.status,
                            },
                          }))
                        }
                      />
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1">
                <label
                  className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground"
                  htmlFor={`${formId}-reason`}
                >
                  Motivo da revisão humana (obrigatório, mín. 5 caracteres)
                </label>
                <textarea
                  id={`${formId}-reason`}
                  rows={2}
                  placeholder="Ex: Cliente confirmou o CNPJ correto e alterou o modelo desejado..."
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary outline-none transition resize-none"
                  minLength={5}
                  maxLength={1000}
                  required
                  disabled={busy}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setDraft(state.fields);
                    setReason("");
                  }}
                  className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || reason.trim().length < 5}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-90 disabled:opacity-40 transition cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" />
                  Salvar revisão
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
