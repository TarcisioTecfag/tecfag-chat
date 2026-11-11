import crypto from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  agentConfigs,
  agentFlowStates,
  contacts,
  conversations,
  messages,
  operators,
  sectors,
} from "../../db/schema";
import { getAiPersona, isSdrTenant } from "../ai-persona";
import { setAttendanceActor } from "../attendance-events";
import {
  getBrtTodayYmd,
  isOperatorOnLeaveToday,
  type FlowOperator,
} from "../valentina/rodizio-types";
import {
  INDUSTRIAL_REVIEW_FUNNEL,
  normalizeIndustrialFunnel,
  normalizeTriageText,
} from "./industrial-policy";
import {
  lockIndustrialRodizio,
  writeIndustrialRodizio,
  type IndustrialDatabase,
  type IndustrialTransaction,
  type RodizioConfig,
} from "./industrial-rodizio-store";
import { INDUSTRIAL_SETTINGS_AGENT } from "./industrial-settings";

function normalizeOperatorMatchName(rawName: string = ""): string {
  return rawName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*-\s*\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_REVIEW_FUNNEL = normalizeTriageText(INDUSTRIAL_REVIEW_FUNNEL);

/**
 * Verifica se um operador da escala local (Fluxos) pertence e está elegível
 * para a fila "SDR / Análise" (pasta `outros` / `sdr` ou funil `Análise e revisão humana`).
 */
export function isSdrAnalysisFlowOperator(
  flowOp: Partial<FlowOperator> & { id: string; name?: string },
  todayBrt: string = getBrtTodayYmd(),
): boolean {
  if ((flowOp.isParticipating ?? true) !== true) return false;
  if (isOperatorOnLeaveToday(flowOp as FlowOperator, todayBrt)) return false;
  if (flowOp.isPenalized === true) return false;

  const normArea = normalizeTriageText(flowOp.area || "");
  const inSdrArea = normArea === "outros" || normArea === "sdr";

  const funnels = Array.isArray(flowOp.funnels) ? flowOp.funnels : [];
  const hasReviewFunnel = funnels.some((rawFunnel) => {
    if (typeof rawFunnel !== "string") return false;
    const mapped = normalizeTriageText(normalizeIndustrialFunnel(rawFunnel));
    const rawNorm = normalizeTriageText(rawFunnel);
    return (
      mapped === NORMALIZED_REVIEW_FUNNEL ||
      rawNorm === "sdr" ||
      rawNorm === "sdr analise" ||
      rawNorm === "analise e revisao humana"
    );
  });

  // Se estiver na pasta "SDR / Análise" com outros funis selecionados sem "Análise e revisão humana",
  // ainda é membro explícito da pasta SDR / Análise no painel Fluxos.
  return inSdrArea || hasReviewFunnel;
}

/**
 * Verifica se o agente SDR de IA está habilitado para o tenant informado.
 * Espelha a regra oficial do SdrEngine: em política industrial, exige `enabled === 1` explícito.
 */
export async function isSdrEnabledForTenant(
  database: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
): Promise<boolean> {
  if (!isSdrTenant(tenantId)) return false;
  const industrialTriage = getAiPersona(tenantId).triagePolicy === "industrial";
  const [sdrConfig] = await database
    .select({ enabled: agentConfigs.enabled })
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
    .limit(1);

  return sdrConfig ? sdrConfig.enabled === 1 : !industrialTriage;
}

export interface SdrDisabledRoutingInput {
  tenantId: string;
  conversationId: string;
  contactId?: string | null;
  clientName?: string | null;
  noteSentAt?: Date;
}

export interface SdrDisabledRoutingResult {
  routed: boolean;
  mode:
    | "assigned_sdr_analysis"
    | "assigned_wallet"
    | "queued_fallback"
    | "skipped";
  reason?: string;
  conversation: typeof conversations.$inferSelect | null;
  operator: { id: string; name: string } | null;
  sectorId: string | null;
  systemMessageId: string | null;
}

async function resolveSdrAnalysisSectorId(
  tx: IndustrialTransaction,
  tenantId: string,
  chosenOperatorId: string | null,
): Promise<string | null> {
  const [tenantSectors, triageSettingsRows] = await Promise.all([
    tx
      .select({
        id: sectors.id,
        name: sectors.name,
        operatorIds: sectors.operatorIds,
      })
      .from(sectors)
      .where(eq(sectors.tenantId, tenantId))
      .orderBy(asc(sectors.name)),
    tx
      .select({ config: agentConfigs.config })
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.tenantId, tenantId),
          eq(agentConfigs.agentType, INDUSTRIAL_SETTINGS_AGENT),
        ),
      )
      .limit(1),
  ]);

  if (tenantSectors.length === 0) return null;

  const rawSettings = (triageSettingsRows[0]?.config as Record<string, any> | undefined) || {};
  const rawDestinations = (rawSettings.destinations as Record<string, any> | undefined) || {};
  const configuredReviewSectorId =
    rawDestinations.REVIEW?.sectorId || rawDestinations["5A_CLIENTE"]?.sectorId || null;

  const configuredReviewSector = configuredReviewSectorId
    ? tenantSectors.find((sec) => sec.id === configuredReviewSectorId) || null
    : null;

  const sdrNamedSector =
    tenantSectors.find((sec) => {
      const n = normalizeTriageText(sec.name || "");
      return n === "sdr" || n.includes("sdr") || n.includes("triagem") || n.includes("analise");
    }) || null;

  if (chosenOperatorId) {
    if (
      configuredReviewSector &&
      Array.isArray(configuredReviewSector.operatorIds) &&
      configuredReviewSector.operatorIds.includes(chosenOperatorId)
    ) {
      return configuredReviewSector.id;
    }
    if (
      sdrNamedSector &&
      Array.isArray(sdrNamedSector.operatorIds) &&
      sdrNamedSector.operatorIds.includes(chosenOperatorId)
    ) {
      return sdrNamedSector.id;
    }
    const operatorMemberSector =
      tenantSectors.find(
        (sec) => Array.isArray(sec.operatorIds) && sec.operatorIds.includes(chosenOperatorId),
      ) || null;
    if (operatorMemberSector) {
      return operatorMemberSector.id;
    }
  }

  return configuredReviewSector?.id ?? sdrNamedSector?.id ?? null;
}

/**
 * Executa, dentro de uma transação aberta, o direcionamento automático do atendimento
 * para quem estiver configurado e ativo em "SDR / Análise" quando o SDR IA estiver desativado.
 * Caso nenhum operador de "SDR / Análise" esteja elegível no momento, envia para `fila` (Fila Humana).
 */
export async function routeWhenSdrDisabledInTx(
  tx: IndustrialTransaction,
  input: SdrDisabledRoutingInput,
): Promise<SdrDisabledRoutingResult> {
  const { tenantId, conversationId } = input;
  const persona = getAiPersona(tenantId);

  if (persona.triagePolicy !== "industrial") {
    return {
      routed: false,
      mode: "skipped",
      reason: "non_industrial_policy",
      conversation: null,
      operator: null,
      sectorId: null,
      systemMessageId: null,
    };
  }

  if (await isSdrEnabledForTenant(tx, tenantId)) {
    return {
      routed: false,
      mode: "skipped",
      reason: "sdr_enabled",
      conversation: null,
      operator: null,
      sectorId: null,
      systemMessageId: null,
    };
  }

  // Serializa o rodízio por tenant para distribuição justa em mensagens simultâneas
  const rodizioRow = await lockIndustrialRodizio(tx, tenantId);

  const [conv] = await tx
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.id, conversationId),
        isNull(conversations.whatsappConnectionId),
      ),
    )
    .for("update");

  if (!conv) {
    return {
      routed: false,
      mode: "skipped",
      reason: "conversation_not_found",
      conversation: null,
      operator: null,
      sectorId: null,
      systemMessageId: null,
    };
  }

  if (
    conv.operatorId !== null ||
    conv.queueState === "meus" ||
    conv.queueState === "finalizados"
  ) {
    return {
      routed: false,
      mode: "skipped",
      reason: "already_assigned_or_closed",
      conversation: conv,
      operator: null,
      sectorId: conv.sectorId ?? null,
      systemMessageId: null,
    };
  }

  const resolvedContactId = input.contactId || conv.contactId;
  const [contactRow] = resolvedContactId
    ? await tx
        .select({
          id: contacts.id,
          name: contacts.name,
          walletOperatorId: contacts.walletOperatorId,
          responsibleName: contacts.responsibleName,
        })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, resolvedContactId)))
        .for("update")
    : [];

  const dbOperators = await tx
    .select({
      id: operators.id,
      name: operators.name,
      email: operators.email,
    })
    .from(operators)
    .where(eq(operators.tenantId, tenantId))
    .orderBy(asc(operators.name));

  // Se o cliente já possuir dono de carteira válido no tenant, preserva a carteira sem consumir vaga do SDR
  if (contactRow?.walletOperatorId) {
    const walletOp = dbOperators.find((o) => o.id === contactRow.walletOperatorId);
    if (walletOp) {
      await setAttendanceActor(
        tx as any,
        tenantId,
        `Automação (${persona.name} Inativo -> Carteira)`,
        walletOp.id,
      );
      const now = new Date();
      const [updatedWalletConv] = await tx
        .update(conversations)
        .set({
          operatorId: walletOp.id,
          queueState: "meus",
          version: sql`${conversations.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conv.id)))
        .returning();

      if (contactRow.responsibleName !== walletOp.name) {
        await tx
          .update(contacts)
          .set({ responsibleName: walletOp.name })
          .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactRow.id)));
      }

      return {
        routed: true,
        mode: "assigned_wallet",
        conversation: updatedWalletConv || conv,
        operator: { id: walletOp.id, name: walletOp.name },
        sectorId: conv.sectorId ?? null,
        systemMessageId: null,
      };
    }
  }

  const rodizioConfig = ((rodizioRow?.config as RodizioConfig | undefined) || {}) as RodizioConfig;
  const flowOperators = Array.isArray(rodizioConfig.flowOperators)
    ? rodizioConfig.flowOperators
    : [];
  const todayBrt = getBrtTodayYmd();

  const matchDbOperator = (flowOp: FlowOperator) => {
    const normFlowName = normalizeOperatorMatchName(flowOp.name || "");
    const flowEmail = (flowOp.email || "").toLowerCase().trim();
    return (
      dbOperators.find((o) => o.id === flowOp.id) ||
      (flowEmail
        ? dbOperators.find((o) => (o.email || "").toLowerCase().trim() === flowEmail)
        : undefined) ||
      (normFlowName
        ? dbOperators.find((o) => normalizeOperatorMatchName(o.name) === normFlowName)
        : undefined)
    );
  };

  interface EligibleCandidate {
    flowIndex: number;
    flowOp: FlowOperator;
    resolvedOperator: { id: string; name: string };
    leadsReceivedCount: number;
    compensation: number;
  }

  const seenOperatorIds = new Set<string>();
  const eligibleCandidates: EligibleCandidate[] = [];

  for (let idx = 0; idx < flowOperators.length; idx++) {
    const flowOp = flowOperators[idx];
    if (!flowOp || !isSdrAnalysisFlowOperator(flowOp, todayBrt)) continue;
    const resolvedDbOp = matchDbOperator(flowOp);
    if (!resolvedDbOp) continue;
    if (seenOperatorIds.has(resolvedDbOp.id)) continue;
    seenOperatorIds.add(resolvedDbOp.id);

    eligibleCandidates.push({
      flowIndex: idx,
      flowOp,
      resolvedOperator: { id: resolvedDbOp.id, name: resolvedDbOp.name },
      leadsReceivedCount: Number(flowOp.leadsReceivedCount || 0),
      compensation: Number(flowOp.compensation || 0),
    });
  }

  eligibleCandidates.sort(
    (a, b) =>
      a.leadsReceivedCount -
        a.compensation -
        (b.leadsReceivedCount - b.compensation) ||
      a.leadsReceivedCount - b.leadsReceivedCount ||
      a.resolvedOperator.id.localeCompare(b.resolvedOperator.id),
  );

  const chosen = eligibleCandidates[0] || null;
  const now = new Date();
  const noteTimestamp = input.noteSentAt || now;
  const displayClientName =
    (input.clientName || contactRow?.name || "Cliente").trim() || "Cliente";

  if (chosen) {
    const resolvedSectorId = await resolveSdrAnalysisSectorId(
      tx,
      tenantId,
      chosen.resolvedOperator.id,
    );

    await setAttendanceActor(
      tx as any,
      tenantId,
      `Automação (${persona.name} Inativo -> SDR / Análise)`,
      chosen.resolvedOperator.id,
    );

    const [updatedConv] = await tx
      .update(conversations)
      .set({
        operatorId: chosen.resolvedOperator.id,
        sectorId: resolvedSectorId,
        queueState: "meus",
        version: sql`${conversations.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.id, conv.id),
          isNull(conversations.operatorId),
        ),
      )
      .returning();

    if (!updatedConv) {
      return {
        routed: false,
        mode: "skipped",
        reason: "concurrent_assignment",
        conversation: conv,
        operator: null,
        sectorId: conv.sectorId ?? null,
        systemMessageId: null,
      };
    }

    if (contactRow) {
      await tx
        .update(contacts)
        .set({
          walletOperatorId: chosen.resolvedOperator.id,
          responsibleName: chosen.resolvedOperator.name,
        })
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactRow.id)));
    }

    if (rodizioRow) {
      const updatedFlowOperators = flowOperators.map((op, index) =>
        index !== chosen.flowIndex
          ? op
          : {
              ...op,
              id: chosen.resolvedOperator.id,
              name: chosen.resolvedOperator.name,
              compensation: Math.max(0, Number(op.compensation || 0) - 1),
              leadsReceivedCount: Number(op.leadsReceivedCount || 0) + 1,
              recentLeads: [
                {
                  chatId: conv.id,
                  clientName: displayClientName,
                  receivedAt: now.toISOString(),
                },
                ...(Array.isArray(op.recentLeads) ? op.recentLeads : []).slice(0, 9),
              ],
            },
      );

      await writeIndustrialRodizio(tx, tenantId, rodizioRow.id, {
        ...rodizioConfig,
        flowOperators: updatedFlowOperators,
      });
    }

    const systemMessageId = `sys-sdr-off-${crypto
      .createHash("sha256")
      .update(`${tenantId}:${conv.id}:${updatedConv.version}:${chosen.resolvedOperator.id}`)
      .digest("hex")
      .slice(0, 24)}`;

    await tx
      .insert(messages)
      .values({
        id: systemMessageId,
        tenantId,
        conversationId: conv.id,
        senderType: "system",
        senderName: "Sistema",
        content: `Atendimento direcionado automaticamente para ${chosen.resolvedOperator.name} (SDR / Análise) — ${persona.name} desativado.`,
        isInternalNote: true,
        direction: "outbound",
        provider: "system",
        status: "accepted",
        metaDetails: {
          attendanceSkip: true,
          sdrDisabledFallback: true,
          targetArea: "outros",
          targetFunnel: INDUSTRIAL_REVIEW_FUNNEL,
          allocatedOperatorId: chosen.resolvedOperator.id,
          allocatedOperatorName: chosen.resolvedOperator.name,
        },
        sentAt: noteTimestamp,
        updatedAt: now,
      })
      .onConflictDoNothing();

    return {
      routed: true,
      mode: "assigned_sdr_analysis",
      conversation: updatedConv,
      operator: chosen.resolvedOperator,
      sectorId: resolvedSectorId,
      systemMessageId,
    };
  }

  // Fallback seguro quando não há operador elegível em SDR / Análise: envia para Fila Humana (nunca preso em Bot)
  const fallbackSectorId = await resolveSdrAnalysisSectorId(tx, tenantId, null);
  const wasAlreadyInFila =
    conv.queueState === "fila" &&
    conv.operatorId === null &&
    (conv.sectorId ?? null) === fallbackSectorId;

  await setAttendanceActor(
    tx as any,
    tenantId,
    `Automação (${persona.name} Inativo -> Fila)`,
    null,
  );

  const [queuedConv] = await tx
    .update(conversations)
    .set({
      operatorId: null,
      sectorId: fallbackSectorId,
      queueState: "fila",
      version: sql`${conversations.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.id, conv.id),
        isNull(conversations.operatorId),
      ),
    )
    .returning();

  if (contactRow && contactRow.responsibleName !== "Na Fila") {
    await tx
      .update(contacts)
      .set({ responsibleName: "Na Fila" })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactRow.id)));
  }

  let systemMessageId: string | null = null;
  if (!wasAlreadyInFila && queuedConv) {
    systemMessageId = `sys-sdr-off-fila-${crypto
      .createHash("sha256")
      .update(`${tenantId}:${conv.id}:${queuedConv.version}`)
      .digest("hex")
      .slice(0, 24)}`;

    await tx
      .insert(messages)
      .values({
        id: systemMessageId,
        tenantId,
        conversationId: conv.id,
        senderType: "system",
        senderName: "Sistema",
        content: `Atendimento encaminhado para a Fila Humana (nenhum operador ativo em SDR / Análise no momento) — ${persona.name} desativado.`,
        isInternalNote: true,
        direction: "outbound",
        provider: "system",
        status: "accepted",
        metaDetails: {
          attendanceSkip: true,
          sdrDisabledFallback: true,
          targetArea: "outros",
          fallbackQueue: "fila",
        },
        sentAt: noteTimestamp,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  return {
    routed: Boolean(queuedConv),
    mode: "queued_fallback",
    conversation: queuedConv || conv,
    operator: null,
    sectorId: fallbackSectorId,
    systemMessageId,
  };
}

/**
 * Wrapper transacional para uso fora de transações existentes.
 */
export async function routeWhenSdrDisabled(
  database: IndustrialDatabase | IndustrialTransaction,
  input: SdrDisabledRoutingInput,
): Promise<SdrDisabledRoutingResult> {
  return database.transaction((tx) => routeWhenSdrDisabledInTx(tx, input));
}

/**
 * Dispara notificações pós-commit (SSE queue_update + vínculo/card em Funil SDR + aviso interno ao operador).
 */
export async function deliverSdrDisabledRoutingEffects(params: {
  tenantId: string;
  routing: SdrDisabledRoutingResult;
  contactId?: string | null;
  clientName?: string | null;
  interestText?: string | null;
}): Promise<void> {
  const { tenantId, routing, contactId, clientName, interestText } = params;
  if (!routing.routed || !routing.conversation) return;

  const conv = routing.conversation;
  const persona = getAiPersona(tenantId);

  try {
    const { SessionManager } = await import("../baileys/session-manager");
    SessionManager.getInstance().notifyPublic(tenantId, {
      type: "queue_update",
      conversationId: conv.id,
      contactId: contactId || conv.contactId,
      contactName: clientName || undefined,
      queueState: conv.queueState,
      operatorId: conv.operatorId,
      walletOperatorId: routing.operator?.id ?? null,
      sectorId: conv.sectorId,
      version: conv.version,
      responsibleName: routing.operator?.name || "Na Fila",
    });
  } catch (sseErr: any) {
    console.warn("[SdrDisabledRouting] Falha ao emitir queue_update SSE:", sseErr?.message);
  }

  if (routing.mode === "assigned_sdr_analysis" && routing.operator) {
    try {
      const { notifyOperatorLeadTransferred } = await import(
        "../valentina/operator-notifications"
      );
      await notifyOperatorLeadTransferred({
        tenantId,
        conversationId: conv.id,
        operatorId: routing.operator.id,
        operatorName: routing.operator.name,
        clientName: clientName || "Cliente WhatsApp",
        interest: (interestText || "").trim().slice(0, 280) || "Atendimento recebido via WhatsApp",
        targetFunnel: "SDR / Análise",
        temperature: "morno",
        transferSource: "rodizio_reassignment",
        cycle: routing.systemMessageId || `sdr-disabled:${conv.id}:${conv.version}`,
        triageBriefing: `Atendimento recebido com o *${persona.name}* desativado e direcionado automaticamente para a fila de *SDR / Análise* (${INDUSTRIAL_REVIEW_FUNNEL}).`,
      });
    } catch (notifErr: any) {
      console.warn(
        "[SdrDisabledRouting] Falha ao notificar operador de SDR / Análise:",
        notifErr?.message,
      );
    }
  }
}

/**
 * Quando o administrador desativa o SDR IA em tempo de execução, varre eventuais conversas
 * órfãs que estavam em `automacao` (sem operador humano) neste tenant e as direciona para `SDR / Análise`.
 */
export async function sweepUnassignedAutomacaoWhenSdrDisabled(
  database: IndustrialDatabase,
  tenantId: string,
  options: {
    deliverEffects?: typeof deliverSdrDisabledRoutingEffects | null;
  } = {},
): Promise<{ sweptCount: number }> {
  if (getAiPersona(tenantId).triagePolicy !== "industrial") {
    return { sweptCount: 0 };
  }
  if (await isSdrEnabledForTenant(database, tenantId)) {
    return { sweptCount: 0 };
  }

  const strandedRows = await database
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      lastMessageText: conversations.lastMessageText,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.queueState, "automacao"),
        isNull(conversations.operatorId),
        isNull(conversations.whatsappConnectionId),
      ),
    )
    .orderBy(asc(conversations.lastMessageTime));

  if (strandedRows.length === 0) return { sweptCount: 0 };

  let SdrDebouncerRef: { clearSession: (id: string) => void } | null = null;
  try {
    const mod = await import("../valentina/sdr-debouncer");
    SdrDebouncerRef = mod.SdrDebouncer.getInstance();
  } catch {
    SdrDebouncerRef = null;
  }

  let sweptCount = 0;
  for (const row of strandedRows) {
    SdrDebouncerRef?.clearSession(row.id);

    const { routing, contactName } = await database.transaction(async (tx) => {
      // Interrompe eventual estado de fluxo em progresso para evitar retomada indevida
      await tx
        .update(agentFlowStates)
        .set({
          outcome: "stopped",
          currentStep: "Encaminhado (SDR Desativado)",
          completedAt: new Date(),
          lastInteractionAt: new Date(),
        })
        .where(
          and(
            eq(agentFlowStates.tenantId, tenantId),
            eq(agentFlowStates.conversationId, row.id),
            eq(agentFlowStates.outcome, "in_progress"),
          ),
        );

      const [cRow] = row.contactId
        ? await tx
            .select({ name: contacts.name })
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, row.contactId)))
            .limit(1)
        : [];

      const res = await routeWhenSdrDisabledInTx(tx, {
        tenantId,
        conversationId: row.id,
        contactId: row.contactId,
        clientName: cRow?.name || "Cliente",
      });
      return { routing: res, contactName: cRow?.name || "Cliente" };
    });

    if (routing.routed) {
      sweptCount++;
      const runner =
        options.deliverEffects === undefined
          ? deliverSdrDisabledRoutingEffects
          : options.deliverEffects;
      if (runner) {
        await runner({
          tenantId,
          routing,
          contactId: row.contactId,
          clientName: contactName,
          interestText: row.lastMessageText,
        });
      }
    }
  }

  return { sweptCount };
}
