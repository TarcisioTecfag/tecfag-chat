import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/index.js";
import { sectors } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { getAuthSession, validateTenantAccess } from "../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/sectors")({
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
            .from(sectors)
            .where(eq(sectors.tenantId, effectiveTenantId));

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[GET /api/sectors] Erro ao listar setores do DB:", e);
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
          const { id, name, operatorIds } = body;

          const tenantId = session ? session.tenantId : body.tenantId;

          if (!tenantId) {
            return new Response(
              JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
              { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (session && body.tenantId && body.tenantId !== session.tenantId) {
            return new Response(
              JSON.stringify({ error: "Não é permitido manipular setores de outro tenant.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!id || !name) {
            return new Response(JSON.stringify({ error: "id e name são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const existing = await db.query.sectors.findFirst({
            where: eq(sectors.id, id),
          });

          if (existing) {
            if (existing.tenantId !== tenantId) {
              return new Response(
                JSON.stringify({ error: "Setor não encontrado neste tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            await db
              .update(sectors)
              .set({
                name,
                operatorIds: operatorIds || existing.operatorIds,
              })
              .where(and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)));
          } else {
            await db.insert(sectors).values({
              id,
              tenantId,
              name,
              operatorIds: operatorIds || [],
              createdAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/sectors] Erro ao criar/atualizar setor no DB:", e);
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
          const existing = await db.query.sectors.findFirst({
            where: and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)),
          });

          if (!existing) {
            return new Response(
              JSON.stringify({ error: "Setor não encontrado.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await db
            .delete(sectors)
            .where(and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[DELETE /api/sectors] Erro ao excluir setor no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
