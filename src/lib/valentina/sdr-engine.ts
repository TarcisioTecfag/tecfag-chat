import { db } from "../../db";
import { agentConfigs, agentFlowStates, conversations, messages, internalMessages } from "../../db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { vertexAi, MultimodalPart } from "../vertex-ai";
import { SessionManager } from "../baileys/session-manager";
import { resolveRealJid } from "../baileys/session-manager";
import { QueuedMessageItem } from "./sdr-debouncer";

// ── Tipos do Resultado Estruturado da IA ──────────────────────────────────────────
export interface SdrAiResult {
  extractedData: Record<string, string>;
  messagesToSend: string[];
  isCompleted: boolean;
}

// ── Helper para validar Whitelist no Modo de Teste ─────────────────────────────────
export function isPhoneWhitelisted(phone: string, whitelistConfig: string): boolean {
  if (!whitelistConfig || whitelistConfig.trim() === "") return true;

  const cleanPhone = phone.replace(/\D/g, "");
  const allowedNumbers = whitelistConfig
    .split(",")
    .map((n) => n.replace(/\D/g, "").trim())
    .filter(Boolean);

  if (allowedNumbers.length === 0) return true;

  return allowedNumbers.some((allowed) => {
    return cleanPhone.endsWith(allowed) || allowed.endsWith(cleanPhone);
  });
}

// ── Helper para Espelhar Saudação Inicial ────────────────────────────────────────
export function getMirroredGreeting(firstMessageText: string): { greeting: string; cleanRest: string } {
  const textLower = firstMessageText.toLowerCase().trim();

  let greeting = "Olá!";

  if (/^(bom\s*dia)/i.test(textLower)) {
    greeting = "Bom dia!";
  } else if (/^(boa\s*tarde)/i.test(textLower)) {
    greeting = "Boa tarde!";
  } else if (/^(boa\s*noite)/i.test(textLower)) {
    greeting = "Boa noite!";
  } else if (/^(ol[aá]|oi|hey|opaa?)/i.test(textLower)) {
    greeting = "Olá!";
  }

  return { greeting, cleanRest: textLower };
}

// ── Classe Principal SdrEngine (Humanizada, Anti-Repetição & Gemini 2.5 Pro) ─────
export class SdrEngine {
  private static instance: SdrEngine;

  private constructor() {}

  public static getInstance(): SdrEngine {
    if (!SdrEngine.instance) {
      SdrEngine.instance = new SdrEngine();
    }
    return SdrEngine.instance;
  }

  public async processIncomingMessage(
    tenantId: string,
    conversationId: string,
    contactPhone: string,
    messageContent: string
  ): Promise<boolean> {
    return this.processBatchMessages(tenantId, conversationId, contactPhone, [{
      text: messageContent,
      mediaType: "text",
      receivedAt: new Date(),
    }]);
  }

  /**
   * Processa o LOTE CONSOLIDADO de mensagens do cliente acumulado após 15s de debouncers.
   */
  public async processBatchMessages(
    tenantId: string,
    conversationId: string,
    contactPhone: string,
    batchItems: QueuedMessageItem[],
    signal?: AbortSignal
  ): Promise<boolean> {
    try {
      if (signal?.aborted) return false;

      // 1. Buscar configuração do agente SDR
      let dbConfig = await db.query.agentConfigs.findFirst({
        where: (table, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
      });

      const enabled = dbConfig ? dbConfig.enabled === 1 : true;
      const config = (dbConfig?.config as Record<string, any>) || {};
      const testMode = config.testMode !== undefined ? Boolean(config.testMode) : true;
      const whitelistPhone = config.whitelistPhone || "14998364338";

      if (!enabled) return false;

      // 2. Verificar filtro de Whitelist
      if (testMode) {
        const isAllowed = isPhoneWhitelisted(contactPhone, whitelistPhone);
        if (!isAllowed) {
          console.log(`[SdrEngine] Telefone ${contactPhone} bloqueado na Whitelist de teste.`);
          return false;
        }
        console.log(`[SdrEngine] Telefone ${contactPhone} APROVADO na Whitelist!`);
      }

      // 3. Buscar ou criar o estado do fluxo SDR (Triagem ao Vivo)
      let flowState = await db.query.agentFlowStates.findFirst({
        where: (table, { eq: dEq }) => eq(table.conversationId, conversationId),
      });

      if (flowState && (flowState.outcome === "completed" || flowState.outcome === "transferred")) {
        console.log(`[SdrEngine] Qualificação já concluída para conversa ${conversationId}.`);
        return false;
      }

      const isFirstMessage = !flowState;
      let existingCollectedData: Record<string, { value: string; status: "filled" | "pending" }> = {};

      if (flowState) {
        existingCollectedData = (flowState.collectedData as any) || {};
      } else {
        const initialFields = [
          "NOME COMPLETO", "EMPRESA", "CNPJ OU CPF",
          "QUALIFICAÇÃO (TEMPERATURA)", "TIPO DE QUALIFICAÇÃO",
          "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO", "QUAL O TIPO DE PRODUTO?"
        ];
        for (const f of initialFields) {
          existingCollectedData[f] = { value: "", status: "pending" };
        }

        // Criar registro na tabela agentFlowStates IMEDIATAMENTE para aparecer no Painel SDR ao Vivo!
        const flowId = `flow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await db.insert(agentFlowStates).values({
          id: flowId,
          tenantId,
          conversationId,
          agentType: "sdr",
          currentStep: "Em Qualificação",
          collectedData: existingCollectedData,
          metadata: { stepNumber: 0, totalSteps: 7 },
          startedAt: new Date(),
          lastInteractionAt: new Date(),
          outcome: "in_progress",
        });

        flowState = await db.query.agentFlowStates.findFirst({
          where: (table, { eq: dEq }) => eq(table.id, flowId),
        });
      }

      // 4. Buscar histórico recente de mensagens da conversa no banco
      const recentMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.sentAt))
        .limit(30);

      const conversationHistoryText = recentMessages
        .map((m) => `${m.senderType === "client" ? "Cliente" : "Valentina"}: ${m.content}`)
        .join("\n");

      // Verificar se já houve algum emoji enviado anteriormente na conversa
      const hasPreviousEmoji = recentMessages.some((m) =>
        m.senderType === "bot" && /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(m.content)
      );

      // 5. Consolidar as mensagens deste lote de 15 segundos
      const batchSummary = batchItems
        .map((item, idx) => {
          if (item.mediaType === "image") {
            return `[Mensagem ${idx + 1} do Lote - IMAGEM ENVIADA PELO CLIENTE]: ${item.text || "(imagem sem legenda)"}`;
          } else if (item.mediaType === "audio") {
            return `[Mensagem ${idx + 1} do Lote - ÁUDIO ENVIADO PELO CLIENTE]: ${item.text || "(áudio gravado pelo cliente)"}`;
          }
          return `[Mensagem ${idx + 1} do Lote]: ${item.text}`;
        })
        .join("\n");

      const firstTextItem = batchItems.find((i) => i.text.trim().length > 0)?.text || "olá";
      const { greeting } = getMirroredGreeting(firstTextItem);

      // Instrução estrita sobre apresentação inicial vs sequência da conversa
      const firstMessageRule = isFirstMessage
        ? `🟢 ESTA É A PRIMEIRA MENSAGEM DO ATENDIMENTO.
   - A mensagem 1 DEVE ser exatamente: "${greeting} Meu nome é Valentina, da Valem 😊"
   - A mensagem 2 DEVE ser: "Como posso te ajudar hoje?"`
        : `🛑 ATENÇÃO CRÍTICA (ESTA NÃO É A PRIMEIRA MENSAGEM DO ATENDIMENTO! A CONVERSA JÁ ESTÁ EM ANDAMENTO!):
   - NUNCA diga "Olá", NUNCA diga "Meu nome é Valentina", NUNCA diga "da Valem", NUNCA volte a se apresentar!
   - Responda DIRETO ao que o cliente disse no lote de forma fluida e conversacional!`;

      const currentDataSummary: Record<string, string> = {};
      for (const [k, v] of Object.entries(existingCollectedData)) {
        currentDataSummary[k] = v.value;
      }

      const promptText = `Você é a Valentina, a consultora comercial pré-vendas (SDR) humana da Valem (empresa de válvulas aerosol/spray, seladoras, embaladoras e componentes industriais).

HISTÓRICO COMPLETO DA CONVERSA ATE AGORA:
${conversationHistoryText}

NOVAS MENSAGENS RECEBIDAS NESTE LOTE CONSOLIDADO:
${batchSummary}

DADOS JÁ COLETADOS ATÉ O MOMENTO:
${JSON.stringify(currentDataSummary, null, 2)}

DIRETRIZ DE APRESENTAÇÃO E CONTINUIDADE:
${firstMessageRule}

REGRAS RÍGIDAS DE QUALIDADE E HUMANIZAÇÃO:
1. DIVERSIDADE VOCABULAR E VARIABILIDADE (NUNCA REPETIR VÍCIOS DE LINGUAGEM):
   - NUNCA repita inícios de frase genéricos já usados anteriormente na conversa (ex: "Vi aqui que você...", "Vi que você...", "Deixamos essa parte para o consultor depois").
   - Varie a linguagem de forma natural (ex: "Perfeito!", "Entendido!", "Excelente!", "Certo, anotado!").

2. REGRA ESTRITA DE EMOJIS:
   - Valentina pode usar NO MÁXIMO 1 EMOJI em todo o atendimento.
   - O histórico da conversa já contém emoji enviado? ${hasPreviousEmoji ? "SIM (PROIBIDO ENVIAR QUALQUER EMOJI AGORA!)" : "NÃO (Pode usar no máximo 1 emoji empático se for apropriado)"}.
   - NUNCA repita um emoji já enviado!

3. RESPEITO TOTAL ÀS RESPOSTAS E NÃO-REPETIÇÃO DE PERGUNTAS:
   - Se o cliente responder "não" para uma pergunta opcional (como previsão do projeto ou data), REGISTRE "Sem previsão", diga um "Entendido!" ou "Sem problemas!" curto e NUNCA VOLTE A PERGUNTAR SOBRE PREVISÃO!
   - Se o cliente já informou o Nome (ex: "Tarcisio Pereira da Silva"), REGISTRE O NOME e NUNCA pergunte "qual o seu nome?" de novo!
   - Se o cliente se irritar ou disser que já respondeu, peça desculpas com muita elegância ("Imagina, me desculpe! Já registrei aqui, Tarcísio.") e siga imediatamente.

4. FRAGMENTAÇÃO DE MENSAGENS:
   - Retorne de 1 a no máximo 2 mensagens CURTAS (no array \`messagesToSend\`). NUNCA ultrapasse 2 linhas por mensagem!

5. CONCLUSÃO DA QUALIFICAÇÃO:
   - Quando tiver Produto, Projeto/Empresa, Nome e CNPJ/CPF (ou se o cliente recusou informar previsão/dados adicionais), marque \`isCompleted: true\`.

Retorne EXCLUSIVAMENTE o JSON no formato:
{
  "extractedData": {
    "NOME COMPLETO": "valor ou mantem anterior",
    "EMPRESA": "valor ou mantem anterior",
    "CNPJ OU CPF": "valor ou mantem anterior",
    "QUALIFICAÇÃO (TEMPERATURA)": "valor ou mantem anterior",
    "TIPO DE QUALIFICAÇÃO": "valor ou mantem anterior",
    "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO": "valor ou mantem anterior",
    "QUAL O TIPO DE PRODUTO?": "valor ou mantem anterior"
  },
  "messagesToSend": ["mensagem curta 1", "mensagem curta 2"],
  "isCompleted": false
}`;

      const multimodalParts: MultimodalPart[] = [{ text: promptText }];

      // Anexar buffers de imagem e áudio recebidos no lote
      for (const item of batchItems) {
        if (item.mediaBase64 && item.mimeType) {
          multimodalParts.push({
            inlineData: {
              mimeType: item.mimeType,
              data: item.mediaBase64,
            },
          });
        }
      }

      if (signal?.aborted) return false;

      // 6. Consultar o Gemini 2.5 Pro via Vertex AI
      let aiResult: SdrAiResult | null = null;
      if (vertexAi.isReady()) {
        aiResult = await vertexAi.generateStructuredJson<SdrAiResult>(
          multimodalParts,
          "gemini-2.5-pro",
          signal
        );
      }

      if (signal?.aborted) return false;

      // Fallback gracioso se a IA não retornar ou se interrompida
      if (!aiResult || !aiResult.messagesToSend || aiResult.messagesToSend.length === 0) {
        if (isFirstMessage) {
          aiResult = {
            extractedData: {},
            messagesToSend: [
              `${greeting} Meu nome é Valentina, da Valem 😊`,
              `Como posso te ajudar hoje?`
            ],
            isCompleted: false,
          };
        } else {
          aiResult = {
            extractedData: {},
            messagesToSend: [
              `Entendido! Já estou ajustando as informações aqui para o nosso consultor comercial.`
            ],
            isCompleted: false,
          };
        }
      }

      // 7. Atualizar dados coletados no banco
      const updatedCollectedData = { ...existingCollectedData };
      if (aiResult.extractedData) {
        for (const [k, v] of Object.entries(aiResult.extractedData)) {
          if (v && v.trim() !== "" && !v.toLowerCase().includes("mantem")) {
            updatedCollectedData[k] = { value: v.trim(), status: "filled" };
          }
        }
      }

      const filledCount = Object.values(updatedCollectedData).filter((d) => d.status === "filled").length;
      const isCompleted = aiResult.isCompleted || filledCount >= 5;
      const now = new Date();

      if (flowState) {
        await db
          .update(agentFlowStates)
          .set({
            currentStep: isCompleted ? "Concluído" : "Em Qualificação",
            collectedData: updatedCollectedData,
            metadata: { stepNumber: filledCount, totalSteps: 7 },
            lastInteractionAt: now,
            completedAt: isCompleted ? now : null,
            outcome: isCompleted ? "completed" : "in_progress",
          })
          .where(eq(agentFlowStates.id, flowState.id));
      }

      if (signal?.aborted) return false;

      // 8. Envio Humanizado das Mensagens com presencia 'composing' longa e checagem de AbortSignal
      await this.sendHumanizedBotMessages(
        tenantId,
        conversationId,
        contactPhone,
        aiResult.messagesToSend,
        signal
      );

      // 9. Notificar Supervisor se concluído
      if (isCompleted && !signal?.aborted) {
        try {
          const clientName = updatedCollectedData["NOME COMPLETO"]?.value || "Cliente";
          const company = updatedCollectedData["EMPRESA"]?.value || "Empresa não informada";
          const supervisorNotifId = `notif-${Date.now()}`;
          const firstOp = await db.query.operators.findFirst({
            where: (t, { eq: dEq }) => dEq(t.tenantId, tenantId),
          });

          if (firstOp) {
            await db.insert(internalMessages).values({
              id: supervisorNotifId,
              tenantId,
              operatorId: firstOp.id,
              direction: "from_agent",
              agentType: "supervisor",
              content: `🎯 Lead qualificado pelo SDR Valentina com Gemini 2.5 Pro: *${clientName}* (${company}). Pronto para transferência!`,
              metadata: { type: "lead_transfer", conversationId },
              read: 0,
              createdAt: new Date(),
            });
          }
        } catch (err: any) {
          console.error("[SdrEngine] Erro ao notificar supervisor:", err?.message);
        }
      }

      return true;

    } catch (e: any) {
      if (e?.name === "AbortError" || signal?.aborted) {
        console.log(`[SdrEngine] Processamento abortado por nova mensagem do cliente (Stop & Restart).`);
        return false;
      }
      console.error("[SdrEngine] Erro no fluxo SDR Valentina:", e);
      return false;
    }
  }

  /**
   * Envia fragmentos de mensagem com efeito de digitação realista e checagem contínua de AbortSignal
   */
  private async sendHumanizedBotMessages(
    tenantId: string,
    conversationId: string,
    phone: string,
    messagesArray: string[],
    signal?: AbortSignal
  ): Promise<void> {
    const sock = SessionManager.getInstance().getSession(tenantId);
    if (!sock) {
      console.error(`[SdrEngine] Sessão Baileys não encontrada para tenant ${tenantId}`);
      return;
    }

    const realJid = await resolveRealJid(sock, phone);

    for (let i = 0; i < messagesArray.length; i++) {
      if (signal?.aborted) {
        console.log("[SdrEngine] Envio de mensagens interrompido por AbortSignal.");
        try { await sock.sendPresenceUpdate("paused", realJid); } catch {}
        return;
      }

      const fragmentText = messagesArray[i].trim();
      if (!fragmentText) continue;

      // 1. Manter presença de "digitando..." visível no WhatsApp
      try {
        await sock.sendPresenceUpdate("composing", realJid);
      } catch { /* silencia */ }

      // 2. Delay de digitação humana realista estendido (2.2s a 4.2s) para a caixinha de "digitando..." aparecer com destaque
      const typingDelay = Math.min(4200, Math.max(2200, fragmentText.length * 60));
      
      const startDelay = Date.now();
      while (Date.now() - startDelay < typingDelay) {
        if (signal?.aborted) {
          try { await sock.sendPresenceUpdate("paused", realJid); } catch {}
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      if (signal?.aborted) return;

      // 3. Enviar a mensagem no WhatsApp
      const sentMsg = await sock.sendMessage(realJid, { text: fragmentText });
      const botMessageId = sentMsg?.key?.id || `bot-sdr-${Date.now()}-${i}`;

      try {
        await sock.sendPresenceUpdate("paused", realJid);
      } catch { /* silencia */ }

      // 4. Gravar no banco de dados e notificar UI via SSE
      await db.insert(conversations).values({
        id: conversationId,
        tenantId,
        contactId: `c-${phone}`,
        queueState: "automacao",
        lastMessageText: fragmentText,
        lastMessageTime: new Date(),
        createdAt: new Date(),
      }).onConflictDoNothing();

      await db.insert(messages).values({
        id: botMessageId,
        tenantId,
        conversationId,
        senderType: "bot",
        senderName: "Valentina (SDR)",
        content: fragmentText,
        isInternalNote: false,
        sentAt: new Date(),
      }).onConflictDoNothing();

      SessionManager.getInstance().notifyPublic(tenantId, {
        type: "message",
        message: {
          id: botMessageId,
          conversationId,
          senderType: "bot",
          senderName: "Valentina (SDR)",
          content: fragmentText,
          phone,
          sentAt: new Date(),
          queue: "automacao",
          operatorId: null,
        },
      });

      // Pausa natural entre mensagens consecutivas (750ms)
      if (i < messagesArray.length - 1) {
        await new Promise((r) => setTimeout(r, 750));
      }
    }
  }
}
