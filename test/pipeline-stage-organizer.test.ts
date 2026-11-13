import { describe, expect, test } from "bun:test";
import {
  computeEdgeAutoScrollStep,
  reorderByIndex,
  resolveDefaultStageMigrationTarget,
  resolveHorizontalDropIndex,
  type OrganizablePipeline,
} from "../src/lib/crm/pipeline-stage-organizer";

describe("pipeline-stage-organizer", () => {
  test("reorderByIndex move etapa para esquerda/direita e reindexa orderIndex contiguamente", () => {
    const stages = [
      { id: "s1", name: "Leads Recebidos", orderIndex: 0 },
      { id: "s2", name: "Abordagem Comercial", orderIndex: 1 },
      { id: "s3", name: "Esfriando", orderIndex: 2 },
      { id: "s4", name: "Qualificado", orderIndex: 3 },
      { id: "s5", name: "Fechamento", orderIndex: 4 },
    ];

    const movedForward = reorderByIndex(stages, 0, 3);
    expect(movedForward.map((s) => s.id)).toEqual(["s2", "s3", "s4", "s1", "s5"]);
    expect(movedForward.map((s) => s.orderIndex)).toEqual([0, 1, 2, 3, 4]);

    const movedBackward = reorderByIndex(stages, 4, 1);
    expect(movedBackward.map((s) => s.id)).toEqual(["s1", "s5", "s2", "s3", "s4"]);
    expect(movedBackward.map((s) => s.orderIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  test("resolveHorizontalDropIndex calcula corretamente a posição alvo com base no ponto médio dos cards", () => {
    const rects = [
      { left: 0, width: 200 },   // mid = 100
      { left: 212, width: 200 }, // mid = 312
      { left: 424, width: 200 }, // mid = 524
      { left: 636, width: 200 }, // mid = 736
    ];

    expect(resolveHorizontalDropIndex(50, rects)).toBe(0);
    expect(resolveHorizontalDropIndex(150, rects)).toBe(1);
    expect(resolveHorizontalDropIndex(320, rects)).toBe(2);
    expect(resolveHorizontalDropIndex(740, rects)).toBe(3);
    expect(resolveHorizontalDropIndex(1200, rects)).toBe(3);
  });

  test("computeEdgeAutoScrollStep ativa rolagem horizontal proporcional nas bordas esquerda e direita", () => {
    // Centro do container: sem rolagem
    expect(computeEdgeAutoScrollStep(500, 100, 1100, 80, 16)).toBe(0);

    // Próximo da borda esquerda (110 está a 10px de 100 -> negativo = rolar p/ esquerda)
    const leftStep = computeEdgeAutoScrollStep(110, 100, 1100, 80, 16);
    expect(leftStep).toBeLessThan(0);

    // Próximo da borda direita (1090 está a 10px de 1100 -> positivo = rolar p/ direita)
    const rightStep = computeEdgeAutoScrollStep(1090, 100, 1100, 80, 16);
    expect(rightStep).toBeGreaterThan(0);
  });

  test("resolveDefaultStageMigrationTarget prioriza etapa adjacente no mesmo funil e faz fallback para outro funil", () => {
    const pipelines: OrganizablePipeline[] = [
      {
        id: "p-maq",
        name: "FUNIL MÁQUINAS",
        orderIndex: 0,
        stages: [
          { id: "m1", name: "LEADS RECEBIDOS", orderIndex: 0, dealsCount: 10 },
          { id: "m2", name: "ABORDAGEM", orderIndex: 1, dealsCount: 25 },
          { id: "m3", name: "ESFRIANDO", orderIndex: 2, dealsCount: 8 },
          { id: "m4", name: "FECHAMENTO", orderIndex: 3, dealsCount: 4 },
        ],
      },
      {
        id: "p-pers",
        name: "FUNIL PERSONNALITÉ",
        orderIndex: 1,
        stages: [
          { id: "p1", name: "LEADS RECEBIDOS", orderIndex: 0, dealsCount: 5 },
          { id: "p2", name: "QUALIFICADO", orderIndex: 1, dealsCount: 2 },
        ],
      },
    ];

    // Excluindo m3 (índice 2): deve sugerir m2 (etapa imediatamente anterior no mesmo funil)
    expect(resolveDefaultStageMigrationTarget(pipelines, ["m3"], "p-maq")).toEqual({
      targetPipelineId: "p-maq",
      targetStageId: "m2",
    });

    // Excluindo m1 (primeira etapa): deve sugerir m2 (primeira etapa restante no mesmo funil)
    expect(resolveDefaultStageMigrationTarget(pipelines, ["m1"], "p-maq")).toEqual({
      targetPipelineId: "p-maq",
      targetStageId: "m2",
    });

    // Excluindo todas as etapas de p-maq: deve sugerir a primeira etapa do próximo funil disponível
    expect(
      resolveDefaultStageMigrationTarget(pipelines, ["m1", "m2", "m3", "m4"], "p-maq"),
    ).toEqual({
      targetPipelineId: "p-pers",
      targetStageId: "p1",
    });

    // Se todas as etapas de todos os funis estiverem marcadas: retorna null
    expect(
      resolveDefaultStageMigrationTarget(
        pipelines,
        ["m1", "m2", "m3", "m4", "p1", "p2"],
        "p-maq",
      ),
    ).toBeNull();
  });
});
