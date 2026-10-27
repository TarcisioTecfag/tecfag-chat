export type MetaCostCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION"
  | "SERVICE"
  | "REFERRAL";

export type MetaBillingRule =
  | "billable_template"
  | "billable_service_overage"
  | "free_csw_24h"
  | "free_utility_csw"
  | "free_monthly_tier"
  | "free_entry_point_72h"
  | "not_billed_failed";

export interface MetaTariffSchedule {
  usdToBrl: number;
  monthlyFreeAllowanceConversations: number;
  ratesUsd: {
    MARKETING: number;
    UTILITY: number;
    AUTHENTICATION: number;
    SERVICE: number;
    SERVICE_BENCHMARK_SAVING: number;
  };
}

/**
 * Tabela oficial de referência Meta WhatsApp Cloud API — Brasil (+55)
 * Vigência 2025/2026 (Per-Message Pricing + Customer Service Window 24h + Franquia 1.000 conversas/mês)
 */
export const DEFAULT_META_TARIFF_SCHEDULE: MetaTariffSchedule = {
  usdToBrl: 5.60,
  monthlyFreeAllowanceConversations: 1000,
  ratesUsd: {
    MARKETING: 0.0625,                // US$ 0.0625 (~R$ 0,350) por template de marketing entregue
    UTILITY: 0.0068,                  // US$ 0.0068 (~R$ 0,038) fora da janela 24h; GRÁTIS dentro da janela 24h
    AUTHENTICATION: 0.0315,           // US$ 0.0315 (~R$ 0,176) por template de autenticação/OTP
    SERVICE: 0.0000,                  // US$ 0.0000 dentro da janela de atendimento 24h / franquia gratuita
    SERVICE_BENCHMARK_SAVING: 0.0300, // US$ 0.0300 (tarifa base de conversa de serviço isenta pela janela/bônus)
  },
};

export interface RawMetaMessageRecord {
  id: string;
  conversationId: string;
  contactId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  senderType: string; // 'agent' | 'bot' | 'client' | 'system'
  senderName: string;
  content: string;
  status: string; // 'pending' | 'sending' | 'sent' | 'accepted' | 'delivered' | 'read' | 'failed'
  errorMessage?: string | null;
  metaDetails?: Record<string, unknown> | null;
  metaPricing?: Record<string, unknown> | null;
  sentAt: Date | string;
}

export interface EvaluatedMetaMessage {
  id: string;
  conversationId: string;
  contactName: string;
  contactPhone: string;
  senderType: "agent" | "bot" | "system";
  senderName: string;
  originLabel: "Operador" | "Bot IA (SDR)" | "Sistema";
  category: MetaCostCategory;
  categoryLabel: string;
  isTemplate: boolean;
  templateName: string | null;
  messageFormat: "template" | "text" | "image" | "audio" | "video" | "document";
  messageFormatLabel: string;
  contentPreview: string;
  status: string;
  statusLabel: string;
  isFailed: boolean;
  isDeliveredOrRead: boolean;
  in24hCustomerWindow: boolean;
  billable: boolean;
  billingRule: MetaBillingRule;
  billingRuleLabel: string;
  pricingSource: "webhook_meta" | "calculated_engine";
  costUsd: number;
  costBrl: number;
  savedUsd: number;
  savedBrl: number;
  sentAt: string;
}

export function extractTemplateNameFromMessage(
  content: string,
  metaDetails?: Record<string, unknown> | null,
): string | null {
  if (metaDetails && typeof metaDetails.templateName === "string" && metaDetails.templateName.trim()) {
    return metaDetails.templateName.trim();
  }
  const match = (content || "").match(/\[Template Meta:\s*([^\]]+)\]/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

export function detectMessageFormat(
  content: string,
  metaDetails?: Record<string, unknown> | null,
  isTemplate?: boolean,
): { format: EvaluatedMetaMessage["messageFormat"]; label: string } {
  if (isTemplate) {
    return { format: "template", label: "Template Oficial" };
  }
  const mediaTypeRaw =
    metaDetails && typeof metaDetails.mediaType === "string"
      ? metaDetails.mediaType.toLowerCase()
      : "";

  if (mediaTypeRaw === "image" || /^\[(LOCAL_)?MEDIA:image:/i.test(content)) {
    return { format: "image", label: "Imagem" };
  }
  if (mediaTypeRaw === "audio" || /^\[(LOCAL_)?MEDIA:audio:/i.test(content)) {
    return { format: "audio", label: "Áudio" };
  }
  if (mediaTypeRaw === "video" || /^\[(LOCAL_)?MEDIA:video:/i.test(content)) {
    return { format: "video", label: "Vídeo" };
  }
  if (mediaTypeRaw === "document" || /^\[(LOCAL_)?MEDIA:document:/i.test(content)) {
    return { format: "document", label: "Documento / PDF" };
  }
  return { format: "text", label: "Mensagem Livre (Texto)" };
}

export function cleanMessagePreview(content: string, templateName: string | null): string {
  if (!content) return templateName ? `Template: ${templateName}` : "Mensagem sem texto";
  const withoutMediaTag = content
    .replace(/^\[(LOCAL_)?MEDIA:(image|audio|video|document):[^\]]+\]\s*/i, "")
    .trim();
  if (!withoutMediaTag && templateName) return `Template: ${templateName}`;
  if (!withoutMediaTag) return "[Mídia enviada via WhatsApp Oficial]";
  return withoutMediaTag.length > 110 ? `${withoutMediaTag.slice(0, 107)}...` : withoutMediaTag;
}

export function normalizeCategoryFromWebhookOrTemplate(
  webhookCategoryRaw?: string | null,
  templateCategoryRaw?: string | null,
  isTemplate?: boolean,
): MetaCostCategory {
  const raw = (webhookCategoryRaw || templateCategoryRaw || "").trim().toUpperCase();
  if (raw === "MARKETING") return "MARKETING";
  if (raw === "UTILITY") return "UTILITY";
  if (raw === "AUTHENTICATION") return "AUTHENTICATION";
  if (raw === "REFERRAL_CONVERSION" || raw === "REFERRAL") return "REFERRAL";
  if (raw === "SERVICE") return "SERVICE";
  if (isTemplate) {
    // Quando é um template cujo nome ainda não foi sincronizado localmente, assume-se UTILITY por padrão conservador ou MARKETING se contiver termos promocionais
    return "UTILITY";
  }
  return "SERVICE";
}

export function getMetaCategoryLabel(category: MetaCostCategory): string {
  switch (category) {
    case "MARKETING":
      return "Marketing (Templates)";
    case "UTILITY":
      return "Utilidade (Pós-Venda / Avisos)";
    case "AUTHENTICATION":
      return "Autenticação (OTP / Segurança)";
    case "REFERRAL":
      return "Ponto de Entrada Gratuito (Anúncio 72h)";
    case "SERVICE":
    default:
      return "Serviço (Atendimento Janela 24h)";
  }
}

export function getMetaStatusLabel(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "read":
      return "Lida";
    case "delivered":
      return "Entregue";
    case "accepted":
    case "sent":
      return "Enviada";
    case "sending":
    case "pending":
      return "Processando";
    case "failed":
      return "Falha (Não Cobrada)";
    default:
      return status || "Enviada";
  }
}

/**
 * Verifica se existia janela de 24h aberta pelo cliente (inbound) no instante do disparo outbound
 */
export function hasActive24hCustomerWindow(
  outboundSentAtMs: number,
  inboundTimestampsAscMs: number[],
): boolean {
  if (!inboundTimestampsAscMs || inboundTimestampsAscMs.length === 0) return false;
  const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
  // Busca binária ou varredura reversa pelo último inbound <= outboundSentAtMs
  for (let i = inboundTimestampsAscMs.length - 1; i >= 0; i--) {
    const inboundMs = inboundTimestampsAscMs[i];
    if (inboundMs <= outboundSentAtMs) {
      return outboundSentAtMs - inboundMs <= WINDOW_24H_MS;
    }
  }
  return false;
}

/**
 * Avalia uma mensagem outbound da Meta Cloud API determinando sua categoria,
 * elegibilidade ao bônus gratuito (Janela 24h / Franquia Mensal / Free Entry Point 72h),
 * custo em USD/BRL e economia gerada pelo bônus.
 */
export function evaluateMetaOutboundMessage(params: {
  msg: RawMetaMessageRecord;
  templateCategoryMap: Map<string, string>;
  inboundTimestampsByConv: Map<string, number[]>;
  withinMonthlyFreeAllowance: boolean;
  schedule?: MetaTariffSchedule;
}): EvaluatedMetaMessage {
  const {
    msg,
    templateCategoryMap,
    inboundTimestampsByConv,
    withinMonthlyFreeAllowance,
    schedule = DEFAULT_META_TARIFF_SCHEDULE,
  } = params;

  const sentDate = msg.sentAt instanceof Date ? msg.sentAt : new Date(msg.sentAt);
  const sentAtMs = sentDate.getTime();
  const statusLower = (msg.status || "accepted").toLowerCase();
  const isFailed = statusLower === "failed";
  const isDeliveredOrRead = statusLower === "delivered" || statusLower === "read";

  const templateName = extractTemplateNameFromMessage(msg.content, msg.metaDetails);
  const isTemplate = Boolean(templateName);

  const templateKey = templateName ? templateName.toLowerCase() : "";
  const matchedTemplateCategory = templateKey ? templateCategoryMap.get(templateKey) || null : null;

  const pricingObj =
    msg.metaPricing && typeof msg.metaPricing === "object" && !Array.isArray(msg.metaPricing)
      ? (msg.metaPricing as Record<string, any>)
      : null;

  const webhookCategory =
    typeof pricingObj?.category === "string"
      ? pricingObj.category
      : typeof pricingObj?.conversation?.origin?.type === "string"
        ? pricingObj.conversation.origin.type
        : null;

  const webhookPricingType =
    typeof pricingObj?.type === "string" ? pricingObj.type.toLowerCase() : null;

  const hasWebhookPricing =
    pricingObj !== null &&
    (typeof pricingObj.billable === "boolean" ||
      typeof pricingObj.category === "string" ||
      typeof pricingObj.type === "string");

  const category = normalizeCategoryFromWebhookOrTemplate(
    webhookCategory,
    matchedTemplateCategory,
    isTemplate,
  );

  const inboundList = inboundTimestampsByConv.get(msg.conversationId) || [];
  const in24hCustomerWindow =
    webhookPricingType === "free_customer_service" ||
    hasActive24hCustomerWindow(sentAtMs, inboundList);

  const isFreeEntryPoint72h =
    webhookPricingType === "free_entry_point" || category === "REFERRAL";

  let billable = false;
  let billingRule: MetaBillingRule = "free_csw_24h";
  let billingRuleLabel = "Grátis • Janela 24h";
  let costUsd = 0;
  let savedUsd = 0;

  if (isFailed) {
    billable = false;
    billingRule = "not_billed_failed";
    billingRuleLabel = "Não Cobrado • Falha no Envio";
    costUsd = 0;
    savedUsd = 0;
  } else if (isFreeEntryPoint72h) {
    billable = false;
    billingRule = "free_entry_point_72h";
    billingRuleLabel = "Grátis • Bônus Anúncio 72h";
    costUsd = 0;
    savedUsd = isTemplate ? schedule.ratesUsd.MARKETING : schedule.ratesUsd.UTILITY;
  } else if (hasWebhookPricing && typeof pricingObj?.billable === "boolean") {
    billable = pricingObj.billable;
    if (!billable) {
      if (category === "UTILITY") {
        billingRule = "free_utility_csw";
        billingRuleLabel = "Grátis • Utility na Janela 24h";
        savedUsd = schedule.ratesUsd.UTILITY;
      } else {
        billingRule = withinMonthlyFreeAllowance ? "free_monthly_tier" : "free_csw_24h";
        billingRuleLabel = withinMonthlyFreeAllowance
          ? "Grátis • Bônus Franquia & Janela 24h"
          : "Grátis • Janela de Atendimento 24h";
        savedUsd = schedule.ratesUsd.UTILITY;
      }
      costUsd = 0;
    } else {
      billingRule = isTemplate ? "billable_template" : "billable_service_overage";
      billingRuleLabel = isTemplate ? `Tarifado • Template ${category}` : "Tarifado • Meta API";
      if (category === "MARKETING") costUsd = schedule.ratesUsd.MARKETING;
      else if (category === "AUTHENTICATION") costUsd = schedule.ratesUsd.AUTHENTICATION;
      else if (category === "UTILITY") costUsd = schedule.ratesUsd.UTILITY;
      else costUsd = schedule.ratesUsd.SERVICE_BENCHMARK_SAVING;
    }
  } else {
    // Inferência determinística pelas regras oficiais da Meta Cloud API
    if (category === "MARKETING") {
      billable = true;
      billingRule = "billable_template";
      billingRuleLabel = "Tarifado • Template Marketing";
      costUsd = schedule.ratesUsd.MARKETING;
    } else if (category === "AUTHENTICATION") {
      billable = true;
      billingRule = "billable_template";
      billingRuleLabel = "Tarifado • Template Autenticação";
      costUsd = schedule.ratesUsd.AUTHENTICATION;
    } else if (category === "UTILITY") {
      if (in24hCustomerWindow && !isTemplate) {
        billable = false;
        billingRule = "free_csw_24h";
        billingRuleLabel = "Grátis • Janela 24h";
        costUsd = 0;
        savedUsd = schedule.ratesUsd.UTILITY;
      } else if (in24hCustomerWindow && isTemplate) {
        // Pela regra oficial da Meta (PMP), templates UTILITY enviados dentro da janela aberta de 24h são gratuitos!
        billable = false;
        billingRule = "free_utility_csw";
        billingRuleLabel = "Grátis • Utility na Janela 24h";
        costUsd = 0;
        savedUsd = schedule.ratesUsd.UTILITY;
      } else {
        billable = true;
        billingRule = "billable_template";
        billingRuleLabel = "Tarifado • Template Utilidade";
        costUsd = schedule.ratesUsd.UTILITY;
      }
    } else {
      // Categoria SERVICE (mensagens livres de atendimento do operador ou bot SDR)
      billable = false;
      billingRule = withinMonthlyFreeAllowance ? "free_monthly_tier" : "free_csw_24h";
      billingRuleLabel = withinMonthlyFreeAllowance
        ? "Grátis • Bônus Franquia & Janela 24h"
        : "Grátis • Janela de Atendimento 24h";
      costUsd = 0;
      // Economia equivalente comparada à tarifa base de utilidade/serviço por interação
      savedUsd = schedule.ratesUsd.UTILITY;
    }
  }

  const costBrl = Number((costUsd * schedule.usdToBrl).toFixed(6));
  const savedBrl = Number((savedUsd * schedule.usdToBrl).toFixed(6));

  const { format: messageFormat, label: messageFormatLabel } = detectMessageFormat(
    msg.content,
    msg.metaDetails,
    isTemplate,
  );

  const senderTypeNorm: EvaluatedMetaMessage["senderType"] =
    msg.senderType === "bot" ? "bot" : msg.senderType === "system" ? "system" : "agent";

  const originLabel: EvaluatedMetaMessage["originLabel"] =
    senderTypeNorm === "bot"
      ? "Bot IA (SDR)"
      : senderTypeNorm === "system"
        ? "Sistema"
        : "Operador";

  return {
    id: msg.id,
    conversationId: msg.conversationId,
    contactName: msg.contactName || "Cliente WhatsApp",
    contactPhone: msg.contactPhone || "—",
    senderType: senderTypeNorm,
    senderName: msg.senderName || originLabel,
    originLabel,
    category,
    categoryLabel: getMetaCategoryLabel(category),
    isTemplate,
    templateName,
    messageFormat,
    messageFormatLabel,
    contentPreview: cleanMessagePreview(msg.content, templateName),
    status: statusLower,
    statusLabel: getMetaStatusLabel(statusLower),
    isFailed,
    isDeliveredOrRead,
    in24hCustomerWindow,
    billable,
    billingRule,
    billingRuleLabel,
    pricingSource: hasWebhookPricing ? "webhook_meta" : "calculated_engine",
    costUsd: Number(costUsd.toFixed(6)),
    costBrl,
    savedUsd: Number(savedUsd.toFixed(6)),
    savedBrl,
    sentAt: sentDate.toISOString(),
  };
}
