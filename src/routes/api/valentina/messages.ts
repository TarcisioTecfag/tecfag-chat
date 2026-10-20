import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  internalMessages,
  conversations,
  messages,
  contacts,
  operators,
  responseTimeLogs,
  operatorDailyMetrics,
  aiConversationAudits,
  agentFlowStates,
  crmDeals,
  crmStages,
  crmPipelines,
  crmAccounts,
  crmStageSettings,
  crmDealActivities,
  crmConversationDeals,
  tasks,
} from "../../../db/schema";
import { eq, and, desc, asc, sql, gte, isNull, ne, count, or, inArray, ilike } from "drizzle-orm";
import crypto from "crypto";
import { getAiPersona } from "../../../lib/ai-persona";
import { requireSession } from "../../../lib/auth-session";
import { getCommercialHome } from "../../../lib/commercial/home-service";
import { getKnowledgeBaseContext } from "../../../lib/valentina/knowledge-service";
import type { MultimodalPart } from "../../../lib/vertex-ai";
import type { RelatedConversationItem } from "../../../lib/mockData";

// ── Headers CORS padrão ──────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Extrai texto de arquivo anexado (PDF, DOCX, XLSX, TXT) ──────────────────
async function extractFileText(name: string, mimeType: string, base64: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (mimeType === "text/plain" || ext === "txt") {
    return buf.toString("utf-8").slice(0, 12000);
  }
  if (mimeType === "application/pdf" || ext === "pdf") {
    try {
      const pdfParse = await import("pdf-parse");
      const pdfFn = (pdfParse as any).default || pdfParse;
      const result = await pdfFn(buf);
      return result.text.slice(0, 12000);
    } catch {
      return `[PDF recebido: ${name} — conteúdo não extraído automaticamente]`;
    }
  }
  if (mimeType.includes("wordprocessingml") || mimeType.includes("msword") || ext === "docx" || ext === "doc") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value.slice(0, 12000);
    } catch {
      return `[Documento Word recebido: ${name} — conteúdo não extraído automaticamente]`;
    }
  }
  if (mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel") || ext === "xlsx" || ext === "xls") {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "buffer" });
      const texts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        texts.push(`[Planilha: ${sheetName}]\n${csv}`);
      }
      return texts.join("\n\n").slice(0, 12000);
    } catch {
      return `[Planilha Excel recebida: ${name} — conteúdo não extraído automaticamente]`;
    }
  }
  return `[Arquivo recebido: ${name}]`;
}

// ── Resolve nome do operador pelo ID ────────────────────────────────────────
async function getOperatorName(operatorId: string): Promise<string> {
  try {
    const [op] = await db
      .select({ name: operators.name })
      .from(operators)
      .where(eq(operators.id, operatorId))
      .limit(1);
    return op?.name || "Operador";
  } catch {
    return "Operador";
  }
}

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

const STOPWORDS_PT = new Set([
  "como", "qual", "quais", "quem", "onde", "quando", "porque", "para", "pelo", "pela",
  "meus", "minha", "minhas", "meu", "sobre", "estao", "esta", "estão", "está", "hoje",
  "ontem", "amanha", "amanhã", "agora", "fagner", "valentina", "cliente", "clientes",
  "negociacao", "negociação", "negociacoes", "negociações", "tarefa", "tarefas",
  "ligacao", "ligação", "ligacoes", "ligações", "meta", "metas", "conversa", "conversas",
  "atendimento", "atendimentos", "tenho", "tem", "tudo", "todos", "todas", "fazer",
  "preciso", "quero", "pode", "resumo", "status", "parada", "paradas", "parado", "parados",
  "aberta", "abertas", "aberto", "abertos", "pendente", "pendentes", "agenda", "agendada",
  "agendadas", "agendado", "agendados", "mes", "mês", "semana", "dia", "valor", "proposta",
]);

function extractSearchCandidateTerms(userQuery?: string): string[] {
  if (!userQuery || !userQuery.trim()) return [];
  return userQuery
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS_PT.has(w))
    .slice(0, 4);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXTO DO COPILOTO DO VENDEDOR/OPERADOR — Dados exclusivos do próprio operador
// Usado em: Módulo de Chat (fixado na lista), scope = "operator"
// RBAC ESTRITO: Filtra 100% por tenantId + operatorId. Bloqueia dados de terceiros/diretoria.
// ═══════════════════════════════════════════════════════════════════════════════
export interface OperatorContextResult {
  contextText: string;
  knownConversations: RelatedConversationItem[];
  waitingConversations: RelatedConversationItem[];
  todayLeadsConversations: RelatedConversationItem[];
}

async function getOperatorContext(
  tenantId: string,
  operatorId: string,
  operatorEmail?: string | null,
  userQuery?: string
): Promise<OperatorContextResult> {
  const sections: string[] = [];
  const knownConvMap = new Map<string, RelatedConversationItem>();
  const waitingConversations: RelatedConversationItem[] = [];
  const todayLeadsConversations: RelatedConversationItem[] = [];

  try {
    // ── 1. META DO MÊS, RITMO (PACING) E DIRETRIZES DO GESTOR ────────────────
    try {
      const home = await getCommercialHome(tenantId, operatorId);
      const g = home.goal;
      if (g.configured && g.targetValue > 0) {
        const statusRitmo =
          g.coveragePercent >= g.expectedPercent
            ? "✅ Acima/Dentro do ritmo esperado"
            : "⚠️ Abaixo do ritmo esperado para o dia";
        const faltaValor = Math.max(0, g.targetValue - g.realizedValue);
        sections.push(
          `🎯 SUA META COMERCIAL DO MÊS (${home.month}):\n` +
            `  • Meta Mensal: ${formatBrl(g.targetValue)}\n` +
            `  • Realizado (Ganhos no mês): ${formatBrl(g.realizedValue)} (${g.coveragePercent.toFixed(1)}% da meta | ${home.deals.wonThisMonthCount} venda(s) ganha(s))\n` +
            `  • Falta para bater a meta: ${formatBrl(faltaValor)}\n` +
            `  • Ritmo esperado até hoje (${home.today}): ${g.expectedPercent.toFixed(1)}% (${g.elapsedDays} de ${g.businessDays} dias úteis decorridos | restam ${g.remainingDays} dias úteis)\n` +
            `  • Status do Ritmo: ${statusRitmo}\n` +
            `  • Meta diária necessária nos próximos dias úteis: ${formatBrl(g.dailyRequired)}/dia\n` +
            `  • Pipeline em aberto: ${home.deals.openCount} negociação(ões) somando ${formatBrl(home.deals.openValue)}`
        );
      } else {
        sections.push(
          `🎯 SUA META COMERCIAL DO MÊS (${home.month}):\n` +
            `  • Meta mensal ainda não cadastrada pelo gestor para este mês.\n` +
            `  • Realizado no mês: ${formatBrl(g.realizedValue)} (${home.deals.wonThisMonthCount} venda(s) ganha(s))\n` +
            `  • Pipeline em aberto: ${home.deals.openCount} negociação(ões) somando ${formatBrl(home.deals.openValue)}`
        );
      }

      if (home.wonDeals.length > 0) {
        const wonLines = home.wonDeals
          .slice(0, 8)
          .map((w) => `  • 🏆 ${w.title} — ${formatBrl(w.value)} (fechado em ${w.closedAt ? new Date(w.closedAt).toLocaleDateString("pt-BR") : "N/A"})`)
          .join("\n");
        sections.push(`🏆 SUAS VENDAS GANHAS NESTE MÊS (${home.wonDeals.length}):\n${wonLines}`);
      }

      const pendingDirectives = home.directives.filter((d) => d.status === "pending");
      if (pendingDirectives.length > 0) {
        const dirLines = pendingDirectives
          .slice(0, 10)
          .map(
            (d) =>
              `  • [${d.priority.toUpperCase()}${d.overdue ? " | 🚨 ATRASADA" : ""}] Negociação "${d.dealTitle}" (${formatBrl(d.dealValue)} - Etapa: ${d.stageName || "N/A"}): "${d.instruction}"`
          )
          .join("\n");
        sections.push(`📌 DIRETRIZES DO GESTOR PARA VOCÊ (${pendingDirectives.length} pendente(s)):\n${dirLines}`);
      }
    } catch (homeErr: any) {
      console.warn("[getOperatorContext] Aviso ao carregar getCommercialHome:", homeErr?.message);
    }

    // ── 2. TAREFAS, LIGAÇÕES AGENDADAS E REUNIÕES DO OPERADOR ────────────────
    try {
      const crmActivities = await db
        .select({
          id: crmDealActivities.id,
          type: crmDealActivities.type,
          title: crmDealActivities.title,
          description: crmDealActivities.description,
          status: crmDealActivities.status,
          dueDate: crmDealActivities.dueDate,
          dealId: crmDealActivities.dealId,
          dealTitle: crmDeals.title,
          dealValue: crmDeals.value,
        })
        .from(crmDealActivities)
        .leftJoin(crmDeals, and(eq(crmDeals.id, crmDealActivities.dealId), eq(crmDeals.tenantId, tenantId)))
        .where(
          and(
            eq(crmDealActivities.tenantId, tenantId),
            or(
              eq(crmDealActivities.assignedToOperatorId, operatorId),
              and(isNull(crmDealActivities.assignedToOperatorId), eq(crmDealActivities.operatorId, operatorId))
            ),
            eq(crmDealActivities.status, "pending")
          )
        )
        .orderBy(asc(crmDealActivities.dueDate))
        .limit(40);

      const generalTasks = operatorEmail
        ? await db
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.tenantId, tenantId),
                eq(tasks.operatorEmail, operatorEmail),
                ne(tasks.status, "done")
              )
            )
            .orderBy(asc(tasks.dueDate))
            .limit(25)
        : [];

      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

      const formatActivityItem = (a: (typeof crmActivities)[number]) => {
        const dueStr = a.dueDate
          ? new Date(a.dueDate).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Sem data";
        const dueDay = a.dueDate
          ? new Date(a.dueDate).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
          : "";
        const tag =
          dueDay && dueDay < todayStr
            ? "🚨 ATRASADA"
            : dueDay === todayStr
            ? "🔥 HOJE"
            : "📅 AGENDADA";
        const dealPart = a.dealTitle ? ` | Negociação: "${a.dealTitle}" (${formatBrl(Number(a.dealValue || 0))})` : "";
        const descPart = a.description ? ` — Obs: ${a.description.slice(0, 100)}` : "";
        return `  • [${tag} - ${dueStr}] ${a.title}${dealPart}${descPart}`;
      };

      const scheduledCalls = crmActivities.filter(
        (a) => a.type === "call" || /liga[cç][aã]o|ligar|call|telefonema/i.test(a.title)
      );
      const otherActivities = crmActivities.filter((a) => !scheduledCalls.includes(a));

      const legacyCalls = generalTasks.filter(
        (t) => t.type === "call" || /liga[cç][aã]o|ligar|call|telefonema/i.test(t.name)
      );
      const legacyOtherTasks = generalTasks.filter((t) => !legacyCalls.includes(t));

      const callLines = [
        ...scheduledCalls.map(formatActivityItem),
        ...legacyCalls.map(
          (t) =>
            `  • [${t.dueDate || "Sem data"}] 📞 ${t.name}${t.clientName ? ` | Cliente: ${t.clientName}` : ""}${t.dealName ? ` | Deal: ${t.dealName}` : ""}${t.description ? ` — ${t.description.slice(0, 90)}` : ""}`
        ),
      ];

      if (callLines.length > 0) {
        sections.push(`📞 SUAS LIGAÇÕES AGENDADAS (${callLines.length}):\n${callLines.join("\n")}`);
      } else {
        sections.push(`📞 SUAS LIGAÇÕES AGENDADAS: Nenhuma ligação pendente agendada no momento.`);
      }

      const taskLines = [
        ...otherActivities.map((a) => {
          const typeLabel = a.type === "meeting" ? "🤝 Reunião" : "📋 Tarefa";
          return `${formatActivityItem(a)} (${typeLabel})`;
        }),
        ...legacyOtherTasks.map(
          (t) =>
            `  • [${t.dueDate || "Sem data"} | Status: ${t.status}] 📋 ${t.name}${t.clientName ? ` | Cliente: ${t.clientName}` : ""}${t.dealName ? ` | Deal: ${t.dealName}` : ""}${t.description ? ` — ${t.description.slice(0, 90)}` : ""}`
        ),
      ];

      if (taskLines.length > 0) {
        sections.push(`✅ SUAS TAREFAS, FOLLOW-UPS E REUNIÕES PENDENTES (${taskLines.length}):\n${taskLines.join("\n")}`);
      } else {
        sections.push(`✅ SUAS TAREFAS E REUNIÕES PENDENTES: Nenhuma tarefa pendente cadastrada no momento.`);
      }
    } catch (taskErr: any) {
      console.warn("[getOperatorContext] Aviso ao carregar tarefas/ligações:", taskErr?.message);
    }

    // ── 3. NEGOCIAÇÕES (CRM DEALS) ABERTAS & NEGOCIAÇÕES PARADAS / ESFRIANDO ──
    try {
      const operatorDeals = await db
        .select({
          id: crmDeals.id,
          title: crmDeals.title,
          status: crmDeals.status,
          value: crmDeals.value,
          stageId: crmDeals.stageId,
          stageName: crmStages.name,
          pipelineId: crmDeals.pipelineId,
          pipelineName: crmPipelines.name,
          pipelineCoolingDays: crmPipelines.coolingDays,
          stageCoolingDays: crmStageSettings.coolingDays,
          stageCoolingEnabled: crmStageSettings.coolingEnabled,
          accountName: crmAccounts.name,
          expectedCloseDate: crmDeals.expectedCloseDate,
          lastActivityAt: crmDeals.lastActivityAt,
          updatedAt: crmDeals.updatedAt,
          createdAt: crmDeals.createdAt,
        })
        .from(crmDeals)
        .leftJoin(crmStages, and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, tenantId)))
        .leftJoin(crmPipelines, and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.tenantId, tenantId)))
        .leftJoin(crmAccounts, and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, tenantId)))
        .leftJoin(
          crmStageSettings,
          and(eq(crmStageSettings.stageId, crmDeals.stageId), eq(crmStageSettings.tenantId, tenantId))
        )
        .where(
          and(
            eq(crmDeals.tenantId, tenantId),
            eq(crmDeals.operatorId, operatorId),
            inArray(crmDeals.status, ["open", "paused"])
          )
        )
        .orderBy(desc(crmDeals.updatedAt))
        .limit(50);

      if (operatorDeals.length > 0) {
        const nowMs = Date.now();
        const enrichedDeals = operatorDeals.map((d) => {
          const refDate = d.lastActivityAt || d.updatedAt || d.createdAt || new Date();
          const daysIdle = Math.max(0, Math.floor((nowMs - new Date(refDate).getTime()) / 86_400_000));
          const coolingThreshold =
            d.stageCoolingEnabled !== false && d.stageCoolingDays
              ? d.stageCoolingDays
              : d.pipelineCoolingDays || 3;
          const isStalled = daysIdle >= Math.min(3, coolingThreshold);
          const isCoolingCritical = daysIdle >= coolingThreshold;
          return {
            ...d,
            numValue: Number(d.value || 0),
            daysIdle,
            coolingThreshold,
            isStalled,
            isCoolingCritical,
            refDate,
          };
        });

        const stalledDeals = enrichedDeals
          .filter((d) => d.isStalled)
          .sort((a, b) => b.daysIdle - a.daysIdle || b.numValue - a.numValue);

        if (stalledDeals.length > 0) {
          const stalledLines = stalledDeals
            .slice(0, 15)
            .map((d) => {
              const badge = d.isCoolingCritical ? "❄️ ESFRIANDO / PARADA CRÍTICA" : "⚠️ SEM INTERAÇÃO RECENTE";
              const acc = d.accountName ? ` | Cliente/Conta: ${d.accountName}` : "";
              return `  • [${badge} — ${d.daysIdle} dia(s) sem movimentação] "${d.title}"${acc} | Valor: ${formatBrl(d.numValue)} | Funil/Etapa: ${d.pipelineName || "Geral"} > ${d.stageName || "N/A"}`;
            })
            .join("\n");
          sections.push(
            `❄️ SUAS NEGOCIAÇÕES PARADAS / ESFRIANDO (${stalledDeals.length} de ${enrichedDeals.length} abertas exigem follow-up):\n${stalledLines}`
          );
        } else {
          sections.push(
            `❄️ NEGOCIAÇÕES PARADAS / ESFRIANDO: Parabéns! Nenhuma das suas ${enrichedDeals.length} negociações abertas está parada há 3+ dias.`
          );
        }

        const activeDealLines = enrichedDeals
          .slice(0, 20)
          .map((d) => {
            const acc = d.accountName ? ` (${d.accountName})` : "";
            const closePart = d.expectedCloseDate
              ? ` | Prev. Fechamento: ${new Date(d.expectedCloseDate).toLocaleDateString("pt-BR")}`
              : "";
            return `  • "${d.title}"${acc} — ${formatBrl(d.numValue)} | Etapa: ${d.stageName || "N/A"} (${d.pipelineName || "Funil"}) | Parada há: ${d.daysIdle}d${closePart}${d.status === "paused" ? " [PAUSADA]" : ""}`;
          })
          .join("\n");
        sections.push(`💼 SUAS NEGOCIAÇÕES EM ABERTO NO CRM (${enrichedDeals.length}):\n${activeDealLines}`);
      } else {
        sections.push(`💼 SUAS NEGOCIAÇÕES NO CRM: Você não possui negociações abertas vinculadas ao seu usuário no momento.`);
      }
    } catch (dealErr: any) {
      console.warn("[getOperatorContext] Aviso ao carregar negociações do operador:", dealErr?.message);
    }

    // ── 4. CONVERSAS ATIVAS, CLIENTES AGUARDANDO RESPOSTA (SLA) E LEADS DE HOJE ──
    let activeConvs: Array<{
      id: string;
      contactId: string;
      contactName: string;
      contactPhone: string | null;
      contactCompany: string | null;
      lastMessage: string | null;
      lastTime: Date;
      createdAt: Date;
      queueState: string;
      unread: number;
      dealTitle?: string | null;
      funnelName?: string | null;
    }> = [];

    try {
      const rawConvs = await db
        .select({
          id: conversations.id,
          contactId: conversations.contactId,
          contactName: contacts.name,
          contactPhone: contacts.phone,
          contactCompany: crmAccounts.name,
          lastMessage: conversations.lastMessageText,
          lastTime: conversations.lastMessageTime,
          createdAt: conversations.createdAt,
          queueState: conversations.queueState,
          unread: conversations.unreadCount,
        })
        .from(conversations)
        .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)))
        .leftJoin(crmAccounts, and(eq(crmAccounts.id, contacts.accountId), eq(crmAccounts.tenantId, tenantId)))
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.operatorId, operatorId),
            ne(conversations.queueState, "finalizados")
          )
        )
        .orderBy(desc(conversations.lastMessageTime))
        .limit(25);

      // Enriquecer conversas com negociação ativa vinculada (se houver)
      const convIds = rawConvs.map((c) => c.id);
      const convDealMap = new Map<string, { dealTitle: string; funnelName: string | null }>();
      if (convIds.length > 0) {
        const linkedDeals = await db
          .select({
            conversationId: crmConversationDeals.conversationId,
            dealTitle: crmDeals.title,
            funnelName: crmPipelines.name,
          })
          .from(crmConversationDeals)
          .innerJoin(crmDeals, and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)))
          .leftJoin(crmPipelines, and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.tenantId, tenantId)))
          .where(
            and(
              eq(crmConversationDeals.tenantId, tenantId),
              inArray(crmConversationDeals.conversationId, convIds),
              eq(crmConversationDeals.isActive, true)
            )
          );
        for (const ld of linkedDeals) {
          if (!convDealMap.has(ld.conversationId)) {
            convDealMap.set(ld.conversationId, {
              dealTitle: ld.dealTitle,
              funnelName: ld.funnelName || null,
            });
          }
        }
      }

      activeConvs = rawConvs.map((c) => ({
        ...c,
        dealTitle: convDealMap.get(c.id)?.dealTitle || null,
        funnelName: convDealMap.get(c.id)?.funnelName || null,
      }));

      // Início de hoje no fuso de Brasília
      const brtNowStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const startOfToday = new Date(`${brtNowStr}T00:00:00-03:00`);

      // Leads transferidos hoje registrados em internal_messages
      const todayTransfers = await db
        .select({
          content: internalMessages.content,
          metadata: internalMessages.metadata,
          createdAt: internalMessages.createdAt,
        })
        .from(internalMessages)
        .where(
          and(
            eq(internalMessages.tenantId, tenantId),
            eq(internalMessages.operatorId, operatorId),
            sql`${internalMessages.metadata}->>'type' = 'lead_transfer'`,
            gte(internalMessages.createdAt, startOfToday)
          )
        )
        .orderBy(desc(internalMessages.createdAt))
        .limit(20);

      const todayTransferLines: string[] = [];
      const seenTodayConvIds = new Set<string>();

      for (const tr of todayTransfers) {
        const meta = (tr.metadata || {}) as any;
        const cId = meta.conversationId || meta.clientId || "";
        const cName = meta.clientName || meta.contactName || "Cliente";
        if (cId && seenTodayConvIds.has(cId)) continue;
        if (cId) seenTodayConvIds.add(cId);

        const hora = tr.createdAt
          ? new Date(tr.createdAt).toLocaleTimeString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        todayTransferLines.push(
          `  • [Transferido hoje às ${hora}] ${cName}${meta.company ? ` (${meta.company})` : ""}${meta.targetFunnel ? ` | Funil: ${meta.targetFunnel}` : ""}${meta.dealTitle ? ` | Card: "${meta.dealTitle}"` : ""} (convId: ${cId})`
        );
        if (cId) {
          const item: RelatedConversationItem = {
            clientId: cId,
            clientName: cName,
            company: meta.company || null,
            lastMessage: meta.interest || null,
            dealTitle: meta.dealTitle || null,
            funnelName: meta.targetFunnel || null,
            temperature: meta.temperature || null,
          };
          todayLeadsConversations.push(item);
          knownConvMap.set(cId, item);
        }
      }

      if (activeConvs.length > 0) {
        const waitingClients: string[] = [];
        const convLines: string[] = [];

        for (const c of activeConvs) {
          const agoMin = Math.max(0, Math.floor((Date.now() - new Date(c.lastTime).getTime()) / 60_000));
          const companyInfo = c.contactCompany ? ` [${c.contactCompany}]` : "";
          const dealInfo = c.dealTitle ? ` | Card: "${c.dealTitle}"${c.funnelName ? ` (${c.funnelName})` : ""}` : "";

          const [lastMsg] = await db
            .select({
              senderType: messages.senderType,
              content: messages.content,
              mediaInterpretation: messages.mediaInterpretation,
              sentAt: messages.sentAt,
            })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, c.id),
                eq(messages.tenantId, tenantId),
                eq(messages.isInternalNote, false),
                ne(messages.senderType, "system")
              )
            )
            .orderBy(desc(messages.sentAt))
            .limit(1);

          const isClientWaiting = lastMsg?.senderType === "client" && c.queueState === "meus";
          const waitMinutes =
            isClientWaiting && lastMsg?.sentAt
              ? Math.max(0, Math.floor((Date.now() - new Date(lastMsg.sentAt).getTime()) / 60_000))
              : agoMin;
          const cleanPreview = (lastMsg?.content || lastMsg?.mediaInterpretation || c.lastMessage || "")
            .replace(/^\[(LOCAL_MEDIA|MEDIA):[^\]]+\]\s*/i, "[Mídia] ")
            .trim()
            .slice(0, 110);

          const convItem: RelatedConversationItem = {
            clientId: c.id,
            clientName: c.contactName,
            company: c.contactCompany || null,
            lastMessage: cleanPreview || null,
            waitMinutes: isClientWaiting ? waitMinutes : null,
            isWaiting: isClientWaiting,
            dealTitle: c.dealTitle || null,
            funnelName: c.funnelName || null,
          };
          knownConvMap.set(c.id, convItem);

          if (c.createdAt && new Date(c.createdAt) >= startOfToday && !seenTodayConvIds.has(c.id)) {
            seenTodayConvIds.add(c.id);
            todayLeadsConversations.push(convItem);
            const hora = new Date(c.createdAt).toLocaleTimeString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              hour: "2-digit",
              minute: "2-digit",
            });
            todayTransferLines.push(
              `  • [Iniciado hoje às ${hora}] ${c.contactName}${companyInfo}${dealInfo} (convId: ${c.id}): "${cleanPreview}"`
            );
          }

          if (isClientWaiting) {
            waitingConversations.push(convItem);
            const slaTag =
              waitMinutes >= 15
                ? "🚨 SLA ESTOURADO (>15min)"
                : waitMinutes >= 8
                ? "⚠️ ATENÇÃO SLA (8-14min)"
                : "⏳ Aguardando resposta";
            waitingClients.push(
              `  • ${c.contactName}${companyInfo} (convId: ${c.id}) — esperando há ${waitMinutes}min (${slaTag})${dealInfo}: "${cleanPreview}"`
            );
          }

          convLines.push(
            `  • ${c.contactName}${companyInfo} (convId: ${c.id} | Fila: ${c.queueState}${isClientWaiting ? ` | ⏳ Cliente aguarda há ${waitMinutes}min` : " | ✅ Respondido"}) — última msg há ${agoMin}min${c.unread > 0 ? ` [${c.unread} não lida(s)]` : ""}${dealInfo}: "${cleanPreview}"`
          );
        }

        if (todayTransferLines.length > 0) {
          sections.push(
            `📥 LEADS E NOVOS ATENDIMENTOS QUE CHEGARAM PARA VOCÊ HOJE (${todayTransferLines.length}):\n${todayTransferLines.join("\n")}`
          );
        } else {
          sections.push(
            `📥 LEADS E NOVOS ATENDIMENTOS QUE CHEGARAM PARA VOCÊ HOJE: 0 leads novos transferidos hoje até o momento (você possui ${activeConvs.length} conversa(s) ativa(s) em andamento na fila).`
          );
        }

        if (waitingClients.length > 0) {
          sections.push(
            `⏱️ CLIENTES AGUARDANDO SUA RESPOSTA AGORA (${waitingClients.length}):\n${waitingClients.join("\n")}`
          );
        } else {
          sections.push(`⏱️ CLIENTES AGUARDANDO RESPOSTA (SLA): Nenhum cliente esperando resposta na sua fila agora!`);
        }

        sections.push(`💬 SUAS CONVERSAS ATIVAS (${activeConvs.length}):\n${convLines.join("\n")}`);
      } else {
        if (todayTransferLines.length > 0) {
          sections.push(
            `📥 LEADS E NOVOS ATENDIMENTOS QUE CHEGARAM PARA VOCÊ HOJE (${todayTransferLines.length}):\n${todayTransferLines.join("\n")}`
          );
        } else {
          sections.push(`📥 LEADS QUE CHEGARAM HOJE: Nenhum lead novo recebido hoje até o momento.`);
        }
        sections.push("💬 Você não tem conversas ativas em andamento no momento.");
      }
    } catch (convErr: any) {
      console.warn("[getOperatorContext] Aviso ao carregar conversas ativas:", convErr?.message);
    }

    // ── 5. BUSCA PROFUNDA SOB DEMANDA (CLIENTE / CONVERSA / NEGOCIAÇÃO) + GUARDA DE SIGILO ──
    const searchTerms = extractSearchCandidateTerms(userQuery);
    if (searchTerms.length > 0) {
      try {
        // 5.1 Verifica nas conversas e deals do PRÓPRIO operador se algum termo bate com nome de cliente/empresa/negociação
        const matchedConvs = activeConvs.filter((c) => {
          const hay = `${c.contactName || ""} ${c.contactCompany || ""} ${c.dealTitle || ""}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
          return searchTerms.some((t) => hay.includes(t));
        });

        // Se não achou nas ativas, procura também nas finalizadas do PRÓPRIO operador
        let extraOwnConvs: typeof activeConvs = [];
        if (matchedConvs.length === 0) {
          const likeFilters = searchTerms.map((t) => ilike(contacts.name, `%${t}%`));
          const rawExtra = await db
            .select({
              id: conversations.id,
              contactId: conversations.contactId,
              contactName: contacts.name,
              contactPhone: contacts.phone,
              contactCompany: crmAccounts.name,
              lastMessage: conversations.lastMessageText,
              lastTime: conversations.lastMessageTime,
              createdAt: conversations.createdAt,
              queueState: conversations.queueState,
              unread: conversations.unreadCount,
            })
            .from(conversations)
            .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)))
            .leftJoin(crmAccounts, and(eq(crmAccounts.id, contacts.accountId), eq(crmAccounts.tenantId, tenantId)))
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                eq(conversations.operatorId, operatorId),
                or(...likeFilters)
              )
            )
            .orderBy(desc(conversations.lastMessageTime))
            .limit(3);

          extraOwnConvs = rawExtra.map((c) => ({ ...c, dealTitle: null, funnelName: null }));
        }

        const targetConvs = [...matchedConvs, ...extraOwnConvs].slice(0, 2);
        if (targetConvs.length > 0) {
          const deepDetails: string[] = [];
          for (const tc of targetConvs) {
            if (!knownConvMap.has(tc.id)) {
              knownConvMap.set(tc.id, {
                clientId: tc.id,
                clientName: tc.contactName,
                company: tc.contactCompany || null,
                lastMessage: tc.lastMessage || null,
                dealTitle: tc.dealTitle || null,
                funnelName: tc.funnelName || null,
              });
            }

            const recentMsgs = await db
              .select({
                senderType: messages.senderType,
                content: messages.content,
                mediaInterpretation: messages.mediaInterpretation,
                sentAt: messages.sentAt,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.conversationId, tc.id),
                  eq(messages.tenantId, tenantId),
                  eq(messages.isInternalNote, false)
                )
              )
              .orderBy(desc(messages.sentAt))
              .limit(12);

            const orderedMsgs = recentMsgs.reverse();
            const transcript = orderedMsgs
              .map((m) => {
                const hora = m.sentAt
                  ? new Date(m.sentAt).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";
                const who = m.senderType === "client" ? "Cliente" : m.senderType === "bot" ? "IA Triagem" : "Você";
                const txt = (m.content || m.mediaInterpretation || "[Mídia]").slice(0, 180);
                return `    [${hora}] ${who}: ${txt}`;
              })
              .join("\n");

            deepDetails.push(
              `  📌 Cliente: ${tc.contactName}${tc.contactCompany ? ` (${tc.contactCompany})` : ""} (convId: ${tc.id}) | Fila: ${tc.queueState}${tc.dealTitle ? ` | Negociação: ${tc.dealTitle}` : ""}\n  Últimas mensagens da conversa:\n${transcript}`
            );
          }
          sections.push(`🔍 HISTÓRICO DETALHADO DO(S) CLIENTE(S) CONSULTADO(S):\n${deepDetails.join("\n\n")}`);
        }

        // 5.2 Guarda de Sigilo: Verifica se o termo buscado pertence a OUTRO operador (negociação ou conversa de terceiros)
        if (targetConvs.length === 0) {
          const dealLikeFilters = searchTerms.map((t) => ilike(crmDeals.title, `%${t}%`));
          const thirdPartyDeals = await db
            .select({
              title: crmDeals.title,
              otherOperatorId: crmDeals.operatorId,
            })
            .from(crmDeals)
            .where(
              and(
                eq(crmDeals.tenantId, tenantId),
                ne(crmDeals.operatorId, operatorId),
                or(...dealLikeFilters)
              )
            )
            .limit(3);

          const contactLikeFilters = searchTerms.map((t) => ilike(contacts.name, `%${t}%`));
          const thirdPartyConvs = await db
            .select({
              contactName: contacts.name,
              otherOperatorId: conversations.operatorId,
            })
            .from(conversations)
            .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)))
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                ne(conversations.operatorId, operatorId),
                or(...contactLikeFilters)
              )
            )
            .limit(3);

          if (thirdPartyDeals.length > 0 || thirdPartyConvs.length > 0) {
            const matchedNames = [
              ...thirdPartyDeals.map((d) => d.title),
              ...thirdPartyConvs.map((c) => c.contactName),
            ].slice(0, 3);
            sections.push(
              `🔒 ALERTA DE SIGILO COMERCIAL (DADOS DE TERCEIROS DETECTADOS NA PERGUNTA):\n` +
                `  • O vendedor perguntou sobre "${matchedNames.join(", ")}", que pertence à carteira de OUTRO vendedor/operador.\n` +
                `  • REGRA INVIOLÁVEL: Informe educadamente que esse cliente/negociação está na carteira de outro consultor e que, por política de sigilo comercial, você só pode consultar e detalhar clientes, conversas e negociações da carteira do próprio vendedor logado.`
            );
          }
        }
      } catch (deepErr: any) {
        console.warn("[getOperatorContext] Aviso na busca profunda:", deepErr?.message);
      }
    }

    // ── 6. MÉTRICAS DE ATENDIMENTO DO DIA ────────────────────────────────────
    try {
      const today = new Date().toISOString().split("T")[0];
      const dailyMetrics = await db
        .select()
        .from(operatorDailyMetrics)
        .where(
          and(
            eq(operatorDailyMetrics.tenantId, tenantId),
            eq(operatorDailyMetrics.operatorId, operatorId),
            eq(operatorDailyMetrics.date, today)
          )
        )
        .limit(1);

      if (dailyMetrics.length > 0) {
        const m = dailyMetrics[0];
        const tma = m.avgResponseTimeSeconds
          ? `${Math.floor(m.avgResponseTimeSeconds / 60)}min ${m.avgResponseTimeSeconds % 60}s`
          : "N/A";
        sections.push(
          `📊 SUAS MÉTRICAS DE ATENDIMENTO DE HOJE:\n  • Total conversas: ${m.totalConversations}\n  • TMA (Tempo Médio de Resposta): ${tma}\n  • SLA estourados hoje: ${m.overdueCount}\n  • Score médio IA: ${m.avgPerformanceScore || "N/A"}/100`
        );
      }
    } catch (metricsErr: any) {
      console.warn("[getOperatorContext] Aviso ao carregar métricas do dia:", metricsErr?.message);
    }

    // ── 7. BASE DE CONHECIMENTO / CATÁLOGO DE MÁQUINAS E PRODUTOS ────────────
    try {
      const kbContext = await getKnowledgeBaseContext(tenantId, userQuery);
      if (kbContext) {
        sections.push(kbContext);
      }
    } catch {
      // fallback silencioso se base de conhecimento falhar
    }

    return {
      contextText: sections.join("\n\n"),
      knownConversations: Array.from(knownConvMap.values()),
      waitingConversations,
      todayLeadsConversations,
    };
  } catch (err: any) {
    console.error("[getOperatorContext] Erro:", err);
    return {
      contextText: sections.length > 0 ? sections.join("\n\n") : "Sem dados adicionais no momento.",
      knownConversations: Array.from(knownConvMap.values()),
      waitingConversations,
      todayLeadsConversations,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXTO DA VALENTINA SUPERVISORA — Visão global da operação
// Usado em: Módulo Valentina (Chat), scope = "admin", role = "admin"
// ═══════════════════════════════════════════════════════════════════════════════
async function getManagerContext(tenantId: string): Promise<string> {
  try {
    const sections: string[] = [];
    const today = new Date().toISOString().split("T")[0];
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // ── Resumo geral de conversas por estado ─────────────────────────────────
    const convSummary = await db
      .select({
        state: conversations.queueState,
        total: count(),
      })
      .from(conversations)
      .where(eq(conversations.tenantId, tenantId))
      .groupBy(conversations.queueState);

    if (convSummary.length > 0) {
      const sumLines = convSummary.map((s) => `  • ${s.state}: ${s.total}`).join("\n");
      sections.push(`📊 CONVERSAS POR ESTADO:\n${sumLines}`);
    }

    // ── Operadores e métricas do dia ──────────────────────────────────────────
    const teamMetrics = await db
      .select()
      .from(operatorDailyMetrics)
      .where(
        and(
          eq(operatorDailyMetrics.tenantId, tenantId),
          eq(operatorDailyMetrics.date, today)
        )
      )
      .orderBy(desc(operatorDailyMetrics.totalConversations));

    if (teamMetrics.length > 0) {
      const teamLines = teamMetrics.map((m) => {
        const tma = m.avgResponseTimeSeconds
          ? `${Math.floor(m.avgResponseTimeSeconds / 60)}m${m.avgResponseTimeSeconds % 60}s`
          : "N/A";
        return `  • ${m.operatorName}: ${m.totalConversations} conv, TMA ${tma}, ${m.overdueCount} SLA estourado(s), score ${m.avgPerformanceScore ?? "N/A"}/100`;
      }).join("\n");
      sections.push(`👥 DESEMPENHO DA EQUIPE HOJE:\n${teamLines}`);
    }

    // ── SLA estourado global ──────────────────────────────────────────────────
    const overdueSla = await db
      .select({
        contactName: contacts.name,
        operatorId: responseTimeLogs.operatorId,
        clientMsgAt: responseTimeLogs.clientMessageAt,
      })
      .from(responseTimeLogs)
      .innerJoin(conversations, eq(conversations.id, responseTimeLogs.conversationId))
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(
        and(
          eq(responseTimeLogs.tenantId, tenantId),
          eq(responseTimeLogs.isOverdue, true),
          isNull(responseTimeLogs.agentResponseId)
        )
      )
      .orderBy(desc(responseTimeLogs.clientMessageAt))
      .limit(10);

    if (overdueSla.length > 0) {
      const slaLines = await Promise.all(
        overdueSla.map(async (s) => {
          const waitMin = Math.floor((Date.now() - new Date(s.clientMsgAt).getTime()) / 60_000);
          let opName = "Sem operador";
          if (s.operatorId) {
            opName = await getOperatorName(s.operatorId);
          }
          return `  • 🚨 ${s.contactName} — ${waitMin}min sem resposta (operador: ${opName})`;
        })
      );
      sections.push(`⏱️ SLAs ESTOURADOS AGORA (${overdueSla.length}):\n${slaLines.join("\n")}`);
    } else {
      sections.push("⏱️ SLAs ESTOURADOS: Nenhum no momento.");
    }

    // ── Conversas ativas no momento por operador ──────────────────────────────
    const activeByOp = await db
      .select({
        operatorId: conversations.operatorId,
        total: count(),
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.queueState, "meus")
        )
      )
      .groupBy(conversations.operatorId)
      .orderBy(desc(count()));

    if (activeByOp.length > 0) {
      const activeLines = await Promise.all(
        activeByOp.map(async (a) => {
          const name = a.operatorId ? await getOperatorName(a.operatorId) : "Sem operador";
          return `  • ${name}: ${a.total} conversa(s) ativa(s)`;
        })
      );
      sections.push(`🔴 CONVERSAS EM ANDAMENTO AGORA:\n${activeLines.join("\n")}`);
    }

    // ── Pipeline SDR ativo ────────────────────────────────────────────────────
    const sdrActive = await db
      .select({ id: agentFlowStates.id })
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.agentType, "sdr"),
          isNull(agentFlowStates.completedAt)
        )
      );
    sections.push(`🤖 TRIAGENS SDR ATIVAS: ${sdrActive.length} lead(s) em qualificação agora.`);

    // ── Auditorias recentes (últimas 24h) ─────────────────────────────────────
    const recentAudits = await db
      .select({
        contactName: aiConversationAudits.contactName,
        score: aiConversationAudits.performanceScore,
        sentiment: aiConversationAudits.clientSentiment,
        insight: aiConversationAudits.actionableInsight,
        operatorId: aiConversationAudits.operatorId,
        auditedAt: aiConversationAudits.auditedAt,
      })
      .from(aiConversationAudits)
      .where(
        and(
          eq(aiConversationAudits.tenantId, tenantId),
          eq(aiConversationAudits.status, "done"),
          gte(aiConversationAudits.auditedAt, last24h)
        )
      )
      .orderBy(desc(aiConversationAudits.auditedAt))
      .limit(8);

    if (recentAudits.length > 0) {
      const auditLines = await Promise.all(
        recentAudits.map(async (a) => {
          const opName = a.operatorId ? await getOperatorName(a.operatorId) : "N/A";
          return `  • ${a.contactName || "Lead"} | Op: ${opName} | Score: ${a.score ?? "N/A"}/100 | Sentimento: ${a.sentiment ?? "N/A"}\n    Insight: ${(a.insight || "N/A").slice(0, 120)}`;
        })
      );
      sections.push(`🔍 AUDITORIAS RECENTES (últimas 24h — ${recentAudits.length}):\n${auditLines.join("\n")}`);
    }

    // ── Resumo de sentimento global ───────────────────────────────────────────
    const sentimentCount = await db
      .select({
        sentiment: aiConversationAudits.clientSentiment,
        total: count(),
      })
      .from(aiConversationAudits)
      .where(
        and(
          eq(aiConversationAudits.tenantId, tenantId),
          gte(aiConversationAudits.createdAt, last24h)
        )
      )
      .groupBy(aiConversationAudits.clientSentiment);

    if (sentimentCount.length > 0) {
      const sentimentLines = sentimentCount.map((s) => `  • ${s.sentiment}: ${s.total}`).join("\n");
      sections.push(`😊 SENTIMENTO GLOBAL (últimas 24h):\n${sentimentLines}`);
    }

    return sections.join("\n\n");
  } catch (err: any) {
    console.error("[getManagerContext] Erro:", err);
    return "⚠️ Não foi possível carregar dados da operação neste momento.";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPTS DAS PERSONAS
// ═══════════════════════════════════════════════════════════════════════════════

function buildSupervisorPrompt(
  persona: ReturnType<typeof getAiPersona>,
  operatorName: string,
  operationalContext: string,
  fileContext: string,
  chatHistoryText: string,
  userMessage: string
): string {
  const genderRole = persona.gender === "male" ? "um analista de dados comerciais sênior" : "uma analista de dados comerciais sênior";
  return `Você é ${persona.name}, I.A. de Business Intelligence e Gestão Comercial da ${persona.company}.
Você está conversando com o gestor "${operatorName}" em uma interface de chat exclusiva para supervisores.

## SEU PAPEL:
Você é ${genderRole}. Seu objetivo é ajudar o gestor a tomar decisões estratégicas com base nos dados reais da operação.
- Quando pedirem gráficos, métricas, tabelas ou análises, gere os blocos estruturados correspondentes com os dados reais disponíveis.
- Seja direto, objetivo e estratégico.
- Use os dados da operação abaixo como fonte primária — NÃO invente números.
- Se os dados não estiverem disponíveis, diga isso claramente.
- Tom profissional, analítico e consultivo.

## DADOS REAIS DA OPERAÇÃO AGORA:
${operationalContext}
${fileContext}

${chatHistoryText ? `## HISTÓRICO RECENTE DESTA CONVERSA:\n${chatHistoryText}\n` : ""}
## SOLICITAÇÃO ATUAL DO GESTOR (${operatorName}):
"${userMessage}"

## ESTRUTURA DE BLOCOS SUPORTADOS (use "blocks" no JSON quando necessário):
1. ChartBlock: { "type": "chart", "chart": "bar"|"line"|"pie", "title": "...", "subtitle": "...", "unit": "...", "data": [{ "label": "X", "value": 10 }] }
2. InsightBlock: { "type": "insight", "title": "...", "items": [{ "label": "...", "value": "...", "delta": "+5%", "trend": "up"|"down"|"flat", "hint": "..." }], "recommendation": "..." }
3. ReportBlock: { "type": "report", "title": "...", "columns": ["A","B"], "rows": [["1","2"]], "footnote": "..." }
4. ExcerptBlock: { "type": "excerpt", "title": "...", "conversations": [{ "lead": "...", "channel": "WhatsApp", "when": "Hoje", "sentiment": "positivo"|"neutro"|"negativo", "lines": [{ "from": "lead"|"agente", "text": "..." }] }] }

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON):
{
  "fragments": [
    {
      "text": "mensagem explicativa em texto respondendo diretamente à pergunta do gestor",
      "delay": 0,
      "blocks": [ ... ]
    }
  ]
}`;
}

function buildColeaguePrompt(
  persona: ReturnType<typeof getAiPersona>,
  operatorName: string,
  operatorContext: string,
  fileContext: string,
  chatHistoryText: string,
  userMessage: string,
  alreadyTalkingToday: boolean
): string {
  const isMale = persona.gender === "male";
  const colleagueRole = isMale ? "colega de equipe e copiloto comercial" : "colega de equipe e copiloto comercial";
  const firstName = operatorName.split(" ")[0] || operatorName;

  return `Você é ${persona.name}, ${colleagueRole} de vendas e atendimento da ${persona.company}.
Você trabalha lado a lado com ${operatorName} (consultor(a)/vendedor(a)) durante o dia a dia comercial no WhatsApp interno.

## SEU PAPEL NO DIA A DIA DO VENDEDOR:
Você NÃO é um suporte de T.I. (nunca fale em "chamados de T.I." ou "tickets"). Você é um colega de trabalho afiado, direto e prestativo que ajuda ${firstName} com:
1. **Leads e Atendimentos de Hoje / Conversas Ativas / SLA**: Quantos leads chegaram hoje, quais clientes estão aguardando resposta no WhatsApp (e há quantos minutos), quais foram transferidos recentemente, resumo do que o cliente falou e sugestões de mensagens de abordagem, contorno de objeções ou follow-up.
2. **Metas e Ritmo Comercial**: Quanto falta para bater a meta do mês, quanto já vendeu, qual a meta diária necessária e quantos dias úteis restam.
3. **Tarefas, Reuniões e Diretrizes do Gestor**: Quais tarefas estão pendentes para hoje ou atrasadas e quais orientações o gestor deixou nas negociações.
4. **Ligações Agendadas**: Quais ligações e follow-ups ${firstName} precisa fazer hoje.
5. **Negociações (CRM) Abertas e Negociações Paradas/Esfriando**: Quais orçamentos/deals estão em aberto e quais estão parados há 3+ dias sem interação.
6. **Dúvidas Técnicas de Produtos/Máquinas**: Especificações técnicas do catálogo da ${persona.company} para ajudar ${firstName} a responder rápido ao cliente.

## 💬 ESTILO DE CONVERSA NATURAL (COMO UM COLEGA NO WHATSAPP):
1. **DIVIDA EM BALÕES CURTOS (2 A 4 FRAGMENTOS)**:
   - No WhatsApp, ninguém manda um textão único gigante. Quebre sua resposta em **2 a 4 balões curtos** dentro do array \`"fragments"\`!
   - Cada balão deve ter **1 a 3 frases curtas** ou uma lista enxuta.
   - Exemplo:
     - Balão 1 (\`delay: 0\`): Resposta direta à pergunta (sem enrolação).
     - Balão 2 (\`delay: 650\`): Dados objetivos (ex: os clientes/leads, ou os números da meta/tarefas).
     - Balão 3 (\`delay: 1300\`, opcional): Uma dica prática ou pergunta curta sobre qual cliente/item atacar primeiro.
2. **PROIBIDO CUMPRIMENTAR TODA HORA**:
   - ${
     alreadyTalkingToday
       ? `🚨 **VOCÊS JÁ ESTÃO CONVERSANDO HOJE!** Veja o histórico abaixo. É **ESTRITAMENTE PROIBIDO** começar a resposta com saudação ("Fala, ${firstName}!", "E aí, ${firstName}!", "Bom dia", "Boa tarde", "Olá", "Tudo certo?", "Opa"). Responda DIRETO ao ponto como em uma conversa contínua de WhatsApp!`
       : `Como é a primeira troca de mensagens de hoje, se ${firstName} mandou um cumprimento ("Oi", "Olá", "Bom dia"), responda de forma curta e natural apenas no primeiro balão e já traga um panorama rápido e útil do dia.`
   }
3. **PROIBIDO REPETIR PALAVRAS, NOMES OU BORDÕES**:
   - **NUNCA** use as palavras **"parceiro"**, **"parceira"**, **"campeão"**, **"fera"**, **"chefe"**, **"meu caro"** ou **"amigo"**.
   - **NÃO** fique repetindo o nome "${firstName}" em toda mensagem ou em todo balão.
   - **NUNCA** use frases de fechamento batidas/repetitivas como *"Qualquer coisa estou na escuta"*, *"Fico na escuta"*, *"É só chamar"*, *"Estou por aqui"*, *"Bora pra cima"*, *"Bons negócios"*.
   - Olhe o **HISTÓRICO RECENTE DA CONVERSA** abaixo e garanta que você **NÃO vai repetir** nenhuma frase, abertura ou estrutura que já usou nas mensagens anteriores.
4. **CITAÇÃO INTERATIVA DE CONVERSAS (\`mentionedConversationIds\`)**:
   - Sempre que você citar, listar ou responder sobre clientes/conversas/leads (ex: leads que chegaram hoje, clientes aguardando resposta ou conversas ativas), coloque os respectivos IDs das conversas (que aparecem no contexto como \`[ID: ...]\`) dentro do array \`"mentionedConversationIds"\` do JSON. O sistema criará automaticamente os botões clicáveis **"Abrir →"** para ${firstName} abrir cada conversa direto pelo chat!

## 🔒 REGRAS INVIOLÁVEIS DE SIGILO E SEGURANÇA (RBAC):
- Você tem acesso EXCLUSIVO à carteira, metas, tarefas, clientes e negociações de **${operatorName}**.
- **PROIBIDO** revelar, estimar ou comentar sobre negociações de terceiros (outros vendedores/operadores), ranking confidencial de salários/comissões de colegas ou dados estratégicos/financeiros restritos à Diretoria.
- Use SEMPRE os dados reais fornecidos abaixo. Nunca invente valores, nomes de clientes ou tarefas que não estejam listados no contexto.

## DADOS COMERCIAIS E OPERACIONAIS DE ${operatorName.toUpperCase()} AGORA:
${operatorContext}
${fileContext}

${chatHistoryText ? `## HISTÓRICO RECENTE DA CONVERSA COM ${operatorName.toUpperCase()}:\n${chatHistoryText}\n` : ""}
## MENSAGEM ATUAL DE ${operatorName.toUpperCase()}:
"${userMessage}"

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON):
{
  "fragments": [
    {
      "text": "Primeiro balão curto e direto (sem saudação repetida e sem palavras-muleta)",
      "delay": 0
    },
    {
      "text": "Segundo balão com os detalhes ou pontos principais de forma limpa",
      "delay": 650
    }
  ],
  "mentionedConversationIds": ["id-da-conversa-1", "id-da-conversa-2"]
}`;
}

// ── Helpers para Pós-Processamento de Balões Naturais e Conversas Citadas ───
function cleanColleagueText(
  text: string,
  operatorName: string,
  alreadyTalkingToday: boolean,
  isFirstBubble: boolean
): string {
  let out = (text || "").trim();
  const firstName = (operatorName.split(" ")[0] || operatorName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Remove bordões/muletas proibidas ("parceiro", "parceira", "campeão", "fera")
  out = out
    .replace(/,\s*\b(meu\s+)?(parceir[oa]|campe[aã]o|fera|chefe)\b([!.,?])/gi, "$3")
    .replace(/\b(meu\s+)?(parceir[oa]|campe[aã]o|fera)\b[,!]?\s*/gi, "");

  // Remove saudações repetidas quando já estão conversando hoje
  if (alreadyTalkingToday && isFirstBubble) {
    const greetingRegex = new RegExp(
      `^(?:fala|e\\s+a[íi]|opa|ol[áa]|oi|bom\\s+dia|boa\\s+tarde|boa\\s+noite|tudo\\s+certo|beleza)(?:\\s*,?\\s*${firstName})?[!,.:?]*\\s*(?:(?:bom\\s+dia|boa\\s+tarde|boa\\s+noite|tudo\\s+certo|tudo\\s+bem|como\\s+vai)[!,.:?]*\\s*)*`,
      "i"
    );
    const stripped = out.replace(greetingRegex, "").trim();
    if (stripped.length > 10) {
      out = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
  }

  // Remove fechamentos robóticos repetitivos no final
  out = out
    .replace(/\s*(?:qualquer\s+coisa\s+)?(?:estou|fico|tô)\s+(?:por\s+aqui|na\s+escuta|à\s+disposição)[^.!?\n]*[.!?]?\s*$/i, "")
    .trim();

  // Remove vazamento acidental de "[ID: ...]" no texto visível (já que terá botão interativo)
  out = out.replace(/\s*\[ID:\s*[^\]]+\]/gi, "").trim();

  return out || text.trim();
}

function splitIntoNaturalFragments(
  rawFragments: { text: string; delay?: number; blocks?: any[] }[],
  operatorName: string,
  alreadyTalkingToday: boolean
): { text: string; delay: number; blocks?: any[] }[] {
  const cleanedInput = rawFragments
    .map((f, idx) => ({
      ...f,
      text: cleanColleagueText(f.text, operatorName, alreadyTalkingToday, idx === 0),
    }))
    .filter((f) => f.text.length > 0 || (f.blocks && f.blocks.length > 0));

  if (cleanedInput.length === 0) return [];

  // Se a IA já retornou 2 a 4 balões bem divididos, apenas garante que nenhum balão único seja gigante
  const finalBubbles: { text: string; delay: number; blocks?: any[] }[] = [];

  for (const frag of cleanedInput) {
    // Se tiver blocks (modo supervisor), preserva como está
    if (frag.blocks && frag.blocks.length > 0) {
      finalBubbles.push({
        text: frag.text,
        delay: finalBubbles.length * 650,
        blocks: frag.blocks,
      });
      continue;
    }

    // Divide por quebras de parágrafo duplas se o balão for longo (> 180 chars) ou se só veio 1 balão com vários parágrafos
    const paragraphs = frag.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (paragraphs.length > 1 && (cleanedInput.length === 1 || frag.text.length > 180)) {
      for (const p of paragraphs) {
        finalBubbles.push({
          text: p,
          delay: finalBubbles.length * 650,
        });
      }
    } else if (cleanedInput.length === 1 && frag.text.length > 220) {
      // Se veio 1 bloco só sem \n\n mas com várias frases longas, divide em 2 ou 3 balões por frases
      const sentences = frag.text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [frag.text];
      if (sentences.length >= 2) {
        const mid = Math.ceil(sentences.length / 2);
        const part1 = sentences.slice(0, mid).join(" ").trim();
        const part2 = sentences.slice(mid).join(" ").trim();
        if (part1) finalBubbles.push({ text: part1, delay: finalBubbles.length * 650 });
        if (part2) finalBubbles.push({ text: part2, delay: finalBubbles.length * 650 });
      } else {
        finalBubbles.push({ text: frag.text, delay: finalBubbles.length * 650 });
      }
    } else {
      finalBubbles.push({
        text: frag.text,
        delay: finalBubbles.length * 650,
      });
    }
  }

  // Limita a no máximo 4 balões agrupando o excedente no último balão para não virar metralhadora
  if (finalBubbles.length > 4) {
    const firstThree = finalBubbles.slice(0, 3);
    const restText = finalBubbles
      .slice(3)
      .map((b) => b.text)
      .join("\n\n");
    return [
      ...firstThree,
      {
        text: restText,
        delay: 3 * 650,
        blocks: finalBubbles[finalBubbles.length - 1].blocks,
      },
    ];
  }

  return finalBubbles;
}

function resolveRelatedConversations(
  mentionedIds: string[],
  fullReplyText: string,
  userText: string,
  ctx: OperatorContextResult | null
): RelatedConversationItem[] {
  if (!ctx || ctx.knownConversations.length === 0) return [];

  const selectedMap = new Map<string, RelatedConversationItem>();
  const byId = new Map(ctx.knownConversations.map((c) => [c.clientId, c]));

  // 1. IDs explicitamente retornados pela IA em mentionedConversationIds
  for (const id of mentionedIds) {
    const found = byId.get(id);
    if (found) selectedMap.set(found.clientId, found);
  }

  // 2. Nomes de clientes citados no texto da resposta da IA ou na pergunta do usuário
  const normReply = fullReplyText.toLowerCase();
  const normUser = userText.toLowerCase();
  for (const conv of ctx.knownConversations) {
    const nameClean = (conv.clientName || "").trim().toLowerCase();
    if (nameClean.length >= 3 && !nameClean.startsWith("cliente ")) {
      // Verifica nome completo ou primeiro nome (se >= 4 letras)
      const firstToken = nameClean.split(/\s+/)[0];
      if (
        normReply.includes(nameClean) ||
        normUser.includes(nameClean) ||
        (firstToken.length >= 4 && (normReply.includes(firstToken) || normUser.includes(firstToken)))
      ) {
        selectedMap.set(conv.clientId, conv);
      }
    }
  }

  // 3. Se o operador perguntou sobre leads de hoje e temos leads de hoje, anexa
  const asksTodayLeads =
    /(?:lead|leads|chegaram|chegou|recebi|entraram|entrou|novos)\b.*\b(?:hoje|dia)\b|\b(?:hoje)\b.*\b(?:lead|leads|chegaram|chegou|atendimento)/i.test(
      normUser
    );
  if (asksTodayLeads && ctx.todayLeadsConversations.length > 0) {
    for (const c of ctx.todayLeadsConversations.slice(0, 6)) {
      selectedMap.set(c.clientId, c);
    }
  }

  // 4. Se o operador perguntou sobre conversas/clientes aguardando ou ativos e ainda não selecionamos nenhuma
  const asksConversations =
    /\b(?:conversa|conversas|atendimento|atendimentos|cliente|clientes|aguardando|esperando|pendente|pendentes|fila|responder|sobrecarga)\b/i.test(
      normUser
    ) ||
    /\b(?:aguardando\s+sua\s+resposta|conversas\s+ativas|atendimentos\s+ativos)\b/i.test(normReply);

  if (asksConversations && selectedMap.size === 0) {
    const pool =
      ctx.waitingConversations.length > 0 ? ctx.waitingConversations : ctx.knownConversations;
    for (const c of pool.slice(0, 6)) {
      selectedMap.set(c.clientId, c);
    }
  }

  return Array.from(selectedMap.values()).slice(0, 8);
}

// Helper para buscar as conversas ativas atuais do operador (para enriquecer cards de sobrecarga/alerta no GET)
async function fetchActiveConversationsForOperatorCard(
  tenantId: string,
  operatorId: string
): Promise<RelatedConversationItem[]> {
  try {
    const activeRows = await db
      .select({
        convId: conversations.id,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        accountName: crmAccounts.name,
        lastMessageText: conversations.lastMessageText,
        lastClientMsg: conversations.lastClientMessageAt,
        lastOpMsg: conversations.lastOperatorMessageAt,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(crmAccounts, eq(contacts.accountId, crmAccounts.id))
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.operatorId, operatorId),
          eq(conversations.queueState, "meus")
        )
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(12);

    const nowMs = Date.now();
    const items: RelatedConversationItem[] = activeRows.map((c) => {
      const clientMsgMs = c.lastClientMsg ? new Date(c.lastClientMsg).getTime() : 0;
      const opMsgMs = c.lastOpMsg ? new Date(c.lastOpMsg).getTime() : 0;
      const isWaiting = clientMsgMs > 0 && (opMsgMs === 0 || clientMsgMs > opMsgMs);
      const waitMinutes = isWaiting ? Math.max(1, Math.floor((nowMs - clientMsgMs) / 60_000)) : 0;

      return {
        clientId: c.convId,
        clientName: c.contactName || c.contactPhone || "Cliente",
        clientPhone: c.contactPhone || undefined,
        company: c.accountName || undefined,
        waitMinutes: isWaiting ? waitMinutes : undefined,
        lastMessage: c.lastMessageText ? c.lastMessageText.slice(0, 90) : undefined,
        statusLabel: isWaiting ? `Aguardando há ${waitMinutes} min` : "Em atendimento",
      };
    });

    items.sort((a, b) => (b.waitMinutes || 0) - (a.waitMinutes || 0));
    return items.slice(0, 8);
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/api/valentina/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Carrega histórico de mensagens + alertas proativos (deduplicados e interativos) ──
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const reqOperatorId = url.searchParams.get("operatorId");
        const scope = url.searchParams.get("scope") || "operator";

        // Operador comum só visualiza as próprias mensagens
        let operatorId = session.operator.id;
        if ((session.operator.role === "admin" || session.operator.role === "supervisor") && reqOperatorId) {
          operatorId = reqOperatorId;
        }

        try {
          const scopeFilter =
            scope === "admin"
              ? sql`${internalMessages.metadata}->>'scope' = 'admin'`
              : sql`(
                  ${internalMessages.metadata}->>'scope' = 'operator'
                  OR (
                    (${internalMessages.metadata}->>'scope' IS NULL OR ${internalMessages.metadata}->>'scope' = 'operator')
                    AND (
                      ${internalMessages.metadata}->>'type' IS NULL
                      OR ${internalMessages.metadata}->>'isChat' = 'true'
                      OR ${internalMessages.metadata}->>'type' IN ('lead_transfer', 'sla_alert', 'no_response', 'operator_overload', 'sentiment_alert')
                    )
                  )
                )`;

          const msgs = await db
            .select()
            .from(internalMessages)
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.operatorId, operatorId),
                scopeFilter
              )
            )
            .orderBy(desc(internalMessages.createdAt))
            .limit(100);

          // Se for o escopo do operador, deduplica spam de notificações (operator_overload e sla_alert repetidos)
          // e enriquece o card de sobrecarga com a lista interativa de conversas + botão de abrir
          if (scope !== "admin") {
            let seenOverload = false;
            const seenSlaByConv = new Set<string>();
            const duplicateIdsToDelete: string[] = [];
            const deduplicatedDesc: typeof msgs = [];

            const activeConvsForCard = await fetchActiveConversationsForOperatorCard(tenantId, operatorId);

            // msgs está ordenado do mais recente para o mais antigo (desc)
            for (const row of msgs) {
              const meta: any =
                typeof row.metadata === "string"
                  ? (() => {
                      try {
                        return JSON.parse(row.metadata);
                      } catch {
                        return {};
                      }
                    })()
                  : row.metadata || {};

              const isOverload =
                meta?.type === "operator_overload" ||
                meta?.warningType === "overload" ||
                (typeof row.content === "string" &&
                  row.content.includes("conversas ativas neste momento"));

              if (isOverload) {
                if (seenOverload) {
                  // Duplicata antiga de sobrecarga -> remove do histórico e agenda limpeza no banco
                  duplicateIdsToDelete.push(row.id);
                  continue;
                }
                seenOverload = true;
                // Enriquece o único card de sobrecarga mantido com as conversas interativas
                const existingConvs = Array.isArray(meta?.conversations) ? meta.conversations : [];
                const enrichedMeta = {
                  ...meta,
                  type: "operator_overload",
                  warningType: "overload",
                  conversations: existingConvs.length > 0 ? existingConvs : activeConvsForCard,
                };
                row.metadata = enrichedMeta;
                deduplicatedDesc.push(row);
                continue;
              }

              const isSlaOrDelay = meta?.type === "sla_alert" || meta?.type === "no_response";
              if (isSlaOrDelay) {
                const convKey = meta?.conversationId || meta?.clientId || meta?.clientName || "";
                if (convKey) {
                  if (seenSlaByConv.has(convKey)) {
                    duplicateIdsToDelete.push(row.id);
                    continue;
                  }
                  seenSlaByConv.add(convKey);
                }
              }

              deduplicatedDesc.push(row);
            }

            // Limpa do banco em background os alertas duplicados antigos para nunca mais voltarem
            if (duplicateIdsToDelete.length > 0) {
              db.delete(internalMessages)
                .where(
                  and(
                    eq(internalMessages.tenantId, tenantId),
                    inArray(internalMessages.id, duplicateIdsToDelete)
                  )
                )
                .catch((err) =>
                  console.warn("[valentina/messages] Falha ao limpar duplicatas antigas:", err?.message)
                );
            }

            const sorted = deduplicatedDesc.reverse();
            return new Response(JSON.stringify(sorted), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const sorted = msgs.reverse();

          return new Response(JSON.stringify(sorted), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── POST: Envia mensagem e obtém resposta da IA ────────────────────────
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const operatorId = session.operator.id;

        try {
          const body = await request.json();
          const { content, scope = "operator", attachment, imageBase64 } = body;

          if (!content && !attachment && !imageBase64) {
            return new Response(
              JSON.stringify({ error: "content, attachment ou imageBase64 são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // ── Detecta se é Supervisora ou Copiloto do Vendedor ───────────────
          // scope "admin" → Supervisora (Módulo IA Gestão, só gestores)
          // scope "operator" → Copiloto Comercial (Módulo Chat, todos os operadores/vendedores)
          const isSupervisor = scope === "admin";
          const isActuallyAdmin = session.operator.role === "admin" || session.operator.role === "supervisor";
          const useManagerContext = isSupervisor && isActuallyAdmin;

          const now = new Date();
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          const persona = getAiPersona(tenantId);
          const operatorName = session.operator.name || await getOperatorName(operatorId);
          const operatorEmail = (session.operator as any).email || null;
          const contextTenantId = tenantId;
          const userText = (content || "").trim() || `[Arquivo enviado: ${attachment?.name ?? "imagem"}]`;

          // ── Busca histórico recente da conversa antes de inserir a nova ─────
          const recentChatRows = await db
            .select({
              direction: internalMessages.direction,
              content: internalMessages.content,
              createdAt: internalMessages.createdAt,
              metadata: internalMessages.metadata,
            })
            .from(internalMessages)
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.operatorId, operatorId),
                sql`(${internalMessages.metadata}->>'scope' = ${scope} OR (${scope} = 'operator' AND (${internalMessages.metadata}->>'isChat' = 'true' OR ${internalMessages.metadata}->>'type' IN ('lead_transfer', 'sla_alert'))))`
              )
            )
            .orderBy(desc(internalMessages.createdAt))
            .limit(14);

          // Verifica se o operador já conversou com a IA hoje (para não cumprimentar toda hora!)
          const alreadyTalkingToday = recentChatRows.some((r) => {
            const meta: any = r.metadata || {};
            const isChatMsg = r.direction === "to_agent" || meta?.isChat === true;
            const createdMs = r.createdAt ? new Date(r.createdAt).getTime() : 0;
            return isChatMsg && createdMs >= todayStart.getTime();
          });

          const chatHistoryText = recentChatRows
            .reverse()
            .map((r) => {
              const speaker = r.direction === "to_agent" ? operatorName : persona.name;
              return `${speaker}: ${(r.content || "").slice(0, 500)}`;
            })
            .join("\n");

          // ── Salva mensagem do usuário no banco ─────────────────────────────
          const userMsgId = `val-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await db.insert(internalMessages).values({
            id: userMsgId,
            tenantId,
            operatorId,
            direction: "to_agent",
            agentType: "supervisor",
            content: userText,
            metadata: {
              isChat: true,
              scope,
              knowledgeBase: tenantId,
              attachedFileInfo: attachment ? { name: attachment.name, mimeType: attachment.mimeType } : undefined,
              attachedImageInfo: imageBase64 ? { name: "Imagem", dataUrl: imageBase64 } : undefined,
            },
            read: 1,
            createdAt: now,
          });

          // ── Contexto e extração de arquivo ─────────────────────────────────
          let fileContext = "";
          if (attachment?.base64 && attachment?.name) {
            const extracted = await extractFileText(attachment.name, attachment.mimeType || "", attachment.base64);
            fileContext = `\n\n📎 ARQUIVO ANEXADO PELO USUÁRIO: "${attachment.name}"\n${extracted}`;
          }

          let managerContextText = "";
          let operatorContextResult: OperatorContextResult | null = null;

          if (useManagerContext) {
            managerContextText = await getManagerContext(contextTenantId);
          } else {
            operatorContextResult = await getOperatorContext(
              contextTenantId,
              operatorId,
              operatorEmail,
              userText
            );
          }

          // ── Seleciona o prompt correto (incluindo histórico + pergunta atual!) ──
          const systemPrompt = useManagerContext
            ? buildSupervisorPrompt(
                persona,
                operatorName,
                managerContextText,
                fileContext,
                chatHistoryText,
                userText
              )
            : buildColeaguePrompt(
                persona,
                operatorName,
                operatorContextResult?.contextText || "",
                fileContext,
                chatHistoryText,
                userText,
                alreadyTalkingToday
              );

          // ── Feature key para rastreamento de custos ─────────────────────────
          const featureKey = useManagerContext ? "supervisor_chat" : persona.chatFeatureKey;

          // ── Chama o Vertex AI (suportando imagem anexada quando houver) ─────
          let fragments: { text: string; delay?: number; blocks?: any[] }[] = [];
          let mentionedConversationIds: string[] = [];
          let alerts: any[] = [];

          try {
            const { vertexAi } = await import("../../../lib/vertex-ai");

            if (vertexAi.isReady()) {
              let promptInput: string | MultimodalPart[] = systemPrompt;
              if (imageBase64 && typeof imageBase64 === "string") {
                const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
                const mimeType = match ? match[1] : "image/jpeg";
                const rawB64 = match ? match[2] : imageBase64;
                promptInput = [
                  { text: systemPrompt },
                  { inlineData: { mimeType, data: rawB64 } },
                ];
              }

              const aiRes = await vertexAi.generateStructuredJson<{
                fragments: { text: string; delay?: number; blocks?: any[] }[];
                mentionedConversationIds?: string[];
                alerts?: any[];
              }>(promptInput, "gemini-2.5-pro", undefined, {
                tenantId,
                feature: featureKey,
                metadata: { operatorId, operatorName, scope, isManager: useManagerContext },
              });

              if (aiRes?.fragments && aiRes.fragments.length > 0) {
                fragments = aiRes.fragments;
                mentionedConversationIds = Array.isArray(aiRes.mentionedConversationIds)
                  ? aiRes.mentionedConversationIds
                  : [];
                alerts = aiRes.alerts || [];
              }
            }
          } catch (aiErr: any) {
            console.warn("[valentina/messages] Vertex AI erro:", aiErr?.message);
          }

          // ── Fallback amigável quando a IA não responder ─────────────────────
          if (fragments.length === 0) {
            fragments = [
              {
                text: useManagerContext
                  ? `Estou com dificuldade para processar sua solicitação agora. Por favor, tente novamente em instantes. Se o problema persistir, verifique se o serviço de IA está configurado corretamente.`
                  : `Deu uma oscilada rápida aqui na consulta 😅 Pode me mandar de novo?`,
              },
            ];
          }

          // ── Pós-processamento: fragmentação natural em balões curtos + conversas citadas ──
          if (!useManagerContext) {
            fragments = splitIntoNaturalFragments(fragments, operatorName, alreadyTalkingToday);
          }

          const fullReplyText = fragments.map((f) => f.text).join("\n");
          const relatedConversations = !useManagerContext
            ? resolveRelatedConversations(
                mentionedConversationIds,
                fullReplyText,
                userText,
                operatorContextResult
              )
            : [];

          // ── Salva fragmentos no banco ───────────────────────────────────────
          const savedFragments: any[] = [];
          for (let i = 0; i < fragments.length; i++) {
            const frag = fragments[i];
            const isLastFrag = i === fragments.length - 1;
            const fragRelated =
              isLastFrag && relatedConversations.length > 0 ? relatedConversations : undefined;
            const fragId = `val-ai-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
            const fragTimestamp = new Date(now.getTime() + 500 + i * 650);

            await db.insert(internalMessages).values({
              id: fragId,
              tenantId,
              operatorId,
              direction: "from_agent",
              agentType: "supervisor",
              content: frag.text,
              metadata: {
                isChat: true,
                scope,
                fragmentIndex: i,
                totalFragments: fragments.length,
                blocks: frag.blocks || undefined,
                relatedConversations: fragRelated,
                isManager: useManagerContext,
              },
              read: 0,
              createdAt: fragTimestamp,
            });

            savedFragments.push({
              id: fragId,
              content: frag.text,
              blocks: frag.blocks || undefined,
              relatedConversations: fragRelated,
              direction: "from_agent",
              createdAt: fragTimestamp,
            });
          }

          return new Response(
            JSON.stringify({
              success: true,
              userMessage: { id: userMsgId, content: userText, direction: "to_agent", createdAt: now },
              fragments: savedFragments.map((f, i) => ({
                ...f,
                delay: fragments[i]?.delay ?? i * 650,
              })),
              alerts,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

