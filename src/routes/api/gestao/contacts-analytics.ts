import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  contacts,
  conversations,
  aiConversationAudits
} from "../../../db/schema";
import { eq, and, gte, lte, count } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/contacts-analytics")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.operator.role !== "admin" && session.operator.role !== "supervisor") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem acessar métricas de contatos.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const now = new Date();

          // ── 1. Novos vs Recorrentes por Semana (últimas 4 semanas) ─────────
          const weeks: { name: string; start: Date; end: Date }[] = [];
          for (let i = 3; i >= 0; i--) {
            const start = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
            const end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
            weeks.push({
              name: `Semana ${4 - i}`,
              start,
              end,
            });
          }

          const clientMetrics = await Promise.all(
            weeks.map(async (w) => {
              // Novos contatos criados nessa semana
              const [newRes] = await db
                .select({ count: count() })
                .from(contacts)
                .where(
                  and(
                    eq(contacts.tenantId, tenantId),
                    gte(contacts.createdAt, w.start),
                    lte(contacts.createdAt, w.end)
                  )
                );

              // Conversas de contatos que já existiam antes dessa semana (Recorrentes)
              const [recRes] = await db
                .select({ count: count() })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.tenantId, tenantId),
                    gte(conversations.createdAt, w.start),
                    lte(conversations.createdAt, w.end)
                  )
                );

              const novos = Number(newRes?.count ?? 0);
              const totalConvs = Number(recRes?.count ?? 0);
              const recorrentes = Math.max(0, totalConvs - novos);

              return {
                name: w.name,
                novos,
                recorrentes,
              };
            })
          );

          // ── 2. Cartões Estatísticos ───────────────────────────────────────
          const allFinishedConvs = await db
            .select({
              lastMessageTime: conversations.lastMessageTime,
              contactId: conversations.contactId,
            })
            .from(conversations)
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                eq(conversations.queueState, "finalizados")
              )
            );

          // Tempo médio sem atendimento (dias desde o último atendimento concluído)
          let avgDaysWithoutService = 0;
          if (allFinishedConvs.length > 0) {
            const totalDiffMs = allFinishedConvs.reduce((acc, curr) => {
              const diff = now.getTime() - new Date(curr.lastMessageTime).getTime();
              return acc + diff;
            }, 0);
            avgDaysWithoutService = Math.round(totalDiffMs / allFinishedConvs.length / (1000 * 60 * 60 * 24));
          }

          // Frequência Média (atendimentos por contato/mês)
          const allContactsCount = (
            await db
              .select({ count: count() })
              .from(contacts)
              .where(eq(contacts.tenantId, tenantId))
          )[0]?.count ?? 0;

          const totalConvsCount = (
            await db
              .select({ count: count() })
              .from(conversations)
              .where(eq(conversations.tenantId, tenantId))
          )[0]?.count ?? 0;

          const avgFrequency = Number(allContactsCount) > 0
            ? Number((Number(totalConvsCount) / Number(allContactsCount)).toFixed(1))
            : 0;

          // Taxa de Satisfação/Conversão de Atendimentos IA (CSAT Satisfeitos)
          const audits = await db
            .select({ clientSentiment: aiConversationAudits.clientSentiment })
            .from(aiConversationAudits)
            .where(eq(aiConversationAudits.tenantId, tenantId));

          const satisfiedCount = audits.filter((a) => a.clientSentiment === "satisfeito").length;
          const ragConversionPct = audits.length > 0
            ? Math.round((satisfiedCount / audits.length) * 100)
            : 100;

          return new Response(
            JSON.stringify({
              clientMetrics,
              avgDaysWithoutService,
              avgFrequency,
              ragConversionPct,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[gestao/contacts-analytics] Erro GET:", e);
          return new Response(
            JSON.stringify({
              clientMetrics: [],
              avgDaysWithoutService: 0,
              avgFrequency: 0,
              ragConversionPct: 100,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
