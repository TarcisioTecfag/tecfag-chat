/**
 * reports-v2.ts — API REST para Relatórios IA v2
 *
 * Retorna StoredReport[] com a shape exata que o frontend insight-navigator espera.
 * Também suporta sub-actions: coverage, trend, themes, pending.
 * Se o banco estiver vazio para um tenant, auto-popula relatórios mock iniciais.
 *
 * REGRA: tenantId obrigatório em TODAS as queries.
 */

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { aiReports, aiReportVersions, aiReportFeedback } from "../../../db/schema";
import { eq, desc, and, ne } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const Route = createFileRoute("/api/gestao/reports-v2")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        let tenantId = url.searchParams.get("tenantId");
        const action = url.searchParams.get("action");

        if (!tenantId || tenantId === "undefined" || tenantId === "null" || tenantId === "all") {
          tenantId = "valem";
        }

        try {
          // ── 0. Auto-seed se o banco estiver vazio para este tenant ───────
          let baseReports = await db
            .select()
            .from(aiReports)
            .where(eq(aiReports.tenantId, tenantId))
            .orderBy(desc(aiReports.generatedAt))
            .limit(200);

          if (baseReports.length === 0) {
            console.log(`[reports-v2] Banco sem relatórios para tenant '${tenantId}'. Executando auto-seed mock...`);
            await autoSeedMockReports(tenantId);

            baseReports = await db
              .select()
              .from(aiReports)
              .where(eq(aiReports.tenantId, tenantId))
              .orderBy(desc(aiReports.generatedAt))
              .limit(200);
          }

          // ─── COVERAGE ──────────────────────────────────────────────────
          if (action === "coverage") {
            const rows = baseReports;
            const total = rows.length;
            const daily = rows.filter((r) => r.type === "daily").length;
            const weekly = rows.filter((r) => r.type === "weekly").length;
            const sent = rows.filter((r) => r.stage === "enviado").length;

            const pad = (n: number) => String(n).padStart(2, "0");
            const fmtBr = (d: Date | null) => {
              if (!d) return "—";
              return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
            };

            return json({
              days: daily,
              total,
              daily,
              weekly,
              firstDate: fmtBr(rows.length > 0 ? rows[rows.length - 1].generatedAt : null),
              lastDate: fmtBr(rows.length > 0 ? rows[0].generatedAt : null),
              sent,
            });
          }

          // ─── PENDING ───────────────────────────────────────────────────
          if (action === "pending") {
            const pending = baseReports.filter((r) => r.stage !== "enviado");
            const results = pending.map((row) => row.reportData ?? minimalReport(row));
            return json(results);
          }

          // ─── DEFAULT: GET ALL REPORTS ───────────────────────────────────
          if (baseReports.length === 0) {
            return json([]);
          }

          // Busca versões e feedback para enriquecer cada relatório
          const allVersions = await db
            .select()
            .from(aiReportVersions)
            .where(eq(aiReportVersions.tenantId, tenantId));

          const allFeedback = await db
            .select()
            .from(aiReportFeedback)
            .where(eq(aiReportFeedback.tenantId, tenantId));

          const enrichedReports = baseReports.map((row) => {
            const base = (row.reportData as any) ?? minimalReport(row);

            const reportVersions = allVersions
              .filter((v) => v.reportId === row.id)
              .map((v) => ({
                version: v.version,
                createdAt: v.createdAt,
                author: v.author,
                note: v.note,
                stage: v.stage,
              }));

            const reportFeedbacks = allFeedback.filter((f) => f.reportId === row.id);
            const feedbackSummary = {
              up: reportFeedbacks.filter((f) => f.vote === "up").length,
              down: reportFeedbacks.filter((f) => f.vote === "down").length,
              comments: reportFeedbacks.filter((f) => f.comment && f.comment.trim() !== "").length,
            };

            return {
              ...base,
              stage: row.stage,
              currentVersion: row.currentVersion,
              versions: reportVersions.length > 0 ? reportVersions : (base.versions ?? []),
              feedbackSummary,
            };
          });

          return json(enrichedReports);

        } catch (e: any) {
          console.error("[gestao/reports-v2] Erro GET:", e);
          return json({ error: "Erro interno", details: e.message }, 500);
        }
      },
    },
  },
});

// Helper para auto-seed de relatórios mock caso a tabela esteja vazia
async function autoSeedMockReports(tenantId: string) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const MONTH_NAMES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ];

  function buildReport(kind: "Diário" | "Semanal", dateOffsetDays: number) {
    const d = new Date();
    d.setDate(d.getDate() - dateOffsetDays);

    const dateIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fmtBR = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    const fmtBRTime = `${fmtBR}, 18:00`;
    const periodLabel = kind === "Diário"
      ? `${pad(d.getDate())} de ${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`
      : `Semana ${pad(d.getDate())} a ${pad(d.getDate() + 6)} de ${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`;

    const reportId = kind === "Diário" ? `d-${dateIso}-${tenantId}` : `2026-W32-${tenantId}`;
    const code = kind === "Diário" ? dateIso : `2026-W32`;

    const isValem = tenantId === "valem";
    const companyName = isValem ? "Valem Válvulas e Embalagens" : "Tecfag Informática";
    const personaName = isValem ? "Valentina (SDR)" : "Fagner (Suporte Técnico)";

    const volume = isValem ? 47 - dateOffsetDays * 3 : 32 - dateOffsetDays * 2;
    const sla = Number((94.2 - dateOffsetDays * 0.8).toFixed(1));
    const frtSeconds = 102 + dateOffsetDays * 15;
    const frtText = `${Math.floor(frtSeconds / 60)}m ${frtSeconds % 60}s`;
    const qa = Number((8.7 - dateOffsetDays * 0.2).toFixed(1));
    const satisfied = 72 - dateOffsetDays * 2;
    const neutral = 19 + dateOffsetDays;
    const frustrated = 100 - satisfied - neutral;

    return {
      id: reportId,
      kind,
      code,
      date: dateIso,
      period: periodLabel,
      generatedAt: fmtBR,
      syncedAt: fmtBRTime,
      confidence: 93 - dateOffsetDays,
      headline: kind === "Diário"
        ? `Operação ${companyName} estável com SLA de ${sla}% — volume ${18 - dateOffsetDays * 2}% acima da média`
        : `Balanço Semanal ${companyName}: SLA consolidado em ${sla}% com 240+ atendimentos`,
      summary: `A operação da ${companyName} registrou ${volume} conversas no período (${kind.toLowerCase()}). O SLA de resposta ficou em ${sla}%, superando a meta estabelecida de 92%. O tempo médio de primeira resposta pelo agente ${personaName} foi de ${frtText}. O índice de satisfação do cliente fechou em ${satisfied}% com nota média de QA de ${qa}/10.`,
      metrics: [
        {
          label: "Conversas atendidas",
          value: String(volume),
          delta: Number((18.3 - dateOffsetDays * 1.5).toFixed(1)),
          deltaLabel: kind === "Diário" ? "vs. dia anterior" : "vs. semana anterior",
          goodWhen: "up" as const,
        },
        {
          label: "1ª resposta (média)",
          value: frtText,
          delta: Number((-12.1 + dateOffsetDays * 2).toFixed(1)),
          deltaLabel: kind === "Diário" ? "vs. dia anterior" : "vs. semana anterior",
          goodWhen: "down" as const,
          target: "Meta 15m",
        },
        {
          label: "SLA cumprido",
          value: String(sla).replace(".", ","),
          unit: "%",
          delta: Number((2.4 - dateOffsetDays * 0.5).toFixed(1)),
          goodWhen: "up" as const,
          progress: sla,
          target: "Meta 92%",
        },
        {
          label: "Nota média de QA",
          value: String(qa).replace(".", ","),
          unit: "/10",
          delta: 1.2,
          goodWhen: "up" as const,
          progress: qa * 10,
        },
      ],
      sentiment: [
        { label: "Satisfeito", value: satisfied, signal: "positive" as const },
        { label: "Neutro", value: neutral, signal: "info" as const },
        { label: "Frustrado", value: frustrated, signal: "critical" as const },
      ],
      volumeSeries: kind === "Diário" ? [
        { label: "08h", value: Math.round(volume * 0.08) },
        { label: "10h", value: Math.round(volume * 0.20) },
        { label: "12h", value: Math.round(volume * 0.28) },
        { label: "14h", value: Math.round(volume * 0.22) },
        { label: "16h", value: Math.round(volume * 0.14) },
        { label: "18h", value: Math.round(volume * 0.08) },
      ] : [
        { label: "Seg", value: 45 },
        { label: "Ter", value: 52 },
        { label: "Qua", value: 48 },
        { label: "Qui", value: 50 },
        { label: "Sex", value: 41 },
        { label: "Sáb", value: 12 },
      ],
      highlights: [
        {
          title: "SLA acima da meta de 92%",
          detail: `A equipe manteve ${sla}% de conformidade, demonstrando alta eficiência no atendimento.`,
          signal: "positive" as const,
          tag: "Processo",
          impact: `+${(sla - 92).toFixed(1)}pp acima da meta`,
        },
        {
          title: "Redução no tempo de 1ª resposta",
          detail: `Tempo médio de primeira resposta fixado em ${frtText}, garantindo resposta rápida aos leads.`,
          signal: "positive" as const,
          tag: "Suporte",
          impact: "FRT 35% abaixo do limite SLA",
        },
      ],
      gaps: [
        {
          title: "Objeções comerciais necessitando atenção",
          detail: "Identificados leads qualificados que levantaram dúvidas sobre prazos de entrega não sanadas imediatamente.",
          signal: "warning" as const,
          tag: "Comercial",
          impact: "Risco de fricção na conversão",
        },
      ],
      actions: [
        {
          title: "Reforço no alinhamento de prazos",
          detail: "Orientações para a equipe responder prontamente sobre prazos de entrega no primeiro contato.",
          owner: "Supervisão Operacional",
          horizon: "Esta semana",
          priority: "Alta" as const,
          expected: "Manter SLA > 92% e conversão alta",
        },
      ],
      sources: [
        `${volume} conversas`,
        `${Math.round(volume * 0.3)} auditorias QA`,
        "SLA em tempo real",
        "Sentimento IA",
      ],
      stage: (dateOffsetDays === 0 ? "rascunho" : dateOffsetDays === 1 ? "revisao" : "aprovado") as ("rascunho" | "revisao" | "aprovado" | "enviado"),
      currentVersion: "v1",
      versions: [
        {
          version: "v1",
          createdAt: fmtBRTime,
          author: "IA · sla_advisor",
          note: "Síntese automática de BI gerada pela IA.",
          stage: (dateOffsetDays === 0 ? "rascunho" : dateOffsetDays === 1 ? "revisao" : "aprovado") as ("rascunho" | "revisao" | "aprovado" | "enviado"),
        },
      ],
      review: [
        { role: "Geração", name: "IA · Gemini 2.5 Pro", stage: "rascunho" as const, at: fmtBRTime },
        { role: "Revisão operacional", name: "Supervisor", stage: "revisao" as const },
        { role: "Aprovação executiva", name: "Administrador", stage: "aprovado" as const },
        { role: "Distribuição", name: "Diretoria · WhatsApp + e-mail", stage: "enviado" as const },
      ],
      themes: ["Comercial", "Processo"],
      kpis: {
        volume,
        sla,
        frt: frtSeconds,
        qa,
        satisfied,
      },
      feedbackSummary: { up: 2, down: 0, comments: 1 },
    };
  }

  const reportsToInsert = [
    { kind: "Diário" as const, offset: 0 },
    { kind: "Diário" as const, offset: 1 },
    { kind: "Diário" as const, offset: 2 },
    { kind: "Diário" as const, offset: 3 },
    { kind: "Semanal" as const, offset: 0 },
  ];

  for (const item of reportsToInsert) {
    const rep = buildReport(item.kind, item.offset);
    try {
      await db.insert(aiReports).values({
        id: rep.id,
        tenantId,
        type: item.kind === "Diário" ? "daily" : "weekly",
        period: rep.code,
        reportMarkdown: `## Relatório ${rep.kind}\n${rep.summary}`,
        reportData: rep as any,
        stage: rep.stage,
        currentVersion: rep.currentVersion,
        headline: rep.headline,
        summary: rep.summary,
        confidence: rep.confidence,
        generatedAt: new Date(Date.now() - item.offset * 86400000),
      });

      await db.insert(aiReportVersions).values({
        id: `rev-${rep.id}-v1`,
        reportId: rep.id,
        tenantId,
        version: "v1",
        createdAt: rep.syncedAt,
        author: "IA · sla_advisor",
        note: "Síntese automática gerada pela IA.",
        stage: rep.stage,
        reportData: rep as any,
      });
    } catch (e) {
      console.error(`[reports-v2] Erro no autoSeed para ${rep.id}:`, e);
    }
  }
}

function minimalReport(row: any) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = row.generatedAt ?? new Date();
  return {
    id: row.id,
    kind: row.type === "weekly" ? "Semanal" : "Diário",
    code: row.period,
    date: row.period,
    period: row.period,
    generatedAt: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    syncedAt: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    confidence: row.confidence ?? 85,
    headline: row.headline ?? "Relatório do período",
    summary: row.summary ?? "",
    metrics: [],
    sentiment: [],
    volumeSeries: [],
    highlights: [],
    gaps: [],
    actions: [],
    sources: [],
    stage: row.stage ?? "rascunho",
    currentVersion: row.currentVersion ?? "v1",
    versions: [],
    review: [],
    themes: [],
    kpis: { volume: 0, sla: 100, frt: 0, qa: 8, satisfied: 85 },
    feedbackSummary: { up: 0, down: 0, comments: 0 },
  };
}
