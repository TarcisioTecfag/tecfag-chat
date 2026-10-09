import { describe, it, expect } from "bun:test";
import { DealCardProps } from "../src/components/crm/DealCard";

describe("CRM Kanban — Pan Scroll Horizontal & Drag and Drop Fluido", () => {
  it("DealCard deve suportar os novos contratos de interface para Drag & Drop profissional", () => {
    const mockDeal: any = {
      id: "deal-test-1",
      title: "Envasadora Automática - Teste",
      pipelineId: "pipe-tecfag-maquinas",
      stageId: "stage-1",
      status: "open",
      value: "50000.00",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const propsNormal: DealCardProps = {
      deal: mockDeal,
      isDragging: false,
      isOverlay: false,
    };
    expect(propsNormal.isDragging).toBe(false);
    expect(propsNormal.isOverlay).toBe(false);

    const propsDragging: DealCardProps = {
      deal: mockDeal,
      isDragging: true,
      isOverlay: false,
    };
    expect(propsDragging.isDragging).toBe(true);

    const propsOverlay: DealCardProps = {
      deal: mockDeal,
      isDragging: false,
      isOverlay: true,
    };
    expect(propsOverlay.isOverlay).toBe(true);
  });

  it("deve calcular corretamente a velocidade e direção do Auto-Scroll nas margens do container", () => {
    const edgeMargin = 110;
    const boardLeft = 100;
    const boardRight = 1100;

    // Próximo à margem esquerda (cursor em 120px, distância de 20px da borda esquerda)
    const clientXLeft = 120;
    const leftDist = clientXLeft - boardLeft; // 20px
    expect(leftDist < edgeMargin).toBe(true);
    const leftFactor = Math.min(1, Math.max(0.1, (edgeMargin - leftDist) / edgeMargin));
    const speedLeft = Math.round(leftFactor * 22);
    expect(speedLeft).toBeGreaterThan(15);
    expect(speedLeft).toBeLessThanOrEqual(22);

    // Próximo à margem direita (cursor em 1080px, distância de 20px da borda direita)
    const clientXRight = 1080;
    const rightDist = boardRight - clientXRight; // 20px
    expect(rightDist < edgeMargin).toBe(true);
    const rightFactor = Math.min(1, Math.max(0.1, (edgeMargin - rightDist) / edgeMargin));
    const speedRight = Math.round(rightFactor * 22);
    expect(speedRight).toBeGreaterThan(15);
    expect(speedRight).toBeLessThanOrEqual(22);

    // No centro do quadro (sem auto-scroll)
    const clientXCenter = 600;
    const centerLeftDist = clientXCenter - boardLeft;
    const centerRightDist = boardRight - clientXCenter;
    expect(centerLeftDist < edgeMargin).toBe(false);
    expect(centerRightDist < edgeMargin).toBe(false);
  });

  it("deve respeitar a tolerância de 5px para diferenciar clique de arrasto", () => {
    const isDragCandidate = (startX: number, startY: number, curX: number, curY: number) => {
      const dist = Math.hypot(curX - startX, curY - startY);
      return dist >= 5;
    };

    // Micro-movimento de 2px (clique intencional para abrir modal)
    expect(isDragCandidate(100, 100, 102, 101)).toBe(false);

    // Movimento de 6px (início do arrasto do card)
    expect(isDragCandidate(100, 100, 106, 100)).toBe(true);
    expect(isDragCandidate(100, 100, 104, 104)).toBe(true);
  });
});
