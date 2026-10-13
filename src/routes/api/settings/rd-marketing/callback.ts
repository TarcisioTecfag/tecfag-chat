import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { finishRdAuthorization } from "../../../../lib/rd-marketing/api-service";

export const Route = createFileRoute("/api/settings/rd-marketing/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
        const auth = await requireSession(request);
        if ("response" in auth) {
          for (const [key, value] of Object.entries(headers)) auth.response.headers.set(key, value);
          return auth.response;
        }
        const { session } = auth;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403, headers },
          );
        const url = new URL(request.url);
        try {
          if (url.searchParams.has("error")) throw new Error("RD_AUTH_DENIED");
          await finishRdAuthorization(
            session,
            request.url,
            url.searchParams.get("state") || "",
            url.searchParams.get("code") || "",
          );
          return new Response(null, {
            status: 303,
            headers: { ...headers, Location: `${url.origin}/?rd_marketing_connected=true` },
          });
        } catch {
          // Provider responses and OAuth code/state must never appear in HTML or logs.
          return new Response(
            '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Conexão RD Marketing</title><p>Não foi possível concluir a autorização. Volte às configurações de RD Marketing e inicie a conexão novamente, usando a mesma sessão de administrador.</p><a href="/">Voltar ao sistema</a></html>',
            { status: 400, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      },
    },
  },
});
