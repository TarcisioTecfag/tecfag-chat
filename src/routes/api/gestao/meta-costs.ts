import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  messages,
  conversations,
  contacts,
  metaMessageTemplates,
} from "../../../db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import {
  DEFAULT_META_TARIFF_SCHEDULE,
  evaluateMetaOutboundMessage,
  getMetaCategoryLabel,
  type EvaluatedMetaMessage,
  type MetaCostCategory,
} from "../../../lib/whatsapp/meta-costs-calculator";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return dateStr;
}

function toSaoPauloDateStr(dateInput: Date | string): string {
  const localDate = new Date(dateInput).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [d, m, y] = localDate.split("/");
  return `${y}-${m}-${d}`;
}

export const Route = createFileRoute("/api/gestao/meta-costs")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (
          session.permissions?.analytics?.canAccessCosts !== true ||
          (session.permissions?.views?.analytics !== true &&
            session.permissions?.views?.monitor !== true)
        ) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para visualizar custos da Meta API.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({
              error: "Acesso negado ao tenant especificado.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const period = url.searchParams.get("period") || "7d";
        const selectedCategory = url.searchParams.get("category") || "all";
        const selectedBilling = url.searchParams.get("billing") || "all";
        const selectedOrigin = url.searchParams.get("origin") || "all";

        try {
          const now = new Date();
          const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

          let periodStartDate: Date;
          if (period === "today") {
            periodStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          } else if (period === "7d") {
            periodStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          } else if (period === "month") {
            periodStartDate = startOfCurrentMonth;
          } else {
            // 30d default
            periodStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          }

          // Para calcular tanto a franquia mensal (mês atual) quanto o período selecionado + janela de 24h anterior:
          const earliestOutboundDate =
            periodStartDate < startOfCurrentMonth ? periodStartDate : startOfCurrentMonth;
          const earliestInboundDate = new Date(
            earliestOutboundDate.getTime() - 24 * 60 * 60 * 1000,
          );

          // 1. Buscar templates oficiais cadastrados no tenant para mapear (name -> category)
          const tenantTemplates = await db
            .select({
              name: metaMessageTemplates.name,
              category: metaMessageTemplates.category,
              status: metaMessageTemplates.status,
              language: metaMessageTemplates.language,
            })
            .from(metaMessageTemplates)
            .where(eq(metaMessageTemplates.tenantId, tenantId));

          const templateCategoryMap = new Map<string, string>();
          for (const tpl of tenantTemplates) {
            if (tpl.name && tpl.category) {
              templateCategoryMap.set(tpl.name.trim().toLowerCase(), tpl.category.trim().toUpperCase());
            }
          }

          // 2. Buscar mensagens inbound do tenant para reconstruir as janelas de atendimento de 24h (CSW)
          const inboundRows = await db
            .select({
              conversationId: messages.conversationId,
              sentAt: messages.sentAt,
            })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.direction, "inbound"),
                gte(messages.sentAt, earliestInboundDate),
              ),
            );

          const inboundTimestampsByConv = new Map<string, number[]>();
          for (const inb of inboundRows) {
            const ms = new Date(inb.sentAt).getTime();
            const arr = inboundTimestampsByConv.get(inb.conversationId);
            if (arr) {
              arr.push(ms);
            } else {
              inboundTimestampsByConv.set(inb.conversationId, [ms]);
            }
          }
          for (const arr of inboundTimestampsByConv.values()) {
            arr.sort((a, b) => a - b);
          }

          // 3. Buscar disparos outbound da Meta Cloud API com dados do contato
          const outboundRows = await db
            .select({
              id: messages.id,
              conversationId: messages.conversationId,
              senderType: messages.senderType,
              senderName: messages.senderName,
              content: messages.content,
              status: messages.status,
              errorMessage: messages.errorMessage,
              metaDetails: messages.metaDetails,
              metaPricing: messages.metaPricing,
              sentAt: messages.sentAt,
              contactId: conversations.contactId,
              contactName: contacts.name,
              contactPhone: contacts.phone,
            })
            .from(messages)
            .leftJoin(
              conversations,
              and(
                eq(conversations.id, messages.conversationId),
                eq(conversations.tenantId, tenantId),
              ),
            )
            .leftJoin(
              contacts,
              and(
                eq(contacts.id, conversations.contactId),
                eq(contacts.tenantId, tenantId),
              ),
            )
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.provider, "meta"),
                eq(messages.direction, "outbound"),
                eq(messages.isInternalNote, false),
                gte(messages.sentAt, earliestOutboundDate),
              ),
            )
            .orderBy(desc(messages.sentAt));

          // 4. Calcular a franquia gratuita mensal (1.000 janelas/conversas de serviço gratuitas no mês corrente)
          const schedule = DEFAULT_META_TARIFF_SCHEDULE;
          const monthlyServiceWindows = new Set<string>();
          let monthlyFreeMessagesCount = 0;

          // Ordenar cronologicamente para rastrear a franquia mensal
          const chronologicalRows = [...outboundRows].sort(
            (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
          );

          const evaluatedAll: EvaluatedMetaMessage[] = [];

          for (const row of chronologicalRows) {
            const sentMs = new Date(row.sentAt).getTime();
            const isCurrentMonth = sentMs >= startOfCurrentMonth.getTime();
            const dayBucket = Math.floor(sentMs / (24 * 60 * 60 * 1000));
            const windowKey = `${row.conversationId}:${dayBucket}`;

            const withinMonthlyAllowance =
              monthlyServiceWindows.size < schedule.monthlyFreeAllowanceConversations ||
              monthlyServiceWindows.has(windowKey);

            const evaluated = evaluateMetaOutboundMessage({
              msg: row,
              templateCategoryMap,
              inboundTimestampsByConv,
              withinMonthlyFreeAllowance: withinMonthlyAllowance,
              schedule,
            });

            if (isCurrentMonth && !evaluated.isFailed && !evaluated.billable) {
              monthlyServiceWindows.add(windowKey);
              monthlyFreeMessagesCount++;
            }

            evaluatedAll.push(evaluated);
          }

          // Reverter para mais recente primeiro
          evaluatedAll.reverse();

          // 5. Filtrar pelo período selecionado e pelos filtros da UI
          const periodStartMs = periodStartDate.getTime();
          const filteredMessages = evaluatedAll.filter((item) => {
            const itemMs = new Date(item.sentAt).getTime();
            if (itemMs < periodStartMs) return false;

            if (selectedCategory !== "all" && item.category !== selectedCategory) {
              return false;
            }

            if (selectedBilling === "billable" && !item.billable) return false;
            if (selectedBilling === "free" && (item.billable || item.isFailed)) return false;
            if (selectedBilling === "templates" && !item.isTemplate) return false;
            if (selectedBilling === "failed" && !item.isFailed) return false;

            if (selectedOrigin === "agent" && item.senderType !== "agent") return false;
            if (selectedOrigin === "bot" && item.senderType !== "bot") return false;

            return true;
          });

          // 6. Agregar KPIs do período filtrado
          let totalCostUsd = 0;
          let totalCostBrl = 0;
          let messageSavedUsd = 0;
          let billableMessages = 0;
          let freeBonusMessages = 0;
          let failedMessages = 0;
          let deliveredOrReadCount = 0;
          let templatesSent = 0;
          let serviceMessagesSent = 0;
          let operatorMessages = 0;
          let botMessages = 0;

          const periodServiceWindows = new Set<string>();
          const periodConversations = new Set<string>();

          const categoriesOrder: MetaCostCategory[] = [
            "MARKETING",
            "UTILITY",
            "AUTHENTICATION",
            "SERVICE",
          ];

          const categoryMap: Record<
            MetaCostCategory,
            {
              totalMessages: number;
              billableMessages: number;
              freeMessages: number;
              failedMessages: number;
              costUsd: number;
              costBrl: number;
              savedUsd: number;
              savedBrl: number;
            }
          > = {
            MARKETING: { totalMessages: 0, billableMessages: 0, freeMessages: 0, failedMessages: 0, costUsd: 0, costBrl: 0, savedUsd: 0, savedBrl: 0 },
            UTILITY: { totalMessages: 0, billableMessages: 0, freeMessages: 0, failedMessages: 0, costUsd: 0, costBrl: 0, savedUsd: 0, savedBrl: 0 },
            AUTHENTICATION: { totalMessages: 0, billableMessages: 0, freeMessages: 0, failedMessages: 0, costUsd: 0, costBrl: 0, savedUsd: 0, savedBrl: 0 },
            SERVICE: { totalMessages: 0, billableMessages: 0, freeMessages: 0, failedMessages: 0, costUsd: 0, costBrl: 0, savedUsd: 0, savedBrl: 0 },
            REFERRAL: { totalMessages: 0, billableMessages: 0, freeMessages: 0, failedMessages: 0, costUsd: 0, costBrl: 0, savedUsd: 0, savedBrl: 0 },
          };

          const templateStatsMap: Record<
            string,
            {
              templateName: string;
              category: MetaCostCategory;
              sentCount: number;
              billableCount: number;
              freeCount: number;
              costUsd: number;
              costBrl: number;
            }
          > = {};

          const dailyMap: Record<
            string,
            {
              date: string;
              totalMessages: number;
              billableMessages: number;
              freeMessages: number;
              templatesCount: number;
              costUsd: number;
              costBrl: number;
              savedBrl: number;
            }
          > = {};

          for (const item of filteredMessages) {
            totalCostUsd += item.costUsd;
            totalCostBrl += item.costBrl;
            messageSavedUsd += item.savedUsd;

            periodConversations.add(item.conversationId);

            if (item.isFailed) {
              failedMessages++;
            } else if (item.billable) {
              billableMessages++;
            } else {
              freeBonusMessages++;
              const dayBucket = Math.floor(new Date(item.sentAt).getTime() / (24 * 60 * 60 * 1000));
              periodServiceWindows.add(`${item.conversationId}:${dayBucket}`);
            }

            if (item.isDeliveredOrRead) {
              deliveredOrReadCount++;
            }

            if (item.isTemplate) {
              templatesSent++;
              const tplKey = item.templateName || "template_padrao";
              if (!templateStatsMap[tplKey]) {
                templateStatsMap[tplKey] = {
                  templateName: tplKey,
                  category: item.category,
                  sentCount: 0,
                  billableCount: 0,
                  freeCount: 0,
                  costUsd: 0,
                  costBrl: 0,
                };
              }
              templateStatsMap[tplKey].sentCount++;
              if (item.billable) templateStatsMap[tplKey].billableCount++;
              else if (!item.isFailed) templateStatsMap[tplKey].freeCount++;
              templateStatsMap[tplKey].costUsd += item.costUsd;
              templateStatsMap[tplKey].costBrl += item.costBrl;
            } else {
              serviceMessagesSent++;
            }

            if (item.senderType === "bot") botMessages++;
            else operatorMessages++;

            const catBucket = categoryMap[item.category] || categoryMap.SERVICE;
            catBucket.totalMessages++;
            if (item.isFailed) catBucket.failedMessages++;
            else if (item.billable) catBucket.billableMessages++;
            else catBucket.freeMessages++;
            catBucket.costUsd += item.costUsd;
            catBucket.costBrl += item.costBrl;
            catBucket.savedUsd += item.savedUsd;
            catBucket.savedBrl += item.savedBrl;

            const dateStr = toSaoPauloDateStr(item.sentAt);
            if (!dailyMap[dateStr]) {
              dailyMap[dateStr] = {
                date: dateStr,
                totalMessages: 0,
                billableMessages: 0,
                freeMessages: 0,
                templatesCount: 0,
                costUsd: 0,
                costBrl: 0,
                savedBrl: 0,
              };
            }
            dailyMap[dateStr].totalMessages++;
            if (item.billable) dailyMap[dateStr].billableMessages++;
            else if (!item.isFailed) dailyMap[dateStr].freeMessages++;
            if (item.isTemplate) dailyMap[dateStr].templatesCount++;
            dailyMap[dateStr].costUsd += item.costUsd;
            dailyMap[dateStr].costBrl += item.costBrl;
            dailyMap[dateStr].savedBrl += item.savedBrl;
          }

          // Economia total = economia por mensagem na janela + bônus de janelas de serviço isentas pela franquia
          const windowBonusUsd =
            periodServiceWindows.size * schedule.ratesUsd.SERVICE_BENCHMARK_SAVING;
          const totalSavedUsd = Math.max(messageSavedUsd, windowBonusUsd);
          const totalSavedBrl = totalSavedUsd * schedule.usdToBrl;

          const totalMessages = filteredMessages.length;
          const nonFailedCount = Math.max(0, totalMessages - failedMessages);
          const deliveryRatePct =
            nonFailedCount > 0
              ? Number(((deliveredOrReadCount / nonFailedCount) * 100).toFixed(1))
              : 100;

          const avgCostPerMessageBrl = totalMessages > 0 ? totalCostBrl / totalMessages : 0;
          const avgCostPerBillableBrl =
            billableMessages > 0 ? totalCostBrl / billableMessages : 0;

          const unitRatesUsd: Record<MetaCostCategory, number> = {
            MARKETING: schedule.ratesUsd.MARKETING,
            UTILITY: schedule.ratesUsd.UTILITY,
            AUTHENTICATION: schedule.ratesUsd.AUTHENTICATION,
            SERVICE: schedule.ratesUsd.SERVICE,
            REFERRAL: 0,
          };

          const activeCategories: MetaCostCategory[] =
            categoryMap.REFERRAL.totalMessages > 0
              ? [...categoriesOrder, "REFERRAL"]
              : categoriesOrder;

          const categoryBreakdown = activeCategories.map((cat) => {
            const data = categoryMap[cat];
            const unitUsd = unitRatesUsd[cat];
            return {
              category: cat,
              categoryName: getMetaCategoryLabel(cat),
              unitRateUsd: unitUsd,
              unitRateBrl: Number((unitUsd * schedule.usdToBrl).toFixed(4)),
              totalMessages: data.totalMessages,
              billableMessages: data.billableMessages,
              freeMessages: data.freeMessages,
              failedMessages: data.failedMessages,
              costUsd: Number(data.costUsd.toFixed(4)),
              costBrl: Number(data.costBrl.toFixed(4)),
              savedBrl: Number(data.savedBrl.toFixed(4)),
              percentageOfCost:
                totalCostBrl > 0 ? Number(((data.costBrl / totalCostBrl) * 100).toFixed(1)) : 0,
              percentageOfVolume:
                totalMessages > 0
                  ? Number(((data.totalMessages / totalMessages) * 100).toFixed(1))
                  : 0,
            };
          });

          const templateBreakdown = Object.values(templateStatsMap)
            .map((tpl) => ({
              ...tpl,
              categoryName: getMetaCategoryLabel(tpl.category),
              costUsd: Number(tpl.costUsd.toFixed(4)),
              costBrl: Number(tpl.costBrl.toFixed(4)),
            }))
            .sort((a, b) => b.costBrl - a.costBrl || b.sentCount - a.sentCount)
            .slice(0, 15);

          const timeline = Object.values(dailyMap)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((item) => ({
              date: item.date,
              dateFormatted: formatDateLabel(item.date),
              totalMessages: item.totalMessages,
              billableMessages: item.billableMessages,
              freeMessages: item.freeMessages,
              templatesCount: item.templatesCount,
              costUsd: Number(item.costUsd.toFixed(4)),
              costBrl: Number(item.costBrl.toFixed(4)),
              savedBrl: Number(item.savedBrl.toFixed(4)),
            }));

          const usedMonthlyConversations = monthlyServiceWindows.size;
          const remainingMonthlyConversations = Math.max(
            0,
            schedule.monthlyFreeAllowanceConversations - usedMonthlyConversations,
          );
          const monthlyAllowancePct = Math.min(
            100,
            Number(
              (
                (usedMonthlyConversations / schedule.monthlyFreeAllowanceConversations) *
                100
              ).toFixed(1),
            ),
          );

          return new Response(
            JSON.stringify({
              summary: {
                totalMessages,
                billableMessages,
                freeBonusMessages,
                failedMessages,
                deliveredOrReadCount,
                deliveryRatePct,
                templatesSent,
                serviceMessagesSent,
                operatorMessages,
                botMessages,
                activeConversationsCount: periodConversations.size,
                activeServiceWindowsCount: periodServiceWindows.size,
                totalCostUsd: Number(totalCostUsd.toFixed(4)),
                totalCostBrl: Number(totalCostBrl.toFixed(4)),
                totalSavedUsd: Number(totalSavedUsd.toFixed(4)),
                totalSavedBrl: Number(totalSavedBrl.toFixed(4)),
                avgCostPerMessageBrl: Number(avgCostPerMessageBrl.toFixed(4)),
                avgCostPerBillableBrl: Number(avgCostPerBillableBrl.toFixed(4)),
                registeredTemplatesCount: tenantTemplates.length,
              },
              monthlyBonus: {
                allowanceConversationsLimit: schedule.monthlyFreeAllowanceConversations,
                usedConversations: usedMonthlyConversations,
                remainingConversations: remainingMonthlyConversations,
                usagePercentage: monthlyAllowancePct,
                freeMessagesInMonth: monthlyFreeMessagesCount,
                isWithinFreeTier:
                  usedMonthlyConversations <= schedule.monthlyFreeAllowanceConversations,
              },
              tariffSchedule: {
                usdToBrl: schedule.usdToBrl,
                rates: [
                  {
                    category: "MARKETING",
                    label: "Marketing (Campanhas / Reabertura)",
                    rule: "Cobrado por template entregue",
                    usd: schedule.ratesUsd.MARKETING,
                    brl: Number((schedule.ratesUsd.MARKETING * schedule.usdToBrl).toFixed(4)),
                  },
                  {
                    category: "AUTHENTICATION",
                    label: "Autenticação (Códigos OTP)",
                    rule: "Cobrado por template entregue",
                    usd: schedule.ratesUsd.AUTHENTICATION,
                    brl: Number((schedule.ratesUsd.AUTHENTICATION * schedule.usdToBrl).toFixed(4)),
                  },
                  {
                    category: "UTILITY",
                    label: "Utilidade (Avisos / Pós-Venda)",
                    rule: "Grátis na Janela 24h • Cobrado fora da janela",
                    usd: schedule.ratesUsd.UTILITY,
                    brl: Number((schedule.ratesUsd.UTILITY * schedule.usdToBrl).toFixed(4)),
                  },
                  {
                    category: "SERVICE",
                    label: "Serviço (Respostas Livres 24h)",
                    rule: "100% Grátis (Janela 24h + Bônus 1.000 conversas/mês)",
                    usd: 0,
                    brl: 0,
                  },
                ],
              },
              categoryBreakdown,
              templateBreakdown,
              timeline,
              logs: filteredMessages.slice(0, 150),
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        } catch (e: any) {
          console.error("[GET /api/gestao/meta-costs] Erro:", e);
          return new Response(
            JSON.stringify({
              error: "Erro ao processar custos da Meta Oficial API",
              details: e?.message,
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
