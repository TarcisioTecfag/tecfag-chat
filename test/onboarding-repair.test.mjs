import { before, beforeEach, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { loadOnboardingSource as load } from "./helpers/onboarding-harness.mjs";
const noop = () => {};

const manifest = load("src/lib/onboarding/manifest.ts"),
  policy = load("src/lib/onboarding/policy.ts"),
  targets = load("src/lib/onboarding/frame-targets.ts"),
  runtime = load("src/lib/onboarding/demo-runtime.ts", {
    "@/lib/ai-persona": { getAiPersona: () => ({ name: "Assistente teste" }) },
  }),
  registry = load("src/lib/onboarding/registry.ts");

describe("contrato de alvos das telas reais (não certifica prática visual)", () => {
  for (const step of manifest.ONBOARDING_STEPS) {
    it(step.id, () => {
      assert.ok(targets.TRAINING_TARGETS[step.id] || targets.PARENT_TRAINING_TARGETS[step.id], "Etapa sem alvo explícito");
    });
  }
  it("unknown command fails instead of fabricating feedback", () =>
    assert.throws(() =>
      runtime.applyTourCommandToDemoState(runtime.createInitialDemoRuntimeState("tecfag"), {
        name: "not-implemented",
      }),
    ));
  it("wrong run, async rejection and unregister never acknowledge execution", async () => {
    const adapters = new registry.OnboardingSurfaceRegistry(),
      scope = { tenantId: "tecfag", operatorId: "test-op", runId: "run", surface: "chat.main" };
    adapters.register({
      ...scope,
      onCommand: async () => {
        throw Error("injected");
      },
    });
    assert.equal(await adapters.dispatch(scope, { name: "setDemoQueue" }), false);
    assert.equal(
      await adapters.dispatch({ ...scope, runId: "other" }, { name: "setDemoQueue" }),
      false,
    );
  });
});

function callback(name, bindings) {
  const text = fs.readFileSync(
    new URL("../src/components/onboarding/OnboardingProvider.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "provider.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
      expression = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const code = ts.transpileModule(`exports.fn = ${expression.getText(ast)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", ...Object.keys(bindings), code)(exports, ...Object.values(bindings));
  return exports.fn;
}
describe("provider real: conclusao exige pratica e persistencia", () => {
  it("Next cannot complete an interactive step without its run receipt", async () => {
    const step = manifest.ONBOARDING_STEPS.find((s) => s.id === "crm.new-deal-core"),
      calls = [];
    const bindings = {
      currentStep: step,
      currentStepIndex: 0,
      applicableSteps: [step, manifest.ONBOARDING_STEPS[1]],
      progressRef: { current: { runId: "run" } },
      readyRef: { current: null },
      toast: { info: () => calls.push("blocked"), error: noop },
      targetNotFoundReason: null,
      sendPatch: async (input) => {
        calls.push(input);
        return {};
      },
      resetExercise: noop,
      setIsCompletionOpen: noop,
    };
    await callback("nextStep", bindings)();
    assert.deepEqual(calls, ["blocked"]);
    calls.length = 0;
    bindings.readyRef.current = JSON.stringify(["other-run", step.id]);
    await callback("nextStep", bindings)();
    assert.deepEqual(calls, ["blocked"]);
    calls.length = 0;
    bindings.readyRef.current = JSON.stringify(["run", step.id]);
    await callback("nextStep", bindings)();
    assert.deepEqual(calls[0].completedStepIds, [step.id]);
  });
  it("jumping to another chapter does not complete the abandoned exercise", async () => {
    const calls = [],
      step = manifest.ONBOARDING_STEPS.find((s) => s.id === "crm.new-deal-core");
    await callback("goToStep", {
      applicableSteps: [step],
      sendPatch: async (input) => {
        calls.push(input);
        return {};
      },
      resetExercise: noop,
      setIsRunnerActive: noop,
    })(step.id);
    assert.equal(calls[0].completedStepIds, undefined);
    assert.deepEqual(calls[0].visitedStepIds, [step.id]);
  });
  it("409 reconciles state and cannot be treated as a successful mutation", async () => {
    const identity = "session",
      states = [],
      readyRef = { current: "receipt" };
    const result = await callback("sendPatch", {
      savingRef: { current: false },
      progressRef: { current: { revision: 4, runId: "run" } },
      identityRef: { current: identity },
      identity,
      setIsSaving: noop,
      fetch: async (_, init) => {
        assert.equal(JSON.parse(init.body).revision, 4);
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: "conflict", state: { revision: 5 } }),
        };
      },
      updateProgress: (state) => states.push(state),
      readyRef,
      setReadyInteraction: noop,
      toast: { error: noop },
    })({ action: "checkpoint" });
    assert.equal(result, null);
    assert.equal(states[0].revision, 5);
    assert.equal(readyRef.current, null);
  });
});

const schema = load("src/db/schema.ts", { "drizzle-orm": orm, "drizzle-orm/pg-core": pg });
let client,
  db,
  service,
  multi = false;
const session = (tenantId = "tecfag", operatorId = "test-op") => ({
  tenantId,
  operator: { id: operatorId, role: "agent", name: "Teste" },
  accessGroup: { allowedChannels: ["whatsapp"] },
  permissions: {
    views: { chat: true, crm: true },
    chat: {},
    crm: { canViewCrm: true, canCreateDeals: false },
  },
});
before(async () => {
  client = new PGlite();
  db = drizzle(client);
  await client.exec("SET TIME ZONE 'UTC'");
  for (const table of [
    schema.operatorOnboarding,
    schema.commercialConsultantProfiles,
    schema.whatsappConnections,
  ]) {
    const c = pg.getTableConfig(table);
    await client.exec(
      `CREATE TABLE "${c.name}" (${c.columns.map((column) => `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`).join(",")})`,
    );
  }
  await client.exec(
    "CREATE UNIQUE INDEX test_onboarding_identity ON operator_onboarding(tenant_id,operator_id,tour_key)",
  );
  service = load("src/lib/onboarding/service.ts", {
    "../../db": { db },
    "../../db/schema": schema,
    "drizzle-orm": orm,
    "../access-control/conversation-access": {
      whatsappConnectionAccessCondition: () => orm.sql`true`,
    },
    "../access-control/channel-permissions": { canManageWhatsappConnection: () => false },
    "../whatsapp/connection-policy": { multiConnectionEnabled: () => multi },
  });
});
beforeEach(async () => {
  if (client) {
    await client.exec(
      "TRUNCATE operator_onboarding, commercial_consultant_profiles, whatsapp_connections",
    );
    multi = false;
  }
});
after(async () => {
  await client?.close();
});
describe("servico real: acesso, concorrencia e versao", () => {
  it("missing capabilities fail closed and do not invent consultant or pairing", async () => {
    const ctx = await service.resolveSessionEligibilityContext(session());
    assert.equal(ctx.canPairPersonalWhatsapp, false);
    assert.equal(ctx.hasPersonalWhatsappConnection, false);
    assert.equal(ctx.isCommercialConsultant, false);
    const eligible = manifest.ONBOARDING_STEPS.filter(
      (step) => policy.evaluateStepEligibility(step, ctx).eligible,
    );
    assert.ok(eligible.length > 0);
    assert.equal(
      eligible.filter((step) => step.chapterId === "home").length,
      0,
      "An operator without a consultant profile must not be trapped by the 19 Home lessons",
    );
    assert.equal(
      policy.computeOnboardingCoverage(
        ctx,
        eligible.map((step) => step.id),
      ).canComplete,
      true,
      "Completing the operator's actual lessons must be sufficient to finish",
    );
    await client.query(
      "INSERT INTO commercial_consultant_profiles(id,tenant_id,operator_id,division) VALUES ('consultant','tecfag','test-op','maquinas')",
    );
    assert.equal(
      (await service.resolveSessionEligibilityContext(session())).isCommercialConsultant,
      true,
    );
  });
  it("pairing requires enabled owned connection, respects provider and tenant", async () => {
    multi = true;
    await client.query(
      "INSERT INTO whatsapp_connections(id,tenant_id,owner_operator_id,provider,enabled) VALUES ('other','tecfag','other-op','baileys',true),('foreign','other-tenant','test-op','baileys',true),('disabled','tecfag','test-op','baileys',false)",
    );
    assert.equal(
      (await service.resolveSessionEligibilityContext(session())).canPairPersonalWhatsapp,
      false,
    );
    await client.query(
      "INSERT INTO whatsapp_connections(id,tenant_id,owner_operator_id,provider,enabled) VALUES ('own','tecfag','test-op','baileys',true)",
    );
    assert.equal(
      (await service.resolveSessionEligibilityContext(session())).canPairPersonalWhatsapp,
      true,
    );
  });
  it("all mutations require the current revision and run, including restart", async () => {
    const started = await service.applyOperatorOnboardingAction(session(), {
      action: "start",
      revision: 0,
    });
    assert.equal(started.ok, true);
    for (const action of [
      "checkpoint",
      "pause",
      "resume",
      "defer",
      "start",
      "restart",
      "complete",
    ]) {
      const missing = await service.applyOperatorOnboardingAction(session(), { action });
      assert.equal(missing.status, 409, action);
      const wrongRun = await service.applyOperatorOnboardingAction(session(), {
        action,
        revision: started.dto.revision,
        runId: "wrong",
      });
      assert.equal(wrongRun.status, 409, action);
    }
    const next = await service.applyOperatorOnboardingAction(session(), {
      action: "checkpoint",
      revision: started.dto.revision,
      runId: started.dto.runId,
      currentStepId: "welcome.map",
    });
    assert.equal(next.ok, true);
    assert.equal(
      (
        await service.applyOperatorOnboardingAction(session(), {
          action: "checkpoint",
          revision: started.dto.revision,
          runId: started.dto.runId,
        })
      ).status,
      409,
    );
  });
  it("simultaneous first start never overwrites another run", async () => {
    const outcomes = await Promise.all([
      service.applyOperatorOnboardingAction(session(), {
        action: "start",
        revision: 0,
        runId: "a",
      }),
      service.applyOperatorOnboardingAction(session(), {
        action: "start",
        revision: 0,
        runId: "b",
      }),
    ]);
    assert.equal(outcomes.filter((o) => o.ok).length, 1);
    assert.equal(outcomes.find((o) => !o.ok).status, 409);
    assert.equal((await db.select().from(schema.operatorOnboarding)).length, 1);
  });
  it("another operator and disabled tenant cannot read or mutate existing progress", async () => {
    await service.applyOperatorOnboardingAction(session(), {
      action: "start",
      revision: 0,
      runId: "run",
    });
    const other = await service.getOperatorOnboardingState(session("tecfag", "other-op"));
    assert.equal(other.revision, 0);
    const disabled = await service.getOperatorOnboardingState(session("valem"));
    assert.equal(disabled.enabled, false);
    await service.applyOperatorOnboardingAction(session("valem"), { action: "start" });
    assert.equal((await db.select().from(schema.operatorOnboarding)).length, 1);
  });
  it("old false completion is not reused by corrected content", async () => {
    const record = service.createDefaultOnboardingRecord("tecfag", "test-op");
    record.contentVersion = 1;
    record.status = "completed";
    record.lastCompletedVersion = 1;
    record.completedStepIds = manifest.ONBOARDING_STEPS.map((s) => s.id);
    const dto = service.buildOnboardingProgressDto(
      record,
      await service.resolveSessionEligibilityContext(session()),
    );
    assert.equal(dto.status, "not_started");
    assert.deepEqual(dto.completedStepIds, []);
    assert.equal(dto.lastCompletedVersion, 1);
  });
  it("complete_chapter validates chapter and never completes missing exercises", async () => {
    assert.equal(
      service.validateOnboardingPatchPayload({ action: "complete_chapter", chapterId: "crm" }).ok,
      true,
    );
    assert.equal(
      service.validateOnboardingPatchPayload({ action: "complete_chapter", chapterId: "unknown" })
        .ok,
      false,
    );
    const first = await service.applyOperatorOnboardingAction(session(), {
      action: "start",
      revision: 0,
    });
    const attempt = await service.applyOperatorOnboardingAction(session(), {
      action: "complete_chapter",
      chapterId: "crm",
      revision: first.dto.revision,
      runId: first.dto.runId,
    });
    assert.equal(attempt.status, 422);
  });
  it("arbitrary unavailable reasons cannot certify applicable unfinished exercises", () => {
    const ctx = {
      tenantId: "tecfag",
      operatorId: "test-op",
      permissions: { views: { crm: true }, crm: { canViewCrm: true } },
    };
    const all = manifest.ONBOARDING_STEPS.map((s) => ({
      stepId: s.id,
      reason: "anything",
      recordedAt: new Date().toISOString(),
    }));
    assert.equal(policy.computeOnboardingCoverage(ctx, [], all).canComplete, false);
  });
});
