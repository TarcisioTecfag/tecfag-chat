import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  conversations,
  responseTimeLogs,
  sectors,
  contacts,
  messages,
  operators,
  whatsappConnections,
  crmDeals,
  crmConversationDeals,
  crmDealActivities,
  crmDealEmails,
  aiConversationAudits,
  agentFlowStates,
  commercialConsultantProfiles,
  commercialTransferResponseEvents,
  lcChats,
  voiceCalls,
  tasks,
} from "../../../db/schema";
import { eq, and, or, exists, gte, lte, isNotNull, isNull, inArray, count, avg, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { conversationReadCondition } from "../../../lib/access-control/conversation-access";
import { buildConsultantAvatarResolver } from "../../../lib/commercial/avatar-matcher";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DAY_NAMES_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const BOILERPLATE_SYSTEM_RE =
  /^(Contato criado\.?|Contato criado\.\s*Aguardando captura do atendimento\.?|Atendimento iniciado\.?|Conversa iniciada\.?|Aguardando captura do atendimento\.?)$/i;

function getBrtDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getBrtHour(date: Date): number {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).format(date);
  const parsed = parseInt(hourStr, 10);
  return Number.isNaN(parsed) ? 0 : parsed % 24;
}

function getBrtDayBounds(dateStr: string): { start: Date; end: Date; weekdayLabel: string; shortDateLabel: string } {
  // America/Sao_Paulo é UTC-3 fixo (sem horário de verão)
  const start = new Date(`${dateStr}T00:00:00.000-03:00`);
  const end = new Date(`${dateStr}T23:59:59.999-03:00`);
  const [y, m, d] = dateStr.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
  const weekdayLabel = DAY_NAMES_PT[noonUtc.getUTCDay()] ?? "Dia";
  const shortDateLabel = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  return { start, end, weekdayLabel, shortDateLabel };
}

function calcDeltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  // Quando a base anterior é residual (< 5) e houve salto > 5x (ex: pós-migração/implantação),
  // evita distorções irreais como +17550%.
  if (previous < 5 && current >= 20) return null;
  const raw = Math.round(((current - previous) / previous) * 100);
  if (Math.abs(raw) > 999) return raw > 0 ? 999 : -999;
  return raw;
}

function computeOperationalAvgSeconds(rawTimes: (number | null | undefined)[]): number | null {
  const valid = rawTimes.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (valid.length === 0) return null;
  if (valid.length < 4) {
    return Math.round(valid.reduce((acc, curr) => acc + curr, 0) / valid.length);
  }
  const inShift = valid.filter((v) => v <= 4 * 3600);
  const base = inShift.length >= Math.ceil(valid.length * 0.5) ? inShift : valid;
  const sorted = [...base].sort((a, b) => a - b);
  const p85Cap = sorted[Math.floor((sorted.length - 1) * 0.85)] ?? sorted[sorted.length - 1];
  const cappedSum = sorted.reduce((acc, v) => acc + Math.min(v, p85Cap), 0);
  return Math.round(cappedSum / sorted.length);
}

export const Route = createFileRoute("/api/gestao/performance")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.permissions?.views?.analytics !== true || session.permissions?.analytics?.canAccessPerformance !== true) {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente para acessar métricas de performance.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const readScope = conversationReadCondition(session);

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const periodParam = (url.searchParams.get("period") || "7d").toLowerCase();
        const sectorFilterParam = url.searchParams.get("sectorId") || "all";
        const channelFilterParam = url.searchParams.get("channel") || "all";

        try {
          const now = new Date();
          const todayBrt = getBrtDateKey(now);

          // Determinar número de dias da janela conforme o filtro de período
          let periodDaysCount = 7;
          if (periodParam === "today" || periodParam === "1d") {
            periodDaysCount = 1;
          } else if (periodParam === "15d") {
            periodDaysCount = 15;
          } else if (periodParam === "30d") {
            periodDaysCount = 30;
          } else if (periodParam === "month") {
            const [, , dayOfMonth] = todayBrt.split("-").map(Number);
            periodDaysCount = Math.max(1, dayOfMonth || 1);
          }

          // Construir lista de dias do período no fuso America/Sao_Paulo
          const periodDays: {
            dateStr: string;
            name: string;
            shortDate: string;
            displayLabel: string;
            start: Date;
            end: Date;
          }[] = [];

          for (let i = periodDaysCount - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateStr = getBrtDateKey(d);
            const { start, end, weekdayLabel, shortDateLabel } = getBrtDayBounds(dateStr);
            periodDays.push({
              dateStr,
              name: weekdayLabel,
              shortDate: shortDateLabel,
              displayLabel: periodDaysCount <= 7 ? `${weekdayLabel} (${shortDateLabel})` : shortDateLabel,
              start,
              end,
            });
          }

          const periodStart = periodDays[0]?.start ?? new Date(now.getTime() - 7 * 86400_000);
          const periodEnd = periodDays[periodDays.length - 1]?.end ?? now;
          const prevPeriodStart = new Date(periodStart.getTime() - periodDaysCount * 86400_000);
          const prevPeriodEnd = new Date(periodStart.getTime() - 1);

          // ── 1. Volumetria Base (compatível com SQL direto + enriquecimento de mensagens) ──
          const baseVolumes = await Promise.all(
            periodDays.map(async (day) => {
              const [createdRes, closedRes, slaLogs] = await Promise.all([
                db
                  .select({ count: count() })
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.tenantId, tenantId),
                      readScope,
                      gte(conversations.createdAt, day.start),
                      lte(conversations.createdAt, day.end)
                    )
                  ),
                db
                  .select({ count: count() })
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.tenantId, tenantId),
                      readScope,
                      eq(conversations.queueState, "finalizados"),
                      gte(conversations.lastMessageTime, day.start),
                      lte(conversations.lastMessageTime, day.end)
                    )
                  ),
                db
                  .select({ isOverdue: responseTimeLogs.isOverdue })
                  .from(responseTimeLogs)
                  .innerJoin(
                    conversations,
                    and(eq(conversations.id, responseTimeLogs.conversationId), eq(conversations.tenantId, tenantId))
                  )
                  .where(
                    and(
                      eq(responseTimeLogs.tenantId, tenantId),
                      readScope,
                      gte(responseTimeLogs.createdAt, day.start),
                      lte(responseTimeLogs.createdAt, day.end)
                    )
                  ),
              ]);

              const novas = Number(createdRes[0]?.count ?? 0);
              const concluidas = Number(closedRes[0]?.count ?? 0);

              const totalSla = slaLogs.length;
              const overdueSla = slaLogs.filter((l) => l.isOverdue).length;
              const sla = totalSla > 0 ? Math.round(((totalSla - overdueSla) / totalSla) * 100) : 100;

              return {
                dateStr: day.dateStr,
                name: day.name,
                shortDate: day.shortDate,
                displayLabel: day.displayLabel,
                chats: novas,
                novas,
                recorrentes: 0,
                atendidos: concluidas,
                concluidas,
                respondidas: 0,
                mensagensRecebidas: 0,
                mensagensEnviadas: 0,
                sla,
                slaSampleCount: totalSla,
              };
            })
          );

          // ── 2. Contatos e Conversas Base para Canais e Setores ─────────────
          const allContacts = await db
            .select({ id: contacts.id, mainChannel: contacts.mainChannel })
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                exists(
                  db
                    .select({ id: conversations.id })
                    .from(conversations)
                    .where(
                      and(
                        eq(conversations.contactId, contacts.id),
                        eq(conversations.tenantId, tenantId),
                        readScope
                      )
                    )
                )
              )
            );

          const [totalConvsRes] = await db
            .select({ count: count() })
            .from(conversations)
            .where(and(eq(conversations.tenantId, tenantId), readScope));

          const totalConvs = Number(totalConvsRes?.count ?? 0);

          // ── 3. Setores Base (mantendo contrato estrito de `sectors`) ───────
          const allSectors = await db
            .select()
            .from(sectors)
            .where(eq(sectors.tenantId, tenantId));

          let sectorMetrics: { name: string; completed: number; avgResponse: number | null; slaPct: number | null }[] = [];

          if (allSectors.length > 0) {
            sectorMetrics = await Promise.all(
              allSectors.map(async (sec) => {
                const secOpIds = Array.isArray(sec.operatorIds) ? sec.operatorIds.filter(Boolean) : [];
                const sectorConvMatch =
                  secOpIds.length > 0
                    ? or(
                        eq(conversations.sectorId, sec.id),
                        and(isNull(conversations.sectorId), inArray(conversations.operatorId, secOpIds))
                      )
                    : eq(conversations.sectorId, sec.id);

                const [closedRes, slaLogs] = await Promise.all([
                  db
                    .select({ count: count() })
                    .from(conversations)
                    .where(
                      and(
                        eq(conversations.tenantId, tenantId),
                        readScope,
                        sectorConvMatch,
                        eq(conversations.queueState, "finalizados")
                      )
                    ),
                  db
                    .select({
                      avgSeconds: avg(responseTimeLogs.responseTimeSeconds),
                      sampleCount: count(),
                      overdueCount: sql<number>`count(*) filter (where ${responseTimeLogs.isOverdue} = true)`.mapWith(Number),
                    })
                    .from(responseTimeLogs)
                    .innerJoin(
                      conversations,
                      and(eq(responseTimeLogs.conversationId, conversations.id), eq(conversations.tenantId, tenantId))
                    )
                    .where(
                      and(
                        eq(responseTimeLogs.tenantId, tenantId),
                        readScope,
                        sectorConvMatch,
                        isNotNull(responseTimeLogs.responseTimeSeconds)
                      )
                    ),
                ]);

                const completed = Number(closedRes[0]?.count ?? 0);
                const sample = slaLogs[0];
                const avgResponse = sample?.avgSeconds != null ? Math.round(Number(sample.avgSeconds)) : null;
                const totalSla = Number(sample?.sampleCount ?? 0);
                const overdueSla = Number(sample?.overdueCount ?? 0);
                const slaPct = totalSla > 0 ? Math.round(((totalSla - overdueSla) / totalSla) * 100) : null;

                return {
                  name: sec.name,
                  completed,
                  avgResponse,
                  slaPct,
                };
              })
            );
          }

          // ── 4. Consultas Enriquecidas para Overview Executivo da Diretoria ─
          // Todas isoladas por tenantId e com fallback seguro para ambientes de teste parciais
          const [
            visibleConvs,
            allOperatorsRows,
            consultantProfilesRows,
            waConnectionsRows,
            periodMessagesRows,
            prevPeriodMessagesCountRes,
            periodSlaLogsRows,
            transferEventsRows,
            crmDealsRows,
            crmConvDealsRows,
            auditsRows,
            flowStatesRows,
            lcChatsRows,
            voiceCallsRows,
            dealActivitiesRows,
            dealEmailsRows,
            tasksRows,
          ] = await Promise.all([
            db
              .select({
                id: conversations.id,
                contactId: conversations.contactId,
                operatorId: conversations.operatorId,
                sectorId: conversations.sectorId,
                whatsappConnectionId: conversations.whatsappConnectionId,
                queueState: conversations.queueState,
                unreadCount: conversations.unreadCount,
                lastMessageTime: conversations.lastMessageTime,
                createdAt: conversations.createdAt,
              })
              .from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), readScope))
              .catch(() => []),
            db
              .select({
                id: operators.id,
                name: operators.name,
                email: operators.email,
                role: operators.role,
                status: operators.status,
                avatar: operators.avatar,
                isOnline: operators.isOnline,
                lastSeenAt: operators.lastSeenAt,
              })
              .from(operators)
              .where(eq(operators.tenantId, tenantId))
              .catch(() => []),
            db
              .select({
                operatorId: commercialConsultantProfiles.operatorId,
                division: commercialConsultantProfiles.division,
              })
              .from(commercialConsultantProfiles)
              .where(eq(commercialConsultantProfiles.tenantId, tenantId))
              .catch(() => []),
            db
              .select({
                id: whatsappConnections.id,
                name: whatsappConnections.name,
                ownerOperatorId: whatsappConnections.ownerOperatorId,
                enabled: whatsappConnections.enabled,
                status: whatsappConnections.baileysSessionStatus,
              })
              .from(whatsappConnections)
              .where(eq(whatsappConnections.tenantId, tenantId))
              .catch(() => []),
            db
              .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderType: messages.senderType,
                senderName: messages.senderName,
                isInternalNote: messages.isInternalNote,
                content: messages.content,
                metaDetails: messages.metaDetails,
                sentAt: messages.sentAt,
              })
              .from(messages)
              .innerJoin(
                conversations,
                and(eq(conversations.id, messages.conversationId), eq(conversations.tenantId, tenantId))
              )
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  readScope,
                  gte(messages.sentAt, periodStart),
                  lte(messages.sentAt, periodEnd)
                )
              )
              .catch(() => []),
            db
              .select({
                conversationId: messages.conversationId,
                senderType: messages.senderType,
              })
              .from(messages)
              .innerJoin(
                conversations,
                and(eq(conversations.id, messages.conversationId), eq(conversations.tenantId, tenantId))
              )
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  readScope,
                  gte(messages.sentAt, prevPeriodStart),
                  lte(messages.sentAt, prevPeriodEnd)
                )
              )
              .catch(() => []),
            db
              .select({
                conversationId: responseTimeLogs.conversationId,
                operatorId: responseTimeLogs.operatorId,
                responseTimeSeconds: responseTimeLogs.responseTimeSeconds,
                isOverdue: responseTimeLogs.isOverdue,
                agentResponseId: responseTimeLogs.agentResponseId,
                clientMessageAt: responseTimeLogs.clientMessageAt,
                createdAt: responseTimeLogs.createdAt,
              })
              .from(responseTimeLogs)
              .innerJoin(
                conversations,
                and(eq(conversations.id, responseTimeLogs.conversationId), eq(conversations.tenantId, tenantId))
              )
              .where(and(eq(responseTimeLogs.tenantId, tenantId), readScope))
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
                  gte(commercialTransferResponseEvents.transferredAt, periodStart)
                )
              )
              .catch(() => []),
            db
              .select({
                id: crmDeals.id,
                operatorId: crmDeals.operatorId,
                status: crmDeals.status,
                value: crmDeals.value,
                source: crmDeals.source,
                campaign: crmDeals.campaign,
                closedAt: crmDeals.closedAt,
                createdAt: crmDeals.createdAt,
                updatedAt: crmDeals.updatedAt,
              })
              .from(crmDeals)
              .where(eq(crmDeals.tenantId, tenantId))
              .catch(() => []),
            db
              .select({
                conversationId: crmConversationDeals.conversationId,
                dealId: crmConversationDeals.dealId,
                isActive: crmConversationDeals.isActive,
              })
              .from(crmConversationDeals)
              .where(and(eq(crmConversationDeals.tenantId, tenantId), eq(crmConversationDeals.isActive, true)))
              .catch(() => []),
            db
              .select({
                conversationId: aiConversationAudits.conversationId,
                operatorId: aiConversationAudits.operatorId,
                performanceScore: aiConversationAudits.performanceScore,
                clientSentiment: aiConversationAudits.clientSentiment,
                status: aiConversationAudits.status,
                auditedAt: aiConversationAudits.auditedAt,
              })
              .from(aiConversationAudits)
              .where(and(eq(aiConversationAudits.tenantId, tenantId), eq(aiConversationAudits.status, "done")))
              .catch(() => []),
            db
              .select({
                id: agentFlowStates.id,
                conversationId: agentFlowStates.conversationId,
                agentType: agentFlowStates.agentType,
                currentStep: agentFlowStates.currentStep,
                outcome: agentFlowStates.outcome,
                metadata: agentFlowStates.metadata,
                startedAt: agentFlowStates.startedAt,
                lastInteractionAt: agentFlowStates.lastInteractionAt,
                completedAt: agentFlowStates.completedAt,
              })
              .from(agentFlowStates)
              .where(eq(agentFlowStates.tenantId, tenantId))
              .catch(() => []),
            db
              .select({
                id: lcChats.id,
                status: lcChats.status,
                outcome: lcChats.outcome,
                waConversationId: lcChats.waConversationId,
                startedAt: lcChats.startedAt,
              })
              .from(lcChats)
              .where(eq(lcChats.tenantId, tenantId))
              .catch(() => []),
            db
              .select({
                id: voiceCalls.id,
                status: voiceCalls.status,
                durationSeconds: voiceCalls.durationSeconds,
                startedAt: voiceCalls.startedAt,
              })
              .from(voiceCalls)
              .where(eq(voiceCalls.tenantId, tenantId))
              .catch(() => []),
            db
              .select({
                id: crmDealActivities.id,
                dealId: crmDealActivities.dealId,
                type: crmDealActivities.type,
                status: crmDealActivities.status,
                dueDate: crmDealActivities.dueDate,
                completedAt: crmDealActivities.completedAt,
                operatorId: crmDealActivities.operatorId,
                assignedToOperatorId: crmDealActivities.assignedToOperatorId,
                createdAt: crmDealActivities.createdAt,
              })
              .from(crmDealActivities)
              .where(eq(crmDealActivities.tenantId, tenantId))
              .catch(() => []),
            db
              .select({
                id: crmDealEmails.id,
                operatorId: crmDealEmails.operatorId,
                direction: crmDealEmails.direction,
                sentAt: crmDealEmails.sentAt,
              })
              .from(crmDealEmails)
              .where(eq(crmDealEmails.tenantId, tenantId))
              .catch(() => []),
            db
              .select({
                id: tasks.id,
                status: tasks.status,
                dueDate: tasks.dueDate,
                operatorEmail: tasks.operatorEmail,
              })
              .from(tasks)
              .where(eq(tasks.tenantId, tenantId))
              .catch(() => []),
          ]);

          // Mapas auxiliares de conversa, operador, setor e divisão
          const convById = new Map(visibleConvs.map((c) => [c.id, c]));
          const operatorIdByName = new Map<string, string>();
          const operatorIdByEmail = new Map<string, string>();
          for (const op of allOperatorsRows) {
            if (op.name) operatorIdByName.set(op.name.trim().toLowerCase(), op.id);
            if (op.email) operatorIdByEmail.set(op.email.trim().toLowerCase(), op.id);
          }

          const divisionByOperatorId = new Map<string, string>();
          for (const prof of consultantProfilesRows) {
            if (prof.operatorId && prof.division) {
              divisionByOperatorId.set(prof.operatorId, prof.division);
            }
          }

          // Filtrar conversas pelo filtro opcional de setor/canal na barra executiva
          const sectorFilterObj =
            sectorFilterParam !== "all" ? allSectors.find((s) => s.id === sectorFilterParam || s.name === sectorFilterParam) : null;
          const sectorFilterOpIds = new Set<string>(
            sectorFilterObj && Array.isArray(sectorFilterObj.operatorIds) ? sectorFilterObj.operatorIds : []
          );

          const matchesConvFilters = (conv: (typeof visibleConvs)[number] | undefined): boolean => {
            if (!conv) return false;
            if (sectorFilterParam !== "all") {
              if (sectorFilterParam === "division:maquinas") {
                if (!conv.operatorId || divisionByOperatorId.get(conv.operatorId) !== "maquinas") return false;
              } else if (sectorFilterParam === "division:personnalite") {
                if (!conv.operatorId || divisionByOperatorId.get(conv.operatorId) !== "personnalite") return false;
              } else if (sectorFilterObj) {
                const inSector =
                  conv.sectorId === sectorFilterObj.id ||
                  (!conv.sectorId && Boolean(conv.operatorId && sectorFilterOpIds.has(conv.operatorId)));
                if (!inSector) return false;
              }
            }
            if (channelFilterParam === "meta_official" && conv.whatsappConnectionId !== null) return false;
            if (channelFilterParam === "baileys_linked" && conv.whatsappConnectionId === null) return false;
            return true;
          };

          const filteredConvs = visibleConvs.filter((c) => matchesConvFilters(c));
          const filteredConvIds = new Set(filteredConvs.map((c) => c.id));

          // ── 5. Enriquecer Volumetria Diária e Demanda Horária (07h–22h BRT) ─
          const volumeByDateMap = new Map(baseVolumes.map((v) => [v.dateStr, v]));
          const dayActiveClientConvs = new Map<string, Set<string>>();
          const dayNewConvs = new Map<string, Set<string>>();
          const dayAgentRepliedConvs = new Map<string, Set<string>>();
          const dayFinishedConvs = new Map<string, Set<string>>();

          // Contabilizar conversas criadas / finalizadas no período dentro do escopo filtrado
          for (const conv of filteredConvs) {
            if (conv.createdAt) {
              const cDate = getBrtDateKey(new Date(conv.createdAt));
              if (volumeByDateMap.has(cDate)) {
                const set = dayNewConvs.get(cDate) ?? new Set();
                set.add(conv.id);
                dayNewConvs.set(cDate, set);

                const activeSet = dayActiveClientConvs.get(cDate) ?? new Set();
                activeSet.add(conv.id);
                dayActiveClientConvs.set(cDate, activeSet);
              }
            }
            if (conv.queueState === "finalizados" && conv.lastMessageTime) {
              const fDate = getBrtDateKey(new Date(conv.lastMessageTime));
              if (volumeByDateMap.has(fDate)) {
                const fSet = dayFinishedConvs.get(fDate) ?? new Set();
                fSet.add(conv.id);
                dayFinishedConvs.set(fDate, fSet);
              }
            }
          }

          // Slots horários de 07h às 22h BRT
          const hourlyMap = new Map<number, { recebidas: number; respondidas: number; slaOverdue: number }>();
          for (let h = 7; h <= 22; h++) {
            hourlyMap.set(h, { recebidas: 0, respondidas: 0, slaOverdue: 0 });
          }

          let clientMessagesCount = 0;
          let agentMessagesCount = 0;
          let botMessagesCount = 0;
          let whatsappCallsInMessages = 0;
          const activeConvIdsInPeriod = new Set<string>();
          const agentHandledConvIdsInPeriod = new Set<string>();
          const finishedConvIdsInPeriod = new Set<string>();

          // Contagem de mensagens por operador e por conversa
          const messagesSentByOperator = new Map<string, number>();
          const callsByOperator = new Map<string, number>();
          const handledConvsByOperator = new Map<string, Set<string>>();
          const messagesSentByConv = new Map<string, number>();

          for (const m of periodMessagesRows) {
            if (!filteredConvIds.has(m.conversationId)) continue;
            const conv = convById.get(m.conversationId);
            if (!conv) continue;

            const contentTrim = (m.content || "").trim();
            if (m.senderType === "system" && BOILERPLATE_SYSTEM_RE.test(contentTrim)) {
              continue;
            }

            const sentDate = m.sentAt instanceof Date ? m.sentAt : new Date(m.sentAt);
            const dateKey = getBrtDateKey(sentDate);
            const hourBrt = Math.min(22, Math.max(7, getBrtHour(sentDate)));
            const vEntry = volumeByDateMap.get(dateKey);

            // Detectar encerramento registrado no histórico do chat no dia exato
            if (m.senderType === "system" && /encerrad[oa]|finalizad[oa]/i.test(contentTrim)) {
              finishedConvIdsInPeriod.add(m.conversationId);
              if (vEntry) {
                const fSet = dayFinishedConvs.get(dateKey) ?? new Set();
                fSet.add(m.conversationId);
                dayFinishedConvs.set(dateKey, fSet);
              }
              continue;
            }

            if (m.isInternalNote) continue;

            // Detectar chamadas de WhatsApp salvas em metaDetails.call
            const metaObj = (m.metaDetails ?? {}) as Record<string, any>;
            if (metaObj && metaObj.call) {
              whatsappCallsInMessages += 1;
              if (conv.operatorId) {
                callsByOperator.set(conv.operatorId, (callsByOperator.get(conv.operatorId) ?? 0) + 1);
              }
            }

            activeConvIdsInPeriod.add(m.conversationId);

            if (m.senderType === "client") {
              clientMessagesCount += 1;
              if (vEntry) {
                vEntry.mensagensRecebidas += 1;
                const set = dayActiveClientConvs.get(dateKey) ?? new Set();
                set.add(m.conversationId);
                dayActiveClientConvs.set(dateKey, set);
              }
              const hSlot = hourlyMap.get(hourBrt);
              if (hSlot) hSlot.recebidas += 1;
            } else if (m.senderType === "agent") {
              agentMessagesCount += 1;
              agentHandledConvIdsInPeriod.add(m.conversationId);
              messagesSentByConv.set(m.conversationId, (messagesSentByConv.get(m.conversationId) ?? 0) + 1);

              const senderKey = (m.senderName || "").trim().toLowerCase();
              const resolvedOpId = operatorIdByName.get(senderKey) ?? conv.operatorId ?? null;
              if (resolvedOpId) {
                messagesSentByOperator.set(resolvedOpId, (messagesSentByOperator.get(resolvedOpId) ?? 0) + 1);
                const hSet = handledConvsByOperator.get(resolvedOpId) ?? new Set();
                hSet.add(m.conversationId);
                handledConvsByOperator.set(resolvedOpId, hSet);
              }

              if (vEntry) {
                vEntry.mensagensEnviadas += 1;
                const rSet = dayAgentRepliedConvs.get(dateKey) ?? new Set();
                rSet.add(m.conversationId);
                dayAgentRepliedConvs.set(dateKey, rSet);
              }
              const hSlot = hourlyMap.get(hourBrt);
              if (hSlot) hSlot.respondidas += 1;
            } else if (m.senderType === "bot") {
              botMessagesCount += 1;
            }
          }

          // Incorporar conversas que tiveram atividade no período mesmo quando não há linhas em messages (ex: testes / migração)
          for (const conv of filteredConvs) {
            const createdInPeriod =
              conv.createdAt && new Date(conv.createdAt) >= periodStart && new Date(conv.createdAt) <= periodEnd;
            const activeInPeriod =
              conv.lastMessageTime &&
              new Date(conv.lastMessageTime) >= periodStart &&
              new Date(conv.lastMessageTime) <= periodEnd;
            if (createdInPeriod || activeInPeriod) {
              activeConvIdsInPeriod.add(conv.id);
              if (conv.queueState === "finalizados") {
                finishedConvIdsInPeriod.add(conv.id);
              }
              if (conv.operatorId) {
                const hSet = handledConvsByOperator.get(conv.operatorId) ?? new Set();
                hSet.add(conv.id);
                handledConvsByOperator.set(conv.operatorId, hSet);
              }
            }
          }

          // Consolidar série final de `volumes`
          const volumes = baseVolumes.map((v) => {
            const activeSet = dayActiveClientConvs.get(v.dateStr);
            const newSet = dayNewConvs.get(v.dateStr);
            const repliedSet = dayAgentRepliedConvs.get(v.dateStr);
            const finishedSet = dayFinishedConvs.get(v.dateStr);

            const totalDayChats = Math.max(v.chats, activeSet?.size ?? 0);
            const novasDay = Math.max(v.novas, newSet?.size ?? 0);
            const recorrentesDay = Math.max(0, totalDayChats - novasDay);
            const concluidasDay = Math.max(v.concluidas, finishedSet?.size ?? 0);
            const respondidasDay = repliedSet?.size ?? 0;
            const atendidosDay = Math.max(concluidasDay, respondidasDay);

            return {
              name: v.name,
              shortDate: v.shortDate,
              displayLabel: v.displayLabel,
              dateStr: v.dateStr,
              chats: totalDayChats,
              novas: novasDay,
              recorrentes: recorrentesDay,
              atendidos: atendidosDay,
              concluidas: concluidasDay,
              respondidas: respondidasDay,
              mensagensRecebidas: v.mensagensRecebidas,
              mensagensEnviadas: v.mensagensEnviadas,
              sla: v.sla,
            };
          });

          // Contabilizar estouros de SLA por hora no período
          const periodSlaFiltered = periodSlaLogsRows.filter((l) => {
            if (!filteredConvIds.has(l.conversationId)) return false;
            const refDate = l.createdAt || l.clientMessageAt;
            if (!refDate) return true;
            const d = new Date(refDate);
            return d >= periodStart && d <= periodEnd;
          });

          for (const sl of periodSlaFiltered) {
            if (sl.isOverdue) {
              const refDate = sl.createdAt || sl.clientMessageAt;
              if (refDate) {
                const h = Math.min(22, Math.max(7, getBrtHour(new Date(refDate))));
                const hSlot = hourlyMap.get(h);
                if (hSlot) hSlot.slaOverdue += 1;
              }
            }
          }

          const hourlyDemand = Array.from(hourlyMap.entries()).map(([hourNum, data]) => ({
            hour: `${String(hourNum).padStart(2, "0")}h`,
            hourNum,
            recebidas: data.recebidas,
            respondidas: data.respondidas,
            slaOverdue: data.slaOverdue,
          }));

          // ── 6. Canais Reais & Saúde das Conexões ───────────────────────────
          const metaOfficialConvs = filteredConvs.filter((c) => !c.whatsappConnectionId).length;
          const baileysLinkedConvs = filteredConvs.filter((c) => Boolean(c.whatsappConnectionId)).length;
          const connectedBaileysDevices = waConnectionsRows.filter(
            (w) => w.enabled && w.status === "connected"
          ).length;
          const totalBaileysDevices = waConnectionsRows.length;

          const lcChatsInPeriod = lcChatsRows.filter(
            (lc) => !lc.startedAt || (new Date(lc.startedAt) >= periodStart && new Date(lc.startedAt) <= periodEnd)
          );
          const lcBridgesCount = lcChatsInPeriod.filter(
            (lc) => lc.outcome === "bridge_whatsapp" || Boolean(lc.waConversationId)
          ).length;

          const dealCallActivities = dealActivitiesRows.filter(
            (a) =>
              a.type === "call" &&
              (!a.createdAt || (new Date(a.createdAt) >= periodStart && new Date(a.createdAt) <= periodEnd))
          );
          const voiceCallsInPeriod = voiceCallsRows.filter(
            (vc) => !vc.startedAt || (new Date(vc.startedAt) >= periodStart && new Date(vc.startedAt) <= periodEnd)
          );
          const totalCallsCount = voiceCallsInPeriod.length + dealCallActivities.length + whatsappCallsInMessages;

          const emailsInPeriod = dealEmailsRows.filter(
            (em) => !em.sentAt || (new Date(em.sentAt) >= periodStart && new Date(em.sentAt) <= periodEnd)
          ).length;

          const channels = [
            {
              id: "whatsapp_official",
              name: "WhatsApp Oficial",
              value: metaOfficialConvs > 0 ? metaOfficialConvs : (baileysLinkedConvs === 0 ? totalConvs : 0),
              subtitle: "Canal Corporativo Principal",
              badge: "Ativo",
              color: "var(--primary)",
            },
            {
              id: "whatsapp_linked",
              name: "Celulares Vinculados",
              value: baileysLinkedConvs,
              connectedCount: connectedBaileysDevices,
              totalConnections: totalBaileysDevices,
              subtitle:
                totalBaileysDevices > 0
                  ? `${connectedBaileysDevices}/${totalBaileysDevices} aparelhos conectados`
                  : "Aparelhos dos consultores (Baileys)",
              badge: totalBaileysDevices > 0 ? `${connectedBaileysDevices}/${totalBaileysDevices} online` : "Multi-Sessão",
              color: "color-mix(in srgb, var(--primary) 62%, var(--muted-foreground))",
            },
            {
              id: "livechat_site",
              name: "Live Chat (Site)",
              value: lcChatsInPeriod.length,
              subtitle: lcBridgesCount > 0 ? `${lcBridgesCount} transferidos p/ WhatsApp` : "Atendimentos no widget web",
              badge: lcBridgesCount > 0 ? `${lcBridgesCount} bridges` : "Web Widget",
              color: "var(--muted-foreground)",
            },
            {
              id: "voice_calls",
              name: "Ligações & Voz",
              value: totalCallsCount,
              subtitle: "Chamadas WhatsApp + Telefonia",
              badge: "Voz",
              color: "color-mix(in srgb, var(--primary) 38%, var(--muted-foreground))",
            },
          ];

          if (emailsInPeriod > 0) {
            channels.push({
              id: "crm_emails",
              name: "E-mails CRM",
              value: emailsInPeriod,
              subtitle: "E-mails comerciais nas negociações",
              badge: "SMTP/CRM",
              color: "var(--border)",
            });
          }

          // ── 7. Funil Operacional de Carga e Vazão ──────────────────────────
          const inAutomationCount = filteredConvs.filter((c) => c.queueState === "automacao").length;
          const inQueueCount = filteredConvs.filter((c) => c.queueState === "fila").length;
          const inAttendanceCount = filteredConvs.filter((c) => c.queueState === "meus").length;
          const totalFinishedNow = filteredConvs.filter((c) => c.queueState === "finalizados").length;
          const activeNowConvIds = new Set(
            filteredConvs.filter((c) => c.queueState !== "finalizados").map((c) => c.id)
          );

          const openDealIds = new Set(crmDealsRows.filter((d) => d.status === "open").map((d) => d.id));
          const convIdsWithOpenDeal = new Set<string>();
          for (const link of crmConvDealsRows) {
            if (openDealIds.has(link.dealId) && activeNowConvIds.has(link.conversationId)) {
              convIdsWithOpenDeal.add(link.conversationId);
            }
          }

          const completedInPeriodTotal = Math.max(finishedConvIdsInPeriod.size, totalFinishedNow);

          const operationalFunnel = {
            inAutomation: inAutomationCount,
            inQueue: inQueueCount,
            inAttendance: inAttendanceCount,
            withOpenDeal: convIdsWithOpenDeal.size,
            completedInPeriod: completedInPeriodTotal,
            totalActiveNow: inAutomationCount + inQueueCount + inAttendanceCount,
          };

          // ── 8. KPIs Executivos Consolidados (com comparativo vs. período anterior) ──
          const prevActiveConvIds = new Set(prevPeriodMessagesCountRes.map((m) => m.conversationId));
          const prevConvsCreated = filteredConvs.filter(
            (c) => c.createdAt && new Date(c.createdAt) >= prevPeriodStart && new Date(c.createdAt) <= prevPeriodEnd
          ).length;
          const prevActiveTotal = Math.max(prevActiveConvIds.size, prevConvsCreated);

          const currentActiveTotal = Math.max(
            activeConvIdsInPeriod.size,
            volumes.reduce((s, v) => s + v.chats, 0)
          );
          const newConvsInPeriod = filteredConvs.filter(
            (c) => c.createdAt && new Date(c.createdAt) >= periodStart && new Date(c.createdAt) <= periodEnd
          ).length;
          const recurringConvsInPeriod = Math.max(0, currentActiveTotal - newConvsInPeriod);

          const totalHandledOrClosed = Math.min(
            currentActiveTotal,
            Math.max(
              agentHandledConvIdsInPeriod.size + finishedConvIdsInPeriod.size,
              inAttendanceCount + completedInPeriodTotal,
              volumes.reduce((s, v) => s + v.atendidos, 0)
            )
          );
          const resolutionRatePct =
            currentActiveTotal > 0
              ? Math.min(100, Math.round((totalHandledOrClosed / currentActiveTotal) * 100))
              : totalFinishedNow > 0
                ? 100
                : 0;

          // SLA e TME global
          const validSlaTimes = periodSlaLogsRows
            .filter((l) => filteredConvIds.has(l.conversationId) && typeof l.responseTimeSeconds === "number" && l.responseTimeSeconds > 0)
            .map((l) => Number(l.responseTimeSeconds));
          const overallAvgResponseSeconds = computeOperationalAvgSeconds(validSlaTimes);
          const totalSlaSamples = periodSlaLogsRows.filter((l) => filteredConvIds.has(l.conversationId)).length;
          const totalSlaOverdue = periodSlaLogsRows.filter(
            (l) => filteredConvIds.has(l.conversationId) && l.isOverdue
          ).length;
          const openOverdueWaitingNow = periodSlaLogsRows.filter(
            (l) => filteredConvIds.has(l.conversationId) && l.isOverdue && !l.agentResponseId
          ).length;
          const overallSlaPct =
            totalSlaSamples > 0 ? Math.round(((totalSlaSamples - totalSlaOverdue) / totalSlaSamples) * 100) : null;

          // Nota média QA global
          const validQaScoresGlobal = auditsRows
            .filter((a) => filteredConvIds.has(a.conversationId) && typeof a.performanceScore === "number")
            .map((a) => Number(a.performanceScore));
          const overallAvgQaScore =
            validQaScoresGlobal.length > 0
              ? Math.round(validQaScoresGlobal.reduce((a, b) => a + b, 0) / validQaScoresGlobal.length)
              : null;

          // Tempo de assunção pós-transferência SDR
          const respondedTransfers = transferEventsRows.filter(
            (t) => t.status === "responded" && typeof t.durationSeconds === "number" && t.durationSeconds > 0
          );
          const avgTransferPickupSeconds = computeOperationalAvgSeconds(
            respondedTransfers.map((t) => Number(t.durationSeconds || 0))
          );

          // Ligações atendidas vs perdidas e duração
          const answeredCallsInPeriod =
            voiceCallsInPeriod.filter((vc) => vc.status === "completed" || vc.status === "answered" || (vc.durationSeconds ?? 0) > 0).length +
            dealCallActivities.filter((a) => a.status === "completed").length +
            whatsappCallsInMessages;
          const missedCallsInPeriod = Math.max(0, totalCallsCount - answeredCallsInPeriod);
          const totalCallDurationSeconds = voiceCallsInPeriod.reduce(
            (sum, vc) => sum + Number(vc.durationSeconds || 0),
            0
          );

          // Métricas Comerciais do CRM no período
          const dealsCreatedInPeriod = crmDealsRows.filter(
            (d) => d.createdAt && new Date(d.createdAt) >= periodStart && new Date(d.createdAt) <= periodEnd
          );
          const prevDealsCreatedCount = crmDealsRows.filter(
            (d) => d.createdAt && new Date(d.createdAt) >= prevPeriodStart && new Date(d.createdAt) <= prevPeriodEnd
          ).length;

          const openDeals = crmDealsRows.filter((d) => d.status === "open");
          const openPipelineValue = openDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);

          const wonDealsInPeriod = crmDealsRows.filter((d) => {
            if (d.status !== "won") return false;
            const ref = d.closedAt || d.updatedAt || d.createdAt;
            return ref ? new Date(ref) >= periodStart && new Date(ref) <= periodEnd : true;
          });
          const prevWonDealsInPeriod = crmDealsRows.filter((d) => {
            if (d.status !== "won") return false;
            const ref = d.closedAt || d.updatedAt || d.createdAt;
            return ref ? new Date(ref) >= prevPeriodStart && new Date(ref) <= prevPeriodEnd : false;
          });
          const lostDealsInPeriod = crmDealsRows.filter((d) => {
            if (d.status !== "lost") return false;
            const ref = d.closedAt || d.updatedAt || d.createdAt;
            return ref ? new Date(ref) >= periodStart && new Date(ref) <= periodEnd : true;
          });

          const wonValueInPeriod = wonDealsInPeriod.reduce((sum, d) => sum + Number(d.value || 0), 0);
          const prevWonValueInPeriod = prevWonDealsInPeriod.reduce((sum, d) => sum + Number(d.value || 0), 0);
          const lostValueInPeriod = lostDealsInPeriod.reduce((sum, d) => sum + Number(d.value || 0), 0);
          const closedDecisionsCount = wonDealsInPeriod.length + lostDealsInPeriod.length;
          const winRatePct =
            closedDecisionsCount > 0 ? Math.round((wonDealsInPeriod.length / closedDecisionsCount) * 100) : 0;
          const avgTicketValue =
            wonDealsInPeriod.length > 0 ? Math.round(wonValueInPeriod / wonDealsInPeriod.length) : 0;

          const kpis = {
            activeConversationsInPeriod: currentActiveTotal,
            activeConversationsDeltaPct: calcDeltaPct(currentActiveTotal, prevActiveTotal),
            newConversationsInPeriod: newConvsInPeriod,
            newConversationsDeltaPct: calcDeltaPct(newConvsInPeriod, prevConvsCreated),
            recurringConversationsInPeriod: recurringConvsInPeriod,
            attendedInPeriod: totalHandledOrClosed,
            resolutionRatePct,
            completedInPeriod: completedInPeriodTotal,
            completedDeltaPct: null,
            inQueueNow: inQueueCount,
            inAttendanceNow: inAttendanceCount,
            inAutomationNow: inAutomationCount,
            unansweredOver15mCount: openOverdueWaitingNow,
            waitingInQueueNow: inQueueCount,
            waitingClientReplyNow: openOverdueWaitingNow,
            inboundMessagesInPeriod: clientMessagesCount,
            outboundMessagesInPeriod: agentMessagesCount,
            totalMessagesInPeriod: clientMessagesCount + agentMessagesCount,
            messagesDeltaPct: calcDeltaPct(
              clientMessagesCount + agentMessagesCount,
              prevPeriodMessagesCountRes.length
            ),
            clientMessagesCount,
            agentMessagesCount,
            botMessagesCount,
            callsCount: totalCallsCount,
            totalCallsInPeriod: totalCallsCount,
            answeredCallsInPeriod,
            missedCallsInPeriod,
            totalCallDurationSeconds,
            avgResponseSeconds: overallAvgResponseSeconds ?? 0,
            overallSlaPct: overallSlaPct ?? 100,
            withinSlaCount: Math.max(0, totalSlaSamples - totalSlaOverdue),
            overdueSlaCount: totalSlaOverdue,
            overdueCount: totalSlaOverdue,
            avgTransferPickupSeconds,
            avgFirstPickupAfterTriageSeconds: avgTransferPickupSeconds,
            transferPickupCount: respondedTransfers.length,
            avgQaScore: overallAvgQaScore,
            qaAuditedCount: validQaScoresGlobal.length,
            crmDealsCreatedInPeriod: dealsCreatedInPeriod.length,
            crmDealsDeltaPct: calcDeltaPct(dealsCreatedInPeriod.length, prevDealsCreatedCount),
            crmDealsCreatedDeltaPct: calcDeltaPct(dealsCreatedInPeriod.length, prevDealsCreatedCount),
            openDealsCount: openDeals.length,
            openPipelineValue,
            wonDealsCount: wonDealsInPeriod.length,
            wonDealsInPeriod: wonDealsInPeriod.length,
            wonValueInPeriod,
            wonValueDeltaPct: calcDeltaPct(wonValueInPeriod, prevWonValueInPeriod),
            lostDealsCount: lostDealsInPeriod.length,
            lostDealsInPeriod: lostDealsInPeriod.length,
            lostValueInPeriod,
            winRatePct,
            avgTicketValue,
            avgTicketWon: avgTicketValue,
          };

          // ── 9. Tabela Executiva Expandida por Setor & Divisão (`sectorDetails`) ──
          const buildSectorDetailRow = (params: {
            id: string;
            name: string;
            kind: "sector" | "division" | "unassigned";
            memberOpIds: string[];
            matchConv: (c: (typeof visibleConvs)[number]) => boolean;
            fallbackBasic?: { completed: number; avgResponse: number | null; slaPct: number | null };
          }) => {
            const { id, name, kind, memberOpIds, matchConv, fallbackBasic } = params;
            const memberSet = new Set(memberOpIds);
            const matchedConvs = visibleConvs.filter(matchConv);
            const matchedConvIds = new Set(matchedConvs.map((c) => c.id));

            const inQueue = matchedConvs.filter((c) => c.queueState === "fila").length;
            const inProgress = matchedConvs.filter((c) => c.queueState === "meus").length;
            const completed =
              fallbackBasic?.completed ?? matchedConvs.filter((c) => c.queueState === "finalizados").length;
            const activeInPeriod = matchedConvs.filter((c) => activeConvIdsInPeriod.has(c.id)).length;

            let messagesSent = 0;
            for (const cid of matchedConvIds) {
              messagesSent += messagesSentByConv.get(cid) ?? 0;
            }
            if (messagesSent === 0 && memberSet.size > 0) {
              for (const oid of memberSet) {
                messagesSent += messagesSentByOperator.get(oid) ?? 0;
              }
            }

            const secSlaLogs = periodSlaLogsRows.filter(
              (l) =>
                matchedConvIds.has(l.conversationId) ||
                Boolean(l.operatorId && memberSet.has(l.operatorId))
            );
            const secValidTimes = secSlaLogs
              .map((l) => l.responseTimeSeconds)
              .filter((v): v is number => typeof v === "number" && v > 0);
            const avgResponse =
              fallbackBasic?.avgResponse ?? computeOperationalAvgSeconds(secValidTimes);

            const secOverdue = secSlaLogs.filter((l) => l.isOverdue).length;
            const slaPct =
              fallbackBasic?.slaPct ??
              (secSlaLogs.length > 0
                ? Math.round(((secSlaLogs.length - secOverdue) / secSlaLogs.length) * 100)
                : null);

            const secAudits = auditsRows.filter(
              (a) =>
                matchedConvIds.has(a.conversationId) ||
                Boolean(a.operatorId && memberSet.has(a.operatorId))
            );
            const validScores = secAudits
              .map((a) => a.performanceScore)
              .filter((s): s is number => typeof s === "number");
            const qaScore =
              validScores.length > 0
                ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
                : null;

            const secDeals = crmDealsRows.filter((d) => d.operatorId && memberSet.has(d.operatorId));
            const secOpenDeals = secDeals.filter((d) => d.status === "open");
            const secWonDeals = secDeals.filter((d) => d.status === "won");
            const secOpenValue = secOpenDeals.reduce((s, d) => s + Number(d.value || 0), 0);
            const secWonValue = secWonDeals.reduce((s, d) => s + Number(d.value || 0), 0);

            const memberOps = allOperatorsRows.filter((o) => memberSet.has(o.id));
            const operatorsOnline = memberOps.filter((o) => o.isOnline !== false).length;

            return {
              id,
              name,
              kind,
              category: kind,
              operatorsTotal: memberOps.length,
              operatorsOnline,
              inQueue,
              inProgress,
              inAttendance: inProgress,
              completed,
              activeInPeriod: Math.max(activeInPeriod, completed + inProgress),
              messagesSent,
              avgResponse,
              slaPct,
              withinSla: Math.max(0, secSlaLogs.length - secOverdue),
              overdueSla: secOverdue,
              qaScore,
              avgQaScore: qaScore,
              openDealsCount: secOpenDeals.length,
              dealsOpen: secOpenDeals.length,
              openPipelineValue: secOpenValue,
              pipelineValue: secOpenValue,
              wonDealsCount: secWonDeals.length,
              dealsWon: secWonDeals.length,
              wonValue: secWonValue,
            };
          };

          const sectorDetails = allSectors.map((sec, idx) => {
            const secOpIds = Array.isArray(sec.operatorIds) ? sec.operatorIds.filter(Boolean) : [];
            const secOpSet = new Set(secOpIds);
            const basic = sectorMetrics[idx];
            return buildSectorDetailRow({
              id: sec.id,
              name: sec.name,
              kind: "sector",
              memberOpIds: secOpIds,
              matchConv: (c) =>
                c.sectorId === sec.id || (!c.sectorId && Boolean(c.operatorId && secOpSet.has(c.operatorId))),
              fallbackBasic: basic,
            });
          });

          // Adicionar divisões comerciais (Máquinas / Personnalité) se houver operadores configurados
          const maquinasOpIds = Array.from(divisionByOperatorId.entries())
            .filter(([, div]) => div === "maquinas")
            .map(([oid]) => oid);
          const personnaliteOpIds = Array.from(divisionByOperatorId.entries())
            .filter(([, div]) => div === "personnalite")
            .map(([oid]) => oid);

          if (maquinasOpIds.length > 0 && !sectorDetails.some((s) => /m[aá]quinas/i.test(s.name))) {
            const maqSet = new Set(maquinasOpIds);
            sectorDetails.push(
              buildSectorDetailRow({
                id: "division:maquinas",
                name: "Divisão Máquinas",
                kind: "division",
                memberOpIds: maquinasOpIds,
                matchConv: (c) => Boolean(c.operatorId && maqSet.has(c.operatorId)),
              })
            );
          }

          if (personnaliteOpIds.length > 0 && !sectorDetails.some((s) => /personnalit/i.test(s.name))) {
            const persSet = new Set(personnaliteOpIds);
            sectorDetails.push(
              buildSectorDetailRow({
                id: "division:personnalite",
                name: "Divisão Personnalité",
                kind: "division",
                memberOpIds: personnaliteOpIds,
                matchConv: (c) => Boolean(c.operatorId && persSet.has(c.operatorId)),
              })
            );
          }

          // Conversas em Triagem / Fila Geral sem setor nem operador atribuído
          const allAssignedSectorOpIds = new Set<string>();
          for (const sec of allSectors) {
            if (Array.isArray(sec.operatorIds)) {
              for (const oid of sec.operatorIds) allAssignedSectorOpIds.add(oid);
            }
          }
          const unassignedConvs = visibleConvs.filter(
            (c) => !c.sectorId && (!c.operatorId || !allAssignedSectorOpIds.has(c.operatorId))
          );
          if (unassignedConvs.length > 0 && allSectors.length > 0) {
            sectorDetails.push(
              buildSectorDetailRow({
                id: "unassigned",
                name: "Triagem IA / Fila Geral (Sem Setor)",
                kind: "unassigned",
                memberOpIds: [],
                matchConv: (c) => !c.sectorId && (!c.operatorId || !allAssignedSectorOpIds.has(c.operatorId)),
              })
            );
          }

          // ── 10. Matriz de Produtividade & Conversão por Consultor ──────────
          const operatorSectorMap = new Map<string, string>();
          for (const sec of allSectors) {
            for (const oid of sec.operatorIds ?? []) {
              if (!operatorSectorMap.has(oid)) operatorSectorMap.set(oid, sec.name);
            }
          }

          const avatarResolver = buildConsultantAvatarResolver([allOperatorsRows]);

          const consultantProductivity = allOperatorsRows
            .map((op) => {
              const opConvs = visibleConvs.filter((c) => c.operatorId === op.id);
              const activeChatsNow = opConvs.filter((c) => c.queueState === "meus").length;
              const completedInPeriod = opConvs.filter((c) => c.queueState === "finalizados").length;
              const handledSet = handledConvsByOperator.get(op.id);
              const handledInPeriod = Math.max(handledSet?.size ?? 0, activeChatsNow + completedInPeriod);
              const messagesSent = messagesSentByOperator.get(op.id) ?? 0;

              const opSlaLogs = periodSlaLogsRows.filter((l) => l.operatorId === op.id);
              const opValidTimes = opSlaLogs
                .map((l) => l.responseTimeSeconds)
                .filter((v): v is number => typeof v === "number" && v > 0);
              const avgResponseSeconds = computeOperationalAvgSeconds(opValidTimes);
              const opOverdue = opSlaLogs.filter((l) => l.isOverdue).length;
              const slaPct =
                opSlaLogs.length > 0
                  ? Math.round(((opSlaLogs.length - opOverdue) / opSlaLogs.length) * 100)
                  : null;

              const opAudits = auditsRows.filter((a) => a.operatorId === op.id);
              const opScores = opAudits
                .map((a) => a.performanceScore)
                .filter((s): s is number => typeof s === "number");
              const qaScore =
                opScores.length > 0 ? Math.round(opScores.reduce((a, b) => a + b, 0) / opScores.length) : null;

              // Atividades, ligações e tarefas do consultor
              const opActivities = dealActivitiesRows.filter(
                (a) => a.assignedToOperatorId === op.id || a.operatorId === op.id
              );
              const opCallActivities = opActivities.filter((a) => a.type === "call");
              const opCalls = (callsByOperator.get(op.id) ?? 0) + opCallActivities.length;
              const opCallsAnswered =
                (callsByOperator.get(op.id) ?? 0) +
                opCallActivities.filter((a) => a.status === "completed").length;

              const opTasksFromCrm = opActivities.filter((a) => a.type === "task" || a.type === "meeting");
              const opLegacyTasks = op.email
                ? tasksRows.filter((t) => (t.operatorEmail || "").toLowerCase() === op.email.toLowerCase())
                : [];

              const tasksCompleted =
                opTasksFromCrm.filter((t) => t.status === "completed").length +
                opLegacyTasks.filter((t) => t.status === "completed" || t.status === "done").length;

              const tasksOpen =
                opTasksFromCrm.filter((t) => t.status === "pending").length +
                opLegacyTasks.filter((t) => t.status !== "completed" && t.status !== "done").length;

              const tasksOverdue =
                opTasksFromCrm.filter(
                  (t) => t.status === "pending" && t.dueDate && new Date(t.dueDate).getTime() < now.getTime()
                ).length +
                opLegacyTasks.filter(
                  (t) =>
                    t.status !== "completed" &&
                    t.status !== "done" &&
                    t.dueDate &&
                    new Date(t.dueDate).getTime() < now.getTime()
                ).length;

              // Negociações do CRM
              const opDeals = crmDealsRows.filter((d) => d.operatorId === op.id);
              const opOpenDeals = opDeals.filter((d) => d.status === "open");
              const opWonDeals = opDeals.filter((d) => d.status === "won");
              const opLostDeals = opDeals.filter((d) => d.status === "lost");
              const openPipelineValue = opOpenDeals.reduce((s, d) => s + Number(d.value || 0), 0);
              const wonValue = opWonDeals.reduce((s, d) => s + Number(d.value || 0), 0);
              const totalClosed = opWonDeals.length + opLostDeals.length;
              const conversionRatePct =
                totalClosed > 0
                  ? Math.round((opWonDeals.length / totalClosed) * 100)
                  : opDeals.length > 0 && opWonDeals.length > 0
                    ? Math.round((opWonDeals.length / opDeals.length) * 100)
                    : 0;

              const divRaw = divisionByOperatorId.get(op.id);
              const sectorName = operatorSectorMap.get(op.id) ?? (op.role === "admin" ? "Gestão" : "Comercial");
              const divisionLabel =
                divRaw === "personnalite"
                  ? "Divisão Personnalité"
                  : divRaw === "maquinas"
                    ? "Divisão Máquinas"
                    : "Geral";
              const roleSubtitle =
                divRaw === "personnalite"
                  ? "Divisão Personnalité"
                  : divRaw === "maquinas"
                    ? "Divisão Máquinas"
                    : sectorName;

              return {
                id: op.id,
                operatorId: op.id,
                name: op.name,
                role: op.role,
                avatar: op.avatar || avatarResolver.getAvatar(op.id, op.name) || null,
                roleSubtitle,
                sectorName,
                divisionLabel,
                online: op.isOnline !== false,
                isOnline: op.isOnline !== false,
                activeChatsNow,
                handledInPeriod,
                completedInPeriod,
                messagesSent,
                messagesReceived: 0,
                callsCount: opCalls,
                callsTotal: opCalls,
                callsAnswered: opCallsAnswered,
                callSeconds: 0,
                tasksCompleted,
                tasksOpen,
                tasksOverdue,
                avgResponseSeconds: avgResponseSeconds ?? 0,
                slaPct,
                overdueSlaCount: opOverdue,
                qaScore,
                avgQaScore: qaScore,
                openDealsCount: opOpenDeals.length,
                dealsOpen: opOpenDeals.length,
                openPipelineValue,
                pipelineValue: openPipelineValue,
                wonDealsCount: opWonDeals.length,
                dealsWon: opWonDeals.length,
                wonValue,
                lostDealsCount: opLostDeals.length,
                dealsLost: opLostDeals.length,
                conversionRatePct,
              };
            })
            .sort((a, b) => {
              if (b.wonValue !== a.wonValue) return b.wonValue - a.wonValue;
              if (b.handledInPeriod !== a.handledInPeriod) return b.handledInPeriod - a.handledInPeriod;
              if (b.messagesSent !== a.messagesSent) return b.messagesSent - a.messagesSent;
              return a.name.localeCompare(b.name, "pt-BR");
            });

          // ── 11. Eficiência da Triagem IA (Fagner / Valentina) ──────────────
          const aiPersonaName = tenantId === "valem" ? "Valentina" : "Fagner";
          const sdrFlows = flowStatesRows.filter((f) => !f.agentType || f.agentType === "sdr");
          const sdrFlowsInPeriod = sdrFlows.filter((f) => {
            const ref = f.lastInteractionAt || f.startedAt;
            return ref ? new Date(ref) >= periodStart && new Date(ref) <= periodEnd : true;
          });
          const transferredFlows = sdrFlowsInPeriod.filter(
            (f) => f.outcome === "transferred" || f.outcome === "completed" || f.completedAt != null
          );
          const funnelCounter = new Map<string, number>();
          for (const f of sdrFlowsInPeriod) {
            const meta = (f.metadata ?? {}) as Record<string, any>;
            const targetFunnel = meta.targetFunnel || meta.funnelStage || f.currentStep || "Em Triagem";
            funnelCounter.set(String(targetFunnel), (funnelCounter.get(String(targetFunnel)) ?? 0) + 1);
          }
          const topFunnels = Array.from(funnelCounter.entries())
            .map(([name, countVal]) => ({ name, count: countVal }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

          const totalTriaged = Math.max(sdrFlowsInPeriod.length, inAutomationCount + transferredFlows.length);
          const transferredTotal = Math.max(transferredFlows.length, transferEventsRows.length);

          const triageSummary = {
            aiPersonaName,
            totalTriagedInPeriod: totalTriaged,
            inProgressNow: inAutomationCount,
            completedTriageCount: transferredTotal,
            transferredToHuman: transferredTotal,
            qualificationRatePct:
              totalTriaged > 0 ? Math.min(100, Math.round((transferredTotal / totalTriaged) * 100)) : 0,
            avgPickupSeconds: avgTransferPickupSeconds,
            topFunnels,
          };

          const filterOptions = {
            sectors: allSectors.map((s) => ({ id: s.id, name: s.name })),
            divisions: [
              ...(maquinasOpIds.length > 0 ? [{ id: "division:maquinas", name: "Divisão Máquinas" }] : []),
              ...(personnaliteOpIds.length > 0 ? [{ id: "division:personnalite", name: "Divisão Personnalité" }] : []),
            ],
            channels: [
              { id: "all", name: "Todos os Canais" },
              { id: "meta_official", name: "WhatsApp Oficial" },
              { id: "baileys_linked", name: "Celulares Vinculados" },
            ],
          };

          return new Response(
            JSON.stringify({
              period: periodParam,
              volumes,
              channels,
              sectors: sectorMetrics,
              sectorDetails,
              kpis,
              operationalFunnel,
              hourlyDemand,
              consultantProductivity,
              triageSummary,
              filterOptions,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[gestao/performance] Erro GET:", e);
          return new Response(
            JSON.stringify({
              error: "Não foi possível carregar os indicadores de desempenho.",
              code: "PERFORMANCE_UNAVAILABLE",
            }),
            {
              status: 503,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
