#!/usr/bin/env bun
/**
 * CLI de migração completa do histórico "Fagner Site" (legado) -> Valem Chat (`tenant: tecfag`).
 *
 * Uso seguro (somente leitura por padrão):
 *   LEGACY_DATABASE_URL="postgres://..." TARGET_DATABASE_URL="postgres://..." \
 *     bun scripts/migrate-legacy-fagner-site.ts --dry-run --report=migration-report.json
 *
 * Execução real (após revisar o relatório do --dry-run e aplicar a migração 0067):
 *   LEGACY_DATABASE_URL="postgres://..." TARGET_DATABASE_URL="postgres://..." \
 *     bun scripts/migrate-legacy-fagner-site.ts --apply --tenant=tecfag --report=migration-applied.json
 */
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import {
  runLegacyFagnerSiteMigration,
  type SqlExecutor,
} from "../src/lib/livechat/legacy-fagner-site-migration";

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eqIdx = raw.indexOf("=");
    if (eqIdx === -1) {
      args.set(raw.slice(2), true);
    } else {
      args.set(raw.slice(2, eqIdx), raw.slice(eqIdx + 1));
    }
  }
  const apply = args.get("apply") === true;
  const dryRun = !apply;
  const tenantId = String(args.get("tenant") || "tecfag").trim();
  const batchSize = Number(args.get("batch-size") || 500);
  const reportPath = typeof args.get("report") === "string" ? String(args.get("report")) : null;
  const includeConversations = args.get("skip-conversations") !== true;
  return { dryRun, tenantId, batchSize, reportPath, includeConversations };
}

function createPostgresExecutor(connectionString: string): {
  executor: SqlExecutor;
  close: () => Promise<void>;
} {
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  const sql = postgres(connectionString, {
    max: 4,
    prepare: false,
    ssl: isLocal ? false : "require",
  });
  return {
    executor: {
      async query<T = Record<string, any>>(text: string, params: unknown[] = []) {
        const rows = (await sql.unsafe(text, params as any[])) as unknown as T[];
        return { rows };
      },
    },
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const legacyUrl = process.env.LEGACY_DATABASE_URL?.trim();
  const targetUrl = (process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || "").trim();

  if (!legacyUrl) {
    console.error("[migrate-legacy-site] ❌ Defina LEGACY_DATABASE_URL apontando para o PostgreSQL legado.");
    process.exit(1);
  }
  if (!targetUrl) {
    console.error("[migrate-legacy-site] ❌ Defina TARGET_DATABASE_URL (ou DATABASE_URL) apontando para o Valem Chat.");
    process.exit(1);
  }
  if (legacyUrl === targetUrl) {
    console.error("[migrate-legacy-site] ❌ LEGACY_DATABASE_URL e TARGET_DATABASE_URL não podem apontar para o mesmo banco.");
    process.exit(1);
  }

  console.log(
    `[migrate-legacy-site] Iniciando em modo ${opts.dryRun ? "DRY-RUN (somente leitura)" : "APPLY (escrita)"} para tenant="${opts.tenantId}"...`,
  );

  const legacy = createPostgresExecutor(legacyUrl);
  const target = createPostgresExecutor(targetUrl);

  try {
    // Em modo APPLY, verifica se o índice 0067 já permite múltiplas sessões conv-lc-*
    if (!opts.dryRun && opts.includeConversations) {
      const idxCheck = await target.executor.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_conversations_tenant_contact_uniq'`,
      );
      const def = idxCheck.rows[0]?.indexdef || "";
      if (def && !def.includes("conv-lc-")) {
        console.error(
          "[migrate-legacy-site] ❌ O índice idx_conversations_tenant_contact_uniq ainda não foi atualizado pela migração 0067.",
        );
        console.error("   Execute primeiro `npm run db:migrate:platform` no Valem Chat antes do --apply.");
        process.exit(1);
      }
    }

    const report = await runLegacyFagnerSiteMigration(legacy.executor, target.executor, {
      tenantId: opts.tenantId,
      dryRun: opts.dryRun,
      batchSize: opts.batchSize,
      includeConversations: opts.includeConversations,
      onProgress: (stage, detail) => {
        console.log(`[migrate-legacy-site:${stage}] ${detail}`);
      },
    });

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`RELATÓRIO DE MIGRAÇÃO FAGNER SITE (${report.dryRun ? "DRY-RUN" : "APLICADO"})`);
    console.log("═══════════════════════════════════════════════════════════");
    console.log(JSON.stringify(report, null, 2));

    if (opts.reportPath) {
      writeFileSync(opts.reportPath, JSON.stringify(report, null, 2), "utf8");
      console.log(`\n[migrate-legacy-site] 📄 Relatório salvo em: ${opts.reportPath}`);
    }
  } finally {
    await Promise.allSettled([legacy.close(), target.close()]);
  }
}

main().catch((err) => {
  console.error("[migrate-legacy-site] ❌ Erro fatal:", err);
  process.exit(1);
});
