import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts, conversations, messages } from "../../../db/schema";
import { eq, and, ne, isNotNull, lt } from "drizzle-orm";
import { SessionManager } from "../../../lib/baileys/session-manager";

export const Route = createFileRoute("/api/contacts/check-inactivity")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const url = new URL(request.url);
          const tenantId = url.searchParams.get("tenantId") || "valem";

          // Limite de 60 dias de inatividade
          const cutoffDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

          // Buscar contatos com carteira definida (diferente de Valentina) e sem contato por mais de 60 dias
          const inactiveContacts = await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                isNotNull(contacts.walletOperatorId),
                ne(contacts.walletOperatorId, "op-valentina"),
                lt(contacts.lastContactAt, cutoffDate)
              )
            );

          const transferred: string[] = [];

          for (const contact of inactiveContacts) {
            // Reatribuir para Valentina
            await db
              .update(contacts)
              .set({
                walletOperatorId: "op-valentina",
                responsibleName: "Valentina (I.A)",
              })
              .where(eq(contacts.id, contact.id));

            // Notifica conversa ativa se houver
            const activeConvs = await db
              .select()
              .from(conversations)
              .where(eq(conversations.contactId, contact.id));

            for (const conv of activeConvs) {
              const sysMsgId = `sys-inact-${Date.now()}-${conv.id}`;
              const textNote = `⚠️ Cliente transferido para a carteira de Valentina por inatividade superior a 60 dias.`;

              await db.insert(messages).values({
                id: sysMsgId,
                tenantId: conv.tenantId,
                conversationId: conv.id,
                senderType: "system",
                senderName: "Sistema",
                content: textNote,
                isInternalNote: true,
                createdAt: new Date(),
              });

              SessionManager.getInstance().notifyPublic(conv.tenantId, {
                type: "wallet_update",
                contactId: contact.id,
                walletOperatorId: "op-valentina",
                conversationId: conv.id,
              });
            }

            transferred.push(contact.id);
          }

          return new Response(
            JSON.stringify({
              success: true,
              cutoffDate: cutoffDate.toISOString(),
              transferredCount: transferred.length,
              transferredIds: transferred,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("Erro na verificação de inatividade de carteira:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "valem";
        const cutoffDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const cutoff50Date = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);

        try {
          const list60 = await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                isNotNull(contacts.walletOperatorId),
                ne(contacts.walletOperatorId, "op-valentina"),
                lt(contacts.lastContactAt, cutoffDate)
              )
            );

          const list50 = await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                isNotNull(contacts.walletOperatorId),
                ne(contacts.walletOperatorId, "op-valentina"),
                lt(contacts.lastContactAt, cutoff50Date)
              )
            );

          return new Response(
            JSON.stringify({
              over60Count: list60.length,
              over50Count: list50.length,
              over60: list60,
              over50: list50,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
