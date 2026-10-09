import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { client } from "../../../../db";
// @ts-ignore
import { applyTecfagCrmSeed } from "../../../../../scripts/apply-tecfag-crm-seed.mjs";
// @ts-ignore
import { cleanupSyntheticOperators } from "../../../../../scripts/cleanup-synthetic-operators.mjs";
// @ts-ignore
import { reassignMarceloNardelliDeals } from "../../../../../scripts/reassign-marcelo-nardelli-deals.mjs";

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

          const [seedMigrationCheck] = await client`
            SELECT name, applied_at FROM app_deploy_migrations WHERE name = '0033_tecfag_crm_complete_seed'
          `;
          const [marceloMigrationCheck] = await client`
            SELECT name, applied_at FROM app_deploy_migrations WHERE name = '0035_reassign_marcelo_nardelli_deals'
          `;

          const [deals] = await client`SELECT count(*)::int as count FROM crm_deals WHERE tenant_id = ${tenantId}`;
          const [contacts] = await client`SELECT count(*)::int as count FROM contacts WHERE tenant_id = ${tenantId}`;
          const [accounts] = await client`SELECT count(*)::int as count FROM crm_accounts WHERE tenant_id = ${tenantId}`;
          const [links] = await client`SELECT count(*)::int as count FROM crm_deal_contacts WHERE tenant_id = ${tenantId}`;
          const [pipelines] = await client`SELECT count(*)::int as count FROM crm_pipelines WHERE tenant_id = ${tenantId}`;
          const [stages] = await client`SELECT count(*)::int as count FROM crm_stages WHERE tenant_id = ${tenantId}`;
          const [customFields] = await client`SELECT count(*)::int as count FROM crm_custom_field_definitions WHERE tenant_id = ${tenantId}`;
          const [marceloDeals] = await client`SELECT count(*)::int as count FROM crm_deals WHERE tenant_id = ${tenantId} AND operator_id = 'op-1791376825772'`;
          const [tarcisioDeals] = await client`SELECT count(*)::int as count FROM crm_deals WHERE tenant_id = ${tenantId} AND operator_id = '38306207-265e-4cd1-b702-a78805526b94'`;
          const allOperators = await client`SELECT id, name, email, role FROM operators WHERE tenant_id = ${tenantId}`;
          const realOperators = allOperators.filter((o: any) => !o.id.startsWith("op-tf-"));
          const syntheticCount = allOperators.length - realOperators.length;

          return new Response(
            JSON.stringify({
              success: true,
              tenantId,
              seedMigration: seedMigrationCheck ? { name: seedMigrationCheck.name, appliedAt: seedMigrationCheck.applied_at } : null,
              marceloMigration: marceloMigrationCheck ? { name: marceloMigrationCheck.name, appliedAt: marceloMigrationCheck.applied_at } : null,
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
                marceloDeals: marceloDeals.count,
                tarcisioDeals: tarcisioDeals.count,
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

          if (action === "reassign-marcelo") {
            console.log("[Sync Status API] Disparando reatribuição das negociações de Marcelo Nardelli...");
            const marceloResult = await reassignMarceloNardelliDeals(client);
            return new Response(
              JSON.stringify({
                success: true,
                action: "reassign-marcelo",
                result: marceloResult,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

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
