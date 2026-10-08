import { describe, expect, it } from "bun:test";
import {
  toDiretrizesPresentation,
  toMaturityPresentation,
  toPipelinePresentation,
} from "../src/lib/commercial/presentation-data";
import { belongsToTeamPipeline } from "../src/lib/commercial/pipeline-scope";

describe("War Room com dados do CRM local", () => {
  it("mostra as etapas reais e os negócios do consultor vinculado", () => {
    const payload = {
      stages: [
        {
          id: "stage-local",
          pipelineId: "pipeline-personnalite",
          name: "Proposta",
          pipelineName: "Personnalité",
          excluded: false,
        },
        {
          id: "stage-hidden",
          pipelineId: "pipeline-personnalite",
          name: "Arquivado",
          pipelineName: "Personnalité",
          excluded: true,
        },
        {
          id: "stage-maquinas",
          pipelineId: "pipeline-maquinas",
          name: "Proposta",
          pipelineName: "Máquinas",
          excluded: false,
        },
      ],
      pipelineByDivision: { personnalite: "pipeline-personnalite", maquinas: "pipeline-maquinas" },
      pipelineOptions: [
        { id: "pipeline-personnalite", name: "Personnalité" },
        { id: "pipeline-maquinas", name: "Máquinas" },
      ],
      rows: [
        {
          operatorId: "operator-local",
          name: "Consultora Local",
          division: "personnalite",
          byStage: [
            { stageId: "stage-local", count: 2, value: 1500, shareOfConsultantPercent: 100 },
            { stageId: "stage-hidden", count: 1, value: 900, shareOfConsultantPercent: 0 },
            { stageId: "stage-maquinas", count: 1, value: 1000, shareOfConsultantPercent: 0 },
          ],
          total: { count: 2, value: 1500 },
        },
      ],
    } as unknown as Parameters<typeof toPipelinePresentation>[0];

    const result = toPipelinePresentation(payload);
    expect(result.stagesByDivision.personnalite.map((stage) => stage.key)).toEqual(["stage-local"]);
    expect(result.stagesByDivision.maquinas.map((stage) => stage.key)).toEqual(["stage-maquinas"]);
    expect(result.personnaliteData.sellers[0].sellerId).toBe("operator-local");
    expect(result.personnaliteData.stageTotals["stage-local"].count).toBe(2);
    expect(result.personnaliteData.stageTotals["stage-maquinas"]).toBeUndefined();
    expect(result.personnaliteData.sellers[0].stages["stage-maquinas"]).toBeUndefined();
    expect(result.semiMaquinasData.totalCards).toBe(0);
    expect(
      belongsToTeamPipeline(payload.pipelineByDivision, "personnalite", "pipeline-maquinas"),
    ).toBe(false);
  });

  it("mostra vazio quando o CRM ainda não tem consultores ou negócios", () => {
    const pipeline = toPipelinePresentation({
      stages: [],
      rows: [],
      pipelineByDivision: {},
      pipelineOptions: [],
    } as unknown as Parameters<typeof toPipelinePresentation>[0]);
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
