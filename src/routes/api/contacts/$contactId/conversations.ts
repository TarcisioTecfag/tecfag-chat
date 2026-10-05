import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { channelConfigs, contacts, conversations } from "../../../../db/schema";
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
          const [channel] = await db.select({ activeProvider: channelConfigs.activeProvider })
            .from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId)).limit(1);
          const requiresExplicitCapture = channel?.activeProvider === "meta";
          const result = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${contactId}))`);
            const [contact] = await tx.select({ id: contacts.id, walletOperatorId: contacts.walletOperatorId, phone: contacts.phone })
              .from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId))).limit(1);
            if (!contact) return null;
            if (session.operator.role !== "admin" && session.permissions?.contacts?.contactScope === "wallet_only" && contact.walletOperatorId !== session.operator.id) {
              return { forbidden: true } as const;
            }
            const [existing] = await tx.select({
              id: conversations.id,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
            }).from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId)))
              .orderBy(desc(conversations.lastMessageTime)).limit(1);
            const now = new Date();
            if (existing) {
              // Abrir o histórico não transfere a conversa. Na Meta, somente a ação
              // explícita de captura/assunção pode alterar o responsável.
              if (requiresExplicitCapture) {
                if (existing.queueState === "finalizados") {
                  await tx.update(conversations)
                    .set({ operatorId: null, queueState: "fila", updatedAt: now })
                    .where(and(eq(conversations.id, existing.id), eq(conversations.tenantId, tenantId)));
                }
                return {
                  conversationId: existing.id,
                  created: false,
                  readOnly: existing.queueState === "finalizados" || existing.operatorId !== session.operator.id || existing.queueState !== "meus",
                  queueState: existing.queueState === "finalizados" ? "fila" : existing.queueState,
                };
              }
              await tx.update(conversations)
                .set({
                  operatorId: session.operator.id,
                  queueState: "meus",
                  lastMessageTime: now,
                  updatedAt: now,
                })
                .where(and(eq(conversations.id, existing.id), eq(conversations.tenantId, tenantId)));

              await tx.update(contacts)
                .set({
                  walletOperatorId: session.operator.id,
                  responsibleName: session.operator.name,
                })
                .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));

              return { conversationId: existing.id, created: false, readOnly: false, queueState: "meus" };
            }

            const normalizedPhone = contact.phone?.replace(/\D/g, "") || "";
            if (normalizedPhone.length >= 8) {
              await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${normalizedPhone}))`);
              const [otherHistory] = await tx.select({ id: conversations.id })
                .from(conversations)
                .innerJoin(contacts, and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
                .where(and(
                  eq(conversations.tenantId, tenantId),
                  ne(contacts.id, contactId),
                  sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${normalizedPhone}`,
                )).limit(1);
              if (otherHistory) return { phoneConflict: true } as const;
            }

            const conversationId = `conv-${crypto.randomUUID()}`;
            await tx.insert(conversations).values({
              id: conversationId, tenantId, contactId,
              operatorId: requiresExplicitCapture ? null : session.operator.id,
              queueState: requiresExplicitCapture ? "fila" : "meus",
              lastMessageText: "Atendimento iniciado.",
              lastMessageTime: now, createdAt: now, updatedAt: now,
            });

            if (!requiresExplicitCapture) {
              await tx.update(contacts)
                .set({
                  walletOperatorId: session.operator.id,
                  responsibleName: session.operator.name,
                })
                .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));
            }

            return { conversationId, created: true, readOnly: requiresExplicitCapture, queueState: requiresExplicitCapture ? "fila" : "meus" };
          });
          if (!result) return Response.json({ error: "Contato não encontrado." }, { status: 404 });
          if ("forbidden" in result) return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          if ("phoneConflict" in result) return Response.json({ error: "Este telefone já possui um histórico em outro cadastro. Localize o atendimento existente antes de criar outro." }, { status: 409 });
          return Response.json(result, { status: result.created ? 201 : 200 });
        } catch (error) {
          console.error("[POST /api/contacts/:id/conversations] Falha:", error);
          return Response.json({ error: "Não foi possível iniciar o atendimento." }, { status: 500 });
        }
      },
    },
  },
});
