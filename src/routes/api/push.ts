import { createFileRoute } from "@tanstack/react-router";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { getVapidPublicKey } from "@/lib/push-notifications";
import { requireSession } from "@/lib/auth-session";
import { eq, and } from "drizzle-orm";

export const Route = createFileRoute("/api/push")({ server: { handlers: {
  GET: async ({ request }: { request: Request }) => {
    const auth = await requireSession(request);
    if ("response" in auth) return auth.response;
    return Response.json({ publicKey: getVapidPublicKey() });
  },
  POST: async ({ request }: { request: Request }) => {
    const auth = await requireSession(request);
    if ("response" in auth) return auth.response;
    const { session } = auth;
    const tenantId = session.tenantId, operatorId = session.operator.id;
    try {
      const { subscription, userAgent } = await request.json();
      const endpoint = subscription?.endpoint, p256dh = subscription?.keys?.p256dh, keyAuth = subscription?.keys?.auth;
      if (typeof endpoint !== "string" || endpoint.length > 4096 || !endpoint.startsWith("https://") ||
          typeof p256dh !== "string" || !p256dh || p256dh.length > 4096 ||
          typeof keyAuth !== "string" || !keyAuth || keyAuth.length > 4096) {
        return Response.json({ error: "Assinatura de notificação inválida." }, { status: 400 });
      }
      const conditions = and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.endpoint, endpoint));
      const existing = await db.select().from(pushSubscriptions).where(conditions);
      if (existing.some((row) => row.p256dh !== p256dh || row.auth !== keyAuth)) {
        return Response.json({ error: "Renove a assinatura de notificações neste navegador." }, { status: 409 });
      }
      const values = { operatorId, p256dh, auth: keyAuth, userAgent: typeof userAgent === "string" ? userAgent.slice(0, 1000) : null };
      if (existing.length) {
        // Same browser/key may change signed-in account; never keep delivering to its previous user.
        await db.update(pushSubscriptions).set(values).where(conditions);
      } else {
        await db.insert(pushSubscriptions).values({ id: crypto.randomUUID(), tenantId, endpoint, ...values });
      }
      return Response.json({ success: true });
    } catch (error) {
      console.error("[push] Falha ao salvar assinatura", error);
      return Response.json({ error: "Não foi possível salvar a assinatura." }, { status: 500 });
    }
  },
  DELETE: async ({ request }: { request: Request }) => {
    const auth = await requireSession(request);
    if ("response" in auth) return auth.response;
    const { session } = auth;
    const tenantId = session.tenantId, operatorId = session.operator.id;
    const endpoint = new URL(request.url).searchParams.get("endpoint");
    if (!endpoint) return Response.json({ error: "endpoint é obrigatório." }, { status: 400 });
    try {
      await db.delete(pushSubscriptions).where(and(
        eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.operatorId, operatorId),
        eq(pushSubscriptions.endpoint, endpoint),
      ));
      return Response.json({ success: true });
    } catch (error) {
      console.error("[push] Falha ao remover assinatura", error);
      return Response.json({ error: "Não foi possível remover a assinatura." }, { status: 500 });
    }
  },
} } });
