import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { agentConfigs } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

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
      // Escopo estrito: tenantId vem exclusivamente da sessão autenticada
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const agentType = url.searchParams.get("agentType");

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
      // Apenas administradores do tenant autenticado podem alterar
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        if (session.operator.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores podem alterar configurações.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;

        try {
          const body = await request.json();
          const { id, agentType, enabled, config } = body;

          if (!id || !agentType) {
            return new Response(
              JSON.stringify({ error: "id e agentType são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const now = new Date();

          // Verificar se já existe dentro do tenant
          const existing = await db
            .select()
            .from(agentConfigs)
            .where(
              and(
                eq(agentConfigs.id, id),
                eq(agentConfigs.tenantId, tenantId)
              )
            )
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
              .where(
                and(
                  eq(agentConfigs.id, id),
                  eq(agentConfigs.tenantId, tenantId)
                )
              );
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
