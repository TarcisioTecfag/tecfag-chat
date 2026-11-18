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

        // Path to the documentation file in the brain directory (assuming it was copied or accessible)
        // For now, I will use a placeholder or read from the known file path
        const docPath = path.resolve(process.cwd(), ".gemini/antigravity/brain/bbfbd460-fe68-4280-8cf7-7c2b001c3a08/mcp-docs.md");
        
        try {
          const content = await fs.readFile(docPath, "utf-8");
          return new Response(content, {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": 'attachment; filename="mcp-docs.md"',
            },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Documentação não encontrada." }), { status: 404 });
        }
      },
    },
  },
});
