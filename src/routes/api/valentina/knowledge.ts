import { createFileRoute } from "@tanstack/react-router";
import { recordCrmAction } from "../../../lib/crm/action-history";
import { db } from "../../../db";
import { knowledgeFiles, knowledgeFolders } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireSession } from "../../../lib/auth-session";

// Diretório de mídia estático para arquivos de Formato Real
const __dirname_es = path.dirname(fileURLToPath(import.meta.url));
// Resolve para <projeto>/public/knowledge-media/
const MEDIA_DIR = path.resolve(__dirname_es, "../../../../public/knowledge-media");
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function extractKnowledgeText(name: string, type: string, base64?: string | null, rawContent?: string | null): Promise<string> {
  if (rawContent && rawContent.trim().length > 0 && !rawContent.startsWith("[Documento ")) {
    return rawContent.trim().slice(0, 100000);
  }

  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  // Se tiver base64, tenta extrair
  if (base64) {
    try {
      const buf = Buffer.from(base64, "base64");

      if (type === "pdf" || ext === "pdf") {
        try {
          const pdfParsePkg = await import("pdf-parse");
          let extractedText = "";

          // Suporte à classe PDFParse da versão 2.x
          if ((pdfParsePkg as any).PDFParse) {
            const ParserClass = (pdfParsePkg as any).PDFParse;
            const parser = new ParserClass({ data: buf });
            const result = await parser.getText();
            extractedText = result.text || "";
            try { await parser.destroy(); } catch {}
          } else if (typeof pdfParsePkg === "function") {
            const result = await (pdfParsePkg as any)(buf);
            extractedText = result.text || "";
          } else if (typeof (pdfParsePkg as any).default === "function") {
            const result = await (pdfParsePkg as any).default(buf);
            extractedText = result.text || "";
          }

          const cleaned = extractedText
            .replace(/\0/g, "")
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
            .replace(/-- \d+ of \d+ --/g, "")
            .trim();

          if (cleaned.length > 20) {
            return cleaned.slice(0, 200000);
          }
        } catch (err: any) {
          console.warn(`[knowledge.ts] Erro ao extrair texto do PDF ${name}:`, err?.message);
        }
      }

      if (type === "word" || ext === "docx" || ext === "doc") {
        try {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ buffer: buf });
          const cleaned = (result.value || "").replace(/\0/g, "").trim();
          if (cleaned.length > 20) {
            return cleaned.slice(0, 200000);
          }
        } catch (err: any) {
          console.warn(`[knowledge.ts] Erro ao extrair texto do Word ${name}:`, err?.message);
        }
      }

      if (ext === "xlsx" || ext === "xls" || ext === "csv") {
        try {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buf, { type: "buffer" });
          const texts: string[] = [];
          for (const sheetName of wb.SheetNames) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
            texts.push(`[Planilha/Aba: ${sheetName}]\n${csv}`);
          }
          const joined = texts.join("\n\n").trim();
          if (joined.length > 10) {
            return joined.slice(0, 200000);
          }
        } catch (err: any) {
          console.warn(`[knowledge.ts] Erro ao extrair planilha ${name}:`, err?.message);
        }
      }

      if (type === "txt" || ext === "txt" || ext === "md" || ext === "json") {
        try {
          const text = buf.toString("utf-8").trim();
          if (text.length > 10) {
            return text.slice(0, 200000);
          }
        } catch (err: any) {
          console.warn(`[knowledge.ts] Erro ao extrair texto puro ${name}:`, err?.message);
        }
      }
    } catch (err: any) {
      console.warn(`[knowledge.ts] Erro geral ao processar base64 de ${name}:`, err?.message);
    }
  }

  return rawContent || "";
}

export const Route = createFileRoute("/api/valentina/knowledge")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Buscar todas as pastas e arquivos da base de conhecimento ─────
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const action = url.searchParams.get("action");
        const fileId = url.searchParams.get("fileId");

        // ── GET ?action=getContent&fileId=xxx — retorna o content de UM arquivo específico
        if (action === "getContent" && fileId) {
          try {
            const [file] = await db
              .select({ id: knowledgeFiles.id, content: knowledgeFiles.content, format: knowledgeFiles.format, name: knowledgeFiles.name })
              .from(knowledgeFiles)
              .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));

            if (!file) {
              return new Response(JSON.stringify({ error: "Arquivo não encontrado ou não pertence a este tenant" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            return new Response(JSON.stringify({ content: file.content || "" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        try {
          let folders = await db
            .select()
            .from(knowledgeFolders)
            .where(eq(knowledgeFolders.tenantId, tenantId));

          // Busca arquivos SEM o campo content (evita transferir base64 na listagem geral)
          let files = await db
            .select({
              id: knowledgeFiles.id,
              tenantId: knowledgeFiles.tenantId,
              folderId: knowledgeFiles.folderId,
              name: knowledgeFiles.name,
              size: knowledgeFiles.size,
              type: knowledgeFiles.type,
              format: knowledgeFiles.format,
              uploadedAt: knowledgeFiles.uploadedAt,
            })
            .from(knowledgeFiles)
            .where(eq(knowledgeFiles.tenantId, tenantId));

          // Se for a primeira vez e não houver pastas, cria pasta padrão
          if (folders.length === 0) {
            const defaultFolder = {
              id: `f-default-${tenantId}`,
              tenantId,
              name: "Geral",
              parentId: null,
              createdAt: new Date(),
            };
            await db.insert(knowledgeFolders).values(defaultFolder).onConflictDoNothing();
            folders = [defaultFolder as any];
          }

          return new Response(
            JSON.stringify({
              folders: folders.map((f) => ({
                id: f.id,
                name: f.name,
                parentId: f.parentId,
              })),
              files: (files as any[]).map((f) => ({
                id: f.id,
                name: f.name,
                size: f.size,
                type: f.type,
                format: f.format,
                uploadedAt: new Date(f.uploadedAt).toLocaleDateString("pt-BR"),
                folderId: f.folderId,
              })),
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[api/valentina/knowledge] Erro no GET:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── POST: Criar/Mover pasta ou subir/mover novo arquivo ─────────────────
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        if (session.operator.role !== "admin" && session.operator.role !== "supervisor") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem gerenciar a base.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;

        try {
          const body = await request.json();
          const { action } = body;

          // Action 1: Criar/Editar/Mover Pasta
          if (action === "create_folder" || action === "update_folder" || action === "move_folder") {
            const { id, name, parentId } = body;
            const cleanName = (name || "Nova Pasta").trim();
            const targetParentId = parentId !== undefined && parentId !== "" ? parentId : null;

            if (action === "create_folder") {
              const allTenantFolders = await db
                .select()
                .from(knowledgeFolders)
                .where(eq(knowledgeFolders.tenantId, tenantId));

              const duplicateByName = allTenantFolders.find(
                (f) =>
                  f.name.trim().toLowerCase() === cleanName.toLowerCase() &&
                  (f.parentId || null) === targetParentId
              );

              if (duplicateByName) {
                return new Response(
                  JSON.stringify({
                    success: true,
                    reused: true,
                    folder: {
                      id: duplicateByName.id,
                      name: duplicateByName.name,
                      parentId: duplicateByName.parentId,
                    },
                  }),
                  { headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              }
            }

            const folderId = id || `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            const existing = await db
              .select()
              .from(knowledgeFolders)
              .where(and(eq(knowledgeFolders.id, folderId), eq(knowledgeFolders.tenantId, tenantId)));

            if (existing.length > 0) {
              await db
                .update(knowledgeFolders)
                .set({
                  name: cleanName || existing[0].name,
                  parentId: targetParentId,
                })
                .where(and(eq(knowledgeFolders.id, folderId), eq(knowledgeFolders.tenantId, tenantId)));
            } else {
              await db.insert(knowledgeFolders).values({
                id: folderId,
                tenantId,
                name: cleanName,
                parentId: targetParentId,
                createdAt: new Date(),
              });
            }

            return new Response(
              JSON.stringify({ success: true, folder: { id: folderId, name: cleanName, parentId: targetParentId } }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Action 2: Mover Arquivo entre Pastas
          if (action === "move_file" || action === "update_file") {
            const { id, folderId } = body;
            const targetFolderId = folderId !== undefined && folderId !== "" ? folderId : null;

            await db
              .update(knowledgeFiles)
              .set({ folderId: targetFolderId })
              .where(and(eq(knowledgeFiles.id, id), eq(knowledgeFiles.tenantId, tenantId)));

            return new Response(
              JSON.stringify({ success: true, fileId: id, folderId: targetFolderId }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Helper interno para salvar ou atualizar um arquivo (suporta upload único e em lote)
          const processSingleFileUpload = async (
            item: {
              name: string;
              size?: string;
              type?: string;
              format?: string;
              folderId?: string | null;
              content?: string | null;
              base64?: string | null;
            },
            validFolderIdsSet: Set<string>
          ) => {
            const rawName = (item.name || "arquivo").trim();
            const ext = rawName.split(".").pop()?.toLowerCase() || "";
            const isImageFile =
              item.type === "image" || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);

            // Imagens com base64 são SEMPRE salvas em Formato Real para garantir funcionamento no Catálogo e IA
            const effectiveType = isImageFile ? "image" : item.type || "txt";
            const effectiveFormat =
              isImageFile && item.base64 ? "real" : item.format || "embeddings";

            const validFolderId =
              item.folderId && validFolderIdsSet.has(item.folderId) ? item.folderId : null;

            // Verifica se já existe arquivo com o mesmo nome no mesmo tenant (evita duplicatas em re-uploads)
            const existingCandidates = await db
              .select({
                id: knowledgeFiles.id,
                folderId: knowledgeFiles.folderId,
                name: knowledgeFiles.name,
              })
              .from(knowledgeFiles)
              .where(and(eq(knowledgeFiles.tenantId, tenantId), eq(knowledgeFiles.name, rawName)));

            const existingFile =
              existingCandidates.find((c) => c.folderId === validFolderId) ||
              (isImageFile ? existingCandidates[0] : undefined);

            const fileId =
              existingFile?.id ||
              `kf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            let mediaUrl: string | null = null;
            let realBase64: string | null = null;

            if (
              effectiveFormat === "real" &&
              item.base64 &&
              (effectiveType === "image" ||
                ["png", "jpg", "jpeg", "gif", "webp", "pdf", "docx", "doc"].includes(ext))
            ) {
              realBase64 = item.base64;
              const safeExt = ext || "jpg";
              const safeFileName = `${fileId}.${safeExt}`;
              mediaUrl = `/knowledge-media/${safeFileName}`;
              try {
                const filePath = path.join(MEDIA_DIR, safeFileName);
                const buf = Buffer.from(item.base64, "base64");
                fs.writeFileSync(filePath, buf);
              } catch (saveErr: any) {
                console.warn(`[knowledge.ts] Aviso ao gravar arquivo em disco (${safeFileName}):`, saveErr?.message);
              }
            }

            let extractedContent: string;
            if (effectiveFormat === "real" && mediaUrl) {
              if (effectiveType === "image" && realBase64) {
                extractedContent = `[FORMATO_REAL:${mediaUrl}][BASE64:${realBase64}]`;
              } else {
                const textContent = await extractKnowledgeText(
                  rawName,
                  effectiveType,
                  item.base64,
                  item.content
                );
                extractedContent = `[FORMATO_REAL:${mediaUrl}] ${textContent}`;
              }
            } else {
              extractedContent = await extractKnowledgeText(
                rawName,
                effectiveType,
                item.base64,
                item.content
              );
            }

            const now = new Date();
            if (existingFile) {
              await db
                .update(knowledgeFiles)
                .set({
                  folderId: validFolderId,
                  name: rawName,
                  size: item.size || "10 KB",
                  type: effectiveType,
                  format: effectiveFormat,
                  content: extractedContent,
                  uploadedAt: now,
                })
                .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));
            } else {
              await db.insert(knowledgeFiles).values({
                id: fileId,
                tenantId,
                folderId: validFolderId,
                name: rawName,
                size: item.size || "10 KB",
                type: effectiveType,
                format: effectiveFormat,
                content: extractedContent,
                uploadedAt: now,
              });
            }

            return {
              id: fileId,
              name: rawName,
              size: item.size || "10 KB",
              type: effectiveType,
              format: effectiveFormat,
              mediaUrl,
              uploadedAt: now.toLocaleDateString("pt-BR"),
              folderId: validFolderId,
              updated: !!existingFile,
            };
          };

          // Action 3: Subir Arquivo Único (com auto-detecção de imagem em Formato Real e upsert)
          if (action === "upload_file") {
            const tenantFolders = await db
              .select({ id: knowledgeFolders.id })
              .from(knowledgeFolders)
              .where(eq(knowledgeFolders.tenantId, tenantId));
            const validFolderIdsSet = new Set(tenantFolders.map((f) => f.id));

            const savedFile = await processSingleFileUpload(body, validFolderIdsSet);

            return new Response(
              JSON.stringify({
                success: true,
                file: savedFile,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Action 4: Subir Lote de Arquivos em Massa (upload_batch)
          if (action === "upload_batch" && Array.isArray(body.items)) {
            const tenantFolders = await db
              .select({ id: knowledgeFolders.id })
              .from(knowledgeFolders)
              .where(eq(knowledgeFolders.tenantId, tenantId));
            const validFolderIdsSet = new Set(tenantFolders.map((f) => f.id));

            const savedFiles = [];
            for (const item of body.items) {
              if (!item || !item.name) continue;
              const saved = await processSingleFileUpload(item, validFolderIdsSet);
              savedFiles.push(saved);
            }

            return new Response(
              JSON.stringify({
                success: true,
                files: savedFiles,
                count: savedFiles.length,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(JSON.stringify({ error: "Ação não informada ou inválida" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[api/valentina/knowledge] Erro no POST:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── PATCH: Atualizar content de um arquivo (reparo de extração falha) ───
      PATCH: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        if (session.operator.role !== "admin" && session.operator.role !== "supervisor") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;

        try {
          const body = await request.json();
          const { fileId, content } = body;

          if (!fileId || content === undefined) {
            return new Response(JSON.stringify({ error: "fileId e content são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const [existing] = await db
            .select({ id: knowledgeFiles.id, tenantId: knowledgeFiles.tenantId })
            .from(knowledgeFiles)
            .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));

          if (!existing) {
            return new Response(JSON.stringify({ error: "Arquivo não encontrado ou não pertence ao tenant" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          await db.update(knowledgeFiles)
            .set({ content: String(content).slice(0, 200000) })
            .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));

          return new Response(JSON.stringify({ success: true, chars: String(content).length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[api/valentina/knowledge] Erro no PATCH:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── DELETE: Excluir pasta ou arquivo ────────────────────────────────────
      DELETE: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        if (session.operator.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Apenas administradores podem excluir itens da base de conhecimento.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;

        try {
          const url = new URL(request.url);
          const type = url.searchParams.get("type"); // 'file' ou 'folder'
          const id = url.searchParams.get("id");

          if (!type || !id) {
            return new Response(JSON.stringify({ error: "type e id são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (type === "file") {
            const deleted = await db.delete(knowledgeFiles).where(and(eq(knowledgeFiles.id, id), eq(knowledgeFiles.tenantId, tenantId)))
              .returning({ id: knowledgeFiles.id, name: knowledgeFiles.name });
            if (deleted.length) await recordCrmAction({ tenantId, operatorId: session.operator.id,
              operatorName: session.operator.name, action: "delete_knowledge_file", entityType: "knowledge_file",
              itemCount: deleted.length, details: { files: deleted } });
          } else if (type === "folder") {
            // Remove pasta e arquivos vinculados ao mesmo tenant
            const deletedFiles = await db.delete(knowledgeFiles).where(and(eq(knowledgeFiles.folderId, id), eq(knowledgeFiles.tenantId, tenantId)))
              .returning({ id: knowledgeFiles.id, name: knowledgeFiles.name });
            const deletedFolders = await db.delete(knowledgeFolders).where(and(eq(knowledgeFolders.id, id), eq(knowledgeFolders.tenantId, tenantId)))
              .returning({ id: knowledgeFolders.id, name: knowledgeFolders.name });
            if (deletedFolders.length) await recordCrmAction({ tenantId, operatorId: session.operator.id,
              operatorName: session.operator.name, action: "delete_knowledge_folder", entityType: "knowledge_folder",
              itemCount: deletedFiles.length + deletedFolders.length,
              details: { folders: deletedFolders, files: deletedFiles } });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[api/valentina/knowledge] Erro no DELETE:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
