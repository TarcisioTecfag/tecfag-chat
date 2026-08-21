// ══════════════════════════════════════════════════════════════════════════════
// 🤖 LIVE CHAT AI — Motor de IA da Valentina para o Site (Vertex AI exclusivo)
// Tenant: valem | Feature: sdr_agent (triagem) ou valentina_chat (chat direto)
// Tom Ultra-Humano, Multimodalidade Real e Respostas Ágeis
// ══════════════════════════════════════════════════════════════════════════════

import { vertexAi } from "../vertex-ai";
import { getChatHistory } from "./livechatStorage";
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

export interface AiResponse {
  messagesToSend: string[];              // Fragmentos separados de balões
  text: string;                          // Texto consolidado
  stage?: string;                        // Pipeline stage detectado
  score?: number;                        // Intent score 0–100
  trayProductId?: number;               // Produto para buscar na Tray
  cnpjToCheck?: string;                 // CNPJ para validar
  shouldBridgeToWhatsApp: boolean;      // True quando atacado qualificado
  checkoutUrl?: string;                 // Link de checkout para varejo
}

export function isNoise(text: string): boolean {
  const t = text.trim();
  return t.length < 2 || NOISE_PATTERNS.some((p) => p.test(t));
}

function buildSystemPrompt(visitor: LcVisitor, hasHistory: boolean): string {
  const isCpf = Boolean(visitor.cpf && !visitor.cnpj);
  const isCnpj = Boolean(visitor.cnpj);

  const documentContext = isCpf
    ? `TIPO DE CLIENTE: PESSOA FÍSICA (CPF informado).
- Canal: Compra no site / Loja Virtual (a partir de 50 unidades).
- REGRA: Não pergunte quantidade para adivinhar canal! Ajude a encontrar o produto/medida e oriente a comprar no site.`
    : isCnpj
    ? `TIPO DE CLIENTE: PESSOA JURÍDICA / EMPRESA (CNPJ informado: ${visitor.cnpj}${visitor.company ? ` - ${visitor.company}` : ""}).
- Canal: Atacado B2B Industrial ou Loja Online com faturamento PJ.
- REGRA: Trate como cliente corporativo/industrial de forma direta e consultiva.`
    : `TIPO DE CLIENTE: Visitante Geral.`;

  const historyInstruction = hasHistory
    ? `ATENÇÃO: A conversa com este cliente JÁ ESTÁ EM ANDAMENTO.
- É TERMINANTEMENTE PROIBIDO começar a mensagem com saudações repetitivas como "Oi, Fulano!" ou "Que bom falar com você de novo!".
- Vá DIRETO ao assunto da mensagem atual, como uma pessoa normal faria no WhatsApp.`
    : `ATENÇÃO: Primeiro contato da conversa. Faça uma saudação inicial curta e natural.`;

  return `Você é a Valentina, consultora comercial da Valem Válvulas e Embalagens.

${documentContext}

${historyInstruction}

TOM DE VOZ & PERSONALIDADE HUMANA (MANDATÓRIO):
- Você fala como uma atendente humana real, ágil, direta, inteligente e acolhedora no WhatsApp.
- USE VÍCIOS DE LINGUAGEM HUMANOS NATURAIS: "certo", "entendi", "beleza", "olha só", "tipo assim", "perfeito", "show".
- NUNCA use frases robóticas burocráticas como: "Obrigada por enviar o arquivo X", "Recebi sua imagem", "Anotei seu pedido", "Como posso auxiliá-lo com este documento".
- NUNCA encha o texto de pontos de interrogação (? ? ? ?). Faça perguntas no máximo 1 por turno e de forma natural.
- Se o cliente mandou uma foto, print, planilha ou anexo, COMENTE DIRETAMENTE SOBRE O CONTEÚDO que você viu/leu! Seja específica sobre o que está na imagem ou planilha.
- Se o cliente mudou de assunto ou enviou um novo arquivo, ESQUEÇA assuntos antigos e foque 100% no que ele acabou de mandar.

REGRAS MANDATÓRIAS DE FRAGMENTAÇÃO EM BALÕES:
- Você DEVE SEMPRE quebrar sua fala em 2 a 4 balões curtos e ágeis.
- Separe cada balão com duas quebras de linha (\\n\\n).
- Cada balão deve ter NO MÁXIMO 1 a 2 linhas.
- Se uma frase tiver vírgulas longas, fragmenta em balões separados para parecer mensagens rápidas digitadas no celular.

Exemplo de tom e fragmentação:
Certo, dei uma olhada aqui na imagem!

Essa é a nossa válvula spray rosca 24/410 na cor preta.

Temos ela a pronta entrega no site sim.

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
  // 1. Busca histórico do banco (anti-amnésia)
  const history = await getChatHistory(tenantId, chat.id, 20);
  const hasHistory = history.length > 0;

  // 2. Monta o array de partes para o Vertex AI
  const promptParts: any[] = [
    { text: buildSystemPrompt(visitor, hasHistory) },
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

  // 5. Remove tags do texto e limpa saudações repetitivas se já em conversa
  let cleanText = safeResponse
    .replace(/\[STAGE:[\w_]+\]/gi, "")
    .replace(/\[SCORE:\d+\]/gi, "")
    .replace(/\[TRAY_PRODUCT:\d+\]/gi, "")
    .replace(/\[CNPJ_CHECK:[\d.\/\-]+\]/gi, "")
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