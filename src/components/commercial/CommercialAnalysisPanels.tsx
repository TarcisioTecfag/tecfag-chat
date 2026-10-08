import { useEffect, useState } from "react";
import { SystemTooltip } from "@/components/ui/tooltip";

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
    <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 text-foreground">
      <p className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary">
        DIRETRIZES & METAS
      </p>
      <h2 className="mt-1 font-mono text-xl font-bold tracking-tight text-foreground">
        Responsabilidades do gestor
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Diretrizes pontuadas no mês. Valores e etapas preservam o retrato feito na pontuação.
      </p>
      {error && (
        <div role="alert" className="mt-3 rounded-[2px] border border-destructive/30 bg-destructive/10 p-3 text-xs font-mono text-destructive">
          {error}
        </div>
      )}
      {!data && !error && <p className="mt-3 text-xs font-mono text-muted-foreground">Carregando...</p>}
      {data && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-4 text-xs font-mono">
            <div className="rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground block text-[11px]">Total</span>
              <strong className="text-sm font-bold text-foreground">{data.summary.totalCount}</strong>
              <span className="block text-[11px] text-muted-foreground mt-0.5">{money.format(data.summary.totalValue)}</span>
            </div>
            <div className="rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground block text-[11px]">Concluídas</span>
              <strong className="text-sm font-bold text-emerald-500">{data.summary.completedCount}</strong>
            </div>
            <div className="rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground block text-[11px]">Hoje</span>
              <strong className="text-sm font-bold text-amber-500">{data.summary.pendingTodayCount}</strong>
            </div>
            <div className="rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground block text-[11px]">Atrasadas</span>
              <strong className="text-sm font-bold text-destructive">{data.summary.overdueCount}</strong>
            </div>
          </div>
          <p className="mt-3 text-xs font-mono text-muted-foreground">
            Taxa de Execução: <strong className="text-foreground">{data.summary.executionRatePercent.toFixed(1)}%</strong>
          </p>
          <div className="mt-4 overflow-x-auto rounded-[4px] border border-border/80 dark:border-zinc-800">
            <table className="w-full min-w-[520px] text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-border/80 bg-muted/30 dark:bg-zinc-900/60 text-muted-foreground uppercase text-[10px] tracking-wider">
                  <th className="p-2.5">Consultor</th>
                  <th className="p-2.5">Total</th>
                  <th className="p-2.5">Concluídas</th>
                  <th className="p-2.5">Hoje</th>
                  <th className="p-2.5">Atrasadas</th>
                </tr>
              </thead>
              <tbody>
                {data.consultants.map((consultant) => (
                  <tr key={consultant.operatorId} className="border-b border-border/60 dark:border-zinc-800/60 hover:bg-muted/20 dark:hover:bg-zinc-900/30 transition-colors">
                    <td className="p-2.5 font-semibold">{consultant.name}</td>
                    <td className="p-2.5">{consultant.totalCount}</td>
                    <td className="p-2.5 text-emerald-500 font-semibold">{consultant.completedCount}</td>
                    <td className="p-2.5 text-amber-500 font-semibold">{consultant.pendingTodayCount}</td>
                    <td className="p-2.5 text-destructive font-semibold">{consultant.overdueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5 text-xs font-mono">
            {[
              ["all", "Todas"],
              ["overdue", "Atrasadas"],
              ["pending_today", "Hoje"],
              ["completed", "Concluídas"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded-[2px] font-mono px-3 py-1 transition-all cursor-pointer ${
                  filter === value
                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                    : "border border-border/80 bg-background/60 text-muted-foreground hover:bg-muted dark:border-zinc-800 dark:bg-zinc-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 max-h-[450px] space-y-2 overflow-y-auto">
            {actions.map((action) => (
              <div
                key={action.id}
                className="flex flex-wrap items-center gap-3 rounded-[4px] border border-border/80 bg-background/40 dark:border-zinc-800 dark:bg-zinc-900/40 p-3 text-xs font-mono"
              >
                <button
                  className="font-bold text-foreground hover:text-primary underline cursor-pointer"
                  onClick={() => onOpenDeal(action.dealId)}
                >
                  {action.dealTitle}
                </button>
                <span className="font-semibold text-foreground">{money.format(action.dealValue)}</span>
                <span className="text-muted-foreground">{action.operatorName}</span>
                <span className="rounded-[2px] border border-border/80 bg-muted/40 dark:border-zinc-800 dark:bg-zinc-900 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {action.stageName || "Etapa atual"}
                </span>
                <span
                  className={`rounded-[2px] px-2 py-0.5 text-[10px] font-bold ${
                    action.state === "overdue"
                      ? "bg-destructive/10 text-destructive border border-destructive/20"
                      : action.state === "completed"
                        ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  }`}
                >
                  {action.state === "overdue"
                    ? `${action.daysOverdue} dia(s) de atraso`
                    : action.state === "completed"
                      ? "Concluída"
                      : action.state === "pending_today"
                        ? "Pendente hoje"
                        : action.state}
                </span>
                <span className="w-full text-muted-foreground text-[11px]">{action.instruction}</span>
              </div>
            ))}
            {!actions.length && (
              <p className="text-xs font-mono text-muted-foreground italic">Nenhuma diretriz neste filtro.</p>
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
    <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 text-foreground">
      <p className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary">
        ANÁLISE DE SAFRAS
      </p>
      <h2 className="mt-1 font-mono text-xl font-bold tracking-tight text-foreground">
        Safras e régua De-Para
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Últimos seis meses de criação, classificados pela régua comercial atual.
      </p>
      {error && (
        <div role="alert" className="mt-3 rounded-[2px] border border-destructive/30 bg-destructive/10 p-3 text-xs font-mono text-destructive">
          {error}
        </div>
      )}
      {!data && !error && <p className="mt-3 text-xs font-mono text-muted-foreground">Carregando...</p>}
      {data && (
        <div className="mt-4 overflow-x-auto rounded-[4px] border border-border/80 dark:border-zinc-800">
          <table className="w-full min-w-[720px] text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-border/80 bg-muted/30 dark:bg-zinc-900/60 text-muted-foreground uppercase text-[10px] tracking-wider">
                <th className="p-2.5">Safra</th>
                <th className="p-2.5">Classificados</th>
                <th className="p-2.5">Sem valor</th>
                <th className="p-2.5">Valor</th>
                {[1, 2, 3, 4, 5].map((tier) => (
                  <th key={tier} className="p-2.5">
                    Faixa {tier}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.months.map((row) => (
                <tr key={row.month} className="border-b border-border/60 dark:border-zinc-800/60 hover:bg-muted/20 dark:hover:bg-zinc-900/30 transition-colors">
                  <td className="p-2.5 font-bold">{row.month}</td>
                  <td className="p-2.5">{row.classifiedCount}</td>
                  <td className="p-2.5">
                    <button
                      className="underline text-primary hover:brightness-110 cursor-pointer font-bold"
                      onClick={() => {
                        setMonth(row.month);
                        setPage(1);
                        setDetails(null);
                      }}
                    >
                      {row.unclassifiedCount}
                    </button>
                  </td>
                  <td className="p-2.5 font-semibold">{money.format(row.totalValue)}</td>
                  {row.tiers.map((tier) => (
                    <td key={tier.tier} className="p-2.5">
                      <SystemTooltip content={`Faixa ${tier.tier}: ${money.format(tier.value)}`}>
                        <span className="cursor-help">{tier.count}</span>
                      </SystemTooltip>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {month && (
        <div className="mt-5 rounded-[4px] border border-border/80 bg-background/60 dark:border-zinc-800 dark:bg-zinc-900/60 p-4 text-xs font-mono">
          <div className="flex justify-between items-center pb-2 border-b border-border/60 dark:border-zinc-800">
            <strong className="text-foreground">
              Sem valor · {month} · {details?.total ?? "..."} negócio(s)
            </strong>
            <button
              className="rounded-[2px] border border-border/80 dark:border-zinc-800 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => {
                setMonth(null);
                setDetails(null);
              }}
            >
              Fechar
            </button>
          </div>
          {detailError && (
            <p role="alert" className="mt-2 text-destructive font-mono">
              {detailError}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {details?.deals.map((deal) => (
              <div key={deal.id} className="flex flex-wrap items-center gap-3 border-b border-border/60 dark:border-zinc-800/60 py-2">
                <button className="underline text-primary font-bold cursor-pointer" onClick={() => onOpenDeal(deal.id)}>
                  {deal.title}
                </button>
                <span className="text-muted-foreground">{deal.accountName || "Cliente sem nome"}</span>
                <span className="rounded-[2px] bg-muted/60 dark:bg-zinc-800 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {deal.status}
                </span>
                <span className="font-semibold text-foreground ml-auto">{money.format(deal.value)}</span>
              </div>
            ))}
          </div>
          {details && details.total > details.limit && (
            <div className="mt-3 flex items-center gap-3">
              <button
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
                className="rounded-[2px] border border-border/80 dark:border-zinc-800 px-2.5 py-1 text-xs cursor-pointer disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-muted-foreground">Página {page}</span>
              <button
                disabled={page * details.limit >= details.total}
                onClick={() => setPage((value) => value + 1)}
                className="rounded-[2px] border border-border/80 dark:border-zinc-800 px-2.5 py-1 text-xs cursor-pointer disabled:opacity-40"
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
    <section className="rounded-[4px] border border-border/80 bg-card p-5 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/70 text-foreground">
      <p className="text-[10px] font-mono font-bold uppercase tracking-[.18em] text-primary">
        OPERAÇÃO LOCAL CRM
      </p>
      <h2 className="mt-1 font-mono text-xl font-bold tracking-tight text-foreground">
        Status da operação comercial
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Indicadores do CRM próprio e do atendimento local.
      </p>
      {error && (
        <div role="alert" className="mt-3 rounded-[2px] border border-destructive/30 bg-destructive/10 p-3 text-xs font-mono text-destructive">
          {error}
        </div>
      )}
      {!data && !error && <p className="mt-3 text-xs font-mono text-muted-foreground">Carregando...</p>}
      {data && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 text-xs font-mono">
            <div className="flex items-center justify-between rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground">Consultores configurados:</span>
              <strong className="text-sm font-bold text-foreground">{data.consultants.configured}</strong>
            </div>
            <div className="flex items-center justify-between rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground">Na TV:</span>
              <strong className="text-sm font-bold text-primary">{data.consultants.activeOnTv}</strong>
            </div>
            <div className="flex items-center justify-between rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground">Online:</span>
              <strong className="text-sm font-bold text-emerald-500">{data.consultants.online}</strong>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs font-mono">
            <div className="flex items-center justify-between rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground">Negociações abertas:</span>
              <strong className="text-sm font-bold text-foreground">{data.alerts.openDeals}</strong>
            </div>
            <div className="flex items-center justify-between rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground">Transferências aguardando:</span>
              <strong className="text-sm font-bold text-amber-500">{data.alerts.pendingTransferResponses}</strong>
            </div>
            <div className="flex items-center justify-between rounded-[4px] border border-border/80 bg-background/50 dark:border-zinc-800 dark:bg-zinc-900/40 p-3">
              <span className="text-muted-foreground">Responsabilidades atrasadas:</span>
              <strong className="text-sm font-bold text-destructive">{data.alerts.overdueResponsibilities}</strong>
            </div>
          </div>
          <h3 className="mt-5 text-xs font-mono font-bold uppercase tracking-wider text-foreground">
            Últimas alterações do CRM
          </h3>
          <div className="mt-2 space-y-1 text-xs font-mono">
            {data.recentCrmEvents.map((event, index) => (
              <div
                key={`${event.dealId}-${index}`}
                className="flex items-center gap-3 border-b border-border/60 dark:border-zinc-800/60 py-2"
              >
                <span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString("pt-BR")}</span>
                <span className="rounded-[2px] bg-muted/60 dark:bg-zinc-800 px-2 py-0.5 text-[10px] text-foreground font-semibold">
                  {event.eventType}
                </span>
                <span className="truncate text-muted-foreground">{event.dealId}</span>
              </div>
            ))}
            {!data.recentCrmEvents.length && (
              <p className="text-xs font-mono text-muted-foreground italic">Ainda não há alterações de negociações.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
