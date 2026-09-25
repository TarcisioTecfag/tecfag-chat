import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/index.js";
import { operatorTemplates } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { getAuthSession, validateTenantAccess } from "../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/templates")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const session = await getAuthSession(request);
        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        const queryOperatorId = url.searchParams.get("operatorId");

        const effectiveTenantId = session ? session.tenantId : queryTenantId;
        const effectiveOperatorId = session ? session.operator.id : queryOperatorId;

        if (!effectiveTenantId || !effectiveOperatorId) {
          return new Response(
            JSON.stringify({ error: "Sessão inválida ou parâmetros ausentes.", code: "UNAUTHORIZED" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (session) {
          const check = validateTenantAccess(session, queryTenantId);
          if (check) return check;
        }

        try {
          const list = await db
            .select()
            .from(operatorTemplates)
            .where(
              and(
                eq(operatorTemplates.tenantId, effectiveTenantId),
                eq(operatorTemplates.operatorId, effectiveOperatorId)
              )
            )
            .orderBy(operatorTemplates.title);

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[GET /api/templates] Erro ao listar templates do DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      POST: async ({ request }) => {
        try {
          const session = await getAuthSession(request);
          const body = await request.json().catch(() => ({}));
          const { id, title, text } = body;

          const tenantId = session ? session.tenantId : body.tenantId;
          const operatorId = session ? session.operator.id : body.operatorId;

          if (!tenantId || !operatorId) {
            return new Response(
              JSON.stringify({ error: "Sessão inválida ou parâmetros ausentes.", code: "UNAUTHORIZED" }),
              { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (session && body.tenantId && body.tenantId !== session.tenantId) {
            return new Response(
              JSON.stringify({ error: "Não é permitido manipular templates de outro tenant.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!id || !title || !text) {
            return new Response(
              JSON.stringify({ error: "id, title e text são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const existing = await db.query.operatorTemplates.findFirst({
            where: eq(operatorTemplates.id, id),
          });

          if (existing) {
            if (existing.tenantId !== tenantId || existing.operatorId !== operatorId) {
              return new Response(
                JSON.stringify({ error: "Template não encontrado.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            await db
              .update(operatorTemplates)
              .set({ title, text })
              .where(and(eq(operatorTemplates.id, id), eq(operatorTemplates.tenantId, tenantId)));
          } else {
            await db.insert(operatorTemplates).values({
              id,
              tenantId,
              operatorId,
              title,
              text,
              createdAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/templates] Erro ao salvar template no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      DELETE: async ({ request }) => {
        const session = await getAuthSession(request);
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const queryTenantId = url.searchParams.get("tenantId");

        const tenantId = session ? session.tenantId : queryTenantId;
        const operatorId = session ? session.operator.id : url.searchParams.get("operatorId");

        if (!tenantId) {
          return new Response(
            JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const existing = await db.query.operatorTemplates.findFirst({
            where: and(
              eq(operatorTemplates.id, id),
              eq(operatorTemplates.tenantId, tenantId)
            ),
          });

          if (!existing) {
            return new Response(
              JSON.stringify({ error: "Template não encontrado.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Se operador comum, só pode deletar seu próprio template
          if (session && session.operator.role !== "admin" && existing.operatorId !== session.operator.id) {
            return new Response(
              JSON.stringify({ error: "Permissão insuficiente para excluir este template.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await db
            .delete(operatorTemplates)
            .where(and(eq(operatorTemplates.id, id), eq(operatorTemplates.tenantId, tenantId)));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[DELETE /api/templates] Erro ao excluir template no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
