import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { operators, conversations, internalMessages } from "../../db/schema";
import { eq, and } from "drizzle-orm";

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
        const action   = url.searchParams.get("action");
        const id       = url.searchParams.get("id");

        // tenantId é OBRIGATÓRIO — nunca retornar operadores de múltiplos tenants
        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // GET ?action=count-linked&id=<operatorId> — conta conversas vinculadas
        if (action === "count-linked" && id) {
          try {
            const linked = await db
              .select({ id: conversations.id, queueState: conversations.queueState })
              .from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), eq(conversations.operatorId as any, id)));

            const active = linked.filter((c) => c.queueState !== "finalizados").length;
            return new Response(JSON.stringify({ total: linked.length, active }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        try {
          const list = await db.select().from(operators).where(eq(operators.tenantId, tenantId));

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
        const tenantId = url.searchParams.get("tenantId");

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // Verificar pertinência ao tenant antes de deletar
          const existing = await db.query.operators.findFirst({
            where: eq(operators.id, id),
          });

          if (!existing) {
            return new Response(JSON.stringify({ error: "Operador não encontrado" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (existing.tenantId !== tenantId) {
            console.warn(`[DELETE /api/operators] Tentativa de deletar operador ${id} do tenant ${existing.tenantId} pelo tenant ${tenantId}. Bloqueado.`);
            return new Response(JSON.stringify({ error: "Acesso negado: operador não pertence ao seu tenant" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Contar atendimentos vinculados (para resposta informativa ao frontend)
          const linkedConvs = await db
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                eq(conversations.operatorId as any, id)
              )
            );
          const linkedCount = linkedConvs.length;

          // Zerar operatorId em todas as conversas do operador antes de deletar
          // (garantia extra — o FK onDelete:set null pode não estar ativo no Railway)
          if (linkedCount > 0) {
            await db
              .update(conversations)
              .set({ operatorId: null })
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  eq(conversations.operatorId as any, id)
                )
              );
            console.log(`[DELETE /api/operators] ${linkedCount} conversa(s) desvinculadas do operador ${id}.`);
          }

          // ── Limpar internal_messages do operador (FK sem CASCADE no banco legado) ──
          // Sem isso, o DELETE falha com FK violation se o operador tiver
          // logs do Supervisor (internalMessages.operatorId → operators.id).
          await db
            .delete(internalMessages)
            .where(eq(internalMessages.operatorId, id));
          console.log(`[DELETE /api/operators] internal_messages do operador ${id} removidas.`);

          await db.delete(operators).where(eq(operators.id, id));
          return new Response(JSON.stringify({ success: true, unlinkedConversations: linkedCount }), {
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
