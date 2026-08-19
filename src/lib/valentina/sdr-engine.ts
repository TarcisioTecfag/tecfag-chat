
import { db } from "../../db";
import { agentConfigs, agentFlowStates, conversations, messages, internalMessages, contacts } from "../../db/schema";
import { eq, asc } from "drizzle-orm";
import { vertexAi, MultimodalPart } from "../vertex-ai";
import { SessionManager, resolveRealJid } from "../baileys/session-manager";
import { QueuedMessageItem } from "./sdr-debouncer";
import { extractCnpjFromText, fetchCnpjInfo } from "./cnpj-service";
import { getKnowledgeBaseContext } from "./knowledge-service";
import { autoCreateOrUpdateRdCrmDeal } from "./sdr-crm-auto";
import { getAiPersona } from "../ai-persona";
import { triggerOutboundCallInternal } from "../voice/outbound-call-service";
import { generateDynamicPttAudio } from "../voice/elevenlabs-dynamic-tts";



// ── Tipos do Resultado Estruturado da IA ──────────────────────────────────────────
export interface SdrAiResult {
  extractedData?: Record<string, any>;
  messagesToSend: string[];
  audioMessage?: {
    text: string;
    position?: "before_text" | "after_text" | "only_audio";
  } | null;
  quoteMessageId?: string | null;
  mediaDescription?: string | null; // Interpretação textual da mídia recebida (imagem/áudio/PDF)
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

/**
 * Sincroniza dados do Contato no DB local com os campos coletados na triagem/Receita Federal
 */
export async function syncContactDataFromTriage(
  tenantId: string,
  contactId: string,
  collectedData: Record<string, any> = {},
  cnpjDetailsInput?: any
) {
  try {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    if (!contact) return;

    const updates: Record<string, any> = {};

    const nameVal = collectedData["NOME COMPLETO"]?.value;
    const cnpjCpfVal = collectedData["CNPJ OU CPF"]?.value;

    if (
      nameVal &&
      typeof nameVal === "string" &&
      nameVal.trim() !== "" &&
      !nameVal.includes("Aguardando") &&
      nameVal.trim() !== contact.name
    ) {
      updates.name = nameVal.trim();
    }

    if (
      cnpjCpfVal &&
      typeof cnpjCpfVal === "string" &&
      cnpjCpfVal.trim() !== "" &&
      !cnpjCpfVal.includes("Aguardando") &&
      !cnpjCpfVal.includes("Invalido")
    ) {
      const cleanDigits = cnpjCpfVal.replace(/\D/g, "");
      if (cleanDigits.length === 14 && contact.cnpj !== cnpjCpfVal.trim()) {
        updates.cnpj = cnpjCpfVal.trim();
      } else if (cleanDigits.length === 11 && contact.cpf !== cnpjCpfVal.trim()) {
        updates.cpf = cnpjCpfVal.trim();
      }
    }

    if (cnpjDetailsInput) {
      updates.cnpjDetails = cnpjDetailsInput;
      if (cnpjDetailsInput.cnpjFormatted && contact.cnpj !== cnpjDetailsInput.cnpjFormatted) {
        updates.cnpj = cnpjDetailsInput.cnpjFormatted;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.update(contacts).set(updates).where(eq(contacts.id, contactId));
      console.log(`[SdrEngine] 🔄 Contato ${contactId} atualizado no DB local com dados da triagem/Receita:`, updates);

      SessionManager.getInstance().notifyPublic(tenantId, {
        type: "contact_updated",
        contactId: contactId,
        updates: updates,
      });
    }
  } catch (err: any) {
    console.error(`[SdrEngine] ⚠️ Erro em syncContactDataFromTriage:`, err?.message);
  }
}

export class SdrEngine {
  private static instance: SdrEngine;
  // Mutex por conversationId: garante que apenas 1 lote processa por conversa por vez
  // (evita race condition de saudação duplicada quando 2 lotes chegam quase juntos)
  private processingLocks: Map<string, Promise<boolean>> = new Map();

  private constructor() {}

  public static getInstance(): SdrEngine {
    if (!SdrEngine.instance) {
      SdrEngine.instance = new SdrEngine();
    }
    return SdrEngine.instance;
  }

  /**
   * Processa um lote consolidado de mensagens de uma conversa com Gemini 2.5 Pro Multimodal
   * Serializado por conversationId: apenas 1 lote por vez por conversa.
   */
  public async processBatchMessages(
    tenantId: string,
    conversationId: string,
    contactPhone: string,
    batchItems: QueuedMessageItem[],
    signal?: AbortSignal
  ): Promise<boolean> {
    // Serializa chamadas concorrentes da mesma conversa encadeando na promise anterior
    const previous = this.processingLocks.get(conversationId) ?? Promise.resolve(false);
    const current = previous.then(() => {
      if (signal?.aborted) return false;
      return this._processInternal(tenantId, conversationId, contactPhone, batchItems, signal);
    }).finally(() => {
      // Remove o lock apenas se ainda aponta para esta promise
      if (this.processingLocks.get(conversationId) === current) {
        this.processingLocks.delete(conversationId);
      }
    });
    this.processingLocks.set(conversationId, current);
    return current;
  }

  private async _processInternal(
    tenantId: string,
    conversationId: string,
    contactPhone: string,
    batchItems: QueuedMessageItem[],
    signal?: AbortSignal
  ): Promise<boolean> {
    try {
      if (!batchItems || batchItems.length === 0) return false;

      // 1. Carregar Configuração do Agente SDR no Banco — OBRIGATÓRIO filtrar por tenant.
      //    NUNCA usar fallback sem tenant: isso causa uso de config/prompt do tenant errado.
      let dbConfig = await db.query.agentConfigs.findFirst({
        where: (table, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(table.tenantId, tenantId), dEq(table.agentType, "sdr")),
      });

      if (!dbConfig) {
        console.warn(
          `[SdrEngine] agentConfig do tipo "sdr" não encontrado para tenant "${tenantId}". ` +
          `SDR desativado para este tenant. Crie o agentConfig no banco para ativar.`
        );
        return false;
      }

      const isEnabled = dbConfig ? dbConfig.enabled === 1 : true;
      const configData = (dbConfig?.config as Record<string, any>) || {};

      if (!isEnabled) {
        console.log(`[SdrEngine] SDR Valentina está DESATIVADO para tenant ${tenantId}. Ignorando lote.`);
        return false;
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
          metadata: { stepNumber: 1, totalSteps: 7, followUpStage: 0 },
          startedAt: new Date(),
          lastInteractionAt: new Date(),
          outcome: "in_progress",
        });

        flowState = await db.query.agentFlowStates.findFirst({
          where: (t, { eq: dEq }) => dEq(t.id, newFlowId),
        });
      }

      // 🛑 TRAVA DE OPERADOR: Se a conversa possui um operador humano alocado, está na aba 'meus'/'finalizados' ou a triagem terminou/parou, Valentina SILENCIA IMEDIATAMENTE!
      const convCheck = await db.query.conversations.findFirst({
        where: (t, { eq: dEq }) => dEq(t.id, conversationId),
      });

      if (
        convCheck?.operatorId ||
        convCheck?.queueState === "meus" ||
        convCheck?.queueState === "finalizados" ||
        flowState?.outcome === "completed" ||
        flowState?.outcome === "transferred" ||
        flowState?.outcome === "stopped"
      ) {
        console.log(`[SdrEngine] 🛑 TRAVA DE OPERADOR ATIVA: Conversa ${conversationId} (Cliente ${contactPhone}) possui operador alocado (${convCheck?.operatorId || 'Sim'}) ou status ${flowState?.outcome}. Valentina SILENCIADA.`);
        return false;
      }

      // 3. Buscar Histórico Recente de Mensagens Reais do Banco (últimas 80)
      const historyMsgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.sentAt))
        .limit(80);

      let hasPreviousEmoji = false;
      const conversationHistoryText = historyMsgs
        .map((m: any) => {
          if (m.senderType === "bot" && /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(m.content)) {
            hasPreviousEmoji = true;
          }
          const sender = m.senderType === "client" ? "Cliente" : "Valentina (SDR)";
          
          let contentText = m.content || "";
          if (typeof contentText === "string" && contentText.startsWith("[MEDIA:audio]")) {
            contentText = m.mediaInterpretation
              ? `🎤 [ÁUDIO DE VOZ ENVIADO PELA VALENTINA]: "${m.mediaInterpretation}"`
              : "🎤 [ÁUDIO DE VOZ]";
          }

          // Se a mensagem do cliente tinha mídia e a IA já interpretou, exibe a interpretação
          // para que a Valentina se lembre do que foi visto/ouvido sem reenviar o binário
          const mediaCtx = (m.senderType === "client" && m.mediaInterpretation)
            ? ` [MÍDIA RECEBIDA DO CLIENTE — O QUE FOI VISTO/OUVIDO: "${m.mediaInterpretation}"]`
            : "";
          return `[ID MENSAGEM: ${m.id}] [${sender}]${mediaCtx}: ${contentText}`;
        })
        .join("\n");

      // 4. Formatar o Lote Consolidado Atual de Mensagens com IDs
      // Descreve a mídia de forma natural para o Gemini entender o contexto
      const batchSummary = batchItems
        .map((m) => {
          let mediaLabel = "";
          if (m.mediaType === "image") mediaLabel = " [ENVIOU UMA IMAGEM — analise visualmente o conteúdo anexado]";
          else if (m.mediaType === "audio") mediaLabel = " [ENVIOU UM ÁUDIO — transcreva e interprete o que foi dito]";
          else if (m.mediaType === "document") mediaLabel = " [ENVIOU UM DOCUMENTO/PDF — leia e extraia os dados relevantes]";
          return `[ID MENSAGEM: ${m.messageId || "msg"}] Cliente${mediaLabel}: "${m.text}"`;
        })
        .join("\n");

      // 5. Montar Prompt Estruturado para o Gemini 2.5 Pro
      const existingCollectedData = (flowState?.collectedData as Record<string, any>) || {};

      const brtHourStr = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "numeric",
        hour12: false,
      }).format(new Date());
      const hour = parseInt(brtHourStr, 10);

      let greeting = "Boa tarde!";
      if (hour >= 5 && hour < 12) greeting = "Bom dia!";
      if (hour >= 18 || hour < 5) greeting = "Boa noite!";

      // Verificar se a saudação já foi enviada usando flag no metadata (evita race condition
      // entre lotes concorrentes onde ambos leem historyMsgs vazio e enviam saudação dupla)
      const metaState = (flowState?.metadata as Record<string, any>) || {};
      const greetingAlreadyDone = metaState.greetingDone === true;
      const hasBotRespondedBefore = greetingAlreadyDone || historyMsgs.some((m) => m.senderType === "bot");
      const isFirstMessage = !hasBotRespondedBefore;

      // Se for primeira mensagem, marca o flag imediatamente antes de processar
      // (evita que lotes paralelos também passem pela lógica de saudação)
      if (isFirstMessage && flowState) {
        await db.update(agentFlowStates)
          .set({ metadata: { ...metaState, greetingDone: true } })
          .where(eq(agentFlowStates.id, flowState.id));
      }

      const firstMessageRule = isFirstMessage
        ? `🟢 ATENÇÃO — PRIMEIRA MENSAGEM DO ATENDIMENTO (use saudação natural + apresentação adaptada ao contexto do cliente):

   ESTRUTURA OBRIGATÓRIA de apresentação — sem exceção:
   • Balão 1: Cumprimento no horário (exatamente "${greeting}" — ou "Bom dia!" ou "Boa noite!" conforme o horário. NÃO modifique.)
   • Balão 2: Apresentação. Exatamente: "Eu sou a Valentina, da Valem Valvulas e Embalagens 😊"

   BALÃO 3 EM DIANTE — adapte COMPLETAMENTE ao que o cliente já disse:
   ✅ Se o cliente APENAS SAUDOU (ex: "Oi", "Bom dia", "Olá"): Use "Como posso te ajudar?" no balão 3.
   ✅ Se o cliente JÁ DEU CONTEXTO (ex: "preciso de válvulas", "quero comprar em quantidade", "da pra falar por ligação"):
      - NÃO pergunte "Como posso te ajudar?" — ele já disse o que quer!
      - O balão 3 DEVE RECONHECER o que ele disse e puxar a triagem a partir daí.
      - Exemplos reais:
        * "Vi que você precisa de válvulas em grande quantidade — ótimo! Me conta um pouco mais sobre seu projeto?"
        * "Claro, podemos conversar por ligação também! Mas antes, me passa qual válvula você está procurando?"
        * "Quantidade grande de válvulas — que ótimo! Quer que eu te passe os nossos modelos disponíveis?"
   ✅ Se o cliente JÁ PEDIU LIGAÇÃO: reconheça e diga que vamos entrar em contato, mas continue colhendo os dados necessários pelo chat enquanto isso.

   🛑 PROIBIDO: "tudo bem por aqui?", "tudo joia?", qualquer frase de checagem de bem-estar.
   🛑 PROIBIDO: fingir que não leu o que o cliente disse na primeira mensagem!`
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
        console.log(`[SdrEngine] CNPJ detectado no lote: ${detectedCnpjCandidate}. Executando validação matemática...`);
        const cnpjInfo = await fetchCnpjInfo(detectedCnpjCandidate);

        if (cnpjInfo.valid && cnpjInfo.details) {
          try {
            if (convCheck?.contactId) {
              await syncContactDataFromTriage(tenantId, convCheck.contactId, {}, cnpjInfo.details);
              console.log(`[SdrEngine] 🏛️ Ficha Cadastral da Receita Federal salva com sucesso no Contato ${convCheck.contactId}!`);
            }
          } catch (e: any) {
            console.error("[SdrEngine] Erro ao salvar cnpjDetails no contato:", e?.message);
          }
        }

        if (!cnpjInfo.valid) {
          cnpjDirective = `\n⚠️ ALERTA DE CNPJ INVÁLIDO (${cnpjInfo.cnpjFormatted}): O CNPJ enviado pelo cliente POSSUI ERRO MATEMÁTICO nos dígitos verificadores ou está incompleto.
É ESTRITAMENTE PROIBIDO INVENTAR NOME DE EMPRESA OU MARCAR 'CNPJ OU CPF' OU 'EMPRESA' COMO PREENCHIDOS!
- NÃO inclua 'CNPJ OU CPF' nem 'EMPRESA' em \`extractedData\`.
- Informe o cliente com extrema simpatia humana que o CNPJ parece ter algum dígito faltando ou incorreto e peça a gentileza de conferir e enviar novamente.`;
        } else if (cnpjInfo.razaoSocial) {
          cnpjDirective = `\n🟢 CNPJ VÁLIDO ENCONTRADO:
- CNPJ: ${cnpjInfo.cnpjFormatted}
- Razão Social/Empresa: "${cnpjInfo.razaoSocial}" ${cnpjInfo.nomeFantasia ? `(Fantasia: ${cnpjInfo.nomeFantasia})` : ""}
INSTRUÇÕES OBRIGATÓRIAS:
1. Defina em \`extractedData\` o CNPJ OU CPF como "${cnpjInfo.cnpjFormatted}" e EMPRESA como "${cnpjInfo.razaoSocial}".
2. Pergunte ao cliente para confirmar: "Sua empresa é a ${cnpjInfo.razaoSocial}, certo?"`;
        } else {
          cnpjDirective = `\n🟢 CNPJ VÁLIDO (${cnpjInfo.cnpjFormatted}): Os dígitos verificadores estão matematicamente corretos. Defina em \`extractedData\` o CNPJ OU CPF como "${cnpjInfo.cnpjFormatted}".`;
        }
      }

      const knowledgeContext = await getKnowledgeBaseContext(tenantId);

      const aiPersona = getAiPersona(tenantId);
      const promptText = `Você é ${aiPersona.name}, ${aiPersona.gender === "female" ? "a" : "o"} consultora(or) comercial pré-vendas (SDR) humana(o) da ${aiPersona.company} (${aiPersona.segment}).
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
   - PROIBIÇÃO DO VÍCIO "OPA": NUNCA repita o vício de linguagem "Opa" ou "Opa," no início das frases! Fica robótico e esquisito. Varie com inícios naturais como: "Ah, perfeito!", "Certo,", "Claro!", "Entendi,", "Legal!", "Com certeza,", "Ah, bom!".

2. INTELIGÊNCIA EMOCIONAL, ESPELHAMENTO DE TOM E REAÇÕES:
   - ESPELHAMENTO DE TOM: Se o cliente mandar mensagem animada ou descontraída, responda empolgada! Se o cliente estiver com pressa ou formal, seja rápida, direta e resolutiva.
   - RISADAS E INFORMALIDADE (REGRA ESTRITA DE "KKKK"): Se o cliente brincar, rir ou mandar piadas, use SEMPRE risadas humanas reais brasileiras ("kkkk" ou "kkkkk"). 🛑 É ESTRITAMENTE PROIBIDO USAR "hahaha", "Hahaha" OU "haha"! Fica parecendo robô de livro de português. No WhatsApp real do Brasil, pessoas reais usam "kkkk" ou "kkkkk"!
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

6. FLUXO DE CNPJ E EMPRESA E PROIBIÇÃO ABSOLUTA DA MENÇÃO À RECEITA FEDERAL:
   - 🛑 É PROIBIDO NAVEGAR OU CITAR OS TERMOS: "Receita Federal", "sistema da Receita", "cnpj.ws", "banco de dados", "consulta do sistema"! NUNCA use essas justificativas.
   - NUNCA pergunte "Qual o nome da sua empresa?". Pergunte APENAS o CNPJ (ou CPF).
   - Quando o cliente enviar o CNPJ, sua única pergunta de confirmação deve ser: "Sua empresa é a [Nome da Empresa], certo?".
   - 🛑 ATENÇÃO CRÍTICA SOBRE CONFIRMAÇÃO: Quando você perguntar "Sua empresa é a [Nome da Empresa], certo?", MANTENHA \`isCompleted: false\`! Você É OBRIGADA a aguardar o cliente responder confirmando ("Sim", "Certo", "Correto") ou corrigindo antes de concluir o atendimento!
   - 🛑 PROIBIÇÃO ABSOLUTA DE COBRANÇA OU QUESTIONAMENTO DE RAMO DA EMPRESA: Se o cliente responder confirmando ("Sim", "Certo", "Correto"), ACEITE A RESPOSTA IMEDIATAMENTE SEM DAR OPINIÃO E SEM QUESTIONAR! NUNCA demonstre estranheza, dúvida ou peça justificativas sobre a relação entre o ramo da empresa (ex: pagamentos, TI, serviços, comércio, holding) e o produto a ser comprado (ex: válvulas, frascos, body splash). Valentina NÃO TEM O DIREITO de cobrar explicações ou opinar sobre o negócio do cliente!
   - 🛑 REGRA DE TELEFONE / LIGAÇÃO: É ESTRITAMENTE PROIBIDO pedir o número de telefone com DDD ao cliente! A pergunta sobre ligação DEVE ser sempre exatamente: "Posso te ligar nesse número mesmo do Whats?" (ou "O ideal é que a gente te ligue com a cotação já prontinha, posso te ligar nesse número do Whats mesmo?").
   - Se o cliente responder que o nome não é esse ou corrigir, aceite o nome digitado pelo cliente IMEDIATAMENTE com muita elegância humana: "Ah, me desculpe pelo equívoco! Qual é o nome correto da sua empresa para eu registrar aqui?".
   - Se o CNPJ for inválido ou tiver erro nos dígitos, diga educadamente: "Ops, parece que esse CNPJ tem algum dígito incorreto ou faltando. Consegue me enviar novamente por favor?". NUNCA invente nome de empresa nem preencha CNPJ inválido.

7. REGRAS DE IMAGEM, ÁUDIO E DOCUMENTO — PROIBIÇÃO DE CONFIRMAÇÕES MECÂNICAS:

   ❌ É ESTRITAMENTE PROIBIDO dizer frases de confirmação robótica de recebimento de mídia como:
      - "Recebi a imagem!", "Imagem recebida!", "Vi sua foto!", "Foto recebida!"
      - "Recebi seu áudio!", "Ouvi sua mensagem de voz!"
      - "Recebi seu PDF!", "Documento recebido!", "Já registrei no sistema!"
      Qualquer frase desse tipo soa como robô e quebra completamente a experiência de conversa humana.

   ❌ É IGUALMENTE PROIBIDO confirmar dados informados pelo cliente de forma robótica:
      - "Já anotei aqui o seu interesse nas 100 mil unidades!"
      - "Tomei nota do seu pedido!"
      - "Já registrei sua quantidade!"
      - "Recebi sua informação!"
      Uma pessoa NUNCA fala assim. Confirmar que "anotou" soa como sistema de chamados, não conversa.

   ✅ REGRA OBRIGATÓRIA: Você DEVE começar a resposta JÁ USANDO o conteúdo da mídia ou dado recebido, como uma pessoa real faria:
      - Para IMAGEM: "Certo, olhando a foto que você mandou... [observação sobre o produto/conteúdo]"
        ou: "Pelo que vi aqui, parece ser [identificação do produto], é esse mesmo?"
        ou: "Essa valvula da foto é o modelo [X] — você quer esse tipo mesmo?"
      - Para ÁUDIO: "Então, pelo que ouvi você precisa de [resumo do que foi dito]..."
        ou: "Entendi! Você falou que quer [resumo do áudio], certo?"
      - Para PDF/DOCUMENTO: "Vi aqui no documento que a empresa é [Nome Empresa] e o CNPJ é [CNPJ]..."
        ou: "Com base no PDF, já registrei seus dados — empresa [X], CNPJ [Y]."
      - Para DADO INFORMADO (quantidade, produto, etc.): IGNORE o dado e continue DIRETAMENTE para a próxima
        pergunta ou comentário. Ex: cliente falou "preciso de 100 mil" → Valentina responde "100 mil é bastante!
        Você tem alguma previsão de quando precisa da primeira entrega?"
        NÃO: "Temos sim, e já anotei aqui o seu interesse nas 100 mil unidades."

   REGRA ESPECIAL — IMAGEM SEM TEXTO (cliente só mandou foto, sem escrever nada):
      Se o cliente enviou apenas uma imagem sem nenhum texto explicativo:
      a) Analise visualmente o produto/conteúdo da imagem.
      b) Faça uma observação natural sobre o que você está vendo (ex: "Olhando aqui... parece uma válvula para aerossol de acionamento vertical").
      c) Pergunte se é aquele modelo que ele está buscando (ex: "É esse tipo que você precisa?").
      d) NÃO pergunte "O que você quer saber sobre isso?" — seja mais consultiva e específica.

   CAMPO OBRIGATÓRIO NO JSON — mediaDescription:
      Em toda resposta que envolva imagem, áudio ou documento, você DEVE preencher o campo:
      "mediaDescription": "descrição curta (máximo 2 linhas) do que foi visto/ouvido/lido na mídia"
      Exemplos:
        - Imagem: "Válvula de acionamento vertical, tipo spray, para frasco de 100ml a 500ml"
        - Áudio: "Cliente solicitou 5000 unidades de frasco pet 50ml para produto de higiene"
        - PDF: "Cartão CNPJ da empresa Distribuidora XYZ Ltda, CNPJ 12.345.678/0001-99"
      Se não houver mídia no lote atual, defina: "mediaDescription": null


8. REGRAS DE MENSAGENS CITADAS (REPLY / QUOTE NO WHATSAPP):
   - REGRA 1 (Áudio, Imagem ou PDF enviado pelo cliente): Se o lote contiver algum Áudio, Imagem ou Documento PDF, você DEVE retornar em "quoteMessageId" o ID exato dessa mensagem do cliente.
   - REGRA 2 (Perguntas Espontâneas do Cliente): Se o cliente fez uma pergunta espontânea do nada e não estava apenas respondendo a uma pergunta sua (ex: "Vocês têm o catálogo pra me mandar?", "Onde vocês ficam???", "Quanto custa o frete?"), você DEVE selecionar o ID exato dessa pergunta em "quoteMessageId".
   - REGRA 3 (CRÍTICA — CLIENTE NÃO RESPONDEU A SUA PERGUNTA / FUGA DE PERGUNTA): Se você (Valentina) fez uma pergunta na sua mensagem anterior (ex: pediu CNPJ/CPF, Nome, Produto ou Quantidade) e o cliente NÃO respondeu a essa pergunta no novo lote, mas apenas comentou outro assunto (ex: concordou com uma explicação ou continuou falando do produto):
     a) NUNCA REPITA A PERGUNTA POR EXTENSO! Fica chato, repetitivo e robótico.
     b) Responda ou confirme o comentário do cliente normalmente nos primeiros balões (ex: "Isso mesmo, Tarcísio! Exatamente essa a diferença.", "Que bom que fez sentido! Vamos seguir com a opção para perfume...").
     c) Em \`quoteMessageId\`: RETORNE O ID EXATO DA SUA MENSAGEM ANTERIOR (da Valentina) ONDE VOCÊ FEZ A PERGUNTA PENDENTE (ex: o ID da mensagem onde pediu o CNPJ/CPF ou Nome)!
     d) No último balão do array \`messagesToSend\`, envie EXCLUSIVAMENTE a frase curta e simpática: "Só me responde isso rapidinho 😊" (ou "Só me responde isso aqui rapidinho").
   - REGRA 4 (Uso Restrito / Triagem Normal): Em respostas normais do fluxo de qualificação onde o cliente respondeu o que foi perguntado, DEIXE "quoteMessageId": null. NUNCA cite mensagens em triagens simples.

9. LIBERDADE DE FRAGMENTAÇÃO EM MENSAGENS — SEM LIMITE DE BALÕES:
   - Divida sua resposta no array \`messagesToSend\` em quantos balões forem necessários. NÃO HÁ LIMITE de quantidade de balões!
   - NUNCA comprima múltiplas ideias, observações ou perguntas em um único balão longo. Isso vira textão e quebra a experiência de WhatsApp.
   - Se o cliente enviou uma foto, áudio ou várias mensagens, fragmente sua resposta em 3, 4, 5 ou mais balões — cada um com UMA ideia só.
   - Cada fragmento deve ser CURTO: máximo 2 linhas por balão. Se ficou grande, quebre em dois.
   - Exemplo correto (5 balões):
     ["Certo, olhando a foto aqui...", "Essa válvula é o modelo spray de 5/8\", para frasco de até 500ml.", "Você pensou em qual produto vai envasar nela?", "Perfume? Higiene? Me conta o projeto 😊", "E já tem uma estimativa de volume mensal?"]

10. REGRA OBRIGATÓRIA DE ENVIO DE CATÁLOGO E LINK DO SITE (VALEMPACK):
   - Sempre que o cliente pedir o CATÁLOGO, quiser ver fotos/opções de produtos ou perguntar o que a Valem vende, você DEVE OBRIGATORIAMENTE fragmentar a resposta no array \`messagesToSend\` em EXATAMENTE 3 BALÕES DE MENSAGEM SEPARADOS:
     - Mensagem 1: Apresentação simpática do site (ex: "Você pode ver todos os nossos modelos e opções direto no nosso site:")
     - Mensagem 2: EXCLUSIVAMENTE O LINK DO SITE ISOLADO: "https://www.valempack.com.br"
     - Mensagem 3: A próxima pergunta da triagem ou continuidade (ex: "Mas me conta, qual o seu projeto pra eu te ajudar melhor?")
   - Cite a mensagem do cliente ("quoteMessageId") na primeira mensagem caso se trate de uma solicitação espontânea!

11. CONCLUSÃO DA QUALIFICAÇÃO:
   - Quando tiver Produto, Projeto/Empresa, Nome e CNPJ/CPF (ou se o cliente recusou informar previsão/dados adicionais), marque \`isCompleted: true\`.

12. REGRA DE INTERPRETAÇÃO AUTOMÁTICA DO CAMPO "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO":
   - NUNCA pergunte ao cliente "É projeto ou desenvolvimento?".
   - Este campo é uma interpretação EXCLUSIVAMENTE SUA com base no pedido:
     * Se o cliente buscar itens padrão de linha/estoque (ex: válvulas spray, frascos, potes, seladoras), defina em \`extractedData\` como: "Não (Venda Padrão de Estoque)".
     * Se o cliente buscar itens sob medida, moldes exclusivos ou desenvolvimento personalizado, defina como: "Sim (Desenvolvimento Customizado)".
     * Assim que o produto for identificado no diálogo, preencha este campo automaticamente sem perguntar nada ao cliente!

13. REGRA DE INTERPRETAÇÃO AUTOMÁTICA DO CAMPO "TIPO DE QUALIFICAÇÃO":
   - NUNCA pergunte ao cliente "Qual o tipo de qualificação?".
   - NUNCA utilize termos genéricos como "Inbound".
   - O campo "TIPO DE QUALIFICAÇÃO" em \`extractedData\` DEVE SER EXATAMENTE UMA das 6 opções oficiais da Valem abaixo, interpretada por você com base no pedido e volume do lead:
     1. "Varejo / Baixo Volume": Se o cliente busca volumes menores (ex: 50 a 500 unidades para e-commerce/revenda inicial).
     2. "Fora de Portfólio": Quando o cliente pede algo que a Valem não fabrica ou não vende (ex: frascos de vidro se a Valem só trabalha com plásticos/PET).
     3. "Cotação para Comparação": O lead busca apenas um número/preço para balizar outra compra com concorrente.
     4. "Industrial – Recorrência": Cliente industrial ativo que já produz e necessita de entregas mensais recorrentes.
     5. "Industrial – Lançamento": Cliente lançando um produto novo no mercado, necessitando de envio de amostras e venda consultiva.
     6. "Industrial – Troca de Fornecedor": Oportunidade de migrar cliente insatisfeito com concorrente por atraso, qualidade ou preço.

14. CONSULTORIA E RESPOSTA OBRIGATÓRIA COM BASE NA BASE DE CONHECIMENTO & CATÁLOGO:
   - Você tem acesso direto aos dados técnicos, tabelas, argumentos comerciais e catálogo de produtos contidos na seção "📚 BASE DE CONHECIMENTO" no início do seu prompt.
   - SEMPRE que o cliente fizer qualquer pergunta sobre produtos, modelos de válvulas (Spray, Pump, Gatilho, Espumadora), terminações de rosca (24/410, 28/410), compatibilidade de materiais (PET, PEAD, Alumínio), volumetrias, argumentos, prazos ou diferenciais, você DEVE responder com autoridade, precisão e naturalidade consultiva ANTES de continuar com o fluxo de triagem. NUNCA diga que não sabe se a informação estiver presente na Base de Conhecimento!

15. DIRETRIZES DE RESPOSTA EM ÁUDIO DE VOZ (ELEVENLABS TTS):
   - Você tem a capacidade de responder enviando uma mensagem de voz/áudio falada por você (Valentina) no WhatsApp.
   - Quando usar o campo "audioMessage":
     a) Se o cliente enviou um áudio no lote atual (espelhamento de canal de comunicação com rapport imediato).
     b) Se você estiver explicando detalhes técnicos ou comerciais (diferenças entre válvulas spray/dosadoras, compatibilidade de frascos, acabamentos ou tiragens mínimas) onde uma explicação falada soa muito mais atenciosa e humana que um texto longo.
     c) Se você quiser fazer uma pergunta de qualificação com tom empático e consultivo.
   - Se for enviar áudio, preencha:
     "audioMessage": {
       "text": "texto exato a ser falado por você com entonação natural, calorosa e concisa (máximo 200 caracteres, ~15 segundos de fala)",
       "position": "after_text"
     }
   - Se for responder 100% por texto (como em perguntas triviais de rotina ou mensagens curtas), defina "audioMessage": null.

Retorne EXCLUSIVAMENTE o JSON no formato:
{
  "extractedData": {
    "NOME COMPLETO": "valor ou mantem anterior",
    "EMPRESA": "valor ou mantem anterior",
    "CNPJ OU CPF": "valor ou mantem anterior",
    "QUALIFICAÇÃO (TEMPERATURA)": "Quente / Morno / Frio",
    "TIPO DE QUALIFICAÇÃO": "uma das 6 opções oficiais acima",
    "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO": "valor ou mantem anterior",
    "QUAL O TIPO DE PRODUTO?": "valor ou mantem anterior"
  },
  "messagesToSend": ["balão 1 curto", "balão 2 curto", "balão 3 curto", "balão 4 se necessário", "balão 5 se necessário"],
  "audioMessage": {
    "text": "texto falado da mensagem de voz ou null se não houver áudio",
    "position": "after_text"
  },
  "quoteMessageId": "id_da_mensagem_para_citar_ou_null",
  "mediaDescription": "descrição curta do conteúdo da mídia recebida, ou null se não houve mídia",
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
          signal,
          {
            tenantId,
            feature: "sdr_agent",
            metadata: { conversationId },
          }
        );
      }

      if (signal?.aborted) return false;

      // Se a IA não retornar resultado válido (timeout, erro de parse, etc.), silencia sem enviar
      // nada ao cliente — Valentina não deve ter fallback de mensagem pública.
      if (!aiResult || !aiResult.messagesToSend || aiResult.messagesToSend.length === 0) {
        console.warn(`[SdrEngine] ⚠️ Vertex AI retornou resultado vazio para conversa ${conversationId}. Valentina silenciada neste turno.`);
        return false;
      }

      // 🛑 GARANTIA PROGRAMÁTICA: Se for a PRIMEIRA mensagem do atendimento:
      if (isFirstMessage) {
        const combinedText = batchItems.map((i) => i.text).join(" ").toLowerCase();

        // Checar se o cliente apenas deu oi/saudação ou se já explicou o que precisa
        const isGenericGreetingOnly =
          combinedText.replace(/[^a-z0-9]/g, "").length < 25 &&
          !/(embalag|valv|válv|spray|frasc|pote|selad|catal|catál|prec|preç|cota|cotá|orç|orc|sab|comp|prod|inform|duvid|dúvid)/.test(combinedText);

        if (isGenericGreetingOnly) {
          // Cliente só cumprimentou — estrutura fixa de 3 balões
          aiResult.messagesToSend = [
            greeting,
            `Eu sou a ${aiPersona.name}, da ${aiPersona.company}  😊`,
            "Como posso te ajudar?",
          ];
        } else {
          // Cliente já trouxe conteúdo (foto, produto, texto explicativo).
          // Preserva TODOS os balões que a IA gerou — sem limite de quantidade.
          // Apenas substitui os 2 primeiros por greeting + apresentação obrigatórios.
          aiResult.messagesToSend = [
            greeting,
            `Eu sou a ${aiPersona.name}, da ${aiPersona.company}  😊`,
            ...aiResult.messagesToSend, // todos os balões da IA vêm depois
          ];
        }
      }

      // 🛑 SANITIZAÇÃO DE RISADAS: Substitui automaticamente qualquer "Hahaha" ou "hahaha" por "kkkkk"
      if (aiResult && aiResult.messagesToSend) {
        aiResult.messagesToSend = aiResult.messagesToSend.map((msg) =>
          msg
            .replace(/\bHahaha+\b/g, "kkkkk")
            .replace(/\bhahaha+\b/g, "kkkkk")
            .replace(/\bHaha+\b/g, "kkkk")
            .replace(/\bhaha+\b/g, "kkkk")
        );
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

      // Regra 3 (Garantia de Citação): Se não houver citação de mídia/específica, cita a última mensagem do cliente no lote!
      if (!targetQuoteItem && batchItems.length > 0) {
        const lastItemWithMsg = [...batchItems].reverse().find(i => i.rawMsg);
        if (lastItemWithMsg) {
          targetQuoteItem = lastItemWithMsg;
        }
      }


      // 8. Atualizar dados coletados no banco
      const updatedCollectedData = { ...existingCollectedData };

      // Se o lote enviou um CNPJ matematicamente inválido, expurgar qualquer tentativa da IA de preencher CNPJ ou Empresa
      if (detectedCnpjCandidate) {
        const cnpjCheck = await fetchCnpjInfo(detectedCnpjCandidate);
        if (!cnpjCheck.valid && aiResult.extractedData) {
          delete aiResult.extractedData["CNPJ OU CPF"];
          delete aiResult.extractedData["EMPRESA"];
          delete updatedCollectedData["CNPJ OU CPF"];
          delete updatedCollectedData["EMPRESA"];
        }
      }

      if (aiResult.extractedData) {
        for (const [k, rawV] of Object.entries(aiResult.extractedData)) {
          const v = String(rawV || "").trim();
          if (v && !v.toLowerCase().includes("mantem")) {
            const lowerV = v.toLowerCase();
            // Evitar que booleans ou respostas de confirmação ("sim"/"true") sobrescrevam o nome real da empresa ou CNPJ
            if (k === "EMPRESA" && ["true", "false", "sim", "nao", "não"].includes(lowerV)) {
              console.log(`[SdrEngine] 🛡️ Ignorada tentativa da IA de preencher EMPRESA com resposta booleana: "${v}"`);
              continue;
            }
            if (k === "CNPJ OU CPF" && ["true", "false", "sim", "nao", "não"].includes(lowerV)) {
              console.log(`[SdrEngine] 🛡️ Ignorada tentativa da IA de preencher CNPJ com resposta booleana: "${v}"`);
              continue;
            }
            updatedCollectedData[k] = { value: v, status: "filled" };
          }
        }
      }

      // 8.1 Verificação da presença dos Dados Vitais
      const nameVal = updatedCollectedData["NOME COMPLETO"]?.value || "";
      const companyVal = updatedCollectedData["EMPRESA"]?.value || "";
      const cnpjVal = updatedCollectedData["CNPJ OU CPF"]?.value || "";
      const productVal = updatedCollectedData["QUAL O TIPO DE PRODUTO?"]?.value || "";

      const hasName = Boolean(nameVal && nameVal.trim() !== "" && !nameVal.toLowerCase().includes("aguardando"));
      const hasCompany = Boolean(companyVal && companyVal.trim() !== "" && !companyVal.toLowerCase().includes("aguardando"));
      const hasCnpj = Boolean(cnpjVal && cnpjVal.trim() !== "" && !cnpjVal.toLowerCase().includes("aguardando") && !cnpjVal.toLowerCase().includes("invalido"));
      const hasProduct = Boolean(productVal && productVal.trim() !== "" && !productVal.toLowerCase().includes("aguardando"));

      // Todos os dados essenciais para o CRM foram efetivamente fornecidos pelo cliente?
      const hasVitalInformation = hasName && (hasCompany || hasCnpj) && hasProduct;

      // Contagem de campos vitais já preenchidos (usada no metadata do flowState)
      const filledCount = [hasName, hasCompany || hasCnpj, hasProduct].filter(Boolean).length;

      // Verifica se a resposta da Valentina inclui frases EXPLÍCITAS e inequívocas de transferência.
      const messagesMentionTransfer = aiResult.messagesToSend.some((m) => {
        const lower = m.toLowerCase();
        return (
          // Padrões explícitos de transferência ativa
          (lower.includes("transferindo agora") || lower.includes("te transferindo")) ||
          (lower.includes("passando") && (lower.includes("especialista") || lower.includes("vendedor"))) ||
          (lower.includes("passando agora") && (lower.includes("contato") || lower.includes("detalhes") || lower.includes("dados"))) ||
          (lower.includes("encaminhando") && (lower.includes("especialista") || lower.includes("vendedor"))) ||
          (lower.includes("dar continuidade ao seu atendimento") && lower.includes("especialista")) ||
          // Padrões de despedida pós-triagem inequívocos
          (lower.includes("agradeço muito o seu contato") || lower.includes("agradeco muito o seu contato")) ||
          (lower.includes("agradecemos o seu contato") || lower.includes("obrigada pelo contato")) ||
          (lower.includes("boa sorte") && lower.includes("negócios")) ||
          (lower.includes("vai entrar em contato") && (lower.includes("especialista") || lower.includes("vendedor"))) ||
          (lower.includes("ligar") && lower.includes("cotação") && lower.includes("especialista"))
        );
      });

      // Verifica se a Valentina está fazendo uma pergunta REAL de coleta de dado neste lote
      // (perguntas retóricas de despedida como "ok?" ou "né?" NÃO bloqueiam a conclusão)
      const FAREWELL_QUESTION_PATTERNS = /\b(ok\?|tá\?|ta\?|né\?|ne\?|certo\?|combinado\?|não é\?|não é mesmo\?|tudo bem\?)\s*$/i;
      const REAL_QUESTION_KEYWORDS = /\b(qual|quais|como|onde|quando|quantas|quantos|quanto|você pode|pode me|me informa|me passa|me envia|me confirma o nome|me confirma o cnpj|cnpj|cpf|nome completo|nome da empresa)\b/i;

      const botIsAskingQuestion = aiResult.messagesToSend.some((m) => {
        // Pergunta retórica/protocolar de despedida — NÃO bloqueia
        if (FAREWELL_QUESTION_PATTERNS.test(m.trim())) return false;
        // Pergunta real de coleta de dados — bloqueia
        return REAL_QUESTION_KEYWORDS.test(m);
      });

      // ╔══════════════════════════════════════════════════════════════════════╗
      // ║  REGRA BLINDADA DE CONCLUSÃO DA TRIAGEM                            ║
      // ║  hasVitalInformation é CONDIÇÃO OBRIGATÓRIA E INVIOLÁVEL.          ║
      // ║  A IA jamais pode encerrar a triagem sem dados vitais coletados.   ║
      // ╚══════════════════════════════════════════════════════════════════════╝
      let isCompleted = false;
      if (hasVitalInformation) {
        // Com dados vitais coletados: aceita conclusão da IA (sem pergunta real pendente) OU transferência explícita
        if ((aiResult.isCompleted && !botIsAskingQuestion) || messagesMentionTransfer) {
          isCompleted = true;
        }
      }
      // SEM hasVitalInformation → isCompleted = false SEMPRE, independente do que a IA disser

      console.log(`[SdrEngine] 📊 Diagnóstico de conclusão — hasName=${hasName} hasCompany=${hasCompany} hasCnpj=${hasCnpj} hasProduct=${hasProduct} | hasVitalInfo=${hasVitalInformation} | aiIsCompleted=${aiResult.isCompleted} | botAskingQuestion=${botIsAskingQuestion} | mentionTransfer=${messagesMentionTransfer} → isCompleted=${isCompleted}`);

      const wasAlreadyCompleted = flowState?.outcome === "completed" || flowState?.outcome === "transferred";
      const now = new Date();

      // 9. Alocar responsável no Rodízio SE a qualificação acabou de ser concluída
      let allocatedOp: any = null;
      if (isCompleted && !wasAlreadyCompleted && !signal?.aborted) {
        try {
          const clientName = updatedCollectedData["NOME COMPLETO"]?.value || "Cliente WhatsApp";
          const company = updatedCollectedData["EMPRESA"]?.value || "Empresa não informada";

          // Alocação real do próximo vendedor disponível no rodízio
          const { RodizioEngine } = await import("./rodizio-engine");
          allocatedOp = await RodizioEngine.allocateNextOperator(tenantId, conversationId, clientName);

          const supervisorNotifId = `notif-${Date.now()}`;
          const targetOpId = allocatedOp?.id;

          if (targetOpId) {
            await db.insert(internalMessages).values({
              id: supervisorNotifId,
              tenantId,
              operatorId: targetOpId,
              direction: "from_agent",
              agentType: "supervisor",
              content: `🎯 Lead qualificado pela Valentina: *${clientName}* (${company}). Atendimento alocado automaticamente para *${allocatedOp.name}* no rodízio!`,
              metadata: { type: "lead_transfer", conversationId },
              read: 0,
              createdAt: new Date(),
            });
          }

          // Automação: Cria e vincula o Card no RD Station CRM com os dados coletados na triagem da Valentina
          try {
            console.log(`[SdrEngine] 📦 Disparando autoCreateOrUpdateRdCrmDeal para ${contactPhone} (conversa: ${conversationId})...`);
            const crmResult = await autoCreateOrUpdateRdCrmDeal({
              tenantId,
              conversationId,
              contactPhone,
              collectedData: updatedCollectedData,
              allocatedOperator: allocatedOp,
            });
            console.log(`[SdrEngine] 🏁 Resultado da automação do RD CRM: ${crmResult ? "SUCESSO ✅" : "FALHA / RECUSADO ⚠️"}`);
          } catch (crmErr: any) {
            console.error("[SdrEngine] ❌ Erro ao executar autoCreateOrUpdateRdCrmDeal:", crmErr?.stack || crmErr?.message || crmErr);
          }
        } catch (rErr: any) {
          console.error("[SdrEngine] ❌ Erro ao alocar no rodízio ou acionar CRM:", rErr?.message || rErr);
        }
      } else {
        console.log(`[SdrEngine] ℹ️ Conclusão da triagem não disparada neste turno. (isCompleted=${isCompleted}, wasAlreadyCompleted=${wasAlreadyCompleted}, aborted=${Boolean(signal?.aborted)})`);
      }

      // 10. Se a qualificação foi concluída agora, ANUNCIAR A TRANSFERÊNCIA PERSONALIZADA COM O NOME REAL DO VENDEDOR!
      if (isCompleted && !wasAlreadyCompleted) {
        const sellerFirstName = allocatedOp?.name ? allocatedOp.name.split(" ")[0] : null;

        if (sellerFirstName) {
          let replacedAny = false;
          aiResult.messagesToSend = aiResult.messagesToSend.map((msg) => {
            const original = msg;

            let updatedMsg = msg
              .replace(/um dos nossos vendedores especialistas/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/um de nossos vendedores especialistas/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/nossos vendedores especialistas/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/vendedores especialistas/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/vendedor especialista/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/um de nossos especialistas comerciais/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/um dos nossos especialistas comerciais/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/nossa equipe de atendimento comercial/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/nossa equipe comercial/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/um dos nossos vendedores/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/um de nossos vendedores/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/nossos vendedores/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/um dos nossos especialistas/gi, `${sellerFirstName}`)
              .replace(/um de nossos especialistas/gi, `${sellerFirstName}`)
              .replace(/um especialista/gi, `${sellerFirstName}`)
              .replace(/nossos especialistas/gi, `${sellerFirstName}`)
              .replace(/vendedores/gi, `${sellerFirstName}, nosso especialista comercial`)
              .replace(/nossa equipe/gi, `${sellerFirstName}`);

            if (updatedMsg !== original) {
              replacedAny = true;
            }
            return updatedMsg;
          });

          if (!replacedAny && !botIsAskingQuestion) {
            aiResult.messagesToSend.push(
              `Estou te transferindo agora para ${sellerFirstName}, nosso especialista comercial! Já vai dar continuidade ao seu atendimento 😊`
            );
          }
        }
      }

      if (flowState) {
        await db
          .update(agentFlowStates)
          .set({
            currentStep: isCompleted ? "Concluído" : "Em Qualificação",
            collectedData: updatedCollectedData,
            metadata: { ...metaState, stepNumber: filledCount, totalSteps: 7 },
            lastInteractionAt: now,
            completedAt: isCompleted ? (flowState.completedAt || now) : null,
            outcome: isCompleted ? (wasAlreadyCompleted ? flowState.outcome : "transferred") : "in_progress",
          })
          .where(eq(agentFlowStates.id, flowState.id));

        // Sincronizar o Contato no DB local (Nome, CNPJ, CPF, Receita Federal) e notificar a interface
        if (convCheck?.contactId) {
          await syncContactDataFromTriage(tenantId, convCheck.contactId, updatedCollectedData);
        }
      }

      // ── Salvar interpretação de mídia na mensagem do cliente (memória visual futura) ──
      // Se o Gemini retornou uma mediaDescription, salvamos na mensagem do cliente que
      // continha a mídia para que em turnos futuros a Valentina saiba o que foi visto/ouvido
      // sem precisar reenviar o binário da imagem/áudio/PDF.
      if (aiResult.mediaDescription && mediaItem) {
        try {
          await db
            .update(messages)
            .set({ mediaInterpretation: aiResult.mediaDescription } as any)
            .where(eq(messages.id, mediaItem.messageId || ""));
          console.log(`[SdrEngine] 📸 Interpretação de mídia salva na mensagem ${mediaItem.messageId}: "${aiResult.mediaDescription.slice(0, 60)}..."`);
        } catch (mediaErr: any) {
          // Não é crítico — falha silenciosa para não bloquear o fluxo
          console.warn("[SdrEngine] Aviso: não foi possível salvar mediaInterpretation:", mediaErr?.message);
        }
      }
      // ── Fim memória visual ──────────────────────────────────────────────────────────

      if (signal?.aborted) return false;

      // ── GATILHOS DE LIGAÇÃO ATIVA EM TEMPO REAL ──────────────────────────────
      // Todos os gatilhos geram um áudio dinâmico de aviso via ElevenLabs e disparam a chamada em 5s.
      // Apenas para tenant "valem" — tecfag permanece inativo.
      const meta = (flowState?.metadata as Record<string, any>) || {};
      const clientFullText = batchItems.map((i) => i.text).join(" ").toLowerCase().trim();

      // Gatilho 1: Cliente frustrado / sentimento negativo severo
      const isFrustrated = (
        aiResult as any
      ).sentiment === "negative" ||
        /não\s*(tô|to|tou|estou|vou|consigo|aguento)\s*(mais|esperando|conseguindo)|que\s*(saco|raiva|absurdo)|péssimo\s*atendimento|muito\s*(demorado|ruim|lento)|isso\s*é\s*(um\s*absurdo|ridículo|horrível)|não\s*me\s*(responderam|atenderam)/i.test(clientFullText);

      // Gatilho 2: Pedido explícito de ligação pelo cliente
      const wantsCall = /\b(me\s*liga|pode\s*me\s*ligar|quero\s*(falar|conversar)\s*(por\s*telefone|ao\s*telefone|ligação)|prefiro\s*(por\s*telefone|falar|ligar)|me\s*chama|me\s*contacta?\s*por\s*telefone|fala\s*comigo\s*por\s*telefone|liga\s*(pra\s*mim|para\s*mim))\b/i.test(clientFullText);

      // Gatilho 3: Lead VIP / Alto volume (>= 50.000 unidades) — aciona se cliente aceitar proposta de ligação
      const quantityVal = updatedCollectedData["QUANTIDADE DE UNIDADES"]?.value || updatedCollectedData["QUANTIDADE"]?.value || "";
      const numericQuantity = parseInt(String(quantityVal).replace(/\D/g, ""), 10);
      const isVip = !isNaN(numericQuantity) && numericQuantity >= 50000;

      if (!meta.callTriggered && (isFrustrated || wantsCall || isVip) && !signal?.aborted) {
        let callReason = "";
        let announceText = "";

        if (isFrustrated) {
          callReason = "frustração_detectada";
          const clientName = updatedCollectedData["NOME COMPLETO"]?.value || "cliente";
          announceText = `Ei, ${clientName}! Entendo perfeitamente a situação. Para resolver isso com prioridade máxima, estou te ligando agora mesmo! Um segundo.`;
        } else if (wantsCall) {
          callReason = "pedido_explicito";
          const clientName = updatedCollectedData["NOME COMPLETO"]?.value || "cliente";
          announceText = `Com certeza, ${clientName}! Estou te ligando agora no número do WhatsApp. Um segundo.`;
        } else if (isVip) {
          callReason = "lead_vip_alto_volume";
          const clientName = updatedCollectedData["NOME COMPLETO"]?.value || "cliente";
          announceText = `${clientName}, para um pedido desse volume eu prefiro conversar diretamente com você! Vou te ligar agora.`;
        }

        console.log(`[SdrEngine] 📞 Gatilho de ligação ativado (${callReason}). Enviando aviso por áudio e disparando chamada em 5s...`);

        // Marcar que a ligação foi disparada para não repetir
        if (flowState) {
          const newMeta = { ...meta, callTriggered: true, callReason };
          await db.update(agentFlowStates).set({ metadata: newMeta }).where(eq(agentFlowStates.id, flowState.id));
        }

        // 1. Enviar aviso de áudio dinâmico (ElevenLabs) anunciando a ligação
        void this.sendDynamicPttAudio(tenantId, conversationId, contactPhone, announceText, signal);

        // 2. Aguardar 5s e disparar chamada (fire & forget para não bloquear o retorno do processamento)
        void (async () => {
          await new Promise((r) => setTimeout(r, 5000));
          if (signal?.aborted) return;
          try {
            const callRes = await triggerOutboundCallInternal({
              phone: contactPhone,
              accountSid: configData.twilioAccountSid || configData.twilioSid,
              authToken: configData.twilioAuthToken || configData.twilioToken,
            });
            console.log(`[SdrEngine] 🚀 Chamada ativa disparada (${callReason})! Sucesso: ${callRes.success} | CallSid: ${callRes.callSid || "N/A"}`);
          } catch (callErr: any) {
            console.error(`[SdrEngine] ❌ Erro ao disparar chamada ativa:`, callErr?.message || callErr);
          }
        })();

        return true;
      }
      // ── FIM GATILHOS DE LIGAÇÃO ───────────────────────────────────────────────

      // 11. Envio de Mensagens de Texto / Áudio Dinâmico ElevenLabs
      const dynamicAudio = aiResult.audioMessage && aiResult.audioMessage.text?.trim() ? aiResult.audioMessage : null;

      if (dynamicAudio && dynamicAudio.position === "before_text" && !signal?.aborted) {
        await this.sendDynamicPttAudio(
          tenantId,
          conversationId,
          contactPhone,
          dynamicAudio.text,
          signal
        );
      }

      if ((!dynamicAudio || dynamicAudio.position !== "only_audio") && aiResult.messagesToSend.length > 0 && !signal?.aborted) {
        await this.sendHumanizedBotMessages(
          tenantId,
          conversationId,
          contactPhone,
          aiResult.messagesToSend,
          signal,
          targetQuoteItem,
          aiResult.quoteMessageId
        );
      }

      if (dynamicAudio && (!dynamicAudio.position || dynamicAudio.position === "after_text") && !signal?.aborted) {
        await this.sendDynamicPttAudio(
          tenantId,
          conversationId,
          contactPhone,
          dynamicAudio.text,
          signal
        );
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
   * Sintetiza dinamicamente um áudio com a voz da Valentina via ElevenLabs (formato nativo Opus/OGG)
   * e envia como PTT (Push-To-Talk / Mensagem de Voz) com simulação de "gravando áudio..." e registro no banco.
   * A transcrição exata é persistida em `mediaInterpretation` garantindo memória 100% literal nos turnos futuros!
   */
  private async sendDynamicPttAudio(
    tenantId: string,
    conversationId: string,
    phone: string,
    audioText: string,
    signal?: AbortSignal
  ): Promise<void> {
    const cleanText = audioText.trim();
    if (!cleanText) return;

    const sock = SessionManager.getInstance().getSession(tenantId);
    if (!sock) {
      console.error(`[SdrEngine Dynamic PTT] Sessão Baileys não encontrada para tenant ${tenantId}`);
      return;
    }

    const realJid = await resolveRealJid(sock, phone);

    // 1. Mostrar imediatamente a presença 'recording' (gravando áudio...) no WhatsApp
    try {
      await sock.sendPresenceUpdate("recording", realJid);
      console.log(`[SdrEngine Dynamic PTT] 🎙️ Presença 'recording' ativada para ${phone}`);
    } catch { /* silencia */ }

    // 2. Gerar o áudio dinâmico via ElevenLabs (ou recuperar do cache LRU)
    let pttResult: { buffer: Buffer; durationSeconds: number; mimeType: string };
    try {
      pttResult = await generateDynamicPttAudio({
        text: cleanText,
        signal,
      });
    } catch (ttsErr: any) {
      console.error(`[SdrEngine Dynamic PTT] ⚠️ Falha na síntese ElevenLabs (${ttsErr?.message}). Fazendo fallback para texto.`);
      try { await sock.sendPresenceUpdate("paused", realJid); } catch {}
      // Fallback transparente: envia o texto como balão normal sem travar a conversa
      await this.sendHumanizedBotMessages(tenantId, conversationId, phone, [cleanText], signal);
      return;
    }

    const durationMs = Math.max(1500, Math.min(15000, pttResult.durationSeconds * 1000));
    console.log(`[SdrEngine Dynamic PTT] 🎙️ Simulando gravação de ~${(durationMs / 1000).toFixed(1)}s antes do envio...`);

    // 3. Aguardar gravação simulada
    const startTs = Date.now();
    while (Date.now() - startTs < durationMs) {
      if (signal?.aborted) {
        try { await sock.sendPresenceUpdate("paused", realJid); } catch {}
        console.log(`[SdrEngine Dynamic PTT] Envio PTT abortado pelo AbortSignal.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    try { await sock.sendPresenceUpdate("paused", realJid); } catch {}
    if (signal?.aborted) return;

    // 4. Enviar mensagem de áudio PTT pelo WhatsApp via Baileys
    let sentMsg: any;
    try {
      sentMsg = await sock.sendMessage(realJid, {
        audio: pttResult.buffer,
        mimetype: pttResult.mimeType,
        ptt: true,
      });
      console.log(`[SdrEngine Dynamic PTT] ✅ PTT dinâmico enviado com sucesso! MessageId: ${sentMsg?.key?.id}`);
    } catch (sendErr: any) {
      console.error(`[SdrEngine Dynamic PTT] ❌ Erro ao enviar PTT via Baileys:`, sendErr?.message);
      return;
    }

    // 5. Registrar no banco com a transcrição exata em mediaInterpretation (Memória Total)
    const botMessageId = sentMsg?.key?.id || `bot-ptt-${Date.now()}`;
    const displayContent = `🎤 ${cleanText.slice(0, 45)}...`;

    try {
      await db.insert(conversations).values({
        id: conversationId,
        tenantId,
        contactId: `c-${phone}`,
        queueState: "automacao",
        lastMessageText: displayContent,
        lastMessageTime: new Date(),
        createdAt: new Date(),
      }).onConflictDoNothing();

      await db.insert(messages).values({
        id: botMessageId,
        tenantId,
        conversationId,
        senderType: "bot",
        senderName: "Valentina (SDR)",
        content: `[MEDIA:audio]${botMessageId}`,
        mediaInterpretation: cleanText, // 👈 MEMÓRIA EXATA DO QUE A VALENTINA DISSE NO ÁUDIO!
        isInternalNote: false,
        sentAt: new Date(),
      }).onConflictDoNothing();

      await db.update(conversations)
        .set({ lastMessageText: displayContent, lastMessageTime: new Date() })
        .where(eq(conversations.id, conversationId));

      // Persistir buffer de áudio em mediaFiles para tocar na interface web
      try {
        const { mediaFiles } = await import("../../db/schema");
        await db.insert(mediaFiles).values({
          id: botMessageId,
          fileName: "valentina_audio.ogg",
          mimeType: pttResult.mimeType,
          base64Data: pttResult.buffer.toString("base64"),
          createdAt: new Date(),
        }).onConflictDoNothing();
      } catch { /* não crítico */ }

      const currentConv = await db.query.conversations.findFirst({
        where: (t, { eq: dEq }) => dEq(t.id, conversationId),
      });

      SessionManager.getInstance().notifyPublic(tenantId, {
        type: "message",
        message: {
          id: botMessageId,
          conversationId,
          senderType: "bot",
          senderName: "Valentina (SDR)",
          content: `[MEDIA:audio]${botMessageId}`,
          sentAt: new Date(),
          queue: currentConv?.queueState || "automacao",
          operatorId: currentConv?.operatorId || null,
        },
      });
    } catch (dbErr: any) {
      console.error(`[SdrEngine Dynamic PTT] Erro ao salvar PTT no banco:`, dbErr?.message);
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
    quoteItem?: QueuedMessageItem | null,
    targetQuoteMessageId?: string | null
  ): Promise<void> {
    const sock = SessionManager.getInstance().getSession(tenantId);
    if (!sock) {
      console.error(`[SdrEngine] Sessão Baileys não encontrada para tenant ${tenantId}`);
      return;
    }

    const realJid = await resolveRealJid(sock, phone);

    // Resolver a mensagem a ser citada no WhatsApp (Quoted Reply)
    let finalQuoteObj: any = null;

    if (targetQuoteMessageId) {
      try {
        const [dbMsg] = await db
          .select()
          .from(messages)
          .where(eq(messages.id, targetQuoteMessageId));

        if (dbMsg) {
          finalQuoteObj = {
            key: {
              remoteJid: realJid,
              fromMe: dbMsg.senderType === "bot",
              id: dbMsg.id,
            },
            message: {
              conversation: dbMsg.content,
            },
          };
          console.log(`[SdrEngine] 💬 Citação configurada para a mensagem ${dbMsg.id} (${dbMsg.senderType === "bot" ? "Valentina" : "Cliente"}): "${dbMsg.content.slice(0, 35)}..."`);
        }
      } catch (err: any) {
        console.warn("[SdrEngine] Falha ao buscar mensagem citada no banco:", err?.message);
      }
    }

    if (!finalQuoteObj && quoteItem && quoteItem.rawMsg) {
      finalQuoteObj = quoteItem.rawMsg;
    }

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

      // 3. Determinar se este balão deve conter a CITAÇÃO (Quoted Reply):
      // - Se o balão contiver a frase "só me responde", aplica NELA!
      // - Senão, se não houver re-quote em nenhum outro balão, aplica no 1º balão.
      const isRequoteFragment = /só me responde/i.test(fragmentText) || /me responde isso/i.test(fragmentText);
      const hasRequoteInArray = messagesArray.some((m) => /só me responde/i.test(m) || /me responde isso/i.test(m));

      const shouldQuoteThisFragment = isRequoteFragment
        ? Boolean(finalQuoteObj)
        : (i === 0 && Boolean(finalQuoteObj) && !hasRequoteInArray);

      const sendOptions: any = {};
      if (shouldQuoteThisFragment && finalQuoteObj) {
        sendOptions.quoted = finalQuoteObj;
        console.log(`[SdrEngine] 💬 Aplicando CITAÇÃO NATIVA do WhatsApp no balão ${i + 1}: "${fragmentText.slice(0, 35)}..."`);
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

      // Buscar dados atualizados da conversa e do contato para enviar no SSE
      const currentConv = await db.query.conversations.findFirst({
        where: (t, { eq: dEq }) => dEq(t.id, conversationId),
      });

      let currentWalletOpId: string | null = null;
      let currentRdCrmDealId: string | null = null;
      let currentRdCrmDealLink: string | null = null;

      if (currentConv?.contactId) {
        const [cnt] = await db.select().from(contacts).where(eq(contacts.id, currentConv.contactId));
        if (cnt) {
          currentWalletOpId = cnt.walletOperatorId || null;
          currentRdCrmDealId = cnt.rdCrmDealId || null;
          currentRdCrmDealLink = cnt.rdCrmDealLink || null;
        }
      }

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
          queue: currentConv?.queueState || "automacao",
          operatorId: currentConv?.operatorId || null,
          walletOperatorId: currentWalletOpId,
          rdCrmDealId: currentRdCrmDealId,
          rdCrmDealLink: currentRdCrmDealLink,
        },
      });
    }
  }
}
