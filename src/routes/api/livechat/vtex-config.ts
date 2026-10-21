import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { db } from "../../../db";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import {
  readVtexConfig,
  publicVtexConfig,
  saveVtexConfig,
  credentialsForVtex,
  VtexConfigError,
} from "../../../lib/vtex/store";
import { vtexSettingsSchema, vtexQuerySchema } from "../../../lib/vtex/contract";
import { queryVtex } from "../../../lib/vtex/client";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
async function authenticate(request: Request) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth;
  if (auth.session.operator.role !== "admin")
    return { response: json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403) };
  if (getAiPersona(auth.session.tenantId).triagePolicy !== "industrial")
    return { response: json({ error: "Integração indisponível para este perfil." }, 404) };
  return auth;
}
function failure(error: unknown) {
  if (error instanceof VtexConfigError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json({ error: "Dados inválidos. Confira a conta, domínio, canal e consulta." }, 400);
  return json({ error: "Não foi possível processar a configuração VTEX." }, 500);
}
export const Route = createFileRoute("/api/livechat/vtex-config")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if ("response" in auth) return auth.response;
        try {
          return json(publicVtexConfig(await readVtexConfig(db, auth.session.tenantId)));
        } catch (error) {
          return failure(error);
        }
      },
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        try {
          if (Number(request.headers.get("content-length") || 0) > 120_000)
            return json({ error: "Dados excedem o limite." }, 413);
          const text = await request.text();
          if (text.length > 30_000) return json({ error: "Dados excedem o limite." }, 413);
          let raw: unknown;
          try {
            raw = JSON.parse(text);
          } catch {
            return json({ error: "JSON inválido." }, 400);
          }
          if ((raw as Record<string, unknown>)?.action === "test") {
            const body = z
              .object({
                action: z.literal("test"),
                settings: vtexSettingsSchema,
                query: vtexQuerySchema,
                channel: z.enum(["livechat", "whatsapp"]),
                intent: z.enum(["price", "shipping", "details"]).default("details"),
              })
              .strict()
              .parse(raw);
            const current = await readVtexConfig(db, tenantId);
            const policy = body.settings.channels[body.channel];
            const permitted =
              policy.catalog &&
              (body.intent !== "price" || policy.price) &&
              (body.intent !== "shipping" || policy.shipping);
            const result = await queryVtex(body.settings, body.query, body.channel, {
              signal: request.signal,
              credentials: permitted
                ? credentialsForVtex(tenantId, current, body.settings)
                : undefined,
              intent: body.intent,
              shippingRequested: body.intent === "shipping",
            });
            return json({ result });
          }
          return json(await saveVtexConfig(db, tenantId, raw, auth.session.operator.id));
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
