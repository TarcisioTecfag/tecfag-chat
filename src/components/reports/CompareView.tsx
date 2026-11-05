import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { StoredReport } from "@/data/reports";
import { reports, trendMeta } from "@/data/reports";
import type { TrendKey } from "@/data/reports";
import { FindingCard } from "./FindingCard";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const keys: TrendKey[] = ["volume", "sla", "frt", "qa", "satisfied"];

export function CompareView({
  current,
  previous,
}: {
  current: StoredReport;
  previous: StoredReport | null;
}) {
  const candidates = reports.filter((r) => r.id !== current.id && r.kind === current.kind);
  const [customPrevId, setCustomPrevId] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState(false);

  const effectivePrevious =
    (customPrevId ? reports.find((r) => r.id === customPrevId) : null) ??
    previous ??
    candidates[0] ??
    null;

  if (!effectivePrevious) {
    return (
      <div className="panel rounded-2xl p-6 text-sm text-muted-foreground">
        Não há um período anterior do mesmo tipo para comparar.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <span>{current.code}</span>
            <span className="text-muted-foreground">vs.</span>
            {candidates.length > 1 ? (
              <Popover open={openPicker} onOpenChange={setOpenPicker}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card/70 px-2.5 py-1 text-sm font-mono font-semibold text-foreground transition-colors hover:border-primary/40"
                  >
                    {effectivePrevious.code}
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-1.5">
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Comparar com período
                  </p>
                  <div className="max-h-56 overflow-y-auto space-y-0.5">
                    {candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCustomPrevId(c.id);
                          setOpenPicker(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          c.id === effectivePrevious.id
                            ? "bg-primary/12 text-primary font-semibold"
                            : "text-foreground hover:bg-muted",
                        )}
                      >
                        <span className="font-mono">{c.code}</span>
                        <span className="truncate ml-2 text-[10px] text-muted-foreground">
                          SLA {c.kpis.sla.toFixed(1)}%
                        </span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <span>{effectivePrevious.code}</span>
            )}
          </h2>
          <span className="text-xs text-muted-foreground">
            {current.period} · comparado a {effectivePrevious.period}
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 font-medium">Indicador</th>
                <th className="pb-2 font-medium">{effectivePrevious.code}</th>
                <th className="pb-2 font-medium">{current.code}</th>
                <th className="pb-2 font-medium">Variação</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const meta = trendMeta[k];
                const a = effectivePrevious.kpis[k];
                const b = current.kpis[k];
                const delta = a ? ((b - a) / a) * 100 : 0;
                const good = meta.goodWhen === "up" ? delta >= 0 : delta <= 0;
                return (
                  <tr key={k} className="border-t border-border/70">
                    <td className="py-2.5 text-muted-foreground">{meta.label}</td>
                    <td className="py-2.5 font-mono text-foreground/70">{meta.format(a)}</td>
                    <td className="py-2.5 font-mono font-semibold text-foreground">{meta.format(b)}</td>
                    <td className={cn("py-2.5 font-mono", good ? "text-positive" : "text-critical")}>
                      {delta >= 0 ? "+" : ""}
                      {delta.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {[current, effectivePrevious].map((r) => (
          <div key={r.id} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {r.code} · gargalos
            </h3>
            {r.gaps.map((g) => (
              <FindingCard key={g.title} finding={g} />
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
