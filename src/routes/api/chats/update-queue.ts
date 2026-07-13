import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { conversations, messages, contacts, operators } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { AuditService } from "../../../lib/audit-service";
import { SessionManager } from "../../../lib/baileys/session-manager";

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
          const { conversationId, queueState, systemMessageText, operatorId, sectorId } = body;

          if (!conversationId || !queueState) {
            return new Response(JSON.stringify({ error: "conversationId e queueState são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // 1. Obter a conversa atual para validar
          const conv = await db.query.conversations.findFirst({
            where: eq(conversations.id, conversationId),
          });

          if (!conv) {
            return new Response(JSON.stringify({ error: "Conversa não encontrada" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // 2. Lock atômico: impede captura dupla.
          // Se outra operadora já capturou o chat (operatorId existente e diferente do solicitante),
          // retorna 409 Conflict para que o frontend possa fazer rollback.
          if (
            queueState === "meus" &&
            operatorId &&
            conv.operatorId &&
            conv.operatorId !== operatorId &&
            conv.queueState === "meus"
          ) {
            return new Response(
              JSON.stringify({ error: "conflict", currentOperatorId: conv.operatorId }),
              {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          const targetOpId = operatorId !== undefined ? operatorId : conv.operatorId;

          // 3. Atualizar o queueState e operatorId no banco
          await db
            .update(conversations)
            .set({
              queueState,
              operatorId: targetOpId,
              sectorId: sectorId !== undefined ? sectorId : (conv as any).sectorId,
              lastMessageText: systemMessageText || conv.lastMessageText,
              lastMessageTime: new Date(),
            })
            .where(eq(conversations.id, conversationId));

          // 3.5. Se a conversa foi capturada/transferida, vincula à carteira do contato —
          // apenas quando não havia dono anterior (captura da fila), para não sobrescrever
          // a carteira em transferências temporárias.
          if (queueState === "meus" && targetOpId && conv.contactId && !conv.operatorId) {
            await db
              .update(contacts)
              .set({ walletOperatorId: targetOpId })
              .where(eq(contacts.id, conv.contactId));
          }

          // 3.8. Sincronizar o responsável na tabela do cliente (contacts)
          let respName = "Na Fila";
          if (targetOpId && queueState === "meus") {
            const op = await db.query.operators.findFirst({
              where: eq(operators.id, targetOpId),
            });
            if (op) {
              respName = op.name;
            }
          }

          if (conv.contactId) {
            await db
              .update(contacts)
              .set({ responsibleName: respName })
              .where(eq(contacts.id, conv.contactId));
          }

          // 4. Se enviou uma mensagem de log do sistema, salvar
          if (systemMessageText) {
            // Sufixo aleatório para evitar colisão de IDs se dois eventos ocorrem no mesmo ms
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

          // 5. Notificar TODOS os clientes SSE conectados via evento específico de fila.
          // Usar type: "queue_update" — distinto de "message" — para o frontend saber
          // que é apenas uma mudança de estado, sem criar balões de mensagem falsos.
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
            // Race-condition fix: enqueueAudit é aguardado antes de qualquer batch rodar.
            // AuditService já está iniciado no boot (alerts.ts) — start() aqui é apenas fallback.
            (async () => {
              try {
                const rows = await db.select({ name: contacts.name })
                  .from(contacts)
                  .where(eq(contacts.id, conv.contactId ?? ""))
                  .limit(1);

                await AuditService.getInstance().enqueueAudit({
                  tenantId: conv.tenantId,
                  conversationId,
                  operatorId: operatorId ?? conv.operatorId,
                  contactName: rows[0]?.name ?? null,
                });

                // Garante que o serviço está rodando (caso o servidor reiniciou
                // sem ter passado pelo alerts.ts antes desta finalização)
                AuditService.getInstance().start();
              } catch (e) {
                console.error("[AuditService] Erro ao enfileirar auditoria:", e);
              }
            })();
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao atualizar fila da conversa no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
