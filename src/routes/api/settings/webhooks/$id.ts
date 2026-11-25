import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { webhookSubscriptions } from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";
import {
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

export const Route = createFileRoute("/api/settings/webhooks/$id")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;

        const { session } = auth;
        const tenantId = session.tenantId;
        const canManage =
          session.operator.role === "admin" ||
          Boolean(session.permissions?.settings?.canManageWhatsapp);
        if (!canManage) {
          return jsonResponse(
            { error: "Permissão insuficiente para alterar subscrições de webhook.", code: "FORBIDDEN" },
            403,
          );
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonResponse({ error: "Corpo JSON inválido.", code: "INVALID_JSON" }, 400);
        }

        await ensureWebhookSubscriptionsSchema();

        const [existing] = await db
          .select()
          .from(webhookSubscriptions)
          .where(
            and(
              eq(webhookSubscriptions.id, params.id),
              eq(webhookSubscriptions.tenantId, tenantId),
            ),
          )
          .limit(1);

        if (!existing) {
          return jsonResponse({ error: "Subscrição de webhook não encontrada." }, 404);
        }

        const patch: Partial<typeof webhookSubscriptions.$inferInsert> = {};
        try {
          if (typeof body.name === "string") {
            const trimmed = body.name.trim();
            if (!trimmed) throw new Error("O nome não pode ser vazio.");
            patch.name = trimmed.slice(0, 120);
          }
          if (typeof body.url === "string") {
            patch.url = validateWebhookTargetUrl(body.url);
          }
          if (body.events !== undefined) {
            patch.events = validateWebhookEvents(body.events);
          }
          if (typeof body.isActive === "boolean") {
            patch.isActive = body.isActive;
          }
        } catch (err: any) {
          return jsonResponse({ error: err?.message || "Dados inválidos." }, 400);
        }

        let rotatedSecret: string | undefined;
        if (body.rotateSecret === true) {
          rotatedSecret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
          patch.secret = rotatedSecret;
        }

        if (Object.keys(patch).length === 0) {
          return jsonResponse({ error: "Informe ao menos um campo para atualizar." }, 400);
        }

        const [updated] = await db
          .update(webhookSubscriptions)
          .set(patch)
          .where(
            and(
              eq(webhookSubscriptions.id, params.id),
              eq(webhookSubscriptions.tenantId, tenantId),
            ),
          )
          .returning();

        return jsonResponse({
          id: updated.id,
          tenantId: updated.tenantId,
          name: updated.name,
          url: updated.url,
          events: updated.events,
          isActive: updated.isActive,
          secretPreview: maskWebhookSecret(updated.secret),
          ...(rotatedSecret ? { secret: rotatedSecret } : {}),
          createdAt: updated.createdAt,
        });
      },

      DELETE: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;

        const { session } = auth;
        const tenantId = session.tenantId;
        const canManage =
          session.operator.role === "admin" ||
          Boolean(session.permissions?.settings?.canManageWhatsapp);
        if (!canManage) {
          return jsonResponse(
            { error: "Permissão insuficiente para remover subscrições de webhook.", code: "FORBIDDEN" },
            403,
          );
        }

        await ensureWebhookSubscriptionsSchema();
        const [deleted] = await db
          .delete(webhookSubscriptions)
          .where(
            and(
              eq(webhookSubscriptions.id, params.id),
              eq(webhookSubscriptions.tenantId, tenantId),
            ),
          )
          .returning({ id: webhookSubscriptions.id });

        if (!deleted) {
          return jsonResponse({ error: "Subscrição de webhook não encontrada." }, 404);
        }

        return new Response(null, { status: 204 });
      },
    },
  },
});
