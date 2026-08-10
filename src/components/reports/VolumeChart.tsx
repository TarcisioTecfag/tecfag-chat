export function VolumeChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value));

  return (
    <div className="flex items-end gap-2">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">{d.value}</span>
          <div
            className="w-full rounded-t-md bg-primary/70 transition-all duration-700 hover:bg-primary"
            style={{ height: `${Math.max(10, Math.round((d.value / max) * 120))}px` }}
          />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}