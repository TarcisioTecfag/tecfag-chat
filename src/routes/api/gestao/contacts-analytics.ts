import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  contacts,
  contactPhones,
  crmAccounts,
  conversations,
  messages,
  crmDeals,
  crmDealContacts,
  crmConversationDeals,
  aiConversationAudits,
  operators,
  responseTimeLogs,
} from "../../../db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { conversationReadCondition } from "../../../lib/access-control/conversation-access";
import { buildConsultantAvatarResolver } from "../../../lib/commercial/avatar-matcher";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type PeriodKey = "7d" | "30d" | "90d" | "month" | "all";

function resolvePeriodRange(period: PeriodKey, now: Date): {
  start: Date;
  prevStart: Date;
  prevEnd: Date;
  days: number;
  label: string;
} {
  const dayMs = 24 * 60 * 60 * 1000;
  if (period === "7d") {
    const start = new Date(now.getTime() - 7 * dayMs);
    const prevStart = new Date(now.getTime() - 14 * dayMs);
    return { start, prevStart, prevEnd: start, days: 7, label: "Últimos 7 dias" };
  }
  if (period === "90d") {
    const start = new Date(now.getTime() - 90 * dayMs);
    const prevStart = new Date(now.getTime() - 180 * dayMs);
    return { start, prevStart, prevEnd: start, days: 90, label: "Últimos 90 dias" };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const days = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / dayMs));
    return { start, prevStart, prevEnd: start, days, label: "Este mês" };
  }
  if (period === "all") {
    const start = new Date(2020, 0, 1);
    const prevStart = new Date(2019, 0, 1);
    return { start, prevStart, prevEnd: start, days: 365, label: "Todo o histórico" };
  }
  // Default: 30d
  const start = new Date(now.getTime() - 30 * dayMs);
  const prevStart = new Date(now.getTime() - 60 * dayMs);
  return { start, prevStart, prevEnd: start, days: 30, label: "Últimos 30 dias" };
}

function formatDayMonth(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function normalizeChannelKey(raw: string | null | undefined): "whatsapp" | "instagram" | "messenger" | "livechat" {
  const ch = (raw || "whatsapp").toLowerCase().trim();
  if (ch.includes("instagram")) return "instagram";
  if (ch.includes("messenger")) return "messenger";
  if (ch.includes("livechat") || ch.includes("site") || ch.includes("web")) return "livechat";
  return "whatsapp";
}

export const Route = createFileRoute("/api/gestao/contacts-analytics")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (
          session.permissions?.views?.analytics !== true ||
          session.permissions?.analytics?.canAccessContacts !== true
        ) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para acessar métricas de contatos.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const readScope = conversationReadCondition(session);
        const walletScope =
          session.permissions?.contacts?.contactScope === "wallet_only"
            ? eq(contacts.walletOperatorId, session.operator.id)
            : undefined;
        const restrictDealsToOperator =
          session.operator.role !== "admin" && session.permissions?.crm?.canViewAllDeals !== true;

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const rawPeriod = (url.searchParams.get("period") || "30d") as PeriodKey;
        const periodKey: PeriodKey = ["7d", "30d", "90d", "month", "all"].includes(rawPeriod)
          ? rawPeriod
          : "30d";
        const filterOperatorId = url.searchParams.get("operatorId") || "all";
        const filterChannel = url.searchParams.get("channel") || "all";

        try {
          const now = new Date();
          const dayMs = 24 * 60 * 60 * 1000;
          const thirtyDaysAgo = new Date(now.getTime() - 30 * dayMs);
          const { start: periodStart, prevStart, prevEnd, label: periodLabel } = resolvePeriodRange(
            periodKey,
            now
          );

          // ── 1. Carregamento Paralelo Multi-Tenant Isolado ───────────────────
          const [
            allContactsRows,
            allConvsRows,
            allOperatorsRows,
            allAccountsRows,
            allDealsRows,
            dealContactLinks,
            convDealLinks,
            doneAuditsRows,
            phoneCountsRows,
            recentMsgActivityRows,
            slaOperatorRows,
          ] = await Promise.all([
            db
              .select({
                id: contacts.id,
                accountId: contacts.accountId,
                name: contacts.name,
                phone: contacts.phone,
                email: contacts.email,
                cnpj: contacts.cnpj,
                cpf: contacts.cpf,
                avatar: contacts.avatar,
                tags: contacts.tags,
                mainChannel: contacts.mainChannel,
                walletOperatorId: contacts.walletOperatorId,
                responsibleName: contacts.responsibleName,
                createdAt: contacts.createdAt,
              })
              .from(contacts)
              .where(and(eq(contacts.tenantId, tenantId), walletScope)),

            db
              .select({
                id: conversations.id,
                contactId: conversations.contactId,
                operatorId: conversations.operatorId,
                sectorId: conversations.sectorId,
                queueState: conversations.queueState,
                unreadCount: conversations.unreadCount,
                lastMessageText: conversations.lastMessageText,
                lastMessageTime: conversations.lastMessageTime,
                createdAt: conversations.createdAt,
              })
              .from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), readScope)),

            db
              .select({
                id: operators.id,
                name: operators.name,
                avatar: operators.avatar,
                role: operators.role,
              })
              .from(operators)
              .where(eq(operators.tenantId, tenantId)),

            db
              .select({
                id: crmAccounts.id,
                type: crmAccounts.type,
                name: crmAccounts.name,
                tradeName: crmAccounts.tradeName,
                segment: crmAccounts.segment,
                document: crmAccounts.document,
              })
              .from(crmAccounts)
              .where(eq(crmAccounts.tenantId, tenantId))
              .catch(() => []),

            db
              .select({
                id: crmDeals.id,
                title: crmDeals.title,
                accountId: crmDeals.accountId,
                status: crmDeals.status,
                value: crmDeals.value,
                operatorId: crmDeals.operatorId,
                source: crmDeals.source,
                campaign: crmDeals.campaign,
                closedAt: crmDeals.closedAt,
                createdAt: crmDeals.createdAt,
                updatedAt: crmDeals.updatedAt,
              })
              .from(crmDeals)
              .where(
                and(
                  eq(crmDeals.tenantId, tenantId),
                  restrictDealsToOperator ? eq(crmDeals.operatorId, session.operator.id) : undefined
                )
              )
              .catch(() => []),

            db
              .select({
                dealId: crmDealContacts.dealId,
                contactId: crmDealContacts.contactId,
                isPrimary: crmDealContacts.isPrimary,
              })
              .from(crmDealContacts)
              .where(eq(crmDealContacts.tenantId, tenantId))
              .catch(() => []),

            db
              .select({
                conversationId: crmConversationDeals.conversationId,
                dealId: crmConversationDeals.dealId,
                isActive: crmConversationDeals.isActive,
              })
              .from(crmConversationDeals)
              .where(
                and(
                  eq(crmConversationDeals.tenantId, tenantId),
                  eq(crmConversationDeals.isActive, true)
                )
              )
              .catch(() => []),

            db
              .select({
                conversationId: aiConversationAudits.conversationId,
                operatorId: aiConversationAudits.operatorId,
                performanceScore: aiConversationAudits.performanceScore,
                clientSentiment: aiConversationAudits.clientSentiment,
                hadNoFollowUp: aiConversationAudits.hadNoFollowUp,
                status: aiConversationAudits.status,
                auditedAt: aiConversationAudits.auditedAt,
                createdAt: aiConversationAudits.createdAt,
              })
              .from(aiConversationAudits)
              .innerJoin(
                conversations,
                and(
                  eq(conversations.id, aiConversationAudits.conversationId),
                  eq(conversations.tenantId, tenantId)
                )
              )
              .where(
                and(
                  eq(aiConversationAudits.tenantId, tenantId),
                  eq(aiConversationAudits.status, "done"),
                  readScope
                )
              )
              .catch(() => []),

            db
              .select({
                contactId: contactPhones.contactId,
                phonesCount: sql<number>`count(*)`.mapWith(Number),
              })
              .from(contactPhones)
              .where(eq(contactPhones.tenantId, tenantId))
              .groupBy(contactPhones.contactId)
              .catch(() => []),

            // Atividade de mensagens nos últimos 90 dias por conversa (dias distintos no mês + última msg)
            db
              .select({
                conversationId: messages.conversationId,
                activeDays30d: sql<number>`count(distinct date(${messages.sentAt})) filter (where ${messages.sentAt} >= ${thirtyDaysAgo})`.mapWith(Number),
                messages30d: sql<number>`count(*) filter (where ${messages.sentAt} >= ${thirtyDaysAgo})`.mapWith(Number),
                lastSentAt: sql<string | null>`max(${messages.sentAt})`,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  gte(messages.sentAt, new Date(now.getTime() - 90 * dayMs))
                )
              )
              .groupBy(messages.conversationId)
              .catch(() => []),

            db
              .select({
                operatorId: responseTimeLogs.operatorId,
                avgSeconds: sql<number>`avg(${responseTimeLogs.responseTimeSeconds})`.mapWith(Number),
                sampleCount: sql<number>`count(*)`.mapWith(Number),
              })
              .from(responseTimeLogs)
              .where(and(eq(responseTimeLogs.tenantId, tenantId)))
              .groupBy(responseTimeLogs.operatorId)
              .catch(() => []),
          ]);

          // ── 2. Mapas de Indexação Rápida em Memória ────────────────────────
          const operatorMap = new Map(allOperatorsRows.map((op) => [op.id, op]));
          const accountMap = new Map(allAccountsRows.map((acc) => [acc.id, acc]));
          const phoneCountByContact = new Map(
            phoneCountsRows.map((r) => [r.contactId, Number(r.phonesCount || 1)])
          );
          const msgActivityByConv = new Map(
            recentMsgActivityRows.map((r) => [
              r.conversationId,
              {
                activeDays30d: Number(r.activeDays30d || 0),
                messages30d: Number(r.messages30d || 0),
                lastSentAt: r.lastSentAt ? new Date(r.lastSentAt) : null,
              },
            ])
          );
          const tmeByOperator = new Map(
            slaOperatorRows
              .filter((r) => r.operatorId)
              .map((r) => [r.operatorId as string, Math.round(Number(r.avgSeconds || 0))])
          );

          // Conversas por contato
          const convsByContact = new Map<string, typeof allConvsRows>();
          const convById = new Map<string, (typeof allConvsRows)[number]>();
          for (const conv of allConvsRows) {
            convById.set(conv.id, conv);
            const list = convsByContact.get(conv.contactId) || [];
            list.push(conv);
            convsByContact.set(conv.contactId, list);
          }

          // Deals por ID e Vínculos Contato <-> Deal
          const dealById = new Map(allDealsRows.map((d) => [d.id, d]));
          const dealsByContact = new Map<string, Map<string, (typeof allDealsRows)[number]>>();

          const linkDealToContact = (contactId: string, deal: (typeof allDealsRows)[number]) => {
            if (!contactId || !deal) return;
            let map = dealsByContact.get(contactId);
            if (!map) {
              map = new Map();
              dealsByContact.set(contactId, map);
            }
            map.set(deal.id, deal);
          };

          // 2.1 Vínculo via crm_deal_contacts
          for (const link of dealContactLinks) {
            const d = dealById.get(link.dealId);
            if (d) linkDealToContact(link.contactId, d);
          }
          // 2.2 Vínculo via crm_conversation_deals -> conversation.contactId
          for (const link of convDealLinks) {
            const conv = convById.get(link.conversationId);
            const d = dealById.get(link.dealId);
            if (conv && d) linkDealToContact(conv.contactId, d);
          }
          // 2.3 Vínculo via accountId compartilhado
          const contactsByAccount = new Map<string, string[]>();
          for (const c of allContactsRows) {
            if (c.accountId) {
              const list = contactsByAccount.get(c.accountId) || [];
              list.push(c.id);
              contactsByAccount.set(c.accountId, list);
            }
          }
          for (const deal of allDealsRows) {
            if (deal.accountId) {
              const cIds = contactsByAccount.get(deal.accountId) || [];
              for (const cId of cIds) {
                linkDealToContact(cId, deal);
              }
            }
          }

          // Última auditoria concluída por conversa / contato
          const latestAuditByContact = new Map<
            string,
            {
              sentiment: "satisfeito" | "neutro" | "frustrado" | null;
              score: number | null;
              hadNoFollowUp: boolean;
            }
          >();
          for (const aud of doneAuditsRows) {
            const conv = convById.get(aud.conversationId);
            if (!conv) continue;
            const sent =
              aud.clientSentiment === "satisfeito" ||
              aud.clientSentiment === "neutro" ||
              aud.clientSentiment === "frustrado"
                ? aud.clientSentiment
                : null;
            latestAuditByContact.set(conv.contactId, {
              sentiment: sent,
              score: aud.performanceScore ?? null,
              hadNoFollowUp: Boolean(aud.hadNoFollowUp),
            });
          }

          // ── 3. Filtragem dos Contatos pelo Escopo Selecionado (Operador / Canal) ──
          const ResolveContactOperatorId = (c: (typeof allContactsRows)[number]): string | null => {
            if (c.walletOperatorId) return c.walletOperatorId;
            const convs = convsByContact.get(c.id) || [];
            for (const cv of convs) {
              if (cv.operatorId) return cv.operatorId;
            }
            const dealMap = dealsByContact.get(c.id);
            if (dealMap) {
              for (const d of dealMap.values()) {
                if (d.operatorId) return d.operatorId;
              }
            }
            return null;
          };

          const filteredContacts = allContactsRows.filter((c) => {
            if (filterChannel !== "all") {
              const ch = normalizeChannelKey(c.mainChannel);
              if (ch !== filterChannel) return false;
            }
            if (filterOperatorId !== "all") {
              const resolvedOpId = ResolveContactOperatorId(c);
              if (filterOperatorId === "unassigned") {
                if (resolvedOpId !== null) return false;
              } else if (resolvedOpId !== filterOperatorId) {
                return false;
              }
            }
            return true;
          });

          const filteredContactIds = new Set(filteredContacts.map((c) => c.id));

          // ── 4. Série Semanal: Novos vs. Recorrentes (Corrigido!) ────────────
          // 4 semanas se 7d/30d/month, 8 semanas se 90d/all
          const numWeeks = periodKey === "90d" || periodKey === "all" ? 8 : 4;
          const weeks: {
            name: string;
            shortName: string;
            periodLabel: string;
            start: Date;
            end: Date;
          }[] = [];

          for (let i = numWeeks - 1; i >= 0; i--) {
            const start = new Date(now.getTime() - (i + 1) * 7 * dayMs);
            const end = new Date(now.getTime() - i * 7 * dayMs);
            const rangeStr = `${formatDayMonth(start)}–${formatDayMonth(end)}`;
            const weekIndex = numWeeks - i;
            weeks.push({
              name: `${rangeStr}`,
              shortName: `Sem ${weekIndex}`,
              periodLabel: `${formatDayMonth(start)} a ${formatDayMonth(end)}`,
              start,
              end,
            });
          }

          const clientMetrics = weeks.map((w) => {
            let novos = 0;
            let novosAtendidos = 0;
            let recorrentes = 0;
            let comNegocio = 0;

            for (const c of filteredContacts) {
              const createdAt = new Date(c.createdAt);
              const isCreatedInWeek = createdAt >= w.start && createdAt <= w.end;
              const isCreatedBeforeWeek = createdAt < w.start;

              const convs = convsByContact.get(c.id) || [];
              const hadActivityInWeek = convs.some((cv) => {
                const lastMsg = new Date(cv.lastMessageTime);
                const convCreated = new Date(cv.createdAt);
                return (
                  (lastMsg >= w.start && lastMsg <= w.end) ||
                  (convCreated >= w.start && convCreated <= w.end)
                );
              });

              const hasDeal = (dealsByContact.get(c.id)?.size ?? 0) > 0;

              if (isCreatedInWeek) {
                novos += 1;
                if (hadActivityInWeek) novosAtendidos += 1;
                if (hasDeal) comNegocio += 1;
              } else if (isCreatedBeforeWeek && hadActivityInWeek) {
                recorrentes += 1;
                if (hasDeal) comNegocio += 1;
              }
            }

            return {
              name: w.name,
              shortName: w.shortName,
              periodLabel: w.periodLabel,
              novos,
              novosAtendidos,
              recorrentes,
              comNegocio,
            };
          });

          // ── 5. Consolidação de KPIs, Funil, Aging, Fontes e Carteira ────────
          let newInPeriod = 0;
          let newInPrevPeriod = 0;
          let companiesLinkedCount = 0;
          let withEmailCount = 0;
          let withWalletCount = 0;
          let orphanContactsCount = 0;
          let withMultiPhonesCount = 0;
          let withTagsCount = 0;

          let contactsWithConvCount = 0;
          let activeInPeriodCount = 0;
          let newActiveInPeriodCount = 0;
          let returningActiveInPeriodCount = 0;
          let waitingReplyCount = 0;

          let contactsWithAnyDealCount = 0;
          let contactsWithOpenDealCount = 0;
          let contactsWonCount = 0;
          let contactsLostOnlyCount = 0;
          let contactsChatWithoutDealCount = 0;

          let atRiskWithOpenDealCount = 0;
          let atRiskOpenValue = 0;

          const uniqueDealsInScope = new Map<string, (typeof allDealsRows)[number]>();

          // Aging buckets
          const agingMap = {
            active_7d: {
              id: "active_7d",
              label: "Ativos (< 7 dias)",
              shortLabel: "< 7 dias",
              description: "Interação recente nos últimos 7 dias",
              count: 0,
              openDealsCount: 0,
              openPipelineValue: 0,
            },
            warm_15d: {
              id: "warm_15d",
              label: "Recentes (7 a 15 dias)",
              shortLabel: "7 a 15 dias",
              description: "Sem nova mensagem entre 7 e 15 dias",
              count: 0,
              openDealsCount: 0,
              openPipelineValue: 0,
            },
            cooling_30d: {
              id: "cooling_30d",
              label: "Esfriando (15 a 30 dias)",
              shortLabel: "15 a 30 dias",
              description: "Atenção: cliente esfriando sem follow-up recente",
              count: 0,
              openDealsCount: 0,
              openPipelineValue: 0,
            },
            cold_30d_plus: {
              id: "cold_30d_plus",
              label: "Adormecidos (> 30 dias)",
              shortLabel: "> 30 dias",
              description: "Risco elevado: mais de 30 dias sem interação",
              count: 0,
              openDealsCount: 0,
              openPipelineValue: 0,
            },
            never_contacted: {
              id: "never_contacted",
              label: "Sem Chat Aberto",
              shortLabel: "Sem Chat",
              description: "Cadastrado na base/CRM mas sem histórico de chat",
              count: 0,
              openDealsCount: 0,
              openPipelineValue: 0,
            },
          };

          let sumDaysSinceLastContact = 0;
          let countContactsWithLastContact = 0;
          let totalActiveDays30dSum = 0;
          let activeContacts30dCount = 0;

          // Mapas de Aquisição por Fonte e Campanha
          const sourceStatsMap = new Map<
            string,
            {
              name: string;
              clients: Set<string>;
              dealsCount: number;
              wonCount: number;
              openCount: number;
              wonValue: number;
              openValue: number;
            }
          >();
          const campaignStatsMap = new Map<
            string,
            {
              name: string;
              clients: Set<string>;
              dealsCount: number;
              wonCount: number;
              wonValue: number;
              openValue: number;
            }
          >();

          // Mapa de Carteira por Consultor
          const portfolioByOperator = new Map<
            string,
            {
              operatorId: string;
              operatorName: string;
              avatar: string | null;
              walletContactsCount: number;
              activeInPeriodCount: number;
              openDealsCount: number;
              openPipelineValue: number;
              wonClientsCount: number;
              wonRevenue: number;
              staleClientsCount: number;
              withoutDealCount: number;
            }
          >();

          const avatarResolver = buildConsultantAvatarResolver([allOperatorsRows]);

          for (const op of allOperatorsRows) {
            portfolioByOperator.set(op.id, {
              operatorId: op.id,
              operatorName: op.name,
              avatar: op.avatar || avatarResolver.getAvatar(op.id, op.name) || null,
              walletContactsCount: 0,
              activeInPeriodCount: 0,
              openDealsCount: 0,
              openPipelineValue: 0,
              wonClientsCount: 0,
              wonRevenue: 0,
              staleClientsCount: 0,
              withoutDealCount: 0,
            });
          }

          // Lista detalhada para a tabela executiva
          const priorityClientsList: Array<{
            contactId: string;
            name: string;
            phone: string | null;
            email: string | null;
            avatar: string | null;
            channel: string;
            companyName: string | null;
            operatorId: string | null;
            operatorName: string;
            operatorAvatar: string | null;
            conversationId: string | null;
            queueState: string | null;
            unreadCount: number;
            lastInteractionAt: string | null;
            daysSinceLastContact: number | null;
            openDealsCount: number;
            wonDealsCount: number;
            lostDealsCount: number;
            openDealValue: number;
            wonDealValue: number;
            primaryDealId: string | null;
            primaryDealTitle: string | null;
            primaryDealStatus: string | null;
            source: string | null;
            campaign: string | null;
            sentiment: "satisfeito" | "neutro" | "frustrado" | null;
            riskFlags: string[];
            priorityScore: number;
          }> = [];

          for (const c of filteredContacts) {
            const createdAt = new Date(c.createdAt);
            if (createdAt >= periodStart) newInPeriod += 1;
            else if (createdAt >= prevStart && createdAt < prevEnd) newInPrevPeriod += 1;

            const account = c.accountId ? accountMap.get(c.accountId) : undefined;
            const hasCompany = Boolean(
              (account && account.type === "company") ||
                c.accountId ||
                (c.cnpj && c.cnpj.trim().length > 0)
            );
            if (hasCompany) companiesLinkedCount += 1;
            if (c.email && c.email.trim().length > 0) withEmailCount += 1;

            const resolvedOpId = ResolveContactOperatorId(c);
            const resolvedOp = resolvedOpId ? operatorMap.get(resolvedOpId) : undefined;
            if (resolvedOpId) withWalletCount += 1;
            else orphanContactsCount += 1;

            if ((phoneCountByContact.get(c.id) ?? 1) > 1) withMultiPhonesCount += 1;
            if (Array.isArray(c.tags) && c.tags.length > 0) withTagsCount += 1;

            // Conversas do contato
            const convs = convsByContact.get(c.id) || [];
            let latestConv: (typeof allConvsRows)[number] | null = null;
            let lastInteractionDate: Date | null = null;
            let contactActiveDays30d = 0;
            let isWaitingReply = false;

            for (const cv of convs) {
              const cvTime = new Date(cv.lastMessageTime);
              if (!latestConv || cvTime > new Date(latestConv.lastMessageTime)) {
                latestConv = cv;
              }
              if (!lastInteractionDate || cvTime > lastInteractionDate) {
                lastInteractionDate = cvTime;
              }
              const msgStats = msgActivityByConv.get(cv.id);
              if (msgStats) {
                contactActiveDays30d = Math.max(contactActiveDays30d, msgStats.activeDays30d);
                if (msgStats.lastSentAt && msgStats.lastSentAt > (lastInteractionDate || new Date(0))) {
                  lastInteractionDate = msgStats.lastSentAt;
                }
              }
              if (cv.queueState === "fila" || (cv.unreadCount ?? 0) > 0) {
                isWaitingReply = true;
              }
            }

            if (convs.length > 0) contactsWithConvCount += 1;
            if (isWaitingReply) waitingReplyCount += 1;

            if (contactActiveDays30d > 0) {
              totalActiveDays30dSum += contactActiveDays30d;
              activeContacts30dCount += 1;
            } else if (
              lastInteractionDate &&
              lastInteractionDate >= thirtyDaysAgo
            ) {
              totalActiveDays30dSum += 1;
              activeContacts30dCount += 1;
            }

            const isActiveInPeriod = Boolean(
              lastInteractionDate && lastInteractionDate >= periodStart
            );
            if (isActiveInPeriod) {
              activeInPeriodCount += 1;
              if (createdAt >= periodStart) newActiveInPeriodCount += 1;
              else returningActiveInPeriodCount += 1;
            }

            const daysSinceLastContact = lastInteractionDate
              ? Math.max(0, Math.floor((now.getTime() - lastInteractionDate.getTime()) / dayMs))
              : null;

            if (daysSinceLastContact !== null) {
              sumDaysSinceLastContact += daysSinceLastContact;
              countContactsWithLastContact += 1;
            }

            // Negociações vinculadas ao contato
            const contactDealsMap = dealsByContact.get(c.id);
            const contactDeals = contactDealsMap ? Array.from(contactDealsMap.values()) : [];
            let openDealsCount = 0;
            let wonDealsCount = 0;
            let lostDealsCount = 0;
            let openDealValue = 0;
            let wonDealValue = 0;
            let primaryDeal: (typeof allDealsRows)[number] | null = null;

            for (const d of contactDeals) {
              uniqueDealsInScope.set(d.id, d);
              const val = Number(d.value || 0);
              if (d.status === "open") {
                openDealsCount += 1;
                openDealValue += val;
              } else if (d.status === "won") {
                wonDealsCount += 1;
                wonDealValue += val;
              } else if (d.status === "lost") {
                lostDealsCount += 1;
              }

              if (
                !primaryDeal ||
                (d.status === "open" && primaryDeal.status !== "open") ||
                Number(d.value || 0) > Number(primaryDeal.value || 0)
              ) {
                primaryDeal = d;
              }

              // Fontes & Campanhas
              const srcName = d.source?.trim() || "";
              if (srcName) {
                const entry = sourceStatsMap.get(srcName) || {
                  name: srcName,
                  clients: new Set<string>(),
                  dealsCount: 0,
                  wonCount: 0,
                  openCount: 0,
                  wonValue: 0,
                  openValue: 0,
                };
                entry.clients.add(c.id);
                entry.dealsCount += 1;
                if (d.status === "won") {
                  entry.wonCount += 1;
                  entry.wonValue += val;
                } else if (d.status === "open") {
                  entry.openCount += 1;
                  entry.openValue += val;
                }
                sourceStatsMap.set(srcName, entry);
              }

              const campName = d.campaign?.trim() || "";
              if (campName) {
                const entry = campaignStatsMap.get(campName) || {
                  name: campName,
                  clients: new Set<string>(),
                  dealsCount: 0,
                  wonCount: 0,
                  wonValue: 0,
                  openValue: 0,
                };
                entry.clients.add(c.id);
                entry.dealsCount += 1;
                if (d.status === "won") {
                  entry.wonCount += 1;
                  entry.wonValue += val;
                } else if (d.status === "open") {
                  entry.openValue += val;
                }
                campaignStatsMap.set(campName, entry);
              }
            }

            if (contactDeals.length > 0) {
              contactsWithAnyDealCount += 1;
              if (openDealsCount > 0) contactsWithOpenDealCount += 1;
              if (wonDealsCount > 0) contactsWonCount += 1;
              if (openDealsCount === 0 && wonDealsCount === 0 && lostDealsCount > 0) {
                contactsLostOnlyCount += 1;
              }
            } else if (convs.length > 0) {
              contactsChatWithoutDealCount += 1;
            }

            // Classificação no Aging de Relacionamento
            const isStale15d = daysSinceLastContact === null || daysSinceLastContact > 15;
            if (openDealsCount > 0 && isStale15d) {
              atRiskWithOpenDealCount += 1;
              atRiskOpenValue += openDealValue;
            }

            let targetBucket = agingMap.never_contacted;
            if (daysSinceLastContact !== null) {
              if (daysSinceLastContact <= 7) targetBucket = agingMap.active_7d;
              else if (daysSinceLastContact <= 15) targetBucket = agingMap.warm_15d;
              else if (daysSinceLastContact <= 30) targetBucket = agingMap.cooling_30d;
              else targetBucket = agingMap.cold_30d_plus;
            }
            targetBucket.count += 1;
            if (openDealsCount > 0) {
              targetBucket.openDealsCount += openDealsCount;
              targetBucket.openPipelineValue += openDealValue;
            }

            // Atualização da Carteira do Consultor
            if (resolvedOpId && portfolioByOperator.has(resolvedOpId)) {
              const p = portfolioByOperator.get(resolvedOpId)!;
              p.walletContactsCount += 1;
              if (isActiveInPeriod) p.activeInPeriodCount += 1;
              if (openDealsCount > 0) {
                p.openDealsCount += openDealsCount;
                p.openPipelineValue += openDealValue;
              }
              if (wonDealsCount > 0) {
                p.wonClientsCount += 1;
                p.wonRevenue += wonDealValue;
              }
              if (isStale15d) p.staleClientsCount += 1;
              if (convs.length > 0 && contactDeals.length === 0) p.withoutDealCount += 1;
            }

            // Flags de Alerta & Score de Prioridade para a Tabela Executiva
            const auditInfo = latestAuditByContact.get(c.id);
            const sentiment = auditInfo?.sentiment ?? null;
            const riskFlags: string[] = [];
            let priorityScore = 0;

            if (openDealsCount > 0 && isStale15d) {
              riskFlags.push(
                daysSinceLastContact === null
                  ? "Deal aberto s/ chat"
                  : `Deal aberto · ${daysSinceLastContact}d s/ contato`
              );
              priorityScore += 50 + Math.min(30, Math.round(openDealValue / 5000));
            }
            if (sentiment === "frustrado") {
              riskFlags.push("Sentimento frustrado");
              priorityScore += 45;
            }
            if (isWaitingReply) {
              riskFlags.push("Aguardando resposta");
              priorityScore += 35;
            }
            if (convs.length > 0 && contactDeals.length === 0) {
              riskFlags.push("Atendido s/ card CRM");
              priorityScore += 25;
            }
            if (!resolvedOpId) {
              riskFlags.push("Sem consultor");
              priorityScore += 15;
            }
            if (wonDealValue > 0 || openDealValue > 0) {
              priorityScore += Math.min(40, Math.round((wonDealValue + openDealValue) / 2500));
            }

            priorityClientsList.push({
              contactId: c.id,
              name: c.name,
              phone: c.phone ?? null,
              email: c.email ?? null,
              avatar: c.avatar ?? null,
              channel: normalizeChannelKey(c.mainChannel),
              companyName: account?.tradeName || account?.name || (c.cnpj ? `CNPJ ${c.cnpj}` : null),
              operatorId: resolvedOpId,
              operatorName: resolvedOp?.name || (c.responsibleName && c.responsibleName !== "Na Fila" ? c.responsibleName : "Sem Consultor"),
              operatorAvatar:
                resolvedOp?.avatar ||
                avatarResolver.getAvatar(resolvedOpId, resolvedOp?.name || c.responsibleName) ||
                null,
              conversationId: latestConv?.id ?? null,
              queueState: latestConv?.queueState ?? null,
              unreadCount: latestConv?.unreadCount ?? 0,
              lastInteractionAt: lastInteractionDate ? lastInteractionDate.toISOString() : null,
              daysSinceLastContact,
              openDealsCount,
              wonDealsCount,
              lostDealsCount,
              openDealValue,
              wonDealValue,
              primaryDealId: primaryDeal?.id ?? null,
              primaryDealTitle: primaryDeal?.title ?? null,
              primaryDealStatus: primaryDeal?.status ?? null,
              source: primaryDeal?.source ?? null,
              campaign: primaryDeal?.campaign ?? null,
              sentiment,
              riskFlags,
              priorityScore,
            });
          }

          // ── 6. Métricas Comerciais Globais dos Deals Vinculados ────────────
          let totalWonDeals = 0;
          let totalWonRevenue = 0;
          let totalOpenDeals = 0;
          let totalOpenPipelineValue = 0;

          for (const d of uniqueDealsInScope.values()) {
            const val = Number(d.value || 0);
            if (d.status === "won") {
              totalWonDeals += 1;
              totalWonRevenue += val;
            } else if (d.status === "open") {
              totalOpenDeals += 1;
              totalOpenPipelineValue += val;
            }
          }

          const avgTicketPerBuyer =
            contactsWonCount > 0 ? Math.round(totalWonRevenue / contactsWonCount) : 0;

          // ── 7. Cálculo Real de CSAT / Sentimento IA (Apenas status='done') ──
          const validAudits = doneAuditsRows.filter((a) => {
            const conv = convById.get(a.conversationId);
            return (
              conv &&
              filteredContactIds.has(conv.contactId) &&
              (a.clientSentiment === "satisfeito" ||
                a.clientSentiment === "neutro" ||
                a.clientSentiment === "frustrado")
            );
          });

          const satisfiedCount = validAudits.filter((a) => a.clientSentiment === "satisfeito").length;
          const neutralCount = validAudits.filter((a) => a.clientSentiment === "neutro").length;
          const frustratedCount = validAudits.filter((a) => a.clientSentiment === "frustrado").length;
          const csatSampleSize = validAudits.length;

          const csatPct =
            csatSampleSize > 0 ? Math.round((satisfiedCount / csatSampleSize) * 100) : null;
          const neutralPct =
            csatSampleSize > 0 ? Math.round((neutralCount / csatSampleSize) * 100) : 0;
          const frustratedPct =
            csatSampleSize > 0 ? Math.round((frustratedCount / csatSampleSize) * 100) : 0;

          const scores = validAudits
            .map((a) => a.performanceScore)
            .filter((s): s is number => typeof s === "number" && s >= 0);
          const avgAuditScore =
            scores.length > 0
              ? Math.round(scores.reduce((acc, s) => acc + s, 0) / scores.length)
              : null;

          // ── 8. Métricas Legadas Corrigidas ─────────────────────────────────
          const avgDaysWithoutService =
            countContactsWithLastContact > 0
              ? Math.round(sumDaysSinceLastContact / countContactsWithLastContact)
              : 0;

          const avgFrequency =
            activeContacts30dCount > 0
              ? Number((totalActiveDays30dSum / activeContacts30dCount).toFixed(1))
              : 0;

          const ragConversionPct = csatPct ?? 0;

          // ── 9. Funil de Cobertura da Base ──────────────────────────────────
          const totalBase = filteredContacts.length;
          const lifecycleFunnel = [
            {
              id: "base",
              label: "Contatos na Base",
              sublabel: `${companiesLinkedCount} PJ · ${Math.max(0, totalBase - companiesLinkedCount)} PF`,
              count: totalBase,
              pctOfBase: 100,
              conversionFromPrevPct: 100,
            },
            {
              id: "chat",
              label: "Atendidos no Chat",
              sublabel: `${activeInPeriodCount} ativos em ${periodLabel.toLowerCase()}`,
              count: contactsWithConvCount,
              pctOfBase: totalBase > 0 ? Math.round((contactsWithConvCount / totalBase) * 100) : 0,
              conversionFromPrevPct:
                totalBase > 0 ? Math.round((contactsWithConvCount / totalBase) * 100) : 0,
            },
            {
              id: "crm",
              label: "Qualificados no CRM",
              sublabel: `${contactsWithOpenDealCount} com negócio em aberto`,
              count: contactsWithAnyDealCount,
              pctOfBase:
                totalBase > 0 ? Math.round((contactsWithAnyDealCount / totalBase) * 100) : 0,
              conversionFromPrevPct:
                contactsWithConvCount > 0
                  ? Math.min(100, Math.round((contactsWithAnyDealCount / contactsWithConvCount) * 100))
                  : 0,
            },
            {
              id: "won",
              label: "Clientes Compradores",
              sublabel:
                totalWonRevenue > 0
                  ? `R$ ${totalWonRevenue.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} em compras`
                  : "Negociações ganhas (Won)",
              count: contactsWonCount,
              pctOfBase: totalBase > 0 ? Math.round((contactsWonCount / totalBase) * 100) : 0,
              conversionFromPrevPct:
                contactsWithAnyDealCount > 0
                  ? Math.round((contactsWonCount / contactsWithAnyDealCount) * 100)
                  : 0,
            },
          ];

          // ── 10. Ordenação das Listas Executivas ────────────────────────────
          const inactivityBuckets = Object.values(agingMap).map((b) => ({
            ...b,
            pct: totalBase > 0 ? Math.round((b.count / totalBase) * 100) : 0,
          }));

          const acquisitionSources = Array.from(sourceStatsMap.values())
            .map((s) => ({
              name: s.name,
              clientsCount: s.clients.size,
              dealsCount: s.dealsCount,
              wonCount: s.wonCount,
              openCount: s.openCount,
              wonValue: s.wonValue,
              openValue: s.openValue,
              conversionPct:
                s.dealsCount > 0 ? Math.round((s.wonCount / s.dealsCount) * 100) : 0,
            }))
            .sort((a, b) => {
              if (b.clientsCount !== a.clientsCount) return b.clientsCount - a.clientsCount;
              return b.wonValue + b.openValue - (a.wonValue + a.openValue);
            })
            .slice(0, 8);

          const acquisitionCampaigns = Array.from(campaignStatsMap.values())
            .map((c) => ({
              name: c.name,
              clientsCount: c.clients.size,
              dealsCount: c.dealsCount,
              wonCount: c.wonCount,
              wonValue: c.wonValue,
              openValue: c.openValue,
              conversionPct:
                c.dealsCount > 0 ? Math.round((c.wonCount / c.dealsCount) * 100) : 0,
            }))
            .sort((a, b) => b.clientsCount - a.clientsCount)
            .slice(0, 8);

          const consultantPortfolios = Array.from(portfolioByOperator.values())
            .map((p) => ({
              ...p,
              avgResponseSeconds: tmeByOperator.get(p.operatorId) ?? 0,
              activeSharePct:
                p.walletContactsCount > 0
                  ? Math.round((p.activeInPeriodCount / p.walletContactsCount) * 100)
                  : 0,
            }))
            .filter(
              (p) =>
                p.walletContactsCount > 0 ||
                p.openDealsCount > 0 ||
                p.wonClientsCount > 0 ||
                p.activeInPeriodCount > 0
            )
            .sort((a, b) => {
              if (b.walletContactsCount !== a.walletContactsCount) {
                return b.walletContactsCount - a.walletContactsCount;
              }
              return b.openPipelineValue - a.openPipelineValue;
            });

          priorityClientsList.sort((a, b) => {
            if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
            if (b.openDealValue !== a.openDealValue) return b.openDealValue - a.openDealValue;
            return a.name.localeCompare(b.name, "pt-BR");
          });

          const newDeltaPct =
            newInPrevPeriod > 0
              ? Math.round(((newInPeriod - newInPrevPeriod) / newInPrevPeriod) * 100)
              : newInPeriod > 0
              ? 100
              : 0;

          const crmCoveragePct =
            contactsWithConvCount > 0
              ? Math.min(100, Math.round((contactsWithAnyDealCount / contactsWithConvCount) * 100))
              : totalBase > 0
              ? Math.round((contactsWithAnyDealCount / totalBase) * 100)
              : 0;

          return new Response(
            JSON.stringify({
              // Campos originais (100% compatíveis)
              clientMetrics,
              avgDaysWithoutService,
              avgFrequency,
              ragConversionPct,

              // Novos dados executivos para a Diretoria
              period: {
                key: periodKey,
                label: periodLabel,
                startISO: periodStart.toISOString(),
              },
              operatorsList: allOperatorsRows.map((o) => ({
                id: o.id,
                name: o.name,
                avatar: o.avatar ?? null,
              })),
              summaryKpis: {
                totalContacts: totalBase,
                companiesCount: companiesLinkedCount,
                personsCount: Math.max(0, totalBase - companiesLinkedCount),
                newInPeriod,
                newInPrevPeriod,
                newDeltaPct,
                activeInPeriodCount,
                newActiveInPeriodCount,
                returningActiveInPeriodCount,
                activeRatePct:
                  totalBase > 0 ? Math.round((activeInPeriodCount / totalBase) * 100) : 0,
                retentionRatePct:
                  activeInPeriodCount > 0
                    ? Math.round((returningActiveInPeriodCount / activeInPeriodCount) * 100)
                    : 0,
                contactsWithConvCount,
                contactsWithAnyDealCount,
                contactsWithOpenDealCount,
                contactsChatWithoutDealCount,
                crmCoveragePct,
                wonClientsCount: contactsWonCount,
                totalWonDeals,
                totalWonRevenue,
                totalOpenDeals,
                totalOpenPipelineValue,
                avgTicketPerBuyer,
                atRiskWithOpenDealCount,
                atRiskOpenValue,
                waitingReplyCount,
                avgDaysWithoutService,
                avgFrequency,
                csat: {
                  pct: csatPct,
                  sampleSize: csatSampleSize,
                  satisfiedCount,
                  neutralCount,
                  frustratedCount,
                  neutralPct,
                  frustratedPct,
                  avgAuditScore,
                },
              },
              dataHealth: {
                totalBase,
                withWalletCount,
                orphanContactsCount,
                withWalletPct:
                  totalBase > 0 ? Math.round((withWalletCount / totalBase) * 100) : 0,
                withEmailCount,
                withEmailPct:
                  totalBase > 0 ? Math.round((withEmailCount / totalBase) * 100) : 0,
                companiesLinkedCount,
                companiesLinkedPct:
                  totalBase > 0 ? Math.round((companiesLinkedCount / totalBase) * 100) : 0,
                withMultiPhonesCount,
                withMultiPhonesPct:
                  totalBase > 0 ? Math.round((withMultiPhonesCount / totalBase) * 100) : 0,
                withTagsCount,
                withTagsPct:
                  totalBase > 0 ? Math.round((withTagsCount / totalBase) * 100) : 0,
              },
              lifecycleFunnel,
              inactivityBuckets,
              acquisitionSources,
              acquisitionCampaigns,
              consultantPortfolios,
              priorityClients: priorityClientsList.slice(0, 80),
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[gestao/contacts-analytics] Erro GET:", e);
          return new Response(
            JSON.stringify({
              clientMetrics: [],
              avgDaysWithoutService: 0,
              avgFrequency: 0,
              ragConversionPct: 0,
              summaryKpis: null,
              dataHealth: null,
              lifecycleFunnel: [],
              inactivityBuckets: [],
              acquisitionSources: [],
              acquisitionCampaigns: [],
              consultantPortfolios: [],
              priorityClients: [],
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
