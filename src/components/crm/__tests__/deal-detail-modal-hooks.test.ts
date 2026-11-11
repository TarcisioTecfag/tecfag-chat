// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

function collectFunctionHooksAfterEarlyReturn(filePath: string): string[] {
  const fullPath = path.join(ROOT, filePath);
  const code = fs.readFileSync(fullPath, "utf8");
  const sf = ts.createSourceFile(fullPath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];

  function checkComponentBody(compName: string, body: ts.Block) {
    let earlyReturnLine: number | null = null;
    for (const stmt of body.statements) {
      if (
        ts.isIfStatement(stmt) &&
        (ts.isReturnStatement(stmt.thenStatement) ||
          (ts.isBlock(stmt.thenStatement) && stmt.thenStatement.statements.some(ts.isReturnStatement)))
      ) {
        if (earlyReturnLine === null) {
          earlyReturnLine = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
        }
      } else if (earlyReturnLine !== null) {
        const text = stmt.getText(sf);
        if (/^(?:const|let|var)\s+.*=\s*(?:React\.)?use[A-Z]\w*\s*[<(]|^(?:React\.)?use[A-Z]\w*\s*[<(]/.test(text.trim())) {
          const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
          violations.push(`${filePath}:${line} (${compName}) calls hook after early return at line ${earlyReturnLine}`);
        }
      }
    }
  }

  ts.forEachChild(sf, function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text) && node.body) {
      checkComponentBody(node.name.text, node.body);
    }
    ts.forEachChild(node, walk);
  });

  return violations;
}

describe("DealDetailModal & MonitorView hook/TDZ safety", () => {
  it("does not declare React hooks after early returns in DealDetailModal or MonitorView", () => {
    expect(collectFunctionHooksAfterEarlyReturn("src/components/crm/DealDetailModal.tsx")).toEqual([]);
    expect(collectFunctionHooksAfterEarlyReturn("src/components/chat/MonitorView.tsx")).toEqual([]);
  });

  it("does not reference lexical bindings inside DealDetailModal hooks before their declaration (TDZ prevention)", () => {
    const filePath = path.join(ROOT, "src/components/crm/DealDetailModal.tsx");
    const code = fs.readFileSync(filePath, "utf8");
    const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const tdzViolations: string[] = [];

    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === "DealDetailModal" && stmt.body) {
        const lexicalDecls = new Map<string, number>();
        for (const s of stmt.body.statements) {
          if (ts.isVariableStatement(s)) {
            for (const d of s.declarationList.declarations) {
              const collect = (name: ts.BindingName) => {
                if (ts.isIdentifier(name)) {
                  lexicalDecls.set(name.text, d.pos);
                } else if (ts.isArrayBindingPattern(name) || ts.isObjectBindingPattern(name)) {
                  for (const el of name.elements) {
                    if (!ts.isOmittedExpression(el)) collect(el.name);
                  }
                }
              };
              collect(d.name);
            }
          }
        }

        for (const s of stmt.body.statements) {
          const text = s.getText(sf).trim();
          const isTopLevelHook =
            /^(?:React\.)?use(Effect|Memo|Callback|LayoutEffect)\b/.test(text) ||
            /^const\s+.*=\s*(?:React\.)?use(Memo|Callback)\b/.test(text);
          if (!isTopLevelHook) continue;

          const visit = (n: ts.Node) => {
            if (ts.isIdentifier(n) && lexicalDecls.has(n.text) && n.pos < lexicalDecls.get(n.text)!) {
              const parent = n.parent;
              const isProperty =
                (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
                (ts.isPropertyAssignment(parent) && parent.name === n);
              if (!isProperty) {
                const refLine = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
                const declLine = sf.getLineAndCharacterOfPosition(lexicalDecls.get(n.text)!).line + 1;
                tdzViolations.push(`line ${refLine} references '${n.text}' before declaration at line ${declLine}`);
              }
            }
            ts.forEachChild(n, visit);
          };
          visit(s);
        }
      }
    }

    expect(tdzViolations).toEqual([]);
  });
});
