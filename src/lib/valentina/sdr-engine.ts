
import { db } from "../../db";
import { agentConfigs, agentFlowStates, conversations, messages, internalMessages } from "../../db/schema";
import { eq, asc } from "drizzle-orm";
import { vertexAi, MultimodalPart } from "../vertex-ai";
import { SessionManager, resolveRealJid } from "../baileys/session-manager";
import { QueuedMessageItem } from "./sdr-debouncer";
import { extractCnpjFromText, fetchCnpjInfo } from "./cnpj-service";
import { getKnowledgeBaseContext } from "./knowledge-service";

// ── Tipos do Resultado Estruturado da IA ──────────────────────────────────────────
export interface SdrAiResult {
  extractedData?: Record<string, any>;
  messagesToSend: string[];
  quoteMessageId?: string | null;
  isCompleted?: boolean;
}

/**
 * Função utilitária para verificar se um número de telefone está na whitelist
 */
export function isPhoneWhitelisted(phone: string, whitelistPhone: string): boolean {
  if (!whitelistPhone || !whitelistPhone.trim()) return false;
  const cleanPhone = phone.replace(/\D/g, "");
  const cleanWhitelist = whitelistPhone.replace(/\D/g, "");
  if (!cleanWhitelist) return false;
  return cleanPhone.includes(cleanWhitelist) || cleanWhitelist.includes(cleanPhone);
}

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
   * Processa um lote consolidado de mensagens de uma conversa com Gemini 2.5 Pro Multimodal
   */
  public async processBatchMessages(
    tenantId: string,
    conversationId: string,
    contactPhone: string,
    batchItems: QueuedMessageItem[],
    signal?: AbortSignal
  ): Promise<boolean> {
    try {
      if (!batchItems || batchItems.length === 0) return false;

      // 1. Carregar Configuração do Agente SDR no Banco
      let dbConfig = await db.query.agentConfigs.findFirst({
        where: (table, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
      });

      if (!dbConfig) {
        dbConfig = await db.query.agentConfigs.findFirst({
          where: (table, { eq: dEq }) => dEq(table.agentType, "sdr"),
        });
      }

      const configData = (dbConfig?.config as Record<string, any>) || {};
      const isEnabled = dbConfig ? dbConfig.enabled === 1 : true;
      const isTestMode = configData.testMode !== undefined ? Boolean(configData.testMode) : true;
      const whitelistPhone = configData.whitelistPhone || "14998364338";

      if (!isEnabled) {
        console.log(`[SdrEngine] SDR Valentina está DESATIVADO para tenant ${tenantId}. Ignorando lote.`);
        return false;
      }

      // Se o Modo de Testes estiver ATIVO, Valentina responde EXCLUSIVAMENTE ao número da whitelist!
      if (isTestMode) {
        const whitelisted = isPhoneWhitelisted(contactPhone, whitelistPhone);
        if (!whitelisted) {
          console.log(`[SdrEngine] 🛡️ Modo de Testes ATIVO: Telefone ${contactPhone} NÃO está na Whitelist (${whitelistPhone}). Ignorando.`);
          return false;
        }
        console.log(`[SdrEngine] Telefone ${contactPhone} APROVADO na Whitelist!`);
      }

      // 2. Buscar ou Criar Estado do Fluxo (agentFlowStates)
      let flowState = await db.query.agentFlowStates.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.tenantId, tenantId), dEq(t.conversationId, conversationId)),
      });

      if (!flowState) {
        const newFlowId = `fs-sdr-${Date.now()}`;
        await db.insert(agentFlowStates).values({
          id: newFlowId,
          tenantId,
          conversationId,
          agentType: "sdr",
          currentStep: "Em Qualificação",
          collectedData: {},
          metadata: { stepNumber: 1, totalSteps: 7 },
          startedAt: new Date(),
          lastInteractionAt: new Date(),
          outcome: "in_progress",
        });

        flowState = await db.query.agentFlowStates.findFirst({
          where: (t, { eq: dEq }) => dEq(t.id, newFlowId),
        });
      }

      // 3. Buscar Histórico Recente de Mensagens Reais do Banco
      const historyMsgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.sentAt))
        .limit(50);

      let hasPreviousEmoji = false;
      const conversationHistoryText = historyMsgs
        .map((m) => {
          if (m.senderType === "bot" && /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(m.content)) {
            hasPreviousEmoji = true;
          }
          const sender = m.senderType === "client" ? "Cliente" : "Valentina (SDR)";
          return `[${sender}]: ${m.content}`;
        })
        .join("\n");

      // 4. Formatar o Lote Consolidado Atual de Mensagens com IDs
      const batchSummary = batchItems
        .map((m) => `[ID MENSAGEM: ${m.messageId || 'msg'}] Cliente (${m.mediaType || 'texto'}): "${m.text}"`)
        .join("\n");

      // 5. Montar Prompt Estruturado para o Gemini 2.5 Pro
      const existingCollectedData = (flowState?.collectedData as Record<string, any>) || {};

      const hour = new Date().getHours();
      let greeting = "Olá, bom dia!";
      if (hour >= 12 && hour < 18) greeting = "Olá, boa tarde!";
      if (hour >= 18 || hour < 5) greeting = "Olá, boa noite!";

      const isFirstMessage = historyMsgs.length === 0;

      const firstMessageRule = isFirstMessage
        ? `🟢 ATENÇÃO CRÍTICA (ESTA É A PRIMEIRA MENSAGEM DO ATENDIMENTO!):
   - VOCÊ É OBRIGADA A SE IDENTIFICAR COMO "VALENTINA DA VALEM" NESSA PRIMEIRA INTERAÇÃO!
   - NUNCA use frases engessadas ou scripts prontos repetitivos! Personalize e adapte a sua fala dinamicamente com base no que o cliente mandou!
   - Exemplo natural e fluido: "Boa tarde! Tudo joia por aí? Me chamo Valentina, sou da equipe comercial da Valem. Como posso te ajudar hoje?"`
        : `🛑 ATENÇÃO CRÍTICA (ESTA NÃO É A PRIMEIRA MENSAGEM DO ATENDIMENTO! A CONVERSA JÁ ESTÁ EM ANDAMENTO!):
   - NUNCA volte a se apresentar se você já se identificou antes na conversa!
   - Responda DIRETO ao que o cliente disse de forma fluida e conversacional!`;

      const currentDataSummary: Record<string, string> = {};
      for (const [k, v] of Object.entries(existingCollectedData)) {
        currentDataSummary[k] = v.value;
      }

      // 5.1 Verificar se o lote contém algum CNPJ para validação matemática e consulta à API (cnpj.ws)
      let cnpjDirective = "";
      const combinedBatchText = batchItems.map((i) => i.text).join(" ");
      const detectedCnpjCandidate = extractCnpjFromText(combinedBatchText);

      if (detectedCnpjCandidate) {
        console.log(`[SdrEngine] CNPJ detectado no lote: ${detectedCnpjCandidate}. Executando validação matemática e consulta à Receita Federal (cnpj.ws)...`);
        const cnpjInfo = await fetchCnpjInfo(detectedCnpjCandidate);

        if (!cnpjInfo.valid) {
          cnpjDirective = `\n⚠️ ALERTA DE CNPJ INVÁLIDO: O CNPJ enviado pelo cliente (${cnpjInfo.cnpjFormatted}) POSSUI ERRO MATEMÁTICO nos dígitos verificadores. Informe educadamente ao cliente que o CNPJ parece ter algum dígito incorreto e peça para ele conferir e enviar novamente.`;
        } else if (cnpjInfo.razaoSocial) {
          cnpjDirective = `\n🟢 CNPJ VÁLIDO E CONSULTADO NA RECEITA FEDERAL (cnpj.ws):
- CNPJ: ${cnpjInfo.cnpjFormatted}
- Razão Social/Empresa encontrada na Receita: "${cnpjInfo.razaoSocial}" ${cnpjInfo.nomeFantasia ? `(Fantasia: ${cnpjInfo.nomeFantasia})` : ""}
INSTRUÇÕES OBRIGATÓRIAS:
1. Defina em \`extractedData\` o CNPJ OU CPF como "${cnpjInfo.cnpjFormatted}" e EMPRESA como "${cnpjInfo.razaoSocial}".
2. Pergunte ao cliente para confirmar: "Sua empresa é a ${cnpjInfo.razaoSocial}, certo?"`;
        } else {
          cnpjDirective = `\n🟢 CNPJ VÁLIDO (${cnpjInfo.cnpjFormatted}): Os dígitos verificadores estão matematicamente corretos. Defina em \`extractedData\` o CNPJ OU CPF como "${cnpjInfo.cnpjFormatted}".`;
        }
      }

      const knowledgeContext = await getKnowledgeBaseContext(tenantId);

      const promptText = `Você é a Valentina, a consultora comercial pré-vendas (SDR) humana da Valem (empresa de válvulas aerosol/spray, frascos, potes, seladoras, embaladoras e componentes industriais).
${knowledgeContext}

HISTÓRICO COMPLETO DA CONVERSA ATE AGORA:
${conversationHistoryText}

NOVAS MENSAGENS RECEBIDAS NESTE LOTE CONSOLIDADO:
${batchSummary}

DADOS JÁ COLETADOS ATÉ O MOMENTO:
${JSON.stringify(currentDataSummary, null, 2)}
${cnpjDirective}

DIRETRIZ DE APRESENTAÇÃO E CONTINUIDADE:
${firstMessageRule}

REGRAS RÍGIDAS DE QUALIDADE E HUMANIZAÇÃO:
1. CONECTORES NATURAIS E LINGUAGEM DE CONVERSA REAL:
   - Fale como uma pessoa humana de verdade no WhatsApp. Use conectores orgânicos de raciocínio para dar fluidez: "então", "olha", "ah, bom", "sabe?", "deixa eu ver", "pois é", "faz sentido", "mas ó", "aliás".
   - Use hesitações de raciocínio real em tempo real quando fizer sentido (ex: "hum...", "deixa eu checar aqui...", "eu acho que... na verdade, pensando bem").

2. INTELIGÊNCIA EMOCIONAL, ESPELHAMENTO DE TOM E REAÇÕES:
   - ESPELHAMENTO DE TOM: Se o cliente mandar mensagem animada ou descontraída, responda empolgada! Se o cliente estiver com pressa ou formal, seja rápida, direta e resolutiva.
   - RISADAS E INFORMALIDADE: Se o cliente brincar, rir ou mandar piadas (ex: "preciso de um pix", "me paga um lanche"), use risadas humanas naturais ("kkk", "hahaha") e brinque de volta antes de puxar o assunto comercial.
   - INICIATIVA CONVERSACIONAL: Não seja um robô formulário. Demonstre curiosidade comercial genuína sobre o projeto ou aplicação do cliente.

3. GESTÃO DE IMPERFEIÇÃO E AUTENTICIDADE:
   - Fale de forma autêntica e sem rigidez de livro. Quando for checar algo com a equipe, use termos humanos reais como: "Se não me engano...", "Deixa eu confirmar aqui com o pessoal...", "Puts, me pegou agora, deixa eu dar uma olhada".

4. REGRA ESTRITA DE EMOJIS:
   - Valentina pode usar NO MÁXIMO 1 EMOJI em todo o atendimento.
   - O histórico da conversa já contém emoji enviado? ${hasPreviousEmoji ? "SIM (PROIBIDO ENVIAR QUALQUER EMOJI AGORA!)" : "NÃO (Pode usar no máximo 1 emoji empático se for apropriado)"}.
   - NUNCA repita um emoji já enviado!

5. RESPEITO TOTAL ÀS RESPOSTAS E NÃO-REPETIÇÃO DE PERGUNTAS:
   - Se o cliente responder "não" para uma pergunta opcional (como previsão do projeto ou data), REGISTRE "Sem previsão", diga um "Entendido!" ou "Sem problemas!" curto e NUNCA VOLTE A PERGUNTAR SOBRE PREVISÃO!
   - Se o cliente já informou o Nome (ex: "Tarcisio Pereira da Silva"), REGISTRE O NOME e NUNCA pergunte "qual o seu nome?" de novo!
   - Se o cliente se irritar ou disser que já respondeu, peça desculpas com muita elegância ("Imagina, me desculpe! Já registrei aqui, Tarcísio.") e siga imediatamente.

6. FLUXO DE CNPJ E EMPRESA (NUNCA PEDIR O NOME DA EMPRESA DIRETAMENTE!):
   - NUNCA pergunte "Qual o nome da sua empresa?". Pergunte APENAS o CNPJ (ou CPF).
   - Quando o cliente enviar o CNPJ, a validação matemática e a API da Receita Federal (cnpj.ws) buscam a Razão Social da empresa automaticamente.
   - Sua única pergunta de confirmação deve ser: "Sua empresa é a [Nome da Empresa], certo?".
   - Se o cliente responder "sim", "isso", "exato", "correto", confirme e avança a triagem.
   - Se o cliente responder "não" ou disser que o nome é outro, aceite a correção do cliente com elegância ("Entendido! Já registrei o nome correto aqui."), grave a empresa e avança.
   - Se o CNPJ tiver dígitos matematicamente incorretos, avise com elegância ("Ops, parece que esse CNPJ tem algum dígito incorreto. Consegue me enviar novamente?").

7. LEITURA E EXTRAÇÃO AUTOMÁTICA DE DOCUMENTOS E PDFS:
   - Se o cliente enviar um documento ou arquivo PDF (como Cartão CNPJ, Ficha Cadastral, Contrato Social, Nota Fiscal, etc.):
     a) Analise 100% dos dados contidos no arquivo PDF através da sua capacidade multimodal do Gemini 2.5 Pro.
     b) Extraia automaticamente a Razão Social/Empresa, o CNPJ/CPF, o Nome do Contato e o que for relevante.
     c) Preencha com exatidão os campos em \`extractedData\` (CNPJ OU CPF, EMPRESA, NOME COMPLETO).
     d) Responda ao cliente confirmando que você leu o documento PDF e registrou as informações da empresa (ex: "Recebi seu PDF! Já registrei o CNPJ e os dados da sua empresa aqui no sistema.").
     e) NUNCA torne a solicitar o CNPJ ou Nome de Empresa se essas informações constavam no PDF!

8. REGRAS DE MENSAGENS CITADAS (REPLY / QUOTE NO WHATSAPP):
   - REGRA 1 (Áudio, Imagem ou PDF enviado pelo cliente): Se o lote contiver algum Áudio, Imagem ou Documento PDF, você DEVE retornar em "quoteMessageId" o ID exato dessa mensagem do cliente.
   - REGRA 2 (Perguntas Espontâneas do Cliente): Se o cliente fez uma pergunta espontânea do nada e não estava apenas respondendo a uma pergunta sua (ex: "Vocês têm o catálogo pra me mandar?", "Onde vocês ficam???", "Quanto custa o frete?"), você DEVE selecionar o ID exato dessa pergunta em "quoteMessageId".
   - REGRA 3 (Uso Restrito / Triagem Normal): Em respostas normais do fluxo de qualificação (ex: o cliente apenas informou o nome "Pedro" ou respondeu "Sim" para a confirmação do CNPJ), DEIXE "quoteMessageId": null. NUNCA cite mensagens em triagens simples.

9. LIBERDADE DE FRAGMENTAÇÃO EM MENSAGENS:
   - Divida sua resposta no array \`messagesToSend\` em balões de mensagem menores para dar fluidez de conversa humana real no WhatsApp.
   - Se o cliente enviou um lote com várias mensagens ou perguntas picadas, responda de forma fragmentada (ex: 2, 3 ou 4 mensagens curtas separadas no array), sem embolar tudo num balão só!
   - Mantenha cada fragmento curto e direto (máximo 2 a 3 linhas por balão).

10. SOLICITAÇÃO DE CATÁLOGO E INFORMAÇÕES DE PRODUTOS (LINK VALEMPACK):
   - Sempre que o cliente pedir o CATÁLOGO, quiser ver mais informações sobre os produtos ou quiser conhecer tudo o que a Valem vende:
     a) Envie o link oficial do site: https://www.valempack.com.br
     b) Informe com muita simpatia e naturalidade que ele pode conferir diversos tipos, modelos e especificações de produtos e equipamentos lá no site!
     c) Não se esqueça de citar a mensagem do cliente ("quoteMessageId") já que se trata de uma solicitação espontânea!

11. CONCLUSÃO DA QUALIFICAÇÃO:
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
  "quoteMessageId": "id_da_mensagem_para_citar_ou_null",
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

      // 7. Determinar a Mensagem Citada (Quoted Message) com base nas 3 regras
      let targetQuoteItem: QueuedMessageItem | null = null;

      // Regra 1 (Programática Garantida): Se o lote contiver Áudio, Imagem ou PDF, cita a mídia!
      const mediaItem = batchItems.find((i) => i.mediaType === "audio" || i.mediaType === "image" || i.mediaType === "document");
      if (mediaItem && mediaItem.rawMsg) {
        targetQuoteItem = mediaItem;
      } else if (aiResult.quoteMessageId) {
        // Regra 2 (IA): Citação de pergunta espontânea do cliente
        const matchedItem = batchItems.find((i) => i.messageId === aiResult.quoteMessageId);
        if (matchedItem && matchedItem.rawMsg) {
          targetQuoteItem = matchedItem;
        }
      }

      // 8. Atualizar dados coletados no banco
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

      // 9. Envio Humanizado das Mensagens com presencia 'composing' longa, citação no WhatsApp e AbortSignal
      await this.sendHumanizedBotMessages(
        tenantId,
        conversationId,
        contactPhone,
        aiResult.messagesToSend,
        signal,
        targetQuoteItem
      );

      // 10. Notificar Supervisor se concluído
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
   * Envia fragmentos de mensagem com efeito de digitação realista, suporte a citação no WhatsApp (Quoted Reply) e checagem de AbortSignal
   */
  private async sendHumanizedBotMessages(
    tenantId: string,
    conversationId: string,
    phone: string,
    messagesArray: string[],
    signal?: AbortSignal,
    quoteItem?: QueuedMessageItem | null
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

      // 2. Delay de digitação humana realista estendido (2.2s a 4.2s)
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

      // 3. Enviar a mensagem no WhatsApp (aplica citação Quoted no 1º fragmento se houver quoteItem)
      const sendOptions: any = {};
      if (i === 0 && quoteItem && quoteItem.rawMsg) {
        sendOptions.quoted = quoteItem.rawMsg;
        console.log(`[SdrEngine] 💬 Enviando resposta com CITAÇÃO NATIVA do WhatsApp para a mensagem ${quoteItem.messageId || 'mídia'}`);
      }

      const sentMsg = await sock.sendMessage(realJid, { text: fragmentText }, sendOptions);
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

      const quotedMsgId = (i === 0 && quoteItem) ? (quoteItem.messageId || null) : null;
      const quotedContent = (i === 0 && quoteItem) ? quoteItem.text : null;

      await db.insert(messages).values({
        id: botMessageId,
        tenantId,
        conversationId,
        senderType: "bot",
        senderName: "Valentina (SDR)",
        content: fragmentText,
        isInternalNote: false,
        quotedMessageId: quotedMsgId,
        quotedMessageSender: quotedMsgId ? "Cliente" : null,
        quotedMessageContent: quotedContent,
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
          sentAt: new Date(),
          quotedMessageId: quotedMsgId,
          quotedMessageSender: quotedMsgId ? "Cliente" : null,
          quotedMessageContent: quotedContent,
        },
      });
    }
  }
}
