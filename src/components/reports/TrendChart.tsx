import { useMemo } from "react";
import { cn } from "@/lib/utils";

export function TrendChart({
  data,
  target,
  goodWhen = "up",
  height = 120,
  className,
}: {
  data: { date: string; value: number }[];
  target?: number;
  goodWhen?: "up" | "down";
  height?: number;
  className?: string;
}) {
  const { line, area, min, max } = useMemo(() => {
    const values = data.map((d) => d.value);
    const lo = Math.min(...values, target ?? Infinity);
    const hi = Math.max(...values, target ?? -Infinity);
    const pad = (hi - lo) * 0.12 || 1;
    const min = lo - pad;
    const max = hi + pad;
    const x = (i: number) => (i / Math.max(1, data.length - 1)) * 100;
    const y = (v: number) => 100 - ((v - min) / (max - min)) * 100;
    const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(d.value).toFixed(2)}`).join(" ");
    const area = `${line} L100,100 L0,100 Z`;
    return { line, area, min, max };
  }, [data, target]);

  const targetY = target !== undefined ? 100 - ((target - min) / (max - min)) * 100 : null;
  const last = data[data.length - 1]?.value ?? 0;
  const first = data[0]?.value ?? 0;
  const improving = goodWhen === "up" ? last >= first : last <= first;

  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className={improving ? "text-primary" : "text-warning"}>
          <path d={area} fill="url(#trendFill)" />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        </g>
        {targetY !== null && (
          <line
            x1="0"
            x2="100"
            y1={targetY}
            y2={targetY}
            stroke="currentColor"
            className="text-muted-foreground/50"
            strokeWidth="0.6"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}
