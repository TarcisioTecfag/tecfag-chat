import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts, conversations, messages } from "../../../db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";

export function isAiWalletContact(
  contact: { id: string; name: string },
  tenantId: string
): boolean {
  const aiPersona = getAiPersona(tenantId);
  const idLower = (contact.id || "").trim().toLowerCase();
  const nameLower = (contact.name || "").trim().toLowerCase();
  const aiNameLower = aiPersona.name.toLowerCase();
  return (
    idLower === "valentina" ||
    idLower === "fagner" ||
    idLower.startsWith("ai-") ||
    nameLower.includes(aiNameLower) ||
    nameLower.includes("valentina") ||
    nameLower.includes("fagner")
  );
}

export function resolveWalletTargetOperatorId(
  session: { operator: { id: string; role: string } },
  url: URL
): string | null {
  const scope = url.searchParams.get("scope");
  const requestedOperatorId = url.searchParams.get("operatorId")?.trim() || null;

  if (session.operator.role === "admin") {
    if (scope === "global") {
      return null;
    }
    if (requestedOperatorId) {
      return requestedOperatorId;
    }
  }

  return session.operator.id;
}

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

      /**
       * GET ?operatorId=...
       * Retorna contagem de clientes da carteira (que possuem conversa no Chat)
       * com inatividade >50 e >60 dias para exibir o KPI individual na tela de Minha Carteira.
       */
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const targetOperatorId = resolveWalletTargetOperatorId(session, url);

        const cutoff60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const cutoff50 = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);

        try {
          // Busca exclusivamente clientes da carteira de atendimento (com conversa em `conversations`)
          // vinculados ao operador logado (ou global apenas se solicitado explicitamente por admin).
          const allWalletContacts = await db
            .select({
              id: contacts.id,
              name: contacts.name,
              createdAt: contacts.createdAt,
              lastMessageTime: conversations.lastMessageTime,
              conversationUpdatedAt: conversations.updatedAt,
              conversationCreatedAt: conversations.createdAt,
            })
            .from(contacts)
            .innerJoin(
              conversations,
              and(
                eq(conversations.contactId, contacts.id),
                eq(conversations.tenantId, tenantId)
              )
            )
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                targetOperatorId
                  ? eq(contacts.walletOperatorId, targetOperatorId)
                  : isNotNull(contacts.walletOperatorId)
              )
            );

          // Consolidar a última interação por cliente real (ignorando o contato fixo da IA)
          const contactMap = new Map<string, { id: string; name: string; lastContactAt: Date }>();

          for (const row of allWalletContacts) {
            if (isAiWalletContact({ id: row.id, name: row.name }, tenantId)) {
              continue;
            }

            const lastTime = row.lastMessageTime
              ? new Date(row.lastMessageTime)
              : row.conversationUpdatedAt
                ? new Date(row.conversationUpdatedAt)
                : row.conversationCreatedAt
                  ? new Date(row.conversationCreatedAt)
                  : new Date(row.createdAt);

            const existing = contactMap.get(row.id);
            if (!existing || lastTime > existing.lastContactAt) {
              contactMap.set(row.id, {
                id: row.id,
                name: row.name,
                lastContactAt: lastTime,
              });
            }
          }

          const aggregated = Array.from(contactMap.values());
          const over60 = aggregated.filter((c) => c.lastContactAt < cutoff60);
          const over50 = aggregated.filter((c) => c.lastContactAt < cutoff50);

          return new Response(
            JSON.stringify({
              operatorId: targetOperatorId,
              over60Count: over60.length,
              over50Count: over50.length,
              over60,
              over50,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("Erro ao consultar inatividade de carteira:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * POST
       * Executa a remoção automática de carteira para clientes do Chat sem contato há >60 dias:
       * walletOperatorId = null (retornam para a automação da IA do tenant no próximo contato).
       */
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const targetOperatorId = resolveWalletTargetOperatorId(session, url);
        const cutoff60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const aiPersona = getAiPersona(tenantId);
        const aiArticle = aiPersona.gender === "female" ? "a" : "o";

        try {
          const allWalletContacts = await db
            .select({
              id: contacts.id,
              name: contacts.name,
              createdAt: contacts.createdAt,
              lastMessageTime: conversations.lastMessageTime,
              conversationUpdatedAt: conversations.updatedAt,
              conversationCreatedAt: conversations.createdAt,
            })
            .from(contacts)
            .innerJoin(
              conversations,
              and(
                eq(conversations.contactId, contacts.id),
                eq(conversations.tenantId, tenantId)
              )
            )
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                targetOperatorId
                  ? eq(contacts.walletOperatorId, targetOperatorId)
                  : isNotNull(contacts.walletOperatorId)
              )
            );

          const contactMap = new Map<string, { id: string; name: string; lastContactAt: Date }>();

          for (const row of allWalletContacts) {
            if (isAiWalletContact({ id: row.id, name: row.name }, tenantId)) {
              continue;
            }

            const lastTime = row.lastMessageTime
              ? new Date(row.lastMessageTime)
              : row.conversationUpdatedAt
                ? new Date(row.conversationUpdatedAt)
                : row.conversationCreatedAt
                  ? new Date(row.conversationCreatedAt)
                  : new Date(row.createdAt);

            const existing = contactMap.get(row.id);
            if (!existing || lastTime > existing.lastContactAt) {
              contactMap.set(row.id, {
                id: row.id,
                name: row.name,
                lastContactAt: lastTime,
              });
            }
          }

          const inactiveContacts = Array.from(contactMap.values()).filter(
            (c) => c.lastContactAt < cutoff60
          );

          const transferred: string[] = [];

          for (const contact of inactiveContacts) {
            await db
              .update(contacts)
              .set({ walletOperatorId: null })
              .where(
                and(
                  eq(contacts.id, contact.id),
                  eq(contacts.tenantId, tenantId)
                )
              );

            const activeConvs = await db
              .select()
              .from(conversations)
              .where(
                and(
                  eq(conversations.contactId, contact.id),
                  eq(conversations.tenantId, tenantId)
                )
              );

            for (const conv of activeConvs) {
              const sysMsgId = `sys-inact-${Date.now()}-${Math.random().toString(36).slice(2)}-${conv.id}`;
              const lastContactDate = contact.lastContactAt
                ? new Date(contact.lastContactAt).toLocaleDateString("pt-BR")
                : "data desconhecida";

              await db.insert(messages).values({
                id: sysMsgId,
                tenantId: conv.tenantId,
                conversationId: conv.id,
                senderType: "system",
                senderName: "Sistema",
                content: `⚠️ Cliente removido da carteira automaticamente por inatividade superior a 60 dias (último contato: ${lastContactDate}). Na próxima mensagem, ${aiArticle} ${aiPersona.name} IA fará o atendimento inicial.`,
                isInternalNote: true,
                sentAt: new Date(),
              });

              SessionManager.getInstance().notifyPublic(conv.tenantId, {
                type: "wallet_update",
                contactId: contact.id,
                walletOperatorId: null,
                conversationId: conv.id,
              } as any);
            }

            transferred.push(contact.id);
          }

          return new Response(
            JSON.stringify({
              success: true,
              operatorId: targetOperatorId,
              cutoffDate: cutoff60.toISOString(),
              transferredCount: transferred.length,
              transferredIds: transferred,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("Erro na verificação de inatividade de carteira:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
