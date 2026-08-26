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

          // Obtém mensagens recentes para contexto (apenas quando necessário)
          let recentHistory = "";
          if (action === "best_response" || action === "lead_summary") {
            if (Array.isArray(clientMessages) && clientMessages.length > 0) {
              recentHistory = clientMessages
                .slice(-12)
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
                  .limit(12);

                recentHistory = dbMsgs
                  .reverse()
                  .map((m) => `${m.senderType === "contact" || m.senderType === "client" ? "Cliente" : "Vendedor"}: ${m.content}`)
                  .join("\n");
              } catch (err) {
                console.warn("[assistant.ts] Aviso ao buscar mensagens do banco:", err);
              }
            }
          }

          // ─── AÇÃO 1: CORRETOR GRAMATICAL & ORTOGRÁFICO (INSTANTÂNEO) ─────────
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

            const prompt = `Você é um revisor e corretor gramatical em tempo real para atendimento comercial no WhatsApp da Valem Válvulas e Embalagens.

TEXTO DO VENDEDOR PARA CORRIGIR:
"${currentText}"

INSTRUÇÕES OBRIGATÓRIAS:
1. Corrija toda a ortografia, concordância verbal/nominal, acentuação e pontuação (vírgulas, ponto final, interrogação).
2. EXPANDA OBRIGATORIAMENTE todas as abreviações e gírias de chat/internet para português formal correto por extenso:
   - "mt" -> "muito"
   - "vc" -> "você", "vcs" -> "vocês"
   - "pq" -> "porque" ou "por que"
   - "tb" ou "tbm" -> "também"
   - "td" ou "tds" -> "tudo" ou "todos"
   - "pra" -> "para", "pro" -> "para o"
   - "q" -> "que"
   - "kd" -> "cadê"
   - "blz" -> "beleza"
   - "oq" -> "o que"
   - "obg" ou "obgd" -> "obrigado" / "obrigada"
3. Preserve termos técnicos, códigos de produtos, medidas e números (ex: 24/410, 28/410, 18/410, 100ml, un, R$).
4. Mantenha emojis e quebras de linha existentes.
5. Retorne APENAS o texto corrigido final, sem aspas, sem títulos e sem explicações.`;

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

          // ─── AÇÃO 2: MELHOR RESPOSTA (HUMANA, CURTA E OBJETIVA) ──────────────
          if (action === "best_response") {
            const prompt = `Você é uma consultora de vendas sênior, experiente e muito prática da Valem Válvulas e Embalagens atendendo no WhatsApp.
O vendedor ${operatorName} está atendendo o cliente ${contactName || "Cliente"} e precisa da MELHOR resposta comercial para enviar AGORA.

REGRAS COMERCIAIS CHAVE:
- Produtos: Válvulas Spray (líquidos/perfumes), Válvulas Pump/Saboneteira (cremes/álcool), Mini Triggers (borrifadores), Tampas Luxo (Dourada, Prata, Bamboo), Frascos e Potes de Vidro Âmbar (10ml a 100ml). Roscas: 18/410, 20/410, 24/410, 28/410.
- Atacado WhatsApp B2B (CNPJ): Mínimo 1.000 unidades por item, com faturamento e condições especiais.
- Varejo/Amostras (Site www.valempack.com.br): A partir de 50 unidades com 15% de desconto para PJ.

HISTÓRICO DA CONVERSA NO WHATSAPP:
${recentHistory || "Cliente acabou de iniciar o contato."}

${currentText ? `RASCUNHO DO VENDEDOR:\n"${currentText}"\n` : ""}

DIRETRIZES DE TOM (WHATSAPP REAL):
1. Escreva uma resposta ULTRA-CURTA, NATURAL, DIRETA E HUMANA (máximo de 1 a 3 frases).
2. Escreva como uma pessoa de verdade responde no WhatsApp: NADA de textos gigantes, NADA de introduções robóticas como "Olá, tudo bem? Sou a assistente...".
3. Responda direto à dúvida/necessidade do cliente e termine com uma pergunta prática de fechamento ou continuidade (ex: qual quantidade precisa, qual a rosca do frasco dele, ou cor desejada).
4. Retorne APENAS o texto da mensagem sugerida, sem aspas e sem explicações.`;

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

          // ─── AÇÃO 3: RESUMO DO LEAD ───────────────────────────────────────────
          if (action === "lead_summary") {
            const prompt = `Você é a assistente de inteligência comercial da Valem Válvulas e Embalagens.
Analise a conversa abaixo e gere um RESUMO ESTRUTURADO DO LEAD em 4 tópicos objetivos:

HISTÓRICO DA CONVERSA:
${recentHistory || "Histórico vazio."}
${contactName ? `NOME DO CONTATO: ${contactName}` : ""}

FORMATO OBRIGATÓRIO (TEXTO DIRETO E LIMPO):
[RESUMO DO LEAD]
- Necessidade: (Produtos, medidas de rosca, frascos ou volumes procurados)
- Perfil e Dados: (CNPJ/Atacado ou CPF/Site, segmento e volume estimado)
- Situacao Atual: (Última dúvida ou etapa da conversa)
- Proximo Passo: (Ação comercial recomendada para o vendedor)

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
