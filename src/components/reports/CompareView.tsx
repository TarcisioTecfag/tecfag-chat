import type { StoredReport } from "@/data/reports";
import { trendMeta } from "@/data/reports";
import type { TrendKey } from "@/data/reports";
import { FindingCard } from "./FindingCard";
import { cn } from "@/lib/utils";

const keys: TrendKey[] = ["volume", "sla", "frt", "qa", "satisfied"];

export function CompareView({ current, previous }: { current: StoredReport; previous: StoredReport | null }) {
  if (!previous) {
    return (
      <div className="panel rounded-2xl p-6 text-sm text-muted-foreground">
        Não há um período anterior do mesmo tipo para comparar.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel rounded-2xl p-4 sm:p-5">
        <h2 className="text-lg font-semibold text-foreground">
          {current.code} <span className="text-muted-foreground">vs.</span> {previous.code}
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 font-medium">Indicador</th>
                <th className="pb-2 font-medium">{previous.code}</th>
                <th className="pb-2 font-medium">{current.code}</th>
                <th className="pb-2 font-medium">Variação</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const meta = trendMeta[k];
                const a = previous.kpis[k];
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
        {[current, previous].map((r) => (
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
