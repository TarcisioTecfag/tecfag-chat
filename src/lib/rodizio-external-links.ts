import { buildAppRoutePath } from "@/lib/app-routes";
import type { CrmDeal, OperatorCard } from "@/components/valentina/rodizio-dashboard-types";

export interface SdrTargetLookup {
  conversationId: string;
  dealId?: string;
  phone?: string;
  leadName?: string;
  ts: number;
}

/**
 * Constrói o link direto para abrir a Triagem SDR do lead em nova guia (`/ia/sdr?...`).
 */
export function buildRodizioTriageHref(card: OperatorCard): string {
  const basePath = buildAppRoutePath("valentina", { tabId: "sdr" });
  const params = new URLSearchParams();

  const convId = (card.chatId || card.id || "").trim();
  if (convId) {
    params.set("conversationId", convId);
  }

  const dealId = (
    card.rdDealId ||
    (card.id && card.id.startsWith("deal-") ? card.id : "")
  ).trim();
  if (dealId) {
    params.set("dealId", dealId);
  }

  const phoneDigits = (card.phone || "").replace(/\D/g, "");
  if (phoneDigits.length >= 8) {
    params.set("phone", phoneDigits);
  }

  const leadName = (card.name || "").trim();
  if (leadName) {
    params.set("leadName", leadName);
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Constrói o link direto para abrir a Conversa padrão do lead em nova guia (`/chat/$chatKey`).
 */
export function buildRodizioChatHref(card: OperatorCard): string {
  const directChatId = (card.chatId || "").trim();
  if (directChatId) {
    return `/chat/${encodeURIComponent(directChatId)}`;
  }

  const rawCardId = (card.id || "").trim();
  if (rawCardId && !rawCardId.startsWith("deal-")) {
    return `/chat/${encodeURIComponent(rawCardId)}`;
  }

  const dealKey = (card.rdDealId || (rawCardId.startsWith("deal-") ? rawCardId : "")).trim();
  if (dealKey) {
    return `/chat/${encodeURIComponent(dealKey)}`;
  }

  const phoneDigits = (card.phone || "").replace(/\D/g, "");
  if (phoneDigits.length >= 8 && phoneDigits.length <= 20) {
    return `/chat/${encodeURIComponent(phoneDigits)}`;
  }

  return "/chat";
}

/**
 * Resolve o identificador da negociação no CRM local para um card do Rodízio.
 */
export function resolveRodizioCardDealId(
  card: OperatorCard,
  deals: ReadonlyArray<CrmDeal>,
): string | undefined {
  const matchedDeal = deals.find(
    (d) =>
      (Boolean(card.rdDealId) && (d.id === card.rdDealId || d.rd_deal_id === card.rdDealId)) ||
      d.id === card.id ||
      d.name.trim().toLowerCase() === card.name.trim().toLowerCase() ||
      Boolean(card.phone && d.phone && d.phone === card.phone),
  );

  const candidate =
    card.rdDealId ||
    matchedDeal?.rd_deal_id ||
    matchedDeal?.id ||
    (card.id.startsWith("deal-") ? card.id : undefined);

  const trimmed = candidate?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Constrói o link direto para abrir a Negociação no CRM local em nova guia.
 */
export function buildRodizioNegotiationHref(
  card: OperatorCard,
  deals: ReadonlyArray<CrmDeal>,
): string {
  const targetDealId = resolveRodizioCardDealId(card, deals);
  if (targetDealId) {
    return `/crm/deals/${encodeURIComponent(targetDealId)}?from=valentina`;
  }
  return buildAppRoutePath("crm", { tabId: "kanban" });
}

/**
 * Extrai os parâmetros de deep-link da Triagem SDR a partir de `window.location.search`.
 */
export function parseSdrTargetFromSearch(search: string | undefined | null): SdrTargetLookup | null {
  if (!search) return null;
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  if (!normalized) return null;

  const params = new URLSearchParams(normalized);
  const conversationId = (params.get("conversationId") || "").trim();
  const dealId = (params.get("dealId") || "").trim() || undefined;
  const phone = (params.get("phone") || "").replace(/\D/g, "") || undefined;
  const leadName = (params.get("leadName") || "").trim() || undefined;

  if (!conversationId && !dealId && !phone && !leadName) {
    return null;
  }

  return {
    conversationId: conversationId || dealId || "",
    dealId,
    phone,
    leadName,
    ts: Date.now(),
  };
}

/**
 * Abre uma rota interna em nova guia preservando a guia atual intacta.
 */
export function openRouteInNewTab(href: string): void {
  if (typeof window === "undefined" || !href) return;
  const opened = window.open(href, "_blank", "noopener,noreferrer");
  if (opened) {
    opened.opener = null;
  }
}
