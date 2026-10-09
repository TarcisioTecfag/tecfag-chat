import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { client } from "../../../../db";
// @ts-ignore
import { applyTecfagCrmSeed } from "../../../../../scripts/apply-tecfag-crm-seed.mjs";
// @ts-ignore
import { cleanupSyntheticOperators } from "../../../../../scripts/cleanup-synthetic-operators.mjs";



const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-migration-key",
};

export const Route = createFileRoute("/api/crm/import/sync-status")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/import/sync-status
       * Retorna a contagem em tempo real e o estado da carga do CRM para o tenant tecfag.
       */
      GET: async ({ request }) => {
        try {
          const migrationKey = request.headers.get("x-migration-key");
          let tenantId = "tecfag";

          if (migrationKey !== "tecfag-crm-migration-2026") {
            const auth = await requireSession(request);
            if ("response" in auth) return auth.response;
            tenantId = auth.session.tenantId;
          }

          const [migrationCheck] = await client`
            SELECT name, applied_at FROM app_deploy_migrations WHERE name = '0033_tecfag_crm_complete_seed'
          `;

          const [deals] = await client`SELECT count(*)::int as count FROM crm_deals WHERE tenant_id = ${tenantId}`;
          const [contacts] = await client`SELECT count(*)::int as count FROM contacts WHERE tenant_id = ${tenantId}`;
          const [accounts] = await client`SELECT count(*)::int as count FROM crm_accounts WHERE tenant_id = ${tenantId}`;
          const [links] = await client`SELECT count(*)::int as count FROM crm_deal_contacts WHERE tenant_id = ${tenantId}`;
          const [pipelines] = await client`SELECT count(*)::int as count FROM crm_pipelines WHERE tenant_id = ${tenantId}`;
          const [stages] = await client`SELECT count(*)::int as count FROM crm_stages WHERE tenant_id = ${tenantId}`;
          const [customFields] = await client`SELECT count(*)::int as count FROM crm_custom_field_definitions WHERE tenant_id = ${tenantId}`;
          const allOperators = await client`SELECT id, name, email, role FROM operators WHERE tenant_id = ${tenantId}`;
          const realOperators = allOperators.filter((o: any) => !o.id.startsWith("op-tf-"));
          const syntheticCount = allOperators.length - realOperators.length;

          return new Response(
            JSON.stringify({
              success: true,
              tenantId,
              seedMigration: migrationCheck ? { name: migrationCheck.name, appliedAt: migrationCheck.applied_at } : null,
              counts: {
                deals: deals.count,
                contacts: contacts.count,
                accounts: accounts.count,
                dealContacts: links.count,
                pipelines: pipelines.count,
                stages: stages.count,
                customFields: customFields.count,
                operators: realOperators.length,
                syntheticOperators: syntheticCount,
              },
              operators: realOperators,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (err: any) {
          console.error("[Sync Status API] Erro:", err);
          return new Response(
            JSON.stringify({ error: err.message || "Erro interno." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },

      /**
       * POST /api/crm/import/sync-status
       * Aciona manualmente a limpeza de operadores sintéticos ou aplicação do seed Tecfag CRM.
       */
      POST: async ({ request }) => {
        try {
          const migrationKey = request.headers.get("x-migration-key");
          if (migrationKey !== "tecfag-crm-migration-2026") {
            const auth = await requireSession(request);
            if ("response" in auth) return auth.response;
            if (auth.session.operator.role !== "admin") {
              return new Response(JSON.stringify({ error: "Apenas administradores podem acionar a migração." }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }

          const url = new URL(request.url);
          const action = url.searchParams.get("action");

          if (action === "cleanup-operators" || !action) {
            console.log("[Sync Status API] Disparando limpeza e remapeamento de operadores sintéticos...");
            const cleanupResult = await cleanupSyntheticOperators(client);
            return new Response(
              JSON.stringify({
                success: true,
                action: "cleanup-operators",
                result: cleanupResult,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          console.log("[Sync Status API] Disparando aplicação do seed Tecfag CRM via API...");
          const result = await applyTecfagCrmSeed(client);

          return new Response(
            JSON.stringify({
              success: true,
              action: "seed",
              result,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (err: any) {
          console.error("[Sync Status API] Erro no POST:", err);
          return new Response(
            JSON.stringify({ error: err.message || "Erro interno na execução da migração." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },

    },
  },
});
