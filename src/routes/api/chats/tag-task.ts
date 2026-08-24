import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { conversations, contacts, messages } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { rdRequest } from "../../../lib/rdCrmService";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/chats/tag-task")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        try {
          const body = await request.json() as {
            conversationId: string;
            tagName: string;
            tenantId: string;
            operatorName?: string;
          };

          const { conversationId, tagName, tenantId, operatorName } = body;

          if (!conversationId || !tagName || !tenantId) {
            return new Response(
              JSON.stringify({ error: "conversationId, tagName e tenantId sao obrigatorios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 1. Buscar conversa + contato para obter rdCrmDealId
          const [conv] = await db
            .select({ contactId: conversations.contactId })
            .from(conversations)
            .where(eq(conversations.id, conversationId));

          if (!conv?.contactId) {
            return new Response(
              JSON.stringify({ skipped: true, reason: "Conversa nao encontrada" }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const [contact] = await db
            .select({ rdCrmDealId: contacts.rdCrmDealId, name: contacts.name })
            .from(contacts)
            .where(eq(contacts.id, conv.contactId));

          if (!contact?.rdCrmDealId) {
            // Sem deal no CRM — tag salva normalmente, tarefa ignorada silenciosamente
            return new Response(
              JSON.stringify({ skipped: true, reason: "Contato sem card no CRM" }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 2. Criar Activity "task" no RD CRM
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 1);
          const dueDateISO = dueDate.toISOString().split("T")[0]; // YYYY-MM-DD

          let activityCreated = false;
          try {
            await rdRequest(tenantId, "POST", "/activities", {
              subject: `Tag: ${tagName}`,
              type: "task",
              deal_id: contact.rdCrmDealId,
              due_date: dueDateISO,
              notes: `Tag "${tagName}" adicionada via Valem Chat${operatorName ? ` por ${operatorName}` : ""}`,
            });
            activityCreated = true;
          } catch (crmErr: any) {
            console.warn(`[TagTask] Falha ao criar activity no CRM (nao bloqueante):`, crmErr.message);
          }

          // 3. Salvar mensagem de sistema no chat registrando o evento
          if (activityCreated) {
            try {
              await db.insert(messages).values({
                id: `sys-tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                conversationId,
                tenantId,
                senderType: "system",
                senderName: "Sistema",
                content: `Tag "${tagName}" adicionada — Tarefa criada no CRM`,
                isInternalNote: false,
                sentAt: new Date(),
              });
            } catch (msgErr: any) {
              console.warn(`[TagTask] Falha ao salvar system message:`, msgErr.message);
            }
          }

          return new Response(
            JSON.stringify({ success: true, activityCreated }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[TagTask] Erro inesperado:", e.message);
          return new Response(
            JSON.stringify({ error: e.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
