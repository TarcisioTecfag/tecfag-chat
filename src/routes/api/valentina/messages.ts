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
  tasks,
} from "../../../db/schema";
import { eq, and, desc, asc, sql, gte, isNull, ne, count, or, inArray, ilike } from "drizzle-orm";
import crypto from "crypto";
import { getAiPersona } from "../../../lib/ai-persona";
import { requireSession } from "../../../lib/auth-session";
import { getCommercialHome } from "../../../lib/commercial/home-service";
import { getKnowledgeBaseContext } from "../../../lib/valentina/knowledge-service";
import type { MultimodalPart } from "../../../lib/vertex-ai";

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
async function getOperatorContext(
  tenantId: string,
  operatorId: string,
  operatorEmail?: string | null,
  userQuery?: string
): Promise<string> {
  try {
    const sections: string[] = [];

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

    // ── 4. CONVERSAS ATIVAS E CLIENTES AGUARDANDO RESPOSTA (SLA) ─────────────
    const activeConvs = await db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        contactCompany: contacts.company,
        contactInterest: contacts.interest,
        contactTemperature: contacts.temperature,
        lastMessage: conversations.lastMessageText,
        lastTime: conversations.lastMessageTime,
        queueState: conversations.queueState,
        unread: conversations.unreadCount,
        value: conversations.value,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.operatorId, operatorId),
          ne(conversations.queueState, "finalizados")
        )
      )
      .orderBy(desc(conversations.lastMessageTime))
      .limit(25);

    if (activeConvs.length > 0) {
      // Verifica em cada conversa de "meus" quem mandou a última mensagem
      const waitingClients: string[] = [];
      const convLines: string[] = [];

      for (const c of activeConvs) {
        const agoMin = Math.max(0, Math.floor((Date.now() - new Date(c.lastTime).getTime()) / 60_000));
        const companyInfo = c.contactCompany ? ` [${c.contactCompany}]` : "";
        const interestInfo = c.contactInterest ? ` | Interesse: ${c.contactInterest}` : "";
        const tempInfo = c.contactTemperature ? ` | Temp: ${c.contactTemperature}` : "";

        const [lastMsg] = await db
          .select({
            sender: messages.sender,
            content: messages.content,
            timestamp: messages.timestamp,
          })
          .from(messages)
          .where(and(eq(messages.conversationId, c.id), eq(messages.tenantId, tenantId)))
          .orderBy(desc(messages.timestamp))
          .limit(1);

        const isClientWaiting = lastMsg?.sender === "client" && c.queueState === "meus";
        const waitMinutes =
          isClientWaiting && lastMsg?.timestamp
            ? Math.max(0, Math.floor((Date.now() - new Date(lastMsg.timestamp).getTime()) / 60_000))
            : agoMin;

        if (isClientWaiting) {
          const slaTag =
            waitMinutes >= 15
              ? "🚨 SLA ESTOURADO (>15min)"
              : waitMinutes >= 8
              ? "⚠️ ATENÇÃO SLA (8-14min)"
              : "⏳ Aguardando resposta";
          waitingClients.push(
            `  • ${c.contactName}${companyInfo} — esperando há ${waitMinutes}min (${slaTag})${interestInfo}: "${(lastMsg?.content || c.lastMessage || "").slice(0, 100)}"`
          );
        }

        convLines.push(
          `  • ${c.contactName}${companyInfo} (Fila: ${c.queueState}${isClientWaiting ? ` | ⏳ Cliente aguarda há ${waitMinutes}min` : " | ✅ Respondido"}) — última msg há ${agoMin}min${c.unread > 0 ? ` [${c.unread} não lida(s)]` : ""}${interestInfo}${tempInfo}: "${(c.lastMessage || "").slice(0, 90)}"`
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
      sections.push("💬 Você não tem conversas ativas em andamento no momento.");
    }

    // ── 5. BUSCA PROFUNDA SOB DEMANDA (CLIENTE / CONVERSA / NEGOCIAÇÃO) + GUARDA DE SIGILO ──
    const searchTerms = extractSearchCandidateTerms(userQuery);
    if (searchTerms.length > 0) {
      try {
        // 5.1 Verifica nas conversas e deals do PRÓPRIO operador se algum termo bate com nome de cliente/empresa/negociação
        const matchedConvs = activeConvs.filter((c) => {
          const hay = `${c.contactName || ""} ${c.contactCompany || ""} ${c.contactInterest || ""}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
          return searchTerms.some((t) => hay.includes(t));
        });

        // Se não achou nas ativas, procura também nas finalizadas do PRÓPRIO operador
        let extraOwnConvs: typeof activeConvs = [];
        if (matchedConvs.length === 0) {
          const likeFilters = searchTerms.map((t) => ilike(contacts.name, `%${t}%`));
          extraOwnConvs = await db
            .select({
              id: conversations.id,
              contactId: conversations.contactId,
              contactName: contacts.name,
              contactPhone: contacts.phone,
              contactCompany: contacts.company,
              contactInterest: contacts.interest,
              contactTemperature: contacts.temperature,
              lastMessage: conversations.lastMessageText,
              lastTime: conversations.lastMessageTime,
              queueState: conversations.queueState,
              unread: conversations.unreadCount,
              value: conversations.value,
            })
            .from(conversations)
            .innerJoin(contacts, eq(contacts.id, conversations.contactId))
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                eq(conversations.operatorId, operatorId),
                or(...likeFilters)
              )
            )
            .orderBy(desc(conversations.lastMessageTime))
            .limit(3);
        }

        const targetConvs = [...matchedConvs, ...extraOwnConvs].slice(0, 2);
        if (targetConvs.length > 0) {
          const deepDetails: string[] = [];
          for (const tc of targetConvs) {
            const recentMsgs = await db
              .select({
                sender: messages.sender,
                content: messages.content,
                mediaInterpretation: messages.mediaInterpretation,
                timestamp: messages.timestamp,
              })
              .from(messages)
              .where(and(eq(messages.conversationId, tc.id), eq(messages.tenantId, tenantId)))
              .orderBy(desc(messages.timestamp))
              .limit(12);

            const orderedMsgs = recentMsgs.reverse();
            const transcript = orderedMsgs
              .map((m) => {
                const hora = m.timestamp
                  ? new Date(m.timestamp).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";
                const who = m.sender === "client" ? "Cliente" : m.sender === "bot" ? "IA Triagem" : "Você";
                const txt = (m.content || m.mediaInterpretation || "[Mídia]").slice(0, 180);
                return `    [${hora}] ${who}: ${txt}`;
              })
              .join("\n");

            deepDetails.push(
              `  📌 Cliente: ${tc.contactName}${tc.contactCompany ? ` (${tc.contactCompany})` : ""} | Fila: ${tc.queueState} | Interesse: ${tc.contactInterest || "N/A"}\n  Últimas mensagens da conversa:\n${transcript}`
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
            .innerJoin(contacts, eq(contacts.id, conversations.contactId))
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

    // ── 7. BASE DE CONHECIMENTO / CATÁLOGO DE MÁQUINAS E PRODUTOS ────────────
    try {
      const kbContext = await getKnowledgeBaseContext(tenantId, userQuery);
      if (kbContext) {
        sections.push(kbContext);
      }
    } catch {
      // fallback silencioso se base de conhecimento falhar
    }

    return sections.join("\n\n");
  } catch (err: any) {
    console.error("[getOperatorContext] Erro:", err);
    return "⚠️ Não foi possível carregar dados operacionais neste momento.";
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
  userMessage: string
): string {
  const isMale = persona.gender === "male";
  const partnerRole = isMale ? "parceiro e copiloto comercial" : "parceira e copiloto comercial";

  return `Você é ${persona.name}, ${partnerRole} de vendas e atendimento da ${persona.company}.
Você acompanha ${operatorName} (consultor(a)/vendedor(a)) durante todo o dia a dia comercial.

## SEU PAPEL NO DIA A DIA DO VENDEDOR:
Você NÃO é um suporte de T.I. (nunca fale em "chamados de T.I." ou "tickets"). Você é um copiloto comercial afiado, prestativo e parceiro que ajuda ${operatorName} com:
1. **Metas e Ritmo Comercial**: Quanto falta para bater a meta do mês, quanto já vendeu, qual a meta diária necessária e quantos dias úteis restam.
2. **Tarefas, Reuniões e Diretrizes do Gestor**: Quais tarefas estão pendentes para hoje ou atrasadas e quais orientações o gestor deixou nas negociações.
3. **Ligações Agendadas**: Quais ligações e follow-ups ${operatorName} precisa fazer hoje.
4. **Negociações (CRM) Abertas e Negociações Paradas/Esfriando**: Quais orçamentos/deals estão em aberto, quais estão parados há 3+ dias sem interação (esfriando) e precisam de retomada urgente.
5. **Clientes e Conversas Ativas / SLA**: Quais clientes foram transferidos recentemente, quais estão aguardando resposta no WhatsApp (e há quantos minutos), resumo do que o cliente falou e sugestões de mensagens de abordagem, contorno de objeções ou follow-up.
6. **Dúvidas Técnicas de Produtos/Máquinas**: Especificações técnicas do catálogo da ${persona.company} para ajudar ${operatorName} a responder rápido ao cliente.

## 🔒 REGRAS INVIOLÁVEIS DE SIGILO E SEGURANÇA (RBAC):
- Você tem acesso EXCLUSIVO à carteira, metas, tarefas, clientes e negociações de **${operatorName}**.
- **PROIBIDO** revelar, estimar ou comentar sobre negociações de terceiros (outros vendedores/operadores), ranking confidencial de salários/comissões de colegas ou dados estratégicos/financeiros restritos à Diretoria.
- Se ${operatorName} perguntar sobre um cliente/negociação de outro vendedor ou sobre dados exclusivos da diretoria, recuse com educação e naturalidade explicando que, por política de sigilo comercial da ${persona.company}, você acompanha exclusivamente a carteira e os atendimentos de ${operatorName}.
- Use SEMPRE os dados reais fornecidos abaixo. Nunca invente valores, nomes de clientes ou tarefas que não estejam listados no contexto.

## DADOS COMERCIAIS E OPERACIONAIS DE ${operatorName.toUpperCase()} AGORA:
${operatorContext}
${fileContext}

${chatHistoryText ? `## HISTÓRICO RECENTE DA CONVERSA COM ${operatorName.toUpperCase()}:\n${chatHistoryText}\n` : ""}
## MENSAGEM ATUAL DE ${operatorName.toUpperCase()}:
"${userMessage}"

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON):
Responda diretamente à mensagem atual de ${operatorName} de forma natural, organizada (use tópicos/bullet points quando listar negociações, tarefas ou clientes) e prática:
{
  "fragments": [
    {
      "text": "sua resposta completa, direta e útil para o vendedor",
      "delay": 0
    }
  ]
}`;
}

export const Route = createFileRoute("/api/valentina/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Carrega histórico de mensagens + alertas proativos (transferência e SLA) ──
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
            .limit(12);

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

          const operationalContext = useManagerContext
            ? await getManagerContext(contextTenantId)
            : await getOperatorContext(contextTenantId, operatorId, operatorEmail, userText);

          // ── Seleciona o prompt correto (incluindo histórico + pergunta atual!) ──
          const systemPrompt = useManagerContext
            ? buildSupervisorPrompt(persona, operatorName, operationalContext, fileContext, chatHistoryText, userText)
            : buildColeaguePrompt(persona, operatorName, operationalContext, fileContext, chatHistoryText, userText);

          // ── Feature key para rastreamento de custos ─────────────────────────
          const featureKey = useManagerContext ? "supervisor_chat" : persona.chatFeatureKey;

          // ── Chama o Vertex AI (suportando imagem anexada quando houver) ─────
          let fragments: { text: string; delay?: number; blocks?: any[] }[] = [];
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
                alerts?: any[];
              }>(promptInput, "gemini-2.5-pro", undefined, {
                tenantId,
                feature: featureKey,
                metadata: { operatorId, operatorName, scope, isManager: useManagerContext },
              });

              if (aiRes?.fragments && aiRes.fragments.length > 0) {
                fragments = aiRes.fragments;
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
                  : `Tive uma oscilação rápida aqui para consultar seus dados 😅 Pode mandar de novo?`,
              },
            ];
          }

          // ── Salva fragmentos no banco ───────────────────────────────────────
          const savedFragments: any[] = [];
          for (let i = 0; i < fragments.length; i++) {
            const frag = fragments[i];
            const fragId = `val-ai-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
            const fragTimestamp = new Date(now.getTime() + 600 + i * 500);

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
                isManager: useManagerContext,
              },
              read: 0,
              createdAt: fragTimestamp,
            });

            savedFragments.push({
              id: fragId,
              content: frag.text,
              blocks: frag.blocks || undefined,
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
                delay: fragments[i]?.delay || i * 600,
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

