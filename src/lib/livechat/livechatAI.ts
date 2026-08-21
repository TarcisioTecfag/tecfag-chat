// ══════════════════════════════════════════════════════════════════════════════
// 🤖 LIVE CHAT AI — Motor de IA da Valentina para o Site (Vertex AI exclusivo)
// Tenant: valem | Feature: sdr_agent (triagem) ou valentina_chat (chat direto)
// Histórico: lido do banco antes de cada chamada (anti-amnésia pós-restart)
// ══════════════════════════════════════════════════════════════════════════════

import { vertexAi } from "../vertex-ai";
import { getChatHistory, saveMessage } from "./livechatStorage";
import { searchProducts, extractSearchTermFromUrl } from "./trayCatalogService";
import { buildCheckoutUrl, buildCheckoutMessage } from "./trayCheckoutService";
import type { LcVisitor, LcChat, LcMessage, TrayProduct } from "../../db/schema";

// ── Padrões de intenção — Domínio Valem ──────────────────────────────────────

const PRODUTO_PATTERNS = [
  /v[aá]lvula[s]?\s*(spray|pump|gatilho|aerossol|dispens)/i,
  /frasco[s]?\s*(pet|vidro|pl[aá]stico)/i,
  /pote[s]?\s*(pl[aá]stico|vidro|herm[eé]tico)/i,
  /rosca[s]?\s*(\d+\/\d+)/i,
  /seladora[s]?/i,
  /embalag[e][mn]s?/i,
  /\b(\d[\d.]+)\s*(mil|m)?\s*(un|unid|pe[cç]as?)/i,
];

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
  text: string;                          // texto limpo para o visitante
  stage?: string;                        // pipeline stage detectado
  score?: number;                        // intent score 0–100
  trayProductId?: number;               // produto para buscar na Tray
  cnpjToCheck?: string;                 // CNPJ para validar
  shouldBridgeToWhatsApp: boolean;      // true quando atacado qualificado
  checkoutUrl?: string;                 // link de checkout para varejo
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isNoise(text: string): boolean {
  const t = text.trim();
  return t.length < 2 || NOISE_PATTERNS.some((p) => p.test(t));
}

export function detectProductIntent(text: string): boolean {
  return PRODUTO_PATTERNS.some((p) => p.test(text));
}

function buildSystemPrompt(visitor: LcVisitor): string {
  const collectedData = [
    visitor.name ? `Nome: ${visitor.name}` : null,
    visitor.company ? `Empresa: ${visitor.company}` : null,
    visitor.cnpj ? `CNPJ: ${visitor.cnpj}` : null,
    visitor.phone ? `Telefone: ${visitor.phone}` : null,
    visitor.productInterest ? `Produto de interesse: ${visitor.productInterest}` : null,
    visitor.quantityInterest ? `Quantidade: ${visitor.quantityInterest}` : null,
    visitor.currentUrl ? `Página atual: ${visitor.currentUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `Você é a Valentina, consultora comercial da Valem Válvulas e Embalagens.
Seu objetivo é qualificar visitantes do site, identificar se são clientes atacado (CNPJ + pedido ≥ 1.000 unidades) ou varejo, e direcionar adequadamente.

PERSONALIDADE: profissional, calorosa, direta. Use emojis com moderação. Seja concisa.

DADOS JÁ COLETADOS DO VISITANTE:
${collectedData || "Nenhum dado coletado ainda."}

REGRAS:
1. Se o visitante mencionar quantidade ≥ 1.000 unidades E tiver CNPJ → emita [STAGE:atacado_qualificado] ao final da resposta
2. Se o visitante quiser comprar ≤ 999 unidades → emita [STAGE:varejo_checkout]
3. Quando identificar produto específico → emita [TRAY_PRODUCT:ID_DO_PRODUTO] (use 0 se não souber o ID)
4. Atualize o score de intenção 0-100 → emita [SCORE:XX] ao final
5. Se precisar validar CNPJ → emita [CNPJ_CHECK:XX.XXX.XXX/XXXX-XX]
6. NUNCA mencione que é uma IA ou chatbot diretamente a não ser que perguntado
7. NUNCA ofereça cupom de desconto
8. Respostas máximo 3 parágrafos curtos

As tags [STAGE:...] [SCORE:...] [TRAY_PRODUCT:...] [CNPJ_CHECK:...] são INVISÍVEIS ao visitante — você as emite mas elas são removidas antes de exibir.`;
}

// ── Função principal ──────────────────────────────────────────────────────────

export async function processVisitorMessage(
  tenantId: string,
  visitor: LcVisitor,
  chat: LcChat,
  userMessage: string,
  signal?: AbortSignal
): Promise<AiResponse> {
  if (isNoise(userMessage)) {
    return {
      text: "Olá! 😊 Como posso te ajudar hoje?",
      shouldBridgeToWhatsApp: false,
    };
  }

  // 1. Busca histórico do banco (anti-amnésia)
  const history = await getChatHistory(tenantId, chat.id, 30);

  // 2. Monta o array de partes para o Vertex AI
  const conversationParts: Array<{ role: string; parts: Array<{ text: string }> }> = [
    {
      role: "user",
      parts: [{ text: buildSystemPrompt(visitor) }],
    },
  ];

  // Adiciona histórico de mensagens anteriores
  for (const msg of history) {
    if (msg.sender === "visitor") {
      conversationParts.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.sender === "ai") {
      conversationParts.push({ role: "model", parts: [{ text: msg.content }] });
    }
  }

  // Mensagem atual do visitante
  conversationParts.push({ role: "user", parts: [{ text: userMessage }] });

  // 3. Chama Vertex AI
  const rawResponse = await vertexAi.generateText(
    [{ text: JSON.stringify(conversationParts) }],
    "gemini-2.5-flash",
    signal,
    {
      feature: "sdr_agent",
      tenantId,
      metadata: { chatId: chat.id, visitorId: visitor.id },
    }
  );

  // 4. Extrai tags silenciosas
  const stageMatch = rawResponse.match(STAGE_PATTERN);
  const scoreMatch = rawResponse.match(SCORE_PATTERN);
  const productMatch = rawResponse.match(PRODUCT_PATTERN);
  const cnpjMatch = rawResponse.match(CNPJ_PATTERN);

  const stage = stageMatch?.[1];
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : undefined;
  const trayProductId = productMatch ? parseInt(productMatch[1], 10) : undefined;
  const cnpjToCheck = cnpjMatch?.[1];

  // 5. Remove tags do texto antes de enviar ao visitante
  const cleanText = rawResponse
    .replace(/\[STAGE:[\w_]+\]/gi, "")
    .replace(/\[SCORE:\d+\]/gi, "")
    .replace(/\[TRAY_PRODUCT:\d+\]/gi, "")
    .replace(/\[CNPJ_CHECK:[\d.\/\-]+\]/gi, "")
    .trim();

  // 6. Decide se deve fazer bridge para WhatsApp
  const shouldBridgeToWhatsApp = stage === "atacado_qualificado" && !!visitor.phone;

  // 7. Salva resposta da IA no banco
  await saveMessage(tenantId, chat.id, "ai", cleanText);

  return {
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
 * Leva em conta a URL atual para contextualizar a abordagem.
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
    : "O visitante está no site mas não em uma página de produto específica.";

  const prompt = `Você é a Valentina da Valem Válvulas e Embalagens. ${productContext}
Gere uma saudação proativa curta (máximo 2 linhas) para iniciar a conversa, contextualizada com o produto/página se relevante.
Seja natural e convidativa. Não mencione que é uma IA.`;

  try {
    const greeting = await vertexAi.generateText(
      [{ text: prompt }],
      "gemini-2.5-flash",
      signal,
      { feature: "sdr_agent", tenantId }
    );
    return greeting.trim() || "Olá! 😊 Posso te ajudar com informações sobre nossos produtos?";
  } catch {
    return "Olá! 😊 Posso te ajudar com informações sobre nossos produtos?";
  }
}