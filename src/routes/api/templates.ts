import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { operatorTemplates } from "../../db/schema";
import { eq, and } from "drizzle-orm";

export const Route = createFileRoute("/api/templates")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const operatorId = url.searchParams.get("operatorId");

        if (!tenantId || !operatorId) {
          return new Response(JSON.stringify({ error: "tenantId e operatorId são obrigatórios" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const list = await db
            .select()
            .from(operatorTemplates)
            .where(
              and(
                eq(operatorTemplates.tenantId, tenantId),
                eq(operatorTemplates.operatorId, operatorId)
              )
            )
            .orderBy(operatorTemplates.title);

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao listar templates do DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const body = await request.json();
          const { id, tenantId, operatorId, title, text } = body;

          if (!id || !tenantId || !operatorId || !title || !text) {
            return new Response(
              JSON.stringify({ error: "id, tenantId, operatorId, title e text são obrigatórios" }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          // Verificar se o template já existe
          const existing = await db.query.operatorTemplates.findFirst({
            where: eq(operatorTemplates.id, id),
          });

          if (existing) {
            await db
              .update(operatorTemplates)
              .set({
                tenantId,
                operatorId,
                title,
                text,
              })
              .where(eq(operatorTemplates.id, id));
          } else {
            await db.insert(operatorTemplates).values({
              id,
              tenantId,
              operatorId,
              title,
              text,
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao criar/atualizar template no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      DELETE: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const url = new URL(request.url);
        const id = url.searchParams.get("id");

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          await db.delete(operatorTemplates).where(eq(operatorTemplates.id, id));
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao excluir template no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
