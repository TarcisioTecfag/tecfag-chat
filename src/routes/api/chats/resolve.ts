import { createFileRoute } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../db";
import { contacts, conversations } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";

export const Route = createFileRoute("/api/chats/resolve")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin" && !session.permissions?.views?.chat) {
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        }

        const key = new URL(request.url).searchParams.get("key")?.trim() || "";
        if (!key || key.length > 160) {
          return Response.json({ error: "Identificador inválido." }, { status: 400 });
        }

        if (/^\d+$/.test(key)) {
          if (key.length < 8 || key.length > 20) {
            return Response.json({ error: "Telefone inválido." }, { status: 400 });
          }
          const found = await db.select({ id: conversations.id }).from(conversations)
            .innerJoin(contacts, and(
              eq(conversations.contactId, contacts.id),
              eq(contacts.tenantId, session.tenantId),
            ))
            .where(and(
              eq(conversations.tenantId, session.tenantId),
              eq(contacts.tenantId, session.tenantId),
              sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${key}`,
            )).limit(2);
          if (found.length > 1) {
            return Response.json({ error: "Há mais de um histórico para este telefone. É necessário reconciliá-los antes de usar este link." }, { status: 409 });
          }
          if (!found.length) {
            return Response.json({ error: "Atendimento não encontrado." }, { status: 404 });
          }
          return Response.json({ conversationId: found[0].id }, { headers: { "Cache-Control": "no-store" } });
        }

        const [found] = await db.select({ id: conversations.id }).from(conversations)
          .where(and(eq(conversations.tenantId, session.tenantId), eq(conversations.id, key)))
          .limit(1);
        if (!found) return Response.json({ error: "Atendimento não encontrado." }, { status: 404 });
        return Response.json({ conversationId: found.id }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
