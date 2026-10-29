import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import { crmService, handleCrmError } from "../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/products")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/products
       * Lista produtos e serviços do catálogo do tenant.
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
          const search = url.searchParams.get("search") || undefined;
          const isActiveParam = url.searchParams.get("isActive");
          const isActive = isActiveParam !== null ? isActiveParam === "true" : undefined;

          const products = await crmService.getProducts(tenantId, { search, isActive });
          const canManageProducts = !requireCrmPermission(session, "canManageProducts");

          return new Response(JSON.stringify({ products, canManageProducts }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Products API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * POST /api/crm/products
       * Cria novo produto, importa lote ou sincroniza catálogo da VTEX no tenant.
       */
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canManageProducts");
          if (permError) return permError;

          const body = await request.json();

          if (body.action === "sync_vtex") {
            const result = await crmService.syncProductsFromVtex(tenantId);
            return new Response(JSON.stringify(result), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (body.action === "import_batch") {
            if (!Array.isArray(body.items) || body.items.length === 0) {
              return new Response(
                JSON.stringify({ error: "Nenhum item válido informado para importação." }),
                {
                  status: 400,
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
              );
            }
            const result = await crmService.importProductsBatch(tenantId, body.items);
            return new Response(JSON.stringify(result), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
            return new Response(JSON.stringify({ error: "Nome do produto é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const product = await crmService.createProduct(tenantId, {
            name: body.name,
            sku: body.sku,
            description: body.description,
            unitPrice: body.unitPrice,
            unit: body.unit,
            category: body.category,
            isActive: body.isActive,
            customFields: body.customFields,
          });

          return new Response(JSON.stringify({ product }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Products API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
