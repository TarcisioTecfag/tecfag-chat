import "./lib/error-capture";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

function withNoStoreHtmlHeaders(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return withNoStoreHtmlHeaders(response);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return withNoStoreHtmlHeaders(response);

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const { pathname } = new URL(request.url);
      // Se um arquivo estático /assets/* ou bundle .js/.css não foi encontrado pelo servidor de
      // estáticos do Nitro (ex.: chunk antigo pós-deploy), nunca deixar cair na rota coringa /$
      // do TanStack Router (que devolveria 200 text/html e quebraria o MIME check de módulo).
      if (
        pathname.startsWith("/assets/") ||
        pathname.startsWith("/_build/") ||
        (!pathname.startsWith("/api/") && /\.(?:js|mjs|css|map)$/i.test(pathname))
      ) {
        return new Response("Asset not found", {
          status: 404,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
          },
        });
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      });
    }
  },
};
