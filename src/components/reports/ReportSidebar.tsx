import { useMemo, useState } from "react";
import { CalendarDays, CalendarRange, Search, Filter } from "lucide-react";
import type { StoredReport } from "@/data/reports";
import { groupReports, stageMeta, coverage } from "@/data/reports";
import { signalStyles } from "./signal";
import { cn } from "@/lib/utils";

type KindFilter = "todos" | "Diário" | "Semanal";
type StageFilter = "todos" | "pendentes" | "enviados";

export function ReportSidebar({
  reports,
  activeId,
  onSelect,
}: {
  reports: StoredReport[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("todos");
  const [stage, setStage] = useState<StageFilter>("todos");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      if (kind !== "todos" && r.kind !== kind) return false;
      if (stage === "pendentes" && r.stage === "enviado") return false;
      if (stage === "enviados" && r.stage !== "enviado") return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.headline.toLowerCase().includes(q) ||
        r.themes.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [reports, query, kind, stage]);

  const groups = useMemo(() => groupReports(filtered), [filtered]);

  return (
    <aside className="panel flex flex-col rounded-2xl p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Arquivo de relatórios
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">{coverage.total}</span>
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por período ou tema"
          className="w-full rounded-lg border border-border bg-card/60 py-2 pl-8 pr-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {(["todos", "Diário", "Semanal"] as KindFilter[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
              kind === k
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {k === "todos" ? "Todos" : k}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Filter className="size-3 text-muted-foreground" />
        {(["todos", "pendentes", "enviados"] as StageFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStage(s)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] capitalize transition-colors",
              stage === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-3 max-h-[calc(100vh-330px)] space-y-3 overflow-y-auto pr-1">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="sticky top-0 z-10 bg-card/90 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground backdrop-blur">
              {group.label} · {group.items.length}
            </p>
            <div className="space-y-1">
              {group.items.map((report) => {
                const active = report.id === activeId;
                const Icon = report.kind === "Semanal" ? CalendarRange : CalendarDays;
                const meta = stageMeta[report.stage];
                return (
                  <button
                    key={report.id}
                    onClick={() => onSelect(report.id)}
                    className={cn(
                      "w-full rounded-lg border px-2.5 py-2 text-left transition-all",
                      active
                        ? "border-primary/50 bg-primary/10"
                        : "border-transparent hover:border-border hover:bg-card",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          report.kind === "Semanal" ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate font-mono text-[11px]",
                          active ? "text-primary" : "text-foreground",
                        )}
                      >
                        {report.code}
                      </span>
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          signalStyles[meta.signal].dot,
                          report.stage === "enviado" && "opacity-40",
                        )}
                        title={meta.label}
                      />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {report.headline}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!groups.length && (
          <p className="py-6 text-center text-xs text-muted-foreground">Nenhum relatório encontrado.</p>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-dashed border-border p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Próxima geração
        </p>
        <p className="mt-0.5 text-xs text-foreground">Hoje, 18:00 BRT · Diário</p>
        <p className="text-[11px] text-muted-foreground">
          Cobertura {coverage.firstDate} → {coverage.lastDate}
        </p>
      </div>
    </aside>
  );
}
