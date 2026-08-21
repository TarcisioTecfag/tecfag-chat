// ══════════════════════════════════════════════════════════════════════════════
// 🤖 LIVE CHAT AI — Motor de IA da Valentina para o Site (Vertex AI exclusivo)
// Tenant: valem | Feature: sdr_agent (triagem) ou valentina_chat (chat direto)
// Fragmentação em múltiplos balões + Histórico lido do banco (anti-amnésia)
// ══════════════════════════════════════════════════════════════════════════════

import { vertexAi } from "../vertex-ai";
import { getChatHistory } from "./livechatStorage";
import { searchProducts, extractSearchTermFromUrl, type TrayProduct } from "./trayCatalogService";
import { buildCheckoutUrl, buildCheckoutMessage } from "./trayCheckoutService";
import type { LcVisitor, LcChat, LcMessage } from "../../db/schema";

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
  messagesToSend: string[];              // Fragmentos separados de balões
  text: string;                          // Texto consolidado
  stage?: string;                        // Pipeline stage detectado
  score?: number;                        // Intent score 0–100
  trayProductId?: number;               // Produto para buscar na Tray
  cnpjToCheck?: string;                 // CNPJ para validar
  shouldBridgeToWhatsApp: boolean;      // True quando atacado qualificado
  checkoutUrl?: string;                 // Link de checkout para varejo
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
    visitor.name ? `Nome do visitante: ${visitor.name}` : null,
    visitor.company ? `Empresa: ${visitor.company}` : null,
    visitor.cnpj ? `CNPJ: ${visitor.cnpj}` : null,
    visitor.cpf ? `CPF: ${visitor.cpf}` : null,
    visitor.phone ? `Telefone: ${visitor.phone}` : null,
    visitor.productInterest ? `Produto de interesse: ${visitor.productInterest}` : null,
    visitor.quantityInterest ? `Quantidade: ${visitor.quantityInterest}` : null,
    visitor.currentUrl ? `Página atual: ${visitor.currentUrl}` : null,
    visitor.currentTitle ? `Título da página: ${visitor.currentTitle}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `Você é a Valentina, consultora comercial da Valem Válvulas e Embalagens.
Seu objetivo é qualificar visitantes do site, entender o que precisam e direcionar com excelência:
- Atacado B2B: CNPJ + pedido ≥ 1.000 unidades
- Varejo Site: CPF ou pedido < 1.000 unidades (a partir de 50 un na loja online)

PERSONALIDADE: profissional, calorosa, consultiva, humana e direta.
NÃO use emojis em excesso. NUNCA soe robótica ou confirme recebimento de dados com frases como "anotei seu pedido". Use o dado informado naturalmente na conversa.

DADOS JÁ CONHECIDOS DO VISITANTE:
${collectedData || "Nenhum dado coletado ainda."}

REGRAS DE FORMATAÇÃO E FRAGMENTAÇÃO (MANDATÓRIO):
1. FRAGMENTAÇÃO EM BALÕES: Você DEVE SEMPRE dividir sua fala em 2 a 3 balões curtos e objetivos.
   Separe cada balão com duas quebras de linha (\\n\\n).
   Cada balão deve ter NO MÁXIMO 2 linhas de texto. NUNCA mande um parágrafo longo único!
   Exemplo de resposta fragmentada:
   Oi, Tarcísio! Tudo bem por aqui.

   Essa válvula spray 24/410 nós temos a pronta entrega sim!

   Qual a quantidade aproximada que você tem em mente para o seu lote?

2. REGRAS DE QUALIFICAÇÃO:
   - Se o visitante mencionar quantidade ≥ 1.000 unidades E tiver CNPJ → emita [STAGE:atacado_qualificado]
   - Se o visitante for comprar < 1.000 unidades ou for pessoa física (CPF) → emita [STAGE:varejo_checkout]
   - Se identificar um produto específico do catálogo → emita [TRAY_PRODUCT:ID_DO_PRODUTO] (ou 0 se não souber)
   - Avalie o interesse de 0 a 100 → [SCORE:XX]
   - Se o cliente informar um novo CNPJ → [CNPJ_CHECK:XX.XXX.XXX/XXXX-XX]

3. NUNCA diga que é uma IA ou chatbot a não ser que perguntado diretamente.
4. NUNCA ofereça cupom de desconto.

As tags [STAGE:...] [SCORE:...] [TRAY_PRODUCT:...] [CNPJ_CHECK:...] são invisíveis e serão removidas antes de exibir.`;
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
      messagesToSend: ["Olá! Como posso te ajudar hoje?"],
      text: "Olá! Como posso te ajudar hoje?",
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
  const safeResponse = rawResponse || "";
  const stageMatch = safeResponse.match(STAGE_PATTERN);
  const scoreMatch = safeResponse.match(SCORE_PATTERN);
  const productMatch = safeResponse.match(PRODUCT_PATTERN);
  const cnpjMatch = safeResponse.match(CNPJ_PATTERN);

  const stage = stageMatch?.[1];
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : undefined;
  const trayProductId = productMatch ? parseInt(productMatch[1], 10) : undefined;
  const cnpjToCheck = cnpjMatch?.[1];

  // 5. Remove tags do texto
  const cleanText = safeResponse
    .replace(/\[STAGE:[\w_]+\]/gi, "")
    .replace(/\[SCORE:\d+\]/gi, "")
    .replace(/\[TRAY_PRODUCT:\d+\]/gi, "")
    .replace(/\[CNPJ_CHECK:[\d.\/\-]+\]/gi, "")
    .trim();

  // 6. Fragmentar em balões individuais
  const rawFragments = cleanText
    .split(/\n\s*\n/)
    .map(f => f.trim())
    .filter(Boolean);

  const messagesToSend = rawFragments.length > 0 ? rawFragments : [cleanText];

  // 7. Decide se deve fazer bridge para WhatsApp
  const shouldBridgeToWhatsApp = stage === "atacado_qualificado" && !!visitor.phone;

  return {
    messagesToSend,
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
    return (greeting || "").trim() || "Olá! Posso te ajudar com informações sobre nossos produtos?";
  } catch {
    return "Olá! Posso te ajudar com informações sobre nossos produtos?";
  }
}