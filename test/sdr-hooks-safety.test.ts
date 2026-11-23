import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dir, "..");

function walkTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsxFiles(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function isHookCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  if (ts.isIdentifier(expr)) return /^use[A-Z]/.test(expr.text);
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "React"
  ) {
    return /^use[A-Z]/.test(expr.name.text);
  }
  return false;
}

function findHookOrderingViolations(filePath: string): string[] {
  const src = readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];

  function walkAst(node: ts.Node) {
    if (ts.isFunctionLike(node) && node.body && ts.isBlock(node.body)) {
      let seenReturnLine: number | null = null;
      for (const stmt of node.body.statements) {
        let hasReturnInStmt = false;
        function scan(n: ts.Node, insideConditional: boolean) {
          if (ts.isFunctionLike(n)) return;
          if (isHookCall(n)) {
            const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
            if (seenReturnLine !== null) {
              violations.push(
                `${filePath}:${line} hook chamado após return na linha ${seenReturnLine}: ${n.getText(sf).slice(0, 60)}`,
              );
            }
            if (insideConditional) {
              violations.push(
                `${filePath}:${line} hook chamado condicionalmente: ${n.getText(sf).slice(0, 60)}`,
              );
            }
          }
          if (ts.isReturnStatement(n)) hasReturnInStmt = true;
          const nextCond =
            insideConditional ||
            ts.isIfStatement(n) ||
            ts.isConditionalExpression(n) ||
            ts.isForStatement(n) ||
            ts.isForOfStatement(n) ||
            ts.isForInStatement(n) ||
            ts.isWhileStatement(n) ||
            ts.isSwitchStatement(n) ||
            (ts.isBinaryExpression(n) &&
              (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
                n.operatorToken.kind === ts.SyntaxKind.BarBarToken));
          ts.forEachChild(n, (child) => scan(child, nextCond));
        }
        scan(stmt, false);
        if (hasReturnInStmt && seenReturnLine === null) {
          seenReturnLine = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
        }
      }
    }
    ts.forEachChild(node, walkAst);
  }

  walkAst(sf);
  return violations;
}

describe("Módulo I.A / Aba SDR — Proteção contra React Error #300/#310 (Rules of Hooks)", () => {
  it("nenhum componente em src/components/valentina chama hooks após early return ou condicionalmente", () => {
    const files = walkTsxFiles(resolve(root, "src/components/valentina"));
    expect(files.length).toBeGreaterThan(0);

    const allViolations = files.flatMap((file) => findHookOrderingViolations(file));
    expect(allViolations).toEqual([]);
  });

  it("IndustrialApprovalPanel executa selectedSectorOps (useMemo) antes do early return de isAlreadyDone", () => {
    const src = readFileSync(
      resolve(root, "src/components/valentina/IndustrialApprovalPanel.tsx"),
      "utf8",
    );
    const memoIdx = src.indexOf("const selectedSectorOps = useMemo(");
    const earlyReturnIdx = src.indexOf("if (isAlreadyDone) return null;");
    expect(memoIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(memoIdx).toBeLessThan(earlyReturnIdx);
  });
});
