import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { agentConfigs, crmDeals } from "../../db/schema";

export const INTELIPOST_CONFIG_AGENT_TYPE = "intelipost_config";
export const INTELIPOST_DEAL_QUOTES_AGENT_TYPE = "intelipost_deal_quotes";

export interface IntelipostOriginAddress {
  unitName: string;
  zipCode: string;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  complement?: string;
}

export interface IntelipostTenantSettings {
  enabled: boolean;
  mode: "auto" | "live" | "simulation";
  apiBaseUrl: string;
  platformName: string;
  origin: IntelipostOriginAddress;
  defaultVolumeType: "BOX" | "PALLET" | "BAG" | "TUBE";
  extraHandlingDays: number;
  extraMarginPercent: number;
  defaultSalesChannel: string;
  updatedAt?: string;
  updatedByOperatorId?: string;
}

export interface IntelipostStoredConfig {
  settings: IntelipostTenantSettings;
  apiKey?: string;
  lastTestedAt?: string | null;
  lastTestStatus?: "ok" | "error" | null;
  lastTestMessage?: string | null;
}

export interface IntelipostPublicConfig {
  settings: IntelipostTenantSettings;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  lastTestedAt: string | null;
  lastTestStatus: "ok" | "error" | null;
  lastTestMessage: string | null;
}

export interface FreightQuoteVolumeInput {
  id: string;
  productId?: string | null;
  sku?: string;
  name: string;
  category?: string;
  quantity: number;
  weightKg: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  unitPrice: number;
  volumeType: "BOX" | "PALLET" | "BAG" | "TUBE";
}

export interface FreightDestinationInput {
  zipCode: string;
  street?: string;
  number?: string;
  district?: string;
  city?: string;
  state?: string;
  recipientType: "cnpj_contributor" | "cnpj_exempt" | "cpf";
  recipientDocument?: string;
  recipientName?: string;
}

export interface FreightCarrierOption {
  id: string;
  deliveryMethodId: number;
  carrierName: string;
  serviceName: string;
  logisticProviderName: string;
  deliveryMode: "rodoviario" | "expresso" | "aereo";
  deliveryEstimateBusinessDays: number;
  providerShippingCost: number;
  finalShippingCost: number;
  description?: string;
  quoteId?: string;
  source: "intelipost_live" | "simulation";
}

export interface SavedDealFreightQuote {
  id: string;
  dealId: string;
  quoteId: string;
  source: "intelipost_live" | "simulation";
  origin: IntelipostOriginAddress;
  destination: FreightDestinationInput;
  volumes: FreightQuoteVolumeInput[];
  totals: {
    totalQuantity: number;
    totalGrossWeightKg: number;
    totalCubicMeters: number;
    totalCubedWeightKg: number;
    totalTaxedWeightKg: number;
    totalInvoiceValue: number;
  };
  selectedOption: FreightCarrierOption;
  allOptionsCount: number;
  notes?: string;
  createdByOperatorId: string;
  createdByOperatorName: string;
  createdAt: string;
}

export const DEFAULT_TECFAG_ORIGIN: IntelipostOriginAddress = {
  unitName: "Matriz / CD Tecfag — Bauru/SP",
  zipCode: "17064-857",
  street: "Rua Leo Greatti Neto",
  number: "1-130",
  district: "Distrito Industrial III",
  city: "Bauru",
  state: "SP",
  complement: "",
};

export function getDefaultIntelipostSettings(): IntelipostTenantSettings {
  return {
    enabled: true,
    mode: "auto",
    apiBaseUrl: "https://api.intelipost.com.br/api/v1/",
    platformName: "Tecfag CRM",
    origin: { ...DEFAULT_TECFAG_ORIGIN },
    defaultVolumeType: "PALLET",
    extraHandlingDays: 0,
    extraMarginPercent: 0,
    defaultSalesChannel: "Comercial B2B Máquinas",
  };
}

export function normalizeZipCode(raw: string | undefined | null): string {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length === 8) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return digits;
}

export function normalizeZipDigits(raw: string | undefined | null): string {
  return String(raw || "").replace(/\D/g, "").slice(0, 8);
}

function maskApiKey(apiKey: string | undefined | null): string | null {
  if (!apiKey || !apiKey.trim()) return null;
  const clean = apiKey.trim();
  if (clean.length <= 8) return "••••••••";
  return `${clean.slice(0, 4)}••••••••••••${clean.slice(-4)}`;
}

export async function readIntelipostConfig(tenantId: string): Promise<IntelipostStoredConfig> {
  const rows = await db
    .select()
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.tenantId, tenantId),
        eq(agentConfigs.agentType, INTELIPOST_CONFIG_AGENT_TYPE),
      ),
    )
    .limit(1);

  const defaults = getDefaultIntelipostSettings();
  const row = rows[0];
  if (!row) {
    return {
      settings: defaults,
      apiKey: process.env.INTELIPOST_API_KEY || undefined,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestMessage: null,
    };
  }

  const raw = (row.config || {}) as Record<string, any>;
  const rawSettings = (raw.settings || {}) as Partial<IntelipostTenantSettings>;
  const rawOrigin = (rawSettings.origin || {}) as Partial<IntelipostOriginAddress>;

  const settings: IntelipostTenantSettings = {
    enabled: row.enabled === 1 && rawSettings.enabled !== false,
    mode:
      rawSettings.mode === "live" || rawSettings.mode === "simulation" || rawSettings.mode === "auto"
        ? rawSettings.mode
        : "auto",
    apiBaseUrl:
      typeof rawSettings.apiBaseUrl === "string" && rawSettings.apiBaseUrl.trim()
        ? rawSettings.apiBaseUrl.trim()
        : defaults.apiBaseUrl,
    platformName:
      typeof rawSettings.platformName === "string" && rawSettings.platformName.trim()
        ? rawSettings.platformName.trim()
        : defaults.platformName,
    origin: {
      unitName: rawOrigin.unitName?.trim() || defaults.origin.unitName,
      zipCode: normalizeZipCode(rawOrigin.zipCode) || defaults.origin.zipCode,
      street: rawOrigin.street?.trim() || defaults.origin.street,
      number: rawOrigin.number?.trim() || defaults.origin.number,
      district: rawOrigin.district?.trim() || defaults.origin.district,
      city: rawOrigin.city?.trim() || defaults.origin.city,
      state: (rawOrigin.state?.trim() || defaults.origin.state).toUpperCase().slice(0, 2),
      complement: rawOrigin.complement?.trim() || "",
    },
    defaultVolumeType:
      rawSettings.defaultVolumeType === "BOX" ||
      rawSettings.defaultVolumeType === "PALLET" ||
      rawSettings.defaultVolumeType === "BAG" ||
      rawSettings.defaultVolumeType === "TUBE"
        ? rawSettings.defaultVolumeType
        : defaults.defaultVolumeType,
    extraHandlingDays: Math.max(0, Number(rawSettings.extraHandlingDays) || 0),
    extraMarginPercent: Math.max(0, Number(rawSettings.extraMarginPercent) || 0),
    defaultSalesChannel:
      typeof rawSettings.defaultSalesChannel === "string" && rawSettings.defaultSalesChannel.trim()
        ? rawSettings.defaultSalesChannel.trim()
        : defaults.defaultSalesChannel,
    updatedAt: rawSettings.updatedAt || row.updatedAt?.toISOString(),
    updatedByOperatorId: rawSettings.updatedByOperatorId,
  };

  const storedApiKey =
    typeof raw.apiKey === "string" && raw.apiKey.trim()
      ? raw.apiKey.trim()
      : process.env.INTELIPOST_API_KEY || undefined;

  return {
    settings,
    apiKey: storedApiKey,
    lastTestedAt: typeof raw.lastTestedAt === "string" ? raw.lastTestedAt : null,
    lastTestStatus: raw.lastTestStatus === "ok" || raw.lastTestStatus === "error" ? raw.lastTestStatus : null,
    lastTestMessage: typeof raw.lastTestMessage === "string" ? raw.lastTestMessage : null,
  };
}

export function toPublicIntelipostConfig(stored: IntelipostStoredConfig): IntelipostPublicConfig {
  return {
    settings: stored.settings,
    hasApiKey: Boolean(stored.apiKey && stored.apiKey.trim()),
    maskedApiKey: maskApiKey(stored.apiKey),
    lastTestedAt: stored.lastTestedAt ?? null,
    lastTestStatus: stored.lastTestStatus ?? null,
    lastTestMessage: stored.lastTestMessage ?? null,
  };
}

export async function saveIntelipostConfig(
  tenantId: string,
  operatorId: string,
  input: {
    settings: Partial<IntelipostTenantSettings>;
    apiKey?: string;
    clearApiKey?: boolean;
    testUpdate?: {
      lastTestedAt: string;
      lastTestStatus: "ok" | "error";
      lastTestMessage: string;
    };
  },
): Promise<IntelipostPublicConfig> {
  const current = await readIntelipostConfig(tenantId);
  const incomingOrigin = input.settings.origin || current.settings.origin;

  const mergedSettings: IntelipostTenantSettings = {
    ...current.settings,
    ...input.settings,
    origin: {
      unitName: incomingOrigin.unitName?.trim() || DEFAULT_TECFAG_ORIGIN.unitName,
      zipCode: normalizeZipCode(incomingOrigin.zipCode) || DEFAULT_TECFAG_ORIGIN.zipCode,
      street: incomingOrigin.street?.trim() || DEFAULT_TECFAG_ORIGIN.street,
      number: incomingOrigin.number?.trim() || DEFAULT_TECFAG_ORIGIN.number,
      district: incomingOrigin.district?.trim() || DEFAULT_TECFAG_ORIGIN.district,
      city: incomingOrigin.city?.trim() || DEFAULT_TECFAG_ORIGIN.city,
      state: (incomingOrigin.state?.trim() || DEFAULT_TECFAG_ORIGIN.state).toUpperCase().slice(0, 2),
      complement: incomingOrigin.complement?.trim() || "",
    },
    extraHandlingDays: Math.max(
      0,
      Number(input.settings.extraHandlingDays ?? current.settings.extraHandlingDays) || 0,
    ),
    extraMarginPercent: Math.max(
      0,
      Number(input.settings.extraMarginPercent ?? current.settings.extraMarginPercent) || 0,
    ),
    updatedAt: new Date().toISOString(),
    updatedByOperatorId: operatorId,
  };

  let nextApiKey = current.apiKey;
  if (input.clearApiKey) {
    nextApiKey = undefined;
  } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    nextApiKey = input.apiKey.trim();
  }

  const nextPayload: Record<string, unknown> = {
    settings: mergedSettings,
    apiKey: nextApiKey || null,
    lastTestedAt: input.testUpdate?.lastTestedAt ?? current.lastTestedAt ?? null,
    lastTestStatus: input.testUpdate?.lastTestStatus ?? current.lastTestStatus ?? null,
    lastTestMessage: input.testUpdate?.lastTestMessage ?? current.lastTestMessage ?? null,
  };

  const existingRows = await db
    .select({ id: agentConfigs.id })
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.tenantId, tenantId),
        eq(agentConfigs.agentType, INTELIPOST_CONFIG_AGENT_TYPE),
      ),
    )
    .limit(1);

  if (existingRows[0]) {
    await db
      .update(agentConfigs)
      .set({
        enabled: mergedSettings.enabled ? 1 : 0,
        config: nextPayload,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentConfigs.id, existingRows[0].id),
          eq(agentConfigs.tenantId, tenantId),
        ),
      );
  } else {
    await db.insert(agentConfigs).values({
      id: `agcfg-intelipost-${tenantId}`,
      tenantId,
      agentType: INTELIPOST_CONFIG_AGENT_TYPE,
      enabled: mergedSettings.enabled ? 1 : 0,
      config: nextPayload,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return toPublicIntelipostConfig({
    settings: mergedSettings,
    apiKey: nextApiKey,
    lastTestedAt: nextPayload.lastTestedAt as string | null,
    lastTestStatus: nextPayload.lastTestStatus as "ok" | "error" | null,
    lastTestMessage: nextPayload.lastTestMessage as string | null,
  });
}

export function calculateFreightVolumesTotals(volumes: FreightQuoteVolumeInput[]) {
  let totalQuantity = 0;
  let totalGrossWeightKg = 0;
  let totalCubicMeters = 0;
  let totalInvoiceValue = 0;

  for (const v of volumes) {
    const qty = Math.max(1, Number(v.quantity) || 1);
    const weight = Math.max(0.1, Number(v.weightKg) || 0.1);
    const h = Math.max(1, Number(v.heightCm) || 1);
    const w = Math.max(1, Number(v.widthCm) || 1);
    const l = Math.max(1, Number(v.lengthCm) || 1);
    const price = Math.max(0, Number(v.unitPrice) || 0);

    totalQuantity += qty;
    totalGrossWeightKg += weight * qty;
    totalCubicMeters += ((h * w * l) / 1_000_000) * qty;
    totalInvoiceValue += price * qty;
  }

  // Fator de cubagem rodoviário padrão ANTT/TMS: 300 kg por m³
  const totalCubedWeightKg = totalCubicMeters * 300;
  const totalTaxedWeightKg = Math.max(totalGrossWeightKg, totalCubedWeightKg);

  return {
    totalQuantity,
    totalGrossWeightKg: Math.round(totalGrossWeightKg * 100) / 100,
    totalCubicMeters: Math.round(totalCubicMeters * 1000) / 1000,
    totalCubedWeightKg: Math.round(totalCubedWeightKg * 100) / 100,
    totalTaxedWeightKg: Math.round(totalTaxedWeightKg * 100) / 100,
    totalInvoiceValue: Math.round(totalInvoiceValue * 100) / 100,
  };
}

function resolveRegionFactorByZipOrState(destinationZip: string, destinationState?: string) {
  const uf = (destinationState || "").toUpperCase();
  const firstDigit = destinationZip.replace(/\D/g, "")[0] || "1";

  if (uf === "SP" || firstDigit === "0" || firstDigit === "1") {
    return { regionLabel: "Sudeste (SP)", distanceFactor: 1.0, baseDays: 2 };
  }
  if (["RJ", "MG", "ES"].includes(uf) || ["2", "3"].includes(firstDigit)) {
    return { regionLabel: "Sudeste", distanceFactor: 1.35, baseDays: 4 };
  }
  if (["PR", "SC", "RS"].includes(uf) || ["8", "9"].includes(firstDigit)) {
    return { regionLabel: "Sul", distanceFactor: 1.4, baseDays: 4 };
  }
  if (["MS", "MT", "GO", "DF"].includes(uf) || firstDigit === "7") {
    return { regionLabel: "Centro-Oeste", distanceFactor: 1.65, baseDays: 5 };
  }
  if (["BA", "SE", "PE", "AL", "PB", "RN", "CE", "PI", "MA"].includes(uf) || ["4", "5"].includes(firstDigit)) {
    return { regionLabel: "Nordeste", distanceFactor: 2.15, baseDays: 8 };
  }
  return { regionLabel: "Norte / Interior", distanceFactor: 2.65, baseDays: 11 };
}

function buildSimulatedIndustrialOptions(params: {
  destination: FreightDestinationInput;
  volumes: FreightQuoteVolumeInput[];
  settings: IntelipostTenantSettings;
}): { quoteId: string; options: FreightCarrierOption[] } {
  const totals = calculateFreightVolumesTotals(params.volumes);
  const region = resolveRegionFactorByZipOrState(params.destination.zipCode, params.destination.state);
  const quoteId = `SIM-${Date.now().toString().slice(-7)}`;

  const taxedWeight = Math.max(5, totals.totalTaxedWeightKg);
  const invoiceValue = Math.max(500, totals.totalInvoiceValue);
  const adValoremBase = invoiceValue * 0.0065; // 0,65% Ad Valorem + GRIS
  const handlingDays = Math.max(0, params.settings.extraHandlingDays || 0);
  const marginMultiplier = 1 + Math.max(0, params.settings.extraMarginPercent || 0) / 100;

  const rawCarriers = [
    {
      deliveryMethodId: 101,
      carrierName: "RTE Rodonaves",
      serviceName: "Rodonaves Rodoviário Fracionado B2B",
      logisticProviderName: "RTE Rodonaves",
      deliveryMode: "rodoviario" as const,
      ratePerKg: 1.85,
      fixedDispatch: 78,
      daysOffset: 0,
      description: "Coleta direta no CD Bauru/SP • Especialista em máquinas e volumes industriais",
    },
    {
      deliveryMethodId: 102,
      carrierName: "Braspress",
      serviceName: "Braspress Rodoviário Industrial",
      logisticProviderName: "Braspress Transportes Urgentes",
      deliveryMode: "rodoviario" as const,
      ratePerKg: 1.98,
      fixedDispatch: 85,
      daysOffset: 0,
      description: "Cobertura nacional • Entrega rastreada com agendamento B2B",
    },
    {
      deliveryMethodId: 103,
      carrierName: "Jamef",
      serviceName: "Jamef Encomendas Urgentes",
      logisticProviderName: "Jamef Transportes",
      deliveryMode: "expresso" as const,
      ratePerKg: 2.35,
      fixedDispatch: 96,
      daysOffset: -1,
      description: "Prioridade de embarque • Menor índice de avaria para equipamentos",
    },
    {
      deliveryMethodId: 104,
      carrierName: "Patrus Transportes",
      serviceName: "Patrus Carga Fracionada",
      logisticProviderName: "Patrus Transportes",
      deliveryMode: "rodoviario" as const,
      ratePerKg: 1.76,
      fixedDispatch: 74,
      daysOffset: 1,
      description: "Opção econômica rodoviária com seguro de carga incluso",
    },
    {
      deliveryMethodId: 105,
      carrierName: "Azul Cargo Express",
      serviceName: "Azul Cargo Aéreo Standard",
      logisticProviderName: "Azul Cargo",
      deliveryMode: "aereo" as const,
      ratePerKg: 4.4,
      fixedDispatch: 145,
      daysOffset: -Math.max(1, Math.floor(region.baseDays / 2)),
      description: "Modal aéreo rápido para peças, insumos ou equipamentos compactos",
    },
  ];

  const options: FreightCarrierOption[] = rawCarriers.map((c) => {
    const weightCost = taxedWeight * c.ratePerKg * region.distanceFactor;
    const providerCost = Math.round((c.fixedDispatch + weightCost + adValoremBase) * 100) / 100;
    const finalCost = Math.round(providerCost * marginMultiplier * 100) / 100;
    const days = Math.max(1, region.baseDays + c.daysOffset + handlingDays);

    return {
      id: `opt-${c.deliveryMethodId}`,
      deliveryMethodId: c.deliveryMethodId,
      carrierName: c.carrierName,
      serviceName: c.serviceName,
      logisticProviderName: c.logisticProviderName,
      deliveryMode: c.deliveryMode,
      deliveryEstimateBusinessDays: days,
      providerShippingCost: providerCost,
      finalShippingCost: finalCost,
      description: c.description,
      quoteId,
      source: "simulation",
    };
  });

  options.sort((a, b) => a.finalShippingCost - b.finalShippingCost);
  return { quoteId, options };
}

export async function executeIntelipostQuote(params: {
  tenantId: string;
  originOverride?: Partial<IntelipostOriginAddress>;
  destination: FreightDestinationInput;
  volumes: FreightQuoteVolumeInput[];
  signal?: AbortSignal;
}): Promise<{
  quoteId: string;
  source: "intelipost_live" | "simulation";
  origin: IntelipostOriginAddress;
  totals: ReturnType<typeof calculateFreightVolumesTotals>;
  options: FreightCarrierOption[];
  warningMessage?: string;
}> {
  const stored = await readIntelipostConfig(params.tenantId);
  const origin: IntelipostOriginAddress = {
    ...stored.settings.origin,
    ...(params.originOverride || {}),
    zipCode:
      normalizeZipCode(params.originOverride?.zipCode) || stored.settings.origin.zipCode,
  };

  const originZipDigits = normalizeZipDigits(origin.zipCode);
  const destZipDigits = normalizeZipDigits(params.destination.zipCode);

  if (originZipDigits.length !== 8) {
    throw new Error("O CEP de origem precisa conter 8 dígitos válidos.");
  }
  if (destZipDigits.length !== 8) {
    throw new Error("Informe um CEP de destino válido com 8 dígitos.");
  }
  if (!params.volumes || params.volumes.length === 0) {
    throw new Error("Adicione ao menos uma máquina ou volume para realizar a cotação.");
  }

  const totals = calculateFreightVolumesTotals(params.volumes);
  const hasLiveKey = Boolean(stored.apiKey && stored.apiKey.trim());
  const shouldUseLive =
    stored.settings.mode === "live" || (stored.settings.mode === "auto" && hasLiveKey);

  if (shouldUseLive && hasLiveKey) {
    try {
      const baseUrl = stored.settings.apiBaseUrl.endsWith("/")
        ? stored.settings.apiBaseUrl
        : `${stored.settings.apiBaseUrl}/`;

      const payload = {
        origin_zip_code: originZipDigits,
        destination_zip_code: destZipDigits,
        quoting_mode: "DYNAMIC_BOX_ALL_ITEMS",
        products: params.volumes.map((v, idx) => ({
          weight: Math.max(0.1, Number(v.weightKg) || 1),
          cost_of_goods: Math.max(1, Number(v.unitPrice) || 1),
          width: Math.max(1, Number(v.widthCm) || 10),
          height: Math.max(1, Number(v.heightCm) || 10),
          length: Math.max(1, Number(v.lengthCm) || 10),
          quantity: Math.max(1, Math.round(Number(v.quantity) || 1)),
          sku_id: v.sku?.trim() || v.productId || `MAQ-${idx + 1}`,
          product_category: v.category || "Maquinas Industriais",
          description: v.name,
        })),
        additional_information: {
          lead_time_business_days: Math.max(0, stored.settings.extraHandlingDays || 0),
          sales_channel: stored.settings.defaultSalesChannel || "Comercial B2B Máquinas",
          client_type: params.destination.recipientType === "cpf" ? "gold" : "b2b",
          is_state_tax_payer: params.destination.recipientType === "cnpj_contributor",
        },
        identification: {
          url: "https://tecfagchat.up.railway.app",
          ip: "127.0.0.1",
          session: `tecfag-crm-${Date.now()}`,
          page_name: "crm_deal_quote",
        },
      };

      const res = await fetch(`${baseUrl}quote_by_product`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "api-key": stored.apiKey!.trim(),
          platform: stored.settings.platformName || "Tecfag CRM",
        },
        body: JSON.stringify(payload),
        signal: params.signal,
      });

      const data = (await res.json().catch(() => null)) as Record<string, any> | null;
      if (!res.ok || !data || data.status === "ERROR") {
        const msg =
          data?.messages?.[0]?.text ||
          data?.messages?.[0]?.key ||
          `Retorno HTTP ${res.status} da API Intelipost.`;
        if (stored.settings.mode === "live") {
          throw new Error(`Falha na API Intelipost: ${msg}`);
        }
        const sim = buildSimulatedIndustrialOptions({
          destination: params.destination,
          volumes: params.volumes,
          settings: stored.settings,
        });
        return {
          quoteId: sim.quoteId,
          source: "simulation",
          origin,
          totals,
          options: sim.options,
          warningMessage: `A API Intelipost retornou um alerta (${msg}). Exibindo estimativa de contingência.`,
        };
      }

      const content = data.content || {};
      const quoteId = String(content.id || `IP-${Date.now().toString().slice(-6)}`);
      const rawDeliveryOptions = Array.isArray(content.delivery_options)
        ? content.delivery_options
        : [];

      const marginMultiplier =
        1 + Math.max(0, stored.settings.extraMarginPercent || 0) / 100;

      const options: FreightCarrierOption[] = rawDeliveryOptions.map(
        (opt: Record<string, any>, index: number) => {
          const providerCost = Number(opt.provider_shipping_cost ?? opt.final_shipping_cost ?? 0);
          const rawFinalCost = Number(opt.final_shipping_cost ?? providerCost);
          const finalShippingCost = Math.round(rawFinalCost * marginMultiplier * 100) / 100;
          const methodName = String(
            opt.delivery_method_name || opt.description || "Transportadora",
          );
          const providerName = String(opt.logistic_provider_name || methodName);
          const lower = `${methodName} ${providerName}`.toLowerCase();
          const deliveryMode: "rodoviario" | "expresso" | "aereo" = lower.includes("aéreo") ||
            lower.includes("aereo") ||
            lower.includes("air")
            ? "aereo"
            : lower.includes("expresso") || lower.includes("express") || lower.includes("urgente")
            ? "expresso"
            : "rodoviario";

          return {
            id: `ip-opt-${opt.delivery_method_id || index + 1}`,
            deliveryMethodId: Number(opt.delivery_method_id || index + 1),
            carrierName: providerName,
            serviceName: methodName,
            logisticProviderName: providerName,
            deliveryMode,
            deliveryEstimateBusinessDays: Math.max(
              1,
              Number(opt.delivery_estimate_business_days || 1),
            ),
            providerShippingCost: Math.round(providerCost * 100) / 100,
            finalShippingCost,
            description:
              typeof opt.delivery_note === "string" && opt.delivery_note.trim()
                ? opt.delivery_note
                : typeof opt.description === "string"
                ? opt.description
                : undefined,
            quoteId,
            source: "intelipost_live",
          };
        },
      );

      options.sort((a, b) => a.finalShippingCost - b.finalShippingCost);

      return {
        quoteId,
        source: "intelipost_live",
        origin,
        totals,
        options,
      };
    } catch (err: any) {
      if (stored.settings.mode === "live") {
        throw err;
      }
      const sim = buildSimulatedIndustrialOptions({
        destination: params.destination,
        volumes: params.volumes,
        settings: stored.settings,
      });
      return {
        quoteId: sim.quoteId,
        source: "simulation",
        origin,
        totals,
        options: sim.options,
        warningMessage:
          err?.message || "Não foi possível contatar a API Intelipost; exibindo simulação assistida.",
      };
    }
  }

  const sim = buildSimulatedIndustrialOptions({
    destination: params.destination,
    volumes: params.volumes,
    settings: stored.settings,
  });

  return {
    quoteId: sim.quoteId,
    source: "simulation",
    origin,
    totals,
    options: sim.options,
  };
}

export async function testIntelipostConnection(params: {
  tenantId: string;
  apiKey?: string;
  apiBaseUrl?: string;
  platformName?: string;
  originZipCode?: string;
}): Promise<{ ok: boolean; message: string; testedAt: string }> {
  const stored = await readIntelipostConfig(params.tenantId);
  const keyToUse = params.apiKey?.trim() || stored.apiKey?.trim();
  const testedAt = new Date().toISOString();

  if (!keyToUse) {
    return {
      ok: false,
      message:
        "Nenhuma API Key da Intelipost foi informada. O sistema permanece operando em Modo de Simulação Assistida até o cadastro da chave.",
      testedAt,
    };
  }

  const rawBase = params.apiBaseUrl?.trim() || stored.settings.apiBaseUrl;
  const baseUrl = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  const originDigits =
    normalizeZipDigits(params.originZipCode) ||
    normalizeZipDigits(stored.settings.origin.zipCode) ||
    "17064857";

  try {
    const res = await fetch(`${baseUrl}quote_by_product`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": keyToUse,
        platform: params.platformName || stored.settings.platformName || "Tecfag CRM",
      },
      body: JSON.stringify({
        origin_zip_code: originDigits,
        destination_zip_code: "01310100",
        quoting_mode: "DYNAMIC_BOX_ALL_ITEMS",
        products: [
          {
            weight: 25,
            cost_of_goods: 4500,
            width: 50,
            height: 60,
            length: 50,
            quantity: 1,
            sku_id: "TEST-TECFAG-01",
            product_category: "Maquinas Industriais",
          },
        ],
      }),
    });

    const data = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (res.ok && data && data.status !== "ERROR") {
      const count = Array.isArray(data.content?.delivery_options)
        ? data.content.delivery_options.length
        : 0;
      return {
        ok: true,
        message: `Conexão homologada com sucesso na Intelipost (${count} opções de frete retornadas a partir do CEP ${normalizeZipCode(originDigits)}).`,
        testedAt,
      };
    }

    const apiError =
      data?.messages?.[0]?.text ||
      data?.messages?.[0]?.key ||
      `HTTP ${res.status}`;
    return {
      ok: false,
      message: `A Intelipost recusou a requisição: ${apiError}. Verifique se a api-key está ativa.`,
      testedAt,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `Erro de rede ao conectar na Intelipost: ${err?.message || "Falha desconhecida"}`,
      testedAt,
    };
  }
}

export async function getSavedDealFreightQuotes(
  tenantId: string,
  dealId: string,
): Promise<SavedDealFreightQuote[]> {
  const rowId = `ipquotes-${dealId}`;
  const [row] = await db
    .select({ config: agentConfigs.config })
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.id, rowId),
        eq(agentConfigs.tenantId, tenantId),
        eq(agentConfigs.agentType, INTELIPOST_DEAL_QUOTES_AGENT_TYPE),
      ),
    )
    .limit(1);

  if (!row) return [];
  const cfg = (row.config || {}) as Record<string, unknown>;
  const rawList = cfg.quotes;
  if (!Array.isArray(rawList)) return [];
  return rawList as SavedDealFreightQuote[];
}

export async function saveDealFreightQuote(params: {
  tenantId: string;
  dealId: string;
  quote: SavedDealFreightQuote;
}): Promise<SavedDealFreightQuote[]> {
  const [deal] = await db
    .select({ id: crmDeals.id })
    .from(crmDeals)
    .where(and(eq(crmDeals.id, params.dealId), eq(crmDeals.tenantId, params.tenantId)))
    .limit(1);

  if (!deal) {
    throw new Error("Negociação não encontrada.");
  }

  const existing = await getSavedDealFreightQuotes(params.tenantId, params.dealId);
  const updated = [params.quote, ...existing.filter((q) => q.id !== params.quote.id)].slice(0, 30);
  const rowId = `ipquotes-${params.dealId}`;

  const [existingRow] = await db
    .select({ id: agentConfigs.id })
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.id, rowId),
        eq(agentConfigs.tenantId, params.tenantId),
      ),
    )
    .limit(1);

  if (existingRow) {
    await db
      .update(agentConfigs)
      .set({
        config: { dealId: params.dealId, quotes: updated },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentConfigs.id, rowId),
          eq(agentConfigs.tenantId, params.tenantId),
        ),
      );
  } else {
    await db.insert(agentConfigs).values({
      id: rowId,
      tenantId: params.tenantId,
      agentType: INTELIPOST_DEAL_QUOTES_AGENT_TYPE,
      enabled: 1,
      config: { dealId: params.dealId, quotes: updated },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return updated;
}

export async function deleteDealFreightQuote(params: {
  tenantId: string;
  dealId: string;
  quoteId: string;
}): Promise<SavedDealFreightQuote[]> {
  const existing = await getSavedDealFreightQuotes(params.tenantId, params.dealId);
  const updated = existing.filter((q) => q.id !== params.quoteId);
  const rowId = `ipquotes-${params.dealId}`;

  await db
    .update(agentConfigs)
    .set({
      config: { dealId: params.dealId, quotes: updated },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentConfigs.id, rowId),
        eq(agentConfigs.tenantId, params.tenantId),
        eq(agentConfigs.agentType, INTELIPOST_DEAL_QUOTES_AGENT_TYPE),
      ),
    );

  return updated;
}
