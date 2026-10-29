import { createFileRoute } from "@tanstack/react-router";
import { recordCrmAction } from "../../lib/crm/action-history";
import { db } from "../../db/index.js";
import { sectors } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { requireSession } from "../../lib/auth-session.js";
import { handleConditionalResponse } from "../../lib/http-cache.js";
import {
  resolveSectorCopilotConfig,
  getDefaultSectorCopilotConfig,
} from "../../lib/valentina/sector-copilot-config.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

let sectorCopilotColumnsReady = false;
async function ensureSectorCopilotColumns() {
  if (sectorCopilotColumnsReady) return;
  try {
    await db.execute(sql`
      ALTER TABLE sectors
        ADD COLUMN IF NOT EXISTS copilot_welcome_message text,
        ADD COLUMN IF NOT EXISTS copilot_suggestions jsonb DEFAULT '[]'::jsonb;
    `);
    sectorCopilotColumnsReady = true;
  } catch (err) {
    console.warn("[sectors] Aviso ao garantir colunas do copiloto em sectors:", err);
  }
}

export const Route = createFileRoute("/api/sectors")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (request.method !== "GET" && session.operator.role !== "admin") return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });

        try {
          await ensureSectorCopilotColumns();
          const list = await db
            .select()
            .from(sectors)
            .where(eq(sectors.tenantId, tenantId));

          const enrichedList = await Promise.all(
            list.map(async (row) => {
              const resolved = resolveSectorCopilotConfig(row, tenantId);
              const needsBackfill =
                !row.copilotWelcomeMessage ||
                !row.copilotWelcomeMessage.trim() ||
                !Array.isArray(row.copilotSuggestions) ||
                row.copilotSuggestions.length === 0;

              if (needsBackfill) {
                try {
                  await db
                    .update(sectors)
                    .set({
                      copilotWelcomeMessage: resolved.welcomeMessage,
                      copilotSuggestions: resolved.suggestions,
                    })
                    .where(and(eq(sectors.id, row.id), eq(sectors.tenantId, tenantId)));
                } catch {}
              }

              return {
                ...row,
                copilotWelcomeMessage: resolved.welcomeMessage,
                copilotSuggestions: resolved.suggestions,
              };
            })
          );

          return handleConditionalResponse(request, enrichedList, { headers: corsHeaders });
        } catch (e: any) {
          console.error("[GET /api/sectors] Erro ao listar setores do DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const canManageSectors =
            session.operator.role === "admin" ||
            session.operator.groupId === "group-admin" ||
            Boolean(session.permissions?.security?.canManageSectors) ||
            Boolean(session.permissions?.security?.canManageUsers);
          if (!canManageSectors) {
            return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
          }

          await ensureSectorCopilotColumns();
          const body = await request.json().catch(() => ({}));
          const { id, name, operatorIds, copilotWelcomeMessage, copilotSuggestions } = body;

          if (!id || !name) {
            return new Response(JSON.stringify({ error: "id e name são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const existing = await db.query.sectors.findFirst({
            where: and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)),
          });

          const defaults = getDefaultSectorCopilotConfig(name, tenantId);
          const sanitizedSuggestions = Array.isArray(copilotSuggestions)
            ? copilotSuggestions
                .map((s: unknown) => (typeof s === "string" ? s.trim() : ""))
                .filter((s: string) => s.length > 0)
            : undefined;

          if (existing) {
            // Verificar que o recurso pertence ao tenant da sessão antes de atualizar
            if (existing.tenantId !== tenantId) {
              return new Response(
                JSON.stringify({ error: "Setor não encontrado neste tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            const nextWelcome =
              typeof copilotWelcomeMessage === "string"
                ? copilotWelcomeMessage.trim() || defaults.welcomeMessage
                : existing.copilotWelcomeMessage || defaults.welcomeMessage;

            const nextSuggestions =
              sanitizedSuggestions !== undefined
                ? sanitizedSuggestions.length > 0
                  ? sanitizedSuggestions
                  : defaults.suggestions
                : Array.isArray(existing.copilotSuggestions) && existing.copilotSuggestions.length > 0
                ? existing.copilotSuggestions
                : defaults.suggestions;

            await db
              .update(sectors)
              .set({
                name,
                operatorIds: operatorIds ?? existing.operatorIds,
                copilotWelcomeMessage: nextWelcome,
                copilotSuggestions: nextSuggestions,
              })
              .where(and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)));
          } else {
            const initWelcome =
              typeof copilotWelcomeMessage === "string" && copilotWelcomeMessage.trim()
                ? copilotWelcomeMessage.trim()
                : defaults.welcomeMessage;
            const initSuggestions =
              sanitizedSuggestions && sanitizedSuggestions.length > 0
                ? sanitizedSuggestions
                : defaults.suggestions;

            await db.insert(sectors).values({
              id,
              tenantId,
              name,
              operatorIds: operatorIds || [],
              copilotWelcomeMessage: initWelcome,
              copilotSuggestions: initSuggestions,
              createdAt: new Date(),
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/sectors] Erro ao criar/atualizar setor no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      DELETE: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response; // retorna 401 automaticamente
        const { session } = auth;
        const tenantId = session.tenantId;
        const canManageSectors =
          session.operator.role === "admin" ||
          session.operator.groupId === "group-admin" ||
          Boolean(session.permissions?.security?.canManageSectors) ||
          Boolean(session.permissions?.security?.canManageUsers);
        if (!canManageSectors) {
          return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
        }

        const url = new URL(request.url);
        const id = url.searchParams.get("id");

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // Verificar que o recurso pertence ao tenant da sessão antes de deletar
          const existing = await db.query.sectors.findFirst({
            where: and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)),
          });

          if (!existing) {
            return new Response(
              JSON.stringify({ error: "Setor não encontrado.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await db
            .delete(sectors)
            .where(and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)));
          await recordCrmAction({ tenantId, operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_sector", entityType: "sector", itemCount: 1, details: { id, name: existing.name } });

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[DELETE /api/sectors] Erro ao excluir setor no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
