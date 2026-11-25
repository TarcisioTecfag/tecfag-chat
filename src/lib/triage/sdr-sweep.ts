import { and, desc, eq, inArray, isNotNull, like, ne, not, sql } from "drizzle-orm";
import { agentFlowStates, contacts, conversations, messages, operators } from "../../db/schema";
import type { IndustrialDatabase } from "./industrial-rodizio-store";
import { getAiPersona } from "../ai-persona";
import { projectIndustrialMonitoring } from "./industrial-monitor";
import {
  isPostCloseCourtesyOnlyMessage,
  normalizeIndustrialFunnel,
} from "./industrial-policy";
import { isBotClosingOrInformativeMessage } from "./industrial-silence-policy";
import { isSiteConversationId } from "../livechat/site-channel-policy";

const SWEEP_CLOSED_INFORMATIVE_STEPS = new Set([
  "concluido (informativo)",
  "encerrado (sem interesse)",
  "ignorado (ura/bot externo)",
]);

const SWEEP_BOT_WAITING_CLIENT_RE =
  /\?|conseguiu ver minha [uú]ltima mensagem|vou deixar .* em aberto|quando quiser (?:continuar|retomar)/i;

export type SweepPendingBucket =
  | "skip_closed_informative"
  | "awaiting_ai_handoff_stuck"
  | "awaiting_ai_client_waiting"
  | "awaiting_client";

/**
 * Classifica com precisão uma triagem ainda em `automacao` (fora de `awaiting_approval`)
 * evitando falsos positivos de `awaiting_ai` quando:
 * - o fluxo já é informativo/encerrado (`5B_CURRICULO`, `5C_COMPRAS`, `Concluído (Informativo)`,
 *   `Encerrado (Sem interesse)`) ou o cliente apenas enviou cortesia final ("👍🙏", "ok");
 * - o estado está em `ready`, porém a última mensagem foi do próprio bot fazendo uma pergunta
 *   de confirmação ("Sua empresa é a X, certo?") ou follow-up de silêncio (aguarda o cliente!).
 */
export function classifySweepPendingBucket(params: {
  monitoringState?: string | null;
  currentStep?: string | null;
  subflow?: string | null;
  lastMessageSender?: "client" | "bot" | "agent" | null;
  lastMessageContent?: string | null;
}): SweepPendingBucket {
  const stepNorm = String(params.currentStep || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const subflowCode = String(params.subflow || "").trim().toUpperCase();
  const lastContent = String(params.lastMessageContent || "").trim();

  const isInformativeOrClosed =
    SWEEP_CLOSED_INFORMATIVE_STEPS.has(stepNorm) ||
    subflowCode === "5B_CURRICULO" ||
    subflowCode === "5C_COMPRAS";

  if (isInformativeOrClosed) {
    if (
      params.lastMessageSender !== "client" ||
      !lastContent ||
      isPostCloseCourtesyOnlyMessage(lastContent)
    ) {
      return "skip_closed_informative";
    }
  }

  if (
    params.lastMessageSender === "client" &&
    lastContent &&
    isPostCloseCourtesyOnlyMessage(lastContent) &&
    params.monitoringState !== "handoff_pending" &&
    params.monitoringState !== "waiting_for_team"
  ) {
    return "awaiting_client";
  }

  if (
    params.monitoringState === "handoff_pending" ||
    params.monitoringState === "waiting_for_team"
  ) {
    return "awaiting_ai_handoff_stuck";
  }

  if (params.monitoringState === "ready") {
    if (
      params.lastMessageSender === "bot" &&
      (SWEEP_BOT_WAITING_CLIENT_RE.test(lastContent) ||
        isBotClosingOrInformativeMessage(lastContent))
    ) {
      return "awaiting_client";
    }
    return "awaiting_ai_handoff_stuck";
  }

  if (params.lastMessageSender === "client") {
    return "awaiting_ai_client_waiting";
  }

  return "awaiting_client";
}

export type SdrSweepPeriod = "today" | "range" | "all";

export interface SdrSweepParams {
  period: SdrSweepPeriod;
  startDate?: string | null; // YYYY-MM-DD (Brasília)
  endDate?: string | null;   // YYYY-MM-DD (Brasília)
  channel?: "whatsapp" | "site";
  now?: Date;
}

export interface SdrSweepItem {
  flowId: string;
  conversationId: string;
  contactName: string;
  contactAvatar: string | null;
  phone: string;
  company: string;
  channel: "whatsapp" | "site";
  outcome: string;
  statusLabel: string;
  targetFunnel: string | null;
  operatorId: string | null;
  operatorName: string | null;
  startedAt: string;
  lastInteractionAt: string;
  lastMessageAt: string | null;
  lastMessageSender: "client" | "bot" | "agent" | null;
  lastMessagePreview: string | null;
  waitingMinutes: number | null;
  reason: string;
}

export interface SdrSweepOperatorBreakdown {
  operatorId: string | null;
  operatorName: string;
  operatorAvatar: string | null;
  count: number;
  funnels: Record<string, number>;
  items: SdrSweepItem[];
}

export interface SdrSweepResult {
  period: SdrSweepPeriod;
  rangeStartIso: string | null;
  rangeEndIso: string | null;
  generatedAt: string;
  timeZone: "America/Sao_Paulo";
  summary: {
    totalAnalyzed: number;
    awaitingClientCount: number;
    awaitingFagnerCount: number;
    awaitingApprovalCount: number;
    transferredCount: number;
    distinctOperatorsCount: number;
    manualWithoutCompletionCount: number;
    stoppedCount: number;
  };
  awaitingClient: SdrSweepItem[];
  awaitingFagner: SdrSweepItem[];
  awaitingApproval: SdrSweepItem[];
  transferred: SdrSweepItem[];
  transferredByOperator: SdrSweepOperatorBreakdown[];
}

const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

export function getBrtDateKeyFromDate(date: Date): string {
  const shifted = new Date(date.getTime() + BRT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveSweepDateRange(params: SdrSweepParams): {
  period: SdrSweepPeriod;
  startUtc: Date | null;
  endUtc: Date | null;
} {
  const now = params.now || new Date();
  const period: SdrSweepPeriod =
    params.period === "today" || params.period === "range" || params.period === "all"
      ? params.period
      : "today";

  if (period === "all") {
    return { period, startUtc: null, endUtc: null };
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (period === "today") {
    const todayBrt = getBrtDateKeyFromDate(now);
    return {
      period,
      startUtc: new Date(`${todayBrt}T00:00:00.000-03:00`),
      endUtc: new Date(`${todayBrt}T23:59:59.999-03:00`),
    };
  }

  const rawStart = params.startDate && dateRegex.test(params.startDate) ? params.startDate : null;
  const rawEnd = params.endDate && dateRegex.test(params.endDate) ? params.endDate : null;
  const fallbackToday = getBrtDateKeyFromDate(now);

  const effectiveStart = rawStart || rawEnd || fallbackToday;
  const effectiveEnd = rawEnd || rawStart || fallbackToday;
  const [fromDate, toDate] =
    effectiveStart <= effectiveEnd ? [effectiveStart, effectiveEnd] : [effectiveEnd, effectiveStart];

  return {
    period,
    startUtc: new Date(`${fromDate}T00:00:00.000-03:00`),
    endUtc: new Date(`${toDate}T23:59:59.999-03:00`),
  };
}

function cleanTargetFunnel(
  meta: Record<string, any>,
  collectedData: Record<string, any>,
): string | null {
  const rawMeta = typeof meta?.targetFunnel === "string" ? meta.targetFunnel.trim() : "";
  if (rawMeta && !/^aguardando/i.test(rawMeta)) return normalizeIndustrialFunnel(rawMeta);

  const entry = collectedData?.["SETOR / FUNIL DE DESTINO"];
  if (entry && entry.status === "filled" && typeof entry.value === "string") {
    const val = entry.value.trim();
    if (val && !/^aguardando/i.test(val)) return normalizeIndustrialFunnel(val);
  }
  return null;
}

function summarizePreview(content?: string | null): string | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[MEDIA:audio]")) return "🎵 Áudio";
  if (trimmed.startsWith("[MEDIA:image]")) return "📷 Imagem";
  if (trimmed.startsWith("[MEDIA:video]")) return "🎬 Vídeo";
  if (trimmed.startsWith("[MEDIA:document]")) return "📄 Documento";
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
}

function safeIso(val?: Date | string | null, fallback?: Date): string {
  if (val) {
    const d = val instanceof Date ? val : new Date(val);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return (fallback || new Date()).toISOString();
}

export async function runSdrSweep(
  database: IndustrialDatabase,
  tenantId: string,
  params: SdrSweepParams,
): Promise<SdrSweepResult> {
  const now = params.now || new Date();
  const { period, startUtc, endUtc } = resolveSweepDateRange({ ...params, now });
  const persona = getAiPersona(tenantId);
  const isIndustrial = persona.triagePolicy === "industrial";

  // 1. Carregar operadores do tenant em lote
  const tenantOps = await database
    .select({ id: operators.id, name: operators.name, avatar: operators.avatar })
    .from(operators)
    .where(eq(operators.tenantId, tenantId));

  const opsById = new Map<string, { id: string; name: string; avatar: string | null }>();
  const opsByName = new Map<string, { id: string; name: string; avatar: string | null }>();
  for (const op of tenantOps) {
    opsById.set(op.id, op);
    if (op.name) opsByName.set(op.name.trim().toLowerCase(), op);
  }

  // 2. Buscar último ciclo SDR por conversa do tenant (com recorte opcional de canal)
  const flowChannelCond =
    params.channel === "site"
      ? like(agentFlowStates.conversationId, "conv-lc-%")
      : params.channel === "whatsapp"
        ? not(like(agentFlowStates.conversationId, "conv-lc-%"))
        : undefined;
  const convChannelCond =
    params.channel === "site"
      ? like(conversations.id, "conv-lc-%")
      : params.channel === "whatsapp"
        ? not(like(conversations.id, "conv-lc-%"))
        : undefined;

  const latestFlowsSubquery = database
    .selectDistinctOn([agentFlowStates.conversationId])
    .from(agentFlowStates)
    .where(
      and(
        eq(agentFlowStates.tenantId, tenantId),
        eq(agentFlowStates.agentType, "sdr"),
        flowChannelCond,
      ),
    )
    .orderBy(
      agentFlowStates.conversationId,
      desc(agentFlowStates.startedAt),
      desc(agentFlowStates.id),
    )
    .as("latest_sdr_sweep_flows");

  const [flowRows, orphanAutomacaoConvs] = await Promise.all([
    database
      .select()
      .from(latestFlowsSubquery)
      .orderBy(desc(latestFlowsSubquery.lastInteractionAt), desc(latestFlowsSubquery.id))
      .limit(1000),
    database
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.queueState, "automacao"),
          convChannelCond,
        ),
      )
      .orderBy(desc(conversations.lastMessageTime))
      .limit(200),
  ]);

  // 3. Filtrar pelo período escolhido (verifica se startedAt, lastInteractionAt ou completedAt cai na janela)
  const inRange = (d?: Date | string | null): boolean => {
    if (!startUtc || !endUtc) return true;
    if (!d) return false;
    const ms = (d instanceof Date ? d : new Date(d)).getTime();
    if (Number.isNaN(ms)) return false;
    return ms >= startUtc.getTime() && ms <= endUtc.getTime();
  };

  const flowConvIds = new Set<string>();
  const filteredFlows = flowRows.filter((fs) => {
    flowConvIds.add(fs.conversationId);
    if (!startUtc || !endUtc) return true;
    return inRange(fs.startedAt) || inRange(fs.lastInteractionAt) || inRange(fs.completedAt);
  });

  const orphanConvs = orphanAutomacaoConvs.filter((c) => {
    if (flowConvIds.has(c.id)) return false;
    if (c.id === "tec-1" || c.id === "tec-2" || c.id === "val-1" || c.id === "val-2") return false;
    if (!startUtc || !endUtc) return true;
    return inRange(c.lastMessageTime) || inRange(c.createdAt);
  });

  const targetConvIds = [
    ...new Set([...filteredFlows.map((f) => f.conversationId), ...orphanConvs.map((c) => c.id)]),
  ];

  // 4. Batch fetch conversations, contacts e última mensagem real por conversa (ZERO N+1)
  const convMap = new Map<string, typeof conversations.$inferSelect>();
  const contactMap = new Map<string, typeof contacts.$inferSelect>();
  const lastMsgMap = new Map<
    string,
    { senderType: string; sentAt: Date; content: string }
  >();

  if (targetConvIds.length > 0) {
    const convRows = await database
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), inArray(conversations.id, targetConvIds)));

    const contactIds = new Set<string>();
    for (const c of convRows) {
      convMap.set(c.id, c);
      if (c.contactId) contactIds.add(c.contactId);
    }

    const [contactRows, lastMsgRows] = await Promise.all([
      contactIds.size > 0
        ? database
            .select()
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, [...contactIds])))
        : Promise.resolve([]),
      database
        .selectDistinctOn([messages.conversationId], {
          conversationId: messages.conversationId,
          senderType: messages.senderType,
          sentAt: messages.sentAt,
          content: messages.content,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            inArray(messages.conversationId, targetConvIds),
            eq(messages.isInternalNote, false),
            ne(messages.senderType, "system"),
            isNotNull(messages.sentAt),
          ),
        )
        .orderBy(messages.conversationId, desc(messages.sentAt), desc(messages.id)),
    ]);

    for (const ct of contactRows) {
      contactMap.set(ct.id, ct);
    }
    for (const lm of lastMsgRows) {
      lastMsgMap.set(lm.conversationId, {
        senderType: lm.senderType,
        sentAt: lm.sentAt,
        content: lm.content,
      });
    }
  }

  const awaitingClient: SdrSweepItem[] = [];
  const awaitingFagner: SdrSweepItem[] = [];
  const awaitingApproval: SdrSweepItem[] = [];
  const transferred: SdrSweepItem[] = [];
  let manualWithoutCompletionCount = 0;
  let stoppedCount = 0;

  const resolveOperator = (
    conv: typeof conversations.$inferSelect | undefined,
    meta: Record<string, any>,
  ): { id: string | null; name: string | null; avatar: string | null } => {
    const receiptOp = meta?.handoffReceipt?.result?.operator;
    const candidateId =
      (receiptOp?.id && String(receiptOp.id)) ||
      (conv?.operatorId && String(conv.operatorId)) ||
      (meta?.allocatedOperatorId && String(meta.allocatedOperatorId)) ||
      null;

    if (candidateId && opsById.has(candidateId)) {
      const found = opsById.get(candidateId)!;
      return { id: found.id, name: found.name, avatar: found.avatar };
    }

    const candidateName =
      (receiptOp?.name && String(receiptOp.name).trim()) ||
      (meta?.allocatedOperatorName && String(meta.allocatedOperatorName).trim()) ||
      null;

    if (candidateName) {
      const byName = opsByName.get(candidateName.toLowerCase());
      if (byName) return { id: byName.id, name: byName.name, avatar: byName.avatar };
      return { id: candidateId, name: candidateName, avatar: null };
    }

    return { id: null, name: null, avatar: null };
  };

  // 5. Classificar cada fluxo real
  for (const fs of filteredFlows) {
    const conv = convMap.get(fs.conversationId);
    const contact = conv ? contactMap.get(conv.contactId) : undefined;
    const meta = (fs.metadata as Record<string, any>) || {};
    const collected = (fs.collectedData as Record<string, any>) || {};
    const lastMsg = lastMsgMap.get(fs.conversationId);

    const monitoring = isIndustrial ? projectIndustrialMonitoring(fs, conv || null) : null;
    const targetFunnel = cleanTargetFunnel(meta, collected);
    const resolvedOp = resolveOperator(conv, meta);

    const channel: "whatsapp" | "site" = isSiteConversationId(fs.conversationId)
      ? "site"
      : "whatsapp";
    if (params.channel && channel !== params.channel) continue;

    const company =
      (typeof collected["EMPRESA"]?.value === "string" &&
      collected["EMPRESA"]?.status === "filled"
        ? collected["EMPRESA"].value
        : "") ||
      (contact?.cnpjDetails as any)?.razaoSocial ||
      (contact?.customFields as any)?.company ||
      "Empresa não informada";

    const lastMessageAtIso = lastMsg ? safeIso(lastMsg.sentAt, now) : null;
    const lastMessageSender: "client" | "bot" | "agent" | null =
      lastMsg?.senderType === "client"
        ? "client"
        : lastMsg?.senderType === "agent"
          ? "agent"
          : lastMsg
            ? "bot"
            : null;
    const waitingMinutes = lastMsg
      ? Math.max(0, Math.floor((now.getTime() - lastMsg.sentAt.getTime()) / 60000))
      : null;

    const baseItem = {
      flowId: fs.id,
      conversationId: fs.conversationId,
      contactName: contact?.name || collected["NOME COMPLETO"]?.value || "Contato WhatsApp",
      contactAvatar: contact?.avatar || null,
      phone: contact?.phone || "",
      company,
      channel,
      outcome: fs.outcome || "in_progress",
      targetFunnel,
      operatorId: resolvedOp.id,
      operatorName: resolvedOp.name,
      startedAt: safeIso(fs.startedAt, now),
      lastInteractionAt: safeIso(fs.lastInteractionAt || fs.startedAt, now),
      lastMessageAt: lastMessageAtIso,
      lastMessageSender,
      lastMessagePreview: summarizePreview(lastMsg?.content),
      waitingMinutes,
    };

    const isTransferredOrCompleted =
      fs.outcome === "transferred" ||
      fs.outcome === "completed" ||
      monitoring?.state === "transferred" ||
      monitoring?.state === "resolved";

    const isAbandoned =
      fs.outcome === "abandoned" ||
      meta.funnelStage === "sem_resposta" ||
      monitoring?.state === "no_response";

    const isStopped = fs.outcome === "stopped" || fs.outcome === "escalated";

    if (isTransferredOrCompleted) {
      transferred.push({
        ...baseItem,
        statusLabel: "Transferido",
        reason: targetFunnel
          ? `Encaminhado para ${targetFunnel}`
          : "Triagem concluída / transferida",
      });
      continue;
    }

    if (isAbandoned) {
      awaitingClient.push({
        ...baseItem,
        statusLabel: "Sem Resposta",
        reason: conv?.operatorId
          ? `Cliente não respondeu à triagem (assumido depois por ${resolvedOp.name || "operador"})`
          : "Cliente parou de responder durante a triagem",
      });
      continue;
    }

    if (isStopped) {
      stoppedCount += 1;
      continue;
    }

    // Fluxo ainda em andamento (in_progress)
    const isHumanWithoutCompletion = Boolean(
      conv && (conv.operatorId || conv.queueState === "meus" || conv.queueState === "finalizados"),
    );
    if (isHumanWithoutCompletion) {
      manualWithoutCompletionCount += 1;
      continue;
    }

    // Em automacao / triagem ativa
    if (monitoring?.state === "awaiting_approval") {
      const pending =
        meta?.pendingApproval && typeof meta.pendingApproval === "object"
          ? (meta.pendingApproval as Record<string, any>)
          : {};
      const suggestedOpName =
        (typeof pending.suggestedOperatorName === "string" && pending.suggestedOperatorName.trim()) ||
        (typeof pending.operatorName === "string" && pending.operatorName.trim()) ||
        baseItem.operatorName;
      const suggestedOpId =
        (typeof pending.suggestedOperatorId === "string" && pending.suggestedOperatorId.trim()) ||
        (typeof pending.operatorId === "string" && pending.operatorId.trim()) ||
        baseItem.operatorId;
      const suggestedFunnel =
        (typeof pending.targetFunnel === "string" && pending.targetFunnel.trim()) ||
        baseItem.targetFunnel;

      awaitingApproval.push({
        ...baseItem,
        operatorId: suggestedOpId || null,
        operatorName: suggestedOpName || null,
        targetFunnel: suggestedFunnel || null,
        statusLabel: monitoring.label || "Aguardando aprovação SDR",
        reason: suggestedFunnel
          ? `Triagem pronta para ${suggestedFunnel}${suggestedOpName ? ` (sugerido: ${suggestedOpName})` : ""} — aguardando aprovação humana SDR`
          : "Triagem concluída pela IA — aguardando aprovação humana SDR",
      });
      continue;
    }

    const pendingBucket = classifySweepPendingBucket({
      monitoringState: monitoring?.state || null,
      currentStep: fs.currentStep || null,
      subflow: typeof meta?.subflow === "string" ? meta.subflow : null,
      lastMessageSender,
      lastMessageContent: lastMsg?.content || null,
    });

    if (pendingBucket === "skip_closed_informative") {
      stoppedCount += 1;
    } else if (pendingBucket === "awaiting_ai_handoff_stuck") {
      awaitingFagner.push({
        ...baseItem,
        statusLabel: monitoring?.label || "Encaminhamento pendente",
        reason:
          monitoring?.state === "waiting_for_team"
            ? "Pronto para transferir, aguardando equipe disponível"
            : "Triagem pronta com encaminhamento pendente",
      });
    } else if (pendingBucket === "awaiting_ai_client_waiting") {
      awaitingFagner.push({
        ...baseItem,
        statusLabel: `Aguardando ${persona.name}`,
        reason: `Última mensagem foi do cliente sem resposta ${persona.gender === "female" ? "da" : "do"} ${persona.name}`,
      });
    } else {
      awaitingClient.push({
        ...baseItem,
        statusLabel: "Aguardando cliente",
        reason: `${persona.name} respondeu e aguarda retorno do cliente`,
      });
    }
  }

  // 6. Incluir conversas órfãs em queueState === "automacao" sem agentFlowStates
  for (const conv of orphanConvs) {
    const contact = contactMap.get(conv.contactId);
    const lastMsg = lastMsgMap.get(conv.id);
    const lastMessageSender: "client" | "bot" | "agent" | null =
      lastMsg?.senderType === "client"
        ? "client"
        : lastMsg?.senderType === "agent"
          ? "agent"
          : lastMsg
            ? "bot"
            : null;

    const item: SdrSweepItem = {
      flowId: `fs-auto-${conv.id}`,
      conversationId: conv.id,
      contactName: contact?.name || "Contato WhatsApp",
      contactAvatar: contact?.avatar || null,
      phone: contact?.phone || "",
      company:
        (contact?.cnpjDetails as any)?.razaoSocial ||
        (contact?.customFields as any)?.company ||
        "Empresa não informada",
      channel: isSiteConversationId(conv.id) ? "site" : "whatsapp",
      outcome: "in_progress",
      statusLabel: "Na fila de automação",
      targetFunnel: null,
      operatorId: null,
      operatorName: null,
      startedAt: safeIso(conv.createdAt, now),
      lastInteractionAt: safeIso(conv.lastMessageTime || conv.createdAt, now),
      lastMessageAt: lastMsg ? safeIso(lastMsg.sentAt, now) : null,
      lastMessageSender,
      lastMessagePreview: summarizePreview(lastMsg?.content),
      waitingMinutes: lastMsg
        ? Math.max(0, Math.floor((now.getTime() - lastMsg.sentAt.getTime()) / 60000))
        : null,
      reason:
        lastMessageSender === "client"
          ? `Conversa em automação sem resposta ${persona.gender === "female" ? "da" : "do"} ${persona.name}`
          : "Conversa em automação aguardando resposta do cliente",
    };

    if (lastMessageSender === "client" || !lastMsg) {
      awaitingFagner.push(item);
    } else {
      awaitingClient.push(item);
    }
  }

  // Ordenar cada lista (mais recentes / mais críticos primeiro)
  const sortByRecent = (a: SdrSweepItem, b: SdrSweepItem) =>
    Date.parse(b.lastMessageAt || b.lastInteractionAt) -
    Date.parse(a.lastMessageAt || a.lastInteractionAt);

  awaitingFagner.sort(sortByRecent);
  awaitingApproval.sort(sortByRecent);
  awaitingClient.sort(sortByRecent);
  transferred.sort(sortByRecent);

  // 7. Agrupar transferidos por operador ("Para quem foi transferido")
  const byOpMap = new Map<string, SdrSweepOperatorBreakdown>();
  for (const item of transferred) {
    const key = item.operatorId || `name:${item.operatorName || "unassigned"}`;
    let group = byOpMap.get(key);
    if (!group) {
      const opInfo = item.operatorId ? opsById.get(item.operatorId) : undefined;
      group = {
        operatorId: item.operatorId,
        operatorName: item.operatorName || "Sem operador atribuído",
        operatorAvatar: opInfo?.avatar || null,
        count: 0,
        funnels: {},
        items: [],
      };
      byOpMap.set(key, group);
    }
    group.count += 1;
    const funnelKey = item.targetFunnel || "Sem funil definido";
    group.funnels[funnelKey] = (group.funnels[funnelKey] || 0) + 1;
    group.items.push(item);
  }

  const transferredByOperator = [...byOpMap.values()].sort((a, b) => b.count - a.count);

  const totalAnalyzed =
    awaitingClient.length +
    awaitingFagner.length +
    awaitingApproval.length +
    transferred.length +
    manualWithoutCompletionCount +
    stoppedCount;

  return {
    period,
    rangeStartIso: startUtc ? startUtc.toISOString() : null,
    rangeEndIso: endUtc ? endUtc.toISOString() : null,
    generatedAt: now.toISOString(),
    timeZone: "America/Sao_Paulo",
    summary: {
      totalAnalyzed,
      awaitingClientCount: awaitingClient.length,
      awaitingFagnerCount: awaitingFagner.length,
      awaitingApprovalCount: awaitingApproval.length,
      transferredCount: transferred.length,
      distinctOperatorsCount: transferredByOperator.filter((o) => Boolean(o.operatorId)).length,
      manualWithoutCompletionCount,
      stoppedCount,
    },
    awaitingClient,
    awaitingFagner,
    awaitingApproval,
    transferred,
    transferredByOperator,
  };
}
