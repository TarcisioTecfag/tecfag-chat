import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarCheck, Repeat2, Sparkles, ThumbsUp } from "lucide-react";
import type { StoredReport, TrendKey } from "@/data/reports";
import {
  coverage,
  feedbackTotals,
  pendingApprovals,
  periodAverage,
  stageMeta,
  themeRanking,
  trendMeta,
  trendSeries,
  dailyReports,
} from "@/data/reports";
import { TrendChart } from "./TrendChart";
import { signalStyles } from "./signal";
import { cn } from "@/lib/utils";

const keys: TrendKey[] = ["sla", "volume", "frt", "qa", "satisfied"];

export function OverviewPanel({
  onOpen,
  latest,
}: {
  onOpen: (id: string) => void;
  latest: StoredReport;
}) {
  const [active, setActive] = useState<TrendKey>("sla");
  const [range, setRange] = useState(30);

  const series = useMemo(() => trendSeries(active, range), [active, range]);
  const meta = trendMeta[active];
  const current = periodAverage(active, 0, range);
  const previous = periodAverage(active, range, range * 2);
  const delta = previous ? ((current - previous) / previous) * 100 : 0;
  const good = meta.goodWhen === "up" ? delta >= 0 : delta <= 0;
  const themes = useMemo(() => themeRanking(range), [range]);
  const feedback = feedbackTotals();

  const heatmap = useMemo(() => dailyReports.slice(0, 70).reverse(), []);

  return (
    <div className="space-y-4">
      <section className="panel rounded-2xl p-4 sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-foreground">Panorama de {coverage.days} dias</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {coverage.total} relatórios sintetizados ({coverage.daily} diários · {coverage.weekly}{" "}
              semanais) entre {coverage.firstDate} e {coverage.lastDate}.
            </p>
          </div>
          <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-card/60 p-1">
            {[7, 30, 90].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  range === r ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {keys.map((k) => (
                <button
                  key={k}
                  onClick={() => setActive(k)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active === k
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {trendMeta[k].label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-baseline gap-3">
              <span className="font-display text-3xl font-semibold text-foreground">
                {meta.format(current)}
              </span>
              <span className={cn("text-xs font-medium", good ? "text-positive" : "text-critical")}>
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}% vs. {range}d anteriores
              </span>
            </div>
            <TrendChart data={series} target={meta.target} goodWhen={meta.goodWhen} height={150} />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>{series[0]?.date}</span>
              <span>{series[series.length - 1]?.date}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-xl border border-border bg-card/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <AlertTriangle className="size-3.5 text-warning" /> Aguardando aprovação
              </p>
              <div className="mt-2 space-y-1.5">
                {pendingApprovals.slice(0, 4).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onOpen(r.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2 text-left transition-colors hover:border-primary/40"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                      {r.code}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        signalStyles[stageMeta[r.stage].signal].chip,
                      )}
                    >
                      {stageMeta[r.stage].label}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                {!pendingApprovals.length && (
                  <p className="text-xs text-muted-foreground">Nenhuma pendência na fila.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <CalendarCheck className="size-3.5 text-primary" /> Distribuição
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <Stat label="Enviados" value={coverage.sent} />
                <Stat label="Pendentes" value={pendingApprovals.length} tone="warning" />
                <Stat label="Semanais" value={coverage.weekly} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="panel rounded-2xl p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="size-4 text-primary" /> Linha do tempo de SLA (70 dias)
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada bloco é um relatório diário. Clique para abrir.
          </p>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(14px,1fr))] gap-1">
            {heatmap.map((r) => {
              const tone =
                r.kpis.sla >= 92 ? "bg-positive" : r.kpis.sla >= 88 ? "bg-warning" : "bg-critical";
              return (
                <button
                  key={r.id}
                  onClick={() => onOpen(r.id)}
                  title={`${r.code} · SLA ${r.kpis.sla.toFixed(1)}%`}
                  className={cn(
                    "h-5 rounded-[3px] opacity-80 transition-all hover:scale-110 hover:opacity-100",
                    tone,
                  )}
                />
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-positive" /> ≥ 92%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-warning" /> 88–92%
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-critical" /> &lt; 88%
            </span>
          </div>
        </div>

        <div className="panel rounded-2xl p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Repeat2 className="size-4 text-warning" /> Temas recorrentes ({range}d)
          </h3>
          <div className="mt-3 space-y-2">
            {themes.map((t) => (
              <div key={t.title}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-foreground">{t.title}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{t.count}x</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full rounded-full", signalStyles[t.signal].bar)}
                    style={{ width: `${Math.min(100, (t.count / range) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.05] p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <ThumbsUp className="size-3.5" /> Aprendizado da IA
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {feedback.up} avaliações úteis, {feedback.down} descartadas e {feedback.comments} comentários
              acumulados ajustaram o peso das recomendações desde {coverage.firstDate}.
            </p>
          </div>
        </div>
      </section>

      <button
        onClick={() => onOpen(latest.id)}
        className="panel flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:border-primary/40"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            Último relatório · {latest.code}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{latest.headline}</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-2">
      <p className={cn("font-display text-lg", tone === "warning" ? "text-warning" : "text-foreground")}>
        {value}
      </p>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
    </div>
  );
}
