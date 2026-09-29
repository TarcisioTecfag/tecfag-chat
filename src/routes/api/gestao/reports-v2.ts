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
import { requireSession } from "../../../lib/auth-session";

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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.operator.role !== "admin" && session.operator.role !== "supervisor") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem acessar relatórios.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const action = url.searchParams.get("action");

        try {
          // Busca apenas relatórios reais persistidos no banco para este tenant
          const baseReports = await db
            .select()
            .from(aiReports)
            .where(eq(aiReports.tenantId, tenantId))
            .orderBy(desc(aiReports.generatedAt))
            .limit(200);

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

// Helper desativado: auto-seed de relatórios mock descontinuado por segurança multi-tenant
async function autoSeedMockReports(_tenantId: string): Promise<void> {
  // Desativado permanentemente para evitar poluição da base com dados fictícios
  return;
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
