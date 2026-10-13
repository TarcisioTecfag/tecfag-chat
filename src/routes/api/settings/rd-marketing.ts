import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../../db";
import { rdMarketingFlows } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { CrmError } from "../../../lib/crm/crm-service";
import {
  flowOptions,
  hashToken,
  listFlows,
  newWebhookToken,
  previewFlow,
  validateFlow,
} from "../../../lib/rd-marketing/service";
import { integrationError, readIntegrationJson } from "../../../lib/rd-marketing/http";

export const Route = createFileRoute("/api/settings/rd-marketing")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        try {
          const [data, options] = await Promise.all([listFlows(tenantId), flowOptions(tenantId)]);
          return Response.json({ ...data, options }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return integrationError(error);
        }
      },
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        try {
          const raw = await readIntegrationJson(request);
          if (!raw || typeof raw !== "object" || Array.isArray(raw))
            throw new CrmError("Dados inválidos.", "BAD_REQUEST", 400);
          const body = raw as Record<string, unknown>;
          if (body.action === "preview")
            return Response.json(await previewFlow(tenantId, body.settings, body.payload));
          const id = typeof body.id === "string" ? body.id : "";
          const [existing] = id
            ? await db
                .select()
                .from(rdMarketingFlows)
                .where(and(eq(rdMarketingFlows.tenantId, tenantId), eq(rdMarketingFlows.id, id)))
            : [];
          if (id && !existing) throw new CrmError("Fluxo não encontrado.", "NOT_FOUND", 404);
          if (body.action === "rotate") {
            if (!existing) throw new CrmError("Selecione um fluxo salvo.", "BAD_REQUEST", 400);
            const token = newWebhookToken();
            await db
              .update(rdMarketingFlows)
              .set({ tokenHash: hashToken(token), updatedAt: new Date() })
              .where(and(eq(rdMarketingFlows.tenantId, tenantId), eq(rdMarketingFlows.id, id)));
            return Response.json(
              { webhookUrl: `${new URL(request.url).origin}/api/webhooks/rd-marketing/${token}` },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
          if (body.action !== "save") throw new CrmError("Ação inválida.", "BAD_REQUEST", 400);
          const settings = await validateFlow(tenantId, body.settings);
          if (existing) {
            await db
              .update(rdMarketingFlows)
              .set({ settings, updatedAt: new Date() })
              .where(and(eq(rdMarketingFlows.tenantId, tenantId), eq(rdMarketingFlows.id, id)));
            return Response.json({ id });
          }
          const flowId = randomUUID();
          const token = newWebhookToken();
          await db
            .insert(rdMarketingFlows)
            .values({ id: flowId, tenantId, tokenHash: hashToken(token), settings });
          return Response.json(
            {
              id: flowId,
              webhookUrl: `${new URL(request.url).origin}/api/webhooks/rd-marketing/${token}`,
            },
            { status: 201, headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          return integrationError(error);
        }
      },
    },
  },
});
