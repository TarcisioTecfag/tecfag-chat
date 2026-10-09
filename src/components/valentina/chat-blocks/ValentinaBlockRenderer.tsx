// ══════════════════════════════════════════════════════════════════════════════
// 📊 VALENTINA BLOCK RENDERER — Renderizador de blocos visuais ricos
// ══════════════════════════════════════════════════════════════════════════════

import React from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDownRight, ArrowUpRight, Download, Minus, MessageSquareQuote, Sparkles, AlertTriangle, UserCheck, ArrowRight, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ChartBlock, ExcerptBlock, InsightBlock, ValentinaMessageBlock, ReportBlock, LeadCardBlock, SlaAlertBlock,
} from "./valentina-chat-types";

const CHART_COLORS = [
  "#10b981", // primary emerald
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#ec4899", // pink
];

function BlockCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="my-2 rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:border-primary/30">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-foreground tracking-tight">{title}</h3>
          {subtitle ? <p className="text-[11px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

const tooltipStyle = {
  contentStyle: {
    borderRadius: 12,
    border: "1px solid var(--color-border, #e5e7eb)",
    background: "var(--color-card, #ffffff)",
    fontSize: 12,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  },
  labelStyle: { color: "#6b7280", fontSize: 11, fontWeight: 600 },
};

function ChartRender({ block }: { block: ChartBlock }) {
  return (
    <BlockCard title={block.title} subtitle={block.subtitle}>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {block.chart === "bar" ? (
            <BarChart data={block.data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip cursor={{ fill: "#f8fafc" }} {...tooltipStyle} />
              <Bar dataKey="value" radius={[6, 6, 2, 2]} fill="#10b981" maxBarSize={40} isAnimationActive={false} />
            </BarChart>
          ) : block.chart === "line" ? (
            <LineChart data={block.data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              {block.data.some((d) => d.value2 !== undefined) && (
                <Line type="monotone" dataKey="value2" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              )}
            </LineChart>
          ) : (
            <PieChart>
              <Tooltip {...tooltipStyle} />
              <Pie data={block.data} dataKey="value" nameKey="label" innerRadius={42} outerRadius={72} paddingAngle={3} stroke="#ffffff" isAnimationActive={false}>
                {block.data.map((entry, index) => (
                  <Cell key={entry.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
      {block.chart === "pie" && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-border/40">
          {block.data.map((entry, index) => (
            <li key={entry.label} className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
              {entry.label} ({entry.value}%)
            </li>
          ))}
        </ul>
      )}
    </BlockCard>
  );
}

function InsightRender({ block }: { block: InsightBlock }) {
  return (
    <BlockCard
      title={block.title}
      action={
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-[10px] font-extrabold text-primary">
          <Sparkles className="h-3 w-3" /> IA Insight
        </span>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        {block.items.map((item) => {
          const Icon = item.trend === "up" ? ArrowUpRight : item.trend === "down" ? ArrowDownRight : Minus;
          return (
            <div key={item.label} className="rounded-xl bg-muted/60 p-2.5 border border-border/40">
              <p className="text-[11px] font-medium text-muted-foreground">{item.label}</p>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-base font-bold text-foreground tracking-tight">{item.value}</span>
                {item.delta && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 text-[11px] font-semibold",
                      item.trend === "up" && "text-emerald-600 dark:text-emerald-400",
                      item.trend === "down" && "text-rose-600 dark:text-rose-400",
                      (!item.trend || item.trend === "flat") && "text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {item.delta}
                  </span>
                )}
              </div>
              {item.hint && <p className="mt-0.5 text-[10px] text-muted-foreground/80">{item.hint}</p>}
            </div>
          );
        })}
      </div>
      {block.recommendation && (
        <div className="mt-3 rounded-xl border border-primary/20 bg-primary-soft/60 p-3 text-xs leading-relaxed text-foreground flex items-start gap-1.5">
          <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-primary mr-1">Recomendação:</span>
            {block.recommendation}
          </div>
        </div>
      )}
    </BlockCard>
  );
}

function ReportRender({ block }: { block: ReportBlock }) {
  return (
    <BlockCard
      title={block.title}
      subtitle={block.footnote}
      action={
        <button
          type="button"
          onClick={() => {
            const csvContent = [block.columns.join(","), ...block.rows.map((r) => r.join(","))].join("\n");
            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.setAttribute("download", `${block.title.toLowerCase().replace(/\s+/g, "_")}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
        >
          <Download className="h-3 w-3" /> Exportar
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/80 text-left bg-muted/40">
              {block.columns.map((col) => (
                <th key={col} className="whitespace-nowrap px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rIdx) => (
              <tr key={rIdx} className="border-b border-border/40 hover:bg-muted/20 transition-colors last:border-0">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className={cn("whitespace-nowrap px-3 py-2 text-foreground", cIdx === 0 && "font-semibold text-foreground")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlockCard>
  );
}

function ExcerptRender({ block }: { block: ExcerptBlock }) {
  return (
    <BlockCard title={block.title}>
      <div className="grid gap-2.5">
        {block.conversations.map((conv, idx) => (
          <article key={idx} className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <header className="mb-2 flex flex-wrap items-center gap-2">
              <MessageSquareQuote className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-bold text-foreground">{conv.lead}</span>
              <span className="text-[10px] text-muted-foreground">
                {conv.channel} · {conv.when}
              </span>
              <span
                className={cn(
                  "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold",
                  conv.sentiment === "positivo" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
                  conv.sentiment === "negativo" && "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
                  conv.sentiment === "neutro" && "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
                )}
              >
                {conv.sentiment}
              </span>
            </header>
            <div className="grid gap-1.5">
              {conv.lines.map((line, lIdx) => (
                <p
                  key={lIdx}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] leading-relaxed",
                    line.from === "lead" ? "bg-card border border-border/50 text-foreground" : "bg-primary-soft/80 text-foreground font-medium",
                  )}
                >
                  <span className="mr-1 font-bold text-muted-foreground">{line.from === "lead" ? "Lead:" : "Agente:"}</span>
                  {line.text}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </BlockCard>
  );
}

function LeadCardRender({ block }: { block: LeadCardBlock }) {
  return (
    <div className="my-2 rounded-2xl border border-primary/30 bg-primary-soft/70 p-3.5 text-xs shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <UserCheck className="h-4 w-4 text-primary" />
        <span className="font-extrabold text-primary text-xs">Lead Qualificado Identificado</span>
      </div>
      <div className="space-y-1 text-foreground">
        <p><span className="font-semibold text-muted-foreground">Nome:</span> {block.data.name || "—"}</p>
        <p><span className="font-semibold text-muted-foreground">Empresa:</span> {block.data.company || "—"}</p>
        {block.data.score && <p><span className="font-semibold text-muted-foreground">Score:</span> {block.data.score}/100</p>}
      </div>
      <button className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer">
        <ArrowRight className="h-3 w-3" /> Ver Detalhes no CRM
      </button>
    </div>
  );
}

function SlaAlertRender({ block }: { block: SlaAlertBlock }) {
  return (
    <div className="my-2 rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs shadow-sm">
      <div className="flex items-center gap-2 mb-1.5">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="font-extrabold text-amber-800 dark:text-amber-300 text-xs">Alerta de SLA Excedido</span>
      </div>
      <p className="text-amber-900 dark:text-amber-200 leading-relaxed">
        {block.data.description || `${block.data.clientName || "Cliente"} aguardando há mais de ${block.data.waitMinutes || "?"} minutos.`}
      </p>
    </div>
  );
}

export function ValentinaBlockRenderer({ block }: { block: ValentinaMessageBlock }) {
  switch (block.type) {
    case "text":
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap">
          {block.text}
        </div>
      );
    case "chart":
      return <ChartRender block={block} />;
    case "insight":
      return <InsightRender block={block} />;
    case "report":
      return <ReportRender block={block} />;
    case "excerpt":
      return <ExcerptRender block={block} />;
    case "lead_card":
      return <LeadCardRender block={block} />;
    case "sla_alert":
      return <SlaAlertRender block={block} />;
    default:
      return null;
  }
}
