import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";
import { requireSession } from "../../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/files/$fileId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/files/:fileId
       * Transmite o arquivo binário para visualização embutida (inline) ou download forçado (?download=1).
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { dealId, fileId } = params as { dealId: string; fileId: string };

          const file = await crmService.getDealFileById(tenantId, dealId, fileId);
          if (!file) {
            return new Response(
              JSON.stringify({ error: "Arquivo não encontrado.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          let diskPath = file.storagePath;
          if (diskPath && !path.isAbsolute(diskPath)) {
            diskPath = path.resolve(process.cwd(), diskPath);
          }

          if (!diskPath || !fs.existsSync(diskPath)) {
            return new Response(
              JSON.stringify({ error: "Arquivo físico não encontrado no servidor.", code: "FILE_NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const url = new URL(request.url);
          const isDownload = url.searchParams.get("download") === "1";
          const stats = fs.statSync(diskPath);
          const fileBuffer = fs.readFileSync(diskPath);
          const disposition = isDownload ? "attachment" : "inline";
          const safeAsciiName = file.fileName.replace(/[^\x20-\x7E]/g, "_");
          const encodedUtf8Name = encodeURIComponent(file.fileName);

          return new Response(fileBuffer, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": file.mimeType || "application/octet-stream",
              "Content-Length": stats.size.toString(),
              "Content-Disposition": `${disposition}; filename="${safeAsciiName}"; filename*=UTF-8''${encodedUtf8Name}`,
              "Cache-Control": "private, max-age=86400",
              "Accept-Ranges": "bytes",
            },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId/files/:fileId
       * Remove o arquivo especificado e limpa do disco.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId, fileId } = params as { dealId: string; fileId: string };

          await crmService.deleteDealFile(tenantId, dealId, fileId, session.operator.id);

          return new Response(
            JSON.stringify({ success: true, message: "Arquivo excluído com sucesso." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },
    },
  },
});
