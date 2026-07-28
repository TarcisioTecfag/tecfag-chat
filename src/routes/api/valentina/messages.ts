import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { internalMessages } from "../../../db/schema";
import { eq, and, desc } from "drizzle-orm";

// ── Headers CORS padrão ────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Respostas mock contextuais da Valentina ────────────────────────────────────
// Baseadas em palavras-chave na mensagem do operador.
// Futuramente será substituído pela integração real com a IA.
function generateMockResponse(userMessage: string): string {
  const msg = userMessage.toLowerCase();

  if (msg.includes("lead") || msg.includes("prospect") || msg.includes("contato novo")) {
    return "📊 Analisei os leads recentes. Temos 12 novos contatos na fila hoje, 3 são recontatos. Recomendo priorizar os que vieram por indicação — historicamente convertem 2.3x mais.";
  }
  if (msg.includes("meta") || msg.includes("resultado") || msg.includes("desempenho")) {
    return "📈 Seu desempenho está acima da média hoje! Tempo de resposta: 2min 34s (meta: 5min). Taxa de conversão: 18% (meta: 15%). Continue assim! 💪";
  }
  if (msg.includes("objeção") || msg.includes("preço") || msg.includes("caro") || msg.includes("desconto")) {
    return "💡 Dica para objeção de preço: Foque no valor, não no custo. Mostre o ROI em 3 meses. Exemplo: \"Com nosso sistema, você economiza 15h/semana em gestão — isso vale mais que o investimento mensal.\"";
  }
  if (msg.includes("script") || msg.includes("abordagem") || msg.includes("como falar")) {
    return "📝 Script sugerido para primeira abordagem:\n\n\"Olá [Nome]! Vi que você demonstrou interesse em [Produto]. Posso te mostrar como empresas do seu segmento estão usando para [benefício específico]?\"";
  }
  if (msg.includes("transfer") || msg.includes("escalar") || msg.includes("supervisor")) {
    return "🔄 Entendido! Para transferir a conversa, use o botão de transferência no chat. Se for urgente, posso notificar o supervisor disponível agora mesmo.";
  }
  if (msg.includes("fila") || msg.includes("pendente") || msg.includes("espera")) {
    return "⏳ Situação da fila agora:\n• 5 conversas aguardando\n• Tempo médio de espera: 3min 12s\n• Operadores disponíveis: 3/5\n\nRecomendo capturar as 2 mais antigas primeiro.";
  }
  if (msg.includes("ajuda") || msg.includes("help") || msg.includes("o que você faz")) {
    return "🤖 Sou a Valentina, sua assistente de vendas! Posso te ajudar com:\n\n• 📊 Análise de leads e priorização\n• 💡 Dicas de abordagem e objeções\n• 📈 Métricas de desempenho\n• 🔄 Transferências e escalações\n• ⏳ Status da fila de atendimento\n\nÉ só perguntar!";
  }

  // Resposta genérica quando não encontra palavra-chave
  return "✅ Entendi sua mensagem. Estou processando e em breve terei uma análise mais detalhada. Enquanto isso, posso te ajudar com algo específico? (leads, métricas, objeções, fila)";
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
                eq(internalMessages.operatorId, operatorId)
              )
            )
            .orderBy(desc(internalMessages.createdAt))
            .limit(100);

          // Retorna em ordem cronológica (mais antigo primeiro) para renderizar no chat
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

      // ── POST: Enviar mensagem para Valentina e receber resposta mock ────────
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
            metadata: {},
            read: 1,
            createdAt: now,
          });

          // 2. Gerar resposta inteligente via Vertex AI Gemini 2.5 Pro
          let aiContent = "";
          try {
            const { vertexAi } = await import("../../../lib/vertex-ai");
            const { getKnowledgeBaseContext } = await import("../../../lib/valentina/knowledge-service");
            if (vertexAi.isReady()) {
              const knowledgeContext = await getKnowledgeBaseContext(tenantId);
              const systemPrompt = `Você é a Valentina, a assistente virtual e supervisora inteligente da equipe de vendas da Valem.
Sua função é auxiliar o operador/vendedor com informações de produtos, catálogo, leads, scripts de vendas, quebra de objeções, análise de metas e dicas para fechar negócios.
${knowledgeContext}

Responda de forma direta, altamente profissional, entusiasmada e útil, utilizando emojis quando apropriado.

Mensagem do operador: "${content}"`;


              const aiRes = await vertexAi.generateText(systemPrompt, "gemini-2.5-pro", undefined, {
                tenantId,
                feature: "supervisor_chat",
                metadata: { operatorId },
              });
              if (aiRes) {
                aiContent = aiRes;
              }
            }
          } catch (aiErr: any) {
            console.warn("[valentina/messages] Vertex AI fallback:", aiErr?.message);
          }

          if (!aiContent) {
            aiContent = generateMockResponse(content);
          }
          const aiMsgId = `val-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const aiTimestamp = new Date(now.getTime() + 800); // Simula delay de 800ms

          await db.insert(internalMessages).values({
            id: aiMsgId,
            tenantId,
            operatorId,
            direction: "from_agent",
            agentType: "supervisor",
            content: aiContent,
            metadata: { mock: true },
            read: 0,
            createdAt: aiTimestamp,
          });

          return new Response(
            JSON.stringify({
              success: true,
              userMessage: { id: userMsgId, content, direction: "to_agent", createdAt: now },
              aiResponse: { id: aiMsgId, content: aiContent, direction: "from_agent", createdAt: aiTimestamp },
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
