
import { db } from "../../db";
import { agentConfigs, agentFlowStates, conversations, messages, internalMessages } from "../../db/schema";
import { eq, asc } from "drizzle-orm";
import { vertexAi, MultimodalPart } from "../vertex-ai";
import { SessionManager, resolveRealJid } from "../baileys/session-manager";
import { QueuedMessageItem } from "./sdr-debouncer";
import { extractCnpjFromText, fetchCnpjInfo } from "./cnpj-service";
import { getKnowledgeBaseContext } from "./knowledge-service";
import { autoCreateOrUpdateRdCrmDeal } from "./sdr-crm-auto";

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
      let greeting = "Boa tarde!";
      if (hour >= 5 && hour < 12) greeting = "Bom dia!";
      if (hour >= 18 || hour < 5) greeting = "Boa noite!";

      const isFirstMessage = historyMsgs.length === 0;

      const firstMessageRule = isFirstMessage
        ? `🟢 ATENÇÃO CRÍTICA (ESTA É A PRIMEIRA MENSAGEM DO ATENDIMENTO!):
   - VOCÊ É OBRIGADA A SE IDENTIFICAR COMO "VALENTINA, AQUI DA VALEM" NESSA PRIMEIRA INTERAÇÃO!
   - NUNCA use termos corporativos ou formais como "sou consultora comercial", "equipe comercial de pré-vendas", "tudo joia por aí?". Fale simples, leve e 100% humana!
   - ESTRUTURA OBRIGATÓRIA DA PRIMEIRA ABORDAGEM HUMANIZADA (SEMPRE FRAGMENTADA EM BALÕES CURTOS E LEVES NO ARRAY \`messagesToSend\`):
     * Balão 1: Saudação simples (ex: "${greeting}" ou "${greeting} Tudo bem?")
     * Balão 2: Apresentação direta e humana: "Meu nome é Valentina, aqui da Valem" (ou "Me chamo Valentina, aqui da Valem")
     * Balão 3: Pergunta aberta e amigável: "Como posso te ajudar hoje?"`
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
            const conv = await db.query.conversations.findFirst({
              where: (t, { eq: dEq }) => dEq(t.id, conversationId)
            });
            if (conv?.contactId) {
              await db.update(contacts)
                .set({ cnpjDetails: cnpjInfo.details, cnpj: cnpjInfo.cnpjFormatted })
                .where(eq(contacts.id, conv.contactId));
              console.log(`[SdrEngine] 🏛️ Ficha Cadastral da Receita Federal salva com sucesso no Contato ${conv.contactId}!`);
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
   - PROIBIÇÃO DO VÍCIO "OPA": NUNCA repita o vício de linguagem "Opa" ou "Opa," no início das frases! Fica robótico e esquisito. Varie com inícios naturais como: "Ah, perfeito!", "Certo,", "Claro!", "Entendi,", "Legal!", "Com certeza,", "Ah, bom!".

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

6. FLUXO DE CNPJ E EMPRESA E PROIBIÇÃO ABSOLUTA DA MENÇÃO À RECEITA FEDERAL:
   - 🛑 É PROIBIDO NAVEGAR OU CITAR OS TERMOS: "Receita Federal", "sistema da Receita", "cnpj.ws", "banco de dados", "consulta do sistema"! NUNCA use essas justificativas.
   - NUNCA pergunte "Qual o nome da sua empresa?". Pergunte APENAS o CNPJ (ou CPF).
   - Quando o cliente enviar o CNPJ, sua única pergunta de confirmação deve ser: "Sua empresa é a [Nome da Empresa], certo?".
   - Se o cliente responder que o nome não é esse ou corrigir, aceite o nome digitado pelo cliente IMEDIATAMENTE com muita elegância humana: "Ah, me desculpe pelo equívoco! Qual é o nome correto da sua empresa para eu registrar aqui?".
   - Se o CNPJ for inválido ou tiver erro nos dígitos, diga educadamente: "Ops, parece que esse CNPJ tem algum dígito incorreto ou faltando. Consegue me enviar novamente por favor?". NUNCA invente nome de empresa nem preencha CNPJ inválido.

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
              greeting,
              `Meu nome é Valentina, aqui da Valem`,
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
        for (const [k, v] of Object.entries(aiResult.extractedData)) {
          if (v && v.trim() !== "" && !v.toLowerCase().includes("mantem")) {
            updatedCollectedData[k] = { value: v.trim(), status: "filled" };
          }
        }
      }

      const filledCount = Object.values(updatedCollectedData).filter((d) => d.status === "filled").length;

      // TRAVA ESTRITA DE CONCLUSÃO: A triagem SÓ pode ser concluída se TODOS os 4 dados vitais forem realmente informados:
      const nameVal = updatedCollectedData["NOME COMPLETO"]?.value || "";
      const companyVal = updatedCollectedData["EMPRESA"]?.value || "";
      const cnpjVal = updatedCollectedData["CNPJ OU CPF"]?.value || "";
      const productVal = updatedCollectedData["QUAL O TIPO DE PRODUTO?"]?.value || "";

      const hasName = Boolean(nameVal && nameVal.trim() !== "" && !nameVal.includes("Aguardando"));
      const hasCompany = Boolean(companyVal && companyVal.trim() !== "" && !companyVal.includes("Aguardando"));
      const hasCnpj = Boolean(cnpjVal && cnpjVal.trim() !== "" && !cnpjVal.includes("Aguardando") && !cnpjVal.includes("Invalido"));
      const hasProduct = Boolean(productVal && productVal.trim() !== "" && !productVal.includes("Aguardando"));

      const isTriageFullyReady = hasName && hasCompany && hasCnpj && hasProduct;

      // NUNCA conclui prematuramente se faltar qualquer um dos 4 campos vitais!
      const isCompleted = isTriageFullyReady && (aiResult.isCompleted || filledCount >= 6);
      const wasAlreadyCompleted = flowState?.outcome === "completed" || flowState?.outcome === "transferred";
      const now = new Date();

      if (flowState) {
        await db
          .update(agentFlowStates)
          .set({
            currentStep: isCompleted ? "Concluído" : "Em Qualificação",
            collectedData: updatedCollectedData,
            metadata: { stepNumber: filledCount, totalSteps: 7 },
            lastInteractionAt: now,
            completedAt: isCompleted ? (flowState.completedAt || now) : null,
            outcome: isCompleted ? (wasAlreadyCompleted ? flowState.outcome : "completed") : "in_progress",
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

      // 10. Alocar responsável no Rodízio APENAS se for a PRIMEIRA vez que é concluído
      if (isCompleted && !wasAlreadyCompleted && !signal?.aborted) {
        try {
          const clientName = updatedCollectedData["NOME COMPLETO"]?.value || "Cliente WhatsApp";
          const company = updatedCollectedData["EMPRESA"]?.value || "Empresa não informada";

          // Alocação real do próximo vendedor disponível no rodízio
          const { RodizioEngine } = await import("./rodizio-engine");
          const allocatedOp = await RodizioEngine.allocateNextOperator(tenantId, conversationId, clientName);

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

            await db.update(agentFlowStates).set({ outcome: "transferred" }).where(eq(agentFlowStates.id, flowState!.id));
          }

          // Automação: Cria e vincula o Card no RD Station CRM com os dados coletados na triagem da Valentina
          try {
            await autoCreateOrUpdateRdCrmDeal({
              tenantId,
              conversationId,
              contactPhone,
              collectedData: updatedCollectedData,
            });
          } catch (crmErr: any) {
            console.error("[SdrEngine] Erro na automação de criação/atualização de card no RD CRM:", crmErr?.message);
          }
        } catch (err: any) {
          console.error("[SdrEngine] Erro ao alocar responsável no rodízio:", err?.message);
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
