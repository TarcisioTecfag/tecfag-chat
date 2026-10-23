import type { Signal } from "@/data/reports";

export const signalStyles: Record<Signal, { chip: string; dot: string; text: string; bar: string }> =
  {
    positive: {
      chip: "bg-primary/10 text-primary border-primary/25",
      dot: "bg-primary",
      text: "text-primary",
      bar: "bg-primary",
    },
    warning: {
      chip: "bg-muted text-foreground border-border",
      dot: "bg-muted-foreground",
      text: "text-foreground",
      bar: "bg-muted-foreground",
    },
    critical: {
      chip: "bg-primary/15 text-primary border-primary/30",
      dot: "bg-primary",
      text: "text-primary",
      bar: "bg-primary",
    },
    info: {
      chip: "bg-muted/60 text-muted-foreground border-border",
      dot: "bg-muted-foreground/70",
      text: "text-muted-foreground",
      bar: "bg-muted-foreground/70",
    },
  };