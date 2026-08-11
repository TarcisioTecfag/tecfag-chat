import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts, conversations, messages } from "../../../db/schema";
import { eq, and, ne, isNotNull, lt, isNull } from "drizzle-orm";
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

      /**
       * GET ?tenantId=valem
       * Retorna contagem de contatos com inatividade >50 e >60 dias
       * para exibir o KPI na tela de Minha Carteira.
       */
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const cutoff60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const cutoff50 = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);

        try {
          // Contatos COM carteira definida (walletOperatorId não nulo) e sem
          // contato há mais de 60 dias → candidatos à transferência automática
          const over60 = await db
            .select({ id: contacts.id, name: contacts.name, lastContactAt: contacts.lastContactAt })
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                isNotNull(contacts.walletOperatorId),
                lt(contacts.lastContactAt, cutoff60)
              )
            );

          // Contatos COM carteira definida e sem contato há mais de 50 dias
          // (inclui os >60, que é um subconjunto)
          const over50 = await db
            .select({ id: contacts.id, name: contacts.name, lastContactAt: contacts.lastContactAt })
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                isNotNull(contacts.walletOperatorId),
                lt(contacts.lastContactAt, cutoff50)
              )
            );

          return new Response(
            JSON.stringify({
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
       * POST ?tenantId=valem
       * Executa a transferência automática:
       * Contatos sem contato há >60 dias → walletOperatorId = null
       * (voltam para a fila de automação da Valentina, exatamente como
       * quando o operador remove manualmente um cliente da carteira).
       *
       * IMPORTANTE: NÃO atribui para um operador "op-valentina" inexistente,
       * pois walletOperatorId é FK para operators.id e causaria violação de constraint.
       * A lógica de "Valentina IA" é derivada de walletOperatorId = null no sistema.
       */
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const cutoff60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

        try {
          // Buscar contatos COM carteira e sem contato há mais de 60 dias
          const inactiveContacts = await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                isNotNull(contacts.walletOperatorId),
                lt(contacts.lastContactAt, cutoff60)
              )
            );

          const transferred: string[] = [];

          for (const contact of inactiveContacts) {
            // Remove da carteira (walletOperatorId = null).
            // Isso equivale ao operador remover manualmente — o cliente
            // volta para automação da Valentina IA quando falar novamente.
            await db
              .update(contacts)
              .set({ walletOperatorId: null })
              .where(
                and(
                  eq(contacts.id, contact.id),
                  eq(contacts.tenantId, tenantId) // segurança extra de tenant
                )
              );

            // Inserir nota interna nas conversas ativas do contato
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
                content: `⚠️ Cliente removido da carteira automaticamente por inatividade superior a 60 dias (último contato: ${lastContactDate}). Na próxima mensagem, a Valentina IA fará o atendimento inicial.`,
                isInternalNote: true,
                createdAt: new Date(),
              });

              // Notifica em tempo real para o painel atualizar
              SessionManager.getInstance().notifyPublic(conv.tenantId, {
                type: "wallet_update",
                contactId: contact.id,
                walletOperatorId: null,
                conversationId: conv.id,
              });
            }

            transferred.push(contact.id);
          }

          return new Response(
            JSON.stringify({
              success: true,
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
