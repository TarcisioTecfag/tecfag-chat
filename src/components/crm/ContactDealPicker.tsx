import { useEffect, useState } from "react";
import type { ContactDealInput } from "@/lib/crm/contact-deal-input";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

export function ContactDealPicker({
  value,
  onChange,
}: {
  value: ContactDealInput;
  onChange: (value: ContactDealInput) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(value.newDeal ? "new" : "existing");
  const [search, setSearch] = useState("");
  const [deals, setDeals] = useState<Array<{ id: string; title: string }>>([]);
  const [pipelines, setPipelines] = useState<
    Array<{
      id: string;
      name: string;
      stages: Array<{ id: string; name: string; requiredFields?: string[] }>;
    }>
  >([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          mode === "existing"
            ? `/api/crm/deals?limit=20&search=${encodeURIComponent(search)}`
            : "/api/crm/pipelines",
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.error ||
              "NÃ£o foi possÃ­vel carregar negociaÃ§Ãµes. Verifique sua permissÃ£o com um administrador.",
          );
        if (mode === "existing") setDeals(data.deals || []);
        else setPipelines(data.pipelines || []);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Falha ao carregar opÃ§Ãµes.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [mode, search]);
  const draft = value.newDeal || { title: "", pipelineId: "", stageId: "" };
  const stages = pipelines.find((p) => p.id === draft.pipelineId)?.stages || [];
  const inputClass = "w-full rounded-lg border border-border bg-background p-2 text-xs";
  return (
    <fieldset className="space-y-2 rounded-xl border border-primary/25 p-3">
      <legend className="px-1 text-xs font-semibold">NegociaÃ§Ã£o obrigatÃ³ria</legend>
      <p className="text-xs text-muted-foreground">
        Todo contato e atendimento precisa de pelo menos uma negociaÃ§Ã£o. Vincule uma existente ou
        crie uma para continuar.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={mode === "existing"}
          className={
            mode === "existing" ? "text-xs font-bold text-primary" : "text-xs text-muted-foreground"
          }
          onClick={() => {
            setMode("existing");
            onChange({});
          }}
        >
          Vincular existente
        </button>
        <button
          type="button"
          aria-pressed={mode === "new"}
          className={
            mode === "new" ? "text-xs font-bold text-primary" : "text-xs text-muted-foreground"
          }
          onClick={() => {
            setMode("new");
            onChange({ newDeal: { title: "", pipelineId: "", stageId: "" } });
          }}
        >
          Criar nova
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {mode === "existing" ? (
        <>
          <input
            aria-label="Buscar negociaÃ§Ã£o"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por tÃ­tulo"
            className={inputClass}
          />
          <select
            required
            aria-label="NegociaÃ§Ã£o existente"
            value={value.dealId || ""}
            onChange={(e) => onChange({ dealId: e.target.value })}
            className={inputClass}
          >
            <option value="">{loading ? "Carregando..." : "Selecione a negociaÃ§Ã£o"}</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <input
            required
            aria-label="TÃ­tulo da nova negociaÃ§Ã£o"
            placeholder="TÃ­tulo da negociaÃ§Ã£o"
            className={inputClass}
            value={draft.title}
            onChange={(e) => onChange({ newDeal: { ...draft, title: e.target.value } })}
          />
          <select
            required
            aria-label="Funil da nova negociaÃ§Ã£o"
            className={inputClass}
            value={draft.pipelineId}
            onChange={(e) =>
              onChange({
                newDeal: { ...draft, pipelineId: e.target.value, stageId: "", customFields: {} },
              })
            }
          >
            <option value="">Selecione o funil</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            required
            aria-label="Etapa da nova negociaÃ§Ã£o"
            className={inputClass}
            value={draft.stageId}
            onChange={(e) => onChange({ newDeal: { ...draft, stageId: e.target.value } })}
          >
            <option value="">Selecione a etapa</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {draft.pipelineId && (
            <CustomFieldsEditor
              entity="deal"
              pipelineId={draft.pipelineId}
              values={draft.customFields || {}}
              onChange={(customFields) => onChange({ newDeal: { ...draft, customFields } })}
              create
              requiredIds={stages.find((s) => s.id === draft.stageId)?.requiredFields || []}
            />
          )}
        </>
      )}
    </fieldset>
  );
}
