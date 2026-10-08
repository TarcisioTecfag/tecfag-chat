import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Commercial War Room — Rotação Automática, Headers e Desvinculação de RD", () => {
  const biViewPath = resolve(__dirname, "../src/components/commercial/CommercialBiView.tsx");
  const biViewCode = readFileSync(biViewPath, "utf-8");

  it("garante que TOTAL_SLIDES está definido exatamente como 8", () => {
    expect(biViewCode).toContain("const TOTAL_SLIDES = 8;");
  });

  it("garante que a rotação inicia ATIVA por padrão (rotating = true)", () => {
    expect(biViewCode).toContain("const [rotating, setRotating] = useState(true);");
  });

  it("garante que a rotação calcula módulo circular sobre TOTAL_SLIDES (% TOTAL_SLIDES)", () => {
    expect(biViewCode).toContain("setModule((current) => (current + 1) % TOTAL_SLIDES);");
  });

  it("garante que ChevronLeft e ChevronRight usam TOTAL_SLIDES sem travar rotação", () => {
    expect(biViewCode).toContain("setModule((current) => (current === 0 ? TOTAL_SLIDES - 1 : current - 1));");
    // Não deve conter setRotating(false) no ChevronLeft ou ChevronRight
    expect(biViewCode).not.toMatch(/onClick=\{[^}]*setRotating\(false\)[^}]*TOTAL_SLIDES/);
  });

  it("garante que a tag 'FAGNER I.A - AO VIVO' e 'VALENTINA I.A - AO VIVO' foi removida do header", () => {
    expect(biViewCode).not.toContain("I.A - AO VIVO");
    expect(biViewCode).not.toContain("aiPersonaName");
  });

  it("garante que a tag de status textual 'ROTAÇÃO PAUSADA / ATIVA' foi removida da esquerda do header", () => {
    expect(biViewCode).not.toContain("ROTAÇÃO PAUSADA");
    expect(biViewCode).not.toContain("ROTAÇÃO ATIVA");
  });

  it("garante que o botão Play/Pause dedica a sinalização de status visual (active/paused)", () => {
    expect(biViewCode).toContain("title={rotating ? \"Pausar rotação automática\" : \"Iniciar rotação automática\"}");
    expect(biViewCode).toContain("aria-label={rotating ? \"Pausar rotação\" : \"Iniciar rotação\"}");
  });

  it("garante que a rotação pausa automaticamente quando qualquer modal está aberto", () => {
    expect(biViewCode).toContain("if (!rotating || isAnyModalOpen || !isTabVisible) return;");
  });

  it("garante que todas as menções a 'RD Station' ou 'RD CRM' foram erradicadas do War Room e Gestão Comercial", () => {
    const pipelineViewPath = resolve(__dirname, "../src/components/commercial/CommercialPipelineTableView.tsx");
    const dealModalPath = resolve(__dirname, "../src/components/commercial/CommercialDealFilterModal.tsx");
    const consultantsPath = resolve(__dirname, "../src/components/commercial/CommercialConsultantsView.tsx");
    const calendarPath = resolve(__dirname, "../src/components/commercial/CommercialCalendarView.tsx");

    const pipelineCode = readFileSync(pipelineViewPath, "utf-8");
    const dealModalCode = readFileSync(dealModalPath, "utf-8");
    const consultantsCode = readFileSync(consultantsPath, "utf-8");
    const calendarCode = readFileSync(calendarPath, "utf-8");

    // Header da tabela 1 deve exibir apenas (CRM)
    expect(pipelineCode).toContain("OPORTUNIDADES & PIPELINE POR FASE (CRM)");
    expect(pipelineCode).not.toContain("RD CRM");
    expect(pipelineCode).not.toContain("RD Station");

    // Modal de deals
    expect(dealModalCode).not.toContain("RD Station");
    expect(dealModalCode).not.toContain("RD CRM");

    // Consultores
    expect(consultantsCode).not.toContain("RD Station");
    expect(consultantsCode).not.toContain("RD CRM");
    expect(consultantsCode).not.toContain("Vínculo RD");

    // Calendário
    expect(calendarCode).not.toContain("RD Station");
  });
});
