import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { tasks as dbTasks, operators } from "../../../db/schema";
import { eq, desc } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/tasks")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // Busca todas as tarefas locais da empresa
          const storedTasks = await db
            .select()
            .from(dbTasks)
            .where(eq(dbTasks.tenantId, tenantId))
            .orderBy(desc(dbTasks.dueDate));

          // Busca todos os operadores para cruzar e-mail com nome e avatar
          const allOperators = await db
            .select({
              name: operators.name,
              email: operators.email,
              avatar: operators.avatar,
            })
            .from(operators)
            .where(eq(operators.tenantId, tenantId));

          // Mapa de e-mail para operador (nome e avatar)
          const operatorMap = new Map<string, { name: string; avatar: string | null }>();
          for (const op of allOperators) {
            operatorMap.set(op.email.toLowerCase(), { name: op.name, avatar: op.avatar });
          }

          // Enriquece as tarefas com dados dos operadores
          const enrichedTasks = storedTasks.map((t) => {
            const emailKey = t.operatorEmail?.toLowerCase() || "";
            const opInfo = operatorMap.get(emailKey);
            
            return {
              id: t.id,
              name: t.name,
              type: t.type,
              status: t.status,
              dueDate: t.dueDate ? t.dueDate.toISOString() : null,
              description: t.description,
              createdAt: t.createdAt ? t.createdAt.toISOString() : null,
              deal: t.dealId ? { id: t.dealId, name: t.dealName } : null,
              client: { name: t.clientName, phone: t.clientPhone },
              chatContactId: t.chatContactId,
              chatConversationId: t.chatConversationId,
              operatorEmail: t.operatorEmail,
              operatorName: opInfo ? opInfo.name : (t.operatorEmail ? t.operatorEmail.split("@")[0] : "Sem operador"),
              operatorAvatar: opInfo ? opInfo.avatar : null,
            };
          });

          return new Response(JSON.stringify({ tasks: enrichedTasks }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[gestao/tasks] ERRO:", e.message);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
