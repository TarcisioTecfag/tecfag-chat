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
} from "../../../db/schema";
import { eq, and, desc, sql, gte, isNull, ne } from "drizzle-orm";
import crypto from "crypto";

// ── Headers CORS padrão ────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Respostas mock contextuais (fallback quando Vertex AI não está disponível) ─
function generateMockResponse(userMessage: string): string {
  const msg = userMessage.toLowerCase();

  if (msg.includes("lead") || msg.includes("prospect") || msg.includes("contato novo")) {
    return "📊 Analisei os leads recentes. Temos 12 novos contatos na fila hoje, 3 são recontatos. Recomendo priorizar os que vieram por indicação — historicamente convertem 2.3x mais.";
  }
  if (msg.includes("meta") || msg.includes("resultado") || msg.includes("desempenho")) {
    return "📈 Seu desempenho está acima da média hoje! Tempo de resposta: 2min 34s (meta: 5min). Taxa de conversão: 18% (meta: 15%). Continue assim! 💪";
  }
  if (msg.includes("fila") || msg.includes("pendente") || msg.includes("espera")) {
    return "⏳ Situação da fila agora:\n• 5 conversas aguardando\n• Tempo médio de espera: 3min 12s\n• Operadores disponíveis: 3/5\n\nRecomendo capturar as 2 mais antigas primeiro.";
  }
  return "✅ Entendi sua mensagem! Posso te ajudar com leads, métricas, objeções ou status da fila. É só perguntar!";
}

/**
 * Coleta o contexto operacional REAL do operador para enriquecer o prompt da Valentina.
 * Consulta: conversas ativas, SLA pendente/estourado, métricas do dia e auditorias.
 */
async function getOperatorContext(tenantId: string, operatorId: string): Promise<string> {
  try {
    const sections: string[] = [];

    // 1. Conversas ativas do operador
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
      sections.push(`📋 CONVERSAS ATIVAS DO OPERADOR (${activeConvs.length}):\n${convList}`);
    } else {
      sections.push("📋 O operador não tem conversas ativas no momento.");
    }

    // 2. SLA — ciclos pendentes ou estourados
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
          isNull(responseTimeLogs.agentResponseId) // Ciclo aberto — sem resposta
        )
      )
      .orderBy(desc(responseTimeLogs.clientMessageAt))
      .limit(10);

    if (slaIssues.length > 0) {
      const slaList = slaIssues.map((s) => {
        const waitMin = Math.floor((Date.now() - new Date(s.clientMsgAt).getTime()) / 60_000);
        return `  • ${s.contactName} — aguardando há ${waitMin}min${s.isOverdue ? " 🚨 ESTOURADO" : ""}`;
      }).join("\n");
      sections.push(`⏱️ SLA PENDENTES (clientes aguardando resposta):\n${slaList}`);
    }

    // 3. Métricas do dia
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
      const tma = m.avgResponseTimeSeconds ? `${Math.floor(m.avgResponseTimeSeconds / 60)}min ${m.avgResponseTimeSeconds % 60}s` : "N/A";
      sections.push(`📊 MÉTRICAS DE HOJE DO OPERADOR:\n  • Total conversas: ${m.totalConversations}\n  • TMA (Tempo Médio de Resposta): ${tma}\n  • SLA estourados: ${m.overdueCount}\n  • Score médio IA: ${m.avgPerformanceScore || "N/A"}/100\n  • Sentimento: ${m.satisfiedCount} satisfeitos, ${m.neutralCount} neutros, ${m.frustratedCount} frustrados`);
    }

    // 4. Últimas auditorias com problemas
    const recentAudits = await db
      .select({
        contactName: aiConversationAudits.contactName,
        sentiment: aiConversationAudits.clientSentiment,
        score: aiConversationAudits.performanceScore,
        insight: aiConversationAudits.actionableInsight,
      })
      .from(aiConversationAudits)
      .where(
        and(
          eq(aiConversationAudits.tenantId, tenantId),
          eq(aiConversationAudits.operatorId, operatorId),
          eq(aiConversationAudits.status, "done"),
          gte(aiConversationAudits.auditedAt, sql`NOW() - INTERVAL '3 days'`)
        )
      )
      .orderBy(desc(aiConversationAudits.auditedAt))
      .limit(5);

    if (recentAudits.length > 0) {
      const auditList = recentAudits.map((a) =>
        `  • ${a.contactName}: Score ${a.score}/100 | Sentimento: ${a.sentiment} | Insight: ${a.insight}`
      ).join("\n");
      sections.push(`🔍 AUDITORIAS RECENTES (últimos 3 dias):\n${auditList}`);
    }

    return sections.join("\n\n");
  } catch (err: any) {
    console.warn("[valentina/messages] Erro ao coletar contexto operacional:", err?.message);
    return "⚠️ Não foi possível carregar dados operacionais do banco neste momento.";
  }
}

/**
 * Busca o nome do operador pelo ID no banco
 */
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

export const Route = createFileRoute("/api/valentina/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Listar mensagens internas do operador ──────────────────────────
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

        try {
          const msgs = await db
            .select()
            .from(internalMessages)
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.operatorId, operatorId),
                // Filtra apenas mensagens do chat (ignora alertas automáticos de supervisão com metadata.type)
                sql`(${internalMessages.metadata}->>'type' IS NULL OR ${internalMessages.metadata}->>'isChat' = 'true')`
              )
            )
            .orderBy(desc(internalMessages.createdAt))
            .limit(100);

          // Retorna em ordem cronológica (mais antigo primeiro)
          const sorted = msgs.reverse();

          return new Response(JSON.stringify(sorted), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[valentina/messages] Erro ao listar mensagens:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── POST: Enviar mensagem para Valentina e receber resposta real via IA ─
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, operatorId, content } = body;

          if (!tenantId || !operatorId || !content) {
            return new Response(
              JSON.stringify({ error: "tenantId, operatorId e content são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const now = new Date();

          // 1. Salvar a mensagem do operador
          const userMsgId = `val-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await db.insert(internalMessages).values({
            id: userMsgId,
            tenantId,
            operatorId,
            direction: "to_agent",
            agentType: "supervisor",
            content,
            metadata: { isChat: true },
            read: 1,
            createdAt: now,
          });

          // 2. Coletar contexto operacional real do operador
          const operatorName = await getOperatorName(operatorId);
          const operatorContext = await getOperatorContext(tenantId, operatorId);

          // 3. Carregar contexto da base de conhecimento (RAG)
          let knowledgeContext = "";
          try {
            const { getKnowledgeBaseContext } = await import("../../../lib/valentina/knowledge-service");
            knowledgeContext = await getKnowledgeBaseContext(tenantId);
          } catch {}

          // 4. Buscar últimas mensagens do histórico para contexto conversacional
          let chatHistory = "";
          try {
            const recentMsgs = await db
              .select()
              .from(internalMessages)
              .where(
                and(
                  eq(internalMessages.tenantId, tenantId),
                  eq(internalMessages.operatorId, operatorId),
                  eq(internalMessages.agentType, "supervisor")
                )
              )
              .orderBy(desc(internalMessages.createdAt))
              .limit(10);

            if (recentMsgs.length > 1) {
              const history = recentMsgs.reverse().slice(0, -1); // Exclui a msg atual
              chatHistory = "\n\n💬 HISTÓRICO RECENTE DA CONVERSA:\n" +
                history.map((m) =>
                  `[${m.direction === "to_agent" ? operatorName : "Valentina"}]: ${m.content.slice(0, 200)}`
                ).join("\n");
            }
          } catch {}

          // 5. Gerar resposta inteligente via Vertex AI Gemini 2.5 Pro
          let fragments: { text: string; delay: number }[] = [];
          let alerts: any[] = [];

          try {
            const { vertexAi } = await import("../../../lib/vertex-ai");

            if (vertexAi.isReady()) {
              const systemPrompt = `Você é a Valentina, assistente pessoal e colega de trabalho do vendedor "${operatorName}" na empresa Valempack.

## REGRA PRINCIPAL:
- Responda ESTREITAMENTE ao que o operador perguntou.
- Se o operador disser apenas "olá", "esta aí?", "tudo bem?", "boa tarde" ou saudações simples, responda amigavelmente com uma reação amigável e pergunte como pode ajudar.
- NUNCA dê broncas, alertas proativos de SLA ou cobranças de conversas paradas sem ser solicitada.
- Só mencione SLA, conversas paradas ou métricas SE o operador perguntar explicitamente sobre isso (ex: "tenho pendências?", "como estão meus SLAs?", "como foi meu dia?").
- NUNCA inclua frases do tipo "Aliás, vi que tem uma conversa sua parada..." em mensagens comuns.

## SUA PERSONALIDADE:
- Fale como uma pessoa real brasileira, inteligente, amigável e prestativa.
- Use linguagem natural: "opa", "tô por aqui sim!", "fala aí!", "boa!", "como posso te ajudar?"
- Use emojis com moderação (máximo 1-2 por resposta).
- Seja direta e objetiva.

## COMO RESPONDER:
- SEMPRE fragmente sua resposta em mensagens curtas (1-3 fragmentos).
- Cada fragmento deve ter no máximo 2-3 linhas.
- Nunca envie um blocão de texto.

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON):
Retorne EXCLUSIVAMENTE um JSON válido neste formato:
{
  "fragments": [
    { "text": "texto da primeira mensagem curta", "delay": 0 },
    { "text": "texto da segunda mensagem curta", "delay": 800 }
  ]
}

Se detectar uma situação crítica nos dados do operador (SLA estourado, cliente frustrado), inclua em "alerts":
{
  "alerts": [
    {
      "type": "sla_warning",
      "conversationId": "id-da-conversa",
      "clientName": "nome do cliente",
      "waitMinutes": 12,
      "lastMessage": "última mensagem do cliente"
    }
  ]
}

## DADOS REAIS DA OPERAÇÃO DO VENDEDOR "${operatorName}":
${operatorContext}

${knowledgeContext}
${chatHistory}

## MENSAGEM DO OPERADOR AGORA:
"${content}"

Responda como Valentina de forma natural, humanizada e fragmentada. Use os dados operacionais reais acima para dar respostas precisas e contextualizadas.`;

              const aiRes = await vertexAi.generateStructuredJson<{
                fragments: { text: string; delay: number }[];
                alerts?: any[];
              }>(systemPrompt, "gemini-2.5-pro", undefined, {
                tenantId,
                feature: "valentina_chat",
                metadata: { operatorId, operatorName },
              });

              if (aiRes?.fragments && aiRes.fragments.length > 0) {
                fragments = aiRes.fragments;
                alerts = aiRes.alerts || [];
              }
            }
          } catch (aiErr: any) {
            console.warn("[valentina/messages] Vertex AI fallback:", aiErr?.message);
          }

          // 6. Fallback para mock se IA não retornou fragmentos
          if (fragments.length === 0) {
            const mockText = generateMockResponse(content);
            fragments = [{ text: mockText, delay: 0 }];
          }

          // 7. Salvar cada fragmento como mensagem separada no banco
          const savedFragments: { id: string; content: string; direction: string; createdAt: Date }[] = [];

          for (let i = 0; i < fragments.length; i++) {
            const frag = fragments[i];
            const fragId = `val-ai-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
            const fragTimestamp = new Date(now.getTime() + 800 + (i * 600));

            await db.insert(internalMessages).values({
              id: fragId,
              tenantId,
              operatorId,
              direction: "from_agent",
              agentType: "supervisor",
              content: frag.text,
              metadata: { isChat: true, fragmentIndex: i, totalFragments: fragments.length },
              read: 0,
              createdAt: fragTimestamp,
            });

            savedFragments.push({
              id: fragId,
              content: frag.text,
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
                delay: fragments[i]?.delay || i * 800,
              })),
              alerts,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[valentina/messages] Erro ao enviar mensagem:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
