import type { Signal } from "@/data/reports";

export const signalStyles: Record<Signal, { chip: string; dot: string; text: string; bar: string }> =
  {
    positive: {
      chip: "bg-positive/12 text-positive border-positive/30",
      dot: "bg-positive",
      text: "text-positive",
      bar: "bg-positive",
    },
    warning: {
      chip: "bg-warning/12 text-warning border-warning/30",
      dot: "bg-warning",
      text: "text-warning",
      bar: "bg-warning",
    },
    critical: {
      chip: "bg-critical/12 text-critical border-critical/30",
      dot: "bg-critical",
      text: "text-critical",
      bar: "bg-critical",
    },
    info: {
      chip: "bg-info/12 text-info border-info/30",
      dot: "bg-info",
      text: "text-info",
      bar: "bg-info",
    },
  };