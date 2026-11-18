import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import fs from "node:fs/promises";
import path from "node:path";

export const Route = createFileRoute("/api/settings/mcp-docs/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;

        // Path to the documentation file in the project's docs folder
        const docPath = path.resolve(process.cwd(), "docs/rd-marketing.md");
        
        try {
          const content = await fs.readFile(docPath, "utf-8");
          return new Response(content, {
            headers: {
              "Content-Type": "text/markdown",
              "Content-Disposition": 'attachment; filename="rd-marketing.md"',
            },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Documentação não encontrada." }), { status: 404 });
        }
      },
    },
  },
});
