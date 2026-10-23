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
  crmDealContacts,
  crmConversationDeals,
  tasks,
} from "../../../db/schema";
import { eq, and, desc, asc, sql, gte, isNull, ne, count, or, inArray, ilike } from "drizzle-orm";
import crypto from "crypto";
import { getAiPersona } from "../../../lib/ai-persona";
import { requireSession } from "../../../lib/auth-session";
import { getCommercialHome } from "../../../lib/commercial/home-service";
import { getKnowledgeBaseContext } from "../../../lib/valentina/knowledge-service";
import { getDirectorBiContext } from "../../../lib/valentina/director-bi-context";
import {
  buildAgenticThoughtTrace,
  isCasualConversationQuery,
  type AgenticThoughtStep,
  type AgenticThoughtTraceData,
} from "../../../lib/valentina/agentic-thought-trace";
import { SessionManager } from "../../../lib/baileys/session-manager";
import type { MultimodalPart } from "../../../lib/vertex-ai";
import type {
  RelatedConversationItem,
  RelatedDealItem,
  RelatedCallActionItem,
} from "../../../lib/mockData";

// ── Emissor de Telemetria Real via SSE para a Árvore Agêntica ────────────────
function emitRealTimeThoughtProgress(params: {
  tenantId: string;
  operatorId: string;
  scope: "admin" | "operator";
  taskTitle: string;
  finishedTitle: string;
  startedAtMs: number;
  steps: AgenticThoughtStep[];
}) {
  try {
    const trace: AgenticThoughtTraceData = {
      taskTitle: params.taskTitle,
      finishedTitle: params.finishedTitle,
      totalDurationSeconds: Math.max(1, Math.round((Date.now() - params.startedAtMs) / 1000)),
      scope: params.scope,
      isRealTimeStream: true,
      steps: params.steps,
    };
    SessionManager.getInstance().notifyPublic(params.tenantId, {
      type: "valentina_thought_progress",
      tenantId: params.tenantId,
      operatorId: params.operatorId,
      scope: params.scope,
      trace,
    });
  } catch {}
}

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
  "outra", "outras", "outro", "outros", "mais", "algum", "alguma", "alguns", "algumas",
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

function extractPhoneFromCustomFields(cf: any): string | null {
  if (!cf || typeof cf !== "object") return null;
  for (const [k, v] of Object.entries(cf)) {
    if (typeof v === "string" && /fone|tel|cel|whats|contato/i.test(k)) {
      const digits = v.replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 13) return v.trim();
    }
  }
  return null;
}

function normalizeForMatch(value?: string | null): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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
  knownDeals: RelatedDealItem[];
  scheduledCallActions: RelatedCallActionItem[];
  executedSteps: AgenticThoughtStep[];
  taskTitle: string;
  finishedTitle: string;
  isCasual: boolean;
  isThirdPartyBlocked: boolean;
}

async function getOperatorContext(
  tenantId: string,
  operatorId: string,
  operatorEmail?: string | null,
  userQuery?: string,
  recentAiContextText?: string,
  onProgress?: (steps: AgenticThoughtStep[], taskTitle: string, finishedTitle: string) => void
): Promise<OperatorContextResult> {
  const sections: string[] = [];
  const knownConvMap = new Map<string, RelatedConversationItem>();
  const waitingConversations: RelatedConversationItem[] = [];
  const todayLeadsConversations: RelatedConversationItem[] = [];
  const knownDealMap = new Map<string, RelatedDealItem>();
  const scheduledCallActions: RelatedCallActionItem[] = [];
  const executedSteps: AgenticThoughtStep[] = [];
  let isThirdPartyBlocked = false;

  const isCasual = isCasualConversationQuery(userQuery || "");
  if (isCasual) {
    return {
      contextText:
        "💬 MENSAGEM CASUAL / CONFIRMAÇÃO RÁPIDA DO VENDEDOR: Responda em 1 único balão curto e natural (máximo 1 frase), sem listar negociações, sem sugerir clientes e mantendo os arrays mentionedDealIds, suggestedCallDealIds e mentionedConversationIds vazios ([]).",
      knownConversations: [],
      waitingConversations: [],
      todayLeadsConversations: [],
      knownDeals: [],
      scheduledCallActions: [],
      executedSteps: [],
      taskTitle: "Respondendo mensagem",
      finishedTitle: "Resposta direta enviada",
      isCasual: true,
      isThirdPartyBlocked: false,
    };
  }

  const q = normalizeForMatch(userQuery || "");
  const primaryTerms = extractSearchCandidateTerms(userQuery);
  const isFollowUpRequest =
    /\b(?:puxe|puxar|detalhe|detalhes|link|botao|abrir|abre|ela|elas|essa|esse|recomende|especifico|fechar\s+hoje|ligar|outra|outras|outro|outros)\b/i.test(
      q
    );

  // Classificação de intenção real para consultar apenas o que é necessário
  const isOverviewOrGeneral =
    /\b(?:resumo|panorama|geral|tudo|meu dia|como estou|prioridade|prioridades|bom dia|boa tarde|boa noite|oi|ola)\b/.test(
      q
    );
  const isCallOrPhone =
    /\b(?:ligar|ligacao|ligacoes|telefone|fone|celular|contato|vigos|discar)\b/.test(q);
  const isDealOrCrm =
    /\b(?:negociac|card|proposta|orcamento|funil|parada|esfriando|aberta|valor|cliente|empresa|fechar|venda|outra|outras|outro|outros)\b/.test(
      q
    );
  const isGoalOrMeta = /\b(?:meta|metas|ritmo|pacing|falta|vendi|ganh|comiss|faturamento|diretriz)\b/.test(q);
  const isTaskOrAgenda = /\b(?:tarefa|tarefas|agenda|compromisso|reuniao|reunioes|pendente|atrasad|follow)\b/.test(q);
  const isWaitingChat =
    /\b(?:esperando|aguardando|fila|conversa|conversas|chat|whatsapp|responder|atraso|sla|lead|leads|chegaram|chegou|hoje)\b/.test(
      q
    );
  const isMetricsQuery = /\b(?:metrica|metricas|tma|tempo medio|tempo de resposta|score|nota|desempenho)\b/.test(q);
  const isKbQuery =
    /\b(?:maquina|maquinas|equipamento|modelo|especificac|catalogo|voltagem|potencia|seladora|envasadora|rotuladora|datador|empacotadora|valvula|frasco|pote|tampa)\b/.test(
      q
    );

  let taskTitle = "Consultando dados da sua operação";
  let finishedTitle = "Consulta comercial concluída";

  if (isCallOrPhone) {
    taskTitle = "Localizando telefones e preparando ações de ligação";
    finishedTitle = "Telefones e atalhos de discagem localizados";
  } else if (isDealOrCrm || primaryTerms.length > 0) {
    taskTitle = "Consultando negociações da sua carteira no CRM";
    finishedTitle = "Análise das negociações do CRM concluída";
  } else if (isGoalOrMeta) {
    taskTitle = "Calculando atingimento da sua meta mensal e ritmo";
    finishedTitle = "Cálculo de meta e pacing comercial concluído";
  } else if (isTaskOrAgenda) {
    taskTitle = "Verificando suas tarefas, ligações e agenda do dia";
    finishedTitle = "Verificação de agenda e tarefas concluída";
  } else if (isWaitingChat) {
    taskTitle = "Verificando clientes aguardando resposta na sua fila";
    finishedTitle = "Inspeção da sua fila de atendimento concluída";
  }

  const shouldRunGoals =
    isOverviewOrGeneral || isGoalOrMeta || (!isCallOrPhone && !isWaitingChat && !isTaskOrAgenda && primaryTerms.length === 0);
  const shouldRunDeals =
    isOverviewOrGeneral || isDealOrCrm || isCallOrPhone || isFollowUpRequest || primaryTerms.length > 0 || !isWaitingChat;
  const shouldRunTasks =
    isOverviewOrGeneral || isTaskOrAgenda || isCallOrPhone;
  const shouldRunChats =
    isOverviewOrGeneral || isWaitingChat || isCallOrPhone || primaryTerms.length > 0 || isFollowUpRequest;
  const shouldRunMetrics = isOverviewOrGeneral || isMetricsQuery;
  const shouldRunKb = isKbQuery;

  const pushRealStep = (step: AgenticThoughtStep) => {
    executedSteps.push(step);
    onProgress?.([...executedSteps], taskTitle, finishedTitle);
  };

  pushRealStep({
    id: "step-op-thought-1",
    kind: "thought",
    actionVerb: "Pensou por 1s",
    targetLabel: "Selecionando consultas necessárias para responder à sua pergunta",
    durationSeconds: 1,
    detailText: `Analisando "${(userQuery || "").slice(0, 80)}" para consultar apenas as tabelas relevantes da sua carteira.`,
  });

  try {
    // ── 1. META DO MÊS, RITMO (PACING) E DIRETRIZES DO GESTOR ────────────────
    if (shouldRunGoals) {
      const t0 = Date.now();
      try {
        const home = await getCommercialHome(tenantId, operatorId);
        const homeMs = Math.max(12, Date.now() - t0);
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

        pushRealStep({
          id: "step-op-home",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "getCommercialHome",
          scopeTag: `#meta-e-pacing • ${homeMs}ms`,
          badgeType: "crm",
          detailText: `Meta mensal, realizado (${formatBrl(g.realizedValue)}) e ${home.deals.openCount} negociações no pipeline verificados em ${homeMs}ms.`,
        });
      } catch (homeErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar getCommercialHome:", homeErr?.message);
      }
    }

    // ── 2. NEGOCIAÇÕES (CRM DEALS) ABERTAS & NEGOCIAÇÕES PARADAS / ESFRIANDO ──
    if (shouldRunDeals) {
      const tDeals0 = Date.now();
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
            accountId: crmDeals.accountId,
            accountName: crmAccounts.name,
            accountPhone: crmAccounts.phone,
            accountEmail: crmAccounts.email,
            accountDocument: crmAccounts.document,
            customFields: crmDeals.customFields,
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
          .limit(60);

        if (operatorDeals.length > 0) {
          const dealIds = operatorDeals.map((d) => d.id);
          const accountIds = Array.from(
            new Set(operatorDeals.map((d) => d.accountId).filter((v): v is string => Boolean(v)))
          );

          const dealContactMap = new Map<string, { contactId: string; name: string; phone: string | null }>();
          const accountContactMap = new Map<string, { contactId: string; name: string; phone: string | null }>();
          const dealConvMap = new Map<string, string>();
          const contactConvMap = new Map<string, string>();

          try {
            const dcRows = await db
              .select({
                dealId: crmDealContacts.dealId,
                isPrimary: crmDealContacts.isPrimary,
                contactId: contacts.id,
                contactName: contacts.name,
                contactPhone: contacts.phone,
              })
              .from(crmDealContacts)
              .innerJoin(contacts, and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId)))
              .where(and(eq(crmDealContacts.tenantId, tenantId), inArray(crmDealContacts.dealId, dealIds)));

            for (const row of dcRows) {
              const existing = dealContactMap.get(row.dealId);
              if (!existing || row.isPrimary || (!existing.phone && row.contactPhone)) {
                dealContactMap.set(row.dealId, {
                  contactId: row.contactId,
                  name: row.contactName,
                  phone: row.contactPhone || null,
                });
              }
            }
          } catch {}

          if (accountIds.length > 0) {
            try {
              const accContacts = await db
                .select({
                  id: contacts.id,
                  accountId: contacts.accountId,
                  name: contacts.name,
                  phone: contacts.phone,
                })
                .from(contacts)
                .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.accountId, accountIds)));

              for (const c of accContacts) {
                if (!c.accountId) continue;
                const existing = accountContactMap.get(c.accountId);
                if (!existing || (!existing.phone && c.phone)) {
                  accountContactMap.set(c.accountId, {
                    contactId: c.id,
                    name: c.name,
                    phone: c.phone || null,
                  });
                }
              }
            } catch {}
          }

          try {
            const convLinks = await db
              .select({
                dealId: crmConversationDeals.dealId,
                conversationId: crmConversationDeals.conversationId,
              })
              .from(crmConversationDeals)
              .where(
                and(
                  eq(crmConversationDeals.tenantId, tenantId),
                  inArray(crmConversationDeals.dealId, dealIds),
                  eq(crmConversationDeals.isActive, true)
                )
              );
            for (const cl of convLinks) {
              if (!dealConvMap.has(cl.dealId)) {
                dealConvMap.set(cl.dealId, cl.conversationId);
              }
            }
          } catch {}

          const allResolvedContactIds = Array.from(
            new Set([
              ...Array.from(dealContactMap.values()).map((v) => v.contactId),
              ...Array.from(accountContactMap.values()).map((v) => v.contactId),
            ])
          );
          if (allResolvedContactIds.length > 0) {
            try {
              const cConvs = await db
                .select({
                  id: conversations.id,
                  contactId: conversations.contactId,
                })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.tenantId, tenantId),
                    inArray(conversations.contactId, allResolvedContactIds)
                  )
                )
                .orderBy(desc(conversations.lastMessageTime));
              for (const cc of cConvs) {
                if (!contactConvMap.has(cc.contactId)) {
                  contactConvMap.set(cc.contactId, cc.id);
                }
              }
            } catch {}
          }

          const dealsMissingPhoneNames = operatorDeals
            .filter((d) => {
              const dc = dealContactMap.get(d.id);
              const ac = d.accountId ? accountContactMap.get(d.accountId) : undefined;
              return !dc?.phone && !ac?.phone && !d.accountPhone && d.accountName;
            })
            .map((d) => d.accountName!)
            .slice(0, 20);

          const namePhoneFallbackMap = new Map<string, { contactId: string; phone: string }>();
          if (dealsMissingPhoneNames.length > 0) {
            try {
              const nameMatchedContacts = await db
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  phone: contacts.phone,
                })
                .from(contacts)
                .where(
                  and(
                    eq(contacts.tenantId, tenantId),
                    inArray(contacts.name, dealsMissingPhoneNames)
                  )
                );
              for (const nm of nameMatchedContacts) {
                if (nm.phone) {
                  namePhoneFallbackMap.set(nm.name.toLowerCase(), {
                    contactId: nm.id,
                    phone: nm.phone,
                  });
                }
              }
            } catch {}
          }

          const normRecentAi = normalizeForMatch(recentAiContextText || "");
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

            const dc = dealContactMap.get(d.id);
            const ac = d.accountId ? accountContactMap.get(d.accountId) : undefined;
            const nameFallback = d.accountName ? namePhoneFallbackMap.get(d.accountName.toLowerCase()) : undefined;
            const cfPhone = extractPhoneFromCustomFields(d.customFields);

            const contactName = dc?.name || ac?.name || d.accountName || null;
            const contactPhone = dc?.phone || ac?.phone || d.accountPhone || nameFallback?.phone || cfPhone || null;
            const contactId = dc?.contactId || ac?.contactId || nameFallback?.contactId || null;
            const conversationId =
              dealConvMap.get(d.id) || (contactId ? contactConvMap.get(contactId) : undefined) || null;

            const numValue = Number(d.value || 0);
            const valueFormatted = numValue > 0 ? formatBrl(numValue) : "R$ 0,00";
            const stageLabel = [d.pipelineName, d.stageName].filter(Boolean).join(" › ") || null;

            const codeMatch = (d.title || "").match(/\b(\d{4,})\b/)?.[1];
            const normAcc = normalizeForMatch(d.accountName || "");
            const normTitle = normalizeForMatch(d.title || "");
            const alreadyMentionedRecently = Boolean(
              normRecentAi &&
                ((codeMatch && normRecentAi.includes(codeMatch)) ||
                  (normAcc.length >= 4 && normRecentAi.includes(normAcc)) ||
                  (normTitle.length >= 5 && normRecentAi.includes(normTitle)))
            );

            const dealItem: RelatedDealItem = {
              dealId: d.id,
              title: d.title,
              value: numValue,
              valueFormatted,
              stageName: d.stageName || null,
              pipelineName: d.pipelineName || null,
              stageLabel,
              accountName: d.accountName || null,
              company: d.accountName || null,
              contactName,
              contactPhone,
              conversationId,
              daysIdle,
              status: d.status,
            };
            knownDealMap.set(d.id, dealItem);

            return {
              ...d,
              numValue,
              daysIdle,
              coolingThreshold,
              isStalled,
              isCoolingCritical,
              refDate,
              contactName,
              contactPhone,
              conversationId,
              alreadyMentionedRecently,
            };
          });

          // Prioriza negociações paradas que AINDA NÃO foram citadas nas últimas mensagens da conversa, evitando repetir sempre a mesma (ex: BOLOS & BOLOS)
          const stalledDeals = enrichedDeals
            .filter((d) => d.isStalled)
            .sort((a, b) => {
              if (a.alreadyMentionedRecently !== b.alreadyMentionedRecently) {
                return a.alreadyMentionedRecently ? 1 : -1;
              }
              return b.daysIdle - a.daysIdle || b.numValue - a.numValue;
            });

          const asksAboutStalledOrDeals =
            isOverviewOrGeneral || isDealOrCrm || isCallOrPhone || isFollowUpRequest;

          if (asksAboutStalledOrDeals) {
            if (stalledDeals.length > 0) {
              const stalledLines = stalledDeals
                .slice(0, 15)
                .map((d) => {
                  const badge = d.isCoolingCritical
                    ? "❄️ ESFRIANDO / PARADA CRÍTICA"
                    : "⚠️ SEM INTERAÇÃO RECENTE";
                  const recentTag = d.alreadyMentionedRecently
                    ? " [JÁ CITADA NAS ÚLTIMAS MENSAGENS — NÃO REPITA SE O VENDEDOR PEDIR OUTRAS]"
                    : " [NOVA OPÇÃO — AINDA NÃO CITADA]";
                  const acc = d.accountName ? ` | Cliente/Conta: ${d.accountName}` : "";
                  const phonePart = d.contactPhone ? ` | 📞 Tel: ${d.contactPhone}` : "";
                  const convPart = d.conversationId ? ` | convId: ${d.conversationId}` : "";
                  return `  • [${badge} — ${d.daysIdle} dia(s) sem movimentação]${recentTag} "${d.title}"${acc} | Valor: ${formatBrl(d.numValue)} | Funil/Etapa: ${d.pipelineName || "Geral"} > ${d.stageName || "N/A"}${phonePart} (dealId: ${d.id}${convPart})`;
                })
                .join("\n");
              sections.push(
                `❄️ SUAS NEGOCIAÇÕES PARADAS / ESFRIANDO (${stalledDeals.length} de ${enrichedDeals.length} abertas — USE APENAS SE O VENDEDOR PERGUNTAR SOBRE NEGOCIAÇÕES, PRIORIDADES OU FOLLOW-UP):\n${stalledLines}`
              );
            } else {
              sections.push(
                `❄️ NEGOCIAÇÕES PARADAS / ESFRIANDO: Parabéns! Nenhuma das suas ${enrichedDeals.length} negociações abertas está parada há 3+ dias.`
              );
            }
          }

          const activeDealLines = enrichedDeals
            .slice(0, 25)
            .map((d) => {
              const acc = d.accountName ? ` (${d.accountName})` : "";
              const phonePart = d.contactPhone ? ` | 📞 Tel: ${d.contactPhone}` : "";
              const closePart = d.expectedCloseDate
                ? ` | Prev. Fechamento: ${new Date(d.expectedCloseDate).toLocaleDateString("pt-BR")}`
                : "";
              const convPart = d.conversationId ? ` | convId: ${d.conversationId}` : "";
              const recentTag = d.alreadyMentionedRecently ? " [JÁ CITADA RECENTEMENTE]" : "";
              return `  • "${d.title}"${acc}${recentTag} — ${formatBrl(d.numValue)} | Etapa: ${d.stageName || "N/A"} (${d.pipelineName || "Funil"}) | Parada há: ${d.daysIdle}d${phonePart}${closePart}${d.status === "paused" ? " [PAUSADA]" : ""} (dealId: ${d.id}${convPart})`;
            })
            .join("\n");
          sections.push(`💼 SUAS NEGOCIAÇÕES EM ABERTO NO CRM (${enrichedDeals.length}):\n${activeDealLines}`);

          const dealsMs = Math.max(15, Date.now() - tDeals0);
          pushRealStep({
            id: "step-op-deals",
            kind: "analyze",
            actionVerb: "Analisou",
            targetLabel: "crm_deals & crm_accounts",
            scopeTag: `#${enrichedDeals.length}-negociacoes • ${dealsMs}ms`,
            badgeType: "crm",
            detailText: `${enrichedDeals.length} negociações abertas (${stalledDeals.length} paradas/esfriando) e contatos vinculados inspecionados no banco em ${dealsMs}ms.`,
          });
        } else {
          sections.push(`💼 SUAS NEGOCIAÇÕES NO CRM: Você não possui negociações abertas vinculadas ao seu usuário no momento.`);
          const dealsMs = Math.max(10, Date.now() - tDeals0);
          pushRealStep({
            id: "step-op-deals",
            kind: "analyze",
            actionVerb: "Analisou",
            targetLabel: "crm_deals",
            scopeTag: `#0-negociacoes • ${dealsMs}ms`,
            badgeType: "crm",
            detailText: `Consulta concluída em ${dealsMs}ms — 0 negociações abertas encontradas.`,
          });
        }
      } catch (dealErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar negociações do operador:", dealErr?.message);
      }
    }

    // ── 3. TAREFAS, LIGAÇÕES AGENDADAS E REUNIÕES DO OPERADOR ────────────────
    if (shouldRunTasks) {
      const tTasks0 = Date.now();
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
          const linkedDeal = a.dealId ? knownDealMap.get(a.dealId) : undefined;
          const phoneStr = linkedDeal?.contactPhone ? ` | 📞 Tel: ${linkedDeal.contactPhone}` : "";
          const dealPart = a.dealTitle
            ? ` | Negociação: "${a.dealTitle}" (${formatBrl(Number(a.dealValue || 0))}${a.dealId ? `, dealId: ${a.dealId}` : ""})${phoneStr}`
            : "";
          const descPart = a.description ? ` — Obs: ${a.description.slice(0, 100)}` : "";
          return `  • [${tag} - ${dueStr}] ${a.title}${dealPart}${descPart}`;
        };

        const scheduledCalls = crmActivities.filter(
          (a) => a.type === "call" || /liga[cç][aã]o|ligar|call|telefonema/i.test(a.title)
        );
        const otherActivities = crmActivities.filter((a) => !scheduledCalls.includes(a));

        for (const sc of scheduledCalls) {
          const linkedDeal = sc.dealId ? knownDealMap.get(sc.dealId) : undefined;
          if (linkedDeal?.contactPhone) {
            scheduledCallActions.push({
              id: `sched-call-${sc.id}`,
              clientName: linkedDeal.contactName || linkedDeal.accountName || sc.title,
              phone: linkedDeal.contactPhone,
              company: linkedDeal.accountName || null,
              dealId: linkedDeal.dealId,
              dealTitle: linkedDeal.title,
              dealValue: linkedDeal.value ?? null,
              dealValueFormatted: linkedDeal.valueFormatted ?? null,
              stageLabel: linkedDeal.stageLabel ?? null,
              conversationId: linkedDeal.conversationId || null,
              reason: sc.title,
            });
          }
        }

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

        const tasksMs = Math.max(10, Date.now() - tTasks0);
        pushRealStep({
          id: "step-op-tasks",
          kind: "search",
          actionVerb: "Verificou",
          targetLabel: "tasks & crm_deal_activities",
          scopeTag: `#${callLines.length}-ligacoes • ${taskLines.length}-tarefas • ${tasksMs}ms`,
          badgeType: "sla",
          detailText: `${callLines.length} ligações agendadas e ${taskLines.length} tarefas/reuniões pendentes consultadas em ${tasksMs}ms.`,
        });
      } catch (taskErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar tarefas/ligações:", taskErr?.message);
      }
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
      lastClientMsg: Date | null;
      lastOpMsg: Date | null;
      createdAt: Date;
      queueState: string;
      unread: number;
      dealTitle?: string | null;
      funnelName?: string | null;
    }> = [];

    if (shouldRunChats) {
      const tConvs0 = Date.now();
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
            lastClientMsg: conversations.lastClientMessageAt,
            lastOpMsg: conversations.lastOperatorMessageAt,
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

        const brtNowStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
        const startOfToday = new Date(`${brtNowStr}T00:00:00-03:00`);

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
              clientPhone: meta.clientPhone || meta.phone || null,
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
            const phoneInfo = c.contactPhone ? ` | 📞 Tel: ${c.contactPhone}` : "";

            // Usa lastClientMessageAt e lastOperatorMessageAt direto da tabela conversations (zero N+1 queries!)
            const clientMsgMs = c.lastClientMsg ? new Date(c.lastClientMsg).getTime() : 0;
            const opMsgMs = c.lastOpMsg ? new Date(c.lastOpMsg).getTime() : 0;
            const isClientWaiting =
              c.queueState === "meus" && clientMsgMs > 0 && (opMsgMs === 0 || clientMsgMs > opMsgMs);
            const waitMinutes = isClientWaiting
              ? Math.max(1, Math.floor((Date.now() - clientMsgMs) / 60_000))
              : agoMin;
            const cleanPreview = (c.lastMessage || "")
              .replace(/^\[(LOCAL_MEDIA|MEDIA):[^\]]+\]\s*/i, "[Mídia] ")
              .trim()
              .slice(0, 110);

            const convItem: RelatedConversationItem = {
              clientId: c.id,
              clientName: c.contactName,
              clientPhone: c.contactPhone || null,
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
                `  • [Iniciado hoje às ${hora}] ${c.contactName}${companyInfo}${dealInfo}${phoneInfo} (convId: ${c.id}): "${cleanPreview}"`
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
                `  • ${c.contactName}${companyInfo}${phoneInfo} (convId: ${c.id}) — esperando há ${waitMinutes}min (${slaTag})${dealInfo}: "${cleanPreview}"`
              );
            }

            convLines.push(
              `  • ${c.contactName}${companyInfo}${phoneInfo} (convId: ${c.id} | Fila: ${c.queueState}${isClientWaiting ? ` | ⏳ Cliente aguarda há ${waitMinutes}min` : " | ✅ Respondido"}) — última msg há ${agoMin}min${c.unread > 0 ? ` [${c.unread} não lida(s)]` : ""}${dealInfo}: "${cleanPreview}"`
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

        const convsMs = Math.max(10, Date.now() - tConvs0);
        pushRealStep({
          id: "step-op-convs",
          kind: "search",
          actionVerb: "Verificou",
          targetLabel: "conversations",
          scopeTag: `#${activeConvs.length}-ativas • ${waitingConversations.length}-aguardando • ${convsMs}ms`,
          badgeType: "chat",
          detailText: `${activeConvs.length} conversas ativas na fila (${waitingConversations.length} aguardando resposta e ${todayLeadsConversations.length} leads hoje) verificadas em ${convsMs}ms.`,
        });
      } catch (convErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar conversas ativas:", convErr?.message);
      }
    }

    // ── 5. BUSCA PROFUNDA SOB DEMANDA (NEGOCIAÇÕES DO CRM + CONVERSAS) + GUARDA DE SIGILO ──
    const fallbackAiTerms =
      isFollowUpRequest || primaryTerms.length === 0
        ? extractSearchCandidateTerms(recentAiContextText)
        : [];
    const searchTerms = Array.from(new Set([...primaryTerms, ...fallbackAiTerms])).slice(0, 6);

    if (searchTerms.length > 0 || knownDealMap.size > 0) {
      const tDeep0 = Date.now();
      try {
        const normCombinedContext = normalizeForMatch(`${userQuery || ""} ${isFollowUpRequest ? recentAiContextText || "" : ""}`);
        const matchedDeals = Array.from(knownDealMap.values()).filter((d) => {
          const hay = normalizeForMatch(`${d.title || ""} ${d.accountName || ""} ${d.contactName || ""}`);
          if (!hay) return false;
          const codeMatch = (d.title || "").match(/\b\d{4,}\b/)?.[0];
          if (codeMatch && normCombinedContext.includes(codeMatch)) return true;
          if (d.accountName && d.accountName.length >= 4 && normCombinedContext.includes(normalizeForMatch(d.accountName))) {
            return true;
          }
          return searchTerms.some((t) => t.length >= 4 && hay.includes(t));
        });

        if (matchedDeals.length > 0) {
          const dealDeepLines: string[] = [];
          for (const md of matchedDeals.slice(0, 3)) {
            const acts = await db
              .select({
                type: crmDealActivities.type,
                title: crmDealActivities.title,
                description: crmDealActivities.description,
                status: crmDealActivities.status,
                dueDate: crmDealActivities.dueDate,
                createdAt: crmDealActivities.createdAt,
              })
              .from(crmDealActivities)
              .where(and(eq(crmDealActivities.tenantId, tenantId), eq(crmDealActivities.dealId, md.dealId)))
              .orderBy(desc(crmDealActivities.createdAt))
              .limit(5);

            const actSummary =
              acts.length > 0
                ? acts
                    .map((a) => {
                      const dt = a.createdAt
                        ? new Date(a.createdAt).toLocaleDateString("pt-BR")
                        : "";
                      return `    - [${dt} | ${a.type} | ${a.status}] ${a.title}${a.description ? `: ${a.description.slice(0, 140)}` : ""}`;
                    })
                    .join("\n")
                : "    - Nenhuma atividade/nota detalhada registrada no histórico do card.";

            dealDeepLines.push(
              `  📌 Card CRM: "${md.title}" (dealId: ${md.dealId})\n` +
                `    • Cliente / Empresa: ${md.accountName || md.contactName || "Não informado"}\n` +
                `    • Contato: ${md.contactName || "Não informado"} | 📞 Telefone (VigosPhone): ${md.contactPhone || "Não cadastrado no card"}\n` +
                `    • Valor: ${formatBrl(Number(md.value || 0))} | Funil/Etapa: ${md.pipelineName || "Geral"} > ${md.stageName || "N/A"} | Parada há: ${md.daysIdle ?? 0} dia(s)\n` +
                `    • Conversa WhatsApp vinculada: ${md.conversationId ? `Sim (convId: ${md.conversationId})` : "Sem conversa recente ativa vinculada (inclua em mentionedDealIds para exibir o card unificado com botão do CRM e VigosPhone)"}\n` +
                `    • Histórico de atividades do card:\n${actSummary}`
            );
          }
          sections.push(
            `🔍 FICHA DETALHADA DA(S) NEGOCIAÇÃO(ÕES) DO CRM EM FOCO:\n${dealDeepLines.join("\n\n")}`
          );
        }

        if (searchTerms.length > 0) {
          const matchedConvs = activeConvs.filter((c) => {
            const hay = normalizeForMatch(`${c.contactName || ""} ${c.contactCompany || ""} ${c.dealTitle || ""}`);
            return searchTerms.some((t) => hay.includes(t));
          });

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
                lastClientMsg: conversations.lastClientMessageAt,
                lastOpMsg: conversations.lastOperatorMessageAt,
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
                  clientPhone: tc.contactPhone || null,
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
                `  📌 Cliente: ${tc.contactName}${tc.contactCompany ? ` (${tc.contactCompany})` : ""}${tc.contactPhone ? ` | 📞 Tel: ${tc.contactPhone}` : ""} (convId: ${tc.id}) | Fila: ${tc.queueState}${tc.dealTitle ? ` | Negociação: ${tc.dealTitle}` : ""}\n  Últimas mensagens da conversa:\n${transcript}`
              );
            }
            sections.push(`🔍 HISTÓRICO DETALHADO DO(S) CLIENTE(S) CONSULTADO(S):\n${deepDetails.join("\n\n")}`);
          }

          // 5.3 Guarda de Sigilo: Verifica se o termo buscado pertence a OUTRO operador
          if (targetConvs.length === 0 && matchedDeals.length === 0 && primaryTerms.length > 0) {
            const dealLikeFilters = primaryTerms.map((t) => ilike(crmDeals.title, `%${t}%`));
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

            const contactLikeFilters = primaryTerms.map((t) => ilike(contacts.name, `%${t}%`));
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
              isThirdPartyBlocked = true;
              const matchedNames = [
                ...thirdPartyDeals.map((d) => d.title),
                ...thirdPartyConvs.map((c) => c.contactName),
              ].slice(0, 3);
              sections.push(
                `🔒 ALERTA DE SIGILO COMERCIAL (DADOS DE TERCEIROS DETECTADOS NA PERGUNTA):\n` +
                  `  • O vendedor perguntou sobre "${matchedNames.join(", ")}", que pertence à carteira de OUTRO vendedor/operador.\n` +
                  `  • REGRA INVIOLÁVEL: Informe educadamente em 1 único balão curto que esse cliente/negociação está na carteira de outro consultor e que, por política de sigilo comercial, você só pode consultar clientes da carteira do próprio vendedor logado.\n` +
                  `  • PROIBIDO EMPURRAR OUTROS CARDS: NÃO sugira outras negociações aleatórias (como BOLOS & BOLOS ou JJL PLASTIC) quando bloquear uma consulta de terceiros, e deixe mentionedDealIds, suggestedCallDealIds e mentionedConversationIds vazios ([]).`
              );
            }
          }

          if (matchedDeals.length > 0 || targetConvs.length > 0 || isThirdPartyBlocked) {
            const deepMs = Math.max(10, Date.now() - tDeep0);
            pushRealStep({
              id: "step-op-deepsearch",
              kind: "search",
              actionVerb: "Buscou",
              targetLabel: `"${(primaryTerms.length > 0 ? primaryTerms : searchTerms).join(", ")}"`,
              scopeTag: isThirdPartyBlocked
                ? `#sigilo-rbac • ${deepMs}ms`
                : `#ficha-detalhada • ${deepMs}ms`,
              badgeType: "sql",
              detailText: isThirdPartyBlocked
                ? `Verificação de titularidade RBAC concluída em ${deepMs}ms (registro pertence a outra carteira).`
                : `Extração de histórico de atividades e mensagens para "${searchTerms.join(", ")}" concluída em ${deepMs}ms.`,
            });
          }
        }
      } catch (deepErr: any) {
        console.warn("[getOperatorContext] Aviso na busca profunda:", deepErr?.message);
      }
    }

    // ── 6. MÉTRICAS DE ATENDIMENTO DO DIA ────────────────────────────────────
    if (shouldRunMetrics) {
      const tMet0 = Date.now();
      try {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
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
          const metMs = Math.max(8, Date.now() - tMet0);
          pushRealStep({
            id: "step-op-metrics",
            kind: "query",
            actionVerb: "Consultou",
            targetLabel: "operator_daily_metrics",
            scopeTag: `#tma-${tma} • ${metMs}ms`,
            badgeType: "sla",
            detailText: `Métricas individuais de hoje lidas em ${metMs}ms.`,
          });
        }
      } catch (metricsErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar métricas do dia:", metricsErr?.message);
      }
    }

    // ── 7. BASE DE CONHECIMENTO / CATÁLOGO DE MÁQUINAS E PRODUTOS ────────────
    if (shouldRunKb) {
      const tKb0 = Date.now();
      try {
        const kbContext = await getKnowledgeBaseContext(tenantId, userQuery);
        if (kbContext) {
          sections.push(kbContext);
          const kbMs = Math.max(10, Date.now() - tKb0);
          pushRealStep({
            id: "step-op-kb",
            kind: "search",
            actionVerb: "Consultou",
            targetLabel: "knowledge_base",
            scopeTag: `#catalogo-tecnico • ${kbMs}ms`,
            badgeType: "kb",
            detailText: `Base de conhecimento técnico consultada em ${kbMs}ms.`,
          });
        }
      } catch {}
    }

    return {
      contextText: sections.join("\n\n"),
      knownConversations: Array.from(knownConvMap.values()),
      waitingConversations,
      todayLeadsConversations,
      knownDeals: Array.from(knownDealMap.values()),
      scheduledCallActions,
      executedSteps,
      taskTitle,
      finishedTitle,
      isCasual: false,
      isThirdPartyBlocked,
    };
  } catch (err: any) {
    console.error("[getOperatorContext] Erro:", err);
    return {
      contextText: sections.length > 0 ? sections.join("\n\n") : "Sem dados adicionais no momento.",
      knownConversations: Array.from(knownConvMap.values()),
      waitingConversations,
      todayLeadsConversations,
      knownDeals: Array.from(knownDealMap.values()),
      scheduledCallActions,
      executedSteps,
      taskTitle,
      finishedTitle,
      isCasual: false,
      isThirdPartyBlocked,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXTO DA DIRETORIA / GESTÃO — Visão global 360º da operação em tempo real
// Usado exclusivamente em: Módulo IA Administrativa (ValentinaChatTab), scope = "admin"
// NÃO afeta o Fagner/Valentina Colega do operador (scope = "operator")
// ═══════════════════════════════════════════════════════════════════════════════
async function getManagerContext(
  tenantId: string,
  userQuery?: string,
  knowledgeBase?: string
): Promise<string> {
  return getDirectorBiContext(tenantId, userQuery, knowledgeBase);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPTS DAS PERSONAS
// ═══════════════════════════════════════════════════════════════════════════════

function getBrasiliaNowLabel(): string {
  const now = new Date();
  const datePart = now.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timePart = now.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart}, às ${timePart} (Horário de Brasília - America/Sao_Paulo)`;
}

function buildSupervisorPrompt(
  persona: ReturnType<typeof getAiPersona>,
  operatorName: string,
  operationalContext: string,
  fileContext: string,
  chatHistoryText: string,
  userMessage: string
): string {
  const genderRole =
    persona.gender === "male"
      ? "o Diretor de Business Intelligence, Operações e Gestão Comercial em Tempo Real"
      : "a Diretora de Business Intelligence, Operações e Gestão Comercial em Tempo Real";
  const brtNowLabel = getBrasiliaNowLabel();

  return `Você é ${persona.name}, ${genderRole} da ${persona.company}.
Você está conversando diretamente com "${operatorName}" (Diretoria / Gestão Executiva) no painel administrativo exclusivo da Diretoria.
📅 DATA E HORA ATUAL (HORÁRIO DE BRASÍLIA): ${brtNowLabel}.

## 🏛️ SEU PAPEL E ACESSO TOTAL À OPERAÇÃO:
1. **ACESSO 100% COMPLETO E EM TEMPO REAL**:
   - Você JÁ POSSUI acesso integral a todos os dados da operação no dossiê abaixo:
     * **Seção 1**: Filas em tempo real e Ranking de Gargalos por Operador (conversas ativas, clientes aguardando resposta agora, espera >= 15min [SLA estourado], alerta 8-14min, espera máxima e média por operador, e nomes dos clientes esperando).
     * **Seção 2**: Tempo Médio de Atendimento (TMA) Geral e por Operador (Hoje, Últimos 7 dias, Últimos 30 dias e TMA de 1ª Resposta Pós-Transferência do SDR no mês, além do operador mais rápido e mais lento).
     * **Seção 3**: Taxa de Conversão do SDR / Triagem Automática (Hoje, Últimos 7 dias e Geral: total de leads, qualificados/transferidos, em coleta, sem resposta, interrompidos, distribuição por funil/setor e lista nominal dos leads triados).
     * **Seção 4**: Alertas de Estouro de SLA Hoje, nos últimos 7 dias e conversas com SLA estourado ao vivo neste exato minuto.
     * **Seção 5**: Funil de Vendas Comercial (Desta Semana, do Mês e Pipeline Geral por Etapa e por Funil, mais Funil Ponta a Ponta Marketing/SDR -> CRM -> Fechamento).
     * **Seção 6**: Relatório Detalhado por Vendedor / Consultor (Meta Mensal, Realizado no Mês e na Semana, % da Meta, Pacing de Dias Úteis, Pipeline Aberto, Negociações Paradas >=3 dias, Perdidos, Fila de WhatsApp e TMA por vendedor, além das Top Negociações Abertas, Paradas e Ganhas).
     * **Seção 7**: Objeções dos Leads nas Conversas (Preço, Especificação Técnica, Prazo/Frete, Pagamento/Boleto, Garantia/Peças com exemplos reais de falas de clientes), Motivos de Perda no CRM e Auditorias de Qualidade/Sentimento.
     * **Seção 8**: Top 5 Principais Alertas da Operação Hoje (síntese executiva priorizada por criticidade).
     * **Seção 9**: Escala do Rodízio (consultores ativos, pausados, saldo de compensação) e Telemetria de Custos de IA.
     * **Seção 10 e 11**: Busca Profunda sob demanda (conversas com transcrição, negociações e empresas específicas) e Catálogo/Base de Conhecimento.

2. **REGRA INVIOLÁVEL — PROIBIDO DIZER "NÃO TENHO ACESSO" E PROIBIDO INVENTAR DADOS FICTÍCIOS**:
   - **JAMAIS** responda que "não tem acesso", "não consigo consultar", "os dados não estão disponíveis no contexto" ou que houve "falha no início do ciclo / erro na compilação da métrica".
   - **PROIBIÇÃO ABSOLUTA DE ALUCINAÇÃO (FIDELIDADE 100% AO DOSSIÊ)**: Você SÓ pode citar nomes de operadores/vendedores, nomes de clientes/empresas, CNPJs, valores em R$ e quantidades que estejam **literalmente escritos** no dossiê abaixo (\`DADOS REAIS DA OPERAÇÃO AGORA\`). **JAMAIS** invente nomes fictícios de exemplo (como "Ana Paula", "Carlos Dias", "Mecânica Souza Ltda", "Construtora Alfa", "Agropecuária do Vale") nem números fictícios (como "48 alertas" ou "3 conversas")!
   - Quando um indicador específico estiver em \`0\` no dossiê (por exemplo: \`0 alertas de SLA disparados hoje\` e \`0 conversas com SLA estourado agora\`), **informe com exatidão que o número é 0 (operação 100% dentro do SLA no momento)** e mostre nos blocos visuais os indicadores reais correlatos do dossiê (como operadores ativos na escala do rodízio, volume de negociações abertas/paradas no CRM dos vendedores reais da empresa, ou histórico real de 7 dias), **nunca fabricando clientes ou operadores inexistentes**.

3. **USO OBRIGATRIO E INTELIGENTE DE BLOCOS VISUAIS (\`"blocks"\` COM DADOS 100% REAIS DO DOSSIÊ)**:
   - Sempre que a pergunta envolver métricas, comparativos, rankings, funil, relatórios ou objeções, enriqueça sua resposta com **1 ou 2 blocos visuais** dentro do array \`"blocks"\` usando **exclusivamente** os números e nomes reais do dossiê:
     * **Perguntas sobre TMA**: Traga a análise executiva em \`"text"\` + um \`InsightBlock\` (com os valores reais do dossiê de TMA Hoje, 7d, 30d e Pós-SDR) + um \`ChartBlock\` (\`"bar"\`, unit \`"min"\` ou \`"s"\`) se houver operadores com TMA medido (se todos estiverem em 0/N/A, use um \`ReportBlock\` com os operadores reais da equipe e seu status atual).
     * **Perguntas sobre Gargalo de Fila por Operador**: Traga a resposta direta em \`"text"\` + um \`ReportBlock\` ou \`ChartBlock\` (\`"bar"\`) com os operadores reais listados na Seção 1 / Seção 6 / Seção 9 + um \`InsightBlock\` apontando o status real da fila agora.
     * **Perguntas sobre Taxa de Conversão do SDR**: Traga a taxa real de hoje, dos últimos 7 dias e geral em \`"text"\` + um \`InsightBlock\` com os KPIs reais da Seção 3 + um \`ChartBlock\` ou \`ReportBlock\` mostrando o funil real.
     * **Perguntas sobre Alertas de Estouro de SLA ou 5 Principais Alertas da Operação**: Traga o diagnóstico fiel da Seção 4 e Seção 8 em \`"text"\` + um \`InsightBlock\` com os números exatos da Seção 4 (se houver 0 estouros de SLA agora, destaque positivamente que há 0 estouros de SLA no WhatsApp e traga no \`ReportBlock\` os alertas reais da Seção 8, como as negociações reais paradas no CRM com seus respectivos vendedores reais).
     * **Perguntas sobre Gráfico do Funil de Vendas desta Semana**: Gere obrigatoriamente um \`ChartBlock\` (\`"bar"\`) com as etapas e quantidades/valores reais do funil comercial da Seção 5 + um \`ReportBlock\` ou \`InsightBlock\` detalhando quantidade e valor (R$) real em cada etapa.
     * **Perguntas sobre Relatório Detalhado por Vendedor**: Gere obrigatoriamente um \`ReportBlock\` completo com os vendedores reais da Seção 6 (Colunas sugeridas: \`["Vendedor", "Divisão", "Meta Mês", "Realizado Mês", "Pipeline Aberto", "Parados >=3d", "Perdidos Mês"]\`) + um \`InsightBlock\` com o resumo da meta global e realizado real da empresa.
     * **Perguntas sobre Objeções dos Leads**: Gere um \`ChartBlock\` (\`"bar"\` ou \`"pie"\`) com o ranking real das categorias/objeções da Seção 7 (usando as 5 macro-categorias e os Top 12 motivos específicos de perda do CRM quando a amostra de mensagens do chat estiver em 0) + um \`ReportBlock\` ou \`InsightBlock\` detalhando os valores em R$ e ocorrências reais.

## 📊 DADOS REAIS DA OPERAÇÃO AGORA (DOSSIÊ EXECUTIVO 360º):
${operationalContext}
${fileContext}

${chatHistoryText ? `## HISTÓRICO RECENTE DESTA CONVERSA:\n${chatHistoryText}\n` : ""}
## SOLICITAÇÃO ATUAL DO GESTOR (${operatorName}):
"${userMessage}"

## ESTRUTURA DE BLOCOS VISUAIS SUPORTADOS (use dentro de "blocks" no JSON):
1. ChartBlock: { "type": "chart", "chart": "bar"|"line"|"pie", "title": "...", "subtitle": "...", "unit": "...", "data": [{ "label": "X", "value": 10 }] }
2. InsightBlock: { "type": "insight", "title": "...", "items": [{ "label": "...", "value": "...", "delta": "+5%", "trend": "up"|"down"|"flat", "hint": "..." }], "recommendation": "..." }
3. ReportBlock: { "type": "report", "title": "...", "columns": ["Col1","Col2"], "rows": [["val1","val2"]], "footnote": "..." }
4. ExcerptBlock: { "type": "excerpt", "title": "...", "conversations": [{ "lead": "...", "channel": "WhatsApp", "when": "Recente", "sentiment": "positivo"|"neutro"|"negativo", "lines": [{ "from": "lead"|"agente", "text": "..." }] }] }

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON VÁLIDO):
{
  "fragments": [
    {
      "text": "Análise executiva direta, clara e completa respondendo à pergunta do gestor com os números reais da operação (sem repetir de forma idêntica o que já está desenhado na tabela/gráfico abaixo, mas interpretando os destaques e gargalos).",
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
  const brtNowLabel = getBrasiliaNowLabel();

  return `Você é ${persona.name}, ${colleagueRole} de vendas e atendimento da ${persona.company}.
Você trabalha lado a lado com ${operatorName} (consultor(a)/vendedor(a)) durante o dia a dia comercial no WhatsApp interno.
📅 DATA E HORA ATUAL (HORÁRIO DE BRASÍLIA): ${brtNowLabel}.
⚠️ ATENÇÃO TEMPORAL: No histórico da conversa abaixo, cada mensagem possui um marcador temporal exato (\`[Hoje HH:mm]\`, \`[Ontem DD/MM HH:mm]\` ou \`[DD/MM/YYYY HH:mm]\`). Nunca trate assuntos ou perguntas marcadas como \`[Hoje ...]\` como se fossem de ontem, e nunca trate alertas antigos de \`[Ontem ...]\` como se estivessem acontecendo agora.

## SEU PAPEL NO DIA A DIA DO VENDEDOR:
Você NÃO é um suporte de T.I. (nunca fale em "chamados de T.I." ou "tickets"). Você é um colega de trabalho afiado, direto e prestativo que ajuda ${firstName} com:
1. **Leads e Atendimentos de Hoje / Conversas Ativas / SLA**: Quantos leads chegaram hoje, quais clientes estão aguardando resposta no WhatsApp (e há quantos minutos), quais foram transferidos recentemente, resumo do que o cliente falou e sugestões de mensagens de abordagem, contorno de objeções ou follow-up.
2. **Metas e Ritmo Comercial**: Quanto falta para bater a meta do mês, quanto já vendeu, qual a meta diária necessária e quantos dias úteis restam.
3. **Tarefas, Reuniões e Diretrizes do Gestor**: Quais tarefas estão pendentes para hoje ou atrasadas e quais orientações o gestor deixou nas negociações.
4. **Ligações Agendadas e Discagem Direta via VigosPhone**: Quais ligações e follow-ups ${firstName} precisa fazer hoje e atalho direto para ligar via VigosPhone.
5. **Negociações (CRM) Abertas, Histórico de Atividades e Negociações Paradas/Esfriando**: Quais orçamentos/deals estão em aberto, histórico detalhado de anotações/atividades de cada card, telefone do contato e quais estão parados há 3+ dias sem interação.
6. **Dúvidas Técnicas de Produtos/Máquinas**: Especificações técnicas do catálogo da ${persona.company} para ajudar ${firstName} a responder rápido ao cliente.

## 💬 ESTILO DE CONVERSA NATURAL (COMO UM COLEGA NO WHATSAPP):
1. **DIVIDA EM BALÕES CURTOS (1 A 3 FRAGMENTOS)**:
   - Em agradecimentos ou confirmações rápidas (ex: *"ta obrigado"*, *"valeu"*, *"beleza"*, *"ok"*), responda em **1 único balão curto** (1 frase natural, sem puxar novos assuntos ou empurrar atendimentos).
   - Em consultas comerciais, quebre sua resposta em **2 a 3 balões curtos** dentro do array \`"fragments"\` (cada balão com 1 a 3 frases curtas).
2. **PROIBIDO CUMPRIMENTAR TODA HORA**:
   - ${
     alreadyTalkingToday
       ? `🚨 **VOCÊS JÁ ESTÃO CONVERSANDO HOJE!** Veja o histórico abaixo. É **ESTRITAMENTE PROIBIDO** começar a resposta com saudação ("Fala, ${firstName}!", "E aí, ${firstName}!", "Bom dia", "Boa tarde", "Olá", "Tudo certo?", "Opa"). Responda DIRETO ao ponto como em uma conversa contínua de WhatsApp!`
       : `Como é a primeira troca de mensagens de hoje, se ${firstName} mandou um cumprimento ("Oi", "Olá", "Bom dia"), responda de forma curta e natural apenas no primeiro balão.`
   }
3. **PROIBIDO EMPURRAR ATENDIMENTOS OU NEGOCIAÇÕES NÃO SOLICITADOS (ZERO POLUIÇÃO)**:
   - **NUNCA** empurre negociações paradas, leads ou sugestões de ligação se ${firstName} não perguntou por indicações/prioridades agora.
   - Se ${firstName} apenas agradeceu (*"ta obrigado"*, *"valeu"*), encerre de forma leve sem anexar nenhum card (\`"mentionedConversationIds": []\`, \`"mentionedDealIds": []\`, \`"suggestedCallDealIds": []\`).
   - Se ${firstName} perguntou sobre um cliente/negociação de outro vendedor (bloqueado por sigilo comercial) ou que não foi encontrado na carteira, informe apenas isso de forma objetiva — **JAMAIS** ofereça outras negociações aleatórias da carteira como "compensação".
   - **PROIBIDO REPETIR INDICAÇÕES**: Olhe o \`HISTÓRICO RECENTE DA CONVERSA\`. Se você já sugeriu determinados clientes/negociações (ex: nas mensagens anteriores de hoje), **NÃO volte a oferecer os mesmos clientes** a menos que ${firstName} pergunte especificamente por eles pelo nome.
4. **PROIBIDO REPETIR PALAVRAS, NOMES OU BORDÕES**:
   - **NUNCA** use as palavras **"parceiro"**, **"parceira"**, **"campeão"**, **"fera"**, **"chefe"**, **"meu caro"** ou **"amigo"**.
   - **NÃO** fique repetindo o nome "${firstName}" em toda mensagem ou em todo balão.
   - **NUNCA** use frases de fechamento batidas/repetitivas como *"Qualquer coisa estou na escuta"*, *"Fico na escuta"*, *"É só chamar"*, *"Estou por aqui"*, *"Bora pra cima"*, *"Bons negócios"*.
5. **FORMATAÇÃO LIMPA DE WHATSAPP (PROIBIDO USAR CRASE / BACKTICKS \` \`)**:
   - **JAMAIS** use crases (\`0017418\`) para destacar códigos ou nomes. Use apenas negrito simples do WhatsApp (\`*0017418*\` ou \`**0017418**\`).
   - **JAMAIS** escreva \`[ID: ...]\`, \`[dealId: ...]\` ou \`[convId: ...]\` no texto visível de \`"text"\`. Coloque os IDs exclusivamente nos arrays do JSON (\`"mentionedConversationIds"\`, \`"mentionedDealIds"\`, \`"suggestedCallDealIds"\`).
6. **CARDS UNIFICADOS E SEM DUPLICIDADE (MÁXIMO 1 A 3 CARDS RELEVANTES)**:
   - Cada Card de Negociação em \`"mentionedDealIds"\` **já possui embutidos** o telefone do cliente, o botão de discagem direta no VigosPhone (\`📞\`), o atalho da conversa no WhatsApp (\`💬\`) e o botão **"Abrir CRM →"**.
   - Portanto, quando citar uma negociação do CRM (\`[dealId: ...]\`), coloque o ID **APENAS em \`"mentionedDealIds"\`** (limite-se às 1 a 3 negociações realmente citadas no seu texto; nunca despeje 6 cards de uma vez).
   - Use \`"suggestedCallDealIds"\` **apenas** quando o foco específico for uma ligação agendada hoje ou quando não houver card de CRM correspondente.
   - Use \`"mentionedConversationIds"\` **apenas** quando citar conversas de WhatsApp que não sejam negociações já listadas em \`"mentionedDealIds"\`.

## 🔒 REGRAS INVIOLÁVEIS DE SIGILO E SEGURANÇA (RBAC):
- Você tem acesso EXCLUSIVO à carteira, metas, tarefas, clientes e negociações de **${operatorName}**.
- **PROIBIDO** revelar, estimar ou comentar sobre negociações de terceiros (outros vendedores/operadores), ranking confidencial de salários/comissões de colegas ou dados estratégicos/financeiros restritos à Diretoria.
- Use SEMPRE os dados reais fornecidos abaixo. Nunca invente valores, telefones, nomes de clientes ou tarefas que não estejam listados no contexto.

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
    }
  ],
  "mentionedConversationIds": [],
  "mentionedDealIds": [],
  "suggestedCallDealIds": []
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

  // Remove vazamento acidental de "[ID: ...]", "[dealId: ...]", "[convId: ...]" no texto visível
  out = out
    .replace(/\s*\[(?:ID|dealId|convId):\s*[^\]]+\]/gi, "")
    .replace(/\s*\((?:ID|dealId|convId):\s*[^)]+\)/gi, "")
    .trim();

  // Converte crases inline (`0017418`) em negrito limpo de WhatsApp (*0017418*)
  out = out.replace(/`([^`\n]+)`/g, "*$1*");

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

function isSecrecyOrEmptyRefusalReply(fullReplyText: string, ctx: OperatorContextResult | null): boolean {
  if (ctx?.isCasual || ctx?.isThirdPartyBlocked) return true;
  return /sigilo\s+comercial|carteira\s+de\s+outro\s+consultor|outro\s+vendedor|exclusiv[oa]\s+de\s+outro\s+consultor/i.test(
    fullReplyText || ""
  );
}

function resolveRelatedDeals(
  mentionedDealIds: string[],
  suggestedCallDealIds: string[],
  fullReplyText: string,
  userText: string,
  ctx: OperatorContextResult | null
): RelatedDealItem[] {
  if (!ctx || ctx.knownDeals.length === 0) return [];
  if (isSecrecyOrEmptyRefusalReply(fullReplyText, ctx)) return [];

  const selectedMap = new Map<string, RelatedDealItem>();
  const byId = new Map(ctx.knownDeals.map((d) => [d.dealId, d]));

  // 1. Negociações citadas nominalmente ou por código numérico no texto da resposta da IA
  const normReply = normalizeForMatch(fullReplyText);
  for (const deal of ctx.knownDeals) {
    const titleNorm = normalizeForMatch(deal.title || "");
    const companyNorm = normalizeForMatch(deal.company || "");
    const codeMatch = (deal.title || "").match(/\b(\d{4,})\b/);
    const codeToken = codeMatch ? codeMatch[1] : "";

    const matchedByCode = codeToken.length >= 4 && normReply.includes(codeToken);
    const matchedByTitle = titleNorm.length >= 4 && normReply.includes(titleNorm);
    const matchedByCompany = companyNorm.length >= 4 && normReply.includes(companyNorm);

    if (matchedByCode || matchedByTitle || matchedByCompany) {
      selectedMap.set(deal.dealId, deal);
    }
  }

  // 2. IDs explicitamente retornados pela IA em mentionedDealIds ou suggestedCallDealIds
  for (const id of [...mentionedDealIds, ...suggestedCallDealIds]) {
    const cleanId = (id || "").trim();
    const found = byId.get(cleanId);
    if (found) selectedMap.set(found.dealId, found);
  }

  // Limita a no máximo 2 cards (ou 3 quando o usuário pediu lista/plural explicitamente) para evitar poluição visual
  const asksPluralList = /\b(?:quais|todos|todas|lista|listar|paradas|parados|abertas|abertos)\b/i.test(userText);
  const maxDeals = asksPluralList ? 3 : 2;

  return Array.from(selectedMap.values()).slice(0, maxDeals);
}

function resolveRelatedCalls(
  suggestedCallDealIds: string[],
  relatedDeals: RelatedDealItem[],
  relatedConversations: RelatedConversationItem[],
  fullReplyText: string,
  userText: string,
  ctx: OperatorContextResult | null
): RelatedCallActionItem[] {
  if (!ctx || isSecrecyOrEmptyRefusalReply(fullReplyText, ctx)) return [];

  // Como todo card em `relatedDeals` já possui telefone + botão de discagem VigosPhone [📞] + botão WhatsApp [💬]
  // embutidos no próprio card unificado, NUNCA criamos um card duplicado em `relatedCalls` para o mesmo contato!
  const coveredDealIds = new Set(relatedDeals.map((d) => d.dealId));
  const coveredConvIds = new Set(relatedDeals.map((d) => d.conversationId).filter(Boolean) as string[]);
  const coveredPhones = new Set(
    relatedDeals
      .map((d) => (d.contactPhone || "").replace(/\D/g, ""))
      .filter((p) => p.length >= 8)
  );
  const coveredNames = new Set(
    relatedDeals
      .flatMap((d) => [d.company, d.contactName, d.title])
      .map((n) => normalizeForMatch(n || ""))
      .filter((n) => n.length >= 3)
  );

  const isAlreadyCoveredByDeal = (item: {
    dealId?: string;
    conversationId?: string;
    phone?: string;
    clientName?: string;
    company?: string;
  }) => {
    if (item.dealId && coveredDealIds.has(item.dealId)) return true;
    if (item.conversationId && coveredConvIds.has(item.conversationId)) return true;
    const digits = (item.phone || "").replace(/\D/g, "");
    if (digits.length >= 8 && coveredPhones.has(digits)) return true;
    const nameKey = normalizeForMatch(item.company || item.clientName || "");
    if (nameKey.length >= 3 && coveredNames.has(nameKey)) return true;
    return false;
  };

  const selectedByPhone = new Map<string, RelatedCallActionItem>();
  const dealsById = new Map(ctx.knownDeals.map((d) => [d.dealId, d]));
  const convsById = new Map(ctx.knownConversations.map((c) => [c.clientId, c]));

  const addCallItem = (item: RelatedCallActionItem) => {
    if (isAlreadyCoveredByDeal(item)) return;
    const digits = (item.phone || "").replace(/\D/g, "");
    if (digits.length < 8) return;
    if (!selectedByPhone.has(digits)) {
      selectedByPhone.set(digits, item);
    }
  };

  const combinedText = `${userText} ${fullReplyText}`;
  const isCallContext =
    /\b(?:ligar|liga[çc][aã]o|liga[çc][oõ]es|ligue|discar|telefone|fone|vigosphone|vigos|contato\s+telef[oô]nico)\b/i.test(
      combinedText
    );
  const asksScheduledCalls =
    /\b(?:liga[çc][aã]o|liga[çc][oõ]es)\b.*\b(?:agendada|agendadas|hoje|pendente|pendentes)\b|\b(?:quem\s+devo\s+ligar|para\s+quem\s+ligar)\b/i.test(
      combinedText
    );

  // 1. Ligações agendadas no dia (quando não estão já representadas em relatedDeals)
  if (asksScheduledCalls && ctx.scheduledCallActions.length > 0) {
    for (const sc of ctx.scheduledCallActions) {
      addCallItem(sc);
    }
  }

  // 2. IDs explicitamente sugeridos em suggestedCallDealIds que NÃO estejam em relatedDeals
  if (isCallContext) {
    for (const rawId of suggestedCallDealIds) {
      const id = (rawId || "").trim();
      const deal = dealsById.get(id);
      if (deal && deal.contactPhone) {
        addCallItem({
          id: `call-deal-${deal.dealId}`,
          clientName: deal.contactName || deal.company || deal.title,
          company: deal.company,
          phone: deal.contactPhone,
          dealId: deal.dealId,
          dealTitle: deal.title,
          dealValueFormatted: deal.valueFormatted,
          stageLabel: deal.stageLabel,
          conversationId: deal.conversationId,
          reason: "Recomendado para ligação de fechamento",
        });
        continue;
      }
      const conv = convsById.get(id);
      if (conv && conv.clientPhone) {
        addCallItem({
          id: `call-conv-${conv.clientId}`,
          clientName: conv.clientName,
          company: conv.company,
          phone: conv.clientPhone,
          conversationId: conv.clientId,
          reason: conv.statusLabel || "Contato direto via VigosPhone",
        });
      }
    }
  }

  // 3. Se o contexto é explicitamente de ligação e citou conversas do WhatsApp sem deal no CRM
  if (isCallContext && selectedByPhone.size === 0 && relatedDeals.length === 0 && relatedConversations.length > 0) {
    for (const conv of relatedConversations.slice(0, 2)) {
      if (conv.clientPhone) {
        addCallItem({
          id: `call-conv-${conv.clientId}`,
          clientName: conv.clientName,
          company: conv.company,
          phone: conv.clientPhone,
          conversationId: conv.clientId,
          reason: conv.statusLabel || "Clique para discar direto no VigosPhone",
        });
      }
    }
  }

  return Array.from(selectedByPhone.values()).slice(0, 2);
}

function resolveRelatedConversations(
  mentionedIds: string[],
  fullReplyText: string,
  userText: string,
  ctx: OperatorContextResult | null,
  relatedDeals: RelatedDealItem[] = []
): RelatedConversationItem[] {
  if (!ctx || ctx.knownConversations.length === 0) return [];
  if (isSecrecyOrEmptyRefusalReply(fullReplyText, ctx)) return [];

  // Como todo card em `relatedDeals` já inclui o botão de abrir conversa no WhatsApp (`deal.conversationId`),
  // filtramos qualquer conversa que já pertença a um contato presente em `relatedDeals`!
  const coveredConvIds = new Set(relatedDeals.map((d) => d.conversationId).filter(Boolean) as string[]);
  const coveredPhones = new Set(
    relatedDeals
      .map((d) => (d.contactPhone || "").replace(/\D/g, ""))
      .filter((p) => p.length >= 8)
  );
  const coveredNames = new Set(
    relatedDeals
      .flatMap((d) => [d.company, d.contactName, d.title])
      .map((n) => normalizeForMatch(n || ""))
      .filter((n) => n.length >= 3)
  );

  const isCoveredByDeal = (conv: RelatedConversationItem) => {
    if (coveredConvIds.has(conv.clientId)) return true;
    const digits = (conv.clientPhone || "").replace(/\D/g, "");
    if (digits.length >= 8 && coveredPhones.has(digits)) return true;
    const cName = normalizeForMatch(conv.clientName || "");
    const cComp = normalizeForMatch(conv.company || "");
    if ((cName.length >= 3 && coveredNames.has(cName)) || (cComp.length >= 3 && coveredNames.has(cComp))) {
      return true;
    }
    return false;
  };

  const selectedMap = new Map<string, RelatedConversationItem>();
  const byId = new Map(ctx.knownConversations.map((c) => [c.clientId, c]));

  const addConv = (conv: RelatedConversationItem) => {
    if (isCoveredByDeal(conv)) return;
    selectedMap.set(conv.clientId, conv);
  };

  // 1. IDs explicitamente retornados pela IA em mentionedConversationIds
  for (const id of mentionedIds) {
    const found = byId.get(id);
    if (found) addConv(found);
  }

  // 2. Nomes de clientes citados nominalmente no texto da resposta da IA
  const normReply = fullReplyText.toLowerCase();
  const normUser = userText.toLowerCase();
  for (const conv of ctx.knownConversations) {
    const nameClean = (conv.clientName || "").trim().toLowerCase();
    if (nameClean.length >= 4 && !nameClean.startsWith("cliente ")) {
      if (normReply.includes(nameClean)) {
        addConv(conv);
      }
    }
  }

  // 3. Se o operador perguntou explicitamente sobre leads de hoje
  const asksTodayLeads =
    /(?:lead|leads|chegaram|chegou|recebi|entraram|entrou|novos)\b.*\b(?:hoje|dia)\b|\b(?:hoje)\b.*\b(?:lead|leads|chegaram|chegou|atendimento)/i.test(
      normUser
    );
  if (asksTodayLeads && ctx.todayLeadsConversations.length > 0) {
    for (const c of ctx.todayLeadsConversations.slice(0, 3)) {
      addConv(c);
    }
  }

  // 4. Se a pergunta for explicitamente sobre fila/conversas aguardando no WhatsApp
  const isCrmFocused =
    relatedDeals.length > 0 ||
    /\b(?:negocia[çc][aã]o|negocia[çc][oõ]es|crm|card|cards|or[çc]amento|or[çc]amentos|proposta|propostas|pipeline|funil|etapa)\b/i.test(
      `${normUser} ${normReply}`
    );

  const asksWhatsAppQueue =
    /\b(?:conversa|conversas|atendimento|atendimentos|aguardando|esperando|fila|sobrecarga)\b/i.test(
      normUser
    );

  if (!isCrmFocused && asksWhatsAppQueue && selectedMap.size === 0) {
    const pool =
      ctx.waitingConversations.length > 0 ? ctx.waitingConversations : ctx.knownConversations;
    for (const c of pool.slice(0, 3)) {
      addConv(c);
    }
  }

  return Array.from(selectedMap.values()).slice(0, 3);
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

            const sorted = deduplicatedDesc
              .reverse()
              .sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return ta - tb;
              });
            return new Response(JSON.stringify(sorted), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const isBrokenAdminMessage = (txt: string) =>
            /n[aã]o\s+(?:tenho|possuo)\s+acesso|n[aã]o\s+est[aã]o\s+dispon[ií]veis\s+no\s+contexto|n[aã]o\s+consigo\s+consultar\s+o\s+tempo\s+m[eé]dio|falha\s+no\s+in[ií]cio\s+do\s+ciclo|Erro\s+na\s+compila[cç][aã]o\s+da\s+m[eé]trica|Mec[aâ]nica\s+Souza\s+Ltda|Construtora\s+Alfa/i.test(
              txt || ""
            );

          const brokenAdminIds = msgs
            .filter((m) => m.direction === "from_agent" && isBrokenAdminMessage(m.content || ""))
            .map((m) => m.id);

          if (brokenAdminIds.length > 0) {
            db.delete(internalMessages)
              .where(
                and(
                  eq(internalMessages.tenantId, tenantId),
                  inArray(internalMessages.id, brokenAdminIds)
                )
              )
              .catch(() => {});
          }

          const sorted = msgs
            .filter((m) => !(m.direction === "from_agent" && isBrokenAdminMessage(m.content || "")))
            .reverse()
            .sort((a, b) => {
              const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return ta - tb;
            });

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
          const {
            content,
            scope = "operator",
            attachment,
            imageBase64,
            knowledgeBase,
            threadHistory,
          } = body;

          if (!content && !attachment && !imageBase64) {
            return new Response(
              JSON.stringify({ error: "content, attachment ou imageBase64 são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // ── Detecta se é Supervisora/Diretoria ou Copiloto do Vendedor ─────
          // scope "admin" → Diretoria / Supervisora (Módulo IA Gestão)
          // scope "operator" → Copiloto Comercial (Módulo Chat, todos os operadores/vendedores)
          const isSupervisor = scope === "admin";
          const sessionPerms = (session as any).permissions;
          const isActuallyAdmin =
            session.operator.role === "admin" ||
            session.operator.role === "supervisor" ||
            sessionPerms?.views?.valentina === true ||
            sessionPerms?.views?.commercialBi === true ||
            sessionPerms?.views?.gestao === true;
          const useManagerContext = isSupervisor && isActuallyAdmin;

          const now = new Date();
          const brtTodayYmd = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
          const todayStart = new Date(`${brtTodayYmd}T00:00:00-03:00`);
          const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
          const brtYesterdayYmd = yesterdayStart.toLocaleDateString("en-CA", {
            timeZone: "America/Sao_Paulo",
          });

          const formatHistoryTimeTag = (rawDate: Date | string | null | undefined): string => {
            if (!rawDate) return "";
            const d = new Date(rawDate);
            if (isNaN(d.getTime())) return "";
            const ymd = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
            const hm = d.toLocaleTimeString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              hour: "2-digit",
              minute: "2-digit",
            });
            if (ymd === brtTodayYmd) return `[Hoje ${hm}] `;
            if (ymd === brtYesterdayYmd) {
              const dm = d.toLocaleDateString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                day: "2-digit",
                month: "2-digit",
              });
              return `[Ontem ${dm} ${hm}] `;
            }
            const dmy = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
            return `[${dmy} ${hm}] `;
          };

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

          const isLegacyRefusal = (txt: string) =>
            /n[aã]o\s+(?:tenho|possuo)\s+acesso|n[aã]o\s+est[aã]o\s+dispon[ií]veis\s+no\s+contexto|n[aã]o\s+consigo\s+consultar\s+o\s+tempo\s+m[eé]dio|falha\s+no\s+in[ií]cio\s+do\s+ciclo|Erro\s+na\s+compila[cç][aã]o\s+da\s+m[eé]trica|Mec[aâ]nica\s+Souza\s+Ltda|Construtora\s+Alfa/i.test(
              txt || ""
            );

          const chronologicalRecentRows = [...recentChatRows].reverse();

          let chatHistoryText = "";
          if (useManagerContext && Array.isArray(threadHistory)) {
            chatHistoryText = threadHistory
              .filter((m: any) => m && typeof m.content === "string" && !isLegacyRefusal(m.content))
              .slice(-10)
              .map((m: any) => {
                const speaker = m.sender === "operator" ? operatorName : persona.name;
                const timeTag = formatHistoryTimeTag(m.createdAt || m.timestamp || m.sentAtISO);
                return `${timeTag}${speaker}: ${m.content.slice(0, 500)}`;
              })
              .join("\n");
          } else {
            chatHistoryText = chronologicalRecentRows
              .filter((r) => !(useManagerContext && r.direction === "from_agent" && isLegacyRefusal(r.content || "")))
              .map((r) => {
                const speaker = r.direction === "to_agent" ? operatorName : persona.name;
                const timeTag = formatHistoryTimeTag(r.createdAt);
                return `${timeTag}${speaker}: ${(r.content || "").slice(0, 500)}`;
              })
              .join("\n");
          }

          // Texto recente da conversa (últimas 4 mensagens cronológicas) para resolver follow-ups como "puxe por favor" ou "qual o telefone dela?"
          const recentAiContextText = chronologicalRecentRows
            .slice(-4)
            .map((r) => r.content || "")
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
              knowledgeBase: knowledgeBase || tenantId,
              attachedFileInfo: attachment ? { name: attachment.name, mimeType: attachment.mimeType } : undefined,
              attachedImageInfo: imageBase64 ? { name: "Imagem", dataUrl: imageBase64 } : undefined,
            },
            read: 1,
            createdAt: now,
          });

          // ── Contexto e extração de arquivo com Telemetria Real-Time SSE ────
          const requestStartedMs = Date.now();
          const liveExecutedSteps: AgenticThoughtStep[] = [];
          let liveTaskTitle = useManagerContext
            ? "Compilando dossiê executivo 360º da operação"
            : "Analisando solicitação comercial";
          let liveFinishedTitle = useManagerContext
            ? "Dossiê executivo 360º compilado"
            : "Consulta comercial concluída";

          const broadcastLiveProgress = (customTitle?: string, extraPreviewStep?: AgenticThoughtStep) => {
            const stepsToSend = extraPreviewStep
              ? [...liveExecutedSteps, extraPreviewStep]
              : [...liveExecutedSteps];
            emitRealTimeThoughtProgress({
              tenantId,
              operatorId,
              scope: useManagerContext ? "admin" : "operator",
              taskTitle: customTitle || liveTaskTitle,
              steps: stepsToSend,
            });
          };

          let fileContext = "";
          if (attachment?.base64 && attachment?.name) {
            const tFile0 = Date.now();
            const extracted = await extractFileText(attachment.name, attachment.mimeType || "", attachment.base64);
            fileContext = `\n\n📎 ARQUIVO ANEXADO PELO USUÁRIO: "${attachment.name}"\n${extracted}`;
            const fileMs = Math.max(8, Date.now() - tFile0);
            liveExecutedSteps.push({
              id: "step-attachment-extract",
              kind: "read",
              actionVerb: "Leu",
              targetLabel: attachment.name,
              scopeTag: `#anexo • ${fileMs}ms`,
              badgeType: "file",
              detailText: `Extração de conteúdo do arquivo "${attachment.name}" concluída em ${fileMs}ms.`,
            });
            broadcastLiveProgress();
          }

          if (imageBase64) {
            liveExecutedSteps.push({
              id: "step-image-inline",
              kind: "read",
              actionVerb: "Inspecionou",
              targetLabel: "imagem anexada",
              scopeTag: "#multimodal-vision",
              badgeType: "vision",
              detailText: "Imagem codificada para inspeção visual multimodal no Vertex AI.",
            });
            broadcastLiveProgress();
          }

          let managerContextText = "";
          let operatorContextResult: OperatorContextResult | null = null;

          const contextStartMs = Date.now();
          if (useManagerContext) {
            broadcastLiveProgress(liveTaskTitle, {
              id: "step-admin-bi-running",
              kind: "query",
              actionVerb: "Consultando",
              targetLabel: "director_bi_context",
              scopeTag: `#${knowledgeBase || tenantId} • em execução`,
              badgeType: "bi",
            });
            managerContextText = await getManagerContext(contextTenantId, userText, knowledgeBase);
            const biMs = Math.max(25, Date.now() - contextStartMs);
            liveExecutedSteps.push({
              id: "step-admin-bi-done",
              kind: "query",
              actionVerb: "Consultou",
              targetLabel: "director_bi_context",
              scopeTag: `#dossie-360 • ${biMs}ms`,
              badgeType: "bi",
              detailText: `Dossiê executivo 360º (filas, TMA, funil CRM, metas e SLA) compilado em ${biMs}ms.`,
            });
            broadcastLiveProgress();
          } else {
            operatorContextResult = await getOperatorContext(
              contextTenantId,
              operatorId,
              operatorEmail,
              userText,
              recentAiContextText,
              (taskTitle, steps) => {
                liveTaskTitle = taskTitle;
                liveExecutedSteps.splice(
                  liveExecutedSteps.findIndex((s) => s.id.startsWith("step-op-")) >= 0
                    ? liveExecutedSteps.findIndex((s) => s.id.startsWith("step-op-"))
                    : liveExecutedSteps.length,
                  liveExecutedSteps.length,
                  ...steps
                );
                broadcastLiveProgress(taskTitle);
              }
            );
            liveTaskTitle = operatorContextResult.taskTitle;
            liveFinishedTitle = operatorContextResult.finishedTitle;
            // Garante sincronização final das etapas reais do operador
            const nonOpSteps = liveExecutedSteps.filter((s) => !s.id.startsWith("step-op-"));
            liveExecutedSteps.length = 0;
            liveExecutedSteps.push(...nonOpSteps, ...operatorContextResult.executedSteps);
          }
          const contextDurationMs = Math.max(15, Date.now() - contextStartMs);

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
          let mentionedDealIds: string[] = [];
          let suggestedCallDealIds: string[] = [];
          let alerts: any[] = [];

          // Para interações casuais/curtas ("ta obrigado", "valeu", "ok") sem anexo, usa gemini-2.5-flash para resposta quase instantânea
          const isFastCasual = Boolean(
            !useManagerContext && operatorContextResult?.isCasual && !imageBase64 && !attachment
          );
          const selectedModel = isFastCasual ? "gemini-2.5-flash" : "gemini-2.5-pro";

          broadcastLiveProgress(liveTaskTitle, {
            id: "step-vertex-synthesize",
            kind: "synthesize",
            actionVerb: "Sintetizando",
            targetLabel: `resposta com ${persona.name}`,
            scopeTag: `#${selectedModel} • em execução`,
            badgeType: "ai",
          });

          const aiStartMs = Date.now();
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
                mentionedDealIds?: string[];
                suggestedCallDealIds?: string[];
                alerts?: any[];
              }>(promptInput, selectedModel, undefined, {
                tenantId,
                feature: featureKey,
                metadata: { operatorId, operatorName, scope, isManager: useManagerContext },
              });

              if (aiRes?.fragments && aiRes.fragments.length > 0) {
                fragments = aiRes.fragments;
                mentionedConversationIds = Array.isArray(aiRes.mentionedConversationIds)
                  ? aiRes.mentionedConversationIds
                  : [];
                mentionedDealIds = Array.isArray(aiRes.mentionedDealIds)
                  ? aiRes.mentionedDealIds
                  : [];
                suggestedCallDealIds = Array.isArray(aiRes.suggestedCallDealIds)
                  ? aiRes.suggestedCallDealIds
                  : [];
                alerts = aiRes.alerts || [];
              }
            }
          } catch (aiErr: any) {
            console.warn("[valentina/messages] Vertex AI erro:", aiErr?.message);
          }
          const aiDurationMs = Math.max(80, Date.now() - aiStartMs);
          const totalDurationMs = Math.max(120, Date.now() - requestStartedMs);

          liveExecutedSteps.push({
            id: "step-vertex-synthesize",
            kind: "synthesize",
            actionVerb: "Gerou",
            targetLabel: `resposta contextual de ${persona.name}`,
            scopeTag: `#${selectedModel} • ${aiDurationMs}ms`,
            badgeType: "ai",
            detailText: `Síntese estruturada concluída via Vertex AI (${selectedModel}) em ${aiDurationMs}ms.`,
          });
          broadcastLiveProgress(liveFinishedTitle);

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

          // ── Pós-processamento: fragmentação natural em balões curtos + cards interativos ──
          if (!useManagerContext) {
            fragments = splitIntoNaturalFragments(fragments, operatorName, alreadyTalkingToday);
          }

          const fullReplyText = fragments.map((f) => f.text).join("\n");
          const relatedDeals = !useManagerContext
            ? resolveRelatedDeals(
                mentionedDealIds,
                suggestedCallDealIds,
                fullReplyText,
                userText,
                operatorContextResult
              )
            : [];
          const relatedConversations = !useManagerContext
            ? resolveRelatedConversations(
                mentionedConversationIds,
                fullReplyText,
                userText,
                operatorContextResult,
                relatedDeals
              )
            : [];
          const relatedCalls = !useManagerContext
            ? resolveRelatedCalls(
                suggestedCallDealIds,
                relatedDeals,
                relatedConversations,
                fullReplyText,
                userText,
                operatorContextResult
              )
            : [];

          // ── Constrói a árvore agêntica de raciocínio e ações REAIS executadas ──
          const candidateSearchTerms = extractSearchCandidateTerms(userText);
          const thoughtTrace = buildAgenticThoughtTrace({
            userQuery: userText,
            scope: useManagerContext ? "admin" : "operator",
            personaName: persona.name,
            knowledgeBase: knowledgeBase || tenantId,
            attachedFileName: attachment?.name || null,
            hasAttachedImage: Boolean(imageBase64),
            totalDurationMs,
            contextDurationMs,
            aiDurationMs,
            executedSteps: liveExecutedSteps,
            customTaskTitle: liveTaskTitle,
            customFinishedTitle: liveFinishedTitle,
            extraSummary: {
              dealsCount: operatorContextResult?.knownDeals?.length,
              waitingCount: operatorContextResult?.waitingConversations?.length,
              callsCount: relatedCalls.length,
              searchTerms: candidateSearchTerms.length > 0 ? candidateSearchTerms : undefined,
            },
          });

          // ── Salva fragmentos no banco ───────────────────────────────────────
          const savedFragments: any[] = [];
          for (let i = 0; i < fragments.length; i++) {
            const frag = fragments[i];
            const isFirstFrag = i === 0;
            const isLastFrag = i === fragments.length - 1;
            const fragRelated =
              isLastFrag && relatedConversations.length > 0 ? relatedConversations : undefined;
            const fragRelatedDeals =
              isLastFrag && relatedDeals.length > 0 ? relatedDeals : undefined;
            const fragRelatedCalls =
              isLastFrag && relatedCalls.length > 0 ? relatedCalls : undefined;
            const fragThoughtTrace = isFirstFrag ? thoughtTrace : undefined;
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
                relatedDeals: fragRelatedDeals,
                relatedCalls: fragRelatedCalls,
                thoughtTrace: fragThoughtTrace,
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
              relatedDeals: fragRelatedDeals,
              relatedCalls: fragRelatedCalls,
              thoughtTrace: fragThoughtTrace,
              direction: "from_agent",
              createdAt: fragTimestamp,
            });
          }

          return new Response(
            JSON.stringify({
              success: true,
              userMessage: { id: userMsgId, content: userText, direction: "to_agent", createdAt: now },
              thoughtTrace,
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


