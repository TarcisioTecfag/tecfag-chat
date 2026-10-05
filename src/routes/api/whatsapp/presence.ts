import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { channelConfigs, conversations } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { sendMetaConversationPresence, type MetaPresenceAction } from "../../../lib/whatsapp/meta-presence";

/**
 * Presença do atendimento em tempo real.
 *  - action "read":   confirma leitura ao cliente (✓✓ azul no WhatsApp dele) — canal Meta.
 *  - action "typing": "digitando..." no WhatsApp do cliente (canal Meta) e aviso interno
 *                     para quem acompanha a conversa no painel (qualquer canal).
 *
 * Só o operador responsável pela conversa capturada gera efeitos visíveis ao cliente:
 * supervisores que apenas visualizam o histórico não disparam "lido" nem "digitando".
 */

const OPERATOR_TYPING_BROADCAST_MS = 3_000;
const lastOperatorTypingBroadcast = new Map<string, number>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/whatsapp/presence")({
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
          const action = body?.action as MetaPresenceAction;
          if (!conversationId || (action !== "read" && action !== "typing")) {
            return json({ error: "conversationId e action ('read' | 'typing') são obrigatórios." }, 400);
          }

          const [conv] = await db
            .select({ id: conversations.id, operatorId: conversations.operatorId, queueState: conversations.queueState })
            .from(conversations)
            .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

          if (!conv) return json({ error: "Conversa não encontrada.", code: "NOT_FOUND" }, 404);

          if (conv.queueState !== "meus" || conv.operatorId !== session.operator.id) {
            return json({ ignored: true, reason: "not_responsible" });
          }

          if (action === "typing") {
            const key = `${tenantId}:${conversationId}`;
            const last = lastOperatorTypingBroadcast.get(key) || 0;
            if (Date.now() - last >= OPERATOR_TYPING_BROADCAST_MS) {
              if (lastOperatorTypingBroadcast.size > 5_000) lastOperatorTypingBroadcast.clear();
              lastOperatorTypingBroadcast.set(key, Date.now());
              SessionManager.getInstance().notifyPublic(tenantId, {
                type: "operator_typing",
                conversationId,
                operatorId: session.operator.id,
                operatorName: session.operator.name,
              });
            }
          }

          const [channel] = await db
            .select({ activeProvider: channelConfigs.activeProvider, connectionStatus: channelConfigs.connectionStatus })
            .from(channelConfigs)
            .where(eq(channelConfigs.tenantId, tenantId));

          if (channel?.activeProvider !== "meta" || channel.connectionStatus === "switching") {
            return json({ ok: true, meta: false });
          }

          // Não bloqueia o operador esperando a Graph API; falhas ficam no log do servidor.
          void sendMetaConversationPresence(tenantId, conversationId, action).catch((err) =>
            console.warn(`[Presence] Erro inesperado (tenant: ${tenantId}):`, err)
          );

          return json({ ok: true, meta: true }, 202);
        } catch (err: any) {
          console.error("[POST /api/whatsapp/presence] Erro:", err);
          return json({ error: "Erro ao processar presença." }, 500);
        }
      },
    },
  },
});
