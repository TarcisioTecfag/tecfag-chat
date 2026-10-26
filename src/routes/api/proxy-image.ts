import { createFileRoute } from "@tanstack/react-router";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function isSafePublicHttpUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/proxy-image")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const targetRaw = (reqUrl.searchParams.get("url") || "").trim();
        const parsedTarget = isSafePublicHttpUrl(targetRaw);

        if (!parsedTarget) {
          return new Response("URL inválida ou bloqueada.", { status: 400, headers: CORS_HEADERS });
        }

        try {
          const response = await fetch(parsedTarget.toString(), {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            },
            signal: AbortSignal.timeout(8000),
          });

          if (!response.ok) {
            return new Response("Falha ao buscar imagem.", { status: response.status, headers: CORS_HEADERS });
          }

          const contentType = response.headers.get("content-type") || "";
          if (!contentType.startsWith("image/")) {
            return new Response("O recurso não é uma imagem válida.", { status: 400, headers: CORS_HEADERS });
          }

          const buffer = await response.arrayBuffer();
          return new Response(buffer, {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=86400",
            },
          });
        } catch {
          return new Response("Erro ao carregar imagem.", { status: 502, headers: CORS_HEADERS });
        }
      },
    },
  },
});
