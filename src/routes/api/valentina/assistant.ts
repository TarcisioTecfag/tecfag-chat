import { createFileRoute } from "@tanstack/react-router";
import { vertexAi } from "../../../lib/vertex-ai";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import {
  expandPtBrAbbreviationsAndAccents,
  validateGrammarFidelity,
  buildGrammarPrompt,
  loadConversationRichContext,
  buildBestResponsePrompt,
  buildLeadSummaryPrompt,
} from "../../../lib/valentina/assistant-engine";

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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        try {
          const body = await request.json();
          const {
            action,
            conversationId,
            currentText = "",
            messages: clientMessages = [],
            contactName = "",
            operatorName = session.operator.name || "Consultor",
          } = body;

          if (!action) {
            return new Response(JSON.stringify({ error: "Parâmetro 'action' é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const persona = getAiPersona(tenantId);
          const featureKey = persona.chatFeatureKey;

          // ─── AÇÃO 1: CORRETOR GRAMATICAL & ORTOGRÁFICO (ULTRA-RÁPIDO & FIEL) ─────────
          if (action === "grammar_fix") {
            if (!currentText || !currentText.trim()) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error: "Nenhum texto informado para correção. Digite uma mensagem no chat primeiro.",
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            // Camada 1 (0ms): Expansão determinística de todas as abreviações (vc, pra, mt, tb, pq, q, etc.) e acentos
            const deterministicFixed = expandPtBrAbbreviationsAndAccents(currentText.trim());

            let finalCorrected = deterministicFixed;

            // Camada 2: Revisão gramatical fina via Gemini 2.5 Flash com thinkingBudget: 0 (baixa latência ~350ms)
            if (vertexAi.isReady()) {
              try {
                const prompt = buildGrammarPrompt(deterministicFixed);
                const timeoutSignal =
                  typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
                    ? AbortSignal.timeout(2500)
                    : undefined;

                const aiRaw = await vertexAi.generateText(
                  prompt,
                  "gemini-2.5-flash",
                  timeoutSignal,
                  {
                    feature: featureKey,
                    tenantId,
                    metadata: { conversationId, action },
                    generationConfig: {
                      temperature: 0.0,
                      maxOutputTokens: 320,
                      thinkingBudget: 0,
                    },
                  },
                );

                if (aiRaw && aiRaw.trim()) {
                  const cleanedAi = aiRaw
                    .trim()
                    .replace(/^["'“”]+|["'“”]+$/g, "")
                    .trim();

                  // Garante pós-processamento determinístico caso a IA tenha deixado alguma abreviação passar
                  const postProcessedAi = expandPtBrAbbreviationsAndAccents(cleanedAi);

                  // Valida fidelidade estrita (impede reescrita criativa, adição de saudações ou resposta à pergunta)
                  const fidelity = validateGrammarFidelity(deterministicFixed, postProcessedAi);
                  if (fidelity.valid) {
                    finalCorrected = postProcessedAi;
                  } else {
                    console.warn(
                      `[assistant.ts] Reescrita da IA rejeitada por guarda de fidelidade (${fidelity.reason}). Usando correção determinística fiel.`,
                    );
                  }
                }
              } catch (err: any) {
                console.warn(
                  "[assistant.ts] Fallback determinístico acionado no corretor gramatical:",
                  err?.message,
                );
              }
            }

            return new Response(
              JSON.stringify({
                success: true,
                action,
                text: finalCorrected,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // ─── AÇÃO 2: MELHOR RESPOSTA (CONTEXTUALIZADA COM HISTÓRICO, CRM E CATÁLOGO) ──
          if (action === "best_response") {
            const richContext = await loadConversationRichContext({
              tenantId,
              conversationId,
              clientMessages,
              contactName,
              maxMessages: 25,
            });

            const prompt = await buildBestResponsePrompt({
              tenantId,
              operatorName,
              contactName,
              currentDraftText: currentText,
              richContext,
            });

            const generated = await vertexAi.generateText(
              prompt,
              "gemini-2.5-flash",
              undefined,
              {
                feature: featureKey,
                tenantId,
                metadata: { conversationId, action },
                generationConfig: {
                  temperature: 0.3,
                  maxOutputTokens: 360,
                  thinkingBudget: 0,
                },
              },
            );

            const cleanedText = (generated || "")
              .trim()
              .replace(/^["'“”]+|["'“”]+$/g, "")
              .replace(/\[SEND_IMAGE:[^\]]+\]/gi, "")
              .trim();

            if (!cleanedText) {
              throw new Error(`Não foi possível gerar a sugestão com ${persona.name} agora.`);
            }

            return new Response(
              JSON.stringify({
                success: true,
                action,
                text: cleanedText,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // ─── AÇÃO 3: RESUMO DO ATENDIMENTO / LEAD (HISTÓRICO COMPLETO + CRM) ──────────
          if (action === "lead_summary") {
            const richContext = await loadConversationRichContext({
              tenantId,
              conversationId,
              clientMessages,
              contactName,
              maxMessages: 60,
            });

            const prompt = buildLeadSummaryPrompt({
              tenantId,
              contactName,
              richContext,
            });

            const summary = await vertexAi.generateText(
              prompt,
              "gemini-2.5-flash",
              undefined,
              {
                feature: featureKey,
                tenantId,
                metadata: { conversationId, action },
                generationConfig: {
                  temperature: 0.15,
                  maxOutputTokens: 650,
                  thinkingBudget: 0,
                },
              },
            );

            const cleanedSummary = (summary || "").trim();
            if (!cleanedSummary) {
              throw new Error(`Não foi possível gerar o resumo com ${persona.name} agora.`);
            }

            return new Response(
              JSON.stringify({
                success: true,
                action,
                text: cleanedSummary,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          return new Response(JSON.stringify({ error: `Ação '${action}' desconhecida` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error: any) {
          console.error("[assistant.ts] Erro ao processar assistente de IA:", error);
          return new Response(
            JSON.stringify({ error: error.message || "Falha no processamento de IA" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
