import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { aiConversationAudits, operators } from "../../../db/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { AuditService } from "../../../lib/audit-service";

// Inicia o serviço de auditoria ao carregar esta rota
AuditService.getInstance().start();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/audits")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const date = url.searchParams.get("date");           // 'YYYY-MM-DD', opcional
        const operatorId = url.searchParams.get("operatorId"); // opcional
        const status = url.searchParams.get("status") ?? "done"; // 'done' | 'pending' | 'error'
        const limitParam = url.searchParams.get("limit") ?? "30";
        const limit = Math.min(parseInt(limitParam), 100);

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // Monta filtros dinâmicos
          const filters: any[] = [
            eq(aiConversationAudits.tenantId, tenantId),
            eq(aiConversationAudits.status, status),
          ];

          if (operatorId) {
            filters.push(eq(aiConversationAudits.operatorId, operatorId));
          }

          if (date) {
            // Filtra auditorias do dia especificado
            filters.push(sql`DATE(${aiConversationAudits.auditedAt}) = ${date}`);
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
              auditedAt: aiConversationAudits.auditedAt,
              createdAt: aiConversationAudits.createdAt,
            })
            .from(aiConversationAudits)
            .where(and(...filters))
            .orderBy(desc(aiConversationAudits.auditedAt))
            .limit(limit);

          // Busca nomes dos operadores em batch
          const operatorIds = [...new Set(audits.map((a) => a.operatorId).filter(Boolean))] as string[];
          const operatorMap: Record<string, string> = {};
          if (operatorIds.length > 0) {
            const ops = await db
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(sql`${operators.id} = ANY(ARRAY[${sql.join(operatorIds.map(id => sql`${id}`), sql`, `)}]::text[])`);
            ops.forEach((op) => { operatorMap[op.id] = op.name; });
          }

          const result = audits.map((a) => ({
            ...a,
            operatorName: a.operatorId ? operatorMap[a.operatorId] ?? "Desconhecido" : "Sem operador",
            flagCount: [a.hadLongResponseGap, a.hadMissedObjection, a.hadRudeLanguage, a.hadNoFollowUp]
              .filter(Boolean).length,
          }));

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[gestao/audits] Erro:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
