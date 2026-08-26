import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { conversations, messages, contacts } from "../../../db/schema";
import { eq, desc } from "drizzle-orm";
import { vertexAi } from "../../../lib/vertex-ai";
import { getKnowledgeBaseContext } from "../../../lib/valentina/knowledge-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/valentina/assistant")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const {
            tenantId = "valem",
            action,
            conversationId,
            currentText = "",
            messages: clientMessages = [],
            contactName = "",
            operatorName = "Vendedor",
          } = body;

          if (!action) {
            return new Response(JSON.stringify({ error: "Parâmetro 'action' é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Busca base de conhecimento da Valem
          const knowledgeContext = await getKnowledgeBaseContext(tenantId);

          // Obtém mensagens recentes para contexto
          let recentHistory = "";
          if (Array.isArray(clientMessages) && clientMessages.length > 0) {
            recentHistory = clientMessages
              .slice(-15)
              .map((m: any) => `${m.side === "in" || m.sender === "client" ? "Cliente" : "Vendedor"}: ${m.text || m.content || ""}`)
              .join("\n");
          } else if (conversationId && conversationId !== "valentina") {
            try {
              const dbMsgs = await db
                .select({
                  content: messages.content,
                  senderType: messages.senderType,
                  sentAt: messages.sentAt,
                })
                .from(messages)
                .where(eq(messages.conversationId, conversationId))
                .orderBy(desc(messages.sentAt))
                .limit(15);

              recentHistory = dbMsgs
                .reverse()
                .map((m) => `${m.senderType === "contact" || m.senderType === "client" ? "Cliente" : "Vendedor"}: ${m.content}`)
                .join("\n");
            } catch (err) {
              console.warn("[assistant.ts] Aviso ao buscar mensagens do banco:", err);
            }
          }

          // ─── AÇÃO 1: MELHOR RESPOSTA ──────────────────────────────────────────
          if (action === "best_response") {
            const prompt = `Você é a IA Valentina, assistente comercial sênior e especialista técnica da Valem Válvulas e Embalagens.
O vendedor ${operatorName} está atendendo o cliente ${contactName || "Cliente"} no WhatsApp e precisa da MELHOR resposta comercial, empática, persuasiva e precisa para enviar AGORA.

${knowledgeContext}

HISTÓRICO RECENTE DA CONVERSA:
${recentHistory || "Nenhuma mensagem anterior no histórico. O cliente acabou de iniciar o contato."}

${currentText ? `RASCUNHO DIGITADO PELO VENDEDOR (SE ÚTIL):\n"${currentText}"\n` : ""}

DIRETRIZES PARA A RESPOSTA:
1. Escreva em 1ª pessoa ("nós temos", "posso verificar para você", "nossa válvula...", etc.) ou pronta para o vendedor enviar diretamente.
2. Seja ágil, direto, prestativo e comercialmente acolhedor.
3. Se o cliente perguntou de produto/rosca/frasco, responda com precisão técnica e ofereça o modelo ideal.
4. Lembre-se das regras fundamentais da Valem:
   - Atacado WhatsApp B2B (CNPJ): Pedido mínimo de 1.000 unidades por item, faturado/condições comerciais especiais.
   - E-commerce (site www.valempack.com.br): Aberto para CPF e CNPJ a partir de 50 unidades, com 15% de desconto PJ.
5. NUNCA adicione saudações repetitivas se a conversa já estiver em andamento.
6. Retorne APENAS o texto exato da mensagem sugerida, sem explicações extras, aspas ou títulos.`;

            const generated = await vertexAi.generateText(prompt, "gemini-2.5-flash", undefined, {
              feature: "valentina_chat",
              tenantId,
              metadata: { conversationId, action },
            });

            return new Response(
              JSON.stringify({
                success: true,
                action,
                text: (generated || "").trim().replace(/^"|"$/g, ""),
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // ─── AÇÃO 2: CORRETOR GRAMATICAL ──────────────────────────────────────
          if (action === "grammar_fix") {
            if (!currentText || !currentText.trim()) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error: "Nenhum texto informado para correção. Digite uma mensagem no chat primeiro.",
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            const prompt = `Você é um revisor de texto e corretor gramatical em língua portuguesa para atendimento comercial no WhatsApp da Valem Válvulas e Embalagens.

TEXTO DO VENDEDOR PARA CORRIGIR:
"${currentText}"

REGRAS INVIOLÁVEIS:
1. Corrija APENAS erros gramaticais, ortográficos, de pontuação, concordância e acentuação.
2. NUNCA altere o sentido da mensagem, a intenção, as palavras-chave comerciais (nomes de válvulas, roscas como 24/410, 28/410, ml, un) ou o estilo de comunicação do vendedor.
3. Não mude a estrutura da frase a menos que haja erro gramatical grave.
4. Mantenha eventuais quebras de linha e emojis existentes intactos.
5. Retorne APENAS o texto corrigido, sem qualquer comentário, aspas adicionais ou introdução.`;

            const corrected = await vertexAi.generateText(prompt, "gemini-2.5-flash", undefined, {
              feature: "valentina_chat",
              tenantId,
              metadata: { conversationId, action },
            });

            return new Response(
              JSON.stringify({
                success: true,
                action,
                text: (corrected || "").trim().replace(/^"|"$/g, ""),
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // ─── AÇÃO 3: RESUMO DO LEAD ───────────────────────────────────────────
          if (action === "lead_summary") {
            const prompt = `Você é a IA Valentina, assistente de inteligência comercial da Valem Válvulas e Embalagens.
Analise a conversa abaixo e gere um RESUMO ESTRUTURADO DO LEAD em tópicos objetivos para registro interno.

HISTÓRICO DA CONVERSA:
${recentHistory || "Histórico vazio."}

${contactName ? `NOME DO CONTATO: ${contactName}` : ""}

FORMATO OBRIGATÓRIO (SEM EMOJIS, TEXTO LIMPO E PROFISSIONAL):
[RESUMO DO LEAD]
- Necessidade: (Quais produtos, medidas de rosca, frascos ou volumes o cliente procura)
- Perfil e Dados: (Se é CNPJ/Atacado ou CPF/Varejo, segmento da empresa, estimativa de quantidade se informada)
- Situacao Atual: (Em qual etapa parou a negociação ou qual a última dúvida/pendência)
- Proximo Passo: (Ação comercial clara e recomendada para o vendedor)

Retorne APENAS os 4 tópicos acima estruturados, sem comentários adicionais.`;

            const summary = await vertexAi.generateText(prompt, "gemini-2.5-flash", undefined, {
              feature: "valentina_chat",
              tenantId,
              metadata: { conversationId, action },
            });

            return new Response(
              JSON.stringify({
                success: true,
                action,
                text: (summary || "").trim(),
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(JSON.stringify({ error: `Ação '${action}' desconhecida` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error: any) {
          console.error("[assistant.ts] Erro ao processar assistente da Valentina:", error);
          return new Response(
            JSON.stringify({ error: error.message || "Falha no processamento de IA" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
