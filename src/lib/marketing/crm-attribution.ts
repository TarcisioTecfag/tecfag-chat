import { and, desc, eq, sql } from "drizzle-orm";
import {
  commercialConsultantProfiles,
  contacts,
  conversations,
  crmDeals,
  crmPipelines,
  crmStages,
  messages,
  sectors,
} from "../../db/schema";
import { readSiteContext, type SiteContext } from "../livechat/site-context";

export const MARKETING_SECTORS = [
  "semi_industrial",
  "personnalite",
  "projetos",
  "pecas",
  "pre_venda",
  "suporte_tecnico",
  "externo",
  "financeiro",
  "teste",
] as const;

export type MarketingSector = (typeof MARKETING_SECTORS)[number];

export const MARKETING_SECTOR_LABELS: Record<MarketingSector, string> = {
  semi_industrial: "Semi Industrial",
  personnalite: "Personnalité",
  projetos: "Projetos",
  pecas: "Peças",
  pre_venda: "Pré-venda",
  suporte_tecnico: "Suporte Técnico",
  externo: "Externo",
  financeiro: "Financeiro",
  teste: "Teste",
};

export const COMMERCIAL_DEFINITIVE_SECTORS = new Set<MarketingSector>([
  "semi_industrial",
  "personnalite",
  "projetos",
  "pecas",
]);

export const REPORTABLE_MARKETING_SECTORS = new Set<MarketingSector>([
  "semi_industrial",
  "personnalite",
  "projetos",
  "pecas",
  "pre_venda",
]);

export function isValidMarketingSector(val: unknown): val is MarketingSector {
  return typeof val === "string" && (MARKETING_SECTORS as readonly string[]).includes(val);
}

export function formatMarketingSectorLabel(sector: string | null | undefined): string | null {
  if (!sector) return null;
  if (isValidMarketingSector(sector)) return MARKETING_SECTOR_LABELS[sector];
  return sector;
}

function normText(raw: unknown): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanStr(raw: unknown, maxLen = 500): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (
    !trimmed ||
    /^encoded_/i.test(trimmed) ||
    /^(unknown|undefined|null|n[aã]o informad[oa]|desconhecid[oa]|nada|-)$/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed.slice(0, maxLen);
}

/**
 * Detecta palavra isolada "TESTE" ou "TESTES" no título ou nome do contato,
 * sem falsos positivos em palavras reais como "Atestado", "Contestação", etc.
 */
export function isTestEntityTitle(rawTitle: string | null | undefined): boolean {
  if (!rawTitle) return false;
  return /(?:^|[^a-zA-ZÀ-ÿ0-9])testes?(?:$|[^a-zA-ZÀ-ÿ0-9])/i.test(rawTitle.trim());
}

/**
 * Identifica se um valor bruto de `source` é apenas um rótulo operacional de canal
 * (ex.: 'manual', 'chat', 'whatsapp', 'WhatsApp SDR (Fagner)') e NÃO uma fonte de mídia.
 */
export function isOperationalChannelLabel(rawSource: unknown): boolean {
  const n = normText(rawSource);
  if (!n) return false;
  return (
    n === "manual" ||
    n === "chat" ||
    n === "whatsapp" ||
    n === "auto_sdr" ||
    n === "crm" ||
    n === "import_rd" ||
    n === "rd station marketing" ||
    n === "nao informada" ||
    n === "nao informado" ||
    n.startsWith("whatsapp sdr")
  );
}

export function inferEntryChannelFromOperationalSource(
  rawSource: unknown,
  fallback: string | null = null,
): string | null {
  const n = normText(rawSource);
  if (!n) return fallback;
  if (n.startsWith("whatsapp sdr") || n === "auto_sdr") return "whatsapp_sdr";
  if (n === "whatsapp" || n === "chat") return "whatsapp";
  if (n === "manual" || n === "crm") return "manual";
  if (n === "site_chat" || n === "livechat") return "site_chat";
  if (n === "rd_webhook" || n === "rd station marketing") return "rd_webhook";
  return fallback;
}

export interface UtmAndAttributionInput {
  explicitSource?: string | null;
  explicitCampaign?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  clickId?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  ctwaClid?: string | null;
  hasMetaAdReferral?: boolean;
  referrer?: string | null;
  landingPage?: string | null;
  entryChannel?: string | null;
}

export interface NormalizedMarketingAttribution {
  entryChannel: string | null;
  source: string | null; // deal_source_name (padrão RD CRM)
  campaign: string | null; // campaign_name = Ponto de Conversão (NUNCA utm_campaign)
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  clickId: string | null;
  landingPage: string | null;
}

const PAID_MEDIUM_RE =
  /\b(cpc|ppc|paid|paid_social|paidsocial|ads|adwords|shopping|display|pmax|performance_max|remarketing|retargeting|sponsored|trafego_pago|midia_paga|metaads|googleads)\b/i;

const ORGANIC_MEDIUM_RE = /\b(organic|organico|seo)\b/i;

/**
 * Converte sinais de UTM / Click IDs / Referrals exatamente para a taxonomia oficial
 * de `deal_source_name` do RD Station CRM usada pelos dashboards de Marketing:
 * - "Busca Paga | Google"
 * - "Busca Paga | Meta"
 * - "Busca Paga | Mercado Livre"
 * - "Busca Orgânica | Google"
 * - etc.
 */
export function normalizeRdDealSource(input: UtmAndAttributionInput): string | null {
  const explicit = cleanStr(input.explicitSource, 160);

  // Se já veio formatado no padrão do RD (ex.: "Busca Paga | ...", "Feiras e Eventos", "Prospecção Ativa")
  // e não é um rótulo operacional ("manual"/"chat"/"whatsapp") nem um utm_source cru ("google"/"meta"),
  // preserva fielmente.
  if (explicit && !isOperationalChannelLabel(explicit)) {
    const expNorm = normText(explicit);
    const isRawPlatformToken = [
      "google",
      "googleads",
      "adwords",
      "meta",
      "metaads",
      "fb",
      "ig",
      "facebook",
      "instagram",
      "facebook ads",
      "mercadolivre",
      "meli",
      "bing",
      "linkedin",
      "tiktok",
      "youtube",
      "linktree",
      "direct",
      "email",
      "newsletter",
    ].includes(expNorm);

    if (!isRawPlatformToken) {
      return explicit;
    }
  }

  const rawSourceToken = normText(
    input.utmSource || (!isOperationalChannelLabel(explicit) ? explicit : null),
  );
  const rawMedium = normText(input.utmMedium);
  const refNorm = normText(input.referrer);
  const hasGclid = Boolean(cleanStr(input.gclid));
  const hasFbclid = Boolean(cleanStr(input.fbclid));
  const hasCtwa = Boolean(cleanStr(input.ctwaClid)) || Boolean(input.hasMetaAdReferral);

  const isPaid =
    hasGclid ||
    hasFbclid ||
    hasCtwa ||
    PAID_MEDIUM_RE.test(rawMedium) ||
    PAID_MEDIUM_RE.test(rawSourceToken);

  if (hasCtwa || (isPaid && /\b(meta|metaads|fb|ig|facebook|instagram)\b/.test(rawSourceToken)) || (hasFbclid && !rawSourceToken)) {
    return "Busca Paga | Meta";
  }

  if (hasGclid || (isPaid && /\b(google|googleads|adwords)\b/.test(rawSourceToken))) {
    return "Busca Paga | Google";
  }

  if (isPaid && /\b(mercadolivre|mercado livre|meli)\b/.test(rawSourceToken)) {
    return "Busca Paga | Mercado Livre";
  }

  if (isPaid && /\bbing\b/.test(rawSourceToken)) {
    return "Busca Paga | Bing";
  }

  if (isPaid && /\blinkedin\b/.test(rawSourceToken)) {
    return "Busca Paga | LinkedIn";
  }

  if (isPaid && /\btiktok\b/.test(rawSourceToken)) {
    return "Busca Paga | TikTok";
  }

  if (isPaid && rawSourceToken) {
    return `Busca Paga | ${cleanStr(input.utmSource || explicit) || rawSourceToken}`;
  }

  // Orgânico / Social / E-mail / Direto
  if (
    (/\bgoogle\b/.test(rawSourceToken) && (!rawMedium || ORGANIC_MEDIUM_RE.test(rawMedium))) ||
    (!rawSourceToken && refNorm.includes("google."))
  ) {
    return "Busca Orgânica | Google";
  }

  if (
    (/\bbing\b/.test(rawSourceToken) && (!rawMedium || ORGANIC_MEDIUM_RE.test(rawMedium))) ||
    (!rawSourceToken && refNorm.includes("bing."))
  ) {
    return "Busca Orgânica | Bing";
  }

  if (/\byahoo\b/.test(rawSourceToken) || (!rawSourceToken && refNorm.includes("yahoo."))) {
    return "Busca Orgânica | Yahoo";
  }

  if (/\blinktree\b/.test(rawSourceToken) || refNorm.includes("linktr.ee")) {
    return "Social | linktree";
  }

  if (/\b(instagram|ig)\b/.test(rawSourceToken) || refNorm.includes("instagram.com")) {
    return "Social | Instagram";
  }

  if (/\b(facebook|fb)\b/.test(rawSourceToken) || refNorm.includes("facebook.com")) {
    return "Social | Facebook";
  }

  if (/\byoutube\b/.test(rawSourceToken) || refNorm.includes("youtube.com")) {
    return "Social | YouTube";
  }

  if (/\b(email|e-mail|newsletter|rdstation)\b/.test(rawMedium) || /\b(newsletter)\b/.test(rawSourceToken)) {
    return "E-mail Marketing";
  }

  if (rawSourceToken === "direct" || rawSourceToken === "direto") {
    return "Tráfego Direto";
  }

  if (input.entryChannel === "site_chat") {
    return "Contato pelo Site";
  }

  if (explicit && !isOperationalChannelLabel(explicit)) {
    return explicit;
  }

  return null;
}

/**
 * Extrai atribuição de anúncios Click-to-WhatsApp (CTWA) vindos no campo `referral`
 * do webhook oficial da Meta Cloud API.
 */
export function extractMetaReferralAttribution(rawPayload: unknown): NormalizedMarketingAttribution | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const msg = rawPayload as Record<string, any>;
  const ref = msg.referral;
  if (!ref || typeof ref !== "object") return null;

  const sourceType = normText(ref.source_type);
  const ctwaClid = cleanStr(ref.ctwa_clid, 250);
  const sourceId = cleanStr(ref.source_id, 160);
  const headline = cleanStr(ref.headline, 180);
  const sourceUrl = cleanStr(ref.source_url, 1000);

  let utmSource: string | null = null;
  let utmMedium: string | null = null;
  let utmCampaign: string | null = null;
  let utmContent: string | null = null;
  let utmTerm: string | null = null;
  let fbclid: string | null = null;

  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      utmSource = cleanStr(parsed.searchParams.get("utm_source"), 200);
      utmMedium = cleanStr(parsed.searchParams.get("utm_medium"), 200);
      utmCampaign = cleanStr(parsed.searchParams.get("utm_campaign"), 200);
      utmContent = cleanStr(parsed.searchParams.get("utm_content"), 200);
      utmTerm = cleanStr(parsed.searchParams.get("utm_term"), 200);
      fbclid = cleanStr(parsed.searchParams.get("fbclid"), 250);
    } catch {
      // URL não parseável; mantém dados diretos do referral
    }
  }

  const isAd = sourceType === "ad" || Boolean(ctwaClid);
  const source = normalizeRdDealSource({
    utmSource: utmSource || "meta",
    utmMedium: utmMedium || (isAd ? "cpc" : "social"),
    ctwaClid,
    fbclid,
    hasMetaAdReferral: isAd,
    entryChannel: "whatsapp",
  });

  const conversionLabel = headline
    ? `CTWA | ${headline}`.slice(0, 200)
    : sourceId
      ? `CTWA | Ad ${sourceId}`
      : "CTWA | Meta Ads";

  return {
    entryChannel: "whatsapp",
    source: source || (isAd ? "Busca Paga | Meta" : "Social | Instagram"),
    campaign: conversionLabel,
    utmSource: utmSource || "meta",
    utmMedium: utmMedium || (isAd ? "cpc" : "social"),
    utmCampaign: utmCampaign || headline || sourceId || null,
    utmContent: utmContent || sourceId || null,
    utmTerm,
    clickId: ctwaClid || fbclid || sourceId || null,
    landingPage: sourceUrl,
  };
}

/**
 * Extrai atribuição do contexto de navegação do visitante no site (LiveChat / Widget VTEX).
 */
export function extractSiteContextAttribution(
  siteContext: SiteContext | null | undefined,
  conversionPointLabel = "Chat Site",
): NormalizedMarketingAttribution | null {
  if (!siteContext) return null;
  const entry = siteContext.entry || siteContext.page;
  if (!entry) return null;

  const utm = entry.utm || {};
  const utmSource = cleanStr(utm.utm_source, 200);
  const utmMedium = cleanStr(utm.utm_medium, 200);
  const utmCampaign = cleanStr(utm.utm_campaign, 200);
  const utmContent = cleanStr(utm.utm_content, 200);
  const utmTerm = cleanStr(utm.utm_term, 200);

  let gclid: string | null = null;
  let fbclid: string | null = null;
  try {
    const u = new URL(entry.url);
    gclid = cleanStr(u.searchParams.get("gclid"), 250);
    fbclid = cleanStr(u.searchParams.get("fbclid"), 250);
  } catch {
    // ignore
  }

  const source = normalizeRdDealSource({
    utmSource,
    utmMedium,
    utmCampaign,
    gclid,
    fbclid,
    referrer: entry.referrer,
    entryChannel: "site_chat",
  });

  return {
    entryChannel: "site_chat",
    source: source || "Contato pelo Site",
    campaign: conversionPointLabel,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    clickId: gclid || fbclid || null,
    landingPage: cleanStr(entry.url, 1000),
  };
}

/**
 * Mapeia o nome de um funil específico (ou funil original do RD) para o enum fechado `MarketingSector`.
 * Retorna `null` se o funil for unificado/compartilhado (ex.: FUNIL CWR), exigindo resolução pelo operador/etapa.
 */
export function resolveSectorFromPipelineName(
  pipelineName: string | null | undefined,
  pipelineId?: string | null,
): MarketingSector | null {
  const n = normText(pipelineName);
  const pid = normText(pipelineId);

  if (pid === "pipe-tecfag-funil-testes" || (n.includes("teste") && !n.includes("arquivo") && !n.includes("historico"))) {
    return "teste";
  }
  if (n.includes("cwr") || n.includes("war room") || n.includes("esforco") || n.includes("v31")) {
    return null; // Funil unificado: setor depende da divisão do responsável / etapa
  }
  if (n.includes("arquivo") || n.includes("historico") || pid === "pipe-tecfag-testes") {
    return null; // Arquivo legado: setor vem de funil_original_rd ou divisão
  }
  if (n.includes("maquina") || n.includes("semi industrial") || n.includes("semi-industrial")) {
    return "semi_industrial";
  }
  if (n.includes("personnalite") || n.includes("personalite")) {
    return "personnalite";
  }
  if (n.includes("projeto")) {
    return "projetos";
  }
  if (n.includes("peca")) {
    return "pecas";
  }
  if (n.includes("sdr") || n.includes("triagem") || n.includes("pre-venda") || n.includes("pre venda")) {
    return "pre_venda";
  }
  if (n.includes("suporte") || n.includes("assistencia") || n.includes("pos venda") || n.includes("pos-venda")) {
    return "suporte_tecnico";
  }
  if (n.includes("externo")) {
    return "externo";
  }
  if (n.includes("financeiro") || n.includes("cobranca")) {
    return "financeiro";
  }
  return null;
}

export function resolveSectorFromOperatorContext(params: {
  operatorDivision?: string | null;
  operatorSectorNames?: string[];
  stageName?: string | null;
  customFields?: Record<string, unknown> | null;
}): MarketingSector {
  const sectorNamesNorm = (params.operatorSectorNames || []).map(normText);

  // 1. Se o operador pertence explicitamente ao setor de SDR / Pré-venda, Projetos, Peças, Suporte ou Financeiro
  if (sectorNamesNorm.some((s) => s === "sdr" || s.includes("pre venda") || s.includes("pre-venda") || s.includes("triagem"))) {
    return "pre_venda";
  }
  if (sectorNamesNorm.some((s) => s.includes("projeto")) && !params.operatorDivision) {
    return "projetos";
  }
  if (sectorNamesNorm.some((s) => s.includes("peca"))) {
    return "pecas";
  }
  if (sectorNamesNorm.some((s) => s.includes("suporte") || s.includes("assistencia") || s.includes("pos venda") || s.includes("pos-venda"))) {
    return "suporte_tecnico";
  }
  if (sectorNamesNorm.some((s) => s.includes("financeiro"))) {
    return "financeiro";
  }

  // 2. Divisão comercial oficial (commercial_consultant_profiles — mesma fonte das metas)
  const div = normText(params.operatorDivision);
  if (div === "maquinas" || div === "semi_industrial") return "semi_industrial";
  if (div === "personnalite" || div === "personalite") return "personnalite";

  // 3. Setores comerciais de atendimento
  if (sectorNamesNorm.some((s) => s.includes("personnalite") || s.includes("personalite"))) {
    return "personnalite";
  }
  if (sectorNamesNorm.some((s) => s.includes("maquina"))) {
    return "semi_industrial";
  }
  if (sectorNamesNorm.some((s) => s.includes("projeto"))) {
    return "projetos";
  }

  // 4. Etapa de pré-qualificação no funil unificado quando sem consultor comercial definido
  const stg = normText(params.stageName);
  if (
    stg === "prospects" ||
    stg === "contatar" ||
    stg === "contatando" ||
    stg.includes("pre-qualific") ||
    stg.includes("pre qualific") ||
    stg === "qualificando" ||
    stg === "para triar" ||
    stg === "em triagem" ||
    stg.includes("para analise")
  ) {
    return "pre_venda";
  }

  // 5. Fallback por customFields legados do RD ("Equipes do Responsável")
  const cf = params.customFields || {};
  const rawTeams = normText(
    cf["cf-tf-deal-equipes-responsavel"] || cf["Equipes do Responsável"] || "",
  );
  if (rawTeams.includes("projeto") && !rawTeams.includes("maquina")) return "projetos";
  if (rawTeams.includes("personnalite") && !rawTeams.includes("maquina")) return "personnalite";
  if (rawTeams.includes("maquina")) return "semi_industrial";

  return "pre_venda";
}

/**
 * Resolve o setor atual (`sector_current`) de uma negociação combinando:
 * flag de teste -> setor explícito -> legado (`funil_original_rd`) -> funil específico -> divisão/setor do operador (CWR).
 */
export function resolveDealCurrentSector(params: {
  isTest?: boolean;
  isLegacy?: boolean;
  explicitSector?: string | null;
  pipelineId?: string | null;
  pipelineName?: string | null;
  stageId?: string | null;
  stageName?: string | null;
  operatorDivision?: string | null;
  operatorSectorNames?: string[];
  customFields?: Record<string, unknown> | null;
}): MarketingSector {
  if (params.isTest) return "teste";

  if (params.explicitSector && isValidMarketingSector(params.explicitSector)) {
    return params.explicitSector;
  }

  const cf = params.customFields || {};
  const origRdFunnel = cleanStr(cf.funil_original_rd, 200);
  if (params.isLegacy && origRdFunnel) {
    const fromOrig = resolveSectorFromPipelineName(origRdFunnel);
    if (fromOrig) return fromOrig;
  }

  const fromPipeline = resolveSectorFromPipelineName(params.pipelineName, params.pipelineId);
  if (fromPipeline) return fromPipeline;

  if (origRdFunnel) {
    const fromOrigFallback = resolveSectorFromPipelineName(origRdFunnel);
    if (fromOrigFallback) return fromOrigFallback;
  }

  return resolveSectorFromOperatorContext({
    operatorDivision: params.operatorDivision,
    operatorSectorNames: params.operatorSectorNames,
    stageName: params.stageName,
    customFields: cf,
  });
}

/**
 * Regra de imutabilidade de `sector_origin`:
 * - Na criação, recebe o setor inicial.
 * - Enquanto estiver como `'pre_venda'` (ou nulo), assim que o card ganhar pela 1ª vez
 *   um setor comercial definitivo (`semi_industrial`, `personnalite`, `projetos`, `pecas`),
 *   `sector_origin` grava esse primeiro setor comercial e NUNCA MAIS MUDA (mesmo que depois
 *   o card pule entre Máquinas e Personnalité).
 */
export function computeLockedSectorOrigin(
  previousSectorOrigin: string | null | undefined,
  nextSectorCurrent: MarketingSector,
): MarketingSector {
  if (!previousSectorOrigin || !isValidMarketingSector(previousSectorOrigin)) {
    return nextSectorCurrent;
  }
  if (
    previousSectorOrigin === "pre_venda" &&
    COMMERCIAL_DEFINITIVE_SECTORS.has(nextSectorCurrent)
  ) {
    return nextSectorCurrent;
  }
  return previousSectorOrigin;
}

/**
 * Verifica se a etapa representa vitória comercial (`FECHAMENTO` / `VENDA CONCLUÍDA` / `isWinStage`),
 * excluindo etapas administrativas como `FINALIZADOS` de Suporte Técnico ou Financeiro.
 */
export function isEffectiveCommercialWin(params: {
  status: string | null | undefined;
  stageIsWin?: boolean | null;
  stageName?: string | null;
  sectorCurrent?: string | null;
}): boolean {
  if (params.status === "won") return true;
  if (params.status !== "open") return false;
  if (params.sectorCurrent === "suporte_tecnico" || params.sectorCurrent === "financeiro") {
    return false;
  }
  if (params.stageIsWin) return true;
  const stg = normText(params.stageName);
  return stg.startsWith("fechamento") || stg.startsWith("venda concluida");
}

/**
 * Carrega no banco (dentro ou fora de transação) o contexto de setor de um operador e funil/etapa
 * estritamente isolado por `tenantId`.
 */
export async function loadDealSectorResolutionContext(
  tx: any,
  tenantId: string,
  pipelineId: string,
  stageId: string,
  operatorId: string | null | undefined,
): Promise<{
  pipelineName: string | null;
  stageName: string | null;
  stageIsWin: boolean;
  stageIsLoss: boolean;
  operatorDivision: string | null;
  operatorSectorNames: string[];
}> {
  const [pipeRows, stageRows, profileRows, allSectors] = await Promise.all([
    tx
      .select({ name: crmPipelines.name })
      .from(crmPipelines)
      .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, pipelineId)))
      .limit(1),
    tx
      .select({
        name: crmStages.name,
        isWinStage: crmStages.isWinStage,
        isLossStage: crmStages.isLossStage,
      })
      .from(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, stageId)))
      .limit(1),
    operatorId
      ? tx
          .select({ division: commercialConsultantProfiles.division })
          .from(commercialConsultantProfiles)
          .where(
            and(
              eq(commercialConsultantProfiles.tenantId, tenantId),
              eq(commercialConsultantProfiles.operatorId, operatorId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    operatorId
      ? tx
          .select({ name: sectors.name, operatorIds: sectors.operatorIds })
          .from(sectors)
          .where(eq(sectors.tenantId, tenantId))
      : Promise.resolve([]),
  ]);

  const operatorSectorNames = operatorId
    ? allSectors
        .filter((s: any) => Array.isArray(s.operatorIds) && s.operatorIds.includes(operatorId))
        .map((s: any) => String(s.name || ""))
    : [];

  return {
    pipelineName: pipeRows[0]?.name || null,
    stageName: stageRows[0]?.name || null,
    stageIsWin: Boolean(stageRows[0]?.isWinStage),
    stageIsLoss: Boolean(stageRows[0]?.isLossStage),
    operatorDivision: profileRows[0]?.division || null,
    operatorSectorNames,
  };
}

/**
 * Herda atribuição de marketing (source, campaign, UTMs, clickId, landingPage) a partir
 * da conversa (mensagens com `marketingAttribution` ou `siteContext`) ou do contato (`contacts`).
 */
export async function resolveInheritedMarketingAttribution(
  tx: any,
  tenantId: string,
  params: {
    contactId?: string | null;
    conversationId?: string | null;
    explicitSource?: string | null;
    explicitCampaign?: string | null;
    explicitEntryChannel?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    clickId?: string | null;
    landingPage?: string | null;
  },
): Promise<NormalizedMarketingAttribution> {
  const inferredChannel =
    cleanStr(params.explicitEntryChannel, 60) ||
    inferEntryChannelFromOperationalSource(
      params.explicitSource,
      params.conversationId ? "whatsapp" : "manual",
    );

  let convAttribution: Partial<NormalizedMarketingAttribution> | null = null;

  // 1. Verificar atribuição capturada nas mensagens recentes da conversa (Meta CTWA referral ou siteContext)
  if (params.conversationId) {
    try {
      const recentClientMsgs = await tx
        .select({ metaDetails: messages.metaDetails })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            eq(messages.conversationId, params.conversationId),
            eq(messages.senderType, "client"),
            eq(messages.isInternalNote, false),
          ),
        )
        .orderBy(desc(messages.sentAt))
        .limit(15);

      for (const row of recentClientMsgs) {
        const meta = (row.metaDetails || {}) as Record<string, any>;
        if (meta.marketingAttribution && typeof meta.marketingAttribution === "object") {
          convAttribution = meta.marketingAttribution;
          break;
        }
        const sc = readSiteContext(meta.siteContext);
        if (sc) {
          convAttribution = extractSiteContextAttribution(sc, "Chat Site");
          if (convAttribution) break;
        }
      }
    } catch {
      // Ignora em ambientes de teste com mocks parciais
    }
  }

  // 2. Verificar primeiro toque persistido no contato (ou último deal com fonte válida do contato)
  let contactRow: any = null;
  let priorDealRow: any = null;
  if (params.contactId) {
    try {
      const [c] = await tx
        .select({
          firstSource: contacts.firstSource,
          firstCampaign: contacts.firstCampaign,
          utmSource: contacts.utmSource,
          utmMedium: contacts.utmMedium,
          utmCampaign: contacts.utmCampaign,
          utmContent: contacts.utmContent,
          utmTerm: contacts.utmTerm,
          clickId: contacts.clickId,
          landingPage: contacts.landingPage,
          customFields: contacts.customFields,
        })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, params.contactId)))
        .limit(1);
      contactRow = c || null;

      if (!convAttribution && contactRow?.customFields && typeof contactRow.customFields === "object") {
        const sc = readSiteContext((contactRow.customFields as Record<string, unknown>).siteContext);
        if (sc) {
          convAttribution = extractSiteContextAttribution(sc, "Chat Site");
        }
      }

      if (!contactRow?.firstSource && !convAttribution?.source) {
        const [d] = await tx
          .select({
            source: crmDeals.source,
            campaign: crmDeals.campaign,
            utmSource: crmDeals.utmSource,
            utmMedium: crmDeals.utmMedium,
            utmCampaign: crmDeals.utmCampaign,
            utmContent: crmDeals.utmContent,
            utmTerm: crmDeals.utmTerm,
            clickId: crmDeals.clickId,
            landingPage: crmDeals.landingPage,
          })
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.tenantId, tenantId),
              sql`EXISTS (
                SELECT 1 FROM crm_deal_contacts dc
                WHERE dc.tenant_id = ${tenantId}
                  AND dc.deal_id = ${crmDeals.id}
                  AND dc.contact_id = ${params.contactId}
              )`,
              sql`${crmDeals.source} IS NOT NULL AND ${crmDeals.source} != ''`,
            ),
          )
          .orderBy(desc(crmDeals.createdAt))
          .limit(1);
        if (d && !isOperationalChannelLabel(d.source)) {
          priorDealRow = d;
        }
      }
    } catch {
      // Ignora em mocks parciais
    }
  }

  const utmSource =
    cleanStr(params.utmSource, 200) ||
    cleanStr(convAttribution?.utmSource, 200) ||
    cleanStr(contactRow?.utmSource, 200) ||
    cleanStr(priorDealRow?.utmSource, 200);
  const utmMedium =
    cleanStr(params.utmMedium, 200) ||
    cleanStr(convAttribution?.utmMedium, 200) ||
    cleanStr(contactRow?.utmMedium, 200) ||
    cleanStr(priorDealRow?.utmMedium, 200);
  const utmCampaign =
    cleanStr(params.utmCampaign, 200) ||
    cleanStr(convAttribution?.utmCampaign, 200) ||
    cleanStr(contactRow?.utmCampaign, 200) ||
    cleanStr(priorDealRow?.utmCampaign, 200);
  const utmContent =
    cleanStr(params.utmContent, 200) ||
    cleanStr(convAttribution?.utmContent, 200) ||
    cleanStr(contactRow?.utmContent, 200) ||
    cleanStr(priorDealRow?.utmContent, 200);
  const utmTerm =
    cleanStr(params.utmTerm, 200) ||
    cleanStr(convAttribution?.utmTerm, 200) ||
    cleanStr(contactRow?.utmTerm, 200) ||
    cleanStr(priorDealRow?.utmTerm, 200);
  const clickId =
    cleanStr(params.clickId, 250) ||
    cleanStr(convAttribution?.clickId, 250) ||
    cleanStr(contactRow?.clickId, 250) ||
    cleanStr(priorDealRow?.clickId, 250);
  const landingPage =
    cleanStr(params.landingPage, 1000) ||
    cleanStr(convAttribution?.landingPage, 1000) ||
    cleanStr(contactRow?.landingPage, 1000) ||
    cleanStr(priorDealRow?.landingPage, 1000);

  const explicitValidSource =
    params.explicitSource && !isOperationalChannelLabel(params.explicitSource)
      ? cleanStr(params.explicitSource, 160)
      : null;

  const source =
    normalizeRdDealSource({
      explicitSource:
        explicitValidSource ||
        cleanStr(convAttribution?.source, 160) ||
        cleanStr(contactRow?.firstSource, 160) ||
        cleanStr(priorDealRow?.source, 160),
      utmSource,
      utmMedium,
      utmCampaign,
      clickId,
      entryChannel: inferredChannel,
    }) || null;

  const campaign =
    cleanStr(params.explicitCampaign, 200) ||
    cleanStr(convAttribution?.campaign, 200) ||
    cleanStr(contactRow?.firstCampaign, 200) ||
    cleanStr(priorDealRow?.campaign, 200) ||
    null;

  return {
    entryChannel: convAttribution?.entryChannel || inferredChannel,
    source,
    campaign,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    clickId,
    landingPage,
  };
}
