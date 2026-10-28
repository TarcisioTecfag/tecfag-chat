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
        if (name === "react") {
          return { useState: () => [null, () => {}], useEffect: () => {} };
        }
        if (name === "@tanstack/react-router") {
          return { useNavigate: () => () => {}, useLocation: () => ({ pathname: "/", search: "" }) };
        }
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
        throw new Error(`Unexpected import in onboarding test: ${name}`);
      },
      module,
      module.exports,
    );
    return module.exports;
  }
  return load(path.resolve(root, relative));
}

const typesMod = loadTsModule("src/lib/onboarding/types.ts");
const manifestMod = loadTsModule("src/lib/onboarding/manifest.ts");
const policyMod = loadTsModule("src/lib/onboarding/policy.ts");
const appRoutesMod = loadTsModule("src/lib/app-routes.ts");

test("manifest has 8 chapters, 232 steps, unique orders and valid data-tour selectors", () => {
  assert.equal(typesMod.OPERATOR_TOUR_KEY, "operator-first-login");
  assert.equal(typesMod.ONBOARDING_TOUR_VERSION, 2);
  assert.equal(manifestMod.ONBOARDING_CHAPTERS.length, 8);
  assert.equal(manifestMod.ONBOARDING_STEPS.length, 232);
  assert.ok(manifestMod.ONBOARDING_SELECTORS.length >= 229);

  const seenIds = new Set();
  const seenOrders = new Set();
  for (const step of manifestMod.ONBOARDING_STEPS) {
    assert.ok(!seenIds.has(step.id), `Duplicate step id: ${step.id}`);
    seenIds.add(step.id);

    assert.ok(!seenOrders.has(step.order), `Duplicate step order: ${step.order}`);
    seenOrders.add(step.order);

    assert.match(step.targetSelector, /^\[data-tour="[a-z0-9._-]+"\]$/i);
    assert.ok(step.title && step.title.trim().length > 3, `Missing title on ${step.id}`);
    assert.ok(step.body && step.body.trim().length > 10, `Missing body on ${step.id}`);
    assert.ok(step.ctaLabel && step.ctaLabel.trim().length > 0, `Missing CTA on ${step.id}`);
    assert.ok(Array.isArray(step.functionalIds) && step.functionalIds.length > 0);
  }
});

test("manifest strictly targets primary operator views and never references forbidden secondary views", () => {
  const primarySet = new Set(typesMod.PRIMARY_OPERATOR_VIEWS);
  const forbiddenSet = new Set(typesMod.FORBIDDEN_SECONDARY_VIEWS);

  for (const step of manifestMod.ONBOARDING_STEPS) {
    assert.ok(
      primarySet.has(step.view),
      `Step ${step.id} uses non-primary view: ${step.view}`,
    );
    assert.ok(
      !forbiddenSet.has(step.view),
      `Step ${step.id} uses forbidden secondary view: ${step.view}`,
    );
  }
});

test("manifest excludes proposals, technical questionnaires, and emails", () => {
  assert.deepEqual(typesMod.EXCLUDED_TOUR_FEATURES, [
    "proposals",
    "questionnaires",
    "emails",
  ]);

  const forbiddenPatterns = [
    /\bproposta(s)?\s+comercia(l|is)\b/i,
    /\bquestion[aá]rio(s)?\s+t[eé]cnico(s)?\b/i,
    /\bdisparo\s+de\s+e-?mail\b/i,
  ];

  for (const step of manifestMod.ONBOARDING_STEPS) {
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(step.id, pattern);
      assert.doesNotMatch(step.title, pattern);
      assert.doesNotMatch(step.body, pattern);
      assert.doesNotMatch(step.targetSelector, pattern);
    }
  }
});

test("manifest covers 100% of the inventoried functional IDs (exercised + 8 non-exercised)", () => {
  assert.equal(manifestMod.ALL_INVENTORIED_FUNCTIONAL_IDS.length, 137);

  const nonExercisedIds = Object.keys(manifestMod.NON_EXERCISED_FUNCTIONAL_IDS);
  assert.deepEqual(nonExercisedIds.sort(), ["H12", "M05", "P05", "W01", "W02", "W03", "W04", "W05"]);

  const exercisedSet = new Set();
  for (const step of manifestMod.ONBOARDING_STEPS) {
    for (const fid of step.functionalIds) {
      exercisedSet.add(fid);
    }
  }

  for (const fid of manifestMod.ALL_INVENTORIED_FUNCTIONAL_IDS) {
    const isExercised = exercisedSet.has(fid);
    const isJustifiedNonExercised = Object.hasOwn(
      manifestMod.NON_EXERCISED_FUNCTIONAL_IDS,
      fid,
    );
    assert.ok(
      isExercised || isJustifiedNonExercised,
      `Functional ID ${fid} is neither exercised nor justified in NON_EXERCISED_FUNCTIONAL_IDS`,
    );
  }
});

test("rollout policy defaults to tecfag only, leaving valem unaffected, and sanitizes views", () => {
  assert.equal(policyMod.isOnboardingEnabledForTenant("tecfag", undefined), true);
  assert.equal(policyMod.isOnboardingEnabledForTenant("valem", undefined), false);
  assert.equal(policyMod.isOnboardingEnabledForTenant("valem", "tecfag,valem"), true);

  const eligibleViews = policyMod.resolveEligiblePrimaryViews([
    "commercialHome",
    "chat",
    "settings",
    "commercialManagement",
    "valentina",
  ]);
  assert.deepEqual(eligibleViews, ["commercialHome", "chat"]);

  assert.equal(policyMod.sanitizeTourActiveView("settings"), "commercialHome");
  assert.equal(policyMod.sanitizeTourActiveView("valentina"), "commercialHome");
  assert.equal(policyMod.sanitizeTourActiveView("crm"), "crm");
});

test("app-routes contacts tab spec maps livechat and site bidirectionally", () => {
  const parsedLivechat = appRoutesMod.parseAppRoute("/contatos/livechat");
  assert.equal(parsedLivechat.viewId, "contacts");
  assert.equal(parsedLivechat.tabId, "livechat");

  const parsedSite = appRoutesMod.parseAppRoute("/contatos/site");
  assert.equal(parsedSite.viewId, "contacts");
  assert.equal(parsedSite.tabId, "livechat");

  const built = appRoutesMod.buildAppRoutePath("contacts", { tabId: "livechat" });
  assert.equal(built, "/clientes/site");
});
