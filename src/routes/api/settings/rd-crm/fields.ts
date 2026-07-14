import { createFileRoute } from "@tanstack/react-router";
import { rdRequest } from "../../../../lib/rdCrmService";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/settings/rd-crm/fields")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "valem";

        try {
          // Busca campos customizados configurados no RD CRM
          const customFields = await rdRequest(tenantId, "GET", "/custom_fields").catch((err) => {
            console.error("[RD CRM Fields] Erro ao buscar campos customizados:", err.message);
            return { error: err.message };
          });

          // Busca funis configurados no RD CRM
          const pipelines = await rdRequest(tenantId, "GET", "/pipelines").catch((err) => {
            console.error("[RD CRM Fields] Erro ao buscar funis (pipelines):", err.message);
            return { error: err.message };
          });

          return new Response(JSON.stringify({ customFields, pipelines }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
