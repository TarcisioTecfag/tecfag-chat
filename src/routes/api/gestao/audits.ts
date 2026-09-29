import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { aiConversationAudits, operators } from "../../../db/schema";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import { AuditService } from "../../../lib/audit-service";
import { getComercialOperatorIds } from "../../../lib/gestao-filter";
import { requireSession } from "../../../lib/auth-session";

// Inicia o serviço de auditoria ao carregar esta rota
AuditService.getInstance().start();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/audits")({
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
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem visualizar auditorias.", code: "FORBIDDEN" }),
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

        const date = url.searchParams.get("date");           // 'YYYY-MM-DD', opcional
        const operatorId = url.searchParams.get("operatorId"); // opcional
        const statusParam = url.searchParams.get("status") ?? "done"; // 'done' | 'pending' | 'processing' | 'error' | 'all'
        const includeAll = url.searchParams.get("includeAll") === "true"; // se true, remove filtro de setor Comercial
        const limitParam = url.searchParams.get("limit") ?? "30";
        const limit = Math.min(parseInt(limitParam), 100);

        try {
          // 0. IDs dos operadores do setor Comercial (regra de negócio)
          // Auditorias só são exibidas para operadores do setor Comercial (a não ser que includeAll=true).
          const comercialIds = includeAll ? null : await getComercialOperatorIds(tenantId);

          // Monta filtros dinâmicos
          const filters: any[] = [
            eq(aiConversationAudits.tenantId, tenantId),
          ];

          // Filtro de status — 'all' significa sem restrição de status
          if (statusParam !== "all") {
            filters.push(eq(aiConversationAudits.status, statusParam));
          }

          // Filtro por operador específico (param da URL) tem prioridade
          if (operatorId) {
            filters.push(eq(aiConversationAudits.operatorId, operatorId));
          } else if (comercialIds !== null && comercialIds.length > 0) {
            // Caso contrário, aplica o filtro do setor Comercial
            filters.push(inArray(aiConversationAudits.operatorId, comercialIds));
          }

          if (date) {
            // Filtra auditorias do dia especificado
            const dayStart = new Date(date + "T00:00:00.000Z");
            const dayEnd = new Date(date + "T23:59:59.999Z");
            filters.push(gte(aiConversationAudits.auditedAt, dayStart));
            filters.push(lte(aiConversationAudits.auditedAt, dayEnd));
          }

          const audits = await db
            .select({
              id: aiConversationAudits.id,
              conversationId: aiConversationAudits.conversationId,
              operatorId: aiConversationAudits.operatorId,
              contactName: aiConversationAudits.contactName,
              performanceScore: aiConversationAudits.performanceScore,
              clientSentiment: aiConversationAudits.clientSentiment,
              hadLongResponseGap: aiConversationAudits.hadLongResponseGap,
              hadMissedObjection: aiConversationAudits.hadMissedObjection,
              hadRudeLanguage: aiConversationAudits.hadRudeLanguage,
              hadNoFollowUp: aiConversationAudits.hadNoFollowUp,
              summary: aiConversationAudits.summary,
              strengths: aiConversationAudits.strengths,
              weaknesses: aiConversationAudits.weaknesses,
              actionableInsight: aiConversationAudits.actionableInsight,
              status: aiConversationAudits.status,
              errorMessage: aiConversationAudits.errorMessage,
              auditedAt: aiConversationAudits.auditedAt,
              createdAt: aiConversationAudits.createdAt,
            })
            .from(aiConversationAudits)
            .where(and(...filters))
            // Para status 'done', ordena pela data da auditoria; para outros, pelo createdAt
            .orderBy(desc(statusParam === "done" ? aiConversationAudits.auditedAt : aiConversationAudits.createdAt))
            .limit(limit);

          // Busca nomes dos operadores em batch
          const operatorIds = [...new Set(audits.map((a) => a.operatorId).filter(Boolean))] as string[];
          const operatorMap: Record<string, string> = {};
          if (operatorIds.length > 0) {
            const ops = await db
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(inArray(operators.id, operatorIds));
            ops.forEach((op) => { operatorMap[op.id] = op.name; });
          }

          const result = audits.map((a) => ({
            ...a,
            // operatorId j\u00e1 vem do select — garante que o frontend pode vincular por ID
            operatorId: a.operatorId ?? null,
            operatorName: a.operatorId ? operatorMap[a.operatorId] ?? "Desconhecido" : "Sem operador",
            flagCount: [a.hadLongResponseGap, a.hadMissedObjection, a.hadRudeLanguage, a.hadNoFollowUp]
              .filter(Boolean).length,
          }));

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          const errDetail = { message: e?.message, code: e?.code, detail: e?.detail, cause: e?.cause ? { message: e.cause?.message, code: e.cause?.code } : null };
          console.error("[gestao/audits] ERRO:", JSON.stringify(errDetail));
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      PATCH: async ({ request }) => {
        /**
         * Reseta auditorias com erro de volta para 'pending' para reprocessamento.
         * Body: { auditId?: string, action?: 'retry_all', tenantId?: string }
         * - auditId: reseta uma auditoria específica
         * - action='retry_all': reseta TODAS as auditorias com erro do tenant
         */
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.operator.role !== "admin" && session.operator.role !== "supervisor") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem reprocessar auditorias.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const body = await request.json() as { auditId?: string; action?: string; tenantId?: string };
          const { auditId, action, tenantId: bodyTenantId } = body;

          if (bodyTenantId && bodyTenantId !== tenantId) {
            return new Response(
              JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (action === "retry_all") {
            // Reseta TODAS as auditorias com erro do tenant
            const result = await db
              .update(aiConversationAudits)
              .set({
                status: "pending",
                errorMessage: null,
                auditedAt: null,
              })
              .where(
                and(
                  eq(aiConversationAudits.tenantId, tenantId),
                  eq(aiConversationAudits.status, "error")
                )
              );

            console.log(`[gestao/audits PATCH] retry_all: auditorias resetadas para pending no tenant ${tenantId}`);
            
            // Força o AuditService a processar imediatamente
            AuditService.getInstance().start();

            return new Response(JSON.stringify({ success: true, action: "retry_all" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (auditId) {
            // Reseta uma auditoria específica
            await db
              .update(aiConversationAudits)
              .set({
                status: "pending",
                errorMessage: null,
                auditedAt: null,
              })
              .where(
                and(
                  eq(aiConversationAudits.id, auditId),
                  eq(aiConversationAudits.tenantId, tenantId),
                  eq(aiConversationAudits.status, "error")
                )
              );

            console.log(`[gestao/audits PATCH] Auditoria ${auditId} resetada para pending.`);

            // Força o AuditService a processar imediatamente
            AuditService.getInstance().start();

            return new Response(JSON.stringify({ success: true, auditId }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ error: "Forneça auditId ou action='retry_all'" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        } catch (e: any) {
          console.error("[gestao/audits PATCH] Erro:", e?.message);
          return new Response(JSON.stringify({ error: e?.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
