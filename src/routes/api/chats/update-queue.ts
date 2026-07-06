import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { conversations, messages, contacts } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { AuditService } from "../../../lib/audit-service";

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
          const { conversationId, queueState, systemMessageText, operatorId } = body;

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

          // 2. Atualizar o queueState e operatorId no banco
          await db
            .update(conversations)
            .set({
              queueState,
              operatorId: operatorId !== undefined ? operatorId : conv.operatorId,
              lastMessageText: systemMessageText || conv.lastMessageText,
              lastMessageTime: new Date(),
            })
            .where(eq(conversations.id, conversationId));

          // 3. Se enviou uma mensagem de log do sistema, salvar
          if (systemMessageText) {
            const messageId = `sys-${Date.now()}`;
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

          // 4. Se a conversa foi finalizada, enfileira auditoria de IA
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
