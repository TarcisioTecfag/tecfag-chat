import { requireCrmDealAccess } from "../../../../../../lib/access-control/crm-record-access";
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../../lib/crm/crm-service";
import { recordCrmAction } from "../../../../../../lib/crm/action-history";
import { buildDealFileHttpResponse } from "../../../../../../lib/crm/deal-file-storage";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Disposition",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/files/$fileId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * HEAD /api/crm/deals/:dealId/files/:fileId
       * Permite que o frontend ou o player de vídeo valide disponibilidade e Content-Length antes do download/streaming.
       */
      HEAD: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const recordDenied = await requireCrmDealAccess(session, (params as { dealId: string }).dealId);
          if (recordDenied) return recordDenied;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { dealId, fileId } = params as { dealId: string; fileId: string };
          const file = await crmService.getDealFileById(tenantId, dealId, fileId);
          if (!file) {
            return new Response(null, { status: 404, headers: corsHeaders });
          }

          const url = new URL(request.url);
          const isDownload = url.searchParams.get("download") === "1";
          return await buildDealFileHttpResponse({
            request,
            tenantId,
            file,
            isDownload,
            corsHeaders,
            headOnly: true,
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },

      /**
       * GET /api/crm/deals/:dealId/files/:fileId
       * Transmite o arquivo binário para visualização embutida (inline), streaming de vídeo MP4 (206 Partial Content)
       * ou download forçado (?download=1), com autocura automática via PostgreSQL quando o disco efêmero é recriado.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const recordDenied = await requireCrmDealAccess(session, (params as { dealId: string }).dealId);
          if (recordDenied) return recordDenied;

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

          const url = new URL(request.url);
          const isDownload = url.searchParams.get("download") === "1";

          return await buildDealFileHttpResponse({
            request,
            tenantId,
            file,
            isDownload,
            corsHeaders,
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId/files/:fileId
       * Remove o arquivo especificado do banco (incluindo blocos via ON DELETE CASCADE) e limpa o cache em disco.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const recordDenied = await requireCrmDealAccess(session, (params as { dealId: string }).dealId);
          if (recordDenied) return recordDenied;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId, fileId } = params as { dealId: string; fileId: string };

          await crmService.deleteDealFile(tenantId, dealId, fileId, session.operator.id);
          await recordCrmAction({
            tenantId,
            operatorId: session.operator.id,
            operatorName: session.operator.name,
            action: "delete_deal_file",
            entityType: "deal_file",
            itemCount: 1,
            details: { dealId, fileId },
          });

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
