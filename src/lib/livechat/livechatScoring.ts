// ══════════════════════════════════════════════════════════════════════════════
// 📊 LIVECHAT SCORING — Classificação de intenção e temperatura
// Score 0-100 baseado em comportamento do visitante no site.
// Sem ML externo — regras de negócio determinísticas.
// ══════════════════════════════════════════════════════════════════════════════

export interface ScoringContext {
  pageviewCount: number;       // nº de páginas visitadas
  timeOnSiteSec: number;       // tempo total no site em segundos
  scrollDepthMax: number;      // scroll máximo (0-100%)
  hasProductPage: boolean;     // visitou página de produto?
  hasCartPage: boolean;        // visitou carrinho?
  msgCount: number;            // nº de mensagens enviadas no chat
  hasName: boolean;            // forneceu nome?
  hasCnpj: boolean;            // forneceu CNPJ?
  hasPhone: boolean;           // forneceu telefone?
  hasQuantity: boolean;        // mencionou quantidade?
  quantity?: number;           // quantidade em unidades (se informada)
}

/**
 * Calcula o score de intenção (0-100) baseado no comportamento do visitante.
 *
 * Pontuação:
 * - Comportamento de navegação:     até 25 pts
 * - Engajamento no chat:            até 25 pts
 * - Dados coletados:                até 30 pts
 * - Sinais de compra:               até 20 pts
 */
export function calculateIntentScore(ctx: ScoringContext): number {
  let score = 0;

  // ── Navegação (0–25 pts) ───────────────────────────────────────────────────
  score += Math.min(ctx.pageviewCount * 3, 12);   // até 12 pts (máx em 4 páginas)
  score += Math.min(Math.floor(ctx.timeOnSiteSec / 30), 8); // até 8 pts (1pt/30s)
  if (ctx.scrollDepthMax >= 70) score += 5;       // scroll profundo = interesse real

  // ── Engajamento no chat (0–25 pts) ────────────────────────────────────────
  score += Math.min(ctx.msgCount * 5, 20);        // até 20 pts (máx em 4 msgs)
  if (ctx.hasProductPage) score += 5;

  // ── Dados fornecidos (0–30 pts) ───────────────────────────────────────────
  if (ctx.hasName)     score += 5;
  if (ctx.hasCnpj)     score += 10; // CNPJ = sinal forte de B2B atacado
  if (ctx.hasPhone)    score += 8;
  if (ctx.hasQuantity) score += 7;

  // ── Sinais de compra (0–20 pts) ───────────────────────────────────────────
  if (ctx.hasCartPage) score += 15;               // no carrinho = intenção alta
  if (ctx.quantity && ctx.quantity >= 1000) score += 5; // atacado

  return Math.min(Math.round(score), 100);
}

/**
 * Determina temperatura baseada no score.
 */
export function scoreToTemperature(score: number): "frio" | "morno" | "quente" {
  if (score >= 70) return "quente";
  if (score >= 35) return "morno";
  return "frio";
}

/**
 * Verifica se o visitante atende critério de atacado qualificado para bridge WhatsApp:
 * CNPJ válido + quantidade >= 1.000 unidades
 */
export function isAtacadoQualificado(
  hasCnpj: boolean,
  quantity?: number,
  score = 0,
  attackThreshold = 70
): boolean {
  return hasCnpj && (quantity ?? 0) >= 1000 && score >= attackThreshold;
}