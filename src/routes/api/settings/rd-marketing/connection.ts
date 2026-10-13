import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { CrmError } from "../../../../lib/crm/crm-service";
import {
  beginRdAuthorization,
  disconnectRd,
  probeRdLead,
  rdConnectionStatus,
  readRdEventPage,
  saveRdCredentials,
} from "../../../../lib/rd-marketing/api-service";
import { integrationError, readIntegrationJson } from "../../../../lib/rd-marketing/http";

export const Route = createFileRoute("/api/settings/rd-marketing/connection")({
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
          return Response.json(await rdConnectionStatus(tenantId, request.url), {
            headers: { "Cache-Control": "no-store" },
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
            throw new CrmError("Origem ou formato da requisição inválido.", "BAD_REQUEST", 400);
          const raw = await readIntegrationJson(request);
          if (!raw || typeof raw !== "object" || Array.isArray(raw))
            throw new CrmError("Dados inválidos.", "BAD_REQUEST");
          const body = raw as Record<string, unknown>;
          if (body.action === "save") {
            if (typeof body.clientId !== "string" || typeof body.clientSecret !== "string")
              throw new CrmError("Credenciais inválidas.", "BAD_REQUEST");
            await saveRdCredentials(tenantId, body.clientId, body.clientSecret);
          } else if (body.action === "disconnect") await disconnectRd(tenantId);
          else if (body.action === "connect")
            return Response.json(
              { authorizationUrl: await beginRdAuthorization(session, request.url) },
              { headers: { "Cache-Control": "no-store" } },
            );
          else if (body.action === "probe") {
            if (
              !["uuid", "email", "phone"].includes(String(body.identifier)) ||
              typeof body.value !== "string"
            )
              throw new CrmError("Informe o lead.", "BAD_REQUEST");
            return Response.json(
              await probeRdLead(
                tenantId,
                body.identifier as "uuid" | "email" | "phone",
                body.value,
              ),
              { headers: { "Cache-Control": "no-store" } },
            );
          } else if (body.action === "events") {
            if (
              typeof body.uuid !== "string" ||
              !["CONVERSION", "OPPORTUNITY"].includes(String(body.eventType)) ||
              typeof body.page !== "number"
            )
              throw new CrmError("Informe a página do histórico.", "BAD_REQUEST");
            return Response.json(
              await readRdEventPage(
                tenantId,
                body.uuid,
                body.eventType as "CONVERSION" | "OPPORTUNITY",
                body.page,
              ),
              { headers: { "Cache-Control": "no-store" } },
            );
          } else throw new CrmError("Ação inválida.", "BAD_REQUEST");
          return Response.json(await rdConnectionStatus(tenantId, request.url), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          return integrationError(error);
        }
      },
    },
  },
});
