import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { messages, conversations, contacts } from "../../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { metaAdapter } from "../../../lib/whatsapp/adapters/meta";
import { baileysAdapter } from "../../../lib/whatsapp/adapters/baileys";
import { WhatsAppProviderType } from "../../../lib/whatsapp/types";

export const Route = createFileRoute("/api/chats/reconcile-message")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      POST: async ({ request }) => {
        try {
          // 1. Sessão mandatória — isolamento estrito
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const body = await request.json().catch(() => ({}));
          const { messageId } = body;

          if (!messageId) {
            return new Response(
              JSON.stringify({ error: "messageId é obrigatório" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          // 2. Trava atômica por mensagem para evitar duplo reenvio concorrente
          try {
            const [lockRes] = await db.execute<{ locked: boolean }>(
              sql`SELECT pg_try_advisory_xact_lock(hashtext(${'reconcile:' + messageId})) as locked`
            );
            if (lockRes && lockRes.locked === false) {
              return new Response(
                JSON.stringify({
                  error: "Reconciliação já em andamento por outro operador ou processo.",
                  code: "CONCURRENCY_CONFLICT",
                }),
                { status: 409, headers: { "Content-Type": "application/json" } }
              );
            }
          } catch {
            // Em testes ou ambientes sem Postgres advisory lock, prossegue defensivamente
          }

          // 3. Buscar a mensagem pertencente ao tenant da sessão
          const [msg] = await db
            .select()
            .from(messages)
            .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)));

          if (!msg) {
            return new Response(
              JSON.stringify({ error: "Mensagem não encontrada.", code: "NOT_FOUND" }),
              { status: 404, headers: { "Content-Type": "application/json" } }
            );
          }

          // 4. Buscar a conversa para validação de posse e permissão
          const [conv] = await db
            .select()
            .from(conversations)
            .where(and(eq(conversations.id, msg.conversationId), eq(conversations.tenantId, tenantId)));

          if (!conv) {
            return new Response(
              JSON.stringify({ error: "Conversa associada não encontrada.", code: "NOT_FOUND" }),
              { status: 404, headers: { "Content-Type": "application/json" } }
            );
          }

          // 5. Verificar permissão de escrita
          const isAdmin = session.operator.role === "admin";
          const isSupervisor = session.operator.role === "supervisor";
          const isOwner = conv.operatorId === session.operator.id;

          if (!isAdmin && !isSupervisor && !isOwner) {
            return new Response(
              JSON.stringify({ error: "Sem permissão para reconciliar mensagens nesta conversa.", code: "FORBIDDEN" }),
              { status: 403, headers: { "Content-Type": "application/json" } }
            );
          }

          // 6. Verificar status elegível (uncertain, failed, ou sending antigo)
          const eligibleStatuses = ["uncertain", "failed", "sending"];
          if (!eligibleStatuses.includes(msg.status)) {
            return new Response(
              JSON.stringify({
                error: `Mensagem com status '${msg.status}' não requer reconciliação. Apenas mensagens incertas, falhas ou presas podem ser reenviadas.`,
                status: msg.status,
                code: "STATUS_NOT_ELIGIBLE",
              }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          // 7. Obter telefone de destino a partir do contato no banco (nunca do cliente)
          let recipientPhone = "";
          if (conv.contactId) {
            const [contact] = await db
              .select({ phone: contacts.phone })
              .from(contacts)
              .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)));

            if (contact?.phone) recipientPhone = contact.phone;
          }

          if (!recipientPhone && !msg.isInternalNote) {
            return new Response(
              JSON.stringify({ error: "Contato associado à conversa não possui número de telefone válido." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          // 8. O reenvio DEVE usar o provedor original gravado na mensagem, NUNCA o ativo atual do canal
          const provider: WhatsAppProviderType =
            (msg.provider as WhatsAppProviderType) || "baileys";

          // Incrementar retryCount
          const nextRetry = (msg.retryCount || 0) + 1;
          await db
            .update(messages)
            .set({
              retryCount: nextRetry,
              status: "sending",
              updatedAt: new Date(),
            })
            .where(and(eq(messages.id, msg.id), eq(messages.tenantId, tenantId)));

          // 9. Despacho pelo provedor original
          let dispatchResult: { externalId?: string; status: any; error?: string };

          if (provider === "meta") {
            dispatchResult = await metaAdapter.send(tenantId, {
              tenantId,
              conversationId: msg.conversationId,
              recipientPhone,
              text: msg.content,
            });
          } else {
            dispatchResult = await baileysAdapter.send(tenantId, {
              tenantId,
              conversationId: msg.conversationId,
              recipientPhone,
              text: msg.content,
            });
          }

          // 10. Atualização do resultado no banco
          if (dispatchResult.status === "accepted") {
            await db
              .update(messages)
              .set({
                status: "accepted",
                externalId: dispatchResult.externalId || null,
                errorMessage: null,
                updatedAt: new Date(),
              })
              .where(and(eq(messages.id, msg.id), eq(messages.tenantId, tenantId)));

            await db
              .update(conversations)
              .set({ lastMessageTime: new Date(), updatedAt: new Date() })
              .where(and(eq(conversations.id, conv.id), eq(conversations.tenantId, tenantId)));

            return new Response(
              JSON.stringify({
                success: true,
                messageId: msg.id,
                status: "accepted",
                externalId: dispatchResult.externalId,
                provider,
                retryCount: nextRetry,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          } else {
            await db
              .update(messages)
              .set({
                status: "failed",
                errorMessage: dispatchResult.error || "Falha na reconciliação pelo provedor original",
                updatedAt: new Date(),
              })
              .where(and(eq(messages.id, msg.id), eq(messages.tenantId, tenantId)));

            return new Response(
              JSON.stringify({
                success: false,
                messageId: msg.id,
                status: "failed",
                error: dispatchResult.error,
                provider,
                retryCount: nextRetry,
              }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

        } catch (err: any) {
          console.error("[Reconcile Message Route] Erro fatal:", err);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
