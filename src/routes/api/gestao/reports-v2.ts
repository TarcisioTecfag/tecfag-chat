/**
 * reports-v2.ts — API REST para Relatórios IA v2
 *
 * Retorna StoredReport[] com a shape exata que o frontend insight-navigator espera.
 * Também suporta sub-actions: coverage, trend, themes, pending.
 * Se o banco ainda não tiver relatórios compilados para o tenant mas houver dados
 * operacionais/comerciais reais, compila automaticamente o histórico inicial.
 *
 * REGRA: tenantId obrigatório em TODAS as queries.
 */

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  aiReports,
  aiReportVersions,
  aiReportFeedback,
  conversations,
  crmDeals,
} from "../../../db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { buildStoredReport } from "../../../lib/report-builder";

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

function getWeekString(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getBrtDateString(date: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

/**
 * Compila automaticamente relatórios reais dos últimos dias e semana atual
 * quando o tenant possui operação ativa (conversas ou negociações CRM) mas
 * ainda não tem registros em ai_reports.
 */
async function ensureRealReportsCompiled(tenantId: string): Promise<void> {
  try {
    const [hasConv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.tenantId, tenantId))
      .limit(1);

    const [hasDeal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(eq(crmDeals.tenantId, tenantId))
      .limit(1);

    if (!hasConv && !hasDeal) return;

    const now = new Date();
    const datesToCompile: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      datesToCompile.push(getBrtDateString(d));
    }

    for (const dateStr of datesToCompile) {
      const existing = await db.query.aiReports.findFirst({
        where: and(
          eq(aiReports.tenantId, tenantId),
          eq(aiReports.type, "daily"),
          eq(aiReports.period, dateStr),
        ),
      });
      if (existing) continue;

      const anchor = new Date(`${dateStr}T18:00:00.000-03:00`);
      const { storedReport, markdown } = await buildStoredReport(
        tenantId,
        "daily",
        dateStr,
        anchor,
        { skipAi: true },
      );

      await db
        .insert(aiReports)
        .values({
          id: storedReport.id,
          tenantId,
          type: "daily",
          period: dateStr,
          reportMarkdown: markdown,
          reportData: storedReport as any,
          stage: "rascunho",
          currentVersion: "v1",
          headline: storedReport.headline,
          summary: storedReport.summary,
          confidence: storedReport.confidence,
          generatedAt: anchor,
        })
        .onConflictDoNothing();

      await db
        .insert(aiReportVersions)
        .values({
          id: `rev-init-${storedReport.id}-v1`,
          reportId: storedReport.id,
          tenantId,
          version: "v1",
          createdAt: storedReport.versions[0]?.createdAt ?? storedReport.syncedAt,
          author: storedReport.versions[0]?.author ?? "IA Executiva",
          note: "Primeira síntese automática do ciclo.",
          stage: "rascunho",
          reportData: storedReport as any,
        })
        .onConflictDoNothing();
    }

    // Compila também o consolidado semanal da semana atual
    const weekStr = getWeekString(now);
    const existingWeekly = await db.query.aiReports.findFirst({
      where: and(
        eq(aiReports.tenantId, tenantId),
        eq(aiReports.type, "weekly"),
        eq(aiReports.period, weekStr),
      ),
    });

    if (!existingWeekly) {
      const { storedReport, markdown } = await buildStoredReport(
        tenantId,
        "weekly",
        weekStr,
        now,
        { skipAi: true },
      );

      await db
        .insert(aiReports)
        .values({
          id: storedReport.id,
          tenantId,
          type: "weekly",
          period: weekStr,
          reportMarkdown: markdown,
          reportData: storedReport as any,
          stage: "rascunho",
          currentVersion: "v1",
          headline: storedReport.headline,
          summary: storedReport.summary,
          confidence: storedReport.confidence,
          generatedAt: now,
        })
        .onConflictDoNothing();

      await db
        .insert(aiReportVersions)
        .values({
          id: `rev-init-${storedReport.id}-v1`,
          reportId: storedReport.id,
          tenantId,
          version: "v1",
          createdAt: storedReport.versions[0]?.createdAt ?? storedReport.syncedAt,
          author: storedReport.versions[0]?.author ?? "IA Executiva",
          note: "Consolidado semanal compilado automaticamente.",
          stage: "rascunho",
          reportData: storedReport as any,
        })
        .onConflictDoNothing();
    }
  } catch (err: any) {
    console.warn("[gestao/reports-v2] Aviso ao compilar relatórios iniciais:", err?.message);
  }
}

export const Route = createFileRoute("/api/gestao/reports-v2")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const canAccess =
          session.permissions?.views?.analytics === true &&
          session.permissions?.analytics?.canAccessAiReports === true;
        if (!canAccess) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para acessar relatórios de IA.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const action = url.searchParams.get("action");

        try {
          let baseReports = await db
            .select()
            .from(aiReports)
            .where(eq(aiReports.tenantId, tenantId))
            .orderBy(desc(aiReports.period), desc(aiReports.generatedAt))
            .limit(200);

          if (baseReports.length === 0) {
            await ensureRealReportsCompiled(tenantId);
            baseReports = await db
              .select()
              .from(aiReports)
              .where(eq(aiReports.tenantId, tenantId))
              .orderBy(desc(aiReports.period), desc(aiReports.generatedAt))
              .limit(200);
          }

          // Deduplica por (type, period) caso existam seeds antigos com IDs duplicados
          const seenKeys = new Set<string>();
          baseReports = baseReports.filter((r) => {
            const key = `${r.type}:${r.period}`;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
          });

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

            // Deduplica versões por label ("v1", "v2"...) mantendo a mais recente
            const rawVersions = allVersions.filter((v) => v.reportId === row.id);
            const byVersionName = new Map<string, any>();
            for (const v of rawVersions) {
              byVersionName.set(v.version, {
                version: v.version,
                createdAt: v.createdAt,
                author: v.author,
                note: v.note,
                stage: v.stage,
                reportData: v.reportData ?? null,
              });
            }
            const reportVersions = [...byVersionName.values()];

            const reportFeedbacks = allFeedback.filter((f) => f.reportId === row.id);
            const feedbackSummary = {
              up: reportFeedbacks.filter((f) => f.vote === "up").length,
              down: reportFeedbacks.filter((f) => f.vote === "down").length,
              comments: reportFeedbacks.filter((f) => f.comment && f.comment.trim() !== "").length,
            };

            const userFeedbackEntries = reportFeedbacks.map((f) => ({
              version: f.version,
              sectionId: f.sectionId,
              vote: (f.vote === "up" || f.vote === "down" ? f.vote : null) as "up" | "down" | null,
              comment: f.comment ?? "",
            }));

            return {
              ...base,
              id: row.id,
              stage: row.stage,
              currentVersion: row.currentVersion,
              versions: reportVersions.length > 0 ? reportVersions : (base.versions ?? []),
              feedbackSummary,
              userFeedback: userFeedbackEntries,
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
    userFeedback: [],
  };
}
