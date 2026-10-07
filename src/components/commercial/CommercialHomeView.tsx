import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChat } from "@/hooks/useChatState";
import { CommercialEvidenceDialog } from "./CommercialEvidenceDialog";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Flame,
  Loader2,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

type CommercialHome = {
  asOf: string;
  today: string;
  month: string;
  consultant: { id: string; name: string; avatar: string | null; division: string | null };
  goal: {
    configured: boolean;
    targetValue: number;
    realizedValue: number;
    conversionRate: number;
    businessDays: number;
    elapsedDays: number;
    remainingDays: number;
    expectedPercent: number;
    coveragePercent: number;
    dailyRequired: number;
  };
  deals: { openCount: number; openValue: number; wonThisMonthCount: number };
  activities: Array<{
    id: string;
    title: string;
    dueDate: string | null;
    dealId: string;
    dealTitle: string;
  }>;
  directives: Array<{
    id: string;
    dealId: string;
    dealTitle: string;
    dealValue: number;
    instruction: string;
    priority: string;
    assignedDate: string;
    status: string;
    overdue: boolean;
  }>;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const percent = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Target;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="text-[11px] font-bold uppercase tracking-widest">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <strong className="mt-4 block text-2xl font-extrabold tracking-tight text-foreground">
        {value}
      </strong>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function CommercialHomeView() {
  const { tenant, setActiveView } = useChat();
  const navigate = useNavigate();
  const [data, setData] = useState<CommercialHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDirective, setSelectedDirective] = useState<
    CommercialHome["directives"][number] | null
  >(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/commercial/home", { credentials: "same-origin", signal });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "Você não tem acesso ao Início Comercial."
            : "Falha ao carregar seus indicadores comerciais.",
        );
      const home = (await response.json()) as CommercialHome;
      if (!signal?.aborted) setData(home);
    } catch (cause) {
      if (!signal?.aborted)
        setError(
          cause instanceof Error ? cause.message : "Falha ao carregar seus indicadores comerciais.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, tenant]);

  const openDeal = (dealId: string) =>
    navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });
  const firstName = data?.consultant.name.trim().split(/\s+/)[0] || "consultor";
  const division =
    data?.consultant.division === "personnalite"
      ? "Personnalité"
      : data?.consultant.division === "maquinas"
        ? "Máquinas"
        : "Equipe comercial";
  const progress = Math.min(100, Math.max(0, data?.goal.coveragePercent ?? 0));

  return (
    <section className="h-full min-w-0 flex-1 overflow-y-auto rounded-3xl border border-border bg-background px-4 py-5 shadow-soft sm:px-7 sm:py-7">
      <div className="mx-auto max-w-[1450px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-primary">
              Tecfag · Início Comercial
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              Bom dia, {firstName}
              <span className="text-primary">.</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Seu foco de hoje está aqui: acompanhe o ritmo, execute as diretrizes e avance suas
              negociações.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </button>
        </div>

        {loading && !data ? (
          <div className="flex min-h-[300px] items-center justify-center text-primary">
            <Loader2 className="h-7 w-7 animate-spin" aria-label="Carregando início comercial" />
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {error}
          </div>
        ) : data ? (
          <>
            <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-[#111216] px-5 py-6 text-white sm:px-7">
              <div className="absolute -right-14 -top-20 h-64 w-64 rounded-full border-[38px] border-primary/10" />
              <div className="relative flex flex-wrap items-end justify-between gap-6">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                    <Flame className="h-4 w-4" /> Ritmo de hoje · {division}
                  </div>
                  <h2 className="mt-3 max-w-xl text-2xl font-extrabold tracking-tight sm:text-3xl">
                    Você precisa fechar o próximo passo.
                  </h2>
                  <p className="mt-2 text-sm text-zinc-400">
                    {data.directives.length} diretriz{data.directives.length === 1 ? "" : "es"}{" "}
                    aberta{data.directives.length === 1 ? "" : "s"} ·{" "}
                    {data.directives.filter((item) => item.overdue).length} em atraso
                  </p>
                </div>
                <button
                  onClick={() => setActiveView("crm")}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-extrabold text-white hover:opacity-90"
                >
                  Abrir negociações <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Faturado acumulado"
                value={money.format(data.goal.realizedValue)}
                hint="Soma dos negócios ganhos neste mês"
                icon={TrendingUp}
              />
              <MetricCard
                label="Ritmo necessário / dia"
                value={data.goal.configured ? money.format(data.goal.dailyRequired) : "—"}
                hint={`${data.goal.remainingDays} dias úteis restantes`}
                icon={Clock3}
              />
              <MetricCard
                label="Negociações abertas"
                value={String(data.deals.openCount)}
                hint={money.format(data.deals.openValue)}
                icon={Wallet}
              />
              <MetricCard
                label="Vendas no mês"
                value={String(data.deals.wonThisMonthCount)}
                hint={division}
                icon={Target}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
                        Progresso da meta
                      </p>
                      <h2 className="mt-1 text-xl font-extrabold text-foreground">
                        {data.goal.configured
                          ? `${percent.format(data.goal.coveragePercent)}%`
                          : "Meta ainda não definida"}
                      </h2>
                    </div>
                    {data.goal.configured && (
                      <span className="text-right text-xs text-muted-foreground">
                        Meta mensal
                        <br />
                        <strong className="text-sm text-foreground">
                          {money.format(data.goal.targetValue)}
                        </strong>
                      </span>
                    )}
                  </div>
                  {data.goal.configured && (
                    <>
                      <div className="relative mt-5 h-3 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="mt-2 flex justify-between gap-3 text-[11px] text-muted-foreground">
                        <span>Faturado: {money.format(data.goal.realizedValue)}</span>
                        <span>Esperado hoje: {percent.format(data.goal.expectedPercent)}%</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
                        Diretrizes do gestor
                      </p>
                      <h2 className="mt-1 text-lg font-extrabold text-foreground">
                        O que move o ponteiro hoje
                      </h2>
                    </div>
                    <Target className="h-5 w-5 text-primary" />
                  </div>
                  {data.directives.length === 0 ? (
                    <p className="rounded-xl bg-muted/50 p-5 text-sm text-muted-foreground">
                      Nenhuma diretriz aberta para você.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {data.directives.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-border p-4 transition hover:border-primary/50 hover:bg-muted/40"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <strong className="truncate text-sm text-foreground">
                                  {item.dealTitle}
                                </strong>
                                {item.overdue && (
                                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                                    Atrasada
                                  </span>
                                )}
                                {item.priority !== "normal" && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                    Prioridade {item.priority === "critical" ? "crítica" : "alta"}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {item.instruction}
                              </p>
                            </div>
                            <span className="shrink-0 text-xs font-bold text-foreground">
                              {money.format(item.dealValue)}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => setSelectedDirective(item)}
                              className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white"
                            >
                              Concluir com evidência
                            </button>
                            <button
                              onClick={() => openDeal(item.dealId)}
                              className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-foreground"
                            >
                              Abrir negociação
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="mb-4 flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
                      Agenda de hoje
                    </p>
                    <h2 className="mt-1 text-lg font-extrabold text-foreground">
                      {data.activities.length} compromisso{data.activities.length === 1 ? "" : "s"}
                    </h2>
                  </div>
                </div>
                {data.activities.length === 0 ? (
                  <p className="rounded-xl bg-muted/50 p-5 text-sm text-muted-foreground">
                    Nenhuma atividade comercial agendada para hoje.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.activities.map((activity) => (
                      <button
                        key={activity.id}
                        onClick={() => openDeal(activity.dealId)}
                        className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left hover:border-primary/50 hover:bg-muted/40"
                      >
                        <span className="w-12 shrink-0 text-xs font-extrabold text-primary">
                          {activity.dueDate
                            ? new Date(activity.dueDate).toLocaleTimeString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </span>
                        <span className="min-w-0">
                          <strong className="block truncate text-xs text-foreground">
                            {activity.title}
                          </strong>
                          <small className="block truncate text-muted-foreground">
                            {activity.dealTitle}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
      {selectedDirective && (
        <CommercialEvidenceDialog
          directive={selectedDirective}
          onClose={() => setSelectedDirective(null)}
          onOpenDeal={() => {
            const dealId = selectedDirective.dealId;
            setSelectedDirective(null);
            void openDeal(dealId);
          }}
          onCompleted={() => {
            setSelectedDirective(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
