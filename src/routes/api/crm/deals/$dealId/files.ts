import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";
import { db } from "../../../../../db";
import { crmDeals, crmDealFiles } from "../../../../../db/schema";
import { eq, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

function serveDiskFile(file: any, isDownload: boolean) {
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
}

export const Route = createFileRoute("/api/crm/deals/$dealId/files")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/files
       * Se ?fileId=... for passado, transmite o arquivo binário diretamente.
       * Caso contrário, lista todos os arquivos da negociação com URLs de visualização e download.
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

          const url = new URL(request.url);
          const requestedFileId = url.searchParams.get("fileId");

          // Servir arquivo único se solicitado via query param
          if (requestedFileId) {
            const file = await crmService.getDealFileById(tenantId, dealId, requestedFileId);
            if (!file) {
              return new Response(
                JSON.stringify({ error: "Arquivo não encontrado.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            const isDownload = url.searchParams.get("download") === "1";
            return serveDiskFile(file, isDownload);
          }

          const files = await crmService.getDealFiles(tenantId, dealId);
          const enrichedFiles = files.map((f: any) => ({
            ...f,
            url: `/api/crm/deals/${dealId}/files/${f.id}`,
            downloadUrl: `/api/crm/deals/${dealId}/files/${f.id}?download=1`,
          }));

          return new Response(JSON.stringify({ files: enrichedFiles }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals/:dealId/files
       * Suporta multipart/form-data com upload direto de arquivos de até 100MB da máquina local,
       * ou JSON com metadados para retrocompatibilidade.
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

          const contentType = request.headers.get("content-type") || "";

          // 1. Processamento de Upload Real (multipart/form-data)
          if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const fileEntries = formData.getAll("files");
            const singleFile = formData.get("file");
            const filesToProcess: File[] = [];

            if (fileEntries && fileEntries.length > 0) {
              for (const entry of fileEntries) {
                if (entry instanceof File && entry.size > 0) {
                  filesToProcess.push(entry);
                }
              }
            }
            if (filesToProcess.length === 0 && singleFile instanceof File && singleFile.size > 0) {
              filesToProcess.push(singleFile);
            }

            if (filesToProcess.length === 0) {
              return new Response(
                JSON.stringify({ error: "Nenhum arquivo enviado no formulário.", code: "BAD_REQUEST" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            const uploadDir = path.join(process.cwd(), "uploads", "crm", tenantId, dealId);
            if (!fs.existsSync(uploadDir)) {
              fs.mkdirSync(uploadDir, { recursive: true });
            }

            const uploadedResults = [];
            for (const f of filesToProcess) {
              if (f.size > MAX_FILE_SIZE) {
                return new Response(
                  JSON.stringify({
                    error: `O arquivo "${f.name}" excede o limite máximo permitido de 100MB (${(f.size / (1024 * 1024)).toFixed(1)} MB).`,
                    code: "FILE_TOO_LARGE",
                  }),
                  { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              }

              const fileId = `dfile-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
              const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
              const diskPath = path.join(uploadDir, `${fileId}_${safeName}`);
              const buffer = Buffer.from(await f.arrayBuffer());
              await fs.promises.writeFile(diskPath, buffer);

              const saved = await crmService.uploadDealFile(tenantId, dealId, session.operator.id, {
                fileName: f.name,
                fileSize: f.size,
                mimeType: f.type || "application/octet-stream",
                storagePath: diskPath,
                conversationId: (formData.get("conversationId") as string) || null,
                metadata: {
                  originalName: f.name,
                  diskPath,
                  uploadedFrom: "desktop_upload",
                },
              });

              uploadedResults.push({
                ...saved,
                url: `/api/crm/deals/${dealId}/files/${saved.id}`,
                downloadUrl: `/api/crm/deals/${dealId}/files/${saved.id}?download=1`,
              });
            }

            return new Response(
              JSON.stringify({
                files: uploadedResults,
                file: uploadedResults[0],
                message: `${uploadedResults.length} arquivo(s) anexado(s) com sucesso.`,
              }),
              { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 2. Processamento JSON (Retrocompatibilidade)
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

          return new Response(
            JSON.stringify({
              file: {
                ...file,
                url: `/api/crm/deals/${dealId}/files/${file.id}`,
                downloadUrl: `/api/crm/deals/${dealId}/files/${file.id}?download=1`,
              },
              message: "Arquivo anexado com sucesso.",
            }),
            {
              status: 201,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
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
