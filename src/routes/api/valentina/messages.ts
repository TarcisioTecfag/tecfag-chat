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
} from "../../../db/schema";
import { eq, and, desc, sql, gte, isNull, ne, count } from "drizzle-orm";
import crypto from "crypto";
import { getAiPersona } from "../../../lib/ai-persona";

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

// ── Resolve role do operador (admin | agent) ─────────────────────────────────
async function getOperatorRole(operatorId: string): Promise<string> {
  try {
    const [op] = await db
      .select({ role: operators.role })
      .from(operators)
      .where(eq(operators.id, operatorId))
      .limit(1);
    return op?.role || "agent";
  } catch {
    return "agent";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXTO DA VALENTINA COLEGA — Dados do próprio operador
// Usado em: Módulo de Chat (fixado na lista), scope = "operator"
// ═══════════════════════════════════════════════════════════════════════════════
async function getOperatorContext(tenantId: string, operatorId: string): Promise<string> {
  try {
    const sections: string[] = [];

    // ── Conversas ativas do operador ─────────────────────────────────────────
    const activeConvs = await db
      .select({
        id: conversations.id,
        contactName: contacts.name,
        lastMessage: conversations.lastMessageText,
        lastTime: conversations.lastMessageTime,
        queueState: conversations.queueState,
        unread: conversations.unreadCount,
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
      .limit(15);

    if (activeConvs.length > 0) {
      const convList = activeConvs.map((c) => {
        const ago = Math.floor((Date.now() - new Date(c.lastTime).getTime()) / 60_000);
        return `  • ${c.contactName} (${c.queueState}) — última msg ${ago}min atrás${c.unread > 0 ? ` [${c.unread} não lidas]` : ""}: "${(c.lastMessage || "").slice(0, 80)}"`;
      }).join("\n");
      sections.push(`📋 SUAS CONVERSAS ATIVAS (${activeConvs.length}):\n${convList}`);
    } else {
      sections.push("📋 Você não tem conversas ativas no momento.");
    }

    // ── SLA pendentes do operador ─────────────────────────────────────────────
    const slaIssues = await db
      .select({
        conversationId: responseTimeLogs.conversationId,
        contactName: contacts.name,
        clientMsgAt: responseTimeLogs.clientMessageAt,
        isOverdue: responseTimeLogs.isOverdue,
      })
      .from(responseTimeLogs)
      .innerJoin(conversations, eq(conversations.id, responseTimeLogs.conversationId))
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(
        and(
          eq(responseTimeLogs.tenantId, tenantId),
          eq(responseTimeLogs.operatorId, operatorId),
          isNull(responseTimeLogs.agentResponseId)
        )
      )
      .orderBy(desc(responseTimeLogs.clientMessageAt))
      .limit(10);

    if (slaIssues.length > 0) {
      const slaList = slaIssues.map((s) => {
        const waitMin = Math.floor((Date.now() - new Date(s.clientMsgAt).getTime()) / 60_000);
        return `  • ${s.contactName} — aguardando há ${waitMin}min${s.isOverdue ? " 🚨 ESTOURADO" : ""}`;
      }).join("\n");
      sections.push(`⏱️ SEUS SLAs PENDENTES:\n${slaList}`);
    }

    // ── Métricas do operador no dia ───────────────────────────────────────────
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
      sections.push(`📊 SUAS MÉTRICAS DE HOJE:\n  • Total conversas: ${m.totalConversations}\n  • TMA: ${tma}\n  • SLA estourados: ${m.overdueCount}\n  • Score médio IA: ${m.avgPerformanceScore || "N/A"}/100`);
    }

    return sections.join("\n\n");
  } catch (err: any) {
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
  fileContext: string
): string {
  return `Você é ${persona.name}, I.A. de Business Intelligence e Gestão Comercial da ${persona.company}.
Você está conversando com o gestor "${operatorName}" em uma interface de chat exclusiva para supervisores.

## SEU PAPEL:
Você é uma analista de dados comerciais sênior. Seu objetivo é ajudar o gestor a tomar decisões estratégicas com base nos dados reais da operação.
- Quando pedirem gráficos, métricas, tabelas ou análises, gere os blocos estruturados correspondentes com os dados reais disponíveis.
- Seja precisa, objetiva e estratégica.
- Use os dados da operação abaixo como fonte primária — NÃO invente números.
- Se os dados não estiverem disponíveis, diga isso claramente.
- Tom profissional, analítico e consultivo.

## DADOS REAIS DA OPERAÇÃO AGORA:
${operationalContext}
${fileContext}

## ESTRUTURA DE BLOCOS SUPORTADOS (use "blocks" no JSON quando necessário):
1. ChartBlock: { "type": "chart", "chart": "bar"|"line"|"pie", "title": "...", "subtitle": "...", "unit": "...", "data": [{ "label": "X", "value": 10 }] }
2. InsightBlock: { "type": "insight", "title": "...", "items": [{ "label": "...", "value": "...", "delta": "+5%", "trend": "up"|"down"|"flat", "hint": "..." }], "recommendation": "..." }
3. ReportBlock: { "type": "report", "title": "...", "columns": ["A","B"], "rows": [["1","2"]], "footnote": "..." }
4. ExcerptBlock: { "type": "excerpt", "title": "...", "conversations": [{ "lead": "...", "channel": "WhatsApp", "when": "Hoje", "sentiment": "positivo"|"neutro"|"negativo", "lines": [{ "from": "lead"|"agente", "text": "..." }] }] }

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON):
{
  "fragments": [
    {
      "text": "mensagem explicativa em texto",
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
  fileContext: string
): string {
  return `Você é ${persona.name}, assistente pessoal de atendimento da ${persona.company}.
Você está conversando com ${operatorName}, um operador de atendimento.

## SEU PAPEL:
Você é como uma colega de trabalho experiente — prática, direta e descontraída. Ajude o operador com:
- As conversas ativas dele (leads, clientes pendentes)
- Alertas de SLA e clientes esperando resposta
- Métricas pessoais do dia
- Dicas de como responder situações difíceis
- Respostas rápidas a dúvidas sobre o produto ou processo

IMPORTANTE: Você só tem acesso aos dados do próprio ${operatorName}. Não compartilhe informações de outros operadores.
Tom: caloroso, colega de trabalho, direto ao ponto. Não seja formal demais.
Não use jargões de BI ou gestão — fale como uma parceira de trabalho.

## DADOS DO ${operatorName.toUpperCase()} AGORA:
${operatorContext}
${fileContext}

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON):
{
  "fragments": [
    {
      "text": "mensagem em texto direto e amigável",
      "delay": 0
    }
  ]
}`;
}

export const Route = createFileRoute("/api/valentina/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Carrega histórico de mensagens ────────────────────────────────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const operatorId = url.searchParams.get("operatorId");

        if (!tenantId || !operatorId) {
          return new Response(
            JSON.stringify({ error: "tenantId e operatorId são obrigatórios" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const scope = url.searchParams.get("scope") || "operator";

        try {
          const msgs = await db
            .select()
            .from(internalMessages)
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.operatorId, operatorId),
                sql`(${internalMessages.metadata}->>'scope' = ${scope} OR (${scope} = 'operator' AND (${internalMessages.metadata}->>'scope' IS NULL AND (${internalMessages.metadata}->>'type' IS NULL OR ${internalMessages.metadata}->>'isChat' = 'true'))))`
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
        try {
          const body = await request.json();
          const { tenantId, operatorId, content, scope = "operator", knowledgeBase, attachment, imageBase64 } = body;

          if (!tenantId || !operatorId) {
            return new Response(
              JSON.stringify({ error: "tenantId e operatorId são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          if (!content && !attachment && !imageBase64) {
            return new Response(
              JSON.stringify({ error: "content, attachment ou imageBase64 são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // ── Detecta se é Supervisora ou Colega ─────────────────────────────
          // scope "admin" → Valentina Supervisora (Módulo Valentina, só gestores)
          // scope "operator" → Valentina Colega (Módulo Chat, todos os operadores)
          const isSupervisor = scope === "admin";

          // Double-check pelo role do operador no banco por segurança
          const opRole = await getOperatorRole(operatorId);
          const isActuallyAdmin = opRole === "admin";

          // Se scope é "admin" mas o operador não é admin, trata como colega
          const useManagerContext = isSupervisor && isActuallyAdmin;

          const now = new Date();
          const persona = getAiPersona(tenantId);
          const operatorName = await getOperatorName(operatorId);
          const contextTenantId = knowledgeBase === "all" ? tenantId : (knowledgeBase || tenantId);

          // ── Salva mensagem do usuário no banco ─────────────────────────────
          const userMsgId = `val-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await db.insert(internalMessages).values({
            id: userMsgId,
            tenantId,
            operatorId,
            direction: "to_agent",
            agentType: "supervisor",
            content: content || `[Arquivo: ${attachment?.name ?? "imagem"}]`,
            metadata: {
              isChat: true,
              scope,
              knowledgeBase,
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
            fileContext = `\n\n📎 ARQUIVO ANEXADO: "${attachment.name}"\n${extracted}`;
          }

          const operationalContext = useManagerContext
            ? await getManagerContext(contextTenantId)
            : await getOperatorContext(contextTenantId, operatorId);

          // ── Seleciona o prompt correto ──────────────────────────────────────
          const systemPrompt = useManagerContext
            ? buildSupervisorPrompt(persona, operatorName, operationalContext, fileContext)
            : buildColeaguePrompt(persona, operatorName, operationalContext, fileContext);

          // ── Feature key para rastreamento de custos ─────────────────────────
          const featureKey = useManagerContext ? "supervisor_chat" : "valentina_chat";

          // ── Chama o Vertex AI ───────────────────────────────────────────────
          let fragments: { text: string; delay?: number; blocks?: any[] }[] = [];
          let alerts: any[] = [];

          try {
            const { vertexAi } = await import("../../../lib/vertex-ai");

            if (vertexAi.isReady()) {
              const aiRes = await vertexAi.generateStructuredJson<{
                fragments: { text: string; delay?: number; blocks?: any[] }[];
                alerts?: any[];
              }>(systemPrompt, "gemini-2.5-pro", undefined, {
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
                  : `Tô com uma dificuldade técnica agora 😅 Tenta de novo em um segundo?`,
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
              userMessage: { id: userMsgId, content, direction: "to_agent", createdAt: now },
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
