import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { knowledgeFiles, knowledgeFolders } from "../../../db/schema";
import { eq, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function extractKnowledgeText(name: string, type: string, base64?: string | null, rawContent?: string | null): Promise<string> {
  if (rawContent && rawContent.trim().length > 0 && !rawContent.startsWith("[Documento ")) {
    return rawContent.trim().slice(0, 100000);
  }
  if (!base64) return rawContent || "";

  const buf = Buffer.from(base64, "base64");
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (type === "pdf" || ext === "pdf") {
    try {
      const pdfParse = await import("pdf-parse");
      const pdfFn = (pdfParse as any).default || pdfParse;
      const result = await pdfFn(buf);
      const cleaned = (result.text || "").replace(/\0/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();
      return cleaned.slice(0, 100000);
    } catch (err: any) {
      console.warn(`[knowledge.ts] Erro ao extrair texto do PDF ${name}:`, err?.message);
      return `[Documento PDF: ${name}]`;
    }
  }

  if (type === "word" || ext === "docx" || ext === "doc") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      return (result.value || "").replace(/\0/g, "").trim().slice(0, 100000);
    } catch (err: any) {
      console.warn(`[knowledge.ts] Erro ao extrair texto do Word ${name}:`, err?.message);
      return `[Documento Word: ${name}]`;
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
      return texts.join("\n\n").trim().slice(0, 100000);
    } catch (err: any) {
      console.warn(`[knowledge.ts] Erro ao extrair planilha ${name}:`, err?.message);
      return `[Planilha: ${name}]`;
    }
  }

  if (type === "txt" || ext === "txt" || ext === "md" || ext === "json") {
    return buf.toString("utf-8").replace(/\0/g, "").trim().slice(0, 100000);
  }

  return "";
}

export const Route = createFileRoute("/api/valentina/knowledge")({

  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Buscar todas as pastas e arquivos da base de conhecimento ─────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "valem";

        try {
          let folders = await db
            .select()
            .from(knowledgeFolders)
            .where(eq(knowledgeFolders.tenantId, tenantId));

          let files = await db
            .select()
            .from(knowledgeFiles)
            .where(eq(knowledgeFiles.tenantId, tenantId));

          // Se for a primeira vez e não houver pastas, cria pasta padrão "Catálogos & Produtos"
          if (folders.length === 0) {
            const defaultFolder = {
              id: "f-1",
              tenantId,
              name: "Catálogos & Produtos",
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
              files: files.map((f) => ({
                id: f.id,
                name: f.name,
                size: f.size,
                type: f.type,
                format: f.format,
                content: f.content,
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
        try {
          const body = await request.json();
          const { tenantId = "valem", action } = body;

          // Action 1: Criar/Editar/Mover Pasta
          if (action === "create_folder" || action === "update_folder" || action === "move_folder") {
            const { id, name, parentId } = body;
            const folderId = id || `f-${Date.now()}`;
            const targetParentId = parentId !== undefined && parentId !== "" ? parentId : null;

            const existing = await db
              .select()
              .from(knowledgeFolders)
              .where(eq(knowledgeFolders.id, folderId));

            if (existing.length > 0) {
              await db
                .update(knowledgeFolders)
                .set({ 
                  name: name || existing[0].name, 
                  parentId: targetParentId 
                })
                .where(eq(knowledgeFolders.id, folderId));
            } else {
              await db.insert(knowledgeFolders).values({
                id: folderId,
                tenantId,
                name: name || "Nova Pasta",
                parentId: targetParentId,
                createdAt: new Date(),
              });
            }

            return new Response(
              JSON.stringify({ success: true, folder: { id: folderId, name, parentId: targetParentId } }),
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
              .where(eq(knowledgeFiles.id, id));

            return new Response(
              JSON.stringify({ success: true, fileId: id, folderId: targetFolderId }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Action 3: Subir Arquivo com Extração Real de Texto
          if (action === "upload_file") {
            const { name, size, type, format, folderId, content, base64 } = body;
            const fileId = `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            // 🛡️ GARANTIA DE INTEGRIDADE: Verificar se a pasta folderId existe no banco de dados
            let validFolderId: string | null = folderId || null;
            if (validFolderId) {
              const [folderCheck] = await db
                .select()
                .from(knowledgeFolders)
                .where(eq(knowledgeFolders.id, validFolderId));

              if (!folderCheck) {
                console.warn(`[knowledge.ts] ⚠️ Pasta "${validFolderId}" não encontrada no banco. Criando pasta automaticamente...`);
                await db.insert(knowledgeFolders).values({
                  id: validFolderId,
                  tenantId,
                  name: "Valentina",
                  parentId: null,
                  createdAt: new Date(),
                }).onConflictDoNothing();
              }
            }

            // Extrai texto real do documento (PDF, DOCX, XLSX, TXT)
            const extractedContent = await extractKnowledgeText(name, type, base64, content);

            await db.insert(knowledgeFiles).values({
              id: fileId,
              tenantId,
              folderId: validFolderId,
              name,
              size: size || "10 KB",
              type: type || "txt",
              format: format || "embeddings",
              content: extractedContent,
              uploadedAt: new Date(),
            });

            return new Response(
              JSON.stringify({
                success: true,
                file: {
                  id: fileId,
                  name,
                  size,
                  type,
                  format,
                  content: extractedContent,
                  uploadedAt: new Date().toLocaleDateString("pt-BR"),
                  folderId: validFolderId,
                },
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

      // ── DELETE: Excluir pasta ou arquivo ────────────────────────────────────
      DELETE: async ({ request }) => {
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
            await db.delete(knowledgeFiles).where(eq(knowledgeFiles.id, id));
          } else if (type === "folder") {
            // Remove pasta e arquivos vinculados
            await db.delete(knowledgeFiles).where(eq(knowledgeFiles.folderId, id));
            await db.delete(knowledgeFolders).where(eq(knowledgeFolders.id, id));
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
