// src/lib/valentina/sdr-followup-engine.ts
//
// Motor de Follow-ups Inteligentes Temporizados para Triagens SDR inativas.
// Roda a cada 60s buscando conversas elegíveis (valem, sdr, in_progress, sem operador, última msg do bot).
// Régua:
//   followUpStage 0 + silêncio >= 6min  ? Follow-up 1: texto consultivo Gemini
//   followUpStage 1 + silêncio >= 15min ? Follow-up 2: texto consultivo Gemini
//   followUpStage 2 + silêncio >= 20min ? Follow-up 3: áudio ElevenLabs + ligação Twilio em 15s

import { db } from "../../db";
import { agentFlowStates, conversations, messages } from "../../db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { vertexAi } from "../vertex-ai";
import { triggerOutboundCallInternal } from "../voice/outbound-call-service";
import { SdrEngine } from "./sdr-engine";

const FOLLOWUP_INTERVAL_MS = 60_000; // 60 segundos
const TENANT_ID = "valem"; // Exclusivo para valem — tecfag permanece inativo

// Tempos de silêncio em milissegundos
const SILENCE_FU1_MS = 6 * 60 * 1000;   // 6 minutos
const SILENCE_FU2_MS = 15 * 60 * 1000;  // 15 minutos
const SILENCE_FU3_MS = 20 * 60 * 1000;  // 20 minutos

let engineTimer: NodeJS.Timeout | null = null;

/**
 * Gera um texto de follow-up personalizado pelo Gemini relendo o histórico real da conversa
 */
async function generateFollowUpText(
  conversationId: string,
  stage: number,
  collectedData: Record<string, any>
): Promise<string> {
  try {
    const historyMsgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.sentAt))
      .limit(30);

    const historyText = historyMsgs
      .map((m: any) => {
        const sender = m.senderType === "client" ? "Cliente" : "Valentina";
        let content = m.content || "";
        if (content.startsWith("[MEDIA:audio]") && m.mediaInterpretation) {
          content = `[ÁUDIO: "${m.mediaInterpretation}"]`;
        }
        return `${sender}: ${content}`;
      })
      .join("\n");

    const dataEntries = Object.entries(collectedData)
      .filter(([, v]: any) => v?.value)
      .map(([k, v]: any) => `${k}: ${v.value}`)
      .join(", ");

    const stageContext = stage === 1
      ? "Este é o PRIMEIRO follow-up (6 minutos de silêncio). Seja breve, calorosa e incentivadora. Pode lembrar rapidamente o que foi perguntado e pedir que o cliente responda."
      : "Este é o SEGUNDO follow-up (15 minutos de silêncio). Seja empática mas mais direta. Destaque que a cotação está praticamente pronta e só precisa de uma informação rápida. Mencione que agendamentos de entrega costumam ter prazo.";

    const prompt = `Você é Valentina, consultora SDR da Valem Válvulas e Embalagens. Um lead parou de responder no WhatsApp durante a triagem.

HISTÓRICO DA CONVERSA:
${historyText}

DADOS JÁ COLETADOS:
${dataEntries || "Nenhum dado coletado ainda"}

INSTRUÇÃO: ${stageContext}

Gere UMA mensagem de follow-up natural e humanizada, de no máximo 2 frases, como se fosse uma pessoa enviando no WhatsApp. Não use linguagem robótica ou de cobrança automática. Não use emojis em excesso. Responda APENAS com o texto da mensagem, sem aspas, sem prefixo.`;

    const result = await vertexAi.generateText(
      prompt,
      "gemini-2.0-flash",
      undefined,
      {
        feature: "sdr_agent",
        tenantId: TENANT_ID,
        metadata: { conversationId, followUpStage: stage },
      }
    );

    return result?.trim() || (stage === 1
      ? "Oi! Tudo bem? Vi que ficou uma informação pendente na nossa conversa — me responde quando puder! ??"
      : "Olá! Nossa cotação está praticamente pronta, só preciso de uma informação rápida sua para fechar os detalhes. Pode me responder?"
    );
  } catch (err: any) {
    console.error(`[FollowupEngine] Erro ao gerar texto Gemini (stage ${stage}):`, err?.message);
    return stage === 1
      ? "Oi! Tudo bem? Vi que ficou uma informação pendente na nossa conversa — me responde quando puder! ??"
      : "Olá! Nossa cotação está praticamente pronta, só preciso de uma informação rápida sua para fechar os detalhes. Pode me responder?";
  }
}

/**
 * Busca credenciais Twilio do agentConfig do banco para o tenant valem
 */
async function getTwilioCredentials(): Promise<{ accountSid?: string; authToken?: string }> {
  try {
    const cfg = await db.query.agentConfigs.findFirst({
      where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, TENANT_ID), dEq(t.agentType, "sdr")),
    });
    const configData = (cfg?.config as Record<string, any>) || {};
    return {
      accountSid: configData.twilioAccountSid || configData.twilioSid,
      authToken: configData.twilioAuthToken || configData.twilioToken,
    };
  } catch {
    return {};
  }
}

/**
 * Executa um ciclo de varredura buscando conversas elegíveis para follow-up
 */
async function runFollowupCycle() {
  try {
    // Buscar agentFlowStates elegíveis:
    // tenant = valem | agentType = sdr | outcome = in_progress
    const eligibleStates = await db.query.agentFlowStates.findMany({
      where: (t, { eq: dEq, and: dAnd }) =>
        dAnd(
          dEq(t.tenantId, TENANT_ID),
          dEq(t.agentType, "sdr"),
          dEq(t.outcome as any, "in_progress")
        ),
    });

    if (!eligibleStates.length) return;

    const now = Date.now();

    for (const flowState of eligibleStates) {
      try {
        const conversationId = flowState.conversationId;

        // Verificar se a conversa já tem operador alocado (Valentina deve silenciar)
        const conv = await db.query.conversations.findFirst({
          where: (t, { eq: dEq }) => dEq(t.id, conversationId),
        });

        if (!conv || conv.operatorId || conv.queueState === "meus" || conv.queueState === "finalizados") {
          continue;
        }

        // Última mensagem da conversa
        const [lastMsg] = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(desc(messages.sentAt))
          .limit(1);

        if (!lastMsg) continue;

        // Se última mensagem foi do cliente, não há silêncio — pular
        if (lastMsg.senderType === "client") continue;

        const silenceMs = now - new Date(lastMsg.sentAt).getTime();
        const meta = (flowState.metadata as Record<string, any>) || {};
        const followUpStage: number = meta.followUpStage ?? 0;

        // Não reprocessar se ligação já foi disparada
        if (meta.callTriggered && followUpStage >= 3) continue;

        const collectedData = (flowState.collectedData as Record<string, any>) || {};

        // Buscar telefone do cliente
        const contactRecord = await db.query.contacts.findFirst({
          where: (t, { eq: dEq }) => dEq(t.id, conv.contactId),
        });
        const contactPhone = contactRecord?.phone;
        if (!contactPhone) continue;

        // -- RÉGUA DE FOLLOW-UP ----------------------------------------------

        if (followUpStage === 0 && silenceMs >= SILENCE_FU1_MS) {
          console.log(`[FollowupEngine] ?? Follow-up 1 (6min) — conversa ${conversationId}`);

          const text = await generateFollowUpText(conversationId, 1, collectedData);

          const { SessionManager, resolveRealJid } = await import("../baileys/session-manager");
          const sock = SessionManager.getInstance().getSession(TENANT_ID);
          if (!sock) continue;

          const realJid = await resolveRealJid(sock, contactPhone);
          await sock.sendMessage(realJid, { text });

          const msgId = `fu1-${Date.now()}`;
          await db.insert(messages).values({
            id: msgId,
            tenantId: TENANT_ID,
            conversationId,
            senderType: "bot",
            senderName: "Valentina (SDR)",
            content: text,
            isInternalNote: false,
            sentAt: new Date(),
          }).onConflictDoNothing();

          await db.update(conversations)
            .set({ lastMessageText: text.slice(0, 100), lastMessageTime: new Date() })
            .where(eq(conversations.id, conversationId));

          SessionManager.getInstance().notifyPublic(TENANT_ID, {
            type: "message",
            message: { id: msgId, conversationId, senderType: "bot", senderName: "Valentina (SDR)", content: text, sentAt: new Date(), queue: conv.queueState || "automacao", operatorId: null },
          });

          await db.update(agentFlowStates)
            .set({ metadata: { ...meta, followUpStage: 1 }, lastInteractionAt: new Date() })
            .where(eq(agentFlowStates.id, flowState.id));

          console.log(`[FollowupEngine] ? FU1 enviado para ${contactPhone}: "${text.slice(0, 60)}..."`);

        } else if (followUpStage === 1 && silenceMs >= SILENCE_FU2_MS) {
          console.log(`[FollowupEngine] ?? Follow-up 2 (15min) — conversa ${conversationId}`);

          const text = await generateFollowUpText(conversationId, 2, collectedData);

          const { SessionManager, resolveRealJid } = await import("../baileys/session-manager");
          const sock = SessionManager.getInstance().getSession(TENANT_ID);
          if (!sock) continue;

          const realJid = await resolveRealJid(sock, contactPhone);
          await sock.sendMessage(realJid, { text });

          const msgId = `fu2-${Date.now()}`;
          await db.insert(messages).values({
            id: msgId,
            tenantId: TENANT_ID,
            conversationId,
            senderType: "bot",
            senderName: "Valentina (SDR)",
            content: text,
            isInternalNote: false,
            sentAt: new Date(),
          }).onConflictDoNothing();

          await db.update(conversations)
            .set({ lastMessageText: text.slice(0, 100), lastMessageTime: new Date() })
            .where(eq(conversations.id, conversationId));

          SessionManager.getInstance().notifyPublic(TENANT_ID, {
            type: "message",
            message: { id: msgId, conversationId, senderType: "bot", senderName: "Valentina (SDR)", content: text, sentAt: new Date(), queue: conv.queueState || "automacao", operatorId: null },
          });

          await db.update(agentFlowStates)
            .set({ metadata: { ...meta, followUpStage: 2 }, lastInteractionAt: new Date() })
            .where(eq(agentFlowStates.id, flowState.id));

          console.log(`[FollowupEngine] ? FU2 enviado para ${contactPhone}: "${text.slice(0, 60)}..."`);

        } else if (followUpStage === 2 && silenceMs >= SILENCE_FU3_MS) {
          console.log(`[FollowupEngine] ?? Follow-up 3 (20min) — áudio + ligação para ${conversationId}`);

          const clientName = collectedData["NOME COMPLETO"]?.value || "cliente";
          const product = collectedData["QUAL O TIPO DE PRODUTO?"]?.value || "embalagens";
          const announceText = `${clientName}, vi que você ficou com uma dúvida sobre ${product}! Para facilitar, vou te ligar agora rapidinho pra gente fechar os detalhes!`;

          // Enviar áudio dinâmico ElevenLabs via SdrEngine
          const sdrEngine = SdrEngine.getInstance();
          await (sdrEngine as any).sendDynamicPttAudio(TENANT_ID, conversationId, contactPhone, announceText, undefined);

          // Aguardar 15s antes de ligar
          await new Promise((r) => setTimeout(r, 15_000));

          const creds = await getTwilioCredentials();
          const callRes = await triggerOutboundCallInternal({
            phone: contactPhone,
            accountSid: creds.accountSid,
            authToken: creds.authToken,
          });

          console.log(`[FollowupEngine] ?? Chamada disparada (FU3)! Sucesso: ${callRes.success} | CallSid: ${callRes.callSid || "N/A"}`);

          await db.update(agentFlowStates)
            .set({ metadata: { ...meta, followUpStage: 3, callTriggered: true }, lastInteractionAt: new Date() })
            .where(eq(agentFlowStates.id, flowState.id));
        }

      } catch (innerErr: any) {
        console.error(`[FollowupEngine] Erro ao processar conversa ${flowState.conversationId}:`, innerErr?.message);
      }
    }
  } catch (err: any) {
    console.error("[FollowupEngine] Erro no ciclo de varredura:", err?.message || err);
  }
}

/**
 * Inicializa o motor de follow-up (chamar no startup da aplicação)
 */
export function startSdrFollowupEngine() {
  if (engineTimer) {
    console.log("[FollowupEngine] ?? Engine já está rodando. Ignorando segunda inicialização.");
    return;
  }
  console.log(`[FollowupEngine] ?? Motor de Follow-ups SDR iniciado. Varredura a cada ${FOLLOWUP_INTERVAL_MS / 1000}s.`);
  void runFollowupCycle();
  engineTimer = setInterval(runFollowupCycle, FOLLOWUP_INTERVAL_MS);
}

/**
 * Para o motor de follow-up (útil para testes)
 */
export function stopSdrFollowupEngine() {
  if (engineTimer) {
    clearInterval(engineTimer);
    engineTimer = null;
    console.log("[FollowupEngine] Motor de Follow-ups SDR parado.");
  }
}
