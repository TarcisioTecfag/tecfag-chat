/**
 * Health Check endpoint para diagnóstico do módulo de Gestão.
 *
 * GET /api/gestao/health
 *
 * Retorna:
 *  - Conexão com o banco: OK/ERRO
 *  - Status de cada uma das 4 tabelas de gestão (existe/não existe)
 *  - Versão do commit atual (via env RAILWAY_GIT_COMMIT_SHA)
 *  - Timestamp do servidor
 *  - Variáveis de ambiente críticas (sem expor valores)
 */

import { createFileRoute } from "@tanstack/react-router";
import postgres from "postgres";
import { db } from "../../../db";
import { conversations, operators } from "../../../db/schema";
import { count, eq } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MANAGED_TABLES = [
  "response_time_logs",
  "ai_conversation_audits",
  "operator_daily_metrics",
  "ai_reports",
];

export const Route = createFileRoute("/api/gestao/health")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.operator.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores podem acessar o diagnóstico de saúde.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const connectionString =
          process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

        const client = postgres(connectionString, { max: 1, connect_timeout: 10 });

        const result: Record<string, any> = {
          timestamp: new Date().toISOString(),
          tenantId,
          commitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local/desconhecido",
          env: {
            DATABASE_URL: !!process.env.DATABASE_URL,
            GOOGLE_AI_API_KEY: !!process.env.GOOGLE_AI_API_KEY,
            NODE_ENV: process.env.NODE_ENV ?? "unknown",
          },
          db: { connected: false, error: null },
          tables: {} as Record<string, boolean>,
        };

        try {
          // 1. Testa a conexão
          await client`SELECT 1`;
          result.db.connected = true;

          // 2. Verifica cada tabela
          for (const table of MANAGED_TABLES) {
            const rows = await client`
              SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = ${table}
              ) AS exists
            `;
            result.tables[table] = rows[0]?.exists ?? false;
          }

          // 3. Status das tabelas gerenciadas
          const missingTables = MANAGED_TABLES.filter((t) => !result.tables[t]);
          result.missingTables = missingTables;

          // 4. Testa query da tabela conversations para o tenant da sessão
          try {
            const q = await client`select count(*) from conversations where tenant_id = ${tenantId} limit 1`;
            result.queryTest = { conversations: "✓ OK", count: q[0]?.count };
          } catch (qe: any) {
            result.queryTest = {
              conversations: "✗ FALHOU",
              message: qe.message,
              code: qe.code,
            };
          }

          // 5. Lista as colunas da tabela conversations
          try {
            const cols = await client`
              SELECT column_name, data_type
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'conversations'
              ORDER BY ordinal_position
            `;
            result.conversationsColumns = cols.map((c: any) => `${c.column_name}: ${c.data_type}`);
          } catch (ce: any) {
            result.conversationsColumns = `Erro: ${ce.message}`;
          }

          // 6. Testa a query via Drizzle ORM para o tenant da sessão
          try {
            const drizzleResult = await db
              .select({ total: count() })
              .from(conversations)
              .where(eq(conversations.tenantId, tenantId));
            result.drizzleTest = { status: "✓ OK", count: drizzleResult[0]?.total };
          } catch (de: any) {
            result.drizzleTest = {
              status: "✗ FALHOU",
              message: de.message,
              code: de.code,
            };
          }

          // 7. Diagnóstico de operadores do tenant da sessão
          try {
            const ops = await client`SELECT id, name, tenant_id FROM operators WHERE tenant_id = ${tenantId} LIMIT 10`;
            result.operatorsDiag = {
              totalSample: ops.length,
              sample: ops.map((r: any) => ({ id: r.id, name: r.name, tenantId: r.tenant_id })),
            };
          } catch (oe: any) {
            result.operatorsDiag = { error: oe.message };
          }

          // 8. Diagnóstico de conversas por queue_state do tenant da sessão
          try {
            const qStates = await client`
              SELECT queue_state, COUNT(*) as total
              FROM conversations
              WHERE tenant_id = ${tenantId}
              GROUP BY queue_state
              ORDER BY total DESC
            `;
            result.convsByQueueState = qStates.map((r: any) => ({
              state: r.queue_state,
              count: Number(r.total),
            }));
          } catch (qe: any) {
            result.convsByQueueState = { error: qe.message };
          }

          // 9. Teste Drizzle: operadores via Drizzle ORM
          try {
            const drizzleOps = await db
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(eq(operators.tenantId, tenantId));
            result.drizzleOperatorsTest = { status: "✓ OK", count: drizzleOps.length };
          } catch (doe: any) {
            result.drizzleOperatorsTest = {
              status: "✗ FALHOU",
              message: doe.message,
            };
          }
        } catch (e: any) {

          result.db.error = {
            message: e.message,
            code: e.code,
            detail: e.detail,
          };
        } finally {
          await client.end();
        }

        const allTablesOk = MANAGED_TABLES.every((t) => result.tables[t]);
        const status = result.db.connected && allTablesOk ? 200 : 503;

        return new Response(JSON.stringify(result, null, 2), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      },
    },
  },
});
