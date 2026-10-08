import { describe, expect, it } from "bun:test";
import {
  toDiretrizesPresentation,
  toMaturityPresentation,
  toPipelinePresentation,
} from "../src/lib/commercial/presentation-data";

describe("War Room com dados do CRM local", () => {
  it("mostra as etapas reais e os negócios do consultor vinculado", () => {
    const payload = {
      stages: [
        { id: "stage-local", name: "Proposta", pipelineName: "Comercial", excluded: false },
        { id: "stage-hidden", name: "Arquivado", pipelineName: "Comercial", excluded: true },
      ],
      rows: [
        {
          operatorId: "operator-local",
          name: "Consultora Local",
          division: "personnalite",
          byStage: [
            { stageId: "stage-local", count: 2, value: 1500, shareOfConsultantPercent: 100 },
            { stageId: "stage-hidden", count: 1, value: 900, shareOfConsultantPercent: 0 },
          ],
          total: { count: 2, value: 1500 },
        },
      ],
    } as unknown as Parameters<typeof toPipelinePresentation>[0];

    const result = toPipelinePresentation(payload);
    expect(result.stages.map((stage) => stage.key)).toEqual(["stage-local"]);
    expect(result.personnaliteData.sellers[0].sellerId).toBe("operator-local");
    expect(result.personnaliteData.stageTotals["stage-local"].count).toBe(2);
    expect(result.semiMaquinasData.totalCards).toBe(0);
  });

  it("mostra vazio quando o CRM ainda não tem consultores ou negócios", () => {
    const pipeline = toPipelinePresentation({ stages: [], rows: [] } as unknown as Parameters<
      typeof toPipelinePresentation
    >[0]);
    const maturity = toMaturityPresentation(
      { today: "2026-10-08", maturity: { cohorts: [] }, goals: [], pendingTasksByOperator: [] },
      null,
    );
    expect(pipeline.personnaliteData.sellers).toEqual([]);
    expect(maturity.depara.deals).toEqual([]);
    expect(maturity.previstas.deals).toEqual([]);
  });

  it("reflete a pontuação e conclusão de responsabilidade do backend", () => {
    const result = toDiretrizesPresentation({
      summary: {
        totalCount: 1,
        totalValue: 1200,
        executionRatePercent: 100,
        completedCount: 1,
        overdueCount: 0,
      },
      consultants: [
        {
          operatorId: "operator-local",
          name: "Consultora Local",
          division: "personnalite",
          totalCount: 1,
          completedCount: 1,
          pendingTodayCount: 0,
          overdueCount: 0,
          executionRatePercent: 100,
          totalValue: 1200,
        },
      ],
      actions: [
        {
          id: "directive-local",
          dealId: "deal-local",
          dealTitle: "Negócio local",
          accountName: "Cliente local",
          operatorId: "operator-local",
          state: "completed",
          dealValue: 1200,
          stageName: "Proposta",
          assignedDate: "2026-10-08",
          instruction: "Contatar cliente",
          completionNote: "Contato realizado",
        },
      ],
    } as unknown as Parameters<typeof toDiretrizesPresentation>[0]);

    expect(result.kpis.concluidasCount).toBe(1);
    expect(result.consultants[0].deals[0]).toMatchObject({
      dealId: "deal-local",
      status: "concluida",
      consultantResponse: "Contato realizado",
    });
  });
});
