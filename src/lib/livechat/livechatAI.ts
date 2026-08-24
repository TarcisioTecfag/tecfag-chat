// ══════════════════════════════════════════════════════════════════════════════
// 🤖 LIVE CHAT AI — Motor de IA da Valentina para o Site (Vertex AI exclusivo)
// Tenant: valem | Feature: sdr_agent (triagem) ou valentina_chat (chat direto)
// Tom Ultra-Humano, Multimodalidade Real e Respostas Ágeis
// ══════════════════════════════════════════════════════════════════════════════

import { vertexAi } from "../vertex-ai";
import { getChatHistory } from "./livechatStorage";
import { getKnowledgeBaseContext } from "../valentina/knowledge-service";
import { searchProducts, extractSearchTermFromUrl, type TrayProduct } from "./trayCatalogService";
import { buildCheckoutUrl, buildCheckoutMessage } from "./trayCheckoutService";
import type { LcVisitor, LcChat, LcMessage } from "../../db/schema";

// ── Padrões de ruído ──────────────────────────────────────────────────────────

const NOISE_PATTERNS = [
  /^(oi|ol[aá]|e a[ií]|boa\s*(tarde|noite|dia)|tudo\s*bem|tchou?|tchau|fl[wW])$/i,
  /^ok\.?$/i,
  /^(certo|entendi|perfeito|combinado|legal|obrigado|obg|vlw)$/i,
];

// Tags silenciosas que a Valentina pode emitir na resposta
const STAGE_PATTERN = /\[STAGE:([\w_]+)\]/i;
const SCORE_PATTERN = /\[SCORE:(\d+)\]/i;
const PRODUCT_PATTERN = /\[TRAY_PRODUCT:(\d+)\]/i;
const CNPJ_PATTERN = /\[CNPJ_CHECK:([\d.\-\/]+)\]/i;
const SEND_IMAGE_PATTERN = /\[SEND_IMAGE:([^\]]+)\]/gi;

export interface AiResponse {
  messagesToSend: string[];              // Fragmentos separados de balões
  text: string;                          // Texto consolidado
  stage?: string;                        // Pipeline stage detectado
  score?: number;                        // Intent score 0–100
  trayProductId?: number;               // Produto para buscar na Tray
  cnpjToCheck?: string;                 // CNPJ para validar
  shouldBridgeToWhatsApp: boolean;      // True quando atacado qualificado
  checkoutUrl?: string;                 // Link de checkout para varejo
  sendImageUrls?: string[];             // URLs de imagens a enviar (Formato Real)
}

export function isNoise(text: string): boolean {
  const t = text.trim();
  return t.length < 2 || NOISE_PATTERNS.some((p) => p.test(t));
}

function buildSystemPrompt(visitor: LcVisitor, hasHistory: boolean, knowledgeContext: string): string {
  const isCpf = Boolean(visitor.cpf && !visitor.cnpj);
  const isCnpj = Boolean(visitor.cnpj);

  const documentContext = isCpf
    ? `DOCUMENTO ATIVO DO CLIENTE: PESSOA FÍSICA (CPF).
- Canal: Compra no site / Loja Virtual (a partir de 50 unidades).
- REGRAS:
  1. A Valem Pack vende normalmente para pessoa física (CPF) no site!
  2. NÃO pergunte se o cliente é empresa e NÃO mencione CNPJ.
  3. Ajude a escolher o modelo/medida e indique a compra direta no site com PIX, cartão ou boleto.`
    : isCnpj
    ? `DOCUMENTO ATIVO DO CLIENTE: PESSOA JURÍDICA / EMPRESA (CNPJ: ${visitor.cnpj}${visitor.company ? ` - ${visitor.company}` : ""}).
- Canal: Atacado B2B Industrial / Faturamento PJ.
- REGRAS:
  1. O cliente é 100% EMPRESA/PJ.
  2. NUNCA mencione CPF ou diga "você tinha falado CPF antes". Trate como empresa/comprador industrial desde o início.
  3. Aceitamos PIX, faturamento faturado para PJ e boleto bancário.`
    : `DOCUMENTO ATIVO DO CLIENTE: Visitante Geral.`;

  const historyInstruction = hasHistory
    ? `ATENÇÃO: A conversa com este cliente JÁ ESTÁ EM ANDAMENTO.
- É TERMINANTEMENTE PROIBIDO começar a mensagem com saudações repetitivas como "Oi, Fulano!" ou "Que bom falar com você de novo!".
- Vá DIRETO ao assunto da mensagem atual, como uma pessoa normal faria no WhatsApp.`
    : `ATENÇÃO: Primeiro contato da conversa. Faça uma saudação inicial curta e natural.`;

  return `Você é a Valentina, consultora comercial da Valem Válvulas e Embalagens.

${documentContext}

${historyInstruction}

${knowledgeContext}

REGRAS DE CONDUTA & PROIBIÇÕES ABSOLUTAS:
1. NUNCA mencione "você tinha falado CPF antes" nem questione o documento do cliente. Confie no DOCUMENTO ATIVO DO CLIENTE acima.
2. NUNCA diga que a Valem Pack "só atende empresas". Atendemos tanto CPF (varejo no site) quanto CNPJ (faturamento PJ e atacado).
3. TRATAMENTO DE CORREÇÃO / MUDANÇA DE PRODUTO: Se o cliente disser "não pedi isso", "esquece isso", "que pr é essa" ou enviar a foto de um produto diferente, PEÇA DESCULPA RÁPIDA E ESQUEÇA COMPLETAMENTE o produto anterior! Foque 100% no item atual que o cliente quer.
4. Se o cliente pedir quantidade < 50 unidades de um item no site (ex: 10 unidades do Pote Âmbar 10ml), explique com simpatia que o pedido mínimo no site é 50 unidades por item (ou indique o Mercado Livre para 10 unidades).
5. Se o cliente perguntar "pix?", responda com naturalidade que aceita PIX sim, além de cartão e boleto/faturamento PJ.

TOM DE VOZ & PERSONALIDADE HUMANA (MANDATÓRIO):
- Você fala como uma atendente humana real, ágil, direta, inteligente e acolhedora no WhatsApp.
- USE VÍCIOS DE LINGUAGEM HUMANOS NATURAIS: "certo", "entendi", "beleza", "olha só", "tipo assim", "perfeito", "show".
- NUNCA use frases robóticas burocráticas como: "Obrigada por enviar o arquivo X", "Recebi sua imagem", "Anotei seu pedido", "Como posso auxiliá-lo com este documento".
- NUNCA encha o texto de pontos de interrogação (? ? ? ?). No máximo 1 pergunta natural por turno.
- Se o cliente mandou foto, print ou anexo, comente diretamente sobre o que você viu/leu na imagem.

REGRAS MANDATÓRIAS DE FRAGMENTAÇÃO EM BALÕES:
- Você DEVE SEMPRE quebrar sua fala em 2 a 4 balões curtos e ágeis.
- Separe cada balão com duas quebras de linha (\\n\\n).
- Cada balão deve ter NO MÁXIMO 1 a 2 linhas.

As tags [STAGE:...] [SCORE:...] [TRAY_PRODUCT:...] [CNPJ_CHECK:...] são silenciosas e invisíveis ao visitante.`;
}

// ── Função principal ──────────────────────────────────────────────────────────

export async function processVisitorMessage(
  tenantId: string,
  visitor: LcVisitor,
  chat: LcChat,
  userMessage: string,
  signal?: AbortSignal,
  inlineAttachment?: { mimeType: string; data: string }
): Promise<AiResponse> {
  // 1. Busca histórico do banco e contexto consolidado da Base de Conhecimento RAG
  const [history, knowledgeContext] = await Promise.all([
    getChatHistory(tenantId, chat.id, 20),
    getKnowledgeBaseContext(tenantId),
  ]);
  const hasHistory = history.length > 0;

  // 2. Monta o array de partes para o Vertex AI
  const promptParts: any[] = [
    { text: buildSystemPrompt(visitor, hasHistory, knowledgeContext) },
  ];

  // Adiciona histórico recente
  for (const msg of history.slice(-10)) {
    if (msg.sender === "visitor") {
      promptParts.push({ text: `[Cliente]: ${msg.content}` });
    } else if (msg.sender === "ai") {
      promptParts.push({ text: `[Valentina]: ${msg.content}` });
    }
  }

  // Mensagem e anexo atuais
  if (inlineAttachment) {
    promptParts.push({
      inlineData: {
        mimeType: inlineAttachment.mimeType,
        data: inlineAttachment.data,
      },
    });
  }

  promptParts.push({
    text: `[Mensagem atual do cliente]: ${userMessage}\n(Responda como Valentina de forma humana, ágil e fragmentada em balões curtos):`,
  });

  // 3. Chama Vertex AI Gemini Flash com suporte Multimodal
  const rawResponse = await vertexAi.generateText(
    promptParts,
    "gemini-2.5-flash",
    signal,
    {
      feature: "sdr_agent",
      tenantId,
      metadata: { chatId: chat.id, visitorId: visitor.id },
    }
  );

  // 4. Extrai tags silenciosas
  const safeResponse = rawResponse || "";
  const stageMatch = safeResponse.match(STAGE_PATTERN);
  const scoreMatch = safeResponse.match(SCORE_PATTERN);
  const productMatch = safeResponse.match(PRODUCT_PATTERN);
  const cnpjMatch = safeResponse.match(CNPJ_PATTERN);

  const stage = stageMatch?.[1];
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : undefined;
  const trayProductId = productMatch ? parseInt(productMatch[1], 10) : undefined;
  const cnpjToCheck = cnpjMatch?.[1];

  // Extrai URLs de imagens reais (SEND_IMAGE)
  const sendImageUrls: string[] = [];
  const imageTagRegex = /\[SEND_IMAGE:([^\]]+)\]/gi;
  let imageMatch: RegExpExecArray | null;
  while ((imageMatch = imageTagRegex.exec(safeResponse)) !== null) {
    sendImageUrls.push(imageMatch[1].trim());
  }

  // 5. Remove tags do texto e limpa saudações repetitivas se já em conversa
  let cleanText = safeResponse
    .replace(/\[STAGE:[\w_]+\]/gi, "")
    .replace(/\[SCORE:\d+\]/gi, "")
    .replace(/\[TRAY_PRODUCT:\d+\]/gi, "")
    .replace(/\[CNPJ_CHECK:[\d.\/\-]+\]/gi, "")
    .replace(/\[SEND_IMAGE:[^\]]+\]/gi, "")
    .trim();

  // 6. Fragmentar em balões individuais por quebras de linha ou pontuação
  const rawFragments = cleanText
    .split(/\n\s*\n/)
    .map(f => f.trim())
    .filter(Boolean);

  const messagesToSend: string[] = [];
  for (const frag of rawFragments) {
    if (frag.length > 120 && frag.includes(". ")) {
      const subParts = frag.split(/(?<=[.!?])\s+/);
      for (const sp of subParts) {
        if (sp.trim()) messagesToSend.push(sp.trim());
      }
    } else {
      messagesToSend.push(frag);
    }
  }

  const finalMessages = messagesToSend.length > 0 ? messagesToSend : [cleanText];

  // 7. Decide se deve fazer bridge para WhatsApp
  const shouldBridgeToWhatsApp = stage === "atacado_qualificado" && !!visitor.phone;

  return {
    messagesToSend: finalMessages,
    text: cleanText,
    stage,
    score,
    trayProductId,
    cnpjToCheck,
    shouldBridgeToWhatsApp,
    sendImageUrls: sendImageUrls.length > 0 ? sendImageUrls : undefined,
  };
}


/**
 * Gera mensagem proativa de abertura quando o visitante abre o widget.
 */
export async function generateProactiveGreeting(
  tenantId: string,
  currentUrl: string,
  currentTitle: string,
  signal?: AbortSignal
): Promise<string> {
  const searchTerm = extractSearchTermFromUrl(currentUrl);
  const productContext = searchTerm
    ? `O visitante está na página: "${currentTitle || searchTerm}"`
    : "O visitante está navegando na página inicial do site.";

  const prompt = `Você é a Valentina da Valem Válvulas e Embalagens. ${productContext}
Gere uma saudação proativa muito curta (1 ou 2 linhas), simpática, natural e humana no estilo WhatsApp.
Não pareça um robô.`;

  try {
    const greeting = await vertexAi.generateText(
      [{ text: prompt }],
      "gemini-2.5-flash",
      signal,
      { feature: "sdr_agent", tenantId }
    );
    return (greeting || "").trim() || "Oi! Posso te ajudar a encontrar o modelo ideal de válvula ou frasco hoje?";
  } catch {
    return "Oi! Posso te ajudar a encontrar o modelo ideal de válvula ou frasco hoje?";
  }
}