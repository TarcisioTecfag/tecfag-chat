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

export const Route = createFileRoute("/api/proxy-meta")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const targetRaw = (reqUrl.searchParams.get("url") || "").trim();
        const parsedTarget = isSafePublicHttpUrl(targetRaw);

        if (!parsedTarget) {
          return new Response(JSON.stringify({ error: "URL inválida ou não permitida." }), {
            status: 400,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }

        try {
          const response = await fetch(parsedTarget.toString(), {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            signal: AbortSignal.timeout(6000),
          });

          if (!response.ok) {
            return new Response(JSON.stringify({ title: null, image: null }), {
              status: 200,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
          }

          const html = await response.text();
          const titleMatch =
            html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
            html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i) ||
            html.match(/<title[^>]*>([^<]+)<\/title>/i);

          const imageMatch =
            html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
            html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);

          let title = titleMatch ? titleMatch[1] : null;
          let image = imageMatch ? imageMatch[1] : null;

          if (title) {
            title = title
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .trim();
          }

          if (image && image.startsWith("http://")) {
            image = `/api/proxy-image?url=${encodeURIComponent(image)}`;
          }

          return new Response(JSON.stringify({ title, image }), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600",
            },
          });
        } catch {
          return new Response(JSON.stringify({ title: null, image: null }), {
            status: 200,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
