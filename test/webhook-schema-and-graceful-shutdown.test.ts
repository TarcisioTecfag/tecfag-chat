import { describe, expect, it, afterEach } from "bun:test";
import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  executeGracefulShutdown,
  isProcessShuttingDown,
  registerActiveSseCloser,
  registerHttpServerForShutdown,
  registerShutdownTask,
  resetGracefulShutdownForTests,
} from "../src/lib/graceful-shutdown";
import { startPeriodicWorker, stopAllPeriodicWorkers } from "../src/lib/periodic-worker";

describe("Migration 0069 — webhook_subscriptions & webhook_deliveries", () => {
  it("está registrada no runner de deploy e cria as tabelas com idempotência e isolamento multi-tenant", async () => {
    const runnerSource = readFileSync(
      resolve(process.cwd(), "scripts/apply-platform-access-migration.mjs"),
      "utf8",
    );
    expect(runnerSource).toContain("0069_webhook_subscriptions_and_deliveries");
    expect(runnerSource).toContain("0068_mcp_audit_logs");

    const migrationSql = readFileSync(
      resolve(process.cwd(), "src/db/migrations/0069_webhook_subscriptions_and_deliveries.sql"),
      "utf8",
    );

    const pg = new PGlite();
    try {
      await pg.exec(`
        CREATE TABLE tenants (
          id text PRIMARY KEY,
          name text NOT NULL,
          slug text NOT NULL UNIQUE,
          connection_type text NOT NULL,
          created_at timestamp NOT NULL DEFAULT now()
        );
        INSERT INTO tenants (id, name, slug, connection_type) VALUES
          ('valem', 'Valem', 'valem', 'baileys'),
          ('tecfag', 'Tecfag', 'tecfag', 'meta');
      `);

      // Execução idempotente (2x seguidas não deve falhar)
      await pg.exec(migrationSql);
      await pg.exec(migrationSql);

      // Inserção com ID explícito (MCP / API) e sem ID (default gen_random_uuid()::text)
      await pg.query(
        `INSERT INTO webhook_subscriptions (id, tenant_id, name, url, secret, events, is_active)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)`,
        ["sub-tecfag-1", "tecfag", "Hook Tecfag", "https://example.com/tf", "sec-1", JSON.stringify(["message.received"])],
      );
      const autoRow = await pg.query<{ id: string }>(
        `INSERT INTO webhook_subscriptions (tenant_id, name, url, secret, events)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        ["valem", "Hook Valem", "https://example.com/vl", "sec-2", JSON.stringify(["conversation.created"])],
      );
      expect(autoRow.rows[0]?.id).toBeTruthy();

      // Query idêntica à que falhava nos logs de produção (eventos ? $3 + filtro tenant_id)
      const tfSubs = await pg.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM webhook_subscriptions
         WHERE tenant_id = $1 AND is_active = $2 AND events ? $3`,
        ["tecfag", true, "message.received"],
      );
      expect(tfSubs.rows.map((r) => r.id)).toEqual(["sub-tecfag-1"]);

      const vlSubs = await pg.query<{ id: string }>(
        `SELECT id FROM webhook_subscriptions
         WHERE tenant_id = $1 AND is_active = $2 AND events ? $3`,
        ["valem", true, "message.received"],
      );
      expect(vlSubs.rows).toHaveLength(0);
    } finally {
      await pg.close();
    }
  });
});

describe("Graceful Shutdown ordenado (workers -> http -> services -> database)", () => {
  afterEach(() => {
    resetGracefulShutdownForTests();
  });

  it("executa fases em ordem estrita, fecha SSE, drena HTTP em andamento e só depois fecha Postgres", async () => {
    const trace: string[] = [];

    // 1. Worker periódico com ciclo em andamento
    let finishWorkerTick!: () => void;
    let workerStarted!: () => void;
    const workerStartedPromise = new Promise<void>((r) => {
      workerStarted = r;
    });
    startPeriodicWorker(
      "test-shutdown-worker",
      async () => {
        trace.push("worker:tick-start");
        workerStarted();
        await new Promise<void>((r) => {
          finishWorkerTick = r;
        });
        trace.push("worker:tick-done");
      },
      60_000,
    );
    await workerStartedPromise;

    registerShutdownTask("stop-workers", "workers", async () => {
      trace.push("phase:workers");
      setTimeout(() => finishWorkerTick(), 25);
      await stopAllPeriodicWorkers(1_000);
    });

    // 2. SSE ativo registrado
    let sseClosed = false;
    registerActiveSseCloser(() => {
      sseClosed = true;
      trace.push("sse:closed");
    });

    // 3. Servidor HTTP real com requisição em andamento
    let releaseHttpResponse!: () => void;
    let requestArrived!: () => void;
    const requestArrivedPromise = new Promise<void>((r) => {
      requestArrived = r;
    });

    const server = http.createServer((_req, res) => {
      trace.push("http:req-start");
      requestArrived();
      new Promise<void>((r) => {
        releaseHttpResponse = r;
      }).then(() => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        trace.push("http:req-done");
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    registerHttpServerForShutdown(server);

    // 4. Serviço (ex: Baileys / MCP flush) e Database (pool.end)
    registerShutdownTask("baileys-mock", "services", async () => {
      trace.push("phase:services");
    });
    registerShutdownTask("db-pool-mock", "database", async () => {
      trace.push("phase:database");
    });

    // Dispara requisição HTTP em voo antes do SIGTERM
    const inFlightFetch = fetch(`http://127.0.0.1:${port}/test`);
    await requestArrivedPromise;

    // Libera a resposta HTTP após 60ms (durante o drain)
    setTimeout(() => releaseHttpResponse(), 60);

    // Dispara shutdown duas vezes (deve ser idempotente)
    const p1 = executeGracefulShutdown("SIGTERM");
    const p2 = executeGracefulShutdown("SIGTERM");
    expect(isProcessShuttingDown()).toBe(true);
    await Promise.all([p1, p2]);

    const res = await inFlightFetch;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(sseClosed).toBe(true);
    expect(server.listening).toBe(false);

    // Verifica ordem estrita das fases
    const idxWorkers = trace.indexOf("phase:workers");
    const idxWorkerDone = trace.indexOf("worker:tick-done");
    const idxSse = trace.indexOf("sse:closed");
    const idxHttpDone = trace.indexOf("http:req-done");
    const idxServices = trace.indexOf("phase:services");
    const idxDatabase = trace.indexOf("phase:database");

    expect(idxWorkers).toBeGreaterThanOrEqual(0);
    expect(idxWorkerDone).toBeGreaterThan(idxWorkers);
    expect(idxSse).toBeGreaterThan(idxWorkerDone);
    expect(idxHttpDone).toBeGreaterThan(idxSse);
    expect(idxServices).toBeGreaterThan(idxHttpDone);
    expect(idxDatabase).toBeGreaterThan(idxServices);
  });

  it("não trava o shutdown se uma task ficar pendurada além do timeout", async () => {
    const order: string[] = [];
    registerShutdownTask("hung-service", "services", () => new Promise<void>(() => {}));
    registerShutdownTask("db-close", "database", () => {
      order.push("database-closed");
    });

    const start = Date.now();
    await executeGracefulShutdown("SIGTERM", {
      phaseTimeoutsMs: { services: 120, database: 500 },
      totalTimeoutMs: 2_000,
    });
    const elapsed = Date.now() - start;

    expect(order).toEqual(["database-closed"]);
    expect(elapsed).toBeLessThan(1_500);
  });
});
