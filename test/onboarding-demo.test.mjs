import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

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
        if (name === "node:crypto" || name === "zod") return requirePackage(name);
        if (name.startsWith("@/")) {
          let target = path.resolve(root, "src", name.slice(2)).replace(/\.js$/, ".ts");
          if (!target.endsWith(".ts") && !target.endsWith(".tsx")) target += ".ts";
          return load(target);
        }
        if (name.startsWith(".")) {
          let target = path.resolve(path.dirname(file), name).replace(/\.js$/, ".ts");
          if (!target.endsWith(".ts") && !target.endsWith(".tsx")) target += ".ts";
          return load(target);
        }
        throw new Error(`Unexpected import in onboarding demo test: ${name}`);
      },
      module,
      module.exports,
    );
    return module.exports;
  }
  return load(path.resolve(root, relative));
}

const fixturesMod = loadTsModule("src/lib/onboarding/fixtures.ts");
const demoRuntimeMod = loadTsModule("src/lib/onboarding/demo-runtime.ts");
const registryMod = loadTsModule("src/lib/onboarding/registry.ts");
const manifestMod = loadTsModule("src/lib/onboarding/manifest.ts");

test("all demo fixtures use demo:* identifiers and include all 5 Fagner technical source states", () => {
  for (const conv of fixturesMod.DEMO_CONVERSATIONS) {
    assert.equal(demoRuntimeMod.isDemoIdentifier(conv.id), true);
  }
  for (const deal of fixturesMod.DEMO_DEALS) {
    assert.equal(demoRuntimeMod.isDemoIdentifier(deal.id), true);
  }
  for (const task of fixturesMod.DEMO_TASKS) {
    assert.equal(demoRuntimeMod.isDemoIdentifier(task.id), true);
  }
  for (const contact of fixturesMod.DEMO_CONTACTS) {
    assert.equal(demoRuntimeMod.isDemoIdentifier(contact.id), true);
  }
  for (const account of fixturesMod.DEMO_ACCOUNTS) {
    assert.equal(demoRuntimeMod.isDemoIdentifier(account.id), true);
  }
  for (const client of fixturesMod.DEMO_WALLET_CLIENTS) {
    assert.equal(demoRuntimeMod.isDemoIdentifier(client.id), true);
  }

  const stateKeys = Object.keys(fixturesMod.DEMO_FAGNER_TECHNICAL_STATES).sort();
  assert.deepEqual(stateKeys, [
    "catalog_only",
    "honest_unknown",
    "operational_or_chat",
    "unverified_technical",
    "verified",
  ]);
});

test("every step demoCommand in ONBOARDING_STEPS runs purely in memory without side effects", () => {
  let state = demoRuntimeMod.createInitialDemoRuntimeState();
  for (const step of manifestMod.ONBOARDING_STEPS) {
    if (!step.demoCommand) continue;
    state = demoRuntimeMod.applyTourCommandToDemoState(state, step.demoCommand);
    assert.ok(state.lastSimulatedNote.length > 0);
  }

  // Verify specific simulations updated in-memory state as expected
  assert.equal(state.fagnerDirectivePinned, true);
  assert.equal(state.profileSavedBanner, true);
});

test("applyTourCommandToDemoState exercises all 5 Fagner technical states and WhatsApp pairing sandbox", () => {
  let state = demoRuntimeMod.createInitialDemoRuntimeState();

  for (const sourceState of [
    "verified",
    "catalog_only",
    "honest_unknown",
    "unverified_technical",
    "operational_or_chat",
  ]) {
    state = demoRuntimeMod.applyTourCommandToDemoState(state, {
      surface: "chatWindow",
      type: "simulateFagnerTechnicalSource",
      payload: { sourceState },
    });
    assert.equal(state.activeFagnerTechnicalState, sourceState);
  }

  state = demoRuntimeMod.applyTourCommandToDemoState(state, {
    surface: "personalWhatsappDialog",
    type: "simulateWhatsappPair",
    payload: { mode: "qr" },
  });
  assert.equal(state.personalWhatsappConnection.status, "qr_ready");
  assert.ok(state.personalWhatsappConnection.qrPreview);

  state = demoRuntimeMod.applyTourCommandToDemoState(state, {
    surface: "personalWhatsappDialog",
    type: "simulateWhatsappPair",
    payload: { mode: "code" },
  });
  assert.equal(state.personalWhatsappConnection.status, "pairing_code_ready");
  assert.equal(state.personalWhatsappConnection.pairingCodePreview, "TFG9-4821");

  state = demoRuntimeMod.applyTourCommandToDemoState(state, {
    surface: "personalWhatsappDialog",
    type: "simulateWhatsappStatus",
    payload: { status: "connected" },
  });
  assert.equal(state.personalWhatsappConnection.status, "connected");
});

test("OnboardingSurfaceRegistry strictly isolates adapters by tenantId, operatorId, runId, and surface", () => {
  const registry = new registryMod.OnboardingSurfaceRegistry();
  const calls = [];

  const unregisterTecfag = registry.register(
    {
      tenantId: "tecfag",
      operatorId: "op_1",
      runId: "run_100",
      surface: "chatList",
    },
    {
      onCommand: (cmd) => {
        calls.push({ tenant: "tecfag", cmd: cmd.type });
      },
    },
  );

  registry.register(
    {
      tenantId: "valem",
      operatorId: "op_1",
      runId: "run_100",
      surface: "chatList",
    },
    {
      onCommand: (cmd) => {
        calls.push({ tenant: "valem", cmd: cmd.type });
      },
    },
  );

  // Dispatch to tecfag only
  const dispatched = registry.dispatch(
    {
      tenantId: "tecfag",
      operatorId: "op_1",
      runId: "run_100",
    },
    {
      surface: "chatList",
      type: "selectChannelFilter",
      payload: { channel: "whatsapp" },
    },
  );

  assert.equal(dispatched, true);
  assert.deepEqual(calls, [{ tenant: "tecfag", cmd: "selectChannelFilter" }]);

  // Dispatch with different runId should not hit run_100
  const wrongRun = registry.dispatch(
    {
      tenantId: "tecfag",
      operatorId: "op_1",
      runId: "run_999",
    },
    {
      surface: "chatList",
      type: "selectChannelFilter",
    },
  );
  assert.equal(wrongRun, false);

  unregisterTecfag();
  assert.equal(
    registry.hasSurface({
      tenantId: "tecfag",
      operatorId: "op_1",
      runId: "run_100",
      surface: "chatList",
    }),
    false,
  );
});
