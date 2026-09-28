import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { crmService } from "../../../../../lib/crm/crm-service";
import { db } from "../../../../../db";
import { crmDeals, crmProducts } from "../../../../../db/schema";
import { eq, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/products")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/products
       * Lista os itens de produtos vinculados a uma negociação com validação de tenant.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };

          // Valida existência e pertencimento do Deal ao tenant
          const [deal] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return new Response(
              JSON.stringify({ error: "Negociação não encontrada para este tenant.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const products = await crmService.getDealProducts(tenantId, dealId);

          return new Response(JSON.stringify({ products }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Products API] Erro no GET:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * POST /api/crm/deals/:dealId/products
       * Adiciona um produto à negociação com validação estrita de pertencimento multi-tenant
       * e execução 100% transacional no crmService.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };
          const body = await request.json();

          // 1. Validação prévia de existência do Deal no tenant da sessão
          const [deal] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return new Response(
              JSON.stringify({ error: "Negociação não encontrada ou não pertence ao seu tenant.", code: "FORBIDDEN" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 2. Validação prévia de existência e isolamento do Produto no tenant da sessão (se informado)
          if (body.productId) {
            const [product] = await db
              .select({ id: crmProducts.id })
              .from(crmProducts)
              .where(and(eq(crmProducts.id, body.productId), eq(crmProducts.tenantId, tenantId)))
              .limit(1);

            if (!product) {
              return new Response(
                JSON.stringify({
                  error: "O produto selecionado não existe ou pertence a outro tenant.",
                  code: "TENANT_MISMATCH",
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }

          // 3. Validações comerciais de formato e limites
          if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
            return new Response(JSON.stringify({ error: "Nome do produto é obrigatório." }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const qty = parseFloat(body.quantity);
          if (isNaN(qty) || qty <= 0) {
            return new Response(JSON.stringify({ error: "Quantidade deve ser maior que zero." }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const price = parseFloat(body.unitPrice);
          if (isNaN(price) || price < 0) {
            return new Response(JSON.stringify({ error: "Preço unitário não pode ser negativo." }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const discount = parseFloat(body.discountPercent ?? "0");
          if (isNaN(discount) || discount < 0 || discount > 100) {
            return new Response(JSON.stringify({ error: "Desconto percentual deve estar entre 0% e 100%." }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // 4. Execução transacional atômica via crmService
          const product = await crmService.addDealProduct(tenantId, dealId, session.operator.id, {
            productId: body.productId || null,
            name: body.name.trim(),
            quantity: qty,
            unitPrice: price,
            discountPercent: discount,
            notes: body.notes,
          });

          return new Response(JSON.stringify({ product }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Products API] Erro no POST:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId/products
       * Remove um item da negociação com validação estrita de tenant e recálculo transacional.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };
          const url = new URL(request.url);
          const dealProductId = url.searchParams.get("dealProductId");

          if (!dealProductId) {
            return new Response(JSON.stringify({ error: "dealProductId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const success = await crmService.removeDealProduct(
            tenantId,
            dealId,
            dealProductId,
            session.operator.id
          );

          if (!success) {
            return new Response(
              JSON.stringify({ error: "Item de produto não encontrado ou não pertence a este negócio/tenant." }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Products API] Erro no DELETE:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
