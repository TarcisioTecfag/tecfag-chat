import { useCallback, useEffect, useMemo, useState } from "react";
import { buildConsultantAvatarResolver } from "@/lib/commercial/avatar-matcher";

type ForecastCell = { tier: number; days: number; count: number; value: number };
type ForecastRow = {
  operatorId: string;
  name: string;
  avatar?: string | null;
  division: string | null;
  targetValue: number;
  conversionRate: number;
  forecastValue: number;
  forecastPromisedValue: number;
  forecastCoveragePercent: number | null;
  forecast: ForecastCell[];
};
type MaturityResponse = { rows: ForecastRow[] };
type Deal = {
  id: string;
  title: string;
  value: number;
  stageName: string;
  accountName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  daysRemaining: number | null;
  directive: { state: string; assignedDate: string } | null;
  canPointToday: boolean;
};
type DealResponse = { total: number; page: number; limit: number; deals: Deal[] };

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

export function CommercialForecastDrilldown({
  division,
  onOpenDeal,
  onPointed,
}: {
  division: string;
  onOpenDeal: (id: string) => void;
  onPointed: () => void;
}) {
  const [analysis, setAnalysis] = useState<MaturityResponse | null>(null);
  const [selection, setSelection] = useState<{
    operatorId: string;
    name: string;
    tier?: number;
  } | null>(null);
  const [details, setDetails] = useState<DealResponse | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pointing, setPointing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const avatarResolver = useMemo(() => buildConsultantAvatarResolver(), []);

  const divisionQuery = division ? `&division=${encodeURIComponent(division)}` : "";
  const loadAnalysis = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(`/api/commercial/analysis?view=maturity${divisionQuery}`, {
        credentials: "same-origin",
        signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao carregar a previsão.");
      if (!signal?.aborted) setAnalysis(body);
    },
    [divisionQuery],
  );

  const loadDeals = useCallback(
    async (signal?: AbortSignal) => {
      if (!selection) return;
      const params = new URLSearchParams({
        view: "deals",
        mode: "forecast",
        operatorId: selection.operatorId,
        page: String(page),
        limit: "50",
      });
      if (division) params.set("division", division);
      if (selection.tier) params.set("tier", String(selection.tier));
      if (search.trim()) params.set("search", search.trim());
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/commercial/analysis?${params}`, {
          credentials: "same-origin",
          signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Falha ao abrir os negócios.");
        if (!signal?.aborted) {
          setDetails(body);
          setSelected([]);
        }
      } catch (cause) {
        if (!signal?.aborted)
          setError(cause instanceof Error ? cause.message : "Falha ao abrir os negócios.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [selection, page, search, division],
  );

  useEffect(() => {
    const controller = new AbortController();
    setAnalysis(null);
    void loadAnalysis(controller.signal).catch((cause) => {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Falha ao carregar a previsão.");
    });
    return () => controller.abort();
  }, [loadAnalysis]);
  useEffect(() => {
    setSelection(null);
    setDetails(null);
    setSelected([]);
  }, [division]);
  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    void loadDeals(controller.signal);
    return () => controller.abort();
  }, [selection, loadDeals]);

  const available = details?.deals.filter((deal) => deal.canPointToday) || [];
  const selectedDeals = available.filter((deal) => selected.includes(deal.id));

  const point = async () => {
    if (!selection || !selectedDeals.length) return;
    setPointing(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/commercial/directives/point", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorId: selection.operatorId,
          dealIds: selectedDeals.map((deal) => deal.id),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao pontuar.");
      setResult(
        `${body.createdCount} responsabilidade(s) registrada(s); ${body.alreadyAssignedCount} já pontuada(s) hoje.`,
      );
      await Promise.all([loadDeals(), loadAnalysis()]);
      onPointed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao pontuar.");
    } finally {
      setPointing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
      <h2 className="text-lg font-bold">Previsão por consultor e faixa</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Abra uma faixa para conferir as negociações e pontuar responsabilidades.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="mt-3 text-sm text-emerald-300">
          {result}
        </p>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-zinc-400">
              <th className="p-2">Consultor</th>
              <th className="p-2">Meta</th>
              <th className="p-2">A faturar</th>
              <th className="p-2">Promessa</th>
              <th className="p-2">Cobertura</th>
              <th className="p-2">Faixas</th>
            </tr>
          </thead>
          <tbody>
            {analysis?.rows.map((row) => (
              <tr key={row.operatorId} className="border-b border-white/10">
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-[2px] border border-white/10 bg-white/5">
                      {(() => {
                        const avatar = row.avatar || avatarResolver(row.operatorId, row.name);
                        return avatar ? (
                          <img
                            src={avatar}
                            alt={row.name}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center font-mono font-bold text-[10px] text-red-400 bg-red-950/30">
                            {row.name.slice(0, 2).toUpperCase()}
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <button
                        className="font-semibold underline hover:text-red-400 transition-colors"
                        onClick={() => {
                          setSelection({ operatorId: row.operatorId, name: row.name });
                          setPage(1);
                          setSearch("");
                        }}
                      >
                        {row.name}
                      </button>
                      <span className="block text-zinc-500">
                        {row.division === "maquinas" ? "Máquinas" : "Personnalité"}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="p-2">{money.format(row.targetValue)}</td>
                <td className="p-2">{money.format(row.forecastValue)}</td>
                <td className="p-2">{money.format(row.forecastPromisedValue)}</td>
                <td className="p-2">
                  {row.forecastCoveragePercent === null
                    ? "—"
                    : `${row.forecastCoveragePercent.toFixed(1)}%`}
                </td>
                <td className="p-2">
                  <div className="flex gap-1">
                    {row.forecast.map((cell) => (
                      <button
                        key={cell.tier}
                        className="rounded border border-white/15 px-2 py-1 hover:border-red-400"
                        title={`${cell.count} negócios · ${money.format(cell.value)}`}
                        onClick={() => {
                          setSelection({
                            operatorId: row.operatorId,
                            name: row.name,
                            tier: cell.tier,
                          });
                          setPage(1);
                          setSearch("");
                        }}
                      >
                        {cell.tier}: {cell.count}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!analysis?.rows.length && (
          <p className="p-4 text-sm text-zinc-400">Nenhum consultor ativo na TV nesta divisão.</p>
        )}
      </div>
      {selection && (
        <div className="mt-5 rounded-xl border border-white/15 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">
              {selection.name} {selection.tier ? `· Faixa ${selection.tier}` : "· Todas as faixas"}
            </h3>
            <button
              className="text-sm underline"
              onClick={() => {
                setSelection(null);
                setDetails(null);
                setSelected([]);
              }}
            >
              Fechar
            </button>
          </div>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar negócio, cliente, empresa ou etapa"
            className="mt-3 w-full rounded-lg border border-white/15 bg-zinc-900 p-2 text-sm"
          />
          {loading && <p className="mt-3 text-xs text-zinc-400">Carregando negócios...</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <span>{details?.total || 0} negócio(s)</span>
            <button
              className="underline"
              onClick={() => setSelected(available.map((deal) => deal.id))}
            >
              Selecionar elegíveis nesta página
            </button>
            <button className="underline" onClick={() => setSelected([])}>
              Limpar
            </button>
            <strong>
              {selectedDeals.length} selecionado(s) ·{" "}
              {money.format(selectedDeals.reduce((sum, deal) => sum + deal.value, 0))}
            </strong>
            <button
              disabled={!selectedDeals.length || pointing}
              className="rounded bg-red-600 px-3 py-2 font-bold disabled:opacity-50"
              onClick={() => void point()}
            >
              {pointing ? "Registrando..." : "Pontuar responsabilidades"}
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {details?.deals.map((deal) => (
              <div
                key={deal.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-2 text-xs"
              >
                <input
                  type="checkbox"
                  disabled={!deal.canPointToday}
                  checked={selected.includes(deal.id)}
                  aria-label={`Selecionar ${deal.title}`}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(deal.id)
                        ? current.filter((id) => id !== deal.id)
                        : [...current, deal.id],
                    )
                  }
                />
                <button className="font-semibold underline" onClick={() => onOpenDeal(deal.id)}>
                  {deal.title}
                </button>
                <span>{money.format(deal.value)}</span>
                <span className="text-zinc-400">
                  {deal.accountName || deal.contactName || "Cliente sem nome"} · {deal.stageName} ·{" "}
                  {deal.daysRemaining === null
                    ? "—"
                    : deal.daysRemaining <= 0
                      ? "Pronto"
                      : `${deal.daysRemaining} dia(s)`}
                </span>
                {deal.directive && (
                  <span className="rounded border border-white/15 px-2 py-1">
                    {deal.directive.state === "pending_today"
                      ? "Sinalizada hoje"
                      : deal.directive.state === "overdue"
                        ? "Atrasada no consultor"
                        : deal.directive.state === "completed"
                          ? "Diretriz concluída"
                          : deal.directive.state}
                  </span>
                )}
              </div>
            ))}
          </div>
          {details && details.total > details.limit && (
            <div className="mt-3 flex items-center gap-3 text-xs">
              <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Anterior
              </button>
              <span>
                Página {page} de {Math.ceil(details.total / details.limit)}
              </span>
              <button
                disabled={page * details.limit >= details.total}
                onClick={() => setPage((value) => value + 1)}
              >
                Próxima
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
