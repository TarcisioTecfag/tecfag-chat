import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { operators } from "../../db/schema";
import { eq } from "drizzle-orm";

export const Route = createFileRoute("/api/operators")({
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

        try {
          // Se tenantId for fornecido, filtra por ele. Caso contrário, lista todos.
          const query = tenantId 
            ? db.select().from(operators).where(eq(operators.tenantId, tenantId))
            : db.select().from(operators);

          const list = await query;

          return new Response(JSON.stringify(list), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao listar operadores do DB:", e);
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
          const { id, tenantId, name, email, passwordHash, role, avatar, status, groupId } = body;

          if (!id || !tenantId || !name || !email) {
            return new Response(JSON.stringify({ error: "id, tenantId, name e email são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Verificar se o operador já existe
          const existing = await db.query.operators.findFirst({
            where: eq(operators.id, id),
          });

          if (existing) {
            // Atualizar operador existente
            await db
              .update(operators)
              .set({
                tenantId,
                name,
                email,
                passwordHash: passwordHash || existing.passwordHash,
                role: role || existing.role,
                avatar: avatar !== undefined ? avatar : existing.avatar,
                status: status || existing.status,
                groupId: groupId !== undefined ? groupId : existing.groupId,
              })
              .where(eq(operators.id, id));
          } else {
            // Inserir novo operador
            await db.insert(operators).values({
              id,
              tenantId,
              name,
              email,
              passwordHash: passwordHash || "123456",
              role: role || "agent",
              avatar: avatar || null,
              status: status || "disponivel",
              groupId: groupId || null,
              isOnline: true,
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao criar/atualizar operador no DB:", e);
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
          await db.delete(operators).where(eq(operators.id, id));
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao excluir operador no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
