import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ADMIN_PERMISSIONS,
  normalizeGroupPermissions,
  getVisibleStageIdsForPipeline,
  isStageVisibleToSession,
  canSendDealToTarget,
} from "../src/lib/rbac";
import { canReadCrmDeal } from "../src/lib/access-control/crm-record-access";
import { validatePermissionPatch } from "../src/lib/access-control/group-validation";
import {
  filterCatalogOptionsByContext,
  type CatalogOption,
} from "../src/lib/crm/catalogs";
import { filterMetaTemplatesForContext } from "../src/lib/whatsapp/meta-templates";

describe("Governança de Funis e Etapas (Visibilidade, Motivos de Perda e Templates Meta)", () => {
  describe("1. Visibilidade de Etapas por Grupo de Acesso e Transferência Oculta", () => {
    it("normaliza e preserva configurações de restrição de etapas e envio oculto", () => {
      const normalized = normalizeGroupPermissions({
        name: "Vendedores",
        permissions: {
          crm: {
            pipelineScope: "selected",
            allowedPipelineIds: ["pipe-vendas"],
            stageRestrictionEnabled: true,
            allowedStageIdsByPipeline: {
              "pipe-vendas": ["stage-1", "stage-2", "stage-3"],
            },
            canSendToHiddenStagesOrPipelines: true,
            transferTargetPipelineIds: ["pipe-pos-venda"],
          },
        },
      });

      expect(normalized.crm.stageRestrictionEnabled).toBe(true);
      expect(normalized.crm.allowedStageIdsByPipeline).toEqual({
        "pipe-vendas": ["stage-1", "stage-2", "stage-3"],
      });
      expect(normalized.crm.canSendToHiddenStagesOrPipelines).toBe(true);
      expect(normalized.crm.transferTargetPipelineIds).toEqual(["pipe-pos-venda"]);
    });

    it("valida payload do grupo de acesso com regras de visibilidade de etapas", () => {
      const error = validatePermissionPatch({
        ...structuredClone(DEFAULT_ADMIN_PERMISSIONS),
        crm: {
          ...structuredClone(DEFAULT_ADMIN_PERMISSIONS.crm),
          pipelineScope: "selected",
          allowedPipelineIds: ["pipe-1"],
          stageRestrictionEnabled: true,
          allowedStageIdsByPipeline: { "pipe-1": ["s1", "s2"] },
          canSendToHiddenStagesOrPipelines: true,
          transferTargetPipelineIds: ["pipe-2"],
        },
      });
      expect(error).toBeNull();
    });

    it("separa visibilidade de etapa da permissão de envio/transferência para etapa oculta", () => {
      const permissions = normalizeGroupPermissions({
        name: "Vendedores SDR",
        permissions: {
          views: { crm: true },
          crm: {
            canViewCrm: true,
            canMoveStages: true,
            pipelineScope: "selected",
            allowedPipelineIds: ["pipe-x"],
            stageRestrictionEnabled: true,
            allowedStageIdsByPipeline: {
              "pipe-x": ["s1", "s2", "s3"],
            },
            canSendToHiddenStagesOrPipelines: true,
            transferTargetPipelineIds: ["pipe-y"],
          },
        },
      });

      const session = {
        operator: { id: "op-1", role: "operator" },
        permissions,
      };

      // O operador enxerga apenas s1, s2 e s3 no funil X
      expect(getVisibleStageIdsForPipeline(session, "pipe-x")).toEqual(["s1", "s2", "s3"]);
      expect(isStageVisibleToSession(session, "pipe-x", "s1")).toBe(true);
      expect(isStageVisibleToSession(session, "pipe-x", "s4-fechamento")).toBe(false);
      expect(isStageVisibleToSession(session, "pipe-y", "sy-1")).toBe(false);

      // Porém pode enviar um card para s4-fechamento (etapa oculta do mesmo funil) ou para pipe-y (funil oculto)
      expect(canSendDealToTarget(session, "pipe-x", "s4-fechamento")).toBe(true);
      expect(canSendDealToTarget(session, "pipe-y", "sy-1")).toBe(true);
      // Não pode enviar para um funil z não autorizado
      expect(canSendDealToTarget(session, "pipe-z", "sz-1")).toBe(false);

      // E não consegue visualizar o card quando ele está na etapa oculta s4-fechamento
      expect(
        canReadCrmDeal(session as any, {
          pipelineId: "pipe-x",
          stageId: "s4-fechamento",
          operatorId: "op-1",
        }),
      ).toBe(false);
      expect(
        canReadCrmDeal(session as any, {
          pipelineId: "pipe-x",
          stageId: "s2",
          operatorId: "op-1",
        }),
      ).toBe(true);
    });
  });

  describe("2. Motivos de Perda por Funil ou Etapa (Hierarquia Estrita + Fallback)", () => {
    const sampleReasons: CatalogOption[] = [
      {
        id: "r-global",
        name: "Desistência geral do projeto",
        isStandard: true,
        allPipelines: true,
        pipelineIds: [],
        stageIds: [],
      },
      {
        id: "r-pipe-comercial",
        name: "Sem orçamento para linha industrial",
        isStandard: false,
        allPipelines: false,
        pipelineIds: ["pipe-comercial"],
        stageIds: [],
      },
      {
        id: "r-stage-abordagem-1",
        name: "Telefone inexistente / Número errado",
        isStandard: false,
        allPipelines: false,
        pipelineIds: [],
        stageIds: ["stage-abordagem"],
      },
      {
        id: "r-stage-abordagem-2",
        name: "Fora do perfil (Pessoa Física)",
        isStandard: false,
        allPipelines: false,
        pipelineIds: [],
        stageIds: ["stage-abordagem"],
      },
      {
        id: "r-stage-fechamento-1",
        name: "Perdeu na negociação final para concorrente",
        isStandard: false,
        allPipelines: false,
        pipelineIds: [],
        stageIds: ["stage-fechamento"],
      },
    ];

    it("retorna todos os motivos quando restrictByStage está desativado", () => {
      const result = filterCatalogOptionsByContext(sampleReasons, false, {
        pipelineId: "pipe-comercial",
        stageId: "stage-abordagem",
      });
      expect(result).toHaveLength(5);
    });

    it("retorna estritamente os motivos da etapa quando a etapa possui vínculos", () => {
      const abordagem = filterCatalogOptionsByContext(sampleReasons, true, {
        pipelineId: "pipe-comercial",
        stageId: "stage-abordagem",
      });
      expect(abordagem.map((r) => r.id)).toEqual([
        "r-stage-abordagem-1",
        "r-stage-abordagem-2",
      ]);

      const fechamento = filterCatalogOptionsByContext(sampleReasons, true, {
        pipelineId: "pipe-comercial",
        stageId: "stage-fechamento",
      });
      expect(fechamento.map((r) => r.id)).toEqual(["r-stage-fechamento-1"]);
    });

    it("faz fallback para os motivos do funil quando a etapa não possui motivos exclusivos", () => {
      const qualificacao = filterCatalogOptionsByContext(sampleReasons, true, {
        pipelineId: "pipe-comercial",
        stageId: "stage-qualificacao-sem-motivo-proprio",
      });
      expect(qualificacao.map((r) => r.id)).toEqual(["r-pipe-comercial"]);
    });

    it("faz fallback para motivos globais quando nem a etapa nem o funil possuem vínculos", () => {
      const outroFunil = filterCatalogOptionsByContext(sampleReasons, true, {
        pipelineId: "pipe-assistencia",
        stageId: "stage-triagem",
      });
      expect(outroFunil.map((r) => r.id)).toEqual(["r-global"]);
    });
  });

  describe("3. Templates Oficiais da Meta por Funil ou Etapa (Direto ou via Grupo)", () => {
    const templates = [
      {
        name: "boas_vindas_geral",
        customGroups: [],
        allPipelines: true,
        pipelineIds: [],
        stageIds: [],
      },
      {
        name: "primeiro_contato_abordagem",
        customGroups: [],
        allPipelines: false,
        pipelineIds: [],
        stageIds: ["stage-abordagem"],
      },
      {
        name: "cobranca_proposta_fechamento",
        customGroups: ["Grupo Fechamento"],
        allPipelines: true,
        pipelineIds: [],
        stageIds: [],
      },
      {
        name: "acompanhamento_funil_comercial",
        customGroups: [],
        allPipelines: false,
        pipelineIds: ["pipe-comercial"],
        stageIds: [],
      },
    ];

    const groups = [
      {
        id: "g-fechamento",
        name: "Grupo Fechamento",
        allPipelines: false,
        pipelineIds: [],
        stageIds: ["stage-fechamento"],
      },
    ];

    it("retorna todos os templates quando restrictByStage está desativado", () => {
      const res = filterMetaTemplatesForContext(templates, groups, false, {
        pipelineId: "pipe-comercial",
        stageId: "stage-abordagem",
      });
      expect(res).toHaveLength(4);
    });

    it("filtra estritamente por etapa (incluindo vínculo herdado de grupo de templates)", () => {
      const emAbordagem = filterMetaTemplatesForContext(templates, groups, true, {
        pipelineId: "pipe-comercial",
        stageId: "stage-abordagem",
      });
      expect(emAbordagem.map((t) => t.name)).toEqual(["primeiro_contato_abordagem"]);

      const emFechamento = filterMetaTemplatesForContext(templates, groups, true, {
        pipelineId: "pipe-comercial",
        stageId: "stage-fechamento",
      });
      expect(emFechamento.map((t) => t.name)).toEqual(["cobranca_proposta_fechamento"]);
    });

    it("usa fallback de funil e fallback global quando a etapa não tem templates exclusivos", () => {
      const emNegociacao = filterMetaTemplatesForContext(templates, groups, true, {
        pipelineId: "pipe-comercial",
        stageId: "stage-negociacao-livre",
      });
      expect(emNegociacao.map((t) => t.name)).toEqual(["acompanhamento_funil_comercial"]);

      const emOutroFunil = filterMetaTemplatesForContext(templates, groups, true, {
        pipelineId: "pipe-pos-venda",
        stageId: "stage-entrega",
      });
      expect(emOutroFunil.map((t) => t.name)).toEqual(["boas_vindas_geral"]);
    });
  });
});
