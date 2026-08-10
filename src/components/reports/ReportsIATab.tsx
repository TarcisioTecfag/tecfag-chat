/**
 * ReportsIATab.tsx — Aba Relatórios IA v2 (insight-navigator)
 *
 * Este componente é o wrapper que integra os componentes do insight-navigator
 * dentro do AnalyticsView do Valem Chat. Ele:
 * 1. Busca StoredReport[] da API /api/gestao/reports-v2
 * 2. Popula o store reativo em @/data/reports via loadReports()
 * 3. Renderiza a mesma árvore de componentes do insight-navigator original
 *
 * ZERO alterações nos componentes reports/ — eles importam de @/data/reports
 * exatamente como no projeto original.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Download,
  Lightbulb,
  Send,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { loadReports, previousOf, reports, stageMeta } from "@/data/reports";
import type { ApprovalStage, StoredReport } from "@/data/reports";
import { OverviewPanel } from "@/components/reports/OverviewPanel";
import { CompareView } from "@/components/reports/CompareView";
import { MetricCard } from "@/components/reports/MetricCard";
import { FindingCard } from "@/components/reports/FindingCard";
import { ActionCard } from "@/components/reports/ActionCard";
import { VolumeChart } from "@/components/reports/VolumeChart";
import { ReportSidebar } from "@/components/reports/ReportSidebar";
import { ApprovalPanel } from "@/components/reports/ApprovalPanel";
import { VersionHistory } from "@/components/reports/VersionHistory";
import { SectionFeedback } from "@/components/reports/SectionFeedback";
import type { FeedbackValue } from "@/components/reports/SectionFeedback";
import { signalStyles } from "@/components/reports/signal";
import { cn } from "@/lib/utils";

export function ReportsIATab({ tenant }: { tenant: string }) {
  const activeTenant = tenant && tenant !== "undefined" && tenant !== "null" ? tenant : "valem";
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch de dados da API ──
  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/gestao/reports-v2?tenantId=${activeTenant}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StoredReport[] = await res.json();
      loadReports(data);
      setLoaded(true);
      setError(null);
    } catch (e: any) {
      console.error("[ReportsIATab] Erro ao carregar relatórios:", e);
      setError(e.message);
      loadReports([]);
      setLoaded(true);
    }
  }, [activeTenant]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // ── Estado local (idêntico ao index.tsx do insight-navigator) ──
  const [activeId, setActiveId] = useState("");
  const [mode, setMode] = useState<"panorama" | "relatorio" | "comparar">("panorama");
  const [stages, setStages] = useState<Record<string, ApprovalStage>>({});
  const [versionByReport, setVersionByReport] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, FeedbackValue>>({});

  // Sincroniza estado quando os dados carregam
  useEffect(() => {
    if (loaded && reports.length > 0) {
      if (!activeId || !reports.find((r) => r.id === activeId)) {
        setActiveId(reports[0].id);
      }
      setStages((prev) => {
        const next = { ...prev };
        for (const r of reports) {
          if (!(r.id in next)) next[r.id] = r.stage;
        }
        return next;
      });
      setVersionByReport((prev) => {
        const next = { ...prev };
        for (const r of reports) {
          if (!(r.id in next)) next[r.id] = r.currentVersion;
        }
        return next;
      });
    }
  }, [loaded, reports.length]); // eslint-disable-line

  const report = reports.find((r) => r.id === activeId) ?? reports[0];

  // ── Workflow de aprovação (chama API) ──
  const stage = report ? (stages[report.id] ?? report.stage) : "rascunho";
  const activeVersion = report ? (versionByReport[report.id] ?? report.currentVersion) : "v1";
  const stageIndexMap: ApprovalStage[] = ["rascunho", "revisao", "aprovado", "enviado"];

  const setStage = (next: ApprovalStage) =>
    setStages((prev) => ({ ...prev, [report.id]: next }));

  const advance = async () => {
    const i = stageIndexMap.indexOf(stage);
    if (i < stageIndexMap.length - 1) {
      const nextStage = stageIndexMap[i + 1];
      setStage(nextStage);
      // Persiste via API
      try {
        await fetch("/api/gestao/report-workflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: activeTenant,
            reportId: report.id,
            action: "advance-stage",
            operatorId: "system",
          }),
        });
      } catch (e) {
        console.error("[ReportsIATab] Erro ao avançar stage:", e);
      }
    }
  };

  const reject = async () => {
    setStage("rascunho");
    try {
      await fetch("/api/gestao/report-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: activeTenant,
          reportId: report.id,
          action: "reject",
          operatorId: "system",
        }),
      });
    } catch (e) {
      console.error("[ReportsIATab] Erro ao rejeitar:", e);
    }
  };

  // ── Feedback por seção ──
  const feedbackKey = (section: string) => `${report?.id}:${activeVersion}:${section}`;
  const getFeedback = (section: string): FeedbackValue =>
    feedback[feedbackKey(section)] ?? { vote: null, comment: "" };
  const setSectionFeedback = (key: string, next: FeedbackValue) => {
    setFeedback((prev) => ({ ...prev, [key]: next }));
    // Persiste via API em background
    const parts = key.split(":");
    fetch("/api/gestao/report-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: activeTenant,
        reportId: parts[0],
        action: "feedback",
        version: parts[1],
        sectionId: parts[2],
        vote: next.vote,
        comment: next.comment,
        operatorId: "system",
      }),
    }).catch((e) => console.error("[ReportsIATab] Erro ao salvar feedback:", e));
  };

  const feedbackStats = useMemo(() => {
    if (!report) return { up: 0, down: 0, comments: 0 };
    const prefix = `${report.id}:${activeVersion}:`;
    const entries = Object.entries(feedback).filter(([k]) => k.startsWith(prefix));
    return {
      up: entries.filter(([, v]) => v.vote === "up").length,
      down: entries.filter(([, v]) => v.vote === "down").length,
      comments: entries.filter(([, v]) => v.comment).length,
    };
  }, [feedback, report?.id, activeVersion]);

  const sectionProps = (section: string, label: string) => ({
    sectionId: feedbackKey(section),
    label,
    value: getFeedback(section),
    onChange: setSectionFeedback,
  });

  const canSend = stage === "aprovado" || stage === "enviado";

  // ── Loading / Empty / Error ──
  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">Carregando relatórios...</p>
        </div>
      </div>
    );
  }

  if (error && reports.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">Erro ao carregar relatórios: {error}</p>
          <button
            onClick={fetchReports}
            className="text-sm text-primary hover:underline"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-3 max-w-md">
          <Sparkles className="size-12 text-primary/30 mx-auto" />
          <h3 className="text-lg font-semibold text-foreground">Nenhum relatório de IA gerado ainda</h3>
          <p className="text-sm text-muted-foreground">
            Os relatórios são compilados automaticamente todos os dias às 18h.
            O primeiro relatório aparecerá aqui após o encerramento do expediente de hoje.
          </p>
        </div>
      </div>
    );
  }

  if (!report) return null;

  // ── Render principal (mesma estrutura do insight-navigator/index.tsx) ──
  return (
    <div className="aurora" style={{ minHeight: "calc(100vh - 200px)" }}>
      <div className="grid-lines h-full">
        <main className="grid items-start gap-5 px-2 py-4 lg:grid-cols-[minmax(230px,250px)_minmax(0,1fr)] 2xl:grid-cols-[250px_minmax(0,1fr)_320px]">
          {/* ── Sidebar ── */}
          <div className="lg:sticky lg:top-4 space-y-4">
            <ReportSidebar reports={reports} activeId={activeId} onSelect={setActiveId} />
            <div className="2xl:hidden space-y-4">
              <ApprovalPanel report={report} stage={stage} onAdvance={advance} onReject={reject} />
              <VersionHistory
                versions={report.versions}
                activeVersion={activeVersion}
                onSelect={(v) => setVersionByReport((p) => ({ ...p, [report.id]: v }))}
              />
            </div>
          </div>

          {/* ── Área central ── */}
          <div className="space-y-5">
            {/* Tabs de modo */}
            <div className="flex gap-1 rounded-xl border border-border bg-card/60 p-1">
              {(["panorama", "relatorio", "comparar"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize transition-colors",
                    mode === m
                      ? "bg-primary/12 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "relatorio" ? "Relatório" : m === "comparar" ? "Comparar" : "Panorama"}
                </button>
              ))}
            </div>

            {/* Panorama */}
            {mode === "panorama" && (
              <OverviewPanel
                latest={reports[0]}
                onOpen={(id) => {
                  setActiveId(id);
                  setMode("relatorio");
                }}
              />
            )}

            {/* Comparar */}
            {mode === "comparar" && <CompareView current={report} previous={previousOf(report)} />}

            {/* Relatório */}
            <div className={cn("space-y-5", mode !== "relatorio" && "hidden")}>
              {/* Hero do relatório */}
              <section className="panel relative overflow-hidden rounded-2xl p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                    Relatório {report.kind}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{report.code}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider",
                      signalStyles[stageMeta[stage].signal].chip,
                    )}
                  >
                    {stageMeta[stage].label}
                  </span>
                  <span className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
                    {activeVersion}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    Sincronizado via IA em {report.syncedAt}
                  </span>
                </div>

                <div className="mt-4 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
                  <div>
                    <h2 className="text-2xl font-semibold leading-snug text-foreground">
                      {report.headline}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">Período: {report.period}</p>
                    <p className="mt-3 text-[15px] leading-relaxed text-foreground/80">
                      {report.summary}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {report.sources.map((source) => (
                        <span
                          key={source}
                          className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] text-muted-foreground"
                        >
                          {source}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        disabled={!canSend}
                        title={canSend ? undefined : "Aprove o relatório antes de enviar"}
                        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Send className="size-4" /> Enviar à diretoria
                      </button>
                      <button className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40">
                        <Download className="size-4" /> Exportar PDF
                      </button>
                      <button
                        disabled={!canSend}
                        className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Bell className="size-4" /> Agendar no WhatsApp
                      </button>
                      <div className="ml-auto">
                        <SectionFeedback {...sectionProps("resumo", "Resumo executivo")} />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                    {report.metrics.map((metric) => (
                      <MetricCard key={metric.label} metric={metric} />
                    ))}
                  </div>
                </div>
              </section>

              {/* Volume + sentimento */}
              <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
                <div className="panel rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <TrendingUp className="size-4 text-primary" /> Distribuição de volume
                    </h3>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {report.kind === "Semanal" ? "Por dia" : "Por faixa horária"}
                      </span>
                      <SectionFeedback {...sectionProps("volume", "Distribuição de volume")} />
                    </div>
                  </div>
                  <div className="mt-4">
                    <VolumeChart data={report.volumeSeries} />
                  </div>
                </div>

                <div className="panel rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Sentimento do cliente</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Inferido pela auditoria qualitativa da IA
                      </p>
                    </div>
                    <SectionFeedback {...sectionProps("sentimento", "Sentimento do cliente")} />
                  </div>
                  <div className="mt-4 space-y-3">
                    {report.sentiment.map((s) => (
                      <div key={s.label}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <span className={cn("size-2 rounded-full", signalStyles[s.signal].dot)} />
                            {s.label}
                          </span>
                          <span className="font-mono text-foreground">{s.value}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn("h-full rounded-full", signalStyles[s.signal].bar)}
                            style={{ width: `${s.value}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Destaques e falhas */}
              <section className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-positive" /> Destaques positivos
                    </h3>
                    <SectionFeedback {...sectionProps("destaques", "Destaques positivos")} />
                  </div>
                  {report.highlights.map((f) => (
                    <FindingCard key={f.title} finding={f} />
                  ))}
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-warning" /> Oportunidades de melhoria
                    </h3>
                    <SectionFeedback {...sectionProps("gaps", "Oportunidades de melhoria")} />
                  </div>
                  {report.gaps.map((f) => (
                    <FindingCard key={f.title} finding={f} />
                  ))}
                </div>
              </section>

              {/* Plano de ação */}
              <section className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Lightbulb className="size-4 text-primary" />
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                    Plano de ação recomendado pela IA
                  </h3>
                  <div className="ml-auto">
                    <SectionFeedback {...sectionProps("acoes", "Plano de ação")} />
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Recomendações priorizadas por impacto estimado sobre o SLA e a conversão comercial
                  do próximo ciclo.
                </p>
                <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {report.actions.map((action, i) => (
                    <ActionCard key={action.title} action={action} index={i} />
                  ))}
                </div>
              </section>

              <p className="pb-4 text-center text-xs text-muted-foreground">
                Relatório gerado autonomamente pela IA a partir de dados isolados por tenant · Grau de
                confiança {report.confidence}%
              </p>
            </div>
          </div>

          {/* ── Painel direito (2xl) ── */}
          <div className="hidden 2xl:sticky 2xl:top-4 2xl:block space-y-4">
            <ApprovalPanel report={report} stage={stage} onAdvance={advance} onReject={reject} />
            <VersionHistory
              versions={report.versions}
              activeVersion={activeVersion}
              onSelect={(v) => setVersionByReport((p) => ({ ...p, [report.id]: v }))}
            />
            <section className="panel rounded-2xl p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Feedback desta versão
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Suas avaliações por seção treinam as próximas recomendações da IA.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-border bg-card/50 p-2">
                  <p className="font-display text-lg text-positive">{feedbackStats.up}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">Úteis</p>
                </div>
                <div className="rounded-lg border border-border bg-card/50 p-2">
                  <p className="font-display text-lg text-critical">{feedbackStats.down}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">Não úteis</p>
                </div>
                <div className="rounded-lg border border-border bg-card/50 p-2">
                  <p className="font-display text-lg text-foreground">{feedbackStats.comments}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">Notas</p>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
