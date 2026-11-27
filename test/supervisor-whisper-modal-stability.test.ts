// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { resolveWhisperOpenTransition } from "../src/lib/valentina/whisper-modal-state";

const ROOT = process.cwd();

describe("SupervisorWhisperModal form stability inside DealDetailModal", () => {
  it("resets form state only on closed -> open transitions, never while already open", () => {
    // Fechado inicialmente
    let state = resolveWhisperOpenTransition(false, false);
    expect(state).toEqual({ nextWasOpen: false, shouldResetForm: false });

    // Abre o modal: deve inicializar os campos com os defaults
    state = resolveWhisperOpenTransition(state.nextWasOpen, true);
    expect(state).toEqual({ nextWasOpen: true, shouldResetForm: true });

    // Re-renders subsequentes enquanto aberto (ex.: SSE/polling/novo defaultDeal): NÃO deve limpar
    for (let i = 0; i < 10; i++) {
      state = resolveWhisperOpenTransition(state.nextWasOpen, true);
      expect(state).toEqual({ nextWasOpen: true, shouldResetForm: false });
    }

    // Fecha o modal
    state = resolveWhisperOpenTransition(state.nextWasOpen, false);
    expect(state).toEqual({ nextWasOpen: false, shouldResetForm: false });

    // Reabre o modal: volta a inicializar limpo
    state = resolveWhisperOpenTransition(state.nextWasOpen, true);
    expect(state).toEqual({ nextWasOpen: true, shouldResetForm: true });
  });

  it("guards the reset useEffect with resolveWhisperOpenTransition and wasOpenRef in SupervisorWhisperModal", () => {
    const filePath = path.join(ROOT, "src/components/chat/SupervisorWhisperModal.tsx");
    const code = fs.readFileSync(filePath, "utf8");
    const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    let resetEffectFound = false;
    let guardedByTransition = false;

    ts.forEachChild(sf, function walk(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "useEffect"
      ) {
        const bodyText = node.getText(sf);
        if (bodyText.includes('setMessage("")') && bodyText.includes('setTitle("")')) {
          resetEffectFound = true;
          guardedByTransition =
            bodyText.includes("resolveWhisperOpenTransition(wasOpenRef.current, open)") &&
            bodyText.includes("if (!transition.shouldResetForm) return;");
        }
      }
      ts.forEachChild(node, walk);
    });

    expect(resetEffectFound).toBe(true);
    expect(guardedByTransition).toBe(true);
  });

  it("does not pass an inline object literal to defaultDeal in DealDetailModal", () => {
    const filePath = path.join(ROOT, "src/components/crm/DealDetailModal.tsx");
    const code = fs.readFileSync(filePath, "utf8");
    const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    let foundModalJsx = false;
    let hasInlineDefaultDealObject = false;

    ts.forEachChild(sf, function walk(node) {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText(sf) === "SupervisorWhisperModal"
      ) {
        foundModalJsx = true;
        for (const prop of node.attributes.properties) {
          if (ts.isJsxAttribute(prop) && prop.name.getText(sf) === "defaultDeal") {
            if (
              prop.initializer &&
              ts.isJsxExpression(prop.initializer) &&
              prop.initializer.expression &&
              ts.isObjectLiteralExpression(prop.initializer.expression)
            ) {
              hasInlineDefaultDealObject = true;
            }
          }
        }
      }
      ts.forEachChild(node, walk);
    });

    expect(foundModalJsx).toBe(true);
    expect(hasInlineDefaultDealObject).toBe(false);
  });
});
