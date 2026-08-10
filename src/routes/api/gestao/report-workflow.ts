import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { aiReports, aiReportVersions, aiReportFeedback } from "../../../db/schema";
import { eq, and } from "drizzle-orm";

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

export const Route = createFileRoute("/api/gestao/report-workflow")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, reportId, action } = body;

          if (!tenantId) {
            return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
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
              // Atualiza o relatório principal
              await tx
                .update(aiReports)
                .set({ stage: nextStage })
                .where(eq(aiReports.id, reportId));

              // Registra a versão da transição
              await tx.insert(aiReportVersions).values({
                id: generateId("rev"),
                reportId,
                tenantId,
                version: report.currentVersion,
                createdAt: new Date().toLocaleString("pt-BR"),
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
          // ACTION: REJECT
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
                createdAt: new Date().toLocaleString("pt-BR"),
                author: operatorId || "Operador",
                note: note || "Rejeitado e retornado para rascunho",
                stage: rejectStage,
                reportData: report.reportData
              });
            });

            return new Response(JSON.stringify({ success: true, stage: rejectStage }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
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

            // Upsert mechanism: check if exists, then update or insert
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
