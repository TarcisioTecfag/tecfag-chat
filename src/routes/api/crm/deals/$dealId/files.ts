import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";
import { db } from "../../../../../db";
import { crmDeals } from "../../../../../db/schema";
import { eq, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/files")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/files
       * Lista os arquivos anexados à negociação.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };

          const [deal] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return new Response(
              JSON.stringify({ error: "Negociação não encontrada para este tenant.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const files = await crmService.getDealFiles(tenantId, dealId);

          return new Response(JSON.stringify({ files }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals/:dealId/files
       * Registra um anexo/arquivo no negócio.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };
          const body = await request.json().catch(() => ({}));

          if (!body.fileName || typeof body.fileName !== "string" || !body.fileName.trim()) {
            return new Response(
              JSON.stringify({ error: "Nome do arquivo (fileName) é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (typeof body.fileSize !== "number" || body.fileSize <= 0) {
            return new Response(
              JSON.stringify({ error: "Tamanho do arquivo (fileSize) deve ser maior que 0.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const file = await crmService.uploadDealFile(tenantId, dealId, session.operator.id, {
            fileName: body.fileName,
            fileSize: body.fileSize,
            mimeType: body.mimeType || "application/octet-stream",
            storagePath: body.storagePath || `/crm-uploads/${dealId}/${Date.now()}_${body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
            conversationId: body.conversationId || null,
            metadata: body.metadata || {},
          });

          return new Response(JSON.stringify({ file, message: "Arquivo anexado com sucesso." }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId/files
       * Remove um arquivo anexado à negociação.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };
          const url = new URL(request.url);
          const body = await request.json().catch(() => ({}));
          const fileId = body.fileId || url.searchParams.get("fileId");

          if (!fileId) {
            return new Response(
              JSON.stringify({ error: "fileId é obrigatório para exclusão.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await crmService.deleteDealFile(tenantId, dealId, fileId, session.operator.id);

          return new Response(JSON.stringify({ success: true, message: "Arquivo excluído com sucesso." }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },
    },
  },
});
