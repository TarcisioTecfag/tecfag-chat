import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { agentConfigs, agentFlowStates, contacts, conversations, operators, sectors } from "../../db/schema";
import {
  assessIndustrialReadiness,
  INDUSTRIAL_POLICY_VERSION,
  INDUSTRIAL_REVIEW_FUNNEL,
  normalizeIndustrialFunnel,
  isEligibleIndustrialOperator,
  type CollectedFields,
  type IndustrialRoute,
} from "./industrial-policy";
import {
  industrialHandoffMessage,
  industrialHandoffOutcome,
  type IndustrialHandoffResult,
} from "./industrial-handoff";
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
import { industrialDestinationKey, resolveIndustrialDestination } from "./industrial-settings";
import {
  IndustrialSettingsError,
  readIndustrialSettings,
  validateIndustrialDestination,
} from "./industrial-settings-store";
import {
  HandoffOperationalError,
  createHandoffIssue,
  recordHandoffIssue,
  type HandoffIssue,
  type HandoffIssueCode,
} from "./industrial-handoff-issues";
import type { MachineDecision } from "./industrial-decisor";
import { appendIndustrialJournal } from "./industrial-triage-journal-store";
import { setAttendanceActor } from "../attendance-events";
import { getAiPersona } from "../ai-persona";
import { readSiteContext, type SiteContext } from "../livechat/site-context";

export interface HandoffRequest {
  version: 1;
  cycle: string;
  route: IndustrialRoute;
  data: CollectedFields;
  clientName: string;
  companyName: string;
  preparedAt: string;
  machineDecision?: MachineDecision;
  siteContext?: SiteContext | null;
}
export interface HandoffReceipt {
  cycle: string;
  committedAt: string;
  result: IndustrialStoredResult;
}
export interface HandoffOutbox {
  cycle: string;
  operatorNotificationRequired: boolean;
  operatorNotifiedAt: string | null;
  clientConfirmationRequired: boolean;
  clientConfirmationText: string | null;
  clientNotifiedAt: string | null;
  attempts: number;
  nextAttemptAt: string;
  operatorCancelledAt?: string | null;
  clientCancelledAt?: string | null;
  cancellationReason?: "owner_changed" | "conversation_closed";
  operatorIssue?: HandoffIssue | null;
  clientIssue?: HandoffIssue | null;
}
type HandoffMetadata = Record<string, unknown> & {
  handoffRequest?: HandoffRequest;
  handoffReceipt?: HandoffReceipt;
  handoffOutbox?: HandoffOutbox;
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
  async function deferPolicy(
    tx: IndustrialTransaction,
    key: IndustrialFlowKey,
    state: NonNullable<Awaited<ReturnType<typeof lockFlow>>>,
    code: HandoffIssueCode,
  ) {
    await tx
      .update(agentFlowStates)
      .set({
        metadata: {
          ...state.meta,
          ...recordHandoffIssue(state.meta, key.cycle, code),
          handoffNextAttemptAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
      })
      .where(and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)));
  }
  async function persist(
    tx: IndustrialTransaction,
    key: IndustrialFlowKey,
    state: NonNullable<Awaited<ReturnType<typeof lockFlow>>>,
    result: IndustrialHandoffResult,
    metadata: HandoffMetadata,
  ) {
    const outcome = industrialHandoffOutcome(result.status);
    const [updated] = await tx
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
      .where(and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)))
      .returning();
    if (updated)
      await appendIndustrialJournal(
        tx,
        state.flow,
        updated,
        "handoff",
        state.flow.lastInteractionAt.toISOString(),
      );
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
        siteContext?: SiteContext | null;
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
        const [prepared] = await tx
          .update(agentFlowStates)
          .set({
            collectedData: input.data,
            currentStep: "Encaminhamento pendente",
            outcome: "in_progress",
            lastInteractionAt: new Date(),
            completedAt: null,
            metadata: {
              ...state.meta,
              ...(readSiteContext(input.siteContext)
                ? { siteContext: readSiteContext(input.siteContext) }
                : {}),
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
              handoffIssue: null,
              ...(input.machineDecision ? { machineDecision: input.machineDecision } : {}),
              handoffAttempts: 0,
              handoffNextAttemptAt: new Date().toISOString(),
            },
          })
          .where(
            and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
          )
          .returning();
        if (prepared)
          await appendIndustrialJournal(
            tx,
            state.flow,
            prepared,
            "collection",
            state.flow.lastInteractionAt.toISOString(),
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
          await setAttendanceActor(tx, key.tenantId, getAiPersona(key.tenantId).name, null);
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
          if (options.signal?.aborted) throw new HandoffOperationalError("processing_cancelled");
          if (cfg?.enabled !== 1) {
            await deferPolicy(tx, key, state, "sdr_disabled");
            return { status: "handoff_failed", ...empty, superseded: true };
          }
          const [contact] = await tx
            .select()
            .from(contacts)
            .where(and(eq(contacts.tenantId, key.tenantId), eq(contacts.id, state.conv.contactId)));
          if (!contact) throw new HandoffOperationalError("contact_missing");
          const settings = cfg.config as Record<string, unknown>;
          const siteContact = contact.mainChannel === "livechat";
          if (siteContact && settings.siteChannelEnabled !== true) {
            await tx
              .update(agentFlowStates)
              .set({
                metadata: {
                  ...state.meta,
                  ...recordHandoffIssue(state.meta, key.cycle, "site_channel_disabled"),
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
                    ...recordHandoffIssue(state.meta, key.cycle, "whitelist_restricted"),
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
          let pendingIssue: HandoffIssueCode | null = null;
          if (readiness.action === "inform") result = { status: "resolved", ...empty };
          else if (
            request.route.reason === "direct_operator_requested" &&
            request.route.targetOperator?.id
          ) {
            const registered = await tx
              .select({ id: operators.id, name: operators.name, status: operators.status })
              .from(operators)
              .where(eq(operators.tenantId, key.tenantId))
              .for("share");
            const targetOp = registered.find((op) => op.id === request.route.targetOperator?.id);
            const config = (rodizio?.config || {}) as RodizioConfig;
            const all = Array.isArray(config.flowOperators) ? config.flowOperators : [];
            if (new Set(all.map((op) => op.id)).size !== all.length)
              throw new HandoffOperationalError("rodizio_invalid");

            if (!targetOp) {
              result = { status: "waiting_for_team", ...empty };
              pendingIssue = "no_eligible_operator";
            } else {
              const flowOp = all.find((op) => op.id === targetOp.id);
              const isAbsent = Boolean(
                request.route.targetOperator.isAbsent ||
                  flowOp?.isOnLeave === true ||
                  targetOp.status === "ausente",
              );
              const operator = {
                id: targetOp.id,
                name: targetOp.name,
                isAbsent,
              };
              const tenantSectors = await tx
                .select({ id: sectors.id, operatorIds: sectors.operatorIds })
                .from(sectors)
                .where(eq(sectors.tenantId, key.tenantId));
              const matchedSector =
                tenantSectors.find(
                  (s) => Array.isArray(s.operatorIds) && s.operatorIds.includes(operator.id),
                ) || tenantSectors[0];
              const resolvedSectorId = matchedSector?.id || state.conv.sectorId || undefined;

              if (options.signal?.aborted)
                throw new HandoffOperationalError("processing_cancelled");

              const [assigned] = await tx
                .update(conversations)
                .set({
                  operatorId: operator.id,
                  ...(resolvedSectorId ? { sectorId: resolvedSectorId } : {}),
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
              if (!assigned) throw new HandoffOperationalError("assignment_failed");

              await tx
                .update(contacts)
                .set({ walletOperatorId: operator.id, responsibleName: operator.name })
                .where(and(eq(contacts.tenantId, key.tenantId), eq(contacts.id, contact.id)));

              if (rodizio) {
                const inFlow = all.some((op) => op.id === operator.id);
                const next = inFlow
                  ? all.map((op) =>
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
                    )
                  : [
                      ...all,
                      {
                        id: operator.id,
                        name: operator.name,
                        isParticipating: true,
                        isOnLeave: isAbsent,
                        isPenalized: false,
                        area: "maquinas",
                        funnels: request.route.targetFunnel
                          ? [request.route.targetFunnel]
                          : ["Máquinas"],
                        compensation: 0,
                        leadsReceivedCount: 1,
                        recentLeads: [
                          {
                            chatId: key.conversationId,
                            clientName: request.clientName,
                            receivedAt: new Date().toISOString(),
                          },
                        ],
                      },
                    ];
                await writeIndustrialRodizio(tx, key.tenantId, rodizio.id, {
                  ...config,
                  flowOperators: next,
                });
              }

              result = {
                status: "transferred",
                operator,
                deal: null,
                conversationVersion: assigned.version,
                sectorId: resolvedSectorId,
              };
            }
          } else {
            const configuration = await readIndustrialSettings(tx, key.tenantId, true);
            const machine = request.machineDecision;
            const isCommercial = ["MAQUINAS", "PERSONNALITE"].includes(request.route.subflow || "");
            const validCatalogDecision =
              machine?.status === "confirmed" &&
              (machine.line === "SEMI-INDUSTRIAL" || machine.line === "PERSONNALITE") &&
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
            const resolvedDestination = destinationKey
              ? resolveIndustrialDestination(configuration.settings, destinationKey)
              : null;
            if (resolvedDestination?.conflict)
              throw new HandoffOperationalError("destination_conflict");
            const destination = resolvedDestination?.destination;
            if (!destination) throw new HandoffOperationalError("destination_unconfigured");
            const reviewCreatesDeal =
              readiness.action === "review" &&
              Boolean(destination.pipelineId && destination.stageId);
            const shouldCreateDeal = readiness.createsDeal || reviewCreatesDeal;
            if (shouldCreateDeal && (!destination.pipelineId || !destination.stageId))
              throw new HandoffOperationalError("destination_pipeline_invalid");
            const sector = await validateIndustrialDestination(tx, key.tenantId, destination);
            const funnel =
              readiness.action === "review"
                ? INDUSTRIAL_REVIEW_FUNNEL
                : request.route.targetFunnel &&
                  normalizeIndustrialFunnel(request.route.targetFunnel);
            const registered = await tx
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(eq(operators.tenantId, key.tenantId))
              .for("share");
            const ids = new Set(registered.map((op) => op.id));
            const config = (rodizio?.config || {}) as RodizioConfig;
            const all = Array.isArray(config.flowOperators) ? config.flowOperators : [];
            if (new Set(all.map((op) => op.id)).size !== all.length)
              throw new HandoffOperationalError("rodizio_invalid");
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
            if (!chosen || !rodizio) {
              result = { status: "waiting_for_team", ...empty };
              pendingIssue = rodizio ? "no_eligible_operator" : "rodizio_unconfigured";
            } else {
              const operator = {
                id: chosen.id,
                name: registered.find((op) => op.id === chosen.id)!.name,
              };
              const deal = shouldCreateDeal
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
                      targetFunnel: funnel!,
                      funnelStage:
                        readiness.action === "review" ? "outros" : request.route.funnelStage,
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
                      destination: shouldCreateDeal
                        ? { pipelineId: destination.pipelineId!, stageId: destination.stageId! }
                        : undefined,
                    },
                    tx,
                  ).catch(() => {
                    throw new HandoffOperationalError("crm_failed");
                  })
                : null;
              if (shouldCreateDeal && (!deal?.success || !deal.dealId))
                throw new HandoffOperationalError("crm_failed");
              if (options.signal?.aborted)
                throw new HandoffOperationalError("processing_cancelled");
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
              if (!assigned) throw new HandoffOperationalError("assignment_failed");
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
            ...(pendingIssue
              ? recordHandoffIssue(state.meta, key.cycle, pendingIssue)
              : { handoffIssue: null }),
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
            const committedIso = new Date().toISOString();
            const confirmationText = industrialHandoffMessage(
              result.status,
              result.operator?.name,
              {
                isOperatorAbsent: Boolean(
                  result.operator?.isAbsent || request.route.targetOperator?.isAbsent,
                ),
              },
            );
            meta.handoffReceipt = {
              cycle: key.cycle,
              committedAt: committedIso,
              result,
            };
            meta.handoffOutbox = {
              cycle: key.cycle,
              operatorNotificationRequired: Boolean(
                result.status === "transferred" && result.operator?.id,
              ),
              operatorNotifiedAt: null,
              clientConfirmationRequired: Boolean(
                result.status === "transferred" && confirmationText,
              ),
              clientConfirmationText: confirmationText,
              clientNotifiedAt: null,
              attempts: 0,
              nextAttemptAt: new Date(Date.now() + (options.recovery ? 0 : 25_000)).toISOString(),
            };
          }
          await persist(tx, key, state, result, meta);
          return result;
        });
      } catch (error) {
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
              ...recordHandoffIssue(
                state.meta,
                key.cycle,
                error instanceof HandoffOperationalError
                  ? error.issueCode
                  : error instanceof IndustrialSettingsError
                    ? error.diagnosticCode
                    : "transaction_failed",
              ),
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
    /** Reserva tentativa de entrega pós-commit (aviso ao operador e confirmação ao cliente). */
    async claimPostCommitOutbox(
      key: IndustrialFlowKey,
      options: { immediate?: boolean } = {},
    ): Promise<{
      receipt: HandoffReceipt;
      outbox: HandoffOutbox;
      request?: HandoffRequest;
      needOperatorNotification: boolean;
      needClientConfirmation: boolean;
    } | null> {
      return database.transaction(async (tx) => {
        const state = await lockFlow(tx, key);
        if (!state) return null;
        const receipt = state.meta.handoffReceipt;
        const outbox = state.meta.handoffOutbox;
        if (!receipt || receipt.cycle !== key.cycle || !outbox || outbox.cycle !== key.cycle) {
          return null;
        }
        const assignedOpId = receipt.result.operator?.id || null;
        const humanChanged =
          state.conv.queueState === "finalizados" ||
          Boolean(
            assignedOpId &&
            (state.conv.operatorId !== assignedOpId || state.conv.queueState !== "meus"),
          );
        const nowIso = new Date().toISOString();
        if (humanChanged) {
          await tx
            .update(agentFlowStates)
            .set({
              metadata: {
                ...state.meta,
                handoffOutbox: {
                  ...outbox,
                  clientCancelledAt:
                    outbox.clientCancelledAt ||
                    (!outbox.clientNotifiedAt && outbox.clientConfirmationRequired ? nowIso : null),
                  operatorCancelledAt:
                    outbox.operatorCancelledAt ||
                    (!outbox.operatorNotifiedAt && outbox.operatorNotificationRequired
                      ? nowIso
                      : null),
                  cancellationReason:
                    state.conv.queueState === "finalizados"
                      ? "conversation_closed"
                      : "owner_changed",
                },
              },
            })
            .where(
              and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
            );
          return null;
        }
        const attemptCount =
          Number.isSafeInteger(outbox.attempts) && outbox.attempts >= 0 ? outbox.attempts : 0;
        if (
          attemptCount >= 6 ||
          (!(options.immediate && !attemptCount) &&
            Date.parse(outbox.nextAttemptAt || "") > Date.now())
        )
          return null;

        const needOperatorNotification = Boolean(
          outbox.operatorNotificationRequired === true &&
          !outbox.operatorNotifiedAt &&
          !outbox.operatorCancelledAt &&
          assignedOpId,
        );
        const needClientConfirmation = Boolean(
          outbox.clientConfirmationRequired === true &&
          !outbox.clientNotifiedAt &&
          !outbox.clientCancelledAt &&
          outbox.clientConfirmationText &&
          !humanChanged,
        );

        if (!needOperatorNotification && !needClientConfirmation) {
          return null;
        }

        const attempts = attemptCount + 1;
        const updatedOutbox: HandoffOutbox = {
          ...outbox,
          attempts,
          nextAttemptAt: new Date(
            Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 5)),
          ).toISOString(),
        };
        await tx
          .update(agentFlowStates)
          .set({
            metadata: {
              ...state.meta,
              handoffOutbox: updatedOutbox,
            },
          })
          .where(
            and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
          );

        return {
          receipt,
          outbox: updatedOutbox,
          request: state.meta.handoffRequest,
          needOperatorNotification,
          needClientConfirmation,
        };
      });
    },
    /** Confirma a entrega dos avisos pós-commit para não reexecutar no worker. */
    async ackPostCommit(
      key: IndustrialFlowKey,
      ack: { operatorNotified?: boolean; clientNotified?: boolean },
    ): Promise<boolean> {
      if (!ack.operatorNotified && !ack.clientNotified) return false;
      return database.transaction(async (tx) => {
        const state = await lockFlow(tx, key);
        if (!state) return false;
        const outbox = state.meta.handoffOutbox;
        if (!outbox || outbox.cycle !== key.cycle) return false;
        const nowIso = new Date().toISOString();
        const updatedOutbox: HandoffOutbox = {
          ...outbox,
          operatorNotifiedAt: ack.operatorNotified
            ? outbox.operatorNotifiedAt || nowIso
            : outbox.operatorNotifiedAt,
          clientNotifiedAt: ack.clientNotified
            ? outbox.clientNotifiedAt || nowIso
            : outbox.clientNotifiedAt,
          operatorIssue: ack.operatorNotified ? null : outbox.operatorIssue,
          clientIssue: ack.clientNotified ? null : outbox.clientIssue,
        };
        await tx
          .update(agentFlowStates)
          .set({
            metadata: {
              ...state.meta,
              handoffOutbox: updatedOutbox,
            },
          })
          .where(
            and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
          );
        return true;
      });
    },
    async recordPostCommitFailure(
      key: IndustrialFlowKey,
      failure: { operatorFailed?: boolean; clientFailed?: boolean },
    ): Promise<boolean> {
      if (!failure.operatorFailed && !failure.clientFailed) return false;
      return database.transaction(async (tx) => {
        const state = await lockFlow(tx, key);
        const outbox = state?.meta.handoffOutbox;
        if (
          !state ||
          !outbox ||
          outbox.cycle !== key.cycle ||
          state.meta.handoffReceipt?.cycle !== key.cycle
        )
          return false;
        const updated = { ...outbox };
        if (
          failure.operatorFailed &&
          outbox.operatorNotificationRequired &&
          !outbox.operatorNotifiedAt &&
          !outbox.operatorCancelledAt
        )
          updated.operatorIssue = createHandoffIssue(
            "operator_notification_failed",
            key.cycle,
            outbox.operatorIssue,
          );
        if (
          failure.clientFailed &&
          outbox.clientConfirmationRequired &&
          !outbox.clientNotifiedAt &&
          !outbox.clientCancelledAt
        )
          updated.clientIssue = createHandoffIssue(
            "client_confirmation_failed",
            key.cycle,
            outbox.clientIssue,
          );
        await tx
          .update(agentFlowStates)
          .set({ metadata: { ...state.meta, handoffOutbox: updated } })
          .where(
            and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
          );
        return true;
      });
    },
  };
}
