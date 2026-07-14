import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { agentConfigs } from "../../../db/schema";
import { eq, and } from "drizzle-orm";

// ── Headers CORS padrão ────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/valentina/config")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Buscar configurações dos agentes ──────────────────────────────
      // Query params: tenantId (obrigatório), agentType (opcional — filtra um agente específico)
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const agentType = url.searchParams.get("agentType");

        if (!tenantId) {
          return new Response(
            JSON.stringify({ error: "tenantId é obrigatório" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          let results;

          if (agentType) {
            // Buscar config de um agente específico
            results = await db
              .select()
              .from(agentConfigs)
              .where(
                and(
                  eq(agentConfigs.tenantId, tenantId),
                  eq(agentConfigs.agentType, agentType)
                )
              )
              .limit(1);
          } else {
            // Buscar todas as configs do tenant
            results = await db
              .select()
              .from(agentConfigs)
              .where(eq(agentConfigs.tenantId, tenantId));
          }

          // Se buscou por agentType específico, retorna objeto ou null
          if (agentType) {
            return new Response(
              JSON.stringify(results[0] ?? null),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(JSON.stringify(results), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[valentina/config] Erro ao buscar configs:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── POST: Criar ou atualizar configuração de um agente ─────────────────
      // Body: { id, tenantId, agentType, enabled, config }
      // Usa upsert: se o ID já existe, atualiza; senão, cria.
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { id, tenantId, agentType, enabled, config } = body;

          if (!id || !tenantId || !agentType) {
            return new Response(
              JSON.stringify({ error: "id, tenantId e agentType são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const now = new Date();

          // Verificar se já existe
          const existing = await db
            .select()
            .from(agentConfigs)
            .where(eq(agentConfigs.id, id))
            .limit(1);

          if (existing.length > 0) {
            // Atualizar config existente
            await db
              .update(agentConfigs)
              .set({
                agentType,
                enabled: enabled ?? existing[0].enabled,
                config: config ?? existing[0].config,
                updatedAt: now,
              })
              .where(eq(agentConfigs.id, id));
          } else {
            // Criar nova config
            await db.insert(agentConfigs).values({
              id,
              tenantId,
              agentType,
              enabled: enabled ?? 0,
              config: config ?? {},
              createdAt: now,
              updatedAt: now,
            });
          }

          return new Response(
            JSON.stringify({ success: true, id }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[valentina/config] Erro ao salvar config:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
