import { GitBranch, History } from "lucide-react";
import type { ReportVersion } from "@/data/reports";
import { stageMeta } from "@/data/reports";
import { cn } from "@/lib/utils";

export function VersionHistory({
  versions,
  activeVersion,
  onSelect,
}: {
  versions: ReportVersion[];
  activeVersion: string;
  onSelect: (version: string) => void;
}) {
  return (
    <section className="panel rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <History className="size-3.5" /> Versões do conteúdo
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground">{versions.length}</span>
      </div>

      <ul className="mt-3 space-y-2">
        {versions.map((v) => {
          const active = v.version === activeVersion;
          return (
            <li key={v.version}>
              <button
                onClick={() => onSelect(v.version)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition-colors",
                  active
                    ? "border-primary/50 bg-primary/10"
                    : "border-border bg-card/40 hover:border-primary/30",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "flex items-center gap-1.5 font-mono text-xs font-semibold",
                      active ? "text-primary" : "text-foreground",
                    )}
                  >
                    <GitBranch className="size-3" />
                    {v.version}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {stageMeta[v.stage].label}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{v.note}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {v.createdAt} · {v.author}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}