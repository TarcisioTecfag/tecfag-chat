import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, isNull, lt, notLike, or } from "drizzle-orm";
import { db } from "../../../db";
import { contacts, conversations, messages, whatsappConnections } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import {
  conversationReadCondition,
  requireConversationAccess,
} from "../../../lib/access-control/conversation-access";
import { multiConnectionEnabled } from "../../../lib/whatsapp/connection-policy";
import { readReactions } from "../../../lib/whatsapp/meta-reactions";

function readMirroredSourceKey(metaDetails: unknown): string | null {
  if (!metaDetails || typeof metaDetails !== "object") return null;
  const copied = (metaDetails as Record<string, unknown>).copiedFrom;
  if (!copied || typeof copied !== "object") return null;
  const sourceMessageId = (copied as Record<string, unknown>).messageId;
  if (typeof sourceMessageId !== "string" || !sourceMessageId.trim()) return null;
  const channel = (copied as Record<string, unknown>).channel;
  return `${typeof channel === "string" && channel.trim() ? channel.trim() : "mirrored"}:${sourceMessageId.trim()}`;
}

export const Route = createFileRoute("/api/whatsapp/contact-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (!multiConnectionEnabled(session.tenantId))
          return Response.json({ error: "Recurso não habilitado." }, { status: 409 });
        const url = new URL(request.url);
        const conversationId = url.searchParams.get("conversationId") || "";
        const denied = await requireConversationAccess(session, conversationId);
        if (denied) return denied;
        if (conversationId.startsWith("conv-lc-")) {
          return Response.json(
            { visibleConversationIds: [conversationId], messages: [], nextCursor: null },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        const [origin] = await db
          .select({
            contactId: conversations.contactId,
            whatsappConnectionId: conversations.whatsappConnectionId,
          })
          .from(conversations)
          .where(
            and(eq(conversations.tenantId, session.tenantId), eq(conversations.id, conversationId)),
          )
          .limit(1);
        if (!origin) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
        // Quando o operador abre uma conversa Baileys autorizada deste contato, inclui sempre
        // o histórico corporativo oficial (somente leitura) no feed unificado — mesmo quando a
        // conversa oficial foi encerrada na transferência ou o grupo restringe a aba Finalizados.
        const historyVisibilityCondition = origin.whatsappConnectionId
          ? or(
              conversationReadCondition(session),
              and(
                eq(conversations.tenantId, session.tenantId),
                eq(conversations.contactId, origin.contactId),
                isNull(conversations.whatsappConnectionId),
                notLike(conversations.id, "conv-lc-%"),
              ),
            )!
          : conversationReadCondition(session);
        // Conversas do chat do Site (`conv-lc-%`) nunca pertencem ao feed unificado de WhatsApp:
        // quando há ponte Site → WhatsApp, as mensagens já são espelhadas (`lcx-*`) na conversa
        // de WhatsApp. Filtrar aqui evita exibir mensagens do Site e cópias `lcx-*` em duplicidade.
        const conditions = [
          eq(messages.tenantId, session.tenantId),
          eq(conversations.tenantId, session.tenantId),
          eq(conversations.contactId, origin.contactId),
          notLike(conversations.id, "conv-lc-%"),
          historyVisibilityCondition,
        ];
        const cursor = url.searchParams.get("before");
        if (cursor) {
          try {
            const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
            const date = new Date(parsed.at);
            if (
              !Number.isFinite(date.getTime()) ||
              typeof parsed.id !== "string" ||
              parsed.id.length > 200
            )
              throw Error();
            conditions.push(
              or(
                lt(messages.sentAt, date),
                and(eq(messages.sentAt, date), lt(messages.id, parsed.id)),
              )!,
            );
          } catch {
            return Response.json({ error: "Cursor inválido." }, { status: 400 });
          }
        }
        const rows = await db
          .select({
            message: messages,
            name: contacts.name,
            connectionName: whatsappConnections.name,
            connectionPhone: whatsappConnections.baileysPairedPhone,
            sourceConnectionId: conversations.whatsappConnectionId,
          })
          .from(messages)
          .innerJoin(
            conversations,
            and(
              eq(conversations.id, messages.conversationId),
              eq(conversations.tenantId, session.tenantId),
            ),
          )
          .innerJoin(
            contacts,
            and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, session.tenantId)),
          )
          .leftJoin(
            whatsappConnections,
            and(
              eq(whatsappConnections.id, conversations.whatsappConnectionId),
              eq(whatsappConnections.tenantId, session.tenantId),
            ),
          )
          .where(and(...conditions))
          .orderBy(desc(messages.sentAt), desc(messages.id))
          .limit(101);
        const page = rows.slice(0, 100);
        const last = page.at(-1)?.message;
        const visibleConversations = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, session.tenantId),
              eq(conversations.contactId, origin.contactId),
              notLike(conversations.id, "conv-lc-%"),
              historyVisibilityCondition,
            ),
          );
        const chronologicalPage = page.reverse();
        const preferredMirroredByKey = new Map<string, string>();
        for (const row of chronologicalPage) {
          const mirrorKey = readMirroredSourceKey(row.message.metaDetails);
          if (!mirrorKey) continue;
          const currentId = preferredMirroredByKey.get(mirrorKey);
          if (!currentId || row.message.conversationId === conversationId) {
            preferredMirroredByKey.set(mirrorKey, row.message.id);
          }
        }
        const deduplicatedPage = chronologicalPage.filter((row) => {
          const mirrorKey = readMirroredSourceKey(row.message.metaDetails);
          return !mirrorKey || preferredMirroredByKey.get(mirrorKey) === row.message.id;
        });
        return Response.json(
          {
            visibleConversationIds: visibleConversations.map((c) => c.id),
            messages: deduplicatedPage.map(
              ({ message: m, name, connectionName, connectionPhone, sourceConnectionId }) => ({
                id: m.id,
                conversationId: m.conversationId,
                whatsappConnectionId: sourceConnectionId,
                connectionName: connectionName || "Empresa · histórico principal",
                connectionPhone,
                author: m.senderType === "client" ? name : m.senderName,
                text: m.content,
                sentAtISO: m.sentAt.toISOString(),
                time: m.sentAt.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Sao_Paulo",
                }),
                date: m.sentAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
                side: m.senderType === "client" ? "in" : "out",
                senderType: m.senderType,
                isInternalNote: m.isInternalNote,
                quotedMessageId: m.quotedMessageId,
                quotedMessageSender: m.quotedMessageSender,
                quotedMessageContent: m.quotedMessageContent,
                status: m.status,
                provider: m.provider,
                externalId: m.externalId,
                reactions: readReactions(m.metaDetails),
              })),
            nextCursor:
              rows.length > 100 && last
                ? Buffer.from(
                    JSON.stringify({ at: last.sentAt.toISOString(), id: last.id }),
                  ).toString("base64url")
                : null,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
