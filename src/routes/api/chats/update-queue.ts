import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { conversations, contacts, messages, operators } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { auditService } from "../../../lib/audit-service";

export const Route = createFileRoute("/api/chats/update-queue")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const body = await request.json();
          const { conversationId, queueState, operatorId, sectorId } = body;

          if (!conversationId || !queueState) {
            return new Response(
              JSON.stringify({ error: "conversationId e queueState são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 1. Verificar se a conversa existe
          const conv = await db.query.conversations.findFirst({
            where: eq(conversations.id, conversationId),
          });

          if (!conv) {
            return new Response(
              JSON.stringify({ error: "Conversa não encontrada" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 2. Montar objeto de atualização
          const updateData: Record<string, any> = {
            queueState,
            updatedAt: new Date(),
          };

          if (operatorId !== undefined) {
            updateData.operatorId = operatorId || null;
          }
          if (sectorId !== undefined) {
            updateData.sectorId = sectorId || null;
          }

          // 3. Atualizar a conversa no Banco
          await db
            .update(conversations)
            .set(updateData)
            .where(eq(conversations.id, conversationId));

          // 3.5. Gerar mensagem de auditoria no chat conforme a transição de fila
          let systemMessageText = "";
          const targetOpId = operatorId !== undefined ? operatorId : conv.operatorId;

          if (queueState === "meus" && targetOpId) {
            const op = await db.query.operators.findFirst({
              where: eq(operators.id, targetOpId),
            });
            const opName = op?.name || "Operador";
            systemMessageText = `Atendimento assumido por ${opName}.`;
          } else if (queueState === "fila") {
            systemMessageText = `Atendimento devolvido para a Fila de Espera.`;
          } else if (queueState === "finalizados") {
            systemMessageText = `Atendimento encerrado e encaminhado para os Finalizados.`;
          } else if (queueState === "automacao") {
            systemMessageText = `Atendimento direcionado para a Automação (Valentina IA).`;
          }

          // 3.8. Sincronizar o responsável na tabela do cliente (contacts) sem dessincronia
          let respName = "Na Fila";
          if (targetOpId) {
            const op = await db.query.operators.findFirst({
              where: eq(operators.id, targetOpId),
            });
            if (op) {
              respName = op.name;
            }
          } else if (queueState === "automacao") {
            respName = "Valentina IA";
          } else {
            respName = "Na Fila";
          }

          if (conv.contactId) {
            await db
              .update(contacts)
              .set({ responsibleName: respName })
              .where(eq(contacts.id, conv.contactId));
          }

          // 4. Salvar mensagem de sistema se houver
          if (systemMessageText) {
            const messageId = `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            await db.insert(messages).values({
              id: messageId,
              tenantId: conv.tenantId,
              conversationId,
              senderType: "system",
              senderName: "Sistema",
              content: systemMessageText,
              isInternalNote: true,
              sentAt: new Date(),
            });
          }

          // 5. Notificar TODOS os clientes SSE conectados via evento específico de fila
          const finalOperatorId = operatorId !== undefined ? operatorId : conv.operatorId ?? null;
          const finalSectorId = sectorId !== undefined ? sectorId : (conv as any).sectorId ?? null;

          SessionManager.getInstance().notifyPublic(conv.tenantId, {
            type: "queue_update",
            conversationId,
            queueState,
            operatorId: finalOperatorId,
            sectorId: finalSectorId,
            responsibleName: respName,
          });

          // 6. Se a conversa foi finalizada, enfileira auditoria de IA
          if (queueState === "finalizados") {
            auditService.enqueueAudit({
              tenantId: conv.tenantId,
              conversationId,
              operatorId: finalOperatorId,
              contactName: null,
            }).catch((err) =>
              console.error("[update-queue] Erro ao enfileirar auditoria:", err)
            );
          }

          return new Response(
            JSON.stringify({
              success: true,
              conversationId,
              queueState,
              operatorId: finalOperatorId,
              sectorId: finalSectorId,
              responsibleName: respName,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );

        } catch (e: any) {
          console.error("[api/chats/update-queue] Erro ao atualizar fila da conversa:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
