import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { RdCrmMigrator } from "../../../../lib/crm/rd-migrator";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/import/rd-crm")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * POST /api/crm/import/rd-crm
       * Aciona o processo de migração e backfill do RD Station CRM para o banco local.
       * Requer permissão de administrador.
       */
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          // Apenas admin tem permissão para disparar migração em massa
          if (session.operator.role !== "admin") {
            return new Response(
              JSON.stringify({ error: "Permissão insuficiente. Apenas administradores podem acionar migração.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          console.log(`[RD Migration Route] Disparando migração para tenant ${tenantId} pelo operador ${session.operator.id}...`);
          const summary = await RdCrmMigrator.migrateAll(tenantId, session.operator.id);

          return new Response(JSON.stringify({ success: true, summary }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[RD Migration Route] Erro ao executar migração:", err);
          return new Response(
            JSON.stringify({ error: err.message || "Erro interno durante a migração." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
