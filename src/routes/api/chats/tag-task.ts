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
            taskType?: string;   // "task" | "call" | "meeting" | "email" | "lunch"
            dueDate?: string;    // "YYYY-MM-DD"
            dueTime?: string;    // "HH:MM"
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

          // 2. Montar data/hora de vencimento
          let dueDateISO = dueDate;
          if (!dueDateISO) {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            dueDateISO = d.toISOString().split("T")[0];
          }

          // Se tiver hora, combinar em datetime ISO 8601 com fuso BR (-03:00)
          let dueDateTimeFull = dueDateISO;
          if (dueTime) {
            dueDateTimeFull = `${dueDateISO}T${dueTime}:00-03:00`;
          }

          const typeLabel = TASK_TYPE_LABELS[taskType] || "Tarefa";

          // 3. Criar Activity no RD CRM
          let activityCreated = false;
          try {
            await rdRequest(tenantId, "POST", "/activities", {
              subject: tagName,
              type: taskType,
              deal_id: contact.rdCrmDealId,
              due_date: dueDateTimeFull,
              notes: `Tarefa criada via Valem Chat${operatorName ? ` por ${operatorName}` : ""}. Tipo: ${typeLabel}.`,
            });
            activityCreated = true;
          } catch (crmErr: any) {
            console.warn(`[TagTask] Falha ao criar activity no CRM (nao bloqueante):`, crmErr.message);
          }

          // 4. Salvar mensagem de sistema no chat
          if (activityCreated) {
            try {
              const dueParts = dueDateISO.split("-");
              const dueFmt = dueParts.length === 3
                ? `${dueParts[2]}/${dueParts[1]}/${dueParts[0]}${dueTime ? " as " + dueTime : ""}`
                : dueDateISO;

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
