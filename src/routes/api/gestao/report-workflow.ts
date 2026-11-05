import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { aiReports, aiReportVersions, aiReportFeedback } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const generateId = (prefix: string) => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
};

const stageOrder = ["rascunho", "revisao", "aprovado", "enviado"];

const pad = (n: number) => String(n).padStart(2, "0");
const nowStr = () => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const h = map.hour === "24" ? "00" : map.hour;
  return `${map.day}/${map.month}/${map.year}, ${h}:${map.minute}`;
};

function getBrtTodayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getWeekString(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export const Route = createFileRoute("/api/gestao/report-workflow")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
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
              error: "Permissão insuficiente para alterar o workflow de relatórios de IA.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const actorId = session.operator.id;
        const actorLabel = session.operator.name || session.operator.id || "Operador";
        const persona = getAiPersona(tenantId);

        try {
          const body = await request.json();
          const { tenantId: bodyTenantId, reportId, action } = body;

          if (bodyTenantId && bodyTenantId !== tenantId) {
            return new Response(
              JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          if (!action) {
            return new Response(JSON.stringify({ error: "action é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // ==========================================
          // ACTION: GENERATE (geração sob demanda / atualização com IA)
          // ==========================================
          if (action === "generate") {
            const { buildStoredReport } = await import("../../../lib/report-builder");
            const reqType: "daily" | "weekly" = body.type === "weekly" ? "weekly" : "daily";
            const now = new Date();
            const targetPeriod: string =
              body.period ||
              (reqType === "weekly" ? getWeekString(now) : getBrtTodayStr());

            const existing = await db.query.aiReports.findFirst({
              where: and(
                eq(aiReports.tenantId, tenantId),
                eq(aiReports.type, reqType),
                eq(aiReports.period, targetPeriod),
              ),
            });

            const { storedReport, markdown } = await buildStoredReport(
              tenantId,
              reqType,
              targetPeriod,
              now,
            );

            if (existing) {
              const nextVerNum =
                (parseInt(String(existing.currentVersion || "v1").replace(/\D/g, ""), 10) || 1) + 1;
              const newVersion = `v${nextVerNum}`;
              const updatedData = {
                ...storedReport,
                id: existing.id,
                currentVersion: newVersion,
                stage: "rascunho" as const,
              };

              await db
                .update(aiReports)
                .set({
                  reportData: updatedData as any,
                  reportMarkdown: markdown,
                  headline: storedReport.headline,
                  summary: storedReport.summary,
                  confidence: storedReport.confidence,
                  currentVersion: newVersion,
                  stage: "rascunho",
                  generatedAt: now,
                })
                .where(and(eq(aiReports.tenantId, tenantId), eq(aiReports.id, existing.id)));

              await db.insert(aiReportVersions).values({
                id: generateId("rev-gen"),
                reportId: existing.id,
                tenantId,
                version: newVersion,
                createdAt: nowStr(),
                author: `${persona.name} · solicitada por ${actorLabel}`,
                note: `Síntese atualizada sob demanda com dados em tempo real.`,
                stage: "rascunho",
                reportData: updatedData as any,
              });

              return new Response(
                JSON.stringify({
                  success: true,
                  reportId: existing.id,
                  version: newVersion,
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            } else {
              await db.insert(aiReports).values({
                id: storedReport.id,
                tenantId,
                type: reqType,
                period: targetPeriod,
                reportMarkdown: markdown,
                reportData: storedReport as any,
                stage: "rascunho",
                currentVersion: "v1",
                headline: storedReport.headline,
                summary: storedReport.summary,
                confidence: storedReport.confidence,
                generatedAt: now,
              });

              await db.insert(aiReportVersions).values({
                id: generateId("rev-gen"),
                reportId: storedReport.id,
                tenantId,
                version: "v1",
                createdAt: nowStr(),
                author: `${persona.name} · solicitada por ${actorLabel}`,
                note: "Primeira síntese compilada sob demanda.",
                stage: "rascunho",
                reportData: storedReport as any,
              });

              return new Response(
                JSON.stringify({
                  success: true,
                  reportId: storedReport.id,
                  version: "v1",
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
          }

          if (!reportId) {
            return new Response(JSON.stringify({ error: "reportId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // ==========================================
          // ACTION: ADVANCE-STAGE
          // ==========================================
          if (action === "advance-stage") {
            const { note } = body;

            const [report] = await db
              .select()
              .from(aiReports)
              .where(and(eq(aiReports.tenantId, tenantId), eq(aiReports.id, reportId)))
              .limit(1);

            if (!report) {
              return new Response(JSON.stringify({ error: "Relatório não encontrado" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const currentIndex = stageOrder.indexOf(report.stage);
            if (currentIndex === -1 || currentIndex >= stageOrder.length - 1) {
              return new Response(JSON.stringify({ error: "Não é possível avançar o estágio atual" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const nextStage = stageOrder[currentIndex + 1];
            const stamp = nowStr();

            const updatedReportData = report.reportData
              ? {
                  ...(report.reportData as any),
                  stage: nextStage,
                  review: Array.isArray((report.reportData as any).review)
                    ? (report.reportData as any).review.map((step: any) =>
                        step.stage === nextStage ? { ...step, name: actorLabel, at: stamp } : step,
                      )
                    : [],
                }
              : report.reportData;

            await db.transaction(async (tx) => {
              await tx
                .update(aiReports)
                .set({ stage: nextStage, reportData: updatedReportData })
                .where(and(eq(aiReports.tenantId, tenantId), eq(aiReports.id, reportId)));

              await tx.insert(aiReportVersions).values({
                id: generateId("rev"),
                reportId,
                tenantId,
                version: report.currentVersion,
                createdAt: stamp,
                author: actorLabel,
                note: note || `Avanço para ${nextStage}`,
                stage: nextStage,
                reportData: updatedReportData,
              });
            });

            return new Response(JSON.stringify({ success: true, stage: nextStage }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // ==========================================
          // ACTION: REJECT + RE-SÍNTESE IA
          // ==========================================
          if (action === "reject") {
            const { note } = body;

            const [report] = await db
              .select()
              .from(aiReports)
              .where(and(eq(aiReports.tenantId, tenantId), eq(aiReports.id, reportId)))
              .limit(1);

            if (!report) {
              return new Response(JSON.stringify({ error: "Relatório não encontrado" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const rejectStage = "rascunho";
            const nextVerNum =
              (parseInt(String(report.currentVersion || "v1").replace(/\D/g, ""), 10) || 1) + 1;
            const newVersion = `v${nextVerNum}`;

            const { buildStoredReport } = await import("../../../lib/report-builder");
            const { storedReport: newReport, markdown: newMarkdown } = await buildStoredReport(
              tenantId,
              report.type as "daily" | "weekly",
              report.period,
              report.generatedAt ?? new Date(),
            );

            const stamp = nowStr();
            const updatedData = {
              ...newReport,
              id: reportId,
              currentVersion: newVersion,
              stage: rejectStage as "rascunho",
            };

            await db.transaction(async (tx) => {
              await tx
                .update(aiReports)
                .set({
                  reportData: updatedData as any,
                  reportMarkdown: newMarkdown,
                  headline: newReport.headline,
                  summary: newReport.summary,
                  confidence: newReport.confidence,
                  currentVersion: newVersion,
                  stage: rejectStage,
                })
                .where(and(eq(aiReports.tenantId, tenantId), eq(aiReports.id, reportId)));

              await tx.insert(aiReportVersions).values({
                id: generateId("rev-resynth"),
                reportId,
                tenantId,
                version: newVersion,
                createdAt: stamp,
                author: `${persona.name} · re-síntese solicitada por ${actorLabel}`,
                note:
                  note ||
                  "Nova síntese gerada automaticamente após devolução para ajustes com feedback incorporado.",
                stage: rejectStage,
                reportData: updatedData as any,
              });
            });

            return new Response(
              JSON.stringify({
                success: true,
                stage: rejectStage,
                version: newVersion,
                resynthesize: true,
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }

          // ==========================================
          // ACTION: DISPATCH (envio manual à diretoria)
          // ==========================================
          if (action === "dispatch") {
            const [report] = await db
              .select()
              .from(aiReports)
              .where(and(eq(aiReports.tenantId, tenantId), eq(aiReports.id, reportId)))
              .limit(1);

            if (!report) {
              return new Response(JSON.stringify({ error: "Relatório não encontrado" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            if (report.stage !== "aprovado" && report.stage !== "enviado") {
              return new Response(
                JSON.stringify({
                  error: "Relatório deve estar aprovado antes de ser enviado à diretoria",
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            const storedReport = report.reportData as any;
            const markdownReport = report.reportMarkdown;

            if (!storedReport) {
              return new Response(JSON.stringify({ error: "Dados do relatório não encontrados" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const { ReportDispatcher } = await import("../../../lib/report-dispatcher");
            const dispatchResult = await ReportDispatcher.dispatch(
              tenantId,
              storedReport,
              markdownReport,
              { forceManual: true },
            );

            await ReportDispatcher.markAsEnviado(reportId, tenantId, actorLabel);

            return new Response(
              JSON.stringify({
                success: true,
                stage: "enviado",
                dispatch: {
                  whatsappSent: dispatchResult.whatsappSent,
                  emailSent: dispatchResult.emailSent,
                  errors: dispatchResult.errors,
                  skipped: dispatchResult.skipped,
                },
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // ==========================================
          // ACTION: FEEDBACK
          // ==========================================
          if (action === "feedback") {
            const { version, sectionId, vote, comment } = body;

            if (!version || !sectionId) {
              return new Response(JSON.stringify({ error: "version e sectionId são obrigatórios" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const existingFeedback = await db
              .select()
              .from(aiReportFeedback)
              .where(
                and(
                  eq(aiReportFeedback.tenantId, tenantId),
                  eq(aiReportFeedback.reportId, reportId),
                  eq(aiReportFeedback.version, version),
                  eq(aiReportFeedback.sectionId, sectionId),
                  eq(aiReportFeedback.operatorId, actorId),
                ),
              )
              .limit(1);

            if (existingFeedback.length > 0) {
              await db
                .update(aiReportFeedback)
                .set({ vote, comment })
                .where(
                  and(
                    eq(aiReportFeedback.tenantId, tenantId),
                    eq(aiReportFeedback.id, existingFeedback[0].id),
                  ),
                );
            } else {
              await db.insert(aiReportFeedback).values({
                id: generateId("fbk"),
                reportId,
                tenantId,
                version,
                sectionId,
                vote,
                comment,
                operatorId: actorId,
              });
            }

            return new Response(JSON.stringify({ success: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // ==========================================
          // ACTION: GET-FEEDBACK
          // ==========================================
          if (action === "get-feedback") {
            const { version } = body;

            let queryConditions = and(
              eq(aiReportFeedback.tenantId, tenantId),
              eq(aiReportFeedback.reportId, reportId),
            );

            if (version) {
              queryConditions = and(queryConditions, eq(aiReportFeedback.version, version));
            }

            const feedbacks = await db
              .select()
              .from(aiReportFeedback)
              .where(queryConditions);

            return new Response(JSON.stringify(feedbacks), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ error: "Ação inválida" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[gestao/report-workflow] Erro POST:", e);
          return new Response(JSON.stringify({ error: "Erro interno", details: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
