import { db } from "../../db";
import { agentConfigs, agentFlowStates, conversations, contacts, internalMessages, operators, messages } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { SessionManager, resolveRealJid } from "../baileys/session-manager";

// ── Lista de perguntas e passos da qualificação SDR ──────────────────────────
export const SDR_QUALIFICATION_STEPS = [
  {
    stepKey: "NOME COMPLETO",
    stepNumber: 1,
    questionText: (data: Record<string, any>) =>
      "Olá! 👋 Sou a Valentina, assistente inteligente da Valem. Vi que você nos chamou no WhatsApp! Para direcionar você ao consultor ideal, qual é o seu *nome completo*?",
  },
  {
    stepKey: "EMPRESA",
    stepNumber: 2,
    questionText: (data: Record<string, any>) =>
      `Muito prazer, ${data["NOME COMPLETO"] || "amigo"}! Qual é o *nome da sua empresa*?`,
  },
  {
    stepKey: "CNPJ OU CPF",
    stepNumber: 3,
    questionText: (data: Record<string, any>) =>
      "Excelente! Poderia nos informar o *CNPJ ou CPF* da empresa para cadastro?",
  },
  {
    stepKey: "QUALIFICAÇÃO (TEMPERATURA)",
    stepNumber: 4,
    questionText: (data: Record<string, any>) =>
      "Perfeito! Como você avalia a intenção/urgência de compra da sua empresa hoje?\n\n1️⃣ 1 - Frio (Apenas pesquisando)\n2️⃣ 2 - Morno-frio\n3️⃣ 3 - Morno (Planejando compra neste mês)\n4️⃣ 4 - Quente (Alta intenção para os próximos dias)\n5️⃣ 5 - Altíssima intenção (Compra imediata)",
  },
  {
    stepKey: "TIPO DE QUALIFICAÇÃO",
    stepNumber: 5,
    questionText: (data: Record<string, any>) =>
      "Ótimo! Qual opção melhor descreve o perfil do seu pedido?\n\n1️⃣ Industrial - Recorrência (Já produzimos e precisamos de lotes recorrentes)\n2️⃣ Industrial - Primeira compra (Vamos iniciar a produção)\n3️⃣ Revenda / Distribuição\n4️⃣ Outro",
  },
  {
    stepKey: "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO",
    stepNumber: 6,
    questionText: (data: Record<string, any>) =>
      "Seu atendimento necessita de *Projeto de Engenharia ou Desenvolvimento de Produto*? (Responda *Sim* ou *Não*)",
  },
  {
    stepKey: "QUAL O TIPO DE PRODUTO?",
    stepNumber: 7,
    questionText: (data: Record<string, any>) =>
      "Por fim, qual o *tipo de produto ou equipamento* que você busca? (Ex: Válvulas Aerosol, Seladoras, Embaladoras, Peças de Reposição)",
  },
];

// ── Helper para normalizar telefones brasileiros e verificar Whitelist ────────
export function isPhoneWhitelisted(clientPhone: string, whitelistPhone: string): boolean {
  if (!whitelistPhone) return false;

  const cleanClient = clientPhone.replace(/\D/g, "");
  const cleanWhite = whitelistPhone.replace(/\D/g, "");

  if (!cleanClient || !cleanWhite) return false;

  // Gerar variações do cliente
  const clientVariants = getPhoneVariants(cleanClient);
  // Gerar variações da whitelist
  const whiteVariants = getPhoneVariants(cleanWhite);

  // Se qualquer variação cruzar, é um match!
  for (const cVar of clientVariants) {
    if (whiteVariants.includes(cVar)) {
      return true;
    }
  }

  return false;
}

function getPhoneVariants(phoneDigits: string): string[] {
  const variants: string[] = [phoneDigits];

  // Garantir DDI 55 se parecer telefone BR
  let withDdi = phoneDigits;
  if (!withDdi.startsWith("55") && (withDdi.length === 10 || withDdi.length === 11)) {
    withDdi = `55${withDdi}`;
    variants.push(withDdi);
  }

  // Sem DDI 55
  let withoutDdi = phoneDigits;
  if (withoutDdi.startsWith("55") && withoutDdi.length >= 12) {
    withoutDdi = withoutDdi.slice(2);
    variants.push(withoutDdi);
  }

  // Variantes de 8 vs 9 dígitos para telefones do Brasil
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

// ── Classe Principal SdrEngine ────────────────────────────────────────────────
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
   * Processa uma mensagem recebida de cliente e determina se a Valentina SDR responde.
   */
  public async processIncomingMessage(
    tenantId: string,
    conversationId: string,
    contactPhone: string,
    messageContent: string
  ): Promise<boolean> {
    try {
      // 1. Buscar configuração do agente SDR no banco
      let dbConfig = await db.query.agentConfigs.findFirst({
        where: (table, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
      });

      // Configuração padrão se não existir ainda no banco
      const enabled = dbConfig ? dbConfig.enabled === 1 : true;
      const config = (dbConfig?.config as Record<string, any>) || {};
      const testMode = config.testMode !== undefined ? Boolean(config.testMode) : true;
      const whitelistPhone = config.whitelistPhone || "14998364338"; // Número padrão do usuário

      if (!enabled) {
        console.log(`[SdrEngine] Agente SDR desativado para o tenant ${tenantId}. Ignorando.`);
        return false;
      }

      // 2. Verificar filtro de Whitelist no modo de testes
      if (testMode) {
        const isAllowed = isPhoneWhitelisted(contactPhone, whitelistPhone);
        if (!isAllowed) {
          console.log(`[SdrEngine] Telefone ${contactPhone} não está na Whitelist (${whitelistPhone}). Ignorando.`);
          return false;
        }
        console.log(`[SdrEngine] Telefone ${contactPhone} APROVADO na Whitelist! Conduzindo qualificação SDR.`);
      }

      // 3. Buscar ou criar o estado do fluxo SDR para esta conversa
      let flowState = await db.query.agentFlowStates.findFirst({
        where: (table, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(table.tenantId, tenantId), dEq(table.conversationId, conversationId)),
      });

      let currentStepIndex = 0;
      let collectedData: Record<string, { value: string; status: "filled" | "pending" }> = {};

      if (!flowState) {
        // Criar novo estado inicial no passo 1
        const now = new Date();
        const initialCollectedData: Record<string, { value: string; status: "filled" | "pending" }> = {};
        for (const s of SDR_QUALIFICATION_STEPS) {
          initialCollectedData[s.stepKey] = { value: "", status: "pending" };
        }

        const flowId = `flow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await db.insert(agentFlowStates).values({
          id: flowId,
          tenantId,
          conversationId,
          agentType: "sdr",
          currentStep: SDR_QUALIFICATION_STEPS[0].stepKey,
          collectedData: initialCollectedData,
          metadata: { stepNumber: 1, totalSteps: 7 },
          startedAt: now,
          lastInteractionAt: now,
          outcome: "in_progress",
        });

        collectedData = initialCollectedData;
        currentStepIndex = 0;
      } else {
        if (flowState.outcome === "completed" || flowState.outcome === "transferred") {
          console.log(`[SdrEngine] Qualificação já concluída para conversa ${conversationId}.`);
          return false;
        }

        collectedData = (flowState.collectedData as any) || {};
        const stepName = flowState.currentStep;
        currentStepIndex = SDR_QUALIFICATION_STEPS.findIndex((s) => s.stepKey === stepName);
        if (currentStepIndex === -1) currentStepIndex = 0;

        // Salvar a resposta do cliente para a pergunta atual
        const stepCurrent = SDR_QUALIFICATION_STEPS[currentStepIndex];
        if (stepCurrent) {
          collectedData[stepCurrent.stepKey] = {
            value: messageContent.trim(),
            status: "filled",
          };
          currentStepIndex++;
        }
      }

      // 4. Verificar se chegamos ao fim da qualificação (passou do passo 7)
      if (currentStepIndex >= SDR_QUALIFICATION_STEPS.length) {
        // Concluir a qualificação
        const now = new Date();
        const clientName = collectedData["NOME COMPLETO"]?.value || "Cliente";

        await db
          .update(agentFlowStates)
          .set({
            currentStep: "Concluído",
            collectedData,
            completedAt: now,
            lastInteractionAt: now,
            outcome: "completed",
          })
          .where(eq(agentFlowStates.conversationId, conversationId));

        const finalMsg = `Perfeito, *${clientName}*! ✅ Sua qualificação foi concluída com sucesso!\n\nEstou transferindo seu atendimento para o consultor especialista humano agora mesmo. Obrigado!`;
        
        await this.sendWhatsappBotMessage(tenantId, conversationId, contactPhone, finalMsg);

        // Notificar o supervisor
        try {
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
              content: `🎯 Lead qualificado pelo SDR: *${clientName}* (${collectedData["EMPRESA"]?.value || "Sem empresa"}). Temperatura: ${collectedData["QUALIFICAÇÃO (TEMPERATURA)"]?.value || "N/A"}. Pronto para transbordo!`,
              metadata: { type: "lead_transfer", conversationId },
              read: 0,
              createdAt: now,
            });
          }
        } catch (err: any) {
          console.error("[SdrEngine] Erro ao notificar supervisor:", err?.message);
        }

        return true;
      }

      // 5. Enviar a próxima pergunta da fila
      const nextStep = SDR_QUALIFICATION_STEPS[currentStepIndex];
      const dataValues: Record<string, string> = {};
      for (const [k, v] of Object.entries(collectedData)) {
        dataValues[k] = v.value;
      }

      const questionPrompt = nextStep.questionText(dataValues);

      // Atualizar o estado no banco para o próximo passo
      await db
        .update(agentFlowStates)
        .set({
          currentStep: nextStep.stepKey,
          collectedData,
          metadata: { stepNumber: nextStep.stepNumber, totalSteps: 7 },
          lastInteractionAt: new Date(),
        })
        .where(eq(agentFlowStates.conversationId, conversationId));

      // Disparar resposta pelo Baileys
      await this.sendWhatsappBotMessage(tenantId, conversationId, contactPhone, questionPrompt);
      return true;

    } catch (e: any) {
      console.error("[SdrEngine] Erro ao processar qualificação SDR:", e);
      return false;
    }
  }

  /**
   * Envia uma mensagem via Baileys WhatsApp e registra no banco como bot
   */
  private async sendWhatsappBotMessage(
    tenantId: string,
    conversationId: string,
    phone: string,
    text: string
  ): Promise<void> {
    const sock = SessionManager.getInstance().getSession(tenantId);
    if (!sock) {
      console.error(`[SdrEngine] Sessão Baileys não encontrada para tenant ${tenantId}`);
      return;
    }

    const realJid = await resolveRealJid(sock, phone);
    const sentMsg = await sock.sendMessage(realJid, { text });

    const botMessageId = sentMsg?.key?.id || `bot-sdr-${Date.now()}`;

    // Registrar no banco de dados como mensagem do bot
    await db.insert(conversations).values({
      id: conversationId,
      tenantId,
      contactId: `c-${phone}`,
      queueState: "automacao",
      lastMessageText: text,
      lastMessageTime: new Date(),
      createdAt: new Date(),
    }).onConflictDoNothing();

    await db.insert(messages).values({
      id: botMessageId,
      tenantId,
      conversationId,
      senderType: "bot",
      senderName: "Valentina (SDR)",
      content: text,
      isInternalNote: false,
      sentAt: new Date(),
    }).onConflictDoNothing();

    // Notificar UI via SSE
    SessionManager.getInstance().notifyPublic(tenantId, {
      type: "message",
      message: {
        id: botMessageId,
        conversationId,
        senderType: "bot",
        senderName: "Valentina (SDR)",
        content: text,
        phone,
        sentAt: new Date(),
        queue: "automacao",
        operatorId: null,
      },
    });
  }
}
