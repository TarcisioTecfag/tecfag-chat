import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { agentConfigs, agentFlowStates, contacts, conversations, operators } from "../../db/schema";
import {
  assessIndustrialReadiness,
  INDUSTRIAL_POLICY_VERSION,
  isEligibleIndustrialOperator,
  type CollectedFields,
  type IndustrialRoute,
} from "./industrial-policy";
import { industrialHandoffOutcome, type IndustrialHandoffResult } from "./industrial-handoff";
import {
  lockIndustrialRodizio,
  writeIndustrialRodizio,
  type IndustrialDatabase,
  type IndustrialTransaction,
  type RodizioConfig,
} from "./industrial-rodizio-store";
import type {
  EnsureLocalCrmDealParams,
  EnsureLocalCrmDealResult,
} from "../valentina/sdr-crm-local";
import { industrialDestinationKey } from "./industrial-settings";
import { readIndustrialSettings, validateIndustrialDestination } from "./industrial-settings-store";
import type { MachineDecision } from "./industrial-decisor";

interface HandoffRequest {
  version: 1;
  cycle: string;
  route: IndustrialRoute;
  data: CollectedFields;
  clientName: string;
  companyName: string;
  preparedAt: string;
  machineDecision?: MachineDecision;
}
interface HandoffReceipt {
  cycle: string;
  committedAt: string;
  result: IndustrialStoredResult;
}
type HandoffMetadata = Record<string, unknown> & {
  handoffRequest?: HandoffRequest;
  handoffReceipt?: HandoffReceipt;
  handoffAttempts?: number;
  handoffNextAttemptAt?: string;
};
export interface IndustrialStoredResult extends IndustrialHandoffResult {
  conversationVersion?: number;
  sectorId?: string;
  destinationRevision?: number;
  replayed?: boolean;
  superseded?: boolean;
}
export interface IndustrialFlowKey {
  tenantId: string;
  conversationId: string;
  flowId: string;
  cycle: string;
}
const empty = { operator: null, deal: null };
const finished = new Set(["transferred", "completed", "stopped", "abandoned", "escalated"]);

export function createIndustrialHandoffStore(
  database: IndustrialDatabase,
  ensureDeal: (
    params: EnsureLocalCrmDealParams,
    tx: IndustrialTransaction,
  ) => Promise<EnsureLocalCrmDealResult>,
) {
  // Conversation -> flow: mesmo ordenamento em preparação e efetivação.
  async function lockFlow(tx: IndustrialTransaction, key: IndustrialFlowKey) {
    const [conv] = await tx
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.tenantId, key.tenantId), eq(conversations.id, key.conversationId)),
      )
      .for("update");
    const [flow] = await tx
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, key.tenantId),
          eq(agentFlowStates.id, key.flowId),
          eq(agentFlowStates.conversationId, key.conversationId),
          eq(agentFlowStates.agentType, "sdr"),
        ),
      )
      .for("update");
    const [latest] = await tx
      .select({ id: agentFlowStates.id })
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, key.tenantId),
          eq(agentFlowStates.conversationId, key.conversationId),
          eq(agentFlowStates.agentType, "sdr"),
        ),
      )
      .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
      .limit(1);
    if (!conv || !flow || flow.startedAt.toISOString() !== key.cycle || latest?.id !== key.flowId)
      return null;
    return { conv, flow, meta: flow.metadata as HandoffMetadata };
  }
  function ownsAutomation(conv: typeof conversations.$inferSelect) {
    return !conv.operatorId && conv.queueState !== "meus" && conv.queueState !== "finalizados";
  }
  async function persist(
    tx: IndustrialTransaction,
    key: IndustrialFlowKey,
    state: NonNullable<Awaited<ReturnType<typeof lockFlow>>>,
    result: IndustrialHandoffResult,
    metadata: HandoffMetadata,
  ) {
    const outcome = industrialHandoffOutcome(result.status);
    await tx
      .update(agentFlowStates)
      .set({
        collectedData: metadata.handoffRequest?.data || state.flow.collectedData,
        metadata: { ...metadata, handoffStatus: result.status },
        outcome,
        completedAt: outcome === "in_progress" ? null : new Date(),
        lastInteractionAt: new Date(),
        currentStep:
          result.status === "transferred" || result.status === "resolved"
            ? "Concluído"
            : result.status === "waiting_for_team"
              ? "Aguardando equipe"
              : "Encaminhamento pendente",
      })
      .where(and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)));
  }
  return {
    /** Checkpoint durável separado: se o processo cair antes do commit, o worker retoma sem IA. */
    async prepare(
      key: IndustrialFlowKey,
      input: {
        route: IndustrialRoute;
        data: CollectedFields;
        clientName: string;
        companyName: string;
        machineDecision?: MachineDecision;
      },
    ): Promise<boolean> {
      return database.transaction(async (tx) => {
        const state = await lockFlow(tx, key);
        if (!state || !ownsAutomation(state.conv) || finished.has(state.flow.outcome || ""))
          return false;
        if (!assessIndustrialReadiness(input.route, input.data).ready) return false;
        if (state.meta.handoffReceipt?.cycle === key.cycle) return false;
        // A primeira conclusão do ciclo é imutável até transferir/cancelar; retries não trocam o destino.
        if (state.meta.handoffRequest?.cycle === key.cycle) return true;
        const request: HandoffRequest = {
          version: 1,
          ...input,
          cycle: key.cycle,
          preparedAt: new Date().toISOString(),
        };
        await tx
          .update(agentFlowStates)
          .set({
            collectedData: input.data,
            currentStep: "Encaminhamento pendente",
            outcome: "in_progress",
            lastInteractionAt: new Date(),
            completedAt: null,
            metadata: {
              ...state.meta,
              triagePolicyVersion: INDUSTRIAL_POLICY_VERSION,
              subflow: input.route.subflow,
              targetFunnel: input.route.targetFunnel,
              funnelStage: input.route.funnelStage,
              needsReview: input.route.needsReview,
              routeReason: input.route.reason,
              missingFields: [],
              readyForHandoff: true,
              handoffStatus: "handoff_failed",
              handoffRequest: request,
              ...(input.machineDecision ? { machineDecision: input.machineDecision } : {}),
              handoffAttempts: 0,
              handoffNextAttemptAt: new Date().toISOString(),
            },
          })
          .where(
            and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
          );
        return true;
      });
    },
    async execute(
      key: IndustrialFlowKey,
      options: { signal?: AbortSignal; recovery?: boolean } = {},
    ): Promise<IndustrialStoredResult> {
      try {
        return await database.transaction(async (tx): Promise<IndustrialStoredResult> => {
          // Reserva por tenant, não por processo. Abrange seleção, CRM, carteira, contador e recibo.
          const rodizio = await lockIndustrialRodizio(tx, key.tenantId);
          const state = await lockFlow(tx, key);
          if (!state) return { status: "handoff_failed", ...empty, superseded: true };
          const receipt = state.meta.handoffReceipt;
          if (receipt?.cycle === key.cycle) return { ...receipt.result, replayed: true };
          if (!ownsAutomation(state.conv) && !finished.has(state.flow.outcome || "")) {
            await tx
              .update(agentFlowStates)
              .set({
                outcome: "escalated",
                currentStep: "Atendimento assumido",
                completedAt: new Date(),
                metadata: { ...state.meta, handoffStatus: "superseded", readyForHandoff: false },
              })
              .where(
                and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
              );
          }
          if (!ownsAutomation(state.conv) || finished.has(state.flow.outcome || ""))
            return { status: "handoff_failed", ...empty, superseded: true };
          const request = state.meta.handoffRequest;
          if (!request || request.version !== 1 || request.cycle !== key.cycle)
            return { status: "collecting", ...empty, superseded: true };
          if (options.recovery && Date.parse(state.meta.handoffNextAttemptAt || "") > Date.now())
            return { status: "handoff_failed", ...empty, superseded: true };
          const [cfg] = await tx
            .select()
            .from(agentConfigs)
            .where(and(eq(agentConfigs.tenantId, key.tenantId), eq(agentConfigs.agentType, "sdr")))
            .for("share");
          if (cfg?.enabled !== 1 || options.signal?.aborted)
            return { status: "handoff_failed", ...empty, superseded: true };
          const [contact] = await tx
            .select()
            .from(contacts)
            .where(and(eq(contacts.tenantId, key.tenantId), eq(contacts.id, state.conv.contactId)));
          if (!contact) throw new Error("Contato não pertence ao tenant");
          const settings = cfg.config as Record<string, unknown>;
          const siteContact = contact.mainChannel === "livechat";
          if (siteContact && settings.siteChannelEnabled !== true) {
            await tx
              .update(agentFlowStates)
              .set({
                metadata: {
                  ...state.meta,
                  handoffNextAttemptAt: new Date(Date.now() + 15 * 60_000).toISOString(),
                },
              })
              .where(
                and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
              );
            return { status: "handoff_failed", ...empty, superseded: true };
          }
          if (!siteContact && settings.whitelistEnabled === true) {
            const normalizePhone = (phone: string) =>
              phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
            if (
              !contact.phone ||
              normalizePhone(contact.phone) !==
                normalizePhone(String(settings.whitelistPhone || ""))
            ) {
              // Não monopoliza o lote do worker enquanto a whitelist estiver restrita.
              await tx
                .update(agentFlowStates)
                .set({
                  metadata: {
                    ...state.meta,
                    handoffNextAttemptAt: new Date(Date.now() + 15 * 60_000).toISOString(),
                  },
                })
                .where(
                  and(
                    eq(agentFlowStates.tenantId, key.tenantId),
                    eq(agentFlowStates.id, key.flowId),
                  ),
                );
              return { status: "handoff_failed", ...empty, superseded: true };
            }
          }
          let readiness = assessIndustrialReadiness(request.route, request.data);
          if (!readiness.ready) return { status: "collecting", ...empty, superseded: true };
          let result: IndustrialStoredResult;
          if (readiness.action === "inform") result = { status: "resolved", ...empty };
          else {
            const configuration = await readIndustrialSettings(tx, key.tenantId, true);
            const machine = request.machineDecision;
            const isCommercial = ["MAQUINAS", "PERSONNALITE"].includes(request.route.subflow || "");
            const validCatalogDecision =
              machine?.status === "confirmed" &&
              machine.line === "SEMI-INDUSTRIAL" &&
              Number.isFinite(machine.confidence) &&
              machine.confidence >= 0.95 &&
              machine.confidence <= 1 &&
              machine.catalogFingerprint === configuration.catalogFingerprint &&
              configuration.settings.catalog.some(
                (entry) =>
                  entry.active && entry.id === machine.machineId && entry.line === machine.line,
              );
            if (isCommercial && !validCatalogDecision)
              readiness = { ...readiness, action: "review", createsDeal: false };
            const destinationKey =
              readiness.action === "review" ? "REVIEW" : industrialDestinationKey(request.route);
            const destination = destinationKey
              ? configuration.settings.destinations[destinationKey]
              : null;
            if (!destination)
              throw new Error("Vincule o setor de destino na configuração industrial");
            const sector = await validateIndustrialDestination(tx, key.tenantId, destination);
            const funnel =
              readiness.action === "review" ? "Atendimento Geral" : request.route.targetFunnel;
            const registered = await tx
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(eq(operators.tenantId, key.tenantId))
              .for("share");
            const ids = new Set(registered.map((op) => op.id));
            const config = (rodizio?.config || {}) as RodizioConfig;
            const all = Array.isArray(config.flowOperators) ? config.flowOperators : [];
            if (new Set(all.map((op) => op.id)).size !== all.length)
              throw new Error("Operador duplicado na escala");
            const eligible = all.filter(
              (op) =>
                funnel &&
                sector.operatorIds.includes(op.id) &&
                isEligibleIndustrialOperator(op, funnel, ids),
            );
            eligible.sort(
              (a, b) =>
                (a.leadsReceivedCount || 0) -
                  (a.compensation || 0) -
                  ((b.leadsReceivedCount || 0) - (b.compensation || 0)) ||
                (a.leadsReceivedCount || 0) - (b.leadsReceivedCount || 0) ||
                a.id.localeCompare(b.id),
            );
            const chosen = eligible[0];
            if (!chosen || !rodizio) result = { status: "waiting_for_team", ...empty };
            else {
              const operator = {
                id: chosen.id,
                name: registered.find((op) => op.id === chosen.id)!.name,
              };
              const deal = readiness.createsDeal
                ? await ensureDeal(
                    {
                      tenantId: key.tenantId,
                      conversationId: key.conversationId,
                      contactId: contact.id,
                      contactPhone: contact.phone || "",
                      clientName: request.clientName,
                      companyName: request.companyName,
                      targetOperatorId: operator.id,
                      targetOperatorName: operator.name,
                      targetFunnel: request.route.targetFunnel!,
                      funnelStage: request.route.funnelStage,
                      collectedData: Object.fromEntries(
                        Object.entries(request.data).map(([name, field]) => [
                          name,
                          {
                            value: field.value || "",
                            status:
                              field.status === "filled"
                                ? ("filled" as const)
                                : ("pending" as const),
                          },
                        ]),
                      ),
                      requireConfiguredPipeline: true,
                      reuseScope: "person_and_funnel",
                      destination: readiness.createsDeal
                        ? { pipelineId: destination.pipelineId!, stageId: destination.stageId! }
                        : undefined,
                    },
                    tx,
                  )
                : null;
              if (readiness.createsDeal && (!deal?.success || !deal.dealId))
                throw new Error("Negociação não confirmada");
              if (options.signal?.aborted) throw new Error("Processamento cancelado");
              const [assigned] = await tx
                .update(conversations)
                .set({
                  operatorId: operator.id,
                  sectorId: sector.id,
                  queueState: "meus",
                  version: sql`${conversations.version} + 1`,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(conversations.tenantId, key.tenantId),
                    eq(conversations.id, key.conversationId),
                    isNull(conversations.operatorId),
                    ne(conversations.queueState, "meus"),
                    ne(conversations.queueState, "finalizados"),
                  ),
                )
                .returning({ id: conversations.id, version: conversations.version });
              if (!assigned) throw new Error("Atribuição não confirmada");
              await tx
                .update(contacts)
                .set({ walletOperatorId: operator.id, responsibleName: operator.name })
                .where(and(eq(contacts.tenantId, key.tenantId), eq(contacts.id, contact.id)));
              const next = all.map((op) =>
                op.id !== operator.id
                  ? op
                  : {
                      ...op,
                      compensation: Math.max(0, (op.compensation || 0) - 1),
                      leadsReceivedCount: (op.leadsReceivedCount || 0) + 1,
                      recentLeads: [
                        {
                          chatId: key.conversationId,
                          clientName: request.clientName,
                          receivedAt: new Date().toISOString(),
                        },
                        ...(op.recentLeads || []).slice(0, 9),
                      ],
                    },
              );
              await writeIndustrialRodizio(tx, key.tenantId, rodizio.id, {
                ...config,
                flowOperators: next,
              });
              result = {
                status: "transferred",
                operator,
                deal,
                conversationVersion: assigned.version,
                sectorId: sector.id,
                destinationRevision: configuration.revision,
              };
            }
          }
          const attempts = (state.meta.handoffAttempts || 0) + 1;
          const meta: HandoffMetadata = {
            ...state.meta,
            needsReview: readiness.action === "review",
            handoffAttempts: attempts,
            handoffNextAttemptAt: new Date(
              Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 5)),
            ).toISOString(),
            ...(result.operator
              ? {
                  allocatedOperatorId: result.operator.id,
                  allocatedOperatorName: result.operator.name,
                }
              : {}),
            ...(result.deal
              ? {
                  localCrmDealId: result.deal.dealId,
                  localCrmDealTitle: result.deal.dealTitle,
                  localCrmDealAction: result.deal.action,
                }
              : {}),
          };
          if (result.status === "transferred" || result.status === "resolved") {
            meta.handoffReceipt = {
              cycle: key.cycle,
              committedAt: new Date().toISOString(),
              result,
            };
          }
          await persist(tx, key, state, result, meta);
          return result;
        });
      } catch {
        // A transação anterior já reverteu TODOS os efeitos. Só a pendência é registrada agora.
        await database.transaction(async (tx) => {
          const state = await lockFlow(tx, key);
          if (
            !state ||
            state.meta.handoffReceipt?.cycle === key.cycle ||
            !ownsAutomation(state.conv) ||
            finished.has(state.flow.outcome || "")
          )
            return;
          const attempts = (state.meta.handoffAttempts || 0) + 1;
          await persist(
            tx,
            key,
            state,
            { status: "handoff_failed", ...empty },
            {
              ...state.meta,
              handoffAttempts: attempts,
              handoffNextAttemptAt: new Date(
                Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 5)),
              ).toISOString(),
            },
          );
        });
        return { status: "handoff_failed", ...empty };
      }
    },
  };
}
