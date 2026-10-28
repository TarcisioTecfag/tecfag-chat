import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "../..");
const packages = createRequire(import.meta.url);
/** Loads real onboarding code; operational imports require explicit isolated overrides. */
export function loadOnboardingSource(relative, overrides = {}) {
  const cache = new Map();
  function read(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    new Function("require", "module", "exports", code)(
      (name) => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (["node:crypto", "react/jsx-runtime"].includes(name)) return packages(name);
        if (name.startsWith(".")) {
          let target = path.resolve(path.dirname(file), name);
          if (!/\.tsx?$/.test(target)) target += ".ts";
          if (target.startsWith(path.join(root, "src/lib/onboarding"))) return read(target);
        }
        throw Error(`Operational import refused: ${name}`);
      },
      module,
      module.exports,
    );
    return module.exports;
  }
  return read(path.join(root, relative));
}
