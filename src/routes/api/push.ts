import { createFileRoute } from "@tanstack/react-router";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { getVapidPublicKey } from "@/lib/push-notifications";
import { eq, and } from "drizzle-orm";

export const Route = createFileRoute("/api/push")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const vapidPublicKey = getVapidPublicKey();
        return new Response(JSON.stringify({ publicKey: vapidPublicKey }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },

      POST: async ({ request }: { request: Request }) => {
        try {
          const body = await request.json();
          const { tenantId, operatorId, subscription, userAgent } = body;

          if (!tenantId || !operatorId || !subscription || !subscription.endpoint) {
            return new Response(
              JSON.stringify({ error: "tenantId, operatorId e subscription são obrigatórios" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          const endpoint = subscription.endpoint;
          const p256dh = subscription.keys?.p256dh;
          const auth = subscription.keys?.auth;

          if (!p256dh || !auth) {
            return new Response(
              JSON.stringify({ error: "Chaves de assinatura p256dh e auth são inválidas" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // Verificar se já existe a assinatura para evitar duplicatas
          const existing = await db
            .select()
            .from(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.tenantId, tenantId),
                eq(pushSubscriptions.endpoint, endpoint)
              )
            );

          if (existing.length > 0) {
            // Atualizar o operador se necessário
            await db
              .update(pushSubscriptions)
              .set({ operatorId, userAgent: userAgent || null })
              .where(
                and(
                  eq(pushSubscriptions.tenantId, tenantId),
                  eq(pushSubscriptions.endpoint, endpoint)
                )
              );
          } else {
            // Inserir nova assinatura
            const id = "sub_" + Math.random().toString(36).substring(2, 11);
            await db.insert(pushSubscriptions).values({
              id,
              tenantId,
              operatorId,
              endpoint,
              p256dh,
              auth,
              userAgent: userAgent || null,
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("Erro ao salvar assinatura de Push:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },

      DELETE: async ({ request }: { request: Request }) => {
        try {
          const url = new URL(request.url);
          const tenantId = url.searchParams.get("tenantId");
          const endpoint = url.searchParams.get("endpoint");

          if (!tenantId || !endpoint) {
            return new Response(
              JSON.stringify({ error: "tenantId e endpoint são obrigatórios" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          await db
            .delete(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.tenantId, tenantId),
                eq(pushSubscriptions.endpoint, endpoint)
              )
            );

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("Erro ao remover assinatura de Push:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
