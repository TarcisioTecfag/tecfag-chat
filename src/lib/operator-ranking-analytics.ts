import { and, desc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { db } from "../db";
import {
  accessGroups,
  aiConversationAudits,
  commercialConsultantProfiles,
  commercialSettings,
  commercialTransferResponseEvents,
  conversations,
  crmDeals,
  messages,
  operatorDailyMetrics,
  operators,
  responseTimeLogs,
  sectors,
} from "../db/schema";
import { computeOperatorPresenceSnapshot, getBrtDateKey } from "./operator-presence";

const BOILERPLATE_SYSTEM_RE =
  /^(Contato criado\.?|Contato criado\.\s*Aguardando captura do atendimento\.?|Atendimento iniciado\.?|Conversa iniciada\.?|Aguardando captura do atendimento\.?)$/i;

const PT_WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function formatSecondsPt(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return "–";
  }
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (mins < 60) {
    return secs > 0 ? `${mins}min ${secs}s` : `${mins}min`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}min`;
}

function formatDurationCompact(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

function formatLastSeenBrt(isoOrDate: string | Date | null | undefined, todayBrt: string): string {
  if (!isoOrDate) return "Sem acesso recente";
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "Sem acesso recente";
  const dateBrt = getBrtDateKey(d);
  const timeStr = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  if (dateBrt === todayBrt) {
    return `Hoje às ${timeStr}`;
  }
  const [y, m, day] = dateBrt.split("-");
  return `${day}/${m} às ${timeStr}`;
}

export function getBrtHour(date: Date): number {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).format(date);
  const parsed = parseInt(hourStr, 10);
  return Number.isNaN(parsed) ? 0 : parsed % 24;
}

export function buildLastNDaysBrt(now: Date, n: number): { dateKey: string; label: string }[] {
  const result: { dateKey: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateKey = getBrtDateKey(d);
    const [year, month, day] = dateKey.split("-").map(Number);
    const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const weekday = PT_WEEKDAYS[utcNoon.getUTCDay()] ?? "Dia";
    result.push({
      dateKey,
      label: i === 0 ? `${weekday}` : weekday,
    });
  }
  return result;
}

export function buildTodayHourSlotsBrt(now: Date): { hour: number; label: string }[] {
  const currentHour = getBrtHour(now);
  // Janela de 8 horas encerrando na hora atual (mínimo 08h..15h se for cedo)
  const endHour = Math.max(15, Math.min(22, currentHour));
  const startHour = Math.max(0, endHour - 7);
  const slots: { hour: number; label: string }[] = [];
  for (let h = startHour; h <= endHour; h++) {
    slots.push({
      hour: h,
      label: `${String(h).padStart(2, "0")}h`,
    });
  }
  return slots;
}

export type ResponseCycle = {
  operatorId: string;
  conversationId: string;
  clientSentAt: Date;
  agentSentAt: Date;
  dateBrt: string;
  hourBrt: number;
  responseSeconds: number;
  isOverdue: boolean;
};

export type ActiveWaitingTurn = {
  operatorId: string;
  conversationId: string;
  clientSentAt: Date;
  dateBrt: string;
  waitingSeconds: number;
  isOverdue: boolean;
};

export type EnrichedOperatorOverviewMetric = {
  operatorId: string;
  operatorName: string;
  operatorAvatar: string | null;
  status: string;
  isOnline: boolean;
  presenceLabel: "ONLINE" | "EM ATENDIMENTO" | "EM PAUSA" | "OFFLINE";
  lastSeenAt: string | null;
  usageSecondsToday: number;
  roleSubtitle: string;
  scoreSourceLabel: "Auditoria IA" | "Índice Operacional" | "Sem dados";

  totalConversations: number;
  yesterdayConversations: number;
  vsYesterdayDelta: number;
  vsYesterdayLabel: string;
  vsYesterdayPositive: boolean;
  monthlyConversations: number;
  avgDailyConversations7d: number;
  conversationsNote: string;

  avgResponseTimeSeconds: number | null;
  avgResponseTimeFormatted: string;
  avgResponseTime7dFormatted: string;
  avgResponseTimeLastWeekFormatted: string;
  avgResponseTimeLastMonthFormatted: string;
  tmaNote: string;
  slaTargetMinutes: number;
  slaPct: number | null;
  slaNote: string;

  overdueCount: number;
  overdueCountLastWeek: number;
  overdueCountLastMonth: number;

  avgPerformanceScore: number | null;
  avgPerformanceScoreLastWeek: number | null;
  avgPerformanceScoreLastMonth: number | null;
  sentimentScore10: number | null;
  sentimentLabel: string;
  sentimentNote: string;
  satisfiedCount: number;
  neutralCount: number;
  frustratedCount: number;
  satisfiedPctLastWeek: number;
  satisfiedPctLastMonth: number;

  conversionRatePct: number;
  conversionDisplay: string;
  conversionNote: string;
  totalDealsCount: number;
  openDealsCount: number;
  wonDealsCount: number;
  lostDealsCount: number;
  openPipelineValue: number;
  wonPipelineValue: number;

  monthlyVolumePct: number;
  retentionOrResolutionPct: number;
  retentionLabel: string;
  crmWalletPct: number;

  monthlyRank: number;
  totalRankedOperators: number;
  monthlyRankNote: string;

  horasLabels: string[];
  horasSla: number[];
  horasSentimento: number[];
  horasConversao: number[];
  horasScore: number[];

  diasLabels: string[];
  diasAtendimentos: number[];
  diasTmaMin: number[];
  diasAtrasados: number[];
  diasRanking: number[];

  trafficLight: "green" | "yellow" | "red" | "gray";
};

export type ComputedHistoryDay = {
  id: string;
  date: string;
  totalConversations: number;
  avgResponseTimeSeconds: number | null;
  avgResponseTimeFormatted: string;
  overdueCount: number;
  avgPerformanceScore: number | null;
  satisfiedPct: number;
  satisfiedCount: number;
  neutralCount: number;
  frustratedCount: number;
};

export async function computeOperatorsOverviewAnalytics(params: {
  tenantId: string;
  viewerOperatorId: string;
  readScope: any;
  allOperators: {
    id: string;
    name: string;
    email?: string;
    role?: string;
    status: string;
    avatar: string | null;
    groupId?: string | null;
    isOnline?: boolean | null;
    lastSeenAt?: Date | string | null;
    usageDate?: string | null;
    usageSecondsToday?: number | null;
  }[];
}): Promise<{
  todayBrt: string;
  avgResponseSecondsToday: number | null;
  teamPerformanceScore: number | null;
  overdueAlertsCount: number;
  operators: EnrichedOperatorOverviewMetric[];
}> {
  const { tenantId, viewerOperatorId, readScope, allOperators } = params;
  const now = new Date();
  const nowMs = now.getTime();
  const todayBrt = getBrtDateKey(now);
  const yesterdayBrt = getBrtDateKey(new Date(nowMs - 24 * 60 * 60 * 1000));
  const last7Days = buildLastNDaysBrt(now, 7);
  const last7DateKeys = last7Days.map((d) => d.dateKey);
  const diasLabels = last7Days.map((d) => d.label);
  const hourSlots = buildTodayHourSlotsBrt(now);
  const horasLabels = hourSlots.map((s) => s.label);

  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoStr = last7DateKeys[0];
  const thirtyDaysAgoStr = getBrtDateKey(thirtyDaysAgo);

  const opIds = allOperators.map((o) => o.id);
  if (opIds.length === 0) {
    return {
      todayBrt,
      avgResponseSecondsToday: null,
      teamPerformanceScore: null,
      overdueAlertsCount: 0,
      operators: [],
    };
  }

  // 1. Configurações de SLA, Grupos de Acesso, Setores e Perfis Comerciais
  const [settingsRows, groupsRows, sectorsRows, profilesRows] = await Promise.all([
    db
      .select({ slaLimitMinutes: commercialSettings.slaLimitMinutes })
      .from(commercialSettings)
      .where(eq(commercialSettings.tenantId, tenantId))
      .limit(1)
      .catch(() => []),
    db
      .select({ id: accessGroups.id, name: accessGroups.name })
      .from(accessGroups)
      .where(eq(accessGroups.tenantId, tenantId))
      .catch(() => []),
    db
      .select({ name: sectors.name, operatorIds: sectors.operatorIds })
      .from(sectors)
      .where(eq(sectors.tenantId, tenantId))
      .catch(() => []),
    db
      .select({
        operatorId: commercialConsultantProfiles.operatorId,
        division: commercialConsultantProfiles.division,
      })
      .from(commercialConsultantProfiles)
      .where(
        and(
          eq(commercialConsultantProfiles.tenantId, tenantId),
          inArray(commercialConsultantProfiles.operatorId, opIds),
        ),
      )
      .catch(() => []),
  ]);

  const slaTargetMinutes = Math.max(1, Number(settingsRows[0]?.slaLimitMinutes ?? 15));
  const slaLimitSeconds = slaTargetMinutes * 60;

  const groupMap = new Map(groupsRows.map((g) => [g.id, g.name]));
  const divisionMap = new Map(profilesRows.map((p) => [p.operatorId, p.division]));
  const operatorSectorsMap = new Map<string, string[]>();
  for (const sec of sectorsRows) {
    for (const oid of sec.operatorIds ?? []) {
      const list = operatorSectorsMap.get(oid) ?? [];
      list.push(sec.name);
      operatorSectorsMap.set(oid, list);
    }
  }

  // 2. Conversas do tenant com atividade nos últimos 30 dias (ou atribuídas aos operadores)
  // Buscamos todas as conversas visíveis do tenant para também capturar atendimentos
  // realizados pela triagem/SDR antes de transferir a conversa para outro consultor.
  const operatorIdByName = new Map<string, string>();
  for (const op of allOperators) {
    operatorIdByName.set(op.name.trim().toLowerCase(), op.id);
  }
  const opIdSet = new Set(opIds);

  const convRows = await db
    .select({
      id: conversations.id,
      operatorId: conversations.operatorId,
      queueState: conversations.queueState,
      lastMessageTime: conversations.lastMessageTime,
      lastMessageText: conversations.lastMessageText,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), readScope))
    .catch(() => []);

  const relevantConvs = convRows.filter(
    (c) =>
      (c.operatorId && opIdSet.has(c.operatorId)) ||
      c.queueState !== "finalizados" ||
      (c.lastMessageTime && new Date(c.lastMessageTime).getTime() >= thirtyDaysAgo.getTime()),
  );
  const convMap = new Map(relevantConvs.map((c) => [c.id, c]));
  const relevantConvIds = relevantConvs.map((c) => c.id);

  // 3. Mensagens reais dos últimos 30 dias nessas conversas
  let msgRows: {
    id: string;
    conversationId: string;
    senderType: string;
    senderName: string;
    isInternalNote: boolean;
    content: string;
    sentAt: Date;
  }[] = [];

  if (relevantConvIds.length > 0) {
    const chunkSize = 400;
    for (let i = 0; i < relevantConvIds.length; i += chunkSize) {
      const chunk = relevantConvIds.slice(i, i + chunkSize);
      const rows = await db
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          senderType: messages.senderType,
          senderName: messages.senderName,
          isInternalNote: messages.isInternalNote,
          content: messages.content,
          sentAt: messages.sentAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            inArray(messages.conversationId, chunk),
            gte(messages.sentAt, thirtyDaysAgo),
          ),
        )
        .orderBy(messages.conversationId, messages.sentAt)
        .catch(() => []);
      msgRows.push(...rows);
    }
  }

  // 4. Negociações do CRM, Auditorias de IA, Métricas Diárias e Eventos de Transferência
  const [dealRows, auditRows, dailyMetricRows, transferEventRows, slaLogRows] = await Promise.all([
    db
      .select({
        id: crmDeals.id,
        operatorId: crmDeals.operatorId,
        status: crmDeals.status,
        value: crmDeals.value,
        rating: crmDeals.rating,
        closedAt: crmDeals.closedAt,
        createdAt: crmDeals.createdAt,
        updatedAt: crmDeals.updatedAt,
      })
      .from(crmDeals)
      .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.operatorId, opIds)))
      .catch(() => []),
    db
      .select({
        id: aiConversationAudits.id,
        operatorId: aiConversationAudits.operatorId,
        performanceScore: aiConversationAudits.performanceScore,
        clientSentiment: aiConversationAudits.clientSentiment,
        auditedAt: aiConversationAudits.auditedAt,
      })
      .from(aiConversationAudits)
      .where(
        and(
          eq(aiConversationAudits.tenantId, tenantId),
          eq(aiConversationAudits.status, "done"),
          inArray(aiConversationAudits.operatorId, opIds),
          gte(aiConversationAudits.auditedAt, thirtyDaysAgo),
        ),
      )
      .catch(() => []),
    db
      .select()
      .from(operatorDailyMetrics)
      .where(
        and(
          eq(operatorDailyMetrics.tenantId, tenantId),
          inArray(operatorDailyMetrics.operatorId, opIds),
          gte(operatorDailyMetrics.date, thirtyDaysAgoStr),
        ),
      )
      .catch(() => []),
    db
      .select({
        operatorId: commercialTransferResponseEvents.operatorId,
        conversationId: commercialTransferResponseEvents.conversationId,
        transferredAt: commercialTransferResponseEvents.transferredAt,
        firstRespondedAt: commercialTransferResponseEvents.firstRespondedAt,
        durationSeconds: commercialTransferResponseEvents.durationSeconds,
        status: commercialTransferResponseEvents.status,
      })
      .from(commercialTransferResponseEvents)
      .where(
        and(
          eq(commercialTransferResponseEvents.tenantId, tenantId),
          inArray(commercialTransferResponseEvents.operatorId, opIds),
          gte(commercialTransferResponseEvents.transferredAt, thirtyDaysAgo),
        ),
      )
      .catch(() => []),
    db
      .select({
        operatorId: responseTimeLogs.operatorId,
        conversationId: responseTimeLogs.conversationId,
        clientMessageAt: responseTimeLogs.clientMessageAt,
        agentResponseAt: responseTimeLogs.agentResponseAt,
        responseTimeSeconds: responseTimeLogs.responseTimeSeconds,
        isOverdue: responseTimeLogs.isOverdue,
      })
      .from(responseTimeLogs)
      .where(
        and(
          eq(responseTimeLogs.tenantId, tenantId),
          gte(responseTimeLogs.clientMessageAt, thirtyDaysAgo),
        ),
      )
      .catch(() => []),
  ]);

  // 5. Processar mensagens por conversa para extrair:
  //    - Conversas ativas por operador em cada dia BRT e hora BRT
  //    - Pares de resposta (client -> agent) com tempo exato de resposta
  //    - Conversas onde o cliente falou por último e aguarda resposta agora
  const msgsByConv = new Map<string, typeof msgRows>();
  for (const m of msgRows) {
    if (m.senderType === "system" && BOILERPLATE_SYSTEM_RE.test((m.content || "").trim())) {
      continue;
    }
    const list = msgsByConv.get(m.conversationId) ?? [];
    list.push(m);
    msgsByConv.set(m.conversationId, list);
  }

  // (operatorId -> dateBrt -> Set<conversationId>)
  const opDayConvsMap = new Map<string, Map<string, Set<string>>>();
  // (operatorId -> hourBrt (today) -> Set<conversationId>)
  const opTodayHourConvsMap = new Map<string, Map<number, Set<string>>>();
  // Conversas com engajamento bidirecional (cliente + agente) nos últimos 30d por operador
  const opEngagedConvs30d = new Map<string, Set<string>>();
  const opRepliedConvs30d = new Map<string, Set<string>>();

  const cyclesByOperator = new Map<string, ResponseCycle[]>();
  const waitingByOperator = new Map<string, ActiveWaitingTurn[]>();

  const addOpDayConv = (opId: string, dateKey: string, convId: string) => {
    let byDay = opDayConvsMap.get(opId);
    if (!byDay) {
      byDay = new Map();
      opDayConvsMap.set(opId, byDay);
    }
    let set = byDay.get(dateKey);
    if (!set) {
      set = new Set();
      byDay.set(dateKey, set);
    }
    set.add(convId);
  };

  const addOpTodayHourConv = (opId: string, hour: number, convId: string) => {
    let byHour = opTodayHourConvsMap.get(opId);
    if (!byHour) {
      byHour = new Map();
      opTodayHourConvsMap.set(opId, byHour);
    }
    let set = byHour.get(hour);
    if (!set) {
      set = new Set();
      byHour.set(hour, set);
    }
    set.add(convId);
  };

  for (const conv of relevantConvs) {
    const convOpId = conv.operatorId && opIdSet.has(conv.operatorId) ? conv.operatorId : null;

    // Também registra o dia do lastMessageTime da conversa para o operador titular atual
    if (convOpId && conv.lastMessageTime) {
      const lmt = new Date(conv.lastMessageTime);
      if (lmt.getTime() >= thirtyDaysAgo.getTime()) {
        const lmtDateBrt = getBrtDateKey(lmt);
        addOpDayConv(convOpId, lmtDateBrt, conv.id);
        if (lmtDateBrt === todayBrt) {
          addOpTodayHourConv(convOpId, getBrtHour(lmt), conv.id);
        }
      }
    }

    const cMsgs = msgsByConv.get(conv.id) ?? [];
    if (cMsgs.length === 0) continue;

    let hasClientMsg = false;
    const operatorsWhoRepliedInConv = new Set<string>();
    let pendingClientAt: Date | null = null;
    let lastTransferAt: Date | null = null;

    for (const m of cMsgs) {
      const sentAt = m.sentAt instanceof Date ? m.sentAt : new Date(m.sentAt);
      const dateBrt = getBrtDateKey(sentAt);

      // Detecta mensagem de sistema de transferência ("Atendimento transferido para ...")
      if (m.senderType === "system" && /transferid[oa]\s+para/i.test(m.content || "")) {
        lastTransferAt = sentAt;
        if (pendingClientAt && sentAt.getTime() > pendingClientAt.getTime()) {
          // O tempo de espera do novo consultor conta a partir do momento em que recebeu a transferência
          pendingClientAt = sentAt;
        }
        continue;
      }

      if (m.isInternalNote) {
        continue;
      }

      if (m.senderType === "client") {
        hasClientMsg = true;
        if (convOpId) {
          addOpDayConv(convOpId, dateBrt, conv.id);
          if (dateBrt === todayBrt) {
            addOpTodayHourConv(convOpId, getBrtHour(sentAt), conv.id);
          }
        }
        if (!pendingClientAt) {
          pendingClientAt = sentAt;
        }
      } else if (m.senderType === "agent") {
        // Identifica qual operador efetivamente enviou esta mensagem (mesmo se a conversa foi transferida depois)
        const senderKey = (m.senderName || "").trim().toLowerCase();
        const msgOpId = operatorIdByName.get(senderKey) ?? convOpId;

        if (msgOpId && opIdSet.has(msgOpId)) {
          operatorsWhoRepliedInConv.add(msgOpId);
          addOpDayConv(msgOpId, dateBrt, conv.id);
          if (dateBrt === todayBrt) {
            addOpTodayHourConv(msgOpId, getBrtHour(sentAt), conv.id);
          }

          if (pendingClientAt) {
            const deltaSec = Math.max(1, Math.round((sentAt.getTime() - pendingClientAt.getTime()) / 1000));
            // Ignora intervalos > 12h (virada de noite/fim de semana) para não distorcer o TMA operacional
            if (deltaSec <= 12 * 3600) {
              const list = cyclesByOperator.get(msgOpId) ?? [];
              list.push({
                operatorId: msgOpId,
                conversationId: conv.id,
                clientSentAt: pendingClientAt,
                agentSentAt: sentAt,
                dateBrt,
                hourBrt: getBrtHour(sentAt),
                responseSeconds: deltaSec,
                isOverdue: deltaSec > slaLimitSeconds,
              });
              cyclesByOperator.set(msgOpId, list);
            }
          }
        }
        pendingClientAt = null;
      }
    }

    for (const repliedOpId of operatorsWhoRepliedInConv) {
      const repSet = opRepliedConvs30d.get(repliedOpId) ?? new Set();
      repSet.add(conv.id);
      opRepliedConvs30d.set(repliedOpId, repSet);

      if (hasClientMsg) {
        const engSet = opEngagedConvs30d.get(repliedOpId) ?? new Set();
        engSet.add(conv.id);
        opEngagedConvs30d.set(repliedOpId, engSet);
      }
    }

    // Se a conversa continua aberta e aguarda resposta do operador titular atual:
    if (convOpId && pendingClientAt && conv.queueState !== "finalizados") {
      const effectiveWaitStart =
        lastTransferAt && lastTransferAt.getTime() > pendingClientAt.getTime()
          ? lastTransferAt
          : pendingClientAt;
      const waitSec = Math.max(0, Math.round((nowMs - effectiveWaitStart.getTime()) / 1000));
      // Considera turnos recentes (últimos 7 dias) aguardando resposta
      if (waitSec <= 7 * 86400) {
        const wList = waitingByOperator.get(convOpId) ?? [];
        wList.push({
          operatorId: convOpId,
          conversationId: conv.id,
          clientSentAt: effectiveWaitStart,
          dateBrt: getBrtDateKey(effectiveWaitStart),
          waitingSeconds: waitSec,
          isOverdue: waitSec > slaLimitSeconds,
        });
        waitingByOperator.set(convOpId, wList);
      }
    }
  }

  // Incorporar tempos de 1ª resposta após transferência comercial (commercialTransferResponseEvents)
  // quando não houver ciclo direto na mesma conversa/hora
  for (const tev of transferEventRows) {
    if (!tev.operatorId || tev.status !== "responded" || !tev.firstRespondedAt || tev.durationSeconds == null) {
      continue;
    }
    const respAt = new Date(tev.firstRespondedAt);
    const dur = Math.max(1, Number(tev.durationSeconds));
    if (dur > 12 * 3600) continue;
    const list = cyclesByOperator.get(tev.operatorId) ?? [];
    const alreadyHas = list.some(
      (c) =>
        c.conversationId === tev.conversationId &&
        Math.abs(c.agentSentAt.getTime() - respAt.getTime()) < 60_000,
    );
    if (!alreadyHas) {
      list.push({
        operatorId: tev.operatorId,
        conversationId: tev.conversationId,
        clientSentAt: new Date(tev.transferredAt),
        agentSentAt: respAt,
        dateBrt: getBrtDateKey(respAt),
        hourBrt: getBrtHour(respAt),
        responseSeconds: dur,
        isOverdue: dur > slaLimitSeconds,
      });
      cyclesByOperator.set(tev.operatorId, list);
    }
  }

  // Incorporar logs explícitos do SlaEngine (responseTimeLogs) caso pertençam a conversas mapeadas
  for (const slog of slaLogRows) {
    const conv = convMap.get(slog.conversationId);
    const opId = slog.operatorId || conv?.operatorId;
    if (!opId || !slog.agentResponseAt || slog.responseTimeSeconds == null) continue;
    const respAt = new Date(slog.agentResponseAt);
    const dur = Math.max(1, Number(slog.responseTimeSeconds));
    if (dur > 12 * 3600) continue;
    const list = cyclesByOperator.get(opId) ?? [];
    const alreadyHas = list.some(
      (c) =>
        c.conversationId === slog.conversationId &&
        Math.abs(c.agentSentAt.getTime() - respAt.getTime()) < 60_000,
    );
    if (!alreadyHas) {
      list.push({
        operatorId: opId,
        conversationId: slog.conversationId,
        clientSentAt: new Date(slog.clientMessageAt),
        agentSentAt: respAt,
        dateBrt: getBrtDateKey(respAt),
        hourBrt: getBrtHour(respAt),
        responseSeconds: dur,
        isOverdue: Boolean(slog.isOverdue) || dur > slaLimitSeconds,
      });
      cyclesByOperator.set(opId, list);
    }
  }

  // 6. Pré-calcular volumes máximos da equipe para normalizar barras de progresso
  let maxMonthlyConvsTeam = 1;
  let maxOpenDealsTeam = 1;
  for (const op of allOperators) {
    const byDay = opDayConvsMap.get(op.id);
    const allMonthConvIds = new Set<string>();
    if (byDay) {
      for (const [, set] of byDay) {
        for (const cid of set) allMonthConvIds.add(cid);
      }
    }
    if (allMonthConvIds.size > maxMonthlyConvsTeam) {
      maxMonthlyConvsTeam = allMonthConvIds.size;
    }
    const opOpenDeals = dealRows.filter((d) => d.operatorId === op.id && d.status === "open").length;
    if (opOpenDeals > maxOpenDealsTeam) {
      maxOpenDealsTeam = opOpenDeals;
    }
  }

  // 7. Construir métricas detalhadas para cada operador
  const rawMetrics = allOperators.map((op) => {
    const presence = computeOperatorPresenceSnapshot(op, tenantId, viewerOperatorId);
    const isOnline = presence.isOnline;
    const presenceLabel: "ONLINE" | "EM ATENDIMENTO" | "EM PAUSA" | "OFFLINE" = !isOnline
      ? "OFFLINE"
      : op.status === "ausente"
        ? "EM PAUSA"
        : op.status === "ocupado"
          ? "EM ATENDIMENTO"
          : "ONLINE";

    // Subtítulo real (Cargo • Setor/Divisão • Presença)
    const groupName = (op.groupId ? groupMap.get(op.groupId) : null) ||
      (op.role === "admin" ? "Gestão Comercial" : "Consultor(a) Comercial");
    const divRaw = divisionMap.get(op.id);
    const sectorNames = operatorSectorsMap.get(op.id) ?? [];
    const primarySector =
      sectorNames.find((s) => /comercial/i.test(s)) ?? sectorNames[0] ?? "Comercial";
    const unitLabel =
      divRaw === "personnalite"
        ? "Divisão Personnalité"
        : divRaw === "maquinas"
          ? "Divisão Máquinas"
          : sectorNames.length > 1
            ? `${primarySector} (+${sectorNames.length - 1})`
            : primarySector;
    const presenceText = isOnline
      ? presence.usageSecondsToday >= 60
        ? `Online agora (${formatDurationCompact(presence.usageSecondsToday)} hoje)`
        : "Online agora"
      : presence.lastSeenAt
        ? `Último acesso: ${formatLastSeenBrt(presence.lastSeenAt, todayBrt)}`
        : "Offline no painel";
    const roleSubtitle = `${groupName} • ${unitLabel} • ${presenceText}`;

    // Conversas por dia
    const byDay = opDayConvsMap.get(op.id) ?? new Map<string, Set<string>>();
    const todayConvs = byDay.get(todayBrt)?.size ?? 0;
    const yesterdayConvs = byDay.get(yesterdayBrt)?.size ?? 0;

    const all30dConvsSet = new Set<string>();
    for (const [, set] of byDay) {
      for (const cid of set) all30dConvsSet.add(cid);
    }
    const monthlyConversations = all30dConvsSet.size;

    const diasAtendimentos = last7DateKeys.map((dk) => byDay.get(dk)?.size ?? 0);
    const sum7dConvs = diasAtendimentos.reduce((a, b) => a + b, 0);
    const avgDailyConversations7d = Number((sum7dConvs / 7).toFixed(1));

    // Ciclos de resposta e esperas do operador
    const allCycles = cyclesByOperator.get(op.id) ?? [];
    const todayCycles = allCycles.filter((c) => c.dateBrt === todayBrt);
    const last7dCycles = allCycles.filter((c) => c.dateBrt >= sevenDaysAgoStr);
    const last30dCycles = allCycles;

    const activeWaitings = waitingByOperator.get(op.id) ?? [];
    const activeOverdueWaitings = activeWaitings.filter((w) => w.isOverdue);

    // Métricas pré-calculadas do banco (fallback complementar caso existam)
    const opDailyRows = dailyMetricRows.filter((m) => m.operatorId === op.id);
    const todayDbMetric = opDailyRows.find((m) => m.date === todayBrt);

    // TMA Hoje, 7d e 30d
    const avgSecToday =
      todayCycles.length > 0
        ? Math.round(todayCycles.reduce((s, c) => s + c.responseSeconds, 0) / todayCycles.length)
        : (todayDbMetric?.avgResponseTimeSeconds ?? null);

    const avgSec7d =
      last7dCycles.length > 0
        ? Math.round(last7dCycles.reduce((s, c) => s + c.responseSeconds, 0) / last7dCycles.length)
        : null;

    const avgSec30d =
      last30dCycles.length > 0
        ? Math.round(last30dCycles.reduce((s, c) => s + c.responseSeconds, 0) / last30dCycles.length)
        : null;

    const effectiveTmaSeconds = avgSecToday ?? avgSec7d ?? avgSec30d;
    const avgResponseTimeFormatted = formatSecondsPt(avgSecToday);
    const avgResponseTime7dFormatted = formatSecondsPt(effectiveTmaSeconds);
    const avgResponseTimeLastWeekFormatted = formatSecondsPt(avgSec7d);
    const avgResponseTimeLastMonthFormatted = formatSecondsPt(avgSec30d);

    const tmaNote =
      avgSecToday !== null
        ? avgSecToday <= slaLimitSeconds
          ? `Dentro da meta (SLA ${slaTargetMinutes}min)`
          : `Acima da meta (SLA ${slaTargetMinutes}min)`
        : avgSec7d !== null
          ? `Média últimos 7d (meta ${slaTargetMinutes}min)`
          : `Meta SLA: ${slaTargetMinutes}min • Sem ciclos hoje`;

    // Casos atrasados hoje, 7d e 30d
    const todayOverdueCycles = todayCycles.filter((c) => c.isOverdue).length;
    const overdueCount = Math.max(
      activeOverdueWaitings.length + todayOverdueCycles,
      todayDbMetric?.overdueCount ?? 0,
    );
    const overdueCountLastWeek =
      last7dCycles.filter((c) => c.isOverdue).length + activeOverdueWaitings.length;
    const overdueCountLastMonth =
      last30dCycles.filter((c) => c.isOverdue).length + activeOverdueWaitings.length;

    // SLA de Atendimento (%)
    // Combina ciclos respondidos no prazo vs. total avaliado (incluindo conversas ativas e em atraso)
    let slaPct: number | null = null;
    let slaNote = "Sem atendimentos avaliados";
    const evalCycles = todayCycles.length > 0 ? todayCycles : last7dCycles;
    if (evalCycles.length > 0 || activeOverdueWaitings.length > 0) {
      const onTime = evalCycles.filter((c) => !c.isOverdue).length;
      const totalEval = evalCycles.length + activeOverdueWaitings.length;
      slaPct = totalEval > 0 ? Math.round((onTime / totalEval) * 100) : 100;
      slaNote =
        overdueCount > 0
          ? `${onTime}/${totalEval} no prazo • ${overdueCount} em atraso`
          : `${onTime}/${totalEval} respostas dentro de ${slaTargetMinutes}min`;
    } else if (todayConvs > 0 || monthlyConversations > 0) {
      // Operador tem conversas ativas (ex: prospecção/templates enviados) e 0 clientes esperando em atraso
      const baseConvs = Math.max(todayConvs, monthlyConversations);
      const lateNow = activeOverdueWaitings.length;
      slaPct = Math.max(0, Math.round(((baseConvs - lateNow) / baseConvs) * 100));
      slaNote =
        lateNow === 0
          ? `${todayConvs > 0 ? todayConvs : monthlyConversations} atend. em dia (0 atrasos)`
          : `${lateNow} conversa(s) aguardando > ${slaTargetMinutes}min`;
    }

    // Negociações no CRM (Conversão e Carteira)
    const opDeals = dealRows.filter((d) => d.operatorId === op.id);
    const totalDealsCount = opDeals.length;
    const openDealsCount = opDeals.filter((d) => d.status === "open").length;
    const wonDealsCount = opDeals.filter((d) => d.status === "won").length;
    const lostDealsCount = opDeals.filter((d) => d.status === "lost").length;
    const openPipelineValue = opDeals
      .filter((d) => d.status === "open")
      .reduce((acc, d) => acc + Number(d.value ?? 0), 0);
    const wonPipelineValue = opDeals
      .filter((d) => d.status === "won")
      .reduce((acc, d) => acc + Number(d.value ?? 0), 0);

    const engagedConvsCount = opEngagedConvs30d.get(op.id)?.size ?? 0;
    const repliedConvsCount = opRepliedConvs30d.get(op.id)?.size ?? 0;

    let conversionRatePct = 0;
    let conversionDisplay = "0%";
    let conversionNote = "Sem negociações vinculadas";

    if (wonDealsCount > 0 && totalDealsCount > 0) {
      conversionRatePct = Math.min(100, Math.round((wonDealsCount / totalDealsCount) * 100));
      conversionDisplay = `${conversionRatePct}%`;
      conversionNote = `${wonDealsCount} venda(s) de ${totalDealsCount} negócios`;
    } else if (totalDealsCount > 0) {
      conversionRatePct = 0;
      conversionDisplay = "0%";
      conversionNote = `0 vendas • ${openDealsCount} negócio(s) em aberto`;
    } else if (monthlyConversations > 0) {
      // Sem cards de CRM vinculados: exibe 0% de vendas e informa engajamento de chat
      conversionRatePct = 0;
      conversionDisplay = "0%";
      conversionNote = `${engagedConvsCount}/${monthlyConversations} conversas com retorno`;
    }

    // Auditorias IA e Sentimento / Qualidade
    const opAudits = auditRows.filter((a) => a.operatorId === op.id);
    const todayAudits = opAudits.filter(
      (a) => a.auditedAt && getBrtDateKey(new Date(a.auditedAt)) === todayBrt,
    );
    const last7dAudits = opAudits.filter(
      (a) => a.auditedAt && getBrtDateKey(new Date(a.auditedAt)) >= sevenDaysAgoStr,
    );

    const auditSource = todayAudits.length > 0 ? todayAudits : opAudits;
    const satisfiedCount = auditSource.filter((a) => a.clientSentiment === "satisfeito").length;
    const neutralCount = auditSource.filter((a) => a.clientSentiment === "neutro").length;
    const frustratedCount = auditSource.filter((a) => a.clientSentiment === "frustrado").length;
    const totalSentimentAudits = satisfiedCount + neutralCount + frustratedCount;

    const aiScoreTodayOrRecent =
      auditSource.length > 0
        ? Math.round(
            auditSource.reduce((s, a) => s + Number(a.performanceScore ?? 0), 0) /
              auditSource.length,
          )
        : (todayDbMetric?.avgPerformanceScore ?? null);

    const aiScore7d =
      last7dAudits.length > 0
        ? Math.round(
            last7dAudits.reduce((s, a) => s + Number(a.performanceScore ?? 0), 0) /
              last7dAudits.length,
          )
        : null;

    const aiScore30d =
      opAudits.length > 0
        ? Math.round(
            opAudits.reduce((s, a) => s + Number(a.performanceScore ?? 0), 0) / opAudits.length,
          )
        : null;

    // Sentimento (0.0 a 10.0) e Score Operacional (quando não há auditoria IA)
    let sentimentScore10: number | null = null;
    let sentimentLabel = "Sentimento do Cliente";
    let sentimentNote = "Sem interações avaliadas";

    if (totalSentimentAudits > 0) {
      const weighted =
        (satisfiedCount * 10 + neutralCount * 6.5 + frustratedCount * 2) / totalSentimentAudits;
      sentimentScore10 = Number(weighted.toFixed(1));
      sentimentLabel = "Sentimento do Cliente (IA)";
      sentimentNote = `${satisfiedCount} satisfeito(s) • ${neutralCount} neutro(s) • ${frustratedCount} frustrado(s)`;
    } else if (monthlyConversations > 0 || todayConvs > 0) {
      // Índice real de Qualidade & Engajamento baseado nos dados operacionais reais de chat
      const slaFactor = (slaPct ?? 100) / 100; // 0..1
      const replyRatio =
        monthlyConversations > 0 ? Math.min(1, repliedConvsCount / monthlyConversations) : 0.7;
      const clientEngagementRatio =
        monthlyConversations > 0 ? Math.min(1, engagedConvsCount / monthlyConversations) : 0.5;
      const raw10 = slaFactor * 5.5 + replyRatio * 2.5 + clientEngagementRatio * 2.0;
      sentimentScore10 = Number(Math.max(1, Math.min(10, raw10)).toFixed(1));
      sentimentLabel = "Qualidade & Engajamento";
      sentimentNote = `${repliedConvsCount}/${monthlyConversations} conversas atendidas • ${engagedConvsCount} com interação`;
    }

    // Score Geral (Auditoria IA ou Índice Operacional Real de Atendimento)
    let avgPerformanceScore: number | null = aiScoreTodayOrRecent;
    let scoreSourceLabel: "Auditoria IA" | "Índice Operacional" | "Sem dados" = "Sem dados";

    if (avgPerformanceScore !== null) {
      scoreSourceLabel = "Auditoria IA";
    } else if (todayConvs > 0 || monthlyConversations > 0) {
      scoreSourceLabel = "Índice Operacional";
      const slaComponent = (slaPct ?? 100) * 0.5; // até 50 pts
      const tmaComponent =
        effectiveTmaSeconds !== null
          ? Math.max(0, Math.min(25, Math.round(25 * (1 - effectiveTmaSeconds / (slaLimitSeconds * 2)))))
          : 20; // até 25 pts
      const activityRatio =
        maxMonthlyConvsTeam > 0 ? Math.min(1, monthlyConversations / maxMonthlyConvsTeam) : 0;
      const activityComponent =
        todayConvs > 0
          ? Math.min(25, 15 + Math.round(activityRatio * 10))
          : Math.min(20, Math.round(activityRatio * 15) + (openDealsCount > 0 ? 5 : 0));
      const overduePenalty = overdueCount * 8;
      avgPerformanceScore = Math.max(
        10,
        Math.min(100, Math.round(slaComponent + tmaComponent + activityComponent - overduePenalty)),
      );
    }

    const avgPerformanceScoreLastWeek = aiScore7d ?? avgPerformanceScore;
    const avgPerformanceScoreLastMonth = aiScore30d ?? avgPerformanceScore;

    const satisfiedPctCurrent =
      totalSentimentAudits > 0
        ? Math.round((satisfiedCount / totalSentimentAudits) * 100)
        : sentimentScore10 !== null
          ? Math.round(sentimentScore10 * 10)
          : 0;

    // Comparativo vs Ontem na Sidebar
    const vsYesterdayDelta = todayConvs - yesterdayConvs;
    let vsYesterdayLabel = "Sem atendimentos hoje";
    let vsYesterdayPositive = false;
    if (todayConvs > 0 && yesterdayConvs === 0) {
      vsYesterdayLabel = `↑ +${todayConvs} atend. vs ontem`;
      vsYesterdayPositive = true;
    } else if (vsYesterdayDelta > 0) {
      vsYesterdayLabel = `↑ +${vsYesterdayDelta} atend. vs ontem (${yesterdayConvs})`;
      vsYesterdayPositive = true;
    } else if (vsYesterdayDelta < 0) {
      vsYesterdayLabel = `↓ ${vsYesterdayDelta} atend. vs ontem (${yesterdayConvs})`;
      vsYesterdayPositive = false;
    } else if (todayConvs > 0 && todayConvs === yesterdayConvs) {
      vsYesterdayLabel = `= Igual a ontem (${todayConvs} atend.)`;
      vsYesterdayPositive = true;
    } else if (openDealsCount > 0) {
      vsYesterdayLabel = `Carteira: ${openDealsCount} negócio(s) ativo(s)`;
      vsYesterdayPositive = false;
    }

    // Nota do KPI Atendimentos Hoje
    let conversationsNote = "Sem atendimentos nos últimos 7d";
    if (avgDailyConversations7d > 0) {
      const diffPct = Math.round(
        ((todayConvs - avgDailyConversations7d) / avgDailyConversations7d) * 100,
      );
      if (diffPct > 0) {
        conversationsNote = `+${diffPct}% vs média 7d (${avgDailyConversations7d}/dia)`;
      } else if (diffPct < 0) {
        conversationsNote = `${diffPct}% vs média 7d (${avgDailyConversations7d}/dia)`;
      } else {
        conversationsNote = `Na média 7d (${avgDailyConversations7d}/dia)`;
      }
    } else if (todayConvs > 0) {
      conversationsNote = `${todayConvs} atendimento(s) iniciado(s) hoje`;
    }

    // Séries de 7 dias reais (TMA em minutos e Atrasados por dia)
    const diasTmaMin = last7DateKeys.map((dk) => {
      const dayCycles = allCycles.filter((c) => c.dateBrt === dk);
      if (dayCycles.length > 0) {
        const avgSec = dayCycles.reduce((s, c) => s + c.responseSeconds, 0) / dayCycles.length;
        return Number((avgSec / 60).toFixed(1));
      }
      const dbM = opDailyRows.find((m) => m.date === dk);
      if (dbM?.avgResponseTimeSeconds) {
        return Number((dbM.avgResponseTimeSeconds / 60).toFixed(1));
      }
      return 0;
    });

    const diasAtrasados = last7DateKeys.map((dk, idx) => {
      const dayOverdue = allCycles.filter((c) => c.dateBrt === dk && c.isOverdue).length;
      const dbM = opDailyRows.find((m) => m.date === dk);
      const base = Math.max(dayOverdue, dbM?.overdueCount ?? 0);
      return idx === last7DateKeys.length - 1 ? Math.max(base, overdueCount) : base;
    });

    // Séries Horárias de Hoje (8 janelas horárias em BRT)
    const opHourConvs = opTodayHourConvsMap.get(op.id) ?? new Map<number, Set<string>>();
    const baseSla = slaPct ?? 0;
    const baseSent = sentimentScore10 ?? 0;
    const baseConv = conversionRatePct;
    const baseScore = avgPerformanceScore ?? 0;

    const horasSla: number[] = [];
    const horasSentimento: number[] = [];
    const horasConversao: number[] = [];
    const horasScore: number[] = [];

    for (const slot of hourSlots) {
      const cyclesUpToHour = todayCycles.filter((c) => c.hourBrt <= slot.hour);
      if (cyclesUpToHour.length > 0) {
        const okCount = cyclesUpToHour.filter((c) => !c.isOverdue).length;
        horasSla.push(Math.round((okCount / cyclesUpToHour.length) * 100));
      } else {
        horasSla.push(baseSla);
      }

      const convsInSlot = opHourConvs.get(slot.hour)?.size ?? 0;
      if (baseSent > 0) {
        const slotDelta = convsInSlot > 0 ? Math.min(0.4, convsInSlot * 0.05) : 0;
        horasSentimento.push(Number(Math.min(10, Math.max(0, baseSent - 0.1 + slotDelta)).toFixed(1)));
      } else {
        horasSentimento.push(0);
      }

      horasConversao.push(baseConv);

      if (baseScore > 0) {
        const slotBonus = convsInSlot > 0 ? Math.min(4, convsInSlot) : 0;
        horasScore.push(Math.min(100, Math.max(0, baseScore - 2 + slotBonus)));
      } else {
        horasScore.push(0);
      }
    }
    // Garante que o último ponto da série horária reflita exatamente o valor consolidado atual
    if (horasSla.length > 0) horasSla[horasSla.length - 1] = baseSla;
    if (horasSentimento.length > 0) horasSentimento[horasSentimento.length - 1] = baseSent;
    if (horasConversao.length > 0) horasConversao[horasConversao.length - 1] = baseConv;
    if (horasScore.length > 0) horasScore[horasScore.length - 1] = baseScore;

    // Comparativo Mensal (30d)
    const monthlyVolumePct =
      monthlyConversations > 0
        ? Math.max(6, Math.min(100, Math.round((monthlyConversations / maxMonthlyConvsTeam) * 100)))
        : 0;

    const retentionOrResolutionPct =
      slaPct !== null
        ? slaPct
        : monthlyConversations > 0
          ? Math.round((repliedConvsCount / monthlyConversations) * 100)
          : 0;
    const retentionLabel =
      slaPct !== null ? "Conformidade de SLA (30d)" : "Taxa de Atendimento (30d)";

    const crmWalletPct =
      openDealsCount > 0
        ? Math.max(6, Math.min(100, Math.round((openDealsCount / maxOpenDealsTeam) * 100)))
        : 0;

    // Semáforo operacional
    let trafficLight: "green" | "yellow" | "red" | "gray" = "gray";
    if (overdueCount > 0 || (effectiveTmaSeconds !== null && effectiveTmaSeconds >= slaLimitSeconds)) {
      trafficLight = "red";
    } else if (effectiveTmaSeconds !== null && effectiveTmaSeconds >= Math.round(slaLimitSeconds / 2)) {
      trafficLight = "yellow";
    } else if (isOnline || todayConvs > 0) {
      trafficLight = "green";
    }

    return {
      operatorId: op.id,
      operatorName: op.name,
      operatorAvatar: op.avatar,
      status: op.status,
      isOnline,
      presenceLabel,
      lastSeenAt: presence.lastSeenAt,
      usageSecondsToday: presence.usageSecondsToday,
      roleSubtitle,
      scoreSourceLabel,

      totalConversations: todayConvs,
      yesterdayConversations: yesterdayConvs,
      vsYesterdayDelta,
      vsYesterdayLabel,
      vsYesterdayPositive,
      monthlyConversations,
      avgDailyConversations7d,
      conversationsNote,

      avgResponseTimeSeconds: avgSecToday,
      avgResponseTimeFormatted,
      avgResponseTime7dFormatted,
      avgResponseTimeLastWeekFormatted,
      avgResponseTimeLastMonthFormatted,
      tmaNote,
      slaTargetMinutes,
      slaPct,
      slaNote,

      overdueCount,
      overdueCountLastWeek,
      overdueCountLastMonth,

      avgPerformanceScore,
      avgPerformanceScoreLastWeek,
      avgPerformanceScoreLastMonth,
      sentimentScore10,
      sentimentLabel,
      sentimentNote,
      satisfiedCount,
      neutralCount,
      frustratedCount,
      satisfiedPctLastWeek: satisfiedPctCurrent,
      satisfiedPctLastMonth: satisfiedPctCurrent,

      conversionRatePct,
      conversionDisplay,
      conversionNote,
      totalDealsCount,
      openDealsCount,
      wonDealsCount,
      lostDealsCount,
      openPipelineValue,
      wonPipelineValue,

      monthlyVolumePct,
      retentionOrResolutionPct,
      retentionLabel,
      crmWalletPct,

      monthlyRank: 1,
      totalRankedOperators: allOperators.length,
      monthlyRankNote: "",

      horasLabels,
      horasSla,
      horasSentimento,
      horasConversao,
      horasScore,

      diasLabels,
      diasAtendimentos,
      diasTmaMin,
      diasAtrasados,
      diasRanking: [],

      trafficLight,
    };
  });

  // 8. Calcular Ranking Mensal Real (30d) e Ranking Diário dos últimos 7 dias
  const monthlyRankOrder = [...rawMetrics].sort((a, b) => {
    const aActive = a.monthlyConversations > 0 || a.totalConversations > 0 || a.openDealsCount > 0 ? 1 : 0;
    const bActive = b.monthlyConversations > 0 || b.totalConversations > 0 || b.openDealsCount > 0 ? 1 : 0;
    if (bActive !== aActive) return bActive - aActive;
    if (b.totalConversations !== a.totalConversations) return b.totalConversations - a.totalConversations;
    if (b.monthlyConversations !== a.monthlyConversations) return b.monthlyConversations - a.monthlyConversations;
    if ((b.avgPerformanceScore ?? 0) !== (a.avgPerformanceScore ?? 0)) {
      return (b.avgPerformanceScore ?? 0) - (a.avgPerformanceScore ?? 0);
    }
    if (b.wonDealsCount !== a.wonDealsCount) return b.wonDealsCount - a.wonDealsCount;
    if (b.openDealsCount !== a.openDealsCount) return b.openDealsCount - a.openDealsCount;
    return a.operatorName.localeCompare(b.operatorName, "pt-BR");
  });

  const monthlyRankByOpId = new Map<string, number>();
  monthlyRankOrder.forEach((m, idx) => {
    monthlyRankByOpId.set(m.operatorId, idx + 1);
  });

  // Ranking diário nos últimos 7 dias
  const dailyRanksByDay = last7DateKeys.map((_, dayIdx) => {
    const sortedDay = [...rawMetrics].sort((a, b) => {
      const aConv = a.diasAtendimentos[dayIdx] ?? 0;
      const bConv = b.diasAtendimentos[dayIdx] ?? 0;
      if (bConv !== aConv) return bConv - aConv;
      const aOver = a.diasAtrasados[dayIdx] ?? 0;
      const bOver = b.diasAtrasados[dayIdx] ?? 0;
      if (aOver !== bOver) return aOver - bOver;
      return (
        (monthlyRankByOpId.get(a.operatorId) ?? 99) -
        (monthlyRankByOpId.get(b.operatorId) ?? 99)
      );
    });
    const map = new Map<string, number>();
    sortedDay.forEach((m, idx) => map.set(m.operatorId, idx + 1));
    return map;
  });

  for (const m of rawMetrics) {
    const rank = monthlyRankByOpId.get(m.operatorId) ?? 1;
    m.monthlyRank = rank;
    m.diasRanking = dailyRanksByDay.map((rmap) => rmap.get(m.operatorId) ?? rank);
    if (m.monthlyConversations > 0 || m.openDealsCount > 0) {
      m.monthlyRankNote = `De ${allOperators.length} consultores • ${m.monthlyConversations} atend. (30d)`;
    } else {
      m.monthlyRankNote = `De ${allOperators.length} consultores • Sem atend. no mês`;
    }
  }

  // 9. Ordenar lista principal dando prioridade a quem possui atendimentos hoje, depois volume 30d e score
  rawMetrics.sort((a, b) => {
    const aHasToday = a.totalConversations > 0 ? 1 : 0;
    const bHasToday = b.totalConversations > 0 ? 1 : 0;
    if (bHasToday !== aHasToday) return bHasToday - aHasToday;
    if (b.totalConversations !== a.totalConversations) return b.totalConversations - a.totalConversations;
    if (b.monthlyConversations !== a.monthlyConversations) return b.monthlyConversations - a.monthlyConversations;
    if ((b.avgPerformanceScore ?? 0) !== (a.avgPerformanceScore ?? 0)) {
      return (b.avgPerformanceScore ?? 0) - (a.avgPerformanceScore ?? 0);
    }
    return a.operatorName.localeCompare(b.operatorName, "pt-BR");
  });

  // 10. Consolidar métricas da equipe para o cabeçalho de Overview
  const allTodayCycles = Array.from(cyclesByOperator.values())
    .flat()
    .filter((c) => c.dateBrt === todayBrt);
  const avgResponseSecondsToday =
    allTodayCycles.length > 0
      ? Math.round(allTodayCycles.reduce((s, c) => s + c.responseSeconds, 0) / allTodayCycles.length)
      : null;

  const scoredOps = rawMetrics.filter((m) => m.avgPerformanceScore !== null);
  const teamPerformanceScore =
    scoredOps.length > 0
      ? Math.round(
          scoredOps.reduce((s, m) => s + Number(m.avgPerformanceScore ?? 0), 0) / scoredOps.length,
        )
      : null;

  const overdueAlertsCount = rawMetrics.reduce((s, m) => s + m.overdueCount, 0);

  return {
    todayBrt,
    avgResponseSecondsToday,
    teamPerformanceScore,
    overdueAlertsCount,
    operators: rawMetrics,
  };
}

/**
 * Reconstrói o histórico diário real de um operador (combinando operator_daily_metrics
 * com os dados reais de conversas, mensagens e auditorias dos últimos 60 dias).
 */
export async function computeOperatorDailyHistory(params: {
  tenantId: string;
  operatorId: string;
}): Promise<ComputedHistoryDay[]> {
  const { tenantId, operatorId } = params;
  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [opRow, dbHistory, settingsRows, convRows, auditRows] = await Promise.all([
    db
      .select({ id: operators.id, name: operators.name })
      .from(operators)
      .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
      .limit(1)
      .catch(() => []),
    db
      .select()
      .from(operatorDailyMetrics)
      .where(
        and(
          eq(operatorDailyMetrics.tenantId, tenantId),
          eq(operatorDailyMetrics.operatorId, operatorId),
        ),
      )
      .orderBy(desc(operatorDailyMetrics.date))
      .catch(() => []),
    db
      .select({ slaLimitMinutes: commercialSettings.slaLimitMinutes })
      .from(commercialSettings)
      .where(eq(commercialSettings.tenantId, tenantId))
      .limit(1)
      .catch(() => []),
    db
      .select({
        id: conversations.id,
        lastMessageTime: conversations.lastMessageTime,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.operatorId, operatorId),
        ),
      )
      .catch(() => []),
    db
      .select({
        performanceScore: aiConversationAudits.performanceScore,
        clientSentiment: aiConversationAudits.clientSentiment,
        auditedAt: aiConversationAudits.auditedAt,
      })
      .from(aiConversationAudits)
      .where(
        and(
          eq(aiConversationAudits.tenantId, tenantId),
          eq(aiConversationAudits.operatorId, operatorId),
          eq(aiConversationAudits.status, "done"),
          gte(aiConversationAudits.auditedAt, sixtyDaysAgo),
        ),
      )
      .catch(() => []),
  ]);

  const operatorName = opRow[0]?.name?.trim() ?? "";
  let extraConvIdsBySender: string[] = [];
  if (operatorName) {
    const sentByOp = await db
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.senderType, "agent"),
          eq(messages.senderName, operatorName),
          gte(messages.sentAt, sixtyDaysAgo),
        ),
      )
      .catch(() => []);
    extraConvIdsBySender = sentByOp.map((r) => r.conversationId);
  }

  const slaLimitSeconds = Math.max(1, Number(settingsRows[0]?.slaLimitMinutes ?? 15)) * 60;
  const convIds = Array.from(new Set([...convRows.map((c) => c.id), ...extraConvIdsBySender]));

  let msgRows: {
    id: string;
    conversationId: string;
    senderType: string;
    content: string;
    sentAt: Date;
  }[] = [];

  if (convIds.length > 0) {
    const chunkSize = 400;
    for (let i = 0; i < convIds.length; i += chunkSize) {
      const chunk = convIds.slice(i, i + chunkSize);
      const rows = await db
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          senderType: messages.senderType,
          content: messages.content,
          sentAt: messages.sentAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            inArray(messages.conversationId, chunk),
            eq(messages.isInternalNote, false),
            gte(messages.sentAt, sixtyDaysAgo),
          ),
        )
        .orderBy(messages.conversationId, messages.sentAt)
        .catch(() => []);
      msgRows.push(...rows);
    }
  }

  const dayConvs = new Map<string, Set<string>>();
  const dayResponseSecs = new Map<string, number[]>();
  const dayOverdueCount = new Map<string, number>();

  for (const c of convRows) {
    if (c.lastMessageTime) {
      const lmt = new Date(c.lastMessageTime);
      if (lmt.getTime() >= sixtyDaysAgo.getTime()) {
        const dk = getBrtDateKey(lmt);
        const set = dayConvs.get(dk) ?? new Set();
        set.add(c.id);
        dayConvs.set(dk, set);
      }
    }
  }

  const msgsByConv = new Map<string, typeof msgRows>();
  for (const m of msgRows) {
    if (m.senderType === "system" && BOILERPLATE_SYSTEM_RE.test((m.content || "").trim())) {
      continue;
    }
    const list = msgsByConv.get(m.conversationId) ?? [];
    list.push(m);
    msgsByConv.set(m.conversationId, list);
  }

  for (const [cid, cMsgs] of msgsByConv) {
    let pendingClientAt: Date | null = null;
    for (const m of cMsgs) {
      const sentAt = m.sentAt instanceof Date ? m.sentAt : new Date(m.sentAt);
      const dk = getBrtDateKey(sentAt);
      const set = dayConvs.get(dk) ?? new Set();
      set.add(cid);
      dayConvs.set(dk, set);

      if (m.senderType === "client") {
        if (!pendingClientAt) pendingClientAt = sentAt;
      } else if (m.senderType === "agent" && pendingClientAt) {
        const deltaSec = Math.max(1, Math.round((sentAt.getTime() - pendingClientAt.getTime()) / 1000));
        if (deltaSec <= 12 * 3600) {
          const arr = dayResponseSecs.get(dk) ?? [];
          arr.push(deltaSec);
          dayResponseSecs.set(dk, arr);
          if (deltaSec > slaLimitSeconds) {
            dayOverdueCount.set(dk, (dayOverdueCount.get(dk) ?? 0) + 1);
          }
        }
        pendingClientAt = null;
      }
    }
  }

  // Agrupar auditorias por dia
  const dayAudits = new Map<string, typeof auditRows>();
  for (const a of auditRows) {
    if (!a.auditedAt) continue;
    const dk = getBrtDateKey(new Date(a.auditedAt));
    const list = dayAudits.get(dk) ?? [];
    list.push(a);
    dayAudits.set(dk, list);
  }

  // Unir todas as datas encontradas
  const allDates = new Set<string>();
  for (const rec of dbHistory) allDates.add(rec.date);
  for (const [dk, set] of dayConvs) {
    if (set.size > 0) allDates.add(dk);
  }

  const dbByDate = new Map(dbHistory.map((r) => [r.date, r]));
  const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a));

  return sortedDates.map((date) => {
    const dbRec = dbByDate.get(date);
    const convCount = Math.max(dayConvs.get(date)?.size ?? 0, dbRec?.totalConversations ?? 0);
    const respSecs = dayResponseSecs.get(date) ?? [];
    const avgSec =
      respSecs.length > 0
        ? Math.round(respSecs.reduce((a, b) => a + b, 0) / respSecs.length)
        : (dbRec?.avgResponseTimeSeconds ?? null);
    const overdue = Math.max(dayOverdueCount.get(date) ?? 0, dbRec?.overdueCount ?? 0);

    const auditsOnDay = dayAudits.get(date) ?? [];
    const sat =
      auditsOnDay.length > 0
        ? auditsOnDay.filter((a) => a.clientSentiment === "satisfeito").length
        : (dbRec?.satisfiedCount ?? 0);
    const neu =
      auditsOnDay.length > 0
        ? auditsOnDay.filter((a) => a.clientSentiment === "neutro").length
        : (dbRec?.neutralCount ?? 0);
    const fru =
      auditsOnDay.length > 0
        ? auditsOnDay.filter((a) => a.clientSentiment === "frustrated" || a.clientSentiment === "frustrado").length
        : (dbRec?.frustratedCount ?? 0);
    const totalSent = sat + neu + fru;

    const slaPctDay =
      respSecs.length > 0
        ? Math.round(((respSecs.length - (dayOverdueCount.get(date) ?? 0)) / respSecs.length) * 100)
        : convCount > 0 && overdue === 0
          ? 100
          : 0;

    const satisfiedPct = totalSent > 0 ? Math.round((sat / totalSent) * 100) : slaPctDay;

    let score: number | null =
      auditsOnDay.length > 0
        ? Math.round(
            auditsOnDay.reduce((s, a) => s + Number(a.performanceScore ?? 0), 0) /
              auditsOnDay.length,
          )
        : (dbRec?.avgPerformanceScore ?? null);

    if (score === null && convCount > 0) {
      const tmaBonus =
        avgSec !== null
          ? Math.max(0, Math.min(25, Math.round(25 * (1 - avgSec / (slaLimitSeconds * 2)))))
          : 20;
      score = Math.max(10, Math.min(100, Math.round(slaPctDay * 0.55 + tmaBonus + Math.min(20, convCount * 2) - overdue * 8)));
    }

    return {
      id: dbRec?.id ?? `hist-${operatorId}-${date}`,
      date,
      totalConversations: convCount,
      avgResponseTimeSeconds: avgSec,
      avgResponseTimeFormatted: formatSecondsPt(avgSec),
      overdueCount: overdue,
      avgPerformanceScore: score,
      satisfiedPct,
      satisfiedCount: sat,
      neutralCount: neu,
      frustratedCount: fru,
    };
  });
}
