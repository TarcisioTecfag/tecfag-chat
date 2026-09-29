import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { aiReports, aiReportVersions, aiReportFeedback } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Helper para geração de IDs únicos
const generateId = (prefix: string) => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
};

const stageOrder = ["rascunho", "revisao", "aprovado", "enviado"];

const pad = (n: number) => String(n).padStart(2, "0");
const nowStr = () => {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const Route = createFileRoute("/api/gestao/report-workflow")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.operator.role !== "admin" && session.operator.role !== "supervisor") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem alterar o workflow de relatórios.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const body = await request.json();
          const { tenantId: bodyTenantId, reportId, action } = body;

          if (bodyTenantId && bodyTenantId !== tenantId) {
            return new Response(
              JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!reportId || !action) {
            return new Response(JSON.stringify({ error: "reportId e action são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // ==========================================
          // ACTION: ADVANCE-STAGE
          // ==========================================
          if (action === "advance-stage") {
            const { operatorId, note } = body;
            
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

            await db.transaction(async (tx) => {
              await tx
                .update(aiReports)
                .set({ stage: nextStage })
                .where(eq(aiReports.id, reportId));

              await tx.insert(aiReportVersions).values({
                id: generateId("rev"),
                reportId,
                tenantId,
                version: report.currentVersion,
                createdAt: nowStr(),
                author: operatorId || "Operador",
                note: note || `Avanço para ${nextStage}`,
                stage: nextStage,
                reportData: report.reportData
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
            const { operatorId, note } = body;

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

            // 1. Marca como rascunho e loga a rejeição
            await db.transaction(async (tx) => {
              await tx
                .update(aiReports)
                .set({ stage: rejectStage })
                .where(eq(aiReports.id, reportId));

              await tx.insert(aiReportVersions).values({
                id: generateId("rev"),
                reportId,
                tenantId,
                version: report.currentVersion,
                createdAt: nowStr(),
                author: operatorId || "Operador",
                note: note || "Rejeitado e retornado para rascunho — re-síntese IA iniciada.",
                stage: rejectStage,
                reportData: report.reportData
              });
            });

            // 2. Dispara re-síntese da IA em background (não bloqueia a resposta)
            const doResynth = async () => {
              try {
                const { buildStoredReport, buildMarkdownFromStoredReport } = await import("../../../lib/report-builder");
                const now = new Date();

                const newVersion = `v${(parseInt(report.currentVersion.replace("v", "")) || 1) + 1}`;
                const { storedReport: newReport, markdown: newMarkdown } = await buildStoredReport(
                  tenantId,
                  report.type as "daily" | "weekly",
                  report.period,
                  now
                );

                await db
                  .update(aiReports)
                  .set({
                    reportData: { ...newReport, id: reportId } as any,
                    reportMarkdown: newMarkdown,
                    headline: newReport.headline,
                    summary: newReport.summary,
                    confidence: newReport.confidence,
                    currentVersion: newVersion,
                    stage: "rascunho",
                  })
                  .where(eq(aiReports.id, reportId));

                await db.insert(aiReportVersions).values({
                  id: generateId("rev-resynth"),
                  reportId,
                  tenantId,
                  version: newVersion,
                  createdAt: nowStr(),
                  author: "IA · re-síntese pós-rejeição",
                  note: `Nova síntese gerada automaticamente após rejeição. Feedback dos operadores incorporado.`,
                  stage: "rascunho",
                  reportData: { ...newReport, id: reportId } as any,
                });

                console.log(`[report-workflow] ✓ Re-síntese ${newVersion} concluída para ${reportId}`);
              } catch (e: any) {
                console.error(`[report-workflow] Erro na re-síntese de ${reportId}:`, e.message);
              }
            };

            // Fire-and-forget (sem await)
            doResynth();

            return new Response(JSON.stringify({ success: true, stage: rejectStage, resynthesize: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // ==========================================
          // ACTION: DISPATCH (envio manual à diretoria)
          // ==========================================
          if (action === "dispatch") {
            const { operatorId } = body;

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

            if (report.stage !== "aprovado") {
              return new Response(
                JSON.stringify({ error: "Relatório deve estar aprovado antes de ser enviado à diretoria" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

            // Dispara envio via ReportDispatcher
            const { ReportDispatcher } = await import("../../../lib/report-dispatcher");
            const dispatchResult = await ReportDispatcher.dispatch(tenantId, storedReport, markdownReport);

            // Marca como enviado
            await ReportDispatcher.markAsEnviado(reportId, tenantId, operatorId || "system");

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
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // ==========================================
          // ACTION: FEEDBACK
          // ==========================================
          if (action === "feedback") {
            const { version, sectionId, vote, comment, operatorId } = body;

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
                  eq(aiReportFeedback.operatorId, operatorId || "system")
                )
              )
              .limit(1);

            if (existingFeedback.length > 0) {
              await db
                .update(aiReportFeedback)
                .set({ vote, comment })
                .where(eq(aiReportFeedback.id, existingFeedback[0].id));
            } else {
              await db.insert(aiReportFeedback).values({
                id: generateId("fbk"),
                reportId,
                tenantId,
                version,
                sectionId,
                vote,
                comment,
                operatorId: operatorId || "system"
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
              eq(aiReportFeedback.reportId, reportId)
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
