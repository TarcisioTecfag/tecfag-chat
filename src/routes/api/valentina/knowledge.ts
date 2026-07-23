import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { knowledgeFiles, knowledgeFolders } from "../../../db/schema";
import { eq, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

      // ── POST: Criar pasta ou subir novo arquivo ──────────────────────────────
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId = "valem", action } = body;

          // Action 1: Criar/Editar Pasta
          if (action === "create_folder" || action === "update_folder") {
            const { id, name, parentId } = body;
            const folderId = id || `f-${Date.now()}`;

            const existing = await db
              .select()
              .from(knowledgeFolders)
              .where(eq(knowledgeFolders.id, folderId));

            if (existing.length > 0) {
              await db
                .update(knowledgeFolders)
                .set({ name, parentId: parentId || null })
                .where(eq(knowledgeFolders.id, folderId));
            } else {
              await db.insert(knowledgeFolders).values({
                id: folderId,
                tenantId,
                name,
                parentId: parentId || null,
                createdAt: new Date(),
              });
            }

            return new Response(
              JSON.stringify({ success: true, folder: { id: folderId, name, parentId } }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Action 2: Subir Arquivo
          if (action === "upload_file") {
            const { name, size, type, format, folderId, content } = body;
            const fileId = `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            // 🛡️ GARANTIA DE INTEGRIDADE: Verificar se a pasta folderId existe no banco de dados
            let validFolderId: string | null = folderId || null;
            if (validFolderId) {
              const [folderCheck] = await db
                .select()
                .from(knowledgeFolders)
                .where(eq(knowledgeFolders.id, validFolderId));

              if (!folderCheck) {
                console.warn(`[knowledge.ts] ⚠️ Pasta "${validFolderId}" não encontrada no banco. Criando pasta automaticamente para evitar falha de Chave Estrangeira...`);
                // Tenta buscar a pasta padrão f-1
                const [defaultFolder] = await db
                  .select()
                  .from(knowledgeFolders)
                  .where(eq(knowledgeFolders.id, "f-1"));

                if (defaultFolder) {
                  validFolderId = "f-1";
                } else {
                  // Criar a pasta solicitada no banco
                  await db.insert(knowledgeFolders).values({
                    id: validFolderId,
                    tenantId,
                    name: "Valentina",
                    parentId: null,
                    createdAt: new Date(),
                  }).onConflictDoNothing();
                }
              }
            }

            // 🛡️ SANITIZAÇÃO DE CONTEÚDO: Se o arquivo for PDF/binário, sanitiza caracteres nulos que quebram o Postgres
            let safeContent: string | null = content ? String(content) : null;
            if (safeContent && (safeContent.startsWith("%PDF") || type === "pdf")) {
              // Remove caracteres nulos (\x00) e binários incompatíveis com campos text do PostgreSQL
              safeContent = safeContent.replace(/\0/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();
              if (safeContent.length > 100000) {
                safeContent = safeContent.slice(0, 100000);
              }
            }

            await db.insert(knowledgeFiles).values({
              id: fileId,
              tenantId,
              folderId: validFolderId,
              name,
              size: size || "10 KB",
              type: type || "txt",
              format: format || "embeddings",
              content: safeContent,
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
                  content: safeContent,
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
