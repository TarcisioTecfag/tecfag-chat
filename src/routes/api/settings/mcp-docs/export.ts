import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import {
  buildCompleteApiLibraryMarkdown,
  buildCompleteApiLibraryPdf,
} from "../../../../lib/marketing/api-library-docs-export";

export const Route = createFileRoute("/api/settings/mcp-docs/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;

        const tenantId = auth.session.tenantId;
        const url = new URL(request.url);
        const format = (url.searchParams.get("format") || "pdf").toLowerCase();
        const disposition =
          url.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
        const baseUrl = url.origin;

        try {
          if (format === "md" || format === "markdown") {
            const markdown = buildCompleteApiLibraryMarkdown({
              tenantId,
              baseUrl,
            });
            const mdDisposition =
              url.searchParams.get("download") === "1" ? "attachment" : "inline";
            return new Response(markdown, {
              status: 200,
              headers: {
                "Content-Type": "text/markdown; charset=utf-8",
                "Content-Disposition": `${mdDisposition}; filename="biblioteca-api-${tenantId}.md"`,
                "Cache-Control": "no-store",
              },
            });
          }

          const pdfBytes = await buildCompleteApiLibraryPdf({
            tenantId,
            baseUrl,
          });
          const body = Buffer.from(pdfBytes);

          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `${disposition}; filename="biblioteca-api-${tenantId}.pdf"`,
              "Content-Length": String(body.byteLength),
              "Cache-Control": "no-store",
            },
          });
        } catch (err) {
          console.error("[api/settings/mcp-docs/export] Falha ao gerar documentação:", err);
          return new Response(
            JSON.stringify({
              error: "Não foi possível gerar a documentação completa da Biblioteca de API.",
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              },
            },
          );
        }
      },
    },
  },
});
