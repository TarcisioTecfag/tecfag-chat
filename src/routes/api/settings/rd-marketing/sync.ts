import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { CrmError } from "../../../../lib/crm/crm-service";
import { integrationError, readIntegrationJson } from "../../../../lib/rd-marketing/http";
import {
  createRdJourneyEndpoint,
  rdSyncStatus,
  registerRdJourneyEndpoint,
  reviewRdDelivery,
  saveRdSyncSettings,
  setRdJourneyEndpointEnabled,
} from "../../../../lib/rd-marketing/sync-settings";

export const Route = createFileRoute("/api/settings/rd-marketing/sync")({
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
          return Response.json(await rdSyncStatus(tenantId, request.url), {
            headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
          });
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
          if (
            !request.headers.get("content-type")?.toLowerCase().startsWith("application/json") ||
            (request.headers.get("origin") &&
              request.headers.get("origin") !== new URL(request.url).origin)
          )
            throw new CrmError("Origem ou formato inválido.", "BAD_REQUEST", 400);
          const raw = await readIntegrationJson(request);
          if (!raw || typeof raw !== "object" || Array.isArray(raw))
            throw new CrmError("Dados inválidos.", "BAD_REQUEST", 400);
          const body = raw as Record<string, unknown>;
          if (body.action === "save") {
            if (typeof body.outboundEnabled !== "boolean" || typeof body.currency !== "string")
              throw new CrmError("Configuração inválida.", "BAD_REQUEST", 400);
            await saveRdSyncSettings(tenantId, body.outboundEnabled, body.currency);
          } else if (body.action === "register") {
            for (const kind of ["CONVERSION", "OPPORTUNITY"] as const) {
              const hook = await createRdJourneyEndpoint(
                tenantId,
                kind,
                kind === "CONVERSION" ? "Conversões RD Marketing" : "Oportunidades RD Marketing",
              );
              await registerRdJourneyEndpoint(tenantId, hook.id, request.url);
            }
          } else if (body.action === "registerEndpoint" && typeof body.id === "string")
            await registerRdJourneyEndpoint(tenantId, body.id, request.url);
          else if (body.action === "automation" && typeof body.label === "string")
            await createRdJourneyEndpoint(tenantId, "AUTOMATION", body.label);
          else if (
            body.action === "endpointEnabled" &&
            typeof body.id === "string" &&
            typeof body.enabled === "boolean"
          )
            await setRdJourneyEndpointEnabled(tenantId, body.id, body.enabled);
          else if (
            body.action === "review" &&
            typeof body.id === "string" &&
            ["retry", "confirmed", "not_recorded"].includes(String(body.outcome))
          ) {
            if (body.outcome !== "retry" && body.reviewed !== true)
              throw new CrmError("Confirme que conferiu este evento no RD.", "BAD_REQUEST", 400);
            await reviewRdDelivery(
              tenantId,
              body.id,
              session.operator.id,
              body.outcome as "retry" | "confirmed" | "not_recorded",
            );
          } else throw new CrmError("Ação inválida.", "BAD_REQUEST", 400);
          return Response.json(await rdSyncStatus(tenantId, request.url), {
            headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
          });
        } catch (error) {
          return integrationError(error);
        }
      },
    },
  },
});
