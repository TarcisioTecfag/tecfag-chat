import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(import.meta.dirname, "..");
const requirePackage = createRequire(import.meta.url);

function loadTsModule(relative, overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    new Function("require", "module", "exports", code)(
      (name) => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (name === "node:crypto" || name === "zod" || name === "drizzle-orm") {
          return requirePackage(name);
        }
        if (name.startsWith("@/")) {
          const relTarget = name.slice(2);
          if (Object.hasOwn(overrides, name)) return overrides[name];
          let target = path.resolve(root, "src", relTarget).replace(/\.js$/, ".ts");
          if (!target.endsWith(".ts") && !target.endsWith(".tsx")) target += ".ts";
          return load(target);
        }
        if (name.startsWith(".")) {
          let target = path.resolve(path.dirname(file), name).replace(/\.js$/, ".ts");
          if (!target.endsWith(".ts") && !target.endsWith(".tsx")) target += ".ts";
          return load(target);
        }
        throw new Error(`Unexpected import in onboarding progress test: ${name}`);
      },
      module,
      module.exports,
    );
    return module.exports;
  }
  return load(path.resolve(root, relative));
}

const fakeDbSymbol = {
  db: {},
  operatorOnboarding: {
    id: "id",
    tenantId: "tenant_id",
    operatorId: "operator_id",
    tourKey: "tour_key",
    revision: "revision",
  },
  whatsappConnections: {
    id: "id",
    tenantId: "tenant_id",
    ownerOperatorId: "owner_operator_id",
  },
};

const serviceMod = loadTsModule("src/lib/onboarding/service.ts", {
  "@/db": fakeDbSymbol,
  "../db": fakeDbSymbol,
  "../../db": fakeDbSymbol,
  "../../db/schema": fakeDbSymbol,
  "../access-control/conversation-access": {
    whatsappConnectionAccessCondition: () => ({}),
  },
  "../access-control/channel-permissions": {
    canManageWhatsappConnection: () => false,
  },
  "../whatsapp/connection-policy": {
    multiConnectionEnabled: () => false,
  },
});
const manifestMod = loadTsModule("src/lib/onboarding/manifest.ts");

test("validateOnboardingPatchPayload enforces closed payload and rejects tenantId/operatorId overrides", () => {
  const valid = serviceMod.validateOnboardingPatchPayload({
    action: "start",
    runId: "run_test_123456",
    revision: 0,
    viewport: "desktop",
  });
  assert.equal(valid.ok, true);

  const unknownField = serviceMod.validateOnboardingPatchPayload({
    action: "start",
    runId: "run_test_123456",
    tenantId: "valem",
  });
  assert.equal(unknownField.ok, false);
  assert.equal(unknownField.code, "UNKNOWN_FIELD");

  const operatorOverride = serviceMod.validateOnboardingPatchPayload({
    action: "start",
    runId: "run_test_123456",
    operatorId: "op_other",
  });
  assert.equal(operatorOverride.ok, false);
  assert.equal(operatorOverride.code, "UNKNOWN_FIELD");

  const invalidStep = serviceMod.validateOnboardingPatchPayload({
    action: "checkpoint",
    runId: "run_test_123456",
    stepId: "non.existent.step",
  });
  assert.equal(invalidStep.ok, false);
  assert.equal(invalidStep.code, "INVALID_STEP_ID");
});

test("state machine transitions: start -> checkpoint -> pause -> resume -> defer -> complete -> restart", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  let record = serviceMod.createDefaultOnboardingRecord("tecfag", "op_1", now);
  const eligibleViews = ["commercialHome", "chat"];

  // 1. Start
  const started = serviceMod.applyOnboardingPatchToRecord({
    record,
    payload: {
      action: "start",
      runId: "run_alpha_001",
      revision: 0,
      viewport: "desktop",
    },
    eligibleViews,
    capabilities: { canConfigurePersonalWhatsapp: true },
    now,
  });
  assert.equal(started.ok, true);
  record = started.record;
  assert.equal(record.status, "in_progress");
  assert.equal(record.runId, "run_alpha_001");
  assert.equal(record.revision, 1);

  // 2. Revision conflict check
  const revConflict = serviceMod.applyOnboardingPatchToRecord({
    record,
    payload: {
      action: "checkpoint",
      runId: "run_alpha_001",
      revision: 0,
      stepId: "welcome.start",
    },
    eligibleViews,
    capabilities: { canConfigurePersonalWhatsapp: true },
    now,
  });
  assert.equal(revConflict.ok, false);
  assert.equal(revConflict.status, 409);
  assert.equal(revConflict.code, "REVISION_CONFLICT");

  // 3. RunId conflict check
  const runConflict = serviceMod.applyOnboardingPatchToRecord({
    record,
    payload: {
      action: "checkpoint",
      runId: "run_wrong_999",
      revision: 1,
      stepId: "welcome.start",
    },
    eligibleViews,
    capabilities: { canConfigurePersonalWhatsapp: true },
    now,
  });
  assert.equal(runConflict.ok, false);
  assert.equal(runConflict.status, 409);
  assert.equal(runConflict.code, "RUN_ID_CONFLICT");

  // 4. Pause & Resume
  const paused = serviceMod.applyOnboardingPatchToRecord({
    record,
    payload: {
      action: "pause",
      runId: "run_alpha_001",
      revision: record.revision,
      stepId: "welcome.map",
    },
    eligibleViews,
    capabilities: { canConfigurePersonalWhatsapp: true },
    now,
  });
  assert.equal(paused.ok, true);
  record = paused.record;
  assert.equal(record.status, "paused");

  const resumed = serviceMod.applyOnboardingPatchToRecord({
    record,
    payload: {
      action: "resume",
      runId: "run_alpha_001",
      revision: record.revision,
    },
    eligibleViews,
    capabilities: { canConfigurePersonalWhatsapp: true },
    now,
  });
  assert.equal(resumed.ok, true);
  record = resumed.record;
  assert.equal(record.status, "in_progress");

  // 5. Premature complete is rejected with 422 INCOMPLETE_TOUR_COVERAGE
  const prematureComplete = serviceMod.applyOnboardingPatchToRecord({
    record,
    payload: {
      action: "complete",
      runId: "run_alpha_001",
      revision: record.revision,
    },
    eligibleViews,
    capabilities: { canConfigurePersonalWhatsapp: true },
    now,
  });
  assert.equal(prematureComplete.ok, false);
  assert.equal(prematureComplete.status, 422);
  assert.equal(prematureComplete.code, "INCOMPLETE_TOUR_COVERAGE");

  // 6. Complete all eligible steps for ["commercialHome", "chat"]
  for (const step of manifestMod.ONBOARDING_STEPS) {
    if (!eligibleViews.includes(step.view)) continue;
    if (step.isControlStep) continue;
    const cp = serviceMod.applyOnboardingPatchToRecord({
      record,
      payload: {
        action: "checkpoint",
        runId: "run_alpha_001",
        revision: record.revision,
        stepId: step.id,
        chapterId: step.chapterId,
      },
      eligibleViews,
      capabilities: { canConfigurePersonalWhatsapp: true },
      now,
    });
    assert.equal(cp.ok, true);
    record = cp.record;
  }

  const completed = serviceMod.applyOnboardingPatchToRecord({
    record,
    payload: {
      action: "complete",
      runId: "run_alpha_001",
      revision: record.revision,
    },
    eligibleViews,
    capabilities: { canConfigurePersonalWhatsapp: true },
    now,
  });
  assert.equal(completed.ok, true);
  record = completed.record;
  assert.equal(record.status, "completed");
  assert.equal(record.lastCompletedVersion, 1);
  assert.ok(record.lastCompletedAt instanceof Date);

  // 7. Restart preserves lastCompletedVersion/lastCompletedAt and creates a new run
  const restarted = serviceMod.applyOnboardingPatchToRecord({
    record,
    payload: {
      action: "restart",
      runId: "run_beta_002",
      revision: record.revision,
    },
    eligibleViews,
    capabilities: { canConfigurePersonalWhatsapp: true },
    now,
  });
  assert.equal(restarted.ok, true);
  record = restarted.record;
  assert.equal(record.status, "in_progress");
  assert.equal(record.runId, "run_beta_002");
  assert.equal(record.completedSteps.length, 0);
  assert.equal(record.lastCompletedVersion, 1);
  assert.ok(record.lastCompletedAt instanceof Date);
});

test("API route /api/operators/onboarding enforces requireSession and uses session tenantId/operatorId", async () => {
  let capturedSession = null;
  const routeMod = loadTsModule("src/routes/api/operators/onboarding.ts", {
    "@tanstack/react-router": {
      createFileRoute: () => (spec) => spec,
    },
    "../../../lib/auth-session": {
      requireSession: async (request) => {
        if (request.headers.get("x-unauth") === "1") {
          return {
            response: new Response(JSON.stringify({ error: "Não autenticado" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            }),
          };
        }
        return {
          session: {
            tenantId: "tecfag",
            operator: {
              id: "op_tecfag_1",
              name: "Operador Teste",
              role: "operator",
            },
            permissions: {},
          },
        };
      },
    },
    "../../../lib/onboarding/service": {
      getOperatorOnboardingState: async (session) => {
        capturedSession = session;
        return {
          enabled: true,
          tenantId: session.tenantId,
          operatorId: session.operator.id,
          tourKey: "operator-first-login",
          contentVersion: 1,
          status: "not_started",
          runId: null,
          currentStepId: "welcome.start",
          visitedStepIds: [],
          completedStepIds: [],
          completedChapterIds: [],
          unavailableSteps: [],
          eligibleViews: ["commercialHome", "chat", "crm"],
          eligibleStepIds: [],
          completionPct: 0,
          revision: 0,
          deferredUntil: null,
          startedAt: null,
          pausedAt: null,
          completedAt: null,
          lastCompletedVersion: null,
          lastCompletedAt: null,
          updatedAt: new Date().toISOString(),
        };
      },
      validateOnboardingPatchPayload: serviceMod.validateOnboardingPatchPayload,
      applyOperatorOnboardingAction: async (session, input) => {
        capturedSession = session;
        return {
          ok: true,
          record: {},
          dto: {
            enabled: true,
            status: "in_progress",
            runId: input.runId,
            revision: 1,
          },
        };
      },
    },
  });

  const handlers = routeMod.Route.server.handlers;

  // Unauthenticated -> 401
  const unauthRes = await handlers.GET({
    request: new Request("http://test.local/api/operators/onboarding", {
      headers: { "x-unauth": "1" },
    }),
  });
  assert.equal(unauthRes.status, 401);

  // Authenticated GET -> 200 with Cache-Control: no-store
  const getRes = await handlers.GET({
    request: new Request("http://test.local/api/operators/onboarding"),
  });
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get("Cache-Control"), "no-store");
  assert.equal(capturedSession.tenantId, "tecfag");
  assert.equal(capturedSession.operator.id, "op_tecfag_1");

  // Authenticated PATCH with tenantId in body -> 400 INVALID_PAYLOAD
  const badPatchRes = await handlers.PATCH({
    request: new Request("http://test.local/api/operators/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        runId: "run_123456",
        tenantId: "valem",
      }),
    }),
  });
  assert.equal(badPatchRes.status, 400);
});

test("0049_operator_onboarding.sql migration creates table and unique index idempotently in PGlite", async () => {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE tenants (
      id text PRIMARY KEY
    );
    CREATE TABLE operators (
      id text PRIMARY KEY,
      tenant_id text NOT NULL
    );
  `);

  const migrationSql = fs.readFileSync(
    path.resolve(root, "src/db/migrations/0049_operator_onboarding.sql"),
    "utf8",
  );

  // Execute twice to verify idempotency
  await pg.exec(migrationSql);
  await pg.exec(migrationSql);

  await pg.exec(`
    INSERT INTO tenants (id) VALUES ('tecfag');
    INSERT INTO operators (id, tenant_id) VALUES ('op_1', 'tecfag');
    INSERT INTO operator_onboarding (id, tenant_id, operator_id, tour_key, run_id, status)
    VALUES ('onb_1', 'tecfag', 'op_1', 'operator-first-login', 'run_1', 'in_progress');
  `);

  const rows = await pg.query(
    `SELECT tenant_id, operator_id, tour_key, status, revision FROM operator_onboarding`,
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].tenant_id, "tecfag");
  assert.equal(rows.rows[0].operator_id, "op_1");
  assert.equal(rows.rows[0].status, "in_progress");
  assert.equal(rows.rows[0].revision, 1);

  // Unique constraint on (tenant_id, operator_id, tour_key)
  await assert.rejects(async () => {
    await pg.exec(`
      INSERT INTO operator_onboarding (id, tenant_id, operator_id, tour_key, run_id, status)
      VALUES ('onb_2', 'tecfag', 'op_1', 'operator-first-login', 'run_2', 'completed');
    `);
  });

  await pg.close();
});
