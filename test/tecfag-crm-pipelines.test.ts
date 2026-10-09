import { describe, expect, it } from "bun:test";
import { db } from "../src/db";
import { crmPipelines, crmStages, crmStageSettings, commercialSettings } from "../src/db/schema";
import { eq, asc } from "drizzle-orm";

describe("Tecfag CRM - Funis e Etapas Operacionais", () => {
  const tenantId = "tecfag";

  it("deve conter os 8 funis cadastrados para o tenant tecfag", async () => {
    const pipelines = await db
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId))
      .orderBy(asc(crmPipelines.orderIndex));

    expect(pipelines.length).toBe(8);
    const names = pipelines.map((p) => p.name);
    expect(names).toContain("FUNIL MÁQUINAS 2.0");
    expect(names).toContain("FUNIL PERSONNALITÉ");
    expect(names).toContain("FUNIL SDR");
    expect(names).toContain("FUNIL PEÇAS");
    expect(names).toContain("FUNIL PROJETOS");
    expect(names).toContain("FUNIL SUPORTE TÉCNICO");
    expect(names).toContain("FUNIL FINANCEIRO");
    expect(names).toContain("FUNIL EXTERNO 2.0");
  });

  it("FUNIL PEÇAS deve conter exatamente as 7 etapas na ordem correta", async () => {
    const [pipeline] = await db
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.id, "pipe-tecfag-pecas"));

    expect(pipeline).toBeDefined();
    expect(pipeline.name).toBe("FUNIL PEÇAS");

    const stages = await db
      .select()
      .from(crmStages)
      .where(eq(crmStages.pipelineId, pipeline.id))
      .orderBy(asc(crmStages.orderIndex));

    expect(stages.length).toBe(7);
    const stageNames = stages.map((s) => s.name);
    expect(stageNames).toEqual([
      "LEADS RECEBIDOS",
      "ABORDAGEM COMERCIAL",
      "PENDÊNCIA TÉCNICA",
      "PROPOSTA ENVIADA",
      "AGUARDANDO IMPORTAÇÃO",
      "FECHAMENTO",
      "REQUALIFICAÇÃO",
    ]);
  });

  it("FUNIL PROJETOS deve conter exatamente as 10 etapas na ordem correta", async () => {
    const [pipeline] = await db
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.id, "pipe-tecfag-projetos"));

    expect(pipeline).toBeDefined();
    expect(pipeline.name).toBe("FUNIL PROJETOS");

    const stages = await db
      .select()
      .from(crmStages)
      .where(eq(crmStages.pipelineId, pipeline.id))
      .orderBy(asc(crmStages.orderIndex));

    expect(stages.length).toBe(10);
    const stageNames = stages.map((s) => s.name);
    expect(stageNames).toEqual([
      "ABORDAGEM",
      "DEFINIÇÃO DO ESCOPO",
      "ESCOPO CONCLUIDO",
      "ESCOPO APRESENTADO",
      "ESCOPO APROVADO",
      "DESENVOLVIMENTO",
      "ATRIBUIÇÃO DE VALOR",
      "PROPOSTA ENVIADA",
      "FECHAMENTO",
      "REQUALIFICAÇÃO",
    ]);
  });

  it("FUNIL SUPORTE TÉCNICO deve conter exatamente as 12 etapas na ordem correta", async () => {
    const [pipeline] = await db
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.id, "pipe-tecfag-suporte-tecnico"));

    expect(pipeline).toBeDefined();
    expect(pipeline.name).toBe("FUNIL SUPORTE TÉCNICO");

    const stages = await db
      .select()
      .from(crmStages)
      .where(eq(crmStages.pipelineId, pipeline.id))
      .orderBy(asc(crmStages.orderIndex));

    expect(stages.length).toBe(12);
    const stageNames = stages.map((s) => s.name);
    expect(stageNames).toEqual([
      "TRIAGEM",
      "TROCA EM GARANTIA",
      "SUPORTE",
      "REMESSA DE CONSERTO",
      "RASTREIO",
      "NÃO CONFORME - FRETE",
      "SIMPLES FATURAMENTO",
      "NÃO CONFORME - DEVOLUÇÃO",
      "ASSISTÊNCIA TÉCNICA",
      "VIDEO CHAMADA",
      "DEVOLUÇÃO",
      "FINALIZADOS",
    ]);
  });

  it("todas as etapas dos novos funis devem possuir crm_stage_settings configurado", async () => {
    const pipelineIds = ["pipe-tecfag-pecas", "pipe-tecfag-projetos", "pipe-tecfag-suporte-tecnico"];
    for (const pipeId of pipelineIds) {
      const stages = await db
        .select()
        .from(crmStages)
        .where(eq(crmStages.pipelineId, pipeId));

      for (const stg of stages) {
        const [setting] = await db
          .select()
          .from(crmStageSettings)
          .where(eq(crmStageSettings.stageId, stg.id));

        expect(setting).toBeDefined();
        expect(setting.coolingDays).toBeGreaterThan(0);
      }
    }
  });

  it("commercial_settings deve associar funis para divisões maquinas e personnalite", async () => {
    const [settings] = await db
      .select()
      .from(commercialSettings)
      .where(eq(commercialSettings.tenantId, tenantId));

    expect(settings).toBeDefined();
    expect(settings.pipelineByDivision).toEqual({
      maquinas: "pipe-tecfag-maquinas-2-0",
      personnalite: "pipe-tecfag-personnalite",
    });
  });
});
