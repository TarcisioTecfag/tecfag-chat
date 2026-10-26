import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { channelConfigs, contacts, conversations, messages } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { applyOperatorReaction } from "../../../lib/whatsapp/meta-reactions";
import { metaAdapter } from "../../../lib/whatsapp/adapters/meta";
import { baileysAdapter } from "../../../lib/whatsapp/adapters/baileys";
import { requireConversationWriteAccess } from "../../../lib/access-control/conversation-access";
import { resolveConversationConnection } from "../../../lib/whatsapp/connections";
import { connectionPeerJid } from "../../../lib/whatsapp/connection-contacts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/whatsapp/react")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId; // SEMPRE da sessão

          const body = await request.json().catch(() => ({}));
          const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
          const messageId = typeof body?.messageId === "string" ? body.messageId : "";
          const emoji = typeof body?.emoji === "string" ? body.emoji.trim() : "";

          if (!conversationId || !messageId) {
            return json({ error: "conversationId e messageId são obrigatórios." }, 400);
          }
          const denied = await requireConversationWriteAccess(session, conversationId);
          if (denied) return denied;

          // 1. Busca conversa e valida tenant estritamente
          const [conv] = await db
            .select({
              id: conversations.id,
              contactId: conversations.contactId,
              whatsappConnectionId: conversations.whatsappConnectionId,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
            })
            .from(conversations)
            .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

          if (!conv) {
            return json({ error: "Conversa não encontrada para este tenant." }, 404);
          }

          // 2. Busca mensagem-alvo e valida que pertence à conversa e tenant
          const [targetMsg] = await db
            .select({
              id: messages.id,
              externalId: messages.externalId,
              direction: messages.direction,
              senderType: messages.senderType,
              metaDetails: messages.metaDetails,
            })
            .from(messages)
            .where(and(
              eq(messages.id, messageId),
              eq(messages.conversationId, conversationId),
              eq(messages.tenantId, tenantId)
            ));

          if (!targetMsg) {
            return json({ error: "Mensagem não encontrada." }, 404);
          }

          // 3. Aplica reação no banco e emite SSE imediatamente para todos os operadores conectados
          const reactionResult = await applyOperatorReaction(tenantId, {
            messageId,
            emoji,
            operatorId: session.operator.id,
            operatorName: session.operator.name,
          });

          // 4. Se a conversa for do WhatsApp e possuir externalId, dispara para a plataforma externa (Meta ou Baileys)
          const [contact] = await db
            .select({ phone: contacts.phone, whatsappJid: contacts.whatsappJid, mainChannel: contacts.mainChannel })
            .from(contacts)
            .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)));

          const isWhatsApp = !!conv.whatsappConnectionId || !contact?.mainChannel || contact.mainChannel === "whatsapp";
          if (isWhatsApp && targetMsg.externalId) {
            const target = await resolveConversationConnection(tenantId, conversationId);
            const channel = { activeProvider: target.provider };

            if (channel?.activeProvider === "meta") {
              const phone = contact?.phone || "";
              if (phone) {
                void metaAdapter.sendReaction(tenantId, phone, targetMsg.externalId, emoji).catch((err) => {
                  console.warn(`[Reaction] Erro ao enviar reação na Meta (tenant ${tenantId}):`, err);
                });
              }
            } else {
              // Baileys
              const jid = conv.whatsappConnectionId ? await connectionPeerJid(tenantId, conv.whatsappConnectionId, conv.contactId) || (contact?.phone ? `${contact.phone.replace(/\D/g, "")}@s.whatsapp.net` : null) : contact?.whatsappJid || (contact?.phone ? `${contact.phone.replace(/\D/g, "")}@s.whatsapp.net` : null);
              if (jid) {
                const isFromMe = targetMsg.direction === "outbound" || targetMsg.senderType === "operator" || targetMsg.senderType === "system";
                void baileysAdapter.sendReaction(tenantId, jid, targetMsg.externalId, isFromMe, emoji, conv.whatsappConnectionId).catch((err) => {
                  console.warn(`[Reaction] Erro ao enviar reação no Baileys (tenant ${tenantId}):`, err);
                });
              }
            }
          }

          return json({
            ok: true,
            reactions: reactionResult.reactions,
          });
        } catch (err: any) {
          console.error("[POST /api/whatsapp/react] Erro:", err);
          return json({ error: "Erro interno ao processar reação." }, 500);
        }
      },
    },
  },
});
