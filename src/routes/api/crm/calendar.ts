import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import { crmService, handleCrmError } from "../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/calendar")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/calendar
       * Retorna tarefas comerciais com prazo e timezone filtradas para visão de calendário,
       * trazendo os dados completos da negociação associada para navegação direta ao card/tarefa.
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const url = new URL(request.url);
          const startDate = url.searchParams.get("startDate") || undefined;
          const endDate = url.searchParams.get("endDate") || undefined;
          const operatorId = url.searchParams.get("operatorId") || undefined;
          const status = (url.searchParams.get("status") as "all" | "pending" | "completed") || "all";

          const tasks = await crmService.getCrmCalendarTasks(tenantId, {
            startDate,
            endDate,
            operatorId,
            status,
          });

          return new Response(JSON.stringify({ tasks }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },
    },
  },
});
