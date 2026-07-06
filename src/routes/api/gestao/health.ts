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
import { conversations } from "../../../db/schema";
import { count, eq } from "drizzle-orm";

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

      GET: async () => {
        const connectionString =
          process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

        const client = postgres(connectionString, { max: 1, connect_timeout: 10 });

        const result: Record<string, any> = {
          timestamp: new Date().toISOString(),
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

          // 3. Se alguma tabela está faltando, tenta criá-las agora
          const missingTables = MANAGED_TABLES.filter((t) => !result.tables[t]);
          if (missingTables.length > 0) {
            result.autoCreateAttempt = `Tentando criar: ${missingTables.join(", ")}`;
            try {
              await client.unsafe(`
                CREATE TABLE IF NOT EXISTS response_time_logs (
                  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
                  operator_id TEXT, contact_id TEXT, client_message_id TEXT NOT NULL,
                  client_message_at TIMESTAMP NOT NULL, agent_response_id TEXT,
                  agent_response_at TIMESTAMP, response_time_seconds INTEGER,
                  is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
                  overdue_threshold_seconds INTEGER NOT NULL DEFAULT 900,
                  created_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS ai_conversation_audits (
                  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
                  operator_id TEXT, contact_name TEXT, status TEXT NOT NULL DEFAULT 'pending',
                  performance_score INTEGER, client_sentiment TEXT,
                  had_long_response_gap BOOLEAN DEFAULT FALSE,
                  had_missed_objection BOOLEAN DEFAULT FALSE,
                  had_rude_language BOOLEAN DEFAULT FALSE,
                  had_no_follow_up BOOLEAN DEFAULT FALSE,
                  summary TEXT, strengths TEXT, weaknesses TEXT,
                  actionable_insight TEXT, raw_ai_response JSONB,
                  error_message TEXT, audited_at TIMESTAMP,
                  created_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS operator_daily_metrics (
                  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
                  operator_id TEXT NOT NULL, operator_name TEXT NOT NULL,
                  date TEXT NOT NULL, total_conversations INTEGER NOT NULL DEFAULT 0,
                  avg_response_time_seconds INTEGER, avg_performance_score INTEGER,
                  overdue_count INTEGER NOT NULL DEFAULT 0,
                  satisfied_count INTEGER NOT NULL DEFAULT 0,
                  neutral_count INTEGER NOT NULL DEFAULT 0,
                  frustrated_count INTEGER NOT NULL DEFAULT 0,
                  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS ai_reports (
                  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, report_type TEXT NOT NULL,
                  period_start TIMESTAMP NOT NULL, period_end TIMESTAMP NOT NULL,
                  content TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
              `);
              result.autoCreateResult = "✓ Tabelas criadas com sucesso nesta request!";

              // Verifica de novo
              for (const table of MANAGED_TABLES) {
                const rows = await client`
                  SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = ${table}
                  ) AS exists
                `;
                result.tables[table] = rows[0]?.exists ?? false;
              }
            } catch (createErr: any) {
              result.autoCreateResult = `✗ Erro ao criar tabelas: ${createErr.message}`;
            }
          }
          // 4. Testa a query exata que está falhando em overview.ts
          try {
            await client`select count(*) from conversations where tenant_id = 'valem' limit 1`;
            result.queryTest = { conversations: "✓ OK" };
          } catch (qe: any) {
            result.queryTest = {
              conversations: "✗ FALHOU",
              message: qe.message,
              code: qe.code,
              detail: qe.detail,
              severity: qe.severity,
              routine: qe.routine,
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

          // 6. Testa a query via Drizzle ORM (mesmo db usado por overview.ts)
          try {
            const drizzleResult = await db
              .select({ total: count() })
              .from(conversations)
              .where(eq(conversations.tenantId, "valem"));
            result.drizzleTest = { status: "✓ OK", count: drizzleResult[0]?.total };
          } catch (de: any) {
            result.drizzleTest = {
              status: "✗ FALHOU",
              message: de.message,
              code: de.code,
              cause: de.cause ? {
                message: de.cause?.message,
                code: de.cause?.code,
                detail: de.cause?.detail,
                severity: de.cause?.severity,
              } : null,
            };
          }

          // 7. Diagnóstico de operadores — mostra tenant_ids distintos para entender o problema
          try {
            const opsAll = await client`SELECT id, name, tenant_id FROM operators LIMIT 10`;
            const tenantIds = await client`SELECT DISTINCT tenant_id FROM operators`;
            result.operatorsDiag = {
              totalSample: opsAll.length,
              tenantIds: tenantIds.map((r: any) => r.tenant_id),
              sample: opsAll.map((r: any) => ({ id: r.id, name: r.name, tenantId: r.tenant_id })),
            };
          } catch (oe: any) {
            result.operatorsDiag = { error: oe.message };
          }

          // 8. Diagnóstico de conversas por queue_state — revela se tudo está em finalizados
          try {
            const qStates = await client`
              SELECT queue_state, COUNT(*) as total
              FROM conversations
              WHERE tenant_id = 'valem'
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

          // 9. Teste Drizzle: operadores via Drizzle ORM (verifica se a query falha)
          try {
            const { operators: opsTable } = await import("../../../db/schema");
            const { eq: dEq } = await import("drizzle-orm");
            const drizzleOps = await db
              .select({ id: opsTable.id, name: opsTable.name })
              .from(opsTable)
              .where(dEq(opsTable.tenantId, "valem"));
            result.drizzleOperatorsTest = { status: "✓ OK", count: drizzleOps.length };
          } catch (doe: any) {
            result.drizzleOperatorsTest = {
              status: "✗ FALHOU",
              message: doe.message,
              cause: doe.cause?.message,
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
