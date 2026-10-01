import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { contacts, conversations } from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";

export const Route = createFileRoute("/api/contacts/$contactId/conversations")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin" && !session.permissions?.views?.chat) {
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        }
        const contactId = params.contactId;
        try {
          const result = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${contactId}))`);
            const [contact] = await tx.select({ id: contacts.id, walletOperatorId: contacts.walletOperatorId })
              .from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId))).limit(1);
            if (!contact) return null;
            if (session.operator.role !== "admin" && session.permissions?.contacts?.contactScope === "wallet_only" && contact.walletOperatorId !== session.operator.id) {
              return { forbidden: true } as const;
            }
            const [existing] = await tx.select({ id: conversations.id }).from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId), ne(conversations.queueState, "finalizados")))
              .orderBy(desc(conversations.lastMessageTime)).limit(1);
            if (existing) return { conversationId: existing.id, created: false };
            const now = new Date();
            const conversationId = `conv-${crypto.randomUUID()}`;
            await tx.insert(conversations).values({
              id: conversationId, tenantId, contactId, operatorId: session.operator.id,
              queueState: "meus", lastMessageText: "Atendimento iniciado.",
              lastMessageTime: now, createdAt: now, updatedAt: now,
            });
            return { conversationId, created: true };
          });
          if (!result) return Response.json({ error: "Contato não encontrado." }, { status: 404 });
          if ("forbidden" in result) return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          return Response.json(result, { status: result.created ? 201 : 200 });
        } catch (error) {
          console.error("[POST /api/contacts/:id/conversations] Falha:", error);
          return Response.json({ error: "Não foi possível iniciar o atendimento." }, { status: 500 });
        }
      },
    },
  },
});
