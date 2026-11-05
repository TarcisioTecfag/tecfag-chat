/**
 * ReportsIATab.tsx — Aba Relatórios IA v2 (insight-navigator)
 *
 * Este componente é o wrapper que integra os componentes do insight-navigator
 * dentro do AnalyticsView do Valem Chat. Ele:
 * 1. Busca StoredReport[] da API /api/gestao/reports-v2
 * 2. Popula o store reativo em @/data/reports via loadReports()
 * 3. Renderiza a mesma árvore de componentes do insight-navigator original
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Download,
  Lightbulb,
  Send,
  Sparkles,
  TrendingUp,
  Check,
  X,
  Copy,
  RefreshCw,
} from "lucide-react";

import { loadReports, previousOf, stageMeta } from "@/data/reports";
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
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAiPersona } from "@/lib/ai-persona";
import { cn } from "@/lib/utils";

export function ReportsIATab({
  tenant,
  refreshTrigger = 0,
}: {
  tenant: string;
  refreshTrigger?: number;
}) {
  const activeTenant = tenant && tenant !== "undefined" && tenant !== "null" ? tenant : "valem";
  const persona = getAiPersona(activeTenant);

  const [reportList, setReportList] = useState<StoredReport[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isSynthing, setIsSynthing] = useState(false);

  // Estado local (idêntico ao index.tsx do insight-navigator)
  const [activeId, setActiveId] = useState("");
  const [mode, setMode] = useState<"panorama" | "relatorio" | "comparar">("panorama");
  const [stages, setStages] = useState<Record<string, ApprovalStage>>({});
  const [versionByReport, setVersionByReport] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, FeedbackValue>>({});

  // Estado do popover "Agendar no WhatsApp"
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [copiedWa, setCopiedWa] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    reportDailyWhatsapp: false,
    reportWeeklyWhatsapp: false,
    reportWhatsappNumbers: "",
    reportRequiresApproval: false,
  });
  const [fullReportSettings, setFullReportSettings] = useState<Record<string, any>>({});
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleSavedMsg, setScheduleSavedMsg] = useState<string | null>(null);

  // ── Fetch de dados da API ──
  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/gestao/reports-v2?tenantId=${activeTenant}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StoredReport[] = await res.json();
      loadReports(data);
      setReportList(data);

      // Hidrata feedback salvo no banco
      const hydratedFeedback: Record<string, FeedbackValue> = {};
      for (const r of data) {
        if (Array.isArray(r.userFeedback)) {
          for (const fb of r.userFeedback) {
            hydratedFeedback[`${r.id}:${fb.version}:${fb.sectionId}`] = {
              vote: fb.vote,
              comment: fb.comment ?? "",
            };
          }
        }
      }
      setFeedback((prev) => ({ ...hydratedFeedback, ...prev }));

      setLoaded(true);
      setError(null);
    } catch (e: any) {
      console.error("[ReportsIATab] Erro ao carregar relatórios:", e);
      setError(e.message);
      loadReports([]);
      setReportList([]);
      setLoaded(true);
    }
  }, [activeTenant]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports, refreshTrigger]);

  // Carrega configurações de envio para o Popover "Agendar no WhatsApp"
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch(`/api/settings/reports?tenantId=${activeTenant}`);
        if (res.ok) {
          const data = await res.json();
          setFullReportSettings(data);
          setScheduleForm({
            reportDailyWhatsapp: Boolean(data.reportDailyWhatsapp),
            reportWeeklyWhatsapp: Boolean(data.reportWeeklyWhatsapp),
            reportWhatsappNumbers: data.reportWhatsappNumbers || "",
            reportRequiresApproval: Boolean(data.reportRequiresApproval),
          });
        }
      } catch {}
    };
    loadSettings();
  }, [activeTenant]);

  // Sincroniza estado quando os dados carregam
  useEffect(() => {
    if (loaded && reportList.length > 0) {
      if (!activeId || !reportList.find((r) => r.id === activeId)) {
        setActiveId(reportList[0].id);
      }
      setStages((prev) => {
        const next = { ...prev };
        for (const r of reportList) {
          next[r.id] = r.stage;
        }
        return next;
      });
      setVersionByReport((prev) => {
        const next = { ...prev };
        for (const r of reportList) {
          if (!(r.id in next)) next[r.id] = r.currentVersion;
        }
        return next;
      });
    }
  }, [loaded, reportList, activeId]);

  const baseReport = reportList.find((r) => r.id === activeId) ?? reportList[0];
  const activeVersion = baseReport
    ? (versionByReport[baseReport.id] ?? baseReport.currentVersion)
    : "v1";

  // Se o usuário selecionou uma versão específica no VersionHistory e ela possui snapshot reportData, exibe o snapshot
  const report = useMemo(() => {
    if (!baseReport) return undefined;
    const versionEntry = baseReport.versions.find((v) => v.version === activeVersion);
    if (versionEntry?.reportData && typeof versionEntry.reportData === "object") {
      const snap = versionEntry.reportData as Partial<StoredReport>;
      return {
        ...baseReport,
        headline: snap.headline ?? baseReport.headline,
        summary: snap.summary ?? baseReport.summary,
        confidence: snap.confidence ?? baseReport.confidence,
        metrics: Array.isArray(snap.metrics) && snap.metrics.length > 0 ? snap.metrics : baseReport.metrics,
        sentiment: Array.isArray(snap.sentiment) && snap.sentiment.length > 0 ? snap.sentiment : baseReport.sentiment,
        volumeSeries:
          Array.isArray(snap.volumeSeries) && snap.volumeSeries.length > 0
            ? snap.volumeSeries
            : baseReport.volumeSeries,
        highlights: Array.isArray(snap.highlights) ? snap.highlights : baseReport.highlights,
        gaps: Array.isArray(snap.gaps) ? snap.gaps : baseReport.gaps,
        actions: Array.isArray(snap.actions) ? snap.actions : baseReport.actions,
        sources: Array.isArray(snap.sources) && snap.sources.length > 0 ? snap.sources : baseReport.sources,
      };
    }
    return baseReport;
  }, [baseReport, activeVersion]);

  // ── Workflow de aprovação (chama API) ──
  const stage = report ? (stages[report.id] ?? report.stage) : "rascunho";
  const stageIndexMap: ApprovalStage[] = ["rascunho", "revisao", "aprovado", "enviado"];

  const setStage = (next: ApprovalStage) => {
    if (!report) return;
    setStages((prev) => ({ ...prev, [report.id]: next }));
  };

  // Disparo manual à diretoria
  const dispatch = async () => {
    if (!report || isSending) return;
    setIsSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/gestao/report-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: activeTenant,
          reportId: report.id,
          action: "dispatch",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStage("enviado");
        const sent = [
          ...(data.dispatch?.whatsappSent ?? []).map((n: string) => `WhatsApp: ${n}`),
          ...(data.dispatch?.emailSent ?? []).map((e: string) => `E-mail: ${e}`),
        ];
        const errs: string[] = data.dispatch?.errors ?? [];
        setSendResult({
          ok: true,
          msg:
            sent.length > 0
              ? `Enviado para: ${sent.join(", ")}`
              : errs.length > 0
                ? `Marcado como enviado (Aviso: ${errs[0]})`
                : "Relatório marcado como enviado à diretoria.",
        });
        await fetchReports();
      } else {
        setSendResult({ ok: false, msg: data.error || "Erro ao enviar" });
      }
    } catch (e: any) {
      setSendResult({ ok: false, msg: e.message || "Erro de rede" });
      console.error("[ReportsIATab] Erro no dispatch:", e);
    } finally {
      setIsSending(false);
      setTimeout(() => setSendResult(null), 6000);
    }
  };

  const advance = async () => {
    if (!report) return;
    // Se já está aprovado, clicar em "Enviar à diretoria" no ApprovalPanel executa o dispatch real
    if (stage === "aprovado") {
      await dispatch();
      return;
    }
    const i = stageIndexMap.indexOf(stage);
    if (i < stageIndexMap.length - 1) {
      const nextStage = stageIndexMap[i + 1];
      setStage(nextStage);
      try {
        await fetch("/api/gestao/report-workflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: activeTenant,
            reportId: report.id,
            action: "advance-stage",
          }),
        });
        await fetchReports();
      } catch (e) {
        console.error("[ReportsIATab] Erro ao avançar stage:", e);
      }
    }
  };

  const reject = async () => {
    if (!report || isSynthing) return;
    setStage("rascunho");
    setIsSynthing(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/gestao/report-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: activeTenant,
          reportId: report.id,
          action: "reject",
        }),
      });
      const data = await res.json();
      await fetchReports();
      if (data?.version) {
        setVersionByReport((prev) => ({ ...prev, [report.id]: data.version }));
      }
    } catch (e) {
      console.error("[ReportsIATab] Erro ao rejeitar:", e);
    } finally {
      setIsSynthing(false);
    }
  };

  // Geração / Atualização sob demanda
  const generateNow = async (type: "daily" | "weekly" = "daily", period?: string) => {
    if (isSynthing) return;
    setIsSynthing(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/gestao/report-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: activeTenant,
          action: "generate",
          type,
          period,
        }),
      });
      const data = await res.json();
      await fetchReports();
      if (data?.reportId) {
        setActiveId(data.reportId);
        if (data?.version) {
          setVersionByReport((prev) => ({ ...prev, [data.reportId]: data.version }));
        }
        setSendResult({
          ok: true,
          msg: `Relatório ${data.version ?? "v1"} sincronizado com sucesso via IA.`,
        });
        setTimeout(() => setSendResult(null), 5000);
      }
    } catch (e: any) {
      setSendResult({ ok: false, msg: e.message || "Falha ao sincronizar relatório." });
    } finally {
      setIsSynthing(false);
    }
  };

  // Exportação executiva em PDF (Impressão formatada A4)
  const exportPdf = () => {
    if (!report) return;
    const printWin = window.open("", "_blank", "width=960,height=800");
    if (!printWin) return;

    const metricsHtml = report.metrics
      .map(
        (m) => `
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;">
          <div style="font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:0.08em;">${m.label}</div>
          <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:4px;">${m.value}${m.unit ?? ""}</div>
          <div style="font-size:11px;color:#475569;margin-top:4px;">${m.delta !== undefined ? `${m.delta >= 0 ? "+" : ""}${m.delta}% ` : ""}${m.deltaLabel ?? m.target ?? ""}</div>
        </div>`,
      )
      .join("");

    const listHtml = (items: typeof report.highlights) =>
      items
        .map(
          (f) => `
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;">${f.title} <span style="font-size:10px;color:#64748b;text-transform:uppercase;">[${f.tag}]</span></div>
            <div style="font-size:12px;color:#334155;margin-top:4px;line-height:1.5;">${f.detail}</div>
            ${f.impact ? `<div style="font-size:11px;font-weight:600;color:#0f172a;margin-top:6px;">Impacto: ${f.impact}</div>` : ""}
          </div>`,
        )
        .join("");

    const actionsHtml = report.actions
      .map(
        (a, i) => `
        <div style="border:1px solid #cbd5e1;border-radius:10px;padding:12px;margin-bottom:8px;background:#f8fafc;">
          <div style="font-size:13px;font-weight:700;color:#0f172a;">0${i + 1}. ${a.title} (${a.priority})</div>
          <div style="font-size:12px;color:#334155;margin-top:4px;line-height:1.5;">${a.detail}</div>
          <div style="font-size:11px;color:#475569;margin-top:6px;"><strong>Responsável:</strong> ${a.owner} · <strong>Prazo:</strong> ${a.horizon} · <strong>Resultado esperado:</strong> ${a.expected}</div>
        </div>`,
      )
      .join("");

    printWin.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>${persona.company} — Relatório ${report.kind} (${report.code})</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; padding: 32px; max-width: 840px; margin: 0 auto; }
            @media print { body { padding: 12px; } }
          </style>
        </head>
        <body>
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:20px;">
            <div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;">${persona.company} · Relatório ${report.kind} (${report.code})</div>
              <h1 style="font-size:20px;margin:4px 0 0 0;">${report.headline}</h1>
            </div>
            <div style="text-align:right;font-size:11px;color:#64748b;">
              <div>Período: ${report.period}</div>
              <div>Versão: ${activeVersion} · Confiança: ${report.confidence}%</div>
            </div>
          </div>
          <p style="font-size:13px;line-height:1.6;color:#334155;margin-bottom:20px;">${report.summary}</p>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px;">
            ${metricsHtml}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
            <div>
              <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#16a34a;margin-bottom:8px;">Destaques Positivos</h3>
              ${listHtml(report.highlights)}
            </div>
            <div>
              <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#d97706;margin-bottom:8px;">Oportunidades de Melhoria</h3>
              ${listHtml(report.gaps)}
            </div>
          </div>
          <div>
            <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#0f172a;margin-bottom:8px;">Plano de Ação Recomendado pela IA (${persona.name})</h3>
            ${actionsHtml}
          </div>
          <script>
            window.onload = function() { setTimeout(function() { window.print(); }, 250); };
          </script>
        </body>
      </html>
    `);
    printWin.document.close();
  };

  // Copiar resumo formatado para WhatsApp
  const copyWhatsAppSummary = async () => {
    if (!report) return;
    const text =
      `*${persona.company.toUpperCase()} — RELATÓRIO ${report.kind.toUpperCase()} (${report.code})*\n` +
      `Período: ${report.period}\n\n` +
      `*${report.headline}*\n${report.summary}\n\n` +
      `*Indicadores:*\n` +
      report.metrics.map((m) => `• ${m.label}: *${m.value}${m.unit ?? ""}*`).join("\n") +
      (report.highlights.length > 0
        ? `\n\n*Destaques:*\n` + report.highlights.map((h) => `• ${h.title}: ${h.detail}`).join("\n")
        : "") +
      (report.actions.length > 0
        ? `\n\n*Plano de Ação:*\n` +
          report.actions.map((a) => `• ${a.title} (${a.owner} · ${a.horizon})`).join("\n")
        : "");

    try {
      await navigator.clipboard.writeText(text);
      setCopiedWa(true);
      setTimeout(() => setCopiedWa(false), 2500);
    } catch {}
  };

  const saveScheduleSettings = async () => {
    setSavingSchedule(true);
    setScheduleSavedMsg(null);
    try {
      const res = await fetch("/api/settings/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fullReportSettings,
          tenantId: activeTenant,
          reportDailyWhatsapp: scheduleForm.reportDailyWhatsapp,
          reportWeeklyWhatsapp: scheduleForm.reportWeeklyWhatsapp,
          reportWhatsappNumbers: scheduleForm.reportWhatsappNumbers,
          reportRequiresApproval: scheduleForm.reportRequiresApproval,
        }),
      });
      if (res.ok) {
        setScheduleSavedMsg("Agendamento salvo!");
        setTimeout(() => {
          setScheduleSavedMsg(null);
          setScheduleOpen(false);
        }, 1500);
      } else {
        const err = await res.json().catch(() => ({}));
        setScheduleSavedMsg(err.error || "Apenas admins podem salvar.");
      }
    } catch {
      setScheduleSavedMsg("Erro ao salvar agendamento.");
    } finally {
      setSavingSchedule(false);
    }
  };

  // ── Feedback por seção ──
  const feedbackKey = (section: string) => `${report?.id}:${activeVersion}:${section}`;
  const getFeedback = (section: string): FeedbackValue =>
    feedback[feedbackKey(section)] ?? { vote: null, comment: "" };
  const setSectionFeedback = (key: string, next: FeedbackValue) => {
    setFeedback((prev) => ({ ...prev, [key]: next }));
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

  if (error && reportList.length === 0) {
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

  if (reportList.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-3 max-w-md">
          <Sparkles className="size-12 text-primary/30 mx-auto" />
          <h3 className="text-lg font-semibold text-foreground">Nenhum relatório de IA gerado ainda</h3>
          <p className="text-sm text-muted-foreground">
            Os relatórios são compilados automaticamente todos os dias às 18h.
            Você também pode compilar o relatório agora mesmo com um clique.
          </p>
          <div className="pt-2 flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={isSynthing}
              onClick={() => generateNow("daily")}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", isSynthing && "animate-spin")} />
              {isSynthing ? "Compilando relatório..." : "Gerar relatório de hoje agora"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!report) return null;

  // ── Render principal (mesma estrutura do insight-navigator/index.tsx) ──
  return (
    <div className="w-full flex-1 min-h-0 aurora grid-lines overflow-y-auto scrollbar-thin">
      <main className="grid items-start gap-5 p-4 lg:p-6 lg:grid-cols-[minmax(230px,250px)_minmax(0,1fr)] 2xl:grid-cols-[250px_minmax(0,1fr)_320px]">
          {/* ── Sidebar ── */}
          <div className="lg:sticky lg:top-4 space-y-4">
            <ReportSidebar
              reports={reportList}
              activeId={activeId}
              onSelect={setActiveId}
              onGenerateNow={(t) => generateNow(t)}
              isGenerating={isSynthing}
            />
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
                latest={reportList[0]}
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
                  <SystemTooltip content="Clique para atualizar a síntese deste período agora com IA">
                    <button
                      type="button"
                      disabled={isSynthing}
                      onClick={() =>
                        generateNow(
                          report.kind === "Semanal" ? "weekly" : "daily",
                          report.code,
                        )
                      }
                      className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                    >
                      <Sparkles className={cn("size-3.5 text-primary", isSynthing && "animate-spin")} />
                      Sincronizado via IA em {report.syncedAt}
                    </button>
                  </SystemTooltip>
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
                      {/* Toast de feedback do dispatch */}
                      {sendResult && (
                        <div className={`w-full rounded-lg px-3 py-2 text-xs font-medium mb-1 flex items-center gap-1.5 ${
                          sendResult.ok
                            ? "bg-positive/10 border border-positive/30 text-positive"
                            : "bg-critical/10 border border-critical/30 text-critical"
                        }`}>
                          {sendResult.ok ? (
                            <Check className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <X className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>{sendResult.msg}</span>
                        </div>
                      )}
                      {/* Toast de re-síntese */}
                      {isSynthing && (
                        <div className="w-full rounded-lg px-3 py-2 text-xs font-medium mb-1 bg-primary/10 border border-primary/30 text-primary flex items-center gap-2">
                          <span className="size-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                          Sincronizando síntese executiva com IA...
                        </div>
                      )}
                      <SystemTooltip
                        content={
                          stage !== "aprovado"
                            ? "Aprove o relatório no fluxo ao lado antes de enviar"
                            : "Enviar agora à diretoria via WhatsApp e E-mail"
                        }
                      >
                        <button
                          type="button"
                          disabled={stage !== "aprovado" || isSending}
                          onClick={dispatch}
                          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isSending ? (
                            <><span className="size-4 rounded-full border-2 border-white border-t-transparent animate-spin" /> Enviando...</>
                          ) : (
                            <><Send className="size-4" /> Enviar à diretoria</>
                          )}
                        </button>
                      </SystemTooltip>
                      <button
                        type="button"
                        onClick={exportPdf}
                        className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40"
                      >
                        <Download className="size-4" /> Exportar PDF
                      </button>

                      <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          >
                            <Bell className="size-4" /> Agendar no WhatsApp
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-80 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-foreground">
                              Disparo & Agendamento WhatsApp
                            </p>
                            <button
                              type="button"
                              onClick={copyWhatsAppSummary}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-1 text-[11px] font-medium text-foreground hover:border-primary/40"
                            >
                              {copiedWa ? <Check className="size-3 text-positive" /> : <Copy className="size-3" />}
                              {copiedWa ? "Copiado!" : "Copiar resumo"}
                            </button>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[11px] font-medium text-muted-foreground">
                              Números da Diretoria (DDI + DDD + Número)
                            </label>
                            <input
                              type="text"
                              value={scheduleForm.reportWhatsappNumbers}
                              onChange={(e) =>
                                setScheduleForm((p) => ({
                                  ...p,
                                  reportWhatsappNumbers: e.target.value,
                                }))
                              }
                              placeholder="Ex: 5514999998888, 5511988887777"
                              className="w-full rounded-lg border border-border bg-background/60 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary/50"
                            />
                          </div>

                          <div className="space-y-2 pt-1">
                            <label className="flex items-center justify-between text-xs text-foreground cursor-pointer">
                              <span>Relatório Diário (18:00 BRT)</span>
                              <input
                                type="checkbox"
                                checked={scheduleForm.reportDailyWhatsapp}
                                onChange={(e) =>
                                  setScheduleForm((p) => ({
                                    ...p,
                                    reportDailyWhatsapp: e.target.checked,
                                  }))
                                }
                                className="accent-primary"
                              />
                            </label>
                            <label className="flex items-center justify-between text-xs text-foreground cursor-pointer">
                              <span>Relatório Semanal (Sexta 18:00)</span>
                              <input
                                type="checkbox"
                                checked={scheduleForm.reportWeeklyWhatsapp}
                                onChange={(e) =>
                                  setScheduleForm((p) => ({
                                    ...p,
                                    reportWeeklyWhatsapp: e.target.checked,
                                  }))
                                }
                                className="accent-primary"
                              />
                            </label>
                            <label className="flex items-center justify-between text-xs text-muted-foreground cursor-pointer">
                              <span>Exigir aprovação antes do envio</span>
                              <input
                                type="checkbox"
                                checked={scheduleForm.reportRequiresApproval}
                                onChange={(e) =>
                                  setScheduleForm((p) => ({
                                    ...p,
                                    reportRequiresApproval: e.target.checked,
                                  }))
                                }
                                className="accent-primary"
                              />
                            </label>
                          </div>

                          {scheduleSavedMsg && (
                            <p className="text-[11px] font-medium text-primary">{scheduleSavedMsg}</p>
                          )}

                          <button
                            type="button"
                            disabled={savingSchedule}
                            onClick={saveScheduleSettings}
                            className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            {savingSchedule ? "Salvando..." : "Salvar agendamento"}
                          </button>
                        </PopoverContent>
                      </Popover>

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
  );
}
