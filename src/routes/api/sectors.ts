import { createFileRoute } from "@tanstack/react-router";
import { recordCrmAction } from "../../lib/crm/action-history";
import { db } from "../../db/index.js";
import {
  sectors,
  operators,
} from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { requireSession } from "../../lib/auth-session.js";
import { SessionManager } from "../../lib/baileys/session-manager.js";
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

/**
 * Higieniza e repara automaticamente os setores do tenant:
 * 1. Remove IDs de operadores órfãos/excluídos/legados (ex.: op-tf-*) que não existem mais na tabela `operators` do tenant.
 * 2. Deduplica IDs repetidos dentro do mesmo setor.
 */
export async function sanitizeAndRepairTenantSectors(tenantId: string) {
  const [rawSectors, tenantOperators] = await Promise.all([
    db.select().from(sectors).where(eq(sectors.tenantId, tenantId)),
    db.select({ id: operators.id }).from(operators).where(eq(operators.tenantId, tenantId)),
  ]);

  const validOpIds = new Set(tenantOperators.map((op) => op.id));

  // Passo 1: Limpar IDs inexistentes (operadores já excluídos) e deduplicar dentro de cada setor
  const workingSectors = rawSectors.map((sec) => {
    const rawIds = Array.isArray(sec.operatorIds) ? sec.operatorIds : [];
    const cleanIds = Array.from(
      new Set(
        rawIds.filter((id): id is string => typeof id === "string" && validOpIds.has(id)),
      ),
    );
    return {
      row: sec,
      cleanIds,
    };
  });

  // Passo 2: Persistir alterações no banco e enriquecer config do Copiloto
  const enrichedList = await Promise.all(
    workingSectors.map(async ({ row, cleanIds }) => {
      const resolved = resolveSectorCopilotConfig(row, tenantId);
      const needsCopilotBackfill =
        !row.copilotWelcomeMessage ||
        !row.copilotWelcomeMessage.trim() ||
        !Array.isArray(row.copilotSuggestions) ||
        row.copilotSuggestions.length === 0;

      const origIds = Array.isArray(row.operatorIds) ? row.operatorIds : [];
      const idsChanged =
        origIds.length !== cleanIds.length ||
        origIds.some((id, idx) => id !== cleanIds[idx]);

      if (needsCopilotBackfill || idsChanged) {
        try {
          await db
            .update(sectors)
            .set({
              operatorIds: cleanIds,
              copilotWelcomeMessage: resolved.welcomeMessage,
              copilotSuggestions: resolved.suggestions,
            })
            .where(and(eq(sectors.id, row.id), eq(sectors.tenantId, tenantId)));
        } catch (err) {
          console.warn("[sectors] Aviso ao atualizar setor higienizado:", err);
        }
      }

      return {
        ...row,
        operatorIds: cleanIds,
        copilotWelcomeMessage: resolved.welcomeMessage,
        copilotSuggestions: resolved.suggestions,
      };
    }),
  );

  return enrichedList;
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
          const enrichedList = await sanitizeAndRepairTenantSectors(tenantId);

          return new Response(JSON.stringify(enrichedList), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
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

          // Ação atômica para definir o setor único de um operador (remove dos demais setores automaticamente)
          if (body?.action === "set_operator_sectors") {
            const operatorId = typeof body.operatorId === "string" ? body.operatorId.trim() : "";
            const rawSectorIds: string[] = Array.isArray(body.sectorIds)
              ? body.sectorIds.filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
              : [];
            // Cada operador pertence a no máximo 1 setor; se múltiplos forem enviados, usa o último selecionado
            const targetSectorId = rawSectorIds.length > 0 ? rawSectorIds[rawSectorIds.length - 1] : null;

            if (!operatorId) {
              return new Response(JSON.stringify({ error: "operatorId é obrigatório" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const targetOp = await db.query.operators.findFirst({
              where: and(eq(operators.id, operatorId), eq(operators.tenantId, tenantId)),
            });
            if (!targetOp) {
              return new Response(JSON.stringify({ error: "Operador não encontrado neste tenant." }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const [tenantSectors, tenantOperators] = await Promise.all([
              db.select().from(sectors).where(eq(sectors.tenantId, tenantId)),
              db.select({ id: operators.id }).from(operators).where(eq(operators.tenantId, tenantId)),
            ]);
            const validOpIds = new Set(tenantOperators.map((o) => o.id));

            for (const sec of tenantSectors) {
              const currentClean = Array.from(
                new Set(
                  (Array.isArray(sec.operatorIds) ? sec.operatorIds : []).filter(
                    (id): id is string => typeof id === "string" && validOpIds.has(id),
                  ),
                ),
              );
              const shouldInclude = sec.id === targetSectorId;
              const nextIds = shouldInclude
                ? currentClean.includes(operatorId)
                  ? currentClean
                  : [...currentClean, operatorId]
                : currentClean.filter((id) => id !== operatorId);

              const origIds = Array.isArray(sec.operatorIds) ? sec.operatorIds : [];
              const changed =
                origIds.length !== nextIds.length ||
                origIds.some((id, idx) => id !== nextIds[idx]);
              if (changed) {
                await db
                  .update(sectors)
                  .set({ operatorIds: nextIds })
                  .where(and(eq(sectors.id, sec.id), eq(sectors.tenantId, tenantId)));
              }
            }

            const updatedList = await sanitizeAndRepairTenantSectors(tenantId);
            SessionManager.getInstance().notifyPublic(tenantId, { type: "sectors_updated" });

            return new Response(
              JSON.stringify({
                success: true,
                sectors: updatedList,
              }),
              {
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                  "Cache-Control": "no-store",
                },
              },
            );
          }

          const { id, name, operatorIds, copilotWelcomeMessage, copilotSuggestions } = body;

          if (!id || !name) {
            return new Response(JSON.stringify({ error: "id e name são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const [existing, tenantOperators] = await Promise.all([
            db.query.sectors.findFirst({
              where: and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)),
            }),
            db.select({ id: operators.id }).from(operators).where(eq(operators.tenantId, tenantId)),
          ]);
          const validOpIds = new Set(tenantOperators.map((o) => o.id));

          const sanitizedOperatorIds = Array.isArray(operatorIds)
            ? Array.from(
                new Set(
                  operatorIds.filter(
                    (opId: unknown): opId is string =>
                      typeof opId === "string" && validOpIds.has(opId),
                  ),
                ),
              )
            : undefined;

          const defaults = getDefaultSectorCopilotConfig(name, tenantId);
          const sanitizedSuggestions = Array.isArray(copilotSuggestions)
            ? copilotSuggestions
                .map((s: unknown) => (typeof s === "string" ? s.trim() : ""))
                .filter((s: string) => s.length > 0)
            : undefined;

          let finalOperatorIds: string[] = [];
          let newlyAddedOpIds: string[] = [];

          if (existing) {
            // Verificar que o recurso pertence ao tenant da sessão antes de atualizar
            if (existing.tenantId !== tenantId) {
              return new Response(
                JSON.stringify({ error: "Setor não encontrado neste tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            const existingCleanIds = Array.from(
              new Set(
                (Array.isArray(existing.operatorIds) ? existing.operatorIds : []).filter(
                  (opId): opId is string => typeof opId === "string" && validOpIds.has(opId),
                ),
              ),
            );
            const existingSet = new Set(existingCleanIds);
            finalOperatorIds = sanitizedOperatorIds ?? existingCleanIds;
            if (sanitizedOperatorIds !== undefined) {
              newlyAddedOpIds = sanitizedOperatorIds.filter((opId) => !existingSet.has(opId));
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
                operatorIds: finalOperatorIds,
                copilotWelcomeMessage: nextWelcome,
                copilotSuggestions: nextSuggestions,
              })
              .where(and(eq(sectors.id, id), eq(sectors.tenantId, tenantId)));
          } else {
            finalOperatorIds = sanitizedOperatorIds || [];
            newlyAddedOpIds = [...finalOperatorIds];
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
              operatorIds: finalOperatorIds,
              copilotWelcomeMessage: initWelcome,
              copilotSuggestions: initSuggestions,
              createdAt: new Date(),
            });
          }

          // Exclusividade 1-setor-por-operador: operadores recém-adicionados neste setor são removidos dos demais setores
          if (newlyAddedOpIds.length > 0) {
            const assignedSet = new Set(newlyAddedOpIds);
            const otherSectors = await db
              .select()
              .from(sectors)
              .where(eq(sectors.tenantId, tenantId));

            for (const other of otherSectors) {
              if (other.id === id) continue;
              const rawOtherIds = Array.isArray(other.operatorIds) ? other.operatorIds : [];
              const filteredOtherIds = Array.from(
                new Set(
                  rawOtherIds.filter(
                    (opId): opId is string =>
                      typeof opId === "string" && validOpIds.has(opId) && !assignedSet.has(opId),
                  ),
                ),
              );
              const changed =
                rawOtherIds.length !== filteredOtherIds.length ||
                rawOtherIds.some((opId, idx) => opId !== filteredOtherIds[idx]);
              if (changed) {
                await db
                  .update(sectors)
                  .set({ operatorIds: filteredOtherIds })
                  .where(and(eq(sectors.id, other.id), eq(sectors.tenantId, tenantId)));
              }
            }
          }

          const updatedList = await sanitizeAndRepairTenantSectors(tenantId);
          const updatedSector = updatedList.find((s) => s.id === id) || null;
          SessionManager.getInstance().notifyPublic(tenantId, { type: "sectors_updated" });

          return new Response(
            JSON.stringify({
              success: true,
              sector: updatedSector,
              sectors: updatedList,
            }),
            {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              },
            },
          );
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
          SessionManager.getInstance().notifyPublic(tenantId, { type: "sectors_updated" });

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
