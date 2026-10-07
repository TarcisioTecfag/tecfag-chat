import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { Expand, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { CommercialForecastDrilldown } from "./CommercialForecastDrilldown";
import {
  CommercialCohortsPanel,
  CommercialResponsibilitiesPanel,
} from "./CommercialAnalysisPanels";
import { SystemTooltip } from "@/components/ui/tooltip";

type Tier = {
  tier: number;
  days: number;
  maxValue: number | null;
  readyCount: number;
  readyValue: number;
  pendingCount: number;
  pendingValue: number;
  expectedValue: number;
};
type Cohort = {
  dealId: string;
  title: string;
  operatorId: string;
  operatorName: string;
  stageName: string;
  value: number;
  tier: number;
  ageDays: number;
  daysRemaining: number;
  expectedValue: number;
};
type Goal = {
  operatorId: string;
  name: string;
  division: string | null;
  activeOnTv: boolean;
  targetValue: number;
  realizedValue: number;
  coveragePercent: number;
  expectedPercent: number;
  dailyRequired: number;
  wonCount: number;
};
type BiData = {
  asOf: string;
  month: string;
  division: string | null;
  settings: {
    slaLimitMinutes: number;
    tvSettings: {
      rotationSeconds?: number;
      activeModules?: number[];
      showSidebar?: boolean;
      liveNotice?: string;
    };
  };
  summary: {
    openCount: number;
    openValue: number;
    wonCount: number;
    faturado: number;
    targetValue: number;
    coveragePercent: number;
  };
  pipeline: Array<{ stageId: string; name: string; count: number; value: number }>;
  maturity: { tiers: Tier[]; cohorts: Cohort[] };
  goals: Goal[];
  losses: {
    currentCount: number;
    currentValue: number;
    previousCount: number;
    previousValue: number;
    historicalCount: number;
    reasons: Array<{ reason: string; count: number; value: number }>;
  };
  tma: {
    answeredCount: number;
    pendingCount: number;
    averageSeconds: number | null;
    slaPercent: number | null;
    byOperator: Array<{
      operatorId: string;
      name: string;
      count: number;
      averageSeconds: number | null;
      pending: number;
    }>;
  };
};

const modules = [
  "Pipeline",
  "Maturidade atual",
  "Previsão",
  "Metas e ritmo",
  "Perdas",
  "TMA e SLA",
  "Responsabilidades",
  "Safras",
];
const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const surface = "rounded-2xl border border-white/10 bg-white/[0.045] p-5";
const badge = "text-[10px] font-extrabold uppercase tracking-[0.18em] text-red-400";

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-white/15 p-6 text-sm text-zinc-400">
      {text}
    </p>
  );
}
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={surface}>
      <p className={badge}>{label}</p>
      <strong className="mt-3 block text-2xl font-extrabold tracking-tight text-white">
        {value}
      </strong>
      {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

export function CommercialBiView() {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLElement>(null);
  const [division, setDivision] = useState("");
  const [module, setModule] = useState(0);
  const [rotating, setRotating] = useState(false);
  const [data, setData] = useState<BiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const [pointing, setPointing] = useState(false);
  const [pointResult, setPointResult] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/commercial/bi${division ? `?division=${encodeURIComponent(division)}` : ""}`,
          { credentials: "same-origin", signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Falha ao carregar BI comercial.");
        if (!signal?.aborted) setData(body);
      } catch (cause) {
        if (!signal?.aborted)
          setError(cause instanceof Error ? cause.message : "Falha ao carregar BI comercial.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [division],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const activeModules = useMemo(() => {
    const configured = data?.settings.tvSettings.activeModules;
    return Array.isArray(configured) && configured.length
      ? configured.filter((id) => Number.isInteger(id) && id >= 0 && id < 6)
      : [0, 1, 2, 3, 4, 5];
  }, [data]);
  useEffect(() => {
    if (module < 6 && activeModules.length && !activeModules.includes(module))
      setModule(activeModules[0]);
  }, [activeModules, module]);

  useTabNavigation({
    tabs: [...new Set([...activeModules, 6, 7])],
    activeTab: module,
    onChange: setModule,
  });
  useEffect(() => {
    if (!rotating || !activeModules.length) return;
    const interval = window.setInterval(
      () =>
        setModule(
          (current) =>
            activeModules[(Math.max(0, activeModules.indexOf(current)) + 1) % activeModules.length],
        ),
      Math.max(10, data?.settings.tvSettings.rotationSeconds || 30) * 1000,
    );
    return () => window.clearInterval(interval);
  }, [rotating, activeModules, data?.settings.tvSettings.rotationSeconds]);

  const openDeal = (dealId: string) =>
    navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });
  const maxPipeline = Math.max(1, ...(data?.pipeline.map((item) => item.value) || []));
  const tvGoals = data?.goals.filter((goal) => goal.activeOnTv) || [];
  const selectedDeals =
    data?.maturity.cohorts.filter((item) => selectedDealIds.includes(item.dealId)) || [];
  const selectedOperatorId = selectedDeals[0]?.operatorId;
  const toggleDeal = (item: Cohort) => {
    setPointResult(null);
    setSelectedDealIds((current) => {
      if (current.includes(item.dealId)) return current.filter((id) => id !== item.dealId);
      const first = data?.maturity.cohorts.find((deal) => deal.dealId === current[0]);
      return first && first.operatorId !== item.operatorId
        ? [item.dealId]
        : [...current, item.dealId];
    });
  };
  const pointResponsibilities = async () => {
    if (!selectedOperatorId || !selectedDeals.length) return;
    setPointing(true);
    setError(null);
    setPointResult(null);
    try {
      const response = await fetch("/api/commercial/directives/point", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorId: selectedOperatorId,
          dealIds: selectedDeals.map((deal) => deal.dealId),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao pontuar responsabilidades.");
      setPointResult(
        `${body.createdCount} responsabilidade(s) pontuada(s); ${body.alreadyAssignedCount} já registrada(s) hoje.`,
      );
      setSelectedDealIds([]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao pontuar responsabilidades.");
    } finally {
      setPointing(false);
    }
  };

  return (
    <section
      ref={panelRef}
      className="h-full min-w-0 flex-1 overflow-y-auto rounded-3xl border border-zinc-800 bg-[#101115] p-4 text-white shadow-soft sm:p-6"
    >
      <div className="w-full space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={badge}>Tecfag · Commercial War Room</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
              Inteligência Comercial
            </h1>
            <p className="mt-1 text-xs text-zinc-400">
              Dados do CRM próprio · atualizado{" "}
              {data
                ? new Date(data.asOf).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })
                : "—"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Divisão"
              value={division}
              onChange={(event) => setDivision(event.target.value)}
              className="rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-xs"
            >
              <option value="">Comercial inteiro</option>
              <option value="personnalite">Personnalité</option>
              <option value="maquinas">Máquinas</option>
            </select>
            <SystemTooltip content="Atualizar dados do BI TV agora">
              <button
                onClick={() => void load()}
                disabled={loading}
                className="rounded-lg border border-white/15 p-2 hover:bg-white/10 cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </SystemTooltip>
            <SystemTooltip content={rotating ? "Pausar rotação automática da TV" : "Iniciar rotação automática da TV"}>
              <button
                onClick={() => setRotating((current) => !current)}
                className="rounded-lg border border-white/15 p-2 hover:bg-white/10 cursor-pointer"
              >
                {rotating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
            </SystemTooltip>
            <SystemTooltip content="Exibir BI TV em modo tela cheia">
              <button
                onClick={() => void panelRef.current?.requestFullscreen()}
                className="rounded-lg border border-white/15 p-2 hover:bg-white/10 cursor-pointer"
              >
                <Expand className="h-4 w-4" />
              </button>
            </SystemTooltip>
          </div>
        </header>
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Módulos do War Room">
          {modules.map(
            (name, index) =>
              (activeModules.includes(index) || index >= 6) && (
                <button
                  key={name}
                  onClick={() => {
                    setModule(index);
                    setRotating(false);
                  }}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-bold ${module === index ? "border-red-500 bg-red-500/15 text-white" : "border-white/10 text-zinc-400 hover:bg-white/5"}`}
                >
                  {String(index + 1).padStart(2, "0")} · {name}
                </button>
              ),
          )}
        </nav>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200"
          >
            {error}
          </p>
        )}
        {pointResult && (
          <p
            role="status"
            className="rounded-xl border border-emerald-700 bg-emerald-950/30 p-3 text-sm text-emerald-200"
          >
            {pointResult}
          </p>
        )}
        {module === 1 && selectedDeals.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 p-3 text-sm">
            <span>
              {selectedDeals.length} negócio(s) de {selectedDeals[0].operatorName} selecionado(s).
            </span>
            <button
              type="button"
              onClick={() => void pointResponsibilities()}
              disabled={pointing}
              className="rounded-lg bg-red-600 px-3 py-2 font-semibold disabled:opacity-50"
            >
              {pointing ? "Registrando..." : "Pontuar responsabilidades"}
            </button>
            <button
              type="button"
              onClick={() => setSelectedDealIds([])}
              className="text-zinc-400 underline"
            >
              Limpar seleção
            </button>
          </div>
        )}
        {loading && !data ? (
          <div className="flex h-72 items-center justify-center text-red-400">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          data && (
            <>
              {module === 0 && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric label="Oportunidades ativas" value={String(data.summary.openCount)} />
                    <Metric
                      label="Valor em pipeline"
                      value={money.format(data.summary.openValue)}
                    />
                    <Metric
                      label="Faturado no mês"
                      value={money.format(data.summary.faturado)}
                      hint="Soma de negócios ganhos"
                    />
                  </div>
                  <div className={surface}>
                    <p className={badge}>Funil por etapa</p>
                    <h2 className="mt-1 text-xl font-bold">Onde estão as negociações</h2>
                    <div className="mt-5 space-y-4">
                      {data.pipeline.length ? (
                        data.pipeline.map((stage) => (
                          <div key={stage.stageId}>
                            <div className="mb-1 flex justify-between gap-3 text-sm">
                              <span>
                                {stage.name}{" "}
                                <small className="text-zinc-400">({stage.count})</small>
                              </span>
                              <strong>{money.format(stage.value)}</strong>
                            </div>
                            <div className="h-3 rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-red-500"
                                style={{
                                  width: `${Math.max(2, (stage.value / maxPipeline) * 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <Empty text="Nenhuma negociação aberta nas etapas incluídas no War Room." />
                      )}
                    </div>
                  </div>
                </div>
              )}
              {module === 1 && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {data.maturity.tiers.map((tier) => (
                      <Metric
                        key={tier.tier}
                        label={`Faixa ${tier.tier} · ${tier.days} dias`}
                        value={money.format(tier.readyValue)}
                        hint={`${tier.readyCount} negócio(s) maduros`}
                      />
                    ))}
                  </div>
                  <div className={surface}>
                    <p className={badge}>Responsabilidades atuais</p>
                    <h2 className="mt-1 text-xl font-bold">Prontas ou atrasadas</h2>
                    <div className="mt-4 space-y-2">
                      {data.maturity.cohorts
                        .filter((item) => item.daysRemaining <= 0)
                        .slice(0, 30)
                        .map((item) => (
                          <div
                            key={item.dealId}
                            className="flex w-full flex-wrap justify-between gap-2 rounded-xl border border-white/10 p-3 text-left hover:border-red-500/50"
                          >
                            <span className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                aria-label={`Pontuar responsabilidade de ${item.title}`}
                                checked={selectedDealIds.includes(item.dealId)}
                                onChange={() => toggleDeal(item)}
                              />
                              <button
                                type="button"
                                onClick={() => openDeal(item.dealId)}
                                className="text-left hover:underline"
                              >
                                <strong>{item.title}</strong>
                              </button>
                              <small className="ml-2 text-zinc-400">
                                {item.operatorName} · {item.stageName} · {item.ageDays} dias
                              </small>
                            </span>
                            <span className="font-bold">{money.format(item.value)}</span>
                          </div>
                        ))}
                      {!data.maturity.cohorts.some((item) => item.daysRemaining <= 0) && (
                        <Empty text="Nenhuma responsabilidade madura agora." />
                      )}
                    </div>
                  </div>
                </div>
              )}
              {module === 2 && (
                <div className="space-y-4">
                  <CommercialForecastDrilldown
                    division={division}
                    onOpenDeal={openDeal}
                    onPointed={() => void load()}
                  />
                </div>
              )}
              {module === 3 && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric label="Meta total" value={money.format(data.summary.targetValue)} />
                    <Metric label="Faturado" value={money.format(data.summary.faturado)} />
                    <Metric
                      label="Cobertura"
                      value={`${number.format(data.summary.coveragePercent)}%`}
                    />
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {tvGoals.map((goal) => (
                      <div key={goal.operatorId} className={surface}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className={badge}>
                              {goal.division === "maquinas" ? "Máquinas" : "Personnalité"}
                            </p>
                            <h3 className="mt-1 text-lg font-bold">{goal.name}</h3>
                          </div>
                          <strong className="text-2xl">
                            {number.format(goal.coveragePercent)}%
                          </strong>
                        </div>
                        <div className="mt-4 h-2 rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-red-500"
                            style={{ width: `${Math.min(100, goal.coveragePercent)}%` }}
                          />
                        </div>
                        <p className="mt-3 text-xs text-zinc-400">
                          {money.format(goal.realizedValue)} de {money.format(goal.targetValue)} ·
                          esperado hoje {number.format(goal.expectedPercent)}% · necessário/dia{" "}
                          {money.format(goal.dailyRequired)}
                        </p>
                      </div>
                    ))}
                    {!tvGoals.length && (
                      <Empty text="Configure consultores e metas em Gestão Comercial para exibir o ritmo." />
                    )}
                  </div>
                </div>
              )}
              {module === 4 && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric
                      label="Perdas no mês"
                      value={String(data.losses.currentCount)}
                      hint={money.format(data.losses.currentValue)}
                    />
                    <Metric
                      label="Mês anterior"
                      value={String(data.losses.previousCount)}
                      hint={money.format(data.losses.previousValue)}
                    />
                    <Metric label="Histórico" value={String(data.losses.historicalCount)} />
                  </div>
                  <div className={surface}>
                    <p className={badge}>Motivos de perda no mês</p>
                    <div className="mt-4 space-y-2">
                      {data.losses.reasons.length ? (
                        data.losses.reasons.map((item) => (
                          <div
                            key={item.reason}
                            className="flex justify-between gap-3 border-b border-white/10 py-2 text-sm"
                          >
                            <span>{item.reason}</span>
                            <strong>
                              {item.count} · {money.format(item.value)}
                            </strong>
                          </div>
                        ))
                      ) : (
                        <Empty text="Nenhuma perda registrada neste mês." />
                      )}
                    </div>
                  </div>
                </div>
              )}
              {module === 5 && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Metric
                      label="TMA geral"
                      value={
                        data.tma.averageSeconds === null
                          ? "—"
                          : `${number.format(data.tma.averageSeconds / 60)} min`
                      }
                      hint="Transferência → primeira resposta"
                    />
                    <Metric
                      label="Dentro do SLA"
                      value={
                        data.tma.slaPercent === null
                          ? "—"
                          : `${number.format(data.tma.slaPercent)}%`
                      }
                      hint={`Limite: ${data.settings.slaLimitMinutes} min`}
                    />
                    <Metric label="Respostas medidas" value={String(data.tma.answeredCount)} />
                    <Metric label="Pendentes" value={String(data.tma.pendingCount)} />
                  </div>
                  <div className={surface}>
                    <p className={badge}>Ranking de resposta</p>
                    <div className="mt-4 space-y-2">
                      {data.tma.byOperator
                        .filter((item) => item.count || item.pending)
                        .map((item, index) => (
                          <div
                            key={item.operatorId}
                            className="flex justify-between gap-3 border-b border-white/10 py-2 text-sm"
                          >
                            <span>
                              {index + 1}. {item.name}{" "}
                              <small className="text-zinc-400">
                                · {item.count} respostas · {item.pending} pendentes
                              </small>
                            </span>
                            <strong>
                              {item.averageSeconds === null
                                ? "—"
                                : `${number.format(item.averageSeconds / 60)} min`}
                            </strong>
                          </div>
                        ))}
                      {!data.tma.byOperator.some((item) => item.count || item.pending) && (
                        <Empty text="O TMA começa quando um atendimento é atribuído a um consultor comercial." />
                      )}
                    </div>
                  </div>
                </div>
              )}
              {module === 6 && (
                <CommercialResponsibilitiesPanel division={division} onOpenDeal={openDeal} />
              )}
              {module === 7 && <CommercialCohortsPanel division={division} onOpenDeal={openDeal} />}
            </>
          )
        )}

        {/* Rodapé com Aviso ao Vivo no BI TV */}
        {data?.settings?.tvSettings?.liveNotice && (
          <div className="mt-4 flex items-center justify-center gap-3 rounded-2xl border border-red-500/40 bg-red-500/15 px-6 py-3.5 text-center shadow-lg animate-pulse">
            <span className="text-lg">📢</span>
            <span className="text-sm font-extrabold tracking-wide text-white">
              {data.settings.tvSettings.liveNotice}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
