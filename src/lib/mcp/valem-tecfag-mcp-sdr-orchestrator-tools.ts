import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  conversations,
  crmPipelines,
  crmStages,
  messages,
  operators,
  sectors,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import {
  approveIndustrialTriage,
  completeIndustrialTriageWithoutTransfer,
  loadIndustrialApprovalOptions,
  type ApprovalActor,
  type PendingApprovalSuggestion,
} from "../triage/industrial-approval-store";
import { stopIndustrialCycle } from "../triage/industrial-cycle-stop";
import { normalizeTriageText } from "../triage/industrial-policy";
import { resumeStoppedIndustrialFlow } from "../triage/sdr-disabled-routing";
import { SdrDebouncer } from "../valentina/sdr-debouncer";
import { recoverIndustrialInterruptedTurns } from "../valentina/sdr-recovery";
import type { McpToolDefinition, McpWriteActorContext } from "./valem-tecfag-mcp-write-tools";

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description:
    "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveMcpSdrOrchestratorActorName(
  requestedName: string | undefined,
  operatorName: string | undefined,
  actor?: McpWriteActorContext,
): string {
  return (
    requestedName ||
    operatorName ||
    actor?.keyLabel?.trim() ||
    "Orquestrador SDR (MCP)"
  );
}

export const MCP_SDR_ORCHESTRATOR_TOOLS: McpToolDefinition[] = [
  {
    name: "get_triage_approval_options",
    access: "read",
    description:
      "Lista as opções oficiais do painel de Aprovação Human-in-the-Loop SDR do tenant: setores (com membros), operadores ativos com status de participação/ausência no rodízio e carga atual, funis/etapas CRM disponíveis e mapa de destinos industriais configurados. Use antes de aprovar ou corrigir setor/responsável de uma triagem.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        sectorName: {
          type: "string",
          description: "Filtro opcional por trecho do nome do setor.",
        },
        onlyParticipating: {
          type: "boolean",
          default: false,
          description: "Quando true, filtra a lista de operadores para exibir apenas quem participa do rodízio e não está ausente hoje.",
        },
      },
    },
  },
  {
    name: "approve_fagner_triage",
    access: "write",
    description:
      "[ESCRITA] Aprova uma triagem industrial do assistente IA (Human-in-the-Loop) — aceitando a recomendação do assistente ou corrigindo setor, responsável, funil e etapa CRM no ato. Consome o slot do rodízio no operador final, move/atualiza o card no CRM com tarefa 'Responder o contato', transfere a conversa para 'meus' do vendedor, atualiza a carteira e opcionalmente envia confirmação oficial ao cliente.",
    inputSchema: {
      type: "object",
      required: ["conversationId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: {
          type: "string",
          description: "ID da conversa em triagem / aguardando aprovação SDR.",
        },
        operatorId: {
          type: "string",
          description:
            "ID do operador de destino aprovado (para aceitar ou corrigir o responsável). Se omitido com useSuggested=true, usa pendingApproval.suggestedOperatorId.",
        },
        operatorName: {
          type: "string",
          description:
            "Alternativa amigável a operatorId: nome exato ou único do operador no tenant.",
        },
        sectorId: {
          type: "string",
          description:
            "ID do setor de destino (opcional; se omitido com useSuggested=true, herda pendingApproval.suggestedSectorId ou setor do operador).",
        },
        sectorName: {
          type: "string",
          description:
            "Alternativa amigável a sectorId: nome do setor no tenant.",
        },
        pipelineId: {
          type: "string",
          description:
            "ID do funil CRM de destino (deve ser informado junto com stageId; se omitido com useSuggested=true, herda da sugestão pendente).",
        },
        stageId: {
          type: "string",
          description:
            "ID da etapa CRM de destino (deve ser informada junto com pipelineId; se omitido com useSuggested=true, herda da sugestão pendente).",
        },
        targetFunnel: {
          type: "string",
          description:
            "Nome do funil/setor de destino a registrar na auditoria (ex: 'Máquinas', 'Personnalité', 'Peças', 'Pós-Venda').",
        },
        useSuggested: {
          type: "boolean",
          default: true,
          description:
            "Quando true (padrão), preenche automaticamente operatorId/sectorId/pipelineId/stageId/targetFunnel omitidos a partir de pendingApproval da conversa.",
        },
        sendClientConfirmation: {
          type: "boolean",
          default: true,
          description:
            "Quando true (padrão), envia a confirmação oficial de encaminhamento ao cliente no canal (com aviso de fora do expediente se aplicável).",
        },
        note: {
          type: "string",
          description:
            "Observação/justificativa do Orquestrador SDR gravada na auditoria e nota interna do chat (ex: motivo de correção de setor/vendedor).",
        },
        actorOperatorId: {
          type: "string",
          description:
            "Opcional: ID de um operador real do tenant para constar como autor em eventos CRM.",
        },
        actorName: {
          type: "string",
          description:
            "Opcional: nome legível do aprovador na linha do tempo e auditoria (padrão: nome da chave MCP).",
        },
      },
    },
  },
  {
    name: "dismiss_fagner_triage",
    access: "write",
    description:
      "[ESCRITA] Conclui uma triagem industrial SEM transferir para vendedor humano (ideal para currículos, fornecedores, URA/bot 0800, recusa clara ou testes internos). Encerra o ciclo do assistente, oculta do Kanban ativo, registra nota de auditoria e opcionalmente finaliza a conversa e marca o card CRM como perdido ou move de etapa.",
    inputSchema: {
      type: "object",
      required: ["conversationId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: {
          type: "string",
          description: "ID da conversa cuja triagem será concluída sem transferência.",
        },
        reason: {
          type: "string",
          description:
            "Motivo da conclusão sem transferência (ex: 'Currículo / RH', 'URA 0800 / Bot', 'Cliente desistiu', 'Teste interno').",
        },
        finishConversation: {
          type: "boolean",
          default: true,
          description: "Quando true (padrão), move a conversa para 'finalizados'.",
        },
        dealAction: {
          type: "string",
          enum: ["keep", "mark_lost", "move_stage"],
          default: "keep",
          description:
            "Ação sobre o card CRM vinculado: 'keep' (mantém como está), 'mark_lost' (marca perdido com o motivo) ou 'move_stage' (exige targetPipelineId + targetStageId).",
        },
        targetPipelineId: {
          type: "string",
          description: "Obrigatório quando dealAction='move_stage': ID do funil CRM de destino.",
        },
        targetStageId: {
          type: "string",
          description: "Obrigatório quando dealAction='move_stage': ID da etapa CRM de destino.",
        },
        actorOperatorId: {
          type: "string",
          description: "Opcional: ID de operador real do tenant para constar em eventos CRM.",
        },
        actorName: {
          type: "string",
          description: "Opcional: nome legível de quem concluiu a triagem.",
        },
      },
    },
  },
  {
    name: "stop_or_resume_fagner_triage",
    access: "write",
    description:
      "[ESCRITA] Para ou retoma o assistente IA em UMA conversa específica usando o motor industrial oficial (espelho exato dos botões 'Parar' e 'Retomar' do painel SDR — nunca desliga o SDR global). Em 'stop', cancela debouncer, encerra ciclo industrial, move conversa sem operador para 'fila' e grava nota interna explicativa. Em 'resume', reativa o ciclo em 'automacao' e opcionalmente aciona a recuperação de turnos pendentes.",
    inputSchema: {
      type: "object",
      required: ["conversationId", "action"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: {
          type: "string",
          description: "ID da conversa alvo.",
        },
        action: {
          type: "string",
          enum: ["stop", "resume"],
          description: "'stop' para interromper imediatamente a IA nesta conversa; 'resume' para retomar a triagem.",
        },
        reason: {
          type: "string",
          description:
            "Motivo da parada/retomada (gravado como nota interna no chat para dar contexto imediato à equipe humana).",
        },
        triggerRecovery: {
          type: "boolean",
          default: true,
          description:
            "Usado apenas quando action='resume': dispara recoverIndustrialInterruptedTurns para responder caso o cliente já tenha enviado mensagem pendente.",
        },
        actorOperatorId: {
          type: "string",
          description: "Opcional: ID de operador real do tenant.",
        },
        actorName: {
          type: "string",
          description: "Opcional: nome legível do autor na nota interna e journal.",
        },
      },
    },
  },
  {
    name: "recover_fagner_stuck_turns",
    access: "write",
    description:
      "[ESCRITA] Dispara sob demanda a rotina oficial de auto-recuperação de turnos interrompidos/travados em awaiting_ai (recoverIndustrialInterruptedTurns), respeitando janela de 24h, debounce, backoff exponencial e limite de tentativas. Seguro para destravar leads após falhas transitórias.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
      },
    },
  },
];

export const MCP_SDR_ORCHESTRATOR_TOOL_LABELS_PT: Record<string, string> = {
  get_triage_approval_options: "Opções Oficiais de Aprovação SDR (Setores, Rodízio e Funis)",
  approve_fagner_triage: "Aprovar / Corrigir Triagem SDR e Transferir",
  dismiss_fagner_triage: "Concluir Triagem SDR sem Transferir",
  stop_or_resume_fagner_triage: "Parar / Retomar Assistente IA na Conversa",
  recover_fagner_stuck_turns: "Recuperar Turnos Travados da Triagem IA",
};

const SDR_ORCHESTRATOR_TOOL_NAMES = new Set(MCP_SDR_ORCHESTRATOR_TOOLS.map((t) => t.name));

export function isSdrOrchestratorMcpTool(name: string): boolean {
  return SDR_ORCHESTRATOR_TOOL_NAMES.has(name);
}

async function resolveOptionalTenantOperator(
  tenantId: string,
  operatorId: string | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!operatorId) return null;
  const [op] = await db
    .select({ id: operators.id, name: operators.name })
    .from(operators)
    .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
    .limit(1);
  if (!op) {
    throw new Error(`Operador '${operatorId}' não encontrado no tenant '${tenantId}'.`);
  }
  return op;
}

async function resolveTargetOperatorId(
  tenantId: string,
  operatorId: string | undefined,
  operatorName: string | undefined,
): Promise<{ id: string; name: string } | null> {
  if (operatorId) {
    return resolveOptionalTenantOperator(tenantId, operatorId);
  }
  if (!operatorName) return null;

  const tenantOps = await db
    .select({ id: operators.id, name: operators.name })
    .from(operators)
    .where(eq(operators.tenantId, tenantId));

  const targetKey = normalizeTriageText(operatorName);
  const exact = tenantOps.filter((o) => normalizeTriageText(o.name) === targetKey);
  if (exact.length === 1) return exact[0];

  const partial = tenantOps.filter((o) => normalizeTriageText(o.name).includes(targetKey));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `operatorName '${operatorName}' é ambíguo (${partial.map((o) => `${o.name} [${o.id}]`).join(", ")}). Informe operatorId.`,
    );
  }
  throw new Error(`Operador '${operatorName}' não encontrado no tenant '${tenantId}'.`);
}

async function resolveTargetSectorId(
  tenantId: string,
  sectorId: string | undefined,
  sectorName: string | undefined,
): Promise<{ id: string; name: string } | null> {
  if (sectorId) {
    const [sec] = await db
      .select({ id: sectors.id, name: sectors.name })
      .from(sectors)
      .where(and(eq(sectors.tenantId, tenantId), eq(sectors.id, sectorId)))
      .limit(1);
    if (!sec) {
      throw new Error(`Setor '${sectorId}' não encontrado no tenant '${tenantId}'.`);
    }
    return sec;
  }
  if (!sectorName) return null;

  const tenantSectors = await db
    .select({ id: sectors.id, name: sectors.name })
    .from(sectors)
    .where(eq(sectors.tenantId, tenantId));

  const targetKey = normalizeTriageText(sectorName);
  const exact = tenantSectors.filter((s) => normalizeTriageText(s.name) === targetKey);
  if (exact.length === 1) return exact[0];

  const partial = tenantSectors.filter((s) => normalizeTriageText(s.name).includes(targetKey));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `sectorName '${sectorName}' é ambíguo (${partial.map((s) => `${s.name} [${s.id}]`).join(", ")}). Informe sectorId.`,
    );
  }
  throw new Error(`Setor '${sectorName}' não encontrado no tenant '${tenantId}'.`);
}

function buildMcpApprovalActor(
  actorOp: { id: string; name: string } | null,
  requestedActorName: string | undefined,
  actor?: McpWriteActorContext,
): ApprovalActor {
  return {
    id: actorOp?.id ?? null,
    name: resolveMcpSdrOrchestratorActorName(requestedActorName, actorOp?.name, actor),
    role: "admin",
    canAccessSdr: true,
  };
}

export async function executeSdrOrchestratorMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: string,
  actor?: McpWriteActorContext,
): Promise<unknown> {
  const persona = getAiPersona(tenantId);

  switch (name) {
    case "get_triage_approval_options": {
      if (persona.triagePolicy !== "industrial") {
        throw new Error(
          `Aprovação Human-in-the-Loop industrial não está habilitada para o perfil '${tenantId}'.`,
        );
      }
      const options = await loadIndustrialApprovalOptions(db, tenantId);
      const sectorNameFilter = asTrimmedString(args.sectorName);
      const onlyParticipating = args.onlyParticipating === true;

      const filteredSectors = sectorNameFilter
        ? options.sectors.filter((s) =>
            normalizeTriageText(s.name).includes(normalizeTriageText(sectorNameFilter)),
          )
        : options.sectors;

      const filteredOperators = onlyParticipating
        ? options.operators.filter((op) => op.isParticipating && !op.isOnLeave)
        : options.operators;

      return {
        tenantId,
        assistantName: persona.name,
        sectorsCount: filteredSectors.length,
        operatorsCount: filteredOperators.length,
        pipelinesCount: options.pipelines.length,
        stagesCount: options.stages.length,
        sectors: filteredSectors,
        operators: filteredOperators,
        pipelines: options.pipelines,
        stages: options.stages,
        destinations: options.destinations,
      };
    }

    case "approve_fagner_triage": {
      if (persona.triagePolicy !== "industrial") {
        throw new Error(
          `approve_fagner_triage está disponível apenas para tenants com triagem industrial.`,
        );
      }
      const conversationId = asTrimmedString(args.conversationId);
      if (!conversationId) {
        throw new Error("Campo obrigatório 'conversationId' não informado.");
      }

      const useSuggested = args.useSuggested !== false;
      const explicitOp = await resolveTargetOperatorId(
        tenantId,
        asTrimmedString(args.operatorId),
        asTrimmedString(args.operatorName),
      );
      const explicitSector = await resolveTargetSectorId(
        tenantId,
        asTrimmedString(args.sectorId),
        asTrimmedString(args.sectorName),
      );
      let pipelineId = asTrimmedString(args.pipelineId) || null;
      let stageId = asTrimmedString(args.stageId) || null;
      let targetFunnel = asTrimmedString(args.targetFunnel) || null;

      let pending: Partial<PendingApprovalSuggestion> | null = null;
      if (useSuggested) {
        const [flow] = await db
          .select({ metadata: agentFlowStates.metadata })
          .from(agentFlowStates)
          .where(
            and(
              eq(agentFlowStates.tenantId, tenantId),
              eq(agentFlowStates.conversationId, conversationId),
              eq(agentFlowStates.agentType, "sdr"),
            ),
          )
          .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
          .limit(1);
        const meta = (flow?.metadata as Record<string, any>) || {};
        pending = (meta.pendingApproval as Partial<PendingApprovalSuggestion> | null) || null;
      }

      const finalOperatorId = explicitOp?.id || (useSuggested ? pending?.suggestedOperatorId || "" : "");
      if (!finalOperatorId) {
        throw new Error(
          "Não foi possível determinar 'operatorId'. Informe operatorId/operatorName ou verifique se a conversa possui sugestão pendente (pendingApproval.suggestedOperatorId).",
        );
      }

      const finalSectorId = explicitSector?.id || (useSuggested ? pending?.suggestedSectorId || null : null);

      if (!pipelineId && !stageId && useSuggested && pending?.suggestedPipelineId && pending?.suggestedStageId) {
        pipelineId = pending.suggestedPipelineId;
        stageId = pending.suggestedStageId;
      }
      if (!targetFunnel && useSuggested && pending?.targetFunnel) {
        targetFunnel = pending.targetFunnel;
      }

      const actorOp = await resolveOptionalTenantOperator(
        tenantId,
        asTrimmedString(args.actorOperatorId),
      );
      const approvalActor = buildMcpApprovalActor(
        actorOp,
        asTrimmedString(args.actorName),
        actor,
      );

      const note = asTrimmedString(args.note) || null;
      const result = await approveIndustrialTriage(db, tenantId, approvalActor, {
        conversationId,
        sectorId: finalSectorId,
        operatorId: finalOperatorId,
        pipelineId,
        stageId,
        targetFunnel,
        sendClientConfirmation: args.sendClientConfirmation !== false,
        note,
      });

      return {
        ...result,
        tenantId,
        approvedBy: approvalActor.name,
        overrodeSuggestedOperator: Boolean(
          pending?.suggestedOperatorId && pending.suggestedOperatorId !== finalOperatorId,
        ),
        overrodeSuggestedSector: Boolean(
          pending?.suggestedSectorId && finalSectorId && pending.suggestedSectorId !== finalSectorId,
        ),
      };
    }

    case "dismiss_fagner_triage": {
      if (persona.triagePolicy !== "industrial") {
        throw new Error(
          `dismiss_fagner_triage está disponível apenas para tenants com triagem industrial.`,
        );
      }
      const conversationId = asTrimmedString(args.conversationId);
      if (!conversationId) {
        throw new Error("Campo obrigatório 'conversationId' não informado.");
      }

      const rawDealAction = asTrimmedString(args.dealAction) || "keep";
      if (rawDealAction !== "keep" && rawDealAction !== "mark_lost" && rawDealAction !== "move_stage") {
        throw new Error("dealAction inválido. Use 'keep', 'mark_lost' ou 'move_stage'.");
      }

      const targetPipelineId = asTrimmedString(args.targetPipelineId) || null;
      const targetStageId = asTrimmedString(args.targetStageId) || null;
      if (rawDealAction === "move_stage") {
        if (!targetPipelineId || !targetStageId) {
          throw new Error("Quando dealAction='move_stage', informe targetPipelineId e targetStageId.");
        }
        const [pipe] = await db
          .select({ id: crmPipelines.id })
          .from(crmPipelines)
          .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, targetPipelineId)))
          .limit(1);
        const [stage] = await db
          .select({ id: crmStages.id })
          .from(crmStages)
          .where(
            and(
              eq(crmStages.tenantId, tenantId),
              eq(crmStages.id, targetStageId),
              eq(crmStages.pipelineId, targetPipelineId),
            ),
          )
          .limit(1);
        if (!pipe || !stage) {
          throw new Error("targetPipelineId ou targetStageId inválido para este tenant.");
        }
      }

      const actorOp = await resolveOptionalTenantOperator(
        tenantId,
        asTrimmedString(args.actorOperatorId),
      );
      const approvalActor = buildMcpApprovalActor(
        actorOp,
        asTrimmedString(args.actorName),
        actor,
      );

      const reason = asTrimmedString(args.reason) || null;
      const result = await completeIndustrialTriageWithoutTransfer(db, tenantId, approvalActor, {
        conversationId,
        reason,
        finishConversation: args.finishConversation !== false,
        dealAction: rawDealAction,
        targetPipelineId,
        targetStageId,
      });

      return {
        ...result,
        tenantId,
        dealAction: rawDealAction,
        reason: reason || "Concluído sem transferência pelo SDR",
        dismissedBy: approvalActor.name,
      };
    }

    case "stop_or_resume_fagner_triage": {
      const conversationId = asTrimmedString(args.conversationId);
      const action = asTrimmedString(args.action);
      if (!conversationId) {
        throw new Error("Campo obrigatório 'conversationId' não informado.");
      }
      if (action !== "stop" && action !== "resume") {
        throw new Error("Campo obrigatório 'action' deve ser 'stop' ou 'resume'.");
      }

      const [conv] = await db
        .select({
          id: conversations.id,
          queueState: conversations.queueState,
          operatorId: conversations.operatorId,
        })
        .from(conversations)
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
        .limit(1);
      if (!conv) {
        throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
      }

      const actorOp = await resolveOptionalTenantOperator(
        tenantId,
        asTrimmedString(args.actorOperatorId),
      );
      const actorName = resolveMcpSdrOrchestratorActorName(
        asTrimmedString(args.actorName),
        actorOp?.name,
        actor,
      );
      const reason = asTrimmedString(args.reason);
      const now = new Date();

      if (action === "stop") {
        SdrDebouncer.getInstance().clearSession(conversationId);

        if (persona.triagePolicy === "industrial") {
          await stopIndustrialCycle(
            db,
            tenantId,
            conversationId,
            actorOp?.id || actor?.keyId || "mcp-orchestrator",
          );
        } else {
          await db
            .update(agentFlowStates)
            .set({
              outcome: "stopped",
              currentStep: "Interrompido Manualmente",
              lastInteractionAt: now,
              completedAt: now,
            })
            .where(
              and(
                eq(agentFlowStates.tenantId, tenantId),
                eq(agentFlowStates.conversationId, conversationId),
                eq(agentFlowStates.agentType, "sdr"),
                eq(agentFlowStates.outcome, "in_progress"),
              ),
            );
          if (!conv.operatorId && conv.queueState !== "finalizados") {
            await db
              .update(conversations)
              .set({ queueState: "fila", updatedAt: now })
              .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)));
          }
        }

        const noteText = reason
          ? `${persona.name} interrompido por ${actorName} — Motivo: ${reason}`
          : `${persona.name} interrompido por ${actorName} (conversa encaminhada para revisão humana).`;

        await db.insert(messages).values({
          id: `sys-mcp-stop-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
          tenantId,
          conversationId,
          senderType: "system",
          senderName: "Sistema",
          content: noteText,
          isInternalNote: true,
          direction: "outbound",
          provider: "system",
          status: "accepted",
          metaDetails: {
            attendanceSkip: true,
            mcpOrchestratorAction: "stop_fagner_triage",
            actorName,
            reason: reason || null,
          },
          sentAt: now,
          updatedAt: now,
        });

        try {
          const sm = SessionManager.getInstance();
          sm.notifyPublic(tenantId, {
            type: "sdr_flow_updated",
            conversationId,
            outcome: "stopped",
          });
        } catch {
          // Não bloqueia resposta
        }

        const [afterConv] = await db
          .select({ queueState: conversations.queueState, operatorId: conversations.operatorId })
          .from(conversations)
          .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
          .limit(1);

        return {
          success: true,
          action: "stop",
          tenantId,
          conversationId,
          assistantName: persona.name,
          queueState: afterConv?.queueState ?? conv.queueState,
          operatorId: afterConv?.operatorId ?? conv.operatorId,
          debouncerCleared: true,
          actorName,
          reason: reason || null,
        };
      }

      // action === "resume"
      if (persona.triagePolicy === "industrial") {
        const res = await resumeStoppedIndustrialFlow(db, tenantId, conversationId, actorName);
        if (!res.resumed) {
          throw new Error(
            res.reason === "conversation_closed"
              ? "Conversa já está finalizada e não pode ser retomada."
              : `Não foi possível retomar a triagem (${res.reason || "erro desconhecido"}).`,
          );
        }

        if (reason) {
          await db.insert(messages).values({
            id: `sys-mcp-resume-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
            tenantId,
            conversationId,
            senderType: "system",
            senderName: "Sistema",
            content: `${persona.name} retomado por ${actorName} — ${reason}`,
            isInternalNote: true,
            direction: "outbound",
            provider: "system",
            status: "accepted",
            metaDetails: {
              attendanceSkip: true,
              mcpOrchestratorAction: "resume_fagner_triage",
              actorName,
              reason,
            },
            sentAt: now,
            updatedAt: now,
          });
        }

        let recoveredCount: number | null = null;
        if (args.triggerRecovery !== false) {
          try {
            recoveredCount = await recoverIndustrialInterruptedTurns();
          } catch {
            recoveredCount = null;
          }
        }

        return {
          success: true,
          action: "resume",
          tenantId,
          conversationId,
          assistantName: persona.name,
          currentStep: res.currentStep || "Em Qualificação",
          queueState: "automacao",
          recoveredCount,
          actorName,
          reason: reason || null,
        };
      }

      await db
        .update(agentFlowStates)
        .set({
          outcome: "in_progress",
          currentStep: "Em Qualificação",
          completedAt: null,
          lastInteractionAt: now,
        })
        .where(
          and(
            eq(agentFlowStates.tenantId, tenantId),
            eq(agentFlowStates.conversationId, conversationId),
            eq(agentFlowStates.agentType, "sdr"),
          ),
        );
      await db
        .update(conversations)
        .set({ queueState: "automacao", operatorId: null, updatedAt: now })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)));

      return {
        success: true,
        action: "resume",
        tenantId,
        conversationId,
        assistantName: persona.name,
        currentStep: "Em Qualificação",
        queueState: "automacao",
        actorName,
        reason: reason || null,
      };
    }

    case "recover_fagner_stuck_turns": {
      if (persona.triagePolicy !== "industrial") {
        throw new Error(
          `recover_fagner_stuck_turns está disponível apenas para tenants com triagem industrial.`,
        );
      }
      const recoveredCount = await recoverIndustrialInterruptedTurns();
      return {
        success: true,
        tenantId,
        assistantName: persona.name,
        recoveredCount,
        triggeredAt: new Date().toISOString(),
      };
    }

    default:
      throw new Error(`Ferramenta de Orquestração SDR desconhecida: '${name}'.`);
  }
}
