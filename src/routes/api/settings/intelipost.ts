import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import {
  readIntelipostConfig,
  saveIntelipostConfig,
  testIntelipostConnection,
  toPublicIntelipostConfig,
} from "../../../lib/intelipost/intelipost-service";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/settings/intelipost")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const stored = await readIntelipostConfig(tenantId);
          return jsonResponse({
            ok: true,
            tenantId,
            ...toPublicIntelipostConfig(stored),
          });
        } catch (err: any) {
          console.error("[Settings Intelipost GET] Erro:", err);
          return jsonResponse(
            { error: err?.message || "Erro ao carregar configurações da Intelipost." },
            500,
          );
        }
      },

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          if (session.operator.role !== "admin") {
            return jsonResponse(
              { error: "Permissão insuficiente. Apenas administradores podem alterar a configuração Intelipost.", code: "FORBIDDEN" },
              403,
            );
          }

          const body = (await request.json().catch(() => ({}))) as Record<string, any>;
          const action = String(body.action || "save");

          if (action === "test") {
            const testResult = await testIntelipostConnection({
              tenantId,
              apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
              apiBaseUrl: typeof body.apiBaseUrl === "string" ? body.apiBaseUrl : undefined,
              platformName: typeof body.platformName === "string" ? body.platformName : undefined,
              originZipCode: typeof body.originZipCode === "string" ? body.originZipCode : undefined,
            });

            const updated = await saveIntelipostConfig(tenantId, session.operator.id, {
              settings: body.settings || {},
              apiKey: typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey : undefined,
              testUpdate: {
                lastTestedAt: testResult.testedAt,
                lastTestStatus: testResult.ok ? "ok" : "error",
                lastTestMessage: testResult.message,
              },
            });

            return jsonResponse({
              ok: testResult.ok,
              message: testResult.message,
              testedAt: testResult.testedAt,
              ...updated,
            });
          }

          const saved = await saveIntelipostConfig(tenantId, session.operator.id, {
            settings: body.settings || {},
            apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
            clearApiKey: Boolean(body.clearApiKey),
          });

          return jsonResponse({
            ok: true,
            message: "Configurações da Intelipost salvas com sucesso.",
            ...saved,
          });
        } catch (err: any) {
          console.error("[Settings Intelipost POST] Erro:", err);
          return jsonResponse(
            { error: err?.message || "Erro ao salvar configurações da Intelipost." },
            500,
          );
        }
      },
    },
  },
});
