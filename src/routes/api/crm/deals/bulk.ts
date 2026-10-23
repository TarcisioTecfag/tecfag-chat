import { requireCrmTransitionAccess } from "../../../../lib/access-control/crm-record-access";
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../lib/crm/crm-service";
import { db } from "../../../../db";
import { crmActionHistory } from "../../../../db/schema";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/bulk")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * POST /api/crm/deals/bulk
       * Atualiza negociações em lote (etapa, status ou vendedor responsável).
       * Exige permissão canEditDeals (ou canMoveDeals se apenas stageId).
       */
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const body = await request.json();
          const transitionDenied = await requireCrmTransitionAccess(session, body);
          if (transitionDenied) return transitionDenied;

          if (body.action === "export") {
            const permError = requireCrmPermission(session, "canExportDeals") || requireCrmPermission(session, "canViewCrm");
            if (permError) return permError;

            const format = body.format === "xlsx" ? "xlsx" : "csv";

            const exported = await crmService.exportDealsRD(tenantId, {
              dealIds: body.dealIds || [],
              allFiltered: body.allFiltered,
              filterParams: body.filterParams,
              format,
              authorizedOperatorId: session.operator.role !== "admin" && !session.permissions?.crm?.canViewAllDeals ? session.operator.id : undefined,
            });

            await db.insert(crmActionHistory).values({
              id: crypto.randomUUID(),
              tenantId,
              operatorId: session.operator.id,
              operatorName: session.operator.name,
              action: "export",
              entityType: "deal",
              itemCount: exported.count,
              details: {
                filename: exported.filename,
                format: exported.format,
                allFiltered: !!body.allFiltered,
                dealIds: exported.dealIds,
              },
            });

            return new Response(
              JSON.stringify({
                success: true,
                filename: exported.filename,
                format: exported.format,
                count: exported.count,
                base64: exported.xlsxBase64,
                csv: exported.csv,
              }),
              {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          const deleting = body.action === "delete_trash" || body.action === "delete_permanent";
          const permError = requireCrmPermission(session, deleting ? "canDeleteDeals" : "canEditDeals");
          if (permError) return permError;
          if (body.stageId || body.pipelineId) { const denied = requireCrmPermission(session, "canMoveStages"); if (denied) return denied; }
          if (body.status === "won" || body.status === "lost") { const denied = requireCrmPermission(session, "canCloseDeals"); if (denied) return denied; }
          if (body.action === "create_deals_for_companies") { const denied = requireCrmPermission(session, "canCreateDeals"); if (denied) return denied; }

          if (!body.allFiltered && (!body.dealIds || !Array.isArray(body.dealIds) || body.dealIds.length === 0)) {
            return new Response(
              JSON.stringify({ error: "Lista 'dealIds' é obrigatória quando não for seleção de filtro.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const result = await crmService.bulkUpdateDeals(tenantId, session.operator.id, {
            dealIds: body.dealIds || [],
            allFiltered: body.allFiltered,
            filterParams: body.filterParams,
            stageId: body.stageId,
            pipelineId: body.pipelineId,
            operatorId: body.operatorId,
            status: body.status,
            lossReason: body.lossReason,
            rating: body.rating,
            campaign: body.campaign,
            source: body.source,
            productId: body.productId,
            action: body.action,
            taskData: body.taskData,
          }, session.operator.name, session.operator.role !== "admin" && !session.permissions?.crm?.canViewAllDeals ? session.operator.id : undefined);

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deals Bulk API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
