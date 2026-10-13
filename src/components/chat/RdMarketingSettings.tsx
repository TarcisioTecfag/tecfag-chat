import { useEffect, useState } from "react";
import { Copy, Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  availablePaths,
  attributionForLead,
  conversionForLead,
  defaultMappings,
  extractLeads,
  standardTargets,
  type FlowSettings,
  type Mapping,
} from "@/lib/rd-marketing/mapping";

type Field = {
  id: string;
  name: string;
  fieldType: string;
  options: { id: string; label: string }[];
};
type Options = {
  pipelines: { id: string; name: string }[];
  stages: { id: string; name: string; pipelineId: string }[];
  owners: { id: string; name: string }[];
  fields: Record<"contact" | "company" | "deal", Field[]>;
};
type Flow = { id: string; settings: FlowSettings };
type Log = {
  id: string;
  flowId: string;
  status: string;
  dealId?: string;
  message: string;
  createdAt: string;
};
type PreviewResult = Record<"contact" | "company" | "deal", Record<string, unknown>>;
const blank = (): FlowSettings => ({
  name: "",
  enabled: false,
  pipelineId: "",
  stageId: "",
  operatorId: null,
  deduplication: "event",
  eventIdPath: "rd_conversion.id",
  attributionConversion: "last",
  campaignFromFlow: false,
  requireAttribution: true,
  mappings: defaultMappings.map((m) => ({ ...m })),
});
const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const sample = JSON.stringify(
  {
    leads: [
      {
        uuid: "lead-exemplo",
        name: "Contato de exemplo",
        email: "contato@example.com",
        mobile_phone: "11999990000",
        cf_produto: "Produto de interesse",
        first_conversion: {
          conversion_origin: { source: "Google", campaign: "Notebooks outubro" },
        },
        last_conversion: {
          created_at: "2026-10-13T10:00:00-03:00",
          content: { identificador: "pedido-de-orcamento" },
          conversion_origin: { source: "E-mail", campaign: "Oferta de outubro" },
        },
      },
    ],
  },
  null,
  2,
);

export function RdMarketingSettings({ tenant }: { tenant: string }) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [id, setId] = useState("");
  const [form, setForm] = useState<FlowSettings>(blank);
  const [url, setUrl] = useState("");
  const [payload, setPayload] = useState(sample);
  const [preview, setPreview] = useState<PreviewResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function load(signal?: AbortSignal) {
    const response = await fetch("/api/settings/rd-marketing", { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setFlows(data.flows);
    setLogs(data.logs);
    setOptions(data.options);
  }
  useEffect(() => {
    const controller = new AbortController();
    setOptions(null);
    setFlows([]);
    setLogs([]);
    setId("");
    setForm(blank());
    setUrl("");
    setPreview(null);
    setLoadError("");
    setPayload(sample);
    load(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setLoadError(error.message);
    });
    return () => controller.abort();
  }, [tenant]);

  const change = (patch: Partial<FlowSettings>) => {
    setForm((old) => ({ ...old, ...patch }));
    setPreview(null);
  };
  const changeMapping = (index: number, patch: Partial<Mapping>) =>
    change({
      mappings: form.mappings.map((mapping, i) =>
        i === index ? { ...mapping, ...patch } : mapping,
      ),
    });
  async function perform(action: "save" | "preview" | "rotate") {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/rd-marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: id || undefined,
          settings: form,
          payload: action === "preview" ? JSON.parse(payload) : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (action === "preview") setPreview(data.results);
      else {
        if (data.id) setId(data.id);
        if (data.webhookUrl) setUrl(data.webhookUrl);
        await load();
        toast.success(
          action === "save" ? "Fluxo salvo." : "Nova URL gerada. Atualize o fluxo no RD Marketing.",
        );
      }
    } catch (error) {
      setPreview(null);
      toast.error(error instanceof Error ? error.message : "Falha na integração.");
    } finally {
      setBusy(false);
    }
  }

  let paths: string[] = [];
  try {
    const lead = extractLeads(JSON.parse(payload))[0];
    paths = availablePaths({
      ...lead,
      rd_attribution: attributionForLead(lead, form),
      rd_conversion: conversionForLead(lead),
    });
  } catch {
    /* Validação apresentada ao simular. */
  }
  const customTargets = options
    ? Object.entries(options.fields).flatMap(([entity, fields]) =>
        fields.map((field) => ({
          value: `${entity}.customFields.${field.id}`,
          label: `${entity === "contact" ? "Contato" : entity === "company" ? "Empresa" : "Negociação"} · ${field.name} (personalizado)`,
          field,
        })),
      )
    : [];

  if (loadError)
    return (
      <div className="rounded-xl border border-destructive/30 p-5 text-sm text-destructive">
        {loadError}
      </div>
    );
  if (!options)
    return (
      <div className="flex items-center gap-2 p-5 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando RD Marketing...
      </div>
    );

  return (
    <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
      <div>
        <h3 className="text-lg font-bold">RD Station Marketing → Nosso CRM</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure o destino e os dados de cada fluxo da empresa {tenant}. No RD Marketing, use a
          ação “Enviar Leads para Integração” com a URL gerada aqui.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Fluxo de integração"
          className={`${inputClass} max-w-sm`}
          value={id}
          disabled={busy}
          onChange={(event) => {
            const flow = flows.find((f) => f.id === event.target.value);
            setId(flow?.id || "");
            setForm(flow ? structuredClone(flow.settings) : blank());
            setUrl("");
            setPreview(null);
          }}
        >
          <option value="">Novo fluxo</option>
          {flows.map((flow) => (
            <option key={flow.id} value={flow.id}>
              {flow.settings.name} · {flow.settings.enabled ? "Ativo" : "Desativado"}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          className="flex items-center gap-2 text-sm"
          onClick={() => {
            setId("");
            setForm(blank());
            setUrl("");
            setPreview(null);
          }}
        >
          <Plus className="h-4 w-4" />
          Novo fluxo
        </button>
      </div>
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            Nome do fluxo
            <input
              className={inputClass}
              maxLength={120}
              value={form.name}
              onChange={(e) => change({ name: e.target.value })}
              placeholder="Ex.: Pedido de orçamento"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => change({ enabled: e.target.checked })}
            />
            Receber leads e criar cards
          </label>
          <label className="space-y-1 text-sm">
            Funil
            <select
              className={inputClass}
              value={form.pipelineId}
              onChange={(e) => change({ pipelineId: e.target.value, stageId: "" })}
            >
              <option value="">Selecione</option>
              {options.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            Etapa
            <select
              className={inputClass}
              value={form.stageId}
              onChange={(e) => change({ stageId: e.target.value })}
            >
              <option value="">Selecione</option>
              {options.stages
                .filter((s) => s.pipelineId === form.pipelineId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            Responsável
            <select
              className={inputClass}
              value={form.operatorId || ""}
              onChange={(e) => change({ operatorId: e.target.value || null })}
            >
              <option value="">Sem responsável</option>
              {options.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            Criação de cards
            <select
              className={inputClass}
              value={form.deduplication}
              onChange={(e) =>
                change({
                  deduplication: e.target.value as FlowSettings["deduplication"],
                  eventIdPath:
                    e.target.value === "event" && !form.eventIdPath
                      ? "rd_conversion.id"
                      : form.eventIdPath,
                })
              }
            >
              <option value="lead">Um card por lead neste fluxo</option>
              <option value="event">Um card por conversão (padrão)</option>
            </select>
          </label>
          {form.deduplication === "event" && (
            <label className="space-y-1 text-sm md:col-span-2">
              Campo que identifica o evento
              <input
                className={inputClass}
                list="rd-marketing-paths"
                value={form.eventIdPath}
                onChange={(e) => change({ eventIdPath: e.target.value })}
                placeholder="rd_conversion.id (automático)"
              />
              <span className="text-xs text-muted-foreground">
                O padrão identifica a conversão pela data original e pelo formulário, nos formatos
                antigo e novo. Reenvios do mesmo evento não criam outro card. O contato e a empresa
                são reutilizados.
              </span>
            </label>
          )}
        </div>
        <div className="space-y-3 rounded-xl border border-border p-4">
          <h4 className="font-semibold">Fonte e Campanha</h4>
          <p className="text-xs text-muted-foreground">
            Fonte identifica de onde o lead veio, como Google ou e-mail. Campanha identifica a ação
            de marketing. A anotação de criação pelo RD Marketing é registrada automaticamente em
            todo card.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              Conversão usada na atribuição
              <select
                className={inputClass}
                value={form.attributionConversion || "first"}
                onChange={(e) =>
                  change({ attributionConversion: e.target.value as "first" | "last" })
                }
              >
                <option value="first">Primeira · Como o lead chegou</option>
                <option value="last">Última · Conversão anterior à negociação</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!form.campaignFromFlow}
                onChange={(e) => change({ campaignFromFlow: e.target.checked })}
              />
              Usar o nome deste fluxo como Campanha
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Ex.: primeiro Google / Notebooks; depois e-mail / Oferta de outubro. A primeira
            conversão mantém Google / Notebooks; a última usa e-mail / Oferta de outubro. Quando
            escolhido, o nome do fluxo substitui a campanha da conversão nos campos automáticos.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!form.requireAttribution}
              onChange={(e) => change({ requireAttribution: e.target.checked })}
            />
            Exigir Fonte e Campanha antes de criar o card
          </label>
          <p className="text-xs text-muted-foreground">
            Webhooks mais novos podem não conter os detalhes da campanha. Nesse caso, mapeie um
            campo coletado no RD ou configure uma campanha fixa do fluxo. O nome do formulário não é
            tratado como campanha automaticamente.
          </p>
          <button
            type="button"
            className="text-sm text-primary"
            onClick={() =>
              change({
                mappings: [
                  ...form.mappings.filter(
                    (mapping) => !["deal.source", "deal.campaign"].includes(mapping.target),
                  ),
                  ...defaultMappings
                    .filter((mapping) => ["deal.source", "deal.campaign"].includes(mapping.target))
                    .map((mapping) => ({ ...mapping })),
                ],
              })
            }
          >
            Aplicar mapeamento automático de Fonte e Campanha
          </button>
        </div>
        <div className="space-y-3">
          <h4 className="font-semibold">Dados recebidos → Campos do CRM</h4>
          <p className="text-xs text-muted-foreground">
            Escolha quais dados trazer e onde inserir. Campos não mapeados não são importados. Dados
            já preenchidos em contatos e empresas são preservados. Campos obrigatórios do CRM também
            se aplicam.
          </p>
          <datalist id="rd-marketing-paths">
            {paths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
          {form.mappings.map((mapping, index) => {
            const custom = customTargets.find((target) => target.value === mapping.target)?.field;
            return (
              <div key={index} className="space-y-2 rounded-xl border border-border p-3">
                <div className="grid items-end gap-3 md:grid-cols-[1fr_1.3fr_1fr_auto]">
                  <label className="space-y-1 text-xs">
                    Campo no RD Marketing
                    <input
                      aria-label={`Campo de origem ${index + 1}`}
                      className={inputClass}
                      list="rd-marketing-paths"
                      value={mapping.source}
                      onChange={(e) => changeMapping(index, { source: e.target.value })}
                      placeholder="Ex.: cf_produto"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    Inserir em
                    <select
                      aria-label={`Campo de destino ${index + 1}`}
                      className={inputClass}
                      value={mapping.target}
                      onChange={(e) =>
                        changeMapping(index, { target: e.target.value, valueMap: undefined })
                      }
                    >
                      {Object.entries(standardTargets).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                      {customTargets.map((target) => (
                        <option key={target.value} value={target.value}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs">
                    Valor padrão (opcional)
                    <input
                      className={inputClass}
                      value={
                        Array.isArray(mapping.fallback)
                          ? JSON.stringify(mapping.fallback)
                          : (mapping.fallback ?? "")
                      }
                      onChange={(e) => {
                        let value: Mapping["fallback"] = e.target.value || undefined;
                        if (custom?.fieldType === "multiple") {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            if (Array.isArray(parsed)) value = parsed;
                          } catch {
                            /* Mantém edição até ser um JSON válido. */
                          }
                        }
                        changeMapping(index, { fallback: value });
                      }}
                      placeholder={
                        custom?.fieldType === "multiple" ? '["opcao-id"]' : "Se o campo vier vazio"
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remover mapeamento ${index + 1}`}
                    className="p-2 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      change({ mappings: form.mappings.filter((_, i) => i !== index) })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {!!custom?.options.length && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      Opções do CRM: {custom.options.map((o) => `${o.label} (${o.id})`).join("; ")}
                    </p>
                    <p>Se os valores no RD forem diferentes, informe a correspondência:</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {custom.options.map((option) => (
                        <label key={option.id}>
                          {option.label}
                          <input
                            className={inputClass}
                            placeholder="Valor recebido do RD"
                            value={
                              Object.entries(mapping.valueMap || {}).find(
                                ([, value]) => value === option.id,
                              )?.[0] || ""
                            }
                            onChange={(e) => {
                              const valueMap = Object.fromEntries(
                                Object.entries(mapping.valueMap || {}).filter(
                                  ([, value]) => value !== option.id,
                                ),
                              );
                              if (e.target.value) valueMap[e.target.value] = option.id;
                              changeMapping(index, { valueMap });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="flex items-center gap-2 text-sm text-primary"
            onClick={() =>
              change({ mappings: [...form.mappings, { source: "", target: "deal.initialNote" }] })
            }
          >
            <Plus className="h-4 w-4" />
            Adicionar campo
          </button>
        </div>
        <details className="space-y-3 rounded-xl border border-border p-4">
          <summary className="cursor-pointer font-semibold text-sm">
            Simular dados recebidos
          </summary>
          <p className="text-xs text-muted-foreground">
            Cole um exemplo de JSON enviado pelo seu fluxo. A simulação valida os mapeamentos e
            campos obrigatórios sem criar contato ou card.
          </p>
          <textarea
            aria-label="Exemplo de dados do RD Marketing"
            className={`${inputClass} h-48 font-mono text-xs`}
            value={payload}
            onChange={(e) => {
              setPayload(e.target.value);
              setPreview(null);
            }}
          />
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm"
            onClick={() => perform("preview")}
          >
            Simular importação
          </button>
          {preview !== null && (
            <div className="space-y-3">
              {preview.map((result, leadIndex) => (
                <div key={leadIndex} className="grid gap-3 md:grid-cols-3">
                  {(["contact", "company", "deal"] as const).map((entity) => (
                    <div key={entity} className="rounded-lg bg-muted/50 p-3">
                      <h5 className="font-semibold text-sm">
                        {entity === "contact"
                          ? "Contato"
                          : entity === "company"
                            ? "Empresa"
                            : "Negociação"}{" "}
                        · Lead {leadIndex + 1}
                      </h5>
                      <dl className="mt-2 space-y-2 text-xs">
                        {Object.entries(result[entity])
                          .flatMap(([field, value]) =>
                            field === "customFields"
                              ? Object.entries(value as Record<string, unknown>).map(
                                  ([key, customValue]) => [
                                    options.fields[entity].find(
                                      (definition) => definition.id === key,
                                    )?.name || key,
                                    customValue,
                                  ],
                                )
                              : [
                                  [
                                    standardTargets[
                                      `${entity}.${field}` as keyof typeof standardTargets
                                    ]?.split(" · ")[1] || field,
                                    value,
                                  ],
                                ],
                          )
                          .filter(
                            ([, value]) => value !== "" && value !== null && value !== undefined,
                          )
                          .map(([label, value], index) => (
                            <div key={index}>
                              <dt className="text-muted-foreground">{String(label)}</dt>
                              <dd className="mt-0.5 break-words">
                                {Array.isArray(value) ? value.join(", ") : String(value)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </details>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => perform("save")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar fluxo
          </button>
          {id && (
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm"
              onClick={() => perform("rotate")}
            >
              <RefreshCw className="h-4 w-4" />
              Gerar nova URL
            </button>
          )}
        </div>
      </fieldset>
      {url && (
        <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="font-semibold text-sm">URL para o fluxo no RD Marketing</p>
          <div className="flex items-center gap-2">
            <input
              aria-label="URL da integração"
              readOnly
              className={`${inputClass} font-mono text-xs`}
              value={url}
            />
            <button
              type="button"
              aria-label="Copiar URL"
              onClick={() =>
                navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success("URL copiada."))
                  .catch(() => toast.error("Não foi possível copiar. Selecione a URL."))
              }
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Copie e guarde esta URL: ela é exibida apenas ao criar o fluxo ou gerar uma nova URL.
            Uma nova URL invalida a anterior.
          </p>
        </div>
      )}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold">Últimos recebimentos</h4>
          <button
            type="button"
            disabled={busy}
            className="text-xs text-primary"
            onClick={() => load().catch((e) => toast.error(e.message))}
          >
            Atualizar
          </button>
        </div>
        {!logs.length && (
          <p className="text-sm text-muted-foreground">Nenhum recebimento registrado.</p>
        )}
        {logs.map((log) => (
          <div key={log.id} className="rounded-lg border border-border p-3 text-sm">
            <p className={log.status === "error" ? "text-destructive" : "text-foreground"}>
              {log.status === "created"
                ? "Card criado"
                : log.status === "duplicate"
                  ? "Reenvio ignorado"
                  : "Falha"}{" "}
              · {flows.find((f) => f.id === log.flowId)?.settings.name} ·{" "}
              {new Date(log.createdAt).toLocaleString("pt-BR")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {log.message}
              {log.dealId ? ` · Card: ${log.dealId}` : ""}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
