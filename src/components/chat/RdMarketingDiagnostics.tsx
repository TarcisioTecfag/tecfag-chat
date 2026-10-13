import { useEffect, useState } from "react";
import type { RdDiagnostic } from "@/lib/rd-marketing/diagnostics";
import { standardTargets } from "@/lib/rd-marketing/mapping";

type Sample = { id: string; createdAt: string; diagnostic: RdDiagnostic };
const statusLabels = {
  present: "Preenchido",
  empty: "Vazio/ausente",
  not_mapped: "Não mapeado",
  unknown: "Desconhecido",
};

export function RdMarketingDiagnostics({ tenant, flowId }: { tenant: string; flowId: string }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSamples([]);
    setSelectedId("");
    setError("");
    setLoading(true);
    const query = flowId ? `?flowId=${encodeURIComponent(flowId)}` : "";
    fetch(`/api/settings/rd-marketing/diagnostics${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar o diagnóstico.");
        if (!Array.isArray(data.samples)) throw new Error("Resposta de diagnóstico inválida.");
        if (!controller.signal.aborted) {
          setSamples(data.samples);
          setSelectedId(data.samples[0]?.id || "");
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tenant, flowId, revision]);
  const selected = samples.find((sample) => sample.id === selectedId);
  return (
    <section className="rounded-3xl border border-border bg-card p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold">Diagnóstico dos dados recebidos</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Últimas 20 amostras por integração. Até 5 contatos por envio; dados pessoais ocultos.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-xl border border-border px-3 py-2 text-xs disabled:opacity-50"
        >
          {loading ? "Carregando…" : "Atualizar diagnóstico"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Amostras capturadas a partir desta atualização, inclusive em falhas de mapeamento. Eventos
        antigos sem amostra não podem ser reconstruídos.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!loading && !error && !samples.length && (
        <p className="text-sm text-muted-foreground">
          Nenhuma amostra disponível. O próximo recebimento aparecerá aqui.
        </p>
      )}
      {!!samples.length && (
        <div className="flex flex-wrap gap-2" aria-label="Amostras de recebimentos">
          {samples.map((sample) => (
            <button
              key={sample.id}
              type="button"
              aria-pressed={selectedId === sample.id}
              onClick={() => setSelectedId(sample.id)}
              className={`rounded-lg border px-3 py-2 text-xs ${selectedId === sample.id ? "border-primary bg-primary/10" : "border-border"}`}
            >
              {new Date(sample.createdAt).toLocaleString("pt-BR")} · {sample.id.slice(-8)}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="space-y-4">
          <p className="text-xs">
            Contatos no envio: {selected.diagnostic.leadCount}. O diagnóstico descreve os campos
            recebidos; a auditoria confirma a criação do card.
          </p>
          {selected.diagnostic.sampledLeads.map((lead) => (
            <div key={lead.index} className="rounded-xl border border-border p-3 space-y-3">
              <p className="text-sm font-semibold">Contato {lead.index + 1}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th className="p-2">Destino</th>
                      <th className="p-2">Campo utilizado</th>
                      <th className="p-2">Dados recebidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lead.fields.map((field) => (
                      <tr key={field.target} className="border-t border-border">
                        <td className="p-2">
                          {standardTargets[field.target as keyof typeof standardTargets] ||
                            field.target}
                        </td>
                        <td className="p-2 font-mono">
                          {field.usedFallback ? "Valor padrão configurado" : field.source || "—"}
                        </td>
                        <td className="p-2">{statusLabels[field.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!!lead.warnings.length && (
                <ul className="list-disc pl-5 text-xs text-amber-700 space-y-1">
                  {lead.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer">Campos encontrados no RD</summary>
                <p className="mt-2 break-all font-mono">{lead.paths.join(", ")}</p>
              </details>
            </div>
          ))}
          <details>
            <summary className="cursor-pointer text-sm font-semibold">
              Ver JSON recebido com valores ocultos
            </summary>
            <p className="text-xs text-muted-foreground my-2">
              Esta amostra serve para conferir a estrutura; valores ocultos não podem ser usados
              para simular uma importação.
            </p>
            <textarea
              readOnly
              aria-label="JSON recebido com valores ocultos"
              rows={14}
              value={JSON.stringify(selected.diagnostic.maskedPayload, null, 2)}
              className="w-full rounded-xl border border-border bg-muted/40 p-3 text-xs font-mono"
            />
          </details>
        </div>
      )}
    </section>
  );
}
