import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { webhookSubscriptions } from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";
import {
  SUPPORTED_WEBHOOK_EVENTS,
  ensureWebhookSubscriptionsSchema,
  maskWebhookSecret,
  validateWebhookEvents,
  validateWebhookTargetUrl,
} from "../../../../lib/webhooks/dispatcher";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/settings/webhooks/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;

        const { session } = auth;
        const tenantId = session.tenantId;
        await ensureWebhookSubscriptionsSchema();

        const subs = await db
          .select()
          .from(webhookSubscriptions)
          .where(eq(webhookSubscriptions.tenantId, tenantId))
          .orderBy(desc(webhookSubscriptions.createdAt));

        return jsonResponse({
          ok: true,
          tenantId,
          supportedEvents: [...SUPPORTED_WEBHOOK_EVENTS],
          subscriptions: subs.map((s) => ({
            id: s.id,
            tenantId: s.tenantId,
            name: s.name,
            url: s.url,
            events: s.events,
            isActive: s.isActive,
            secretPreview: maskWebhookSecret(s.secret),
            createdAt: s.createdAt,
          })),
        });
      },

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;

        const { session } = auth;
        const tenantId = session.tenantId;
        const canManage =
          session.operator.role === "admin" ||
          Boolean(session.permissions?.settings?.canManageWhatsapp);
        if (!canManage) {
          return jsonResponse(
            { error: "Permissão insuficiente para criar subscrições de webhook.", code: "FORBIDDEN" },
            403,
          );
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonResponse({ error: "Corpo JSON inválido.", code: "INVALID_JSON" }, 400);
        }

        const name = typeof body.name === "string" ? body.name.trim() : "";
        const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
        if (!name) {
          return jsonResponse({ error: "Informe o nome da integração." }, 400);
        }
        if (!rawUrl) {
          return jsonResponse({ error: "Informe a URL HTTPS de destino." }, 400);
        }

        let safeUrl: string;
        let events: string[];
        try {
          safeUrl = validateWebhookTargetUrl(rawUrl);
          events = validateWebhookEvents(body.events);
        } catch (err: any) {
          return jsonResponse({ error: err?.message || "Dados inválidos para o webhook." }, 400);
        }

        await ensureWebhookSubscriptionsSchema();
        const id = crypto.randomUUID();
        const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;

        const [newSub] = await db
          .insert(webhookSubscriptions)
          .values({
            id,
            tenantId,
            name: name.slice(0, 120),
            url: safeUrl,
            secret,
            events,
            isActive: body.isActive !== false,
          })
          .returning();

        return jsonResponse(
          {
            id: newSub.id,
            tenantId: newSub.tenantId,
            name: newSub.name,
            url: newSub.url,
            events: newSub.events,
            isActive: newSub.isActive,
            secret: newSub.secret,
            secretPreview: maskWebhookSecret(newSub.secret),
            createdAt: newSub.createdAt,
          },
          201,
        );
      },
    },
  },
});
