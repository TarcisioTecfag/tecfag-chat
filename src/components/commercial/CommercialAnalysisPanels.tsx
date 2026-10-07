import { useEffect, useState } from "react";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

type Responsibility = {
  id: string;
  dealId: string;
  dealTitle: string;
  dealValue: number;
  operatorName: string;
  assignedDate: string;
  state: string;
  instruction: string;
  daysOverdue: number;
  stageName: string | null;
};
type Responsibilities = {
  month: string;
  summary: {
    totalCount: number;
    totalValue: number;
    completedCount: number;
    pendingTodayCount: number;
    overdueCount: number;
    executionRatePercent: number;
  };
  consultants: Array<{
    operatorId: string;
    name: string;
    totalCount: number;
    completedCount: number;
    pendingTodayCount: number;
    overdueCount: number;
  }>;
  actions: Responsibility[];
};
type Cohort = {
  month: string;
  classifiedCount: number;
  unclassifiedCount: number;
  totalValue: number;
  tiers: Array<{ tier: number; count: number; value: number }>;
};
type Cohorts = { months: Cohort[] };
type CohortDeal = {
  id: string;
  title: string;
  value: number;
  accountName: string | null;
  status: string;
};
type CohortDeals = { total: number; page: number; limit: number; deals: CohortDeal[] };
type Operational = {
  asOf: string;
  consultants: {
    configured: number;
    activeOnTv: number;
    online: number;
    rows: Array<{
      operatorId: string;
      name: string;
      division: string | null;
      activeOnTv: boolean;
      isOnline: boolean;
    }>;
  };
  alerts: { pendingTransferResponses: number; overdueResponsibilities: number; openDeals: number };
  recentCrmEvents: Array<{ createdAt: string; eventType: string; dealId: string }>;
};

function useAnalysis<T>(view: string, division: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    const params = new URLSearchParams({ view });
    if (division) params.set("division", division);
    fetch(`/api/commercial/analysis?${params}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Falha ao carregar análise.");
        return body as T;
      })
      .then((body) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Falha ao carregar análise.");
      });
    return () => controller.abort();
  }, [view, division]);
  return { data, error };
}

export function CommercialResponsibilitiesPanel({
  division,
  onOpenDeal,
}: {
  division: string;
  onOpenDeal: (id: string) => void;
}) {
  const { data, error } = useAnalysis<Responsibilities>("responsibilities", division);
  const [filter, setFilter] = useState("all");
  const actions =
    data?.actions.filter((action) => filter === "all" || action.state === filter) || [];
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
      <h2 className="text-xl font-bold">Responsabilidades do gestor</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Diretrizes pontuadas no mês. Valores e etapas preservam o retrato feito na pontuação.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-red-300">
          {error}
        </p>
      )}
      {!data && !error && <p className="mt-3 text-sm text-zinc-400">Carregando...</p>}
      {data && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-4 text-sm">
            <div>
              Total: <strong>{data.summary.totalCount}</strong>
              <span className="block">{money.format(data.summary.totalValue)}</span>
            </div>
            <div>
              Concluídas: <strong>{data.summary.completedCount}</strong>
            </div>
            <div>
              Hoje: <strong>{data.summary.pendingTodayCount}</strong>
            </div>
            <div>
              Atrasadas: <strong>{data.summary.overdueCount}</strong>
            </div>
          </div>
          <p className="mt-3 text-xs">Execução: {data.summary.executionRatePercent.toFixed(1)}%</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-zinc-400">
                  <th className="p-2">Consultor</th>
                  <th className="p-2">Total</th>
                  <th className="p-2">Concluídas</th>
                  <th className="p-2">Hoje</th>
                  <th className="p-2">Atrasadas</th>
                </tr>
              </thead>
              <tbody>
                {data.consultants.map((consultant) => (
                  <tr key={consultant.operatorId} className="border-b border-white/10">
                    <td className="p-2">{consultant.name}</td>
                    <td className="p-2">{consultant.totalCount}</td>
                    <td className="p-2">{consultant.completedCount}</td>
                    <td className="p-2">{consultant.pendingTodayCount}</td>
                    <td className="p-2">{consultant.overdueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {[
              ["all", "Todas"],
              ["overdue", "Atrasadas"],
              ["pending_today", "Hoje"],
              ["completed", "Concluídas"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded border px-2 py-1 ${filter === value ? "border-red-400" : "border-white/15"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 max-h-[450px] space-y-2 overflow-y-auto">
            {actions.map((action) => (
              <div
                key={action.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-2 text-xs"
              >
                <button
                  className="font-semibold underline"
                  onClick={() => onOpenDeal(action.dealId)}
                >
                  {action.dealTitle}
                </button>
                <span>{money.format(action.dealValue)}</span>
                <span>{action.operatorName}</span>
                <span>{action.stageName || "Etapa atual"}</span>
                <span>
                  {action.state === "overdue"
                    ? `${action.daysOverdue} dia(s) de atraso`
                    : action.state === "completed"
                      ? "Concluída"
                      : action.state === "pending_today"
                        ? "Pendente hoje"
                        : action.state}
                </span>
                <span className="w-full text-zinc-400">{action.instruction}</span>
              </div>
            ))}
            {!actions.length && (
              <p className="text-sm text-zinc-400">Nenhuma diretriz neste filtro.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function CommercialCohortsPanel({
  division,
  onOpenDeal,
}: {
  division: string;
  onOpenDeal: (id: string) => void;
}) {
  const { data, error } = useAnalysis<Cohorts>("cohorts", division);
  const [month, setMonth] = useState<string | null>(null);
  const [details, setDetails] = useState<CohortDeals | null>(null);
  const [page, setPage] = useState(1);
  const [detailError, setDetailError] = useState<string | null>(null);
  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    setDetails(null);
    setDetailError(null);
    const params = new URLSearchParams({
      view: "cohort-deals",
      month,
      unclassified: "true",
      page: String(page),
      limit: "50",
    });
    if (division) params.set("division", division);
    fetch(`/api/commercial/analysis?${params}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Falha ao abrir safra.");
        return body as CohortDeals;
      })
      .then((body) => {
        if (!controller.signal.aborted) setDetails(body);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setDetailError(cause instanceof Error ? cause.message : "Falha ao abrir safra.");
      });
    return () => controller.abort();
  }, [month, page, division]);
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
      <h2 className="text-xl font-bold">Safras e régua De-Para</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Últimos seis meses de criação, classificados pela régua comercial atual.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-red-300">
          {error}
        </p>
      )}
      {!data && !error && <p className="mt-3 text-sm text-zinc-400">Carregando...</p>}
      {data && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-zinc-400">
                <th className="p-2">Safra</th>
                <th className="p-2">Classificados</th>
                <th className="p-2">Sem valor</th>
                <th className="p-2">Valor</th>
                {[1, 2, 3, 4, 5].map((tier) => (
                  <th key={tier} className="p-2">
                    Faixa {tier}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.months.map((row) => (
                <tr key={row.month} className="border-b border-white/10">
                  <td className="p-2">{row.month}</td>
                  <td className="p-2">{row.classifiedCount}</td>
                  <td className="p-2">
                    <button
                      className="underline"
                      onClick={() => {
                        setMonth(row.month);
                        setPage(1);
                        setDetails(null);
                      }}
                    >
                      {row.unclassifiedCount}
                    </button>
                  </td>
                  <td className="p-2">{money.format(row.totalValue)}</td>
                  {row.tiers.map((tier) => (
                    <td key={tier.tier} className="p-2" title={money.format(tier.value)}>
                      {tier.count}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {month && (
        <div className="mt-5 rounded-xl border border-white/15 p-4 text-xs">
          <div className="flex justify-between">
            <strong>
              Sem valor · {month} · {details?.total ?? "..."} negócio(s)
            </strong>
            <button
              className="underline"
              onClick={() => {
                setMonth(null);
                setDetails(null);
              }}
            >
              Fechar
            </button>
          </div>
          {detailError && (
            <p role="alert" className="mt-2 text-red-300">
              {detailError}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {details?.deals.map((deal) => (
              <div key={deal.id} className="flex flex-wrap gap-3 border-b border-white/10 py-2">
                <button className="underline" onClick={() => onOpenDeal(deal.id)}>
                  {deal.title}
                </button>
                <span>{deal.accountName || "Cliente sem nome"}</span>
                <span>{deal.status}</span>
                <span>{money.format(deal.value)}</span>
              </div>
            ))}
          </div>
          {details && details.total > details.limit && (
            <div className="mt-3 flex gap-3">
              <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Anterior
              </button>
              <span>Página {page}</span>
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
    </section>
  );
}

export function CommercialOperationalPanel() {
  const { data, error } = useAnalysis<Operational>("operational", "");
  return (
    <section className="rounded-2xl border border-border bg-card p-5 text-foreground">
      <h2 className="text-lg font-bold">Status da operação comercial</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Indicadores do CRM próprio e do atendimento local, sem sincronização com RD.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {!data && !error && <p className="mt-3 text-sm">Carregando...</p>}
      {data && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              Consultores configurados: <strong>{data.consultants.configured}</strong>
            </div>
            <div>
              Na TV: <strong>{data.consultants.activeOnTv}</strong>
            </div>
            <div>
              Online: <strong>{data.consultants.online}</strong>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              Negociações abertas: <strong>{data.alerts.openDeals}</strong>
            </div>
            <div>
              Transferências aguardando: <strong>{data.alerts.pendingTransferResponses}</strong>
            </div>
            <div>
              Responsabilidades atrasadas: <strong>{data.alerts.overdueResponsibilities}</strong>
            </div>
          </div>
          <h3 className="mt-5 text-sm font-bold">Últimas alterações do CRM</h3>
          <div className="mt-2 space-y-1 text-xs">
            {data.recentCrmEvents.map((event, index) => (
              <div
                key={`${event.dealId}-${index}`}
                className="flex gap-3 border-b border-border py-2"
              >
                <span>{new Date(event.createdAt).toLocaleString("pt-BR")}</span>
                <span>{event.eventType}</span>
                <span className="truncate">{event.dealId}</span>
              </div>
            ))}
            {!data.recentCrmEvents.length && (
              <p className="text-muted-foreground">Ainda não há alterações de negociações.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
