import { createFileRoute } from "@tanstack/react-router";
import { outboundQueue } from "../../../lib/whatsapp/outbound";
import { requireSession } from "../../../lib/auth-session";
import { db } from "../../../db";
import { conversations, contacts } from "../../../db/schema";
import { eq, and } from "drizzle-orm";

export const Route = createFileRoute("/api/whatsapp/send")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const body = await request.json();
          const {
            conversationId,
            text,
            mediaUrl,
            mediaType,
            fileName,
            quotedMessageId,
            clientMessageId,
            isInternalNote,
          } = body;

          // conversationId é obrigatório — o recipientPhone é obtido do banco (não do cliente)
          if (!conversationId) {
            return new Response(
              JSON.stringify({ error: "conversationId é obrigatório" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          // Buscar conversa verificando que pertence ao tenant da sessão
          const [conv] = await db
            .select({
              id: conversations.id,
              contactId: conversations.contactId,
              tenantId: conversations.tenantId,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
            })
            .from(conversations)
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, session.tenantId)
              )
            );

          if (!conv) {
            return new Response(
              JSON.stringify({ error: "Conversa não encontrada.", code: "NOT_FOUND" }),
              { status: 404, headers: { "Content-Type": "application/json" } }
            );
          }

          // Verificar permissão de escrita: admin e supervisor podem enviar para qualquer conversa do tenant.
          // Atendentes comuns só podem enviar na conversa que lhes pertence (operatorId).
          // canViewAllChats é permissão de LEITURA — não autoriza envio.
          const isAdmin = session.operator.role === "admin";
          const isSupervisor = session.operator.role === "supervisor";
          const isOwner = conv.operatorId === session.operator.id;

          if (!isAdmin && !isSupervisor && !isOwner) {
            return new Response(
              JSON.stringify({ error: "Sem permissão para responder nesta conversa.", code: "FORBIDDEN" }),
              { status: 403, headers: { "Content-Type": "application/json" } }
            );
          }

          // Notas internas não precisam de telefone de destino
          let recipientPhone: string | undefined;
          if (!isInternalNote) {
            // Obter telefone do contato no SERVIDOR — nunca confiar no body do cliente
            if (!conv.contactId) {
              return new Response(
                JSON.stringify({ error: "Conversa sem contato associado." }),
                { status: 400, headers: { "Content-Type": "application/json" } }
              );
            }

            const [contact] = await db
              .select({ phone: contacts.phone })
              .from(contacts)
              .where(
                and(
                  eq(contacts.id, conv.contactId),
                  eq(contacts.tenantId, session.tenantId)
                )
              );

            if (!contact?.phone) {
              return new Response(
                JSON.stringify({ error: "Contato sem número de telefone cadastrado." }),
                { status: 400, headers: { "Content-Type": "application/json" } }
              );
            }

            recipientPhone = contact.phone;
          }

          const result = await outboundQueue.enqueueAndSend({
            idempotencyKey: clientMessageId,
            tenantId: session.tenantId,
            conversationId,
            recipientPhone: recipientPhone || "",
            text,
            mediaUrl,
            mediaType,
            fileName,
            quotedMessageId,
            operatorId: session.operator.id,
            isInternalNote: !!isInternalNote,
          });

          return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 400,
            headers: { "Content-Type": "application/json" },
          });

        } catch (err: any) {
          console.error("[WhatsApp Send Route] Erro:", err);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
