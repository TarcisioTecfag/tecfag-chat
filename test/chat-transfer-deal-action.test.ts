import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDealActionPatchPayload,
  getPermittedDealActions,
  getSelectableStagesForPipeline,
  mergeAvailableTransferPipelines,
  requiresHiddenStageReassignment,
  resolveTransferTargetDeal,
  type TransferPipelineOption,
} from "../src/lib/crm/chat-transfer-deal-action";
import type { ConversationDealContext } from "../src/lib/crm/conversation-deal-client";

const samplePipelines: TransferPipelineOption[] = [
  {
    id: "pipe-1",
    name: "Comercial",
    isVisible: true,
    stages: [
      { id: "stg-2", name: "Proposta", orderIndex: 2, isVisible: true },
      { id: "stg-1", name: "Qualificação", orderIndex: 1, isVisible: true },
    ],
    allStages: [
      { id: "stg-1", name: "Qualificação", orderIndex: 1, isVisible: true },
      { id: "stg-2", name: "Proposta", orderIndex: 2, isVisible: true },
      { id: "stg-3", name: "Diretoria (Oculta)", orderIndex: 3, isVisible: false },
      { id: "stg-loss", name: "Perdido", orderIndex: 4, isLossStage: true, isVisible: true },
    ],
  },
];

const hiddenTransferPipelines: TransferPipelineOption[] = [
  {
    id: "pipe-hidden",
    name: "Funil Pós-Venda",
    isVisible: false,
    stages: [{ id: "stg-pv-1", name: "Onboarding", orderIndex: 1, isVisible: false }],
  },
];

describe("chat-transfer-deal-action", () => {
  test("resolveTransferTargetDeal atua exclusivamente sobre o card vinculado como Atual", () => {
    const context: ConversationDealContext = {
      version: 3,
      hasCurrentDeal: true,
      selectionRequired: false,
      editable: true,
      contactId: "c-1",
      currentDeal: { id: "deal-atual", title: "Máquina Seladora X", status: "open" },
      previousDeal: { id: "deal-antigo", title: "Antiga", status: "lost" },
      deals: [
        {
          id: "deal-outro",
          title: "Outro card aberto",
          status: "open",
          pipelineId: "pipe-1",
          pipelineName: "Comercial",
          stageId: "stg-1",
          stageName: "Qualificação",
          operatorId: "op-1",
          operatorName: "Ana",
          isLinked: true,
        },
        {
          id: "deal-atual",
          title: "Máquina Seladora X",
          status: "open",
          pipelineId: "pipe-1",
          pipelineName: "Comercial",
          stageId: "stg-2",
          stageName: "Proposta",
          operatorId: "op-1",
          operatorName: "Ana",
          isLinked: true,
        },
      ],
    };

    const resolved = resolveTransferTargetDeal(context);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe("deal-atual");
    expect(resolved?.pipelineId).toBe("pipe-1");
    expect(resolved?.pipelineName).toBe("Comercial");
    expect(resolved?.stageId).toBe("stg-2");
    expect(resolved?.stageName).toBe("Proposta");
    expect(resolved?.operatorName).toBe("Ana");
  });

  test("resolveTransferTargetDeal retorna null quando não há card Atual elegível ou quando o acesso é restrito", () => {
    expect(resolveTransferTargetDeal(null)).toBeNull();
    expect(
      resolveTransferTargetDeal({
        version: 1,
        hasCurrentDeal: false,
        selectionRequired: false,
        gracePeriodActive: true,
        editable: true,
        contactId: "c-1",
        currentDeal: null,
        previousDeal: { id: "deal-1", title: "Vendida", status: "won" },
        deals: [{ id: "deal-1", title: "Vendida", status: "won", isLinked: true }],
      }),
    ).toBeNull();

    // hasCurrentDeal true mas currentDeal null (operador sem acesso de leitura ao card)
    expect(
      resolveTransferTargetDeal({
        version: 2,
        hasCurrentDeal: true,
        selectionRequired: false,
        editable: true,
        contactId: "c-1",
        currentDeal: null,
        previousDeal: null,
        deals: [],
      }),
    ).toBeNull();

    // Card pausado vinculado é elegível como Atual
    const paused = resolveTransferTargetDeal({
      version: 2,
      hasCurrentDeal: true,
      selectionRequired: false,
      editable: true,
      contactId: "c-1",
      currentDeal: { id: "deal-p", title: "Em pausa", status: "paused" },
      previousDeal: null,
      deals: [{ id: "deal-p", title: "Em pausa", status: "paused", isLinked: true }],
    });
    expect(paused?.id).toBe("deal-p");
    expect(paused?.status).toBe("paused");
  });

  test("getPermittedDealActions respeita permissões RBAC e status do card", () => {
    const fullOpen = getPermittedDealActions(
      { canViewCrm: true, canCloseDeals: true, canEditDeals: true, canMoveStages: true },
      "open",
    );
    expect(fullOpen.canMarkWon).toBe(true);
    expect(fullOpen.canMarkLost).toBe(true);
    expect(fullOpen.canMarkPaused).toBe(true);
    expect(fullOpen.canTransferDeal).toBe(true);
    expect(fullOpen.hasAnyAction).toBe(true);

    const fullPaused = getPermittedDealActions(
      { canViewCrm: true, canCloseDeals: true, canEditDeals: true, canMoveStages: true },
      "paused",
    );
    expect(fullPaused.canMarkWon).toBe(true);
    expect(fullPaused.canMarkLost).toBe(true);
    expect(fullPaused.canMarkPaused).toBe(false);
    expect(fullPaused.canTransferDeal).toBe(true);

    const noCrm = getPermittedDealActions(
      { canViewCrm: false, canCloseDeals: true, canEditDeals: true, canMoveStages: true },
      "open",
    );
    expect(noCrm.hasAnyAction).toBe(false);
  });

  test("mergeAvailableTransferPipelines e getSelectableStagesForPipeline ordenam etapas e incluem destinos ocultos quando permitido", () => {
    const merged = mergeAvailableTransferPipelines(samplePipelines, hiddenTransferPipelines);
    expect(merged.map((p) => p.id)).toEqual(["pipe-1", "pipe-hidden"]);

    const visibleStages = getSelectableStagesForPipeline(merged[0], false);
    expect(visibleStages.map((s) => s.id)).toEqual(["stg-1", "stg-2"]);

    const allStages = getSelectableStagesForPipeline(merged[0], true);
    expect(allStages.map((s) => s.id)).toEqual(["stg-1", "stg-2", "stg-3", "stg-loss"]);

    const hiddenPipeStages = getSelectableStagesForPipeline(merged[1], true);
    expect(hiddenPipeStages.map((s) => s.id)).toEqual(["stg-pv-1"]);
  });

  test("buildDealActionPatchPayload para Marcar venda, Marcar perda e Marcar como pausa", () => {
    const won = buildDealActionPatchPayload({
      mode: "mark_won",
      currentDeal: { status: "open", version: 4 },
      winReason: "  Preço competitivo  ",
    });
    expect(won.ok).toBe(true);
    if (won.ok) {
      expect(won.payload).toEqual({
        expectedVersion: 4,
        status: "won",
        winReason: "Preço competitivo",
        pausedReason: null,
      });
    }

    const lostWithoutReason = buildDealActionPatchPayload({
      mode: "mark_lost",
      currentDeal: { status: "open", version: 4 },
      lossReason: "   ",
    });
    expect(lostWithoutReason.ok).toBe(false);
    if (!lostWithoutReason.ok) {
      expect(lostWithoutReason.code).toBe("LOSS_REASON_REQUIRED");
    }

    const lostWithReason = buildDealActionPatchPayload({
      mode: "mark_lost",
      currentDeal: { status: "open", version: 4 },
      lossReason: "Comprou no concorrente",
    });
    expect(lostWithReason.ok).toBe(true);
    if (lostWithReason.ok) {
      expect(lostWithReason.payload).toEqual({
        expectedVersion: 4,
        status: "lost",
        lossReason: "Comprou no concorrente",
        pausedReason: null,
      });
    }

    const pauseAlreadyPaused = buildDealActionPatchPayload({
      mode: "mark_paused",
      currentDeal: { status: "paused", version: 4 },
    });
    expect(pauseAlreadyPaused.ok).toBe(false);
    if (!pauseAlreadyPaused.ok) {
      expect(pauseAlreadyPaused.code).toBe("ALREADY_PAUSED");
    }

    const pauseOpen = buildDealActionPatchPayload({
      mode: "mark_paused",
      currentDeal: { status: "open", version: 4 },
      pauseReason: "Aguardando retorno",
    });
    expect(pauseOpen.ok).toBe(true);
    if (pauseOpen.ok) {
      expect(pauseOpen.payload).toEqual({
        expectedVersion: 4,
        status: "paused",
        pausedReason: "Aguardando retorno",
      });
    }
  });

  test("buildDealActionPatchPayload para Transferir Negociação valida alterações, etapa oculta e etapa de perda", () => {
    const merged = mergeAvailableTransferPipelines(samplePipelines, hiddenTransferPipelines);
    const pipe1 = merged[0];
    const pipeHidden = merged[1];
    const stg1 = pipe1.allStages![0];
    const stg2 = pipe1.allStages![1];
    const stgHidden = pipe1.allStages![2];
    const stgLoss = pipe1.allStages![3];
    const stgPv1 = pipeHidden.allStages![0];

    // Sem nenhuma alteração -> erro NO_DEAL_CHANGES
    const noChange = buildDealActionPatchPayload({
      mode: "transfer_deal",
      currentDeal: { status: "open", pipelineId: "pipe-1", stageId: "stg-1", operatorId: "op-1", version: 2 },
      currentOperatorId: "op-1",
      targetPipeline: pipe1,
      targetStage: stg1,
      targetOperatorId: "op-1",
    });
    expect(noChange.ok).toBe(false);
    if (!noChange.ok) expect(noChange.code).toBe("NO_DEAL_CHANGES");

    // Troca de funil + etapa + responsável
    const transferOk = buildDealActionPatchPayload({
      mode: "transfer_deal",
      currentDeal: { status: "open", pipelineId: "pipe-1", stageId: "stg-1", operatorId: "op-1", version: 2 },
      currentOperatorId: "op-1",
      targetPipeline: pipeHidden,
      targetStage: stgPv1,
      targetOperatorId: "op-2",
    });
    expect(transferOk.ok).toBe(true);
    if (transferOk.ok) {
      expect(transferOk.payload).toEqual({
        expectedVersion: 2,
        pipelineId: "pipe-hidden",
        stageId: "stg-pv-1",
        operatorId: "op-2",
      });
    }

    // Etapa oculta mantendo o próprio dono -> REASSIGNMENT_REQUIRED
    expect(
      requiresHiddenStageReassignment({
        pipeline: pipe1,
        stage: stgHidden,
        dealOwnerId: "op-1",
        currentOperatorId: "op-1",
      }),
    ).toBe(true);

    const hiddenBlocked = buildDealActionPatchPayload({
      mode: "transfer_deal",
      currentDeal: { status: "open", pipelineId: "pipe-1", stageId: "stg-1", operatorId: "op-1", version: 2 },
      currentOperatorId: "op-1",
      targetPipeline: pipe1,
      targetStage: stgHidden,
      targetOperatorId: "op-1",
    });
    expect(hiddenBlocked.ok).toBe(false);
    if (!hiddenBlocked.ok) expect(hiddenBlocked.code).toBe("REASSIGNMENT_REQUIRED");

    // Etapa de perda exige lossReason
    const lossStageBlocked = buildDealActionPatchPayload({
      mode: "transfer_deal",
      currentDeal: { status: "open", pipelineId: "pipe-1", stageId: "stg-2", operatorId: "op-1", version: 2 },
      currentOperatorId: "op-1",
      targetPipeline: pipe1,
      targetStage: stgLoss,
      targetOperatorId: "op-1",
      lossReason: "",
    });
    expect(lossStageBlocked.ok).toBe(false);
    if (!lossStageBlocked.ok) expect(lossStageBlocked.code).toBe("LOSS_REASON_REQUIRED");

    const lossStageOk = buildDealActionPatchPayload({
      mode: "transfer_deal",
      currentDeal: { status: "open", pipelineId: "pipe-1", stageId: "stg-2", operatorId: "op-1", version: 2 },
      currentOperatorId: "op-1",
      targetPipeline: pipe1,
      targetStage: stgLoss,
      targetOperatorId: "op-1",
      lossReason: "Sem orçamento",
    });
    expect(lossStageOk.ok).toBe(true);
    if (lossStageOk.ok) {
      expect(lossStageOk.payload).toEqual({
        expectedVersion: 2,
        stageId: "stg-loss",
        lossReason: "Sem orçamento",
      });
    }

    // Apenas troca de etapa com keepCurrentOperator
    const stageOnly = buildDealActionPatchPayload({
      mode: "transfer_deal",
      currentDeal: { status: "open", pipelineId: "pipe-1", stageId: "stg-1", operatorId: "op-1", version: 5 },
      currentOperatorId: "op-1",
      targetPipeline: pipe1,
      targetStage: stg2,
      keepCurrentOperator: true,
    });
    expect(stageOnly.ok).toBe(true);
    if (stageOnly.ok) {
      expect(stageOnly.payload).toEqual({
        expectedVersion: 5,
        stageId: "stg-2",
      });
    }
  });

  test("Design System e integração nos 3 pontos de transferência do chat", () => {
    const modalSource = readFileSync(
      join(process.cwd(), "src/components/chat/ChatTransferDealActionModal.tsx"),
      "utf8",
    );
    // Proibição de controles nativos de navegador (AGENTS.md)
    expect(modalSource).not.toMatch(/<select[\s>]/);
    expect(modalSource).not.toMatch(/<option[\s>]/);
    expect(modalSource).not.toMatch(/\btitle="/);
    expect(modalSource).not.toMatch(/type="date"|type="time"|type="datetime-local"/);
    // Sem tenant hardcoded
    expect(modalSource).not.toMatch(/["'](valem|tecfag)["']/);
    // Copy e opções solicitadas
    expect(modalSource).toContain(
      "Gostaria de transferir ou tomar alguma ação também na negociação dessa conversa?",
    );
    expect(modalSource).toContain("Marcar venda");
    expect(modalSource).toContain("Marcar perda");
    expect(modalSource).toContain("Marcar como pausa");
    expect(modalSource).toContain("Transferir Negociação");
    expect(modalSource).toContain("Qual funil?");
    expect(modalSource).toContain("Qual etapa?");
    expect(modalSource).toContain("Qual responsável?");
    expect(modalSource).toContain("Transferir apenas conversa");

    const chatPanelSource = readFileSync(
      join(process.cwd(), "src/components/chat/ChatPanel.tsx"),
      "utf8",
    );
    const mobileModalSource = readFileSync(
      join(process.cwd(), "src/components/mobile/MobileActionsModal.tsx"),
      "utf8",
    );
    const crmWidgetSource = readFileSync(
      join(process.cwd(), "src/components/crm/CrmChatWidget.tsx"),
      "utf8",
    );

    expect(chatPanelSource).toContain("<ChatTransferDealActionModal");
    expect(mobileModalSource).toContain("<ChatTransferDealActionModal");
    expect(crmWidgetSource).toContain("<ChatTransferDealActionModal");
  });
});
