import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (relPath: string) => readFileSync(resolve(root, relPath), "utf8");

describe("Painel de Acompanhamento e Aprovação SDR (Fagner) — Contratos Mobile & Design System", () => {
  it("SdrTab usa fluxo Master-Detail + sub-abas Aprovar & Dados / Conversa em telas compactas (<1024px)", () => {
    const src = read("src/components/valentina/SdrTab.tsx");
    expect(src).toContain("isCompactViewport");
    expect(src).toContain('(max-width: 1023px)');
    expect(src).toContain('mobileStage');
    expect(src).toContain('mobileDetailTab');
    expect(src).toContain('Aprovar & Dados');
    expect(src).toContain('setMobileStage("detail")');
    expect(src).toContain('setMobileDetailTab("approval")');
    expect(src).not.toMatch(/\btitle="/);
    expect(src).not.toMatch(/<select[\s>]/);
  });

  it("SdrKanbanBoard ignora pan de mouse em eventos touch e habilita snap horizontal no mobile", () => {
    const src = read("src/components/valentina/SdrKanbanBoard.tsx");
    expect(src).toContain('e.pointerType !== "mouse"');
    expect(src).toContain("touch-pan-x");
    expect(src).toContain("snap-start");
    expect(src).not.toMatch(/\btitle="/);
  });

  it("SdrHeaderControls usa bottom-sheet seguro no mobile para filtros sem vazar viewport", () => {
    const src = read("src/components/valentina/SdrHeaderControls.tsx");
    expect(src).toContain("fixed inset-x-3 bottom-3");
    expect(src).toContain("sm:absolute sm:inset-auto sm:right-0");
    expect(src).not.toMatch(/\btitle="/);
  });

  it("IndustrialApprovalPanel não aplica margem horizontal excessiva (mx-4) e mantém Design System", () => {
    const src = read("src/components/valentina/IndustrialApprovalPanel.tsx");
    expect(src).not.toContain('className={`mx-4 my-3');
    expect(src).toContain("h-10 sm:h-8.5");
    expect(src).not.toMatch(/\btitle="/);
    expect(src).not.toMatch(/<select[\s>]/);
  });

  it("IndustrialTriageHistory oferece navegação por etapas (1. Leads / 2. Ciclos / 3. Dossiê) no mobile", () => {
    const src = read("src/components/valentina/IndustrialTriageHistory.tsx");
    expect(src).toContain("mobileStep");
    expect(src).toContain("1. Leads");
    expect(src).toContain("2. Ciclos");
    expect(src).toContain("3. Dossiê");
    expect(src).not.toMatch(/\btitle="/);
  });
});
