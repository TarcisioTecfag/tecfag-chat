import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { RdCrmMigrator } from "../../../../lib/crm/rd-migrator";
import { CrmConcurrencyError, CrmValidationError } from "../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/import/rd-crm")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/import/rd-crm
       * Consulta o estado atual da integração, histórico de migrações e política de fonte de verdade.
       * Suporta query param ?inspect=true para inventário somente-leitura prévio do RD.
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const url = new URL(request.url);
          const inspect = url.searchParams.get("inspect") === "true";

          if (inspect) {
            // Inventário remoto do RD Station somente-leitura
            const remoteInventory = await RdCrmMigrator.inspectRdInventory(tenantId);
            return new Response(JSON.stringify({ inventory: remoteInventory }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const policy = await RdCrmMigrator.getSyncPolicy(tenantId);
          const runs = await RdCrmMigrator.getMigrationRuns(tenantId, 10);

          return new Response(
            JSON.stringify({
              policy,
              recentRuns: runs,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (err: any) {
          console.error("[RD Migration Route] Erro GET:", err);
          return new Response(
            JSON.stringify({ error: err.message || "Erro interno." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },

      /**
       * POST /api/crm/import/rd-crm
       * Aciona o processo de migração e backfill do RD Station CRM para o banco local.
       * Suporta dryRun, forceUpdate e proteção contra concorrência simultânea (409 Conflict).
       * Requer permissão de administrador.
       */
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          if (session.operator.role !== "admin") {
            return new Response(
              JSON.stringify({
                error: "Permissão insuficiente. Apenas administradores podem acionar migração.",
                code: "FORBIDDEN",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          let body: any = {};
          try {
            body = await request.json();
          } catch {
            body = {};
          }

          if (body.dryRun) {
            const inventory = await RdCrmMigrator.inspectRdInventory(tenantId);
            return new Response(
              JSON.stringify({ success: true, dryRun: true, inventory }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          console.log(`[RD Migration Route] Disparando migração para tenant ${tenantId} pelo operador ${session.operator.id}...`);
          const summary = await RdCrmMigrator.migrateAll(tenantId, session.operator.id, {
            forceUpdate: body.forceUpdate === true,
            sourceOfTruth: body.sourceOfTruth,
          });

          return new Response(JSON.stringify({ success: true, summary }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          if (err instanceof CrmConcurrencyError) {
            return new Response(
              JSON.stringify({ error: err.message, code: "CONCURRENCY_CONFLICT" }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          console.error("[RD Migration Route] Erro ao executar migração:", err);
          return new Response(
            JSON.stringify({ error: err.message || "Erro interno durante a migração." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },

      /**
       * PATCH /api/crm/import/rd-crm
       * Atualiza a política de fonte de verdade ('rd_primary' | 'local_primary') e sincronização.
       * Requer permissão de administrador.
       */
      PATCH: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          if (session.operator.role !== "admin") {
            return new Response(
              JSON.stringify({
                error: "Permissão insuficiente. Apenas administradores podem alterar a política de sincronização.",
                code: "FORBIDDEN",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const body = await request.json();
          const updatedPolicy = await RdCrmMigrator.updateSyncPolicy(tenantId, session.operator.id, body);

          return new Response(JSON.stringify({ success: true, policy: updatedPolicy }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          if (err instanceof CrmValidationError) {
            return new Response(
              JSON.stringify({ error: err.message, code: err.code }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          console.error("[RD Migration Route] Erro PATCH:", err);
          return new Response(
            JSON.stringify({ error: err.message || "Erro interno." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
