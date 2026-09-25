import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/index.js";
import { quickResponses } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { getAuthSession, validateTenantAccess } from "../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/quick-responses")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const session = await getAuthSession(request);
        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");

        const effectiveTenantId = session ? session.tenantId : queryTenantId;

        if (!effectiveTenantId) {
          return new Response(
            JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
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
            .from(quickResponses)
            .where(eq(quickResponses.tenantId, effectiveTenantId));

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[GET /api/quick-responses] Erro ao listar respostas rápidas:", e);
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
          const { id, shortcut, text, description } = body;

          const tenantId = session ? session.tenantId : body.tenantId;

          if (!tenantId) {
            return new Response(
              JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
              { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (session && body.tenantId && body.tenantId !== session.tenantId) {
            return new Response(
              JSON.stringify({ error: "Não é permitido manipular respostas de outro tenant.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!id || !shortcut || !text) {
            return new Response(
              JSON.stringify({ error: "id, shortcut e text são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const existing = await db.query.quickResponses.findFirst({
            where: eq(quickResponses.id, id),
          });

          if (existing) {
            if (existing.tenantId !== tenantId) {
              return new Response(
                JSON.stringify({ error: "Resposta rápida não encontrada neste tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            await db
              .update(quickResponses)
              .set({
                shortcut,
                text,
                description: description || null,
              })
              .where(and(eq(quickResponses.id, id), eq(quickResponses.tenantId, tenantId)));
          } else {
            await db.insert(quickResponses).values({
              id,
              tenantId,
              shortcut,
              text,
              description: description || null,
              createdAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/quick-responses] Erro ao salvar resposta rápida:", e);
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
          const existing = await db.query.quickResponses.findFirst({
            where: and(eq(quickResponses.id, id), eq(quickResponses.tenantId, tenantId)),
          });

          if (!existing) {
            return new Response(
              JSON.stringify({ error: "Resposta rápida não encontrada.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await db
            .delete(quickResponses)
            .where(and(eq(quickResponses.id, id), eq(quickResponses.tenantId, tenantId)));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[DELETE /api/quick-responses] Erro ao excluir resposta rápida:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
