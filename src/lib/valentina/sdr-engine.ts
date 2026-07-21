import { db } from "../../db";
import { agentConfigs, agentFlowStates, conversations, contacts, internalMessages, operators, messages } from "../../db/schema";
import { eq, and, asc } from "drizzle-orm";
import { SessionManager, resolveRealJid } from "../baileys/session-manager";
import { vertexAi } from "../vertex-ai";

// ── Helper para espelhar a saudação inicial do cliente ────────────────────────
export function getMirroredGreeting(clientText: string): { greeting: string; remainingText: string } {
  const lower = clientText.toLowerCase().trim();

  let greeting = "Olá!";
  if (lower.includes("bom dia")) greeting = "Bom dia!";
  else if (lower.includes("boa tarde")) greeting = "Boa tarde!";
  else if (lower.includes("boa noite")) greeting = "Boa noite!";
  else if (lower.includes("olá") || lower.includes("ola")) greeting = "Olá!";
  else if (lower.includes("oii") || lower.includes("oi")) greeting = "Oi!";
  else if (lower.includes("e ai") || lower.includes("e aí")) greeting = "Olá!";

  return { greeting, remainingText: clientText };
}

// ── Helper para verificar Whitelist por telefone ─────────────────────────────
export function isPhoneWhitelisted(clientPhone: string, whitelistPhone: string): boolean {
  if (!whitelistPhone) return false;

  const cleanClient = clientPhone.replace(/\D/g, "");
  const cleanWhite = whitelistPhone.replace(/\D/g, "");

  if (!cleanClient || !cleanWhite) return false;

  const clientVariants = getPhoneVariants(cleanClient);
  const whiteVariants = getPhoneVariants(cleanWhite);

  for (const cVar of clientVariants) {
    if (whiteVariants.includes(cVar)) {
      return true;
    }
  }

  return false;
}

function getPhoneVariants(phoneDigits: string): string[] {
  const variants: string[] = [phoneDigits];

  let withDdi = phoneDigits;
  if (!withDdi.startsWith("55") && (withDdi.length === 10 || withDdi.length === 11)) {
    withDdi = `55${withDdi}`;
    variants.push(withDdi);
  }

  let withoutDdi = phoneDigits;
  if (withoutDdi.startsWith("55") && withoutDdi.length >= 12) {
    withoutDdi = withoutDdi.slice(2);
    variants.push(withoutDdi);
  }

  if (withDdi.startsWith("55")) {
    const ddd = withDdi.slice(2, 4);
    const rest = withDdi.slice(4);

    if (rest.length === 9 && rest.startsWith("9")) {
      const eightDigit = `55${ddd}${rest.slice(1)}`;
      variants.push(eightDigit);
      variants.push(`${ddd}${rest.slice(1)}`);
    } else if (rest.length === 8) {
      const nineDigit = `55${ddd}9${rest}`;
      variants.push(nineDigit);
      variants.push(`${ddd}9${rest}`);
    }
  }

  return Array.from(new Set(variants));
}

export interface SdrAiResult {
  extractedData: Record<string, string>;
  messagesToSend: string[];
  isCompleted?: boolean;
}

// ── Classe Principal SdrEngine (Humanizada & Alavancada por Gemini 2.5 Pro) ─────
export class SdrEngine {
  private static instance: SdrEngine;

  private constructor() {}

  public static getInstance(): SdrEngine {
    if (!SdrEngine.instance) {
      SdrEngine.instance = new SdrEngine();
    }
    return SdrEngine.instance;
  }

  /**
   * Processa a mensagem do cliente de forma humanizada, usando Gemini 2.5 Pro via Vertex AI.
   */
  public async processIncomingMessage(
    tenantId: string,
    conversationId: string,
    contactPhone: string,
    messageContent: string
  ): Promise<boolean> {
    try {
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
          console.log(`[SdrEngine] Telefone ${contactPhone} bloqueado na Whitelist.`);
          return false;
        }
        console.log(`[SdrEngine] Telefone ${contactPhone} APROVADO na Whitelist!`);
      }

      // 3. Buscar ou criar o estado do fluxo SDR
      let flowState = await db.query.agentFlowStates.findFirst({
        where: (table, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(table.tenantId, tenantId), dEq(table.conversationId, conversationId)),
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
      }

      // 4. Buscar histórico recente de mensagens da conversa no banco
      const recentMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.sentAt))
        .limit(20);

      const conversationHistoryText = recentMessages
        .map((m) => `${m.senderType === "client" ? "Cliente" : "Valentina"}: ${m.content}`)
        .join("\n");

      // 5. Se for a primeira mensagem, montar saudação espelhada
      const { greeting } = getMirroredGreeting(messageContent);

      // 6. Consultar o Gemini 2.5 Pro via Vertex AI para raciocínio conversacional
      let aiResult: SdrAiResult | null = null;

      if (vertexAi.isReady()) {
        const currentDataSummary: Record<string, string> = {};
        for (const [k, v] of Object.entries(existingCollectedData)) {
          currentDataSummary[k] = v.value;
        }

        const prompt = `Você é a Valentina, a consultora comercial pré-vendas (SDR) humana da Valem (empresa de válvulas aerosol/spray, seladoras, embaladoras e componentes industriais).

HISTÓRICO DA CONVERSA:
${conversationHistoryText}

ÚLTIMA MENSAGEM DO CLIENTE:
"${messageContent}"

DADOS JÁ COLETADOS ATÉ O MOMENTO:
${JSON.stringify(currentDataSummary, null, 2)}

ESTA É A PRIMEIRA MENSAGEM DO CLIENTE? ${isFirstMessage ? "SIM" : "NÃO"}
SAUDAÇÃO ESPELHADA CALCULADA: "${greeting}"

REGRAS OBRIGATÓRIAS DE COMUNICAÇÃO NO WHATSAPP:
1. SEJA 100% HUMANA, empática e profissional. NUNCA pareça um formulário ou robô de pesquisa.
2. NUNCA envie listas numéricas de opções como "1️⃣ Frio 2️⃣ Morno". Pergunte de forma conversacional (ex: "Você precisa dessas peças urgente pra essa semana ou tá fazendo uma cotação pro mês que vem?").
3. FRAGMENTAÇÃO DE MENSAGENS: Divida seu retorno em 1, 2 ou no máximo 3 mensagens CURTAS (cada uma no array \`messagesToSend\`). NUNCA ultrapasse 2 linhas por mensagem!
4. SE FOR A PRIMEIRA MENSAGEM (${isFirstMessage ? "SIM" : "NÃO"}):
   - A primeira mensagem DEVE ser a saudação espelhada: "${greeting} Meu nome é Valentina, da Valem 😊"
   - A segunda mensagem DEVE ser: "Como posso te ajudar hoje?"
5. SE O CLIENTE FIZER UMA PERGUNTA OU DÚVIDA (ex: "vc tá entendendo?", "quanto custa?", "onde fica?"):
   - Responda primeiro a dúvida dele de forma clara e atenciosa antes de fazer qualquer pergunta.
6. SE O CLIENTE RECUSAR PASSAR DADOS (ex: CNPJ "não"):
   - Seja totalmente empática: "Sem problemas! Deixamos essa parte para o consultor depois 😊" e siga com a conversa.
7. COLETE OS DADOS: Nome, Empresa, CNPJ/CPF (se aceitar), Urgência, Perfil (recorrência ou primeira compra), Projeto/Desenvolvimento, Produto desejado.
8. Quando todos os dados necessários forem coletados ou o cliente estiver pronto para o transbordo, marque \`isCompleted: true\`.

Retorne EXCLUSIVAMENTE o JSON no formato:
{
  "extractedData": {
    "NOME COMPLETO": "valor ou vazio",
    "EMPRESA": "valor ou vazio",
    "CNPJ OU CPF": "valor ou recusado",
    "QUALIFICAÇÃO (TEMPERATURA)": "valor ou vazio",
    "TIPO DE QUALIFICAÇÃO": "valor ou vazio",
    "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO": "valor ou vazio",
    "QUAL O TIPO DE PRODUTO?": "valor ou vazio"
  },
  "messagesToSend": ["mensagem curta 1", "mensagem curta 2"],
  "isCompleted": false
}`;

        aiResult = await vertexAi.generateStructuredJson<SdrAiResult>(prompt, "gemini-2.5-pro");
      }

      // Fallback gracioso se a IA não retornar ou estiver indisponível
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
              `Entendido! Pode me passar mais detalhes do seu produto ou empresa para eu te direcionar pro consultor ideal?`
            ],
            isCompleted: false,
          };
        }
      }

      // 7. Atualizar dados coletados no banco
      const updatedCollectedData = { ...existingCollectedData };
      if (aiResult.extractedData) {
        for (const [k, v] of Object.entries(aiResult.extractedData)) {
          if (v && v.trim() !== "") {
            updatedCollectedData[k] = { value: v.trim(), status: "filled" };
          }
        }
      }

      const filledCount = Object.values(updatedCollectedData).filter((d) => d.status === "filled").length;
      const isCompleted = aiResult.isCompleted || filledCount >= 6;
      const now = new Date();

      if (!flowState) {
        const flowId = `flow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await db.insert(agentFlowStates).values({
          id: flowId,
          tenantId,
          conversationId,
          agentType: "sdr",
          currentStep: isCompleted ? "Concluído" : "Em Qualificação",
          collectedData: updatedCollectedData,
          metadata: { stepNumber: filledCount, totalSteps: 7 },
          startedAt: now,
          lastInteractionAt: now,
          outcome: isCompleted ? "completed" : "in_progress",
        });
      } else {
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

      // 8. Envio Humanizado das Mensagens (com presença de digitação 'composing' e delays reais)
      await this.sendHumanizedBotMessages(tenantId, conversationId, contactPhone, aiResult.messagesToSend);

      // 9. Se concluído, criar notificação do Supervisor
      if (isCompleted) {
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
      console.error("[SdrEngine] Erro no fluxo SDR Valentina:", e);
      return false;
    }
  }

  /**
   * Envia fragmentos de mensagem com efeito de digitação realista e delay humano
   */
  private async sendHumanizedBotMessages(
    tenantId: string,
    conversationId: string,
    phone: string,
    messagesArray: string[]
  ): Promise<void> {
    const sock = SessionManager.getInstance().getSession(tenantId);
    if (!sock) {
      console.error(`[SdrEngine] Sessão Baileys não encontrada para tenant ${tenantId}`);
      return;
    }

    const realJid = await resolveRealJid(sock, phone);

    for (let i = 0; i < messagesArray.length; i++) {
      const fragmentText = messagesArray[i].trim();
      if (!fragmentText) continue;

      // 1. Mostrar caixinha de "digitando..." no WhatsApp
      try {
        await sock.sendPresenceUpdate("composing", realJid);
      } catch { /* silencia erro de presença */ }

      // 2. Delay proporcional ao tamanho da mensagem (simula digitação humana: 1.2s a 2.8s)
      const typingDelay = Math.min(2800, Math.max(1200, fragmentText.length * 45));
      await new Promise((resolve) => setTimeout(resolve, typingDelay));

      // 3. Enviar a mensagem fragmentada
      const sentMsg = await sock.sendMessage(realJid, { text: fragmentText });
      const botMessageId = sentMsg?.key?.id || `bot-sdr-${Date.now()}-${i}`;

      // Resetar presença após envio
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

      // Pequena pausa natural entre mensagens consecutivas (700ms)
      if (i < messagesArray.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  }
}
