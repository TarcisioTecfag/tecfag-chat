import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { contacts, conversations } from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";
import { outboundQueue } from "../../../../lib/whatsapp/outbound";

export const Route = createFileRoute("/api/settings/whatsapp/test-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin") {
          return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const phone = String(body.phone || "").replace(/\D/g, "");
        const message = String(body.text || "").trim();
        if (phone.length < 10 || phone.length > 15 || !message) {
          return Response.json({ error: "Informe um telefone válido e a mensagem de teste." }, { status: 400 });
        }

        // O teste só usa contato e conversa já existentes neste tenant. O destino vem do banco.
        const [contact] = await db
          .select({ id: contacts.id, phone: contacts.phone })
          .from(contacts)
          .where(and(
            eq(contacts.tenantId, session.tenantId),
            sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${phone}`
          ))
          .limit(1);
        if (!contact?.phone) {
          return Response.json({ error: "Contato não encontrado neste tenant. Receba primeiro uma mensagem do número de teste." }, { status: 404 });
        }

        const [conversation] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(
            eq(conversations.tenantId, session.tenantId),
            eq(conversations.contactId, contact.id)
          ))
          .orderBy(desc(conversations.lastMessageTime))
          .limit(1);
        if (!conversation) {
          return Response.json({ error: "Conversa de teste não encontrada. Receba primeiro uma mensagem do número de teste." }, { status: 404 });
        }

        const result = await outboundQueue.enqueueAndSend({
          tenantId: session.tenantId,
          conversationId: conversation.id,
          recipientPhone: contact.phone,
          text: message,
          operatorId: session.operator.id,
          idempotencyKey: String(body.clientMessageId || "") || undefined,
        });
        return Response.json(result, { status: result.success ? 200 : 400 });
      },
    },
  },
});
