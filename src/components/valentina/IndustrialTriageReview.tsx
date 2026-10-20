import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { JournalSnapshot } from "@/lib/triage/industrial-triage-journal";

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
const button = "border rounded-md px-3 py-2 text-xs hover:bg-muted disabled:opacity-50";
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
        { signal: controller.signal },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao consultar revisão.");
      if (!controller.signal.aborted) {
        setState(result);
        setDraft(result.fields);
        setEditing(false);
        setReason("");
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : "Falha ao consultar revisão.");
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
        ([key, field]) => JSON.stringify(field) !== JSON.stringify(state.fields[key]),
      ),
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
        setNotice("Revisão registrada no histórico.");
        onSaved(result.snapshot);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : "Falha ao salvar revisão.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="rounded-md border p-3 space-y-3">
      <div className="flex justify-between gap-2 items-center">
        <h5 className="text-sm font-semibold">Briefing e revisão humana</h5>
        <button className={button} disabled={busy} onClick={() => void load()}>
          Atualizar
        </button>
      </div>
      {busy && (
        <p className="text-xs" role="status">
          Processando…
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
          {notice}
        </p>
      )}
      {state && (
        <>
          <pre className="text-xs font-sans whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
            {state.briefing.text}
          </pre>
          {!state.access.editable && (
            <p className="text-xs text-muted-foreground">{state.access.reason}</p>
          )}
          {state.access.editable && !editing && (
            <button className={button} disabled={busy} onClick={() => setEditing(true)}>
              Revisar dados
            </button>
          )}
          {editing && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <p className="text-xs text-muted-foreground">
                Corrija os dados coletados e registre o motivo. Para alterar o cadastro do contato,
                use a tela de Contatos.
              </p>
              {Object.entries(draft).map(([key, field], index) => (
                <div key={key} className="space-y-1">
                  <label className="block text-xs font-medium" htmlFor={`${formId}-${index}`}>
                    {key}
                  </label>
                  <textarea
                    id={`${formId}-${index}`}
                    className="w-full border rounded p-2 bg-background text-xs"
                    value={field.value}
                    maxLength={2000}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        [key]: { ...field, value: event.target.value },
                      }))
                    }
                  />
                  <select
                    aria-label={`Situação de ${key}`}
                    className="border rounded p-1 bg-background text-xs"
                    disabled={busy}
                    value={field.status}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        [key]: { ...field, status: event.target.value as Field["status"] },
                      }))
                    }
                  >
                    <option value="pending">Pendente / a conferir</option>
                    <option value="filled">Preenchido</option>
                  </select>
                </div>
              ))}
              <label className="block text-xs font-medium" htmlFor={`${formId}-reason`}>
                Motivo ou observação da revisão
              </label>
              <textarea
                id={`${formId}-reason`}
                className="w-full border rounded p-2 bg-background text-xs"
                minLength={5}
                maxLength={1000}
                required
                disabled={busy}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="flex gap-2">
                <button className={button} disabled={busy || reason.trim().length < 5}>
                  Salvar revisão
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setDraft(state.fields);
                    setReason("");
                  }}
                >
                  Cancelar edição
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
