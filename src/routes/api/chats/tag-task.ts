import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { conversations, contacts, messages } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { rdRequest, getCachedUsers } from "../../../lib/rdCrmService";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Mapa de tipos para label legivel no CRM
const TASK_TYPE_LABELS: Record<string, string> = {
  task:    "Tarefa",
  call:    "Ligacao",
  meeting: "Reuniao",
  email:   "E-mail",
  lunch:   "Almoco / Visita",
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
            taskType?: string;
            dueDate?: string;  // "YYYY-MM-DD"
            dueTime?: string;  // "HH:MM"
          };

          const {
            conversationId, tagName, tenantId, operatorName,
            taskType = "task",
            dueDate,
            dueTime,
          } = body;

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
            return new Response(
              JSON.stringify({ skipped: true, reason: "Contato sem card no CRM" }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 2. Montar data/hora de vencimento (formato ISO 8601)
          let dueDateISO = dueDate;
          if (!dueDateISO) {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            dueDateISO = d.toISOString().split("T")[0];
          }
          const dueDateTimeFull = dueTime
            ? `${dueDateISO}T${dueTime}:00-03:00`
            : `${dueDateISO}T09:00:00-03:00`;

          const typeLabel = TASK_TYPE_LABELS[taskType] || "Tarefa";

          // 3. Buscar o user_id do responsável pelo deal no RD CRM
          //    A tarefa SEMPRE fica no nome do dono atual do card, não do operador do nosso sistema.
          //    Isso é obrigatório pois o campo "created_by" é required pelo RD CRM.
          let dealOwnerId: string | undefined;
          try {
            // Tenta obter o user_id diretamente do deal
            const deal = await rdRequest<any>(tenantId, "GET", `/deals/${contact.rdCrmDealId}`);
            dealOwnerId = deal?.user_id || deal?.owner?.id;
          } catch {/* ignora */}

          if (!dealOwnerId) {
            // Fallback: primeiro usuário disponível
            try {
              const users = await getCachedUsers(tenantId);
              if (Array.isArray(users) && users.length > 0) dealOwnerId = users[0].id;
            } catch {/* ignora */}
          }

          // 4. Criar Task no RD CRM via endpoint correto /tasks
          let taskCreated = false;
          try {
            await rdRequest(tenantId, "POST", "/tasks", {
              name: tagName,
              type: taskType,
              deal_id: contact.rdCrmDealId,
              due_date: dueDateTimeFull,
              notes: `Tarefa criada via Valem Chat${operatorName ? " por " + operatorName : ""}. Tipo: ${typeLabel}.`,
              ...(dealOwnerId ? { user_id: dealOwnerId, created_by: dealOwnerId } : {}),
            });
            taskCreated = true;
          } catch (crmErr: any) {
            console.warn(`[TagTask] Falha ao criar task no CRM:`, crmErr.message);
          }


          // 5. Salvar mensagem de sistema no chat (so se criou com sucesso)
          if (taskCreated) {
            try {
              const [d, m, y] = dueDateISO.split("-");
              const dueFmt = `${y}/${m}/${d}${dueTime ? " as " + dueTime : ""}`;

              await db.insert(messages).values({
                id: `sys-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                conversationId,
                tenantId,
                senderType: "system",
                senderName: "Sistema",
                content: `Tarefa criada: "${tagName}" (${typeLabel}) — Venc. ${dueFmt}`,
                isInternalNote: false,
                sentAt: new Date(),
              });
            } catch (msgErr: any) {
              console.warn(`[TagTask] Falha ao salvar system message:`, msgErr.message);
            }
          }

          return new Response(
            JSON.stringify({ success: true, taskCreated }),
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
