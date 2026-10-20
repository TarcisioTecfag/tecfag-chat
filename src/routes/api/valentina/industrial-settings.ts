import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { db } from "../../../db";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import {
  readIndustrialSettings,
  saveIndustrialSettings,
  industrialSettingsChoices,
  IndustrialSettingsError,
} from "../../../lib/triage/industrial-settings-store";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
async function authenticate(request: Request) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth;
  if (auth.session.operator.role !== "admin")
    return { response: json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403) };
  if (getAiPersona(auth.session.tenantId).triagePolicy !== "industrial")
    return { response: json({ error: "Configuração indisponível para este perfil." }, 404) };
  return auth;
}
function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return json(
      {
        error: "Configuração inválida",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    );
  if (error instanceof IndustrialSettingsError) return json({ error: error.message }, error.status);
  console.error("[IndustrialSettings] Falha ao processar configuração.");
  return json({ error: "Não foi possível processar a configuração." }, 500);
}
export const Route = createFileRoute("/api/valentina/industrial-settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        try {
          const [config, choices] = await Promise.all([
            readIndustrialSettings(db, tenantId),
            industrialSettingsChoices(db, tenantId),
          ]);
          return json({ revision: config.revision, settings: config.settings, choices });
        } catch (error) {
          return failure(error);
        }
      },
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        try {
          if (Number(request.headers.get("content-length") || 0) > 8_000_000)
            return json({ error: "Configuração excede 8 MB." }, 413);
          const text = await request.text();
          if (text.length > 8_000_000) return json({ error: "Configuração excede 8 MB." }, 413);
          let raw: unknown;
          try {
            raw = JSON.parse(text);
          } catch {
            return json({ error: "JSON inválido." }, 400);
          }
          const body = z
            .object({ expectedRevision: z.number().int().nonnegative(), settings: z.unknown() })
            .strict()
            .parse(raw);
          const saved = await saveIndustrialSettings(
            db,
            tenantId,
            body.expectedRevision,
            body.settings,
            auth.session.operator.id,
          );
          return json(saved);
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
