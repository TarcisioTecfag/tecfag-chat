import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");
const requirePackage = createRequire(import.meta.url);

/** Execute real handlers, refusing operational DB/network imports by default. */
export function loadAccessSource(relative, overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "module", "exports", code)((name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === "node:crypto" || name === "zod") return requirePackage(name);
      if (name.startsWith(".")) {
        let target = path.resolve(path.dirname(file), name).replace(/\.js$/, ".ts");
        if (!path.extname(target)) target += ".ts";
        const rel = path.relative(root, target).replaceAll("\\", "/");
        if (rel === "src/lib/rbac.ts" || rel.startsWith("src/lib/access-control/")) return load(target);
      }
      throw new Error(`Operational import blocked by test harness: ${name}`);
    }, module, module.exports);
    return module.exports;
  }
  return load(path.resolve(root, relative));
}

export const routeStub = { createFileRoute: () => (route) => route };
export function apiRequest(body, method = "POST", url = "http://test.local/api") {
  return new Request(url, { method, ...(body === undefined ? {} : {
    body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }) });
}
