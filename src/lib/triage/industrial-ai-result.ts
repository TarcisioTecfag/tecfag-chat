import { z } from "zod";
import { INDUSTRIAL_ROUTES } from "./industrial-policy.ts";
import type { IndustrialMessageQuote, IndustrialQuoteReason } from "./industrial-citations.ts";

const fieldNames = new Set([
  "NOME COMPLETO",
  "EMPRESA",
  "CNPJ OU CPF",
  "CNPJ",
  "CPF",
  "EMAIL",
  "RAMO / O QUE EMBALA",
  "MÁQUINA / PEÇA / INTERESSE",
  "VOLUME / PRODUÇÃO",
  "SETOR / FUNIL DE DESTINO",
  "SOLICITAÇÃO",
  "MODELO DA MÁQUINA",
  "NÚMERO DO PEDIDO",
]);

const nullableTrimmedString = (max: number) =>
  z
    .unknown()
    .transform((raw) => {
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none") {
        return null;
      }
      return trimmed.slice(0, max);
    });

const directOperatorIntentSet = new Set([
  "direct_transfer",
  "confirm_absent_transfer",
  "offer_transfer",
  "past_reference_only",
  "ambiguous_homonym",
  "not_found",
]);

const directOperatorRequestSchema = z
  .unknown()
  .transform((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const rawIntent = typeof obj.intent === "string" ? obj.intent.trim() : "";
    const intent = directOperatorIntentSet.has(rawIntent)
      ? (rawIntent as
          | "direct_transfer"
          | "confirm_absent_transfer"
          | "offer_transfer"
          | "past_reference_only"
          | "ambiguous_homonym"
          | "not_found")
      : null;
    const cleanStr = (v: unknown, max: number) => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      if (!t || t.toLowerCase() === "null") return null;
      return t.slice(0, max);
    };
    return {
      intent,
      citedName: cleanStr(obj.citedName, 160),
      matchedOperatorId: cleanStr(obj.matchedOperatorId, 160),
      matchedOperatorName: cleanStr(obj.matchedOperatorName, 160),
    };
  });

function normalizeSubflow(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none") {
    return null;
  }
  if (Object.hasOwn(INDUSTRIAL_ROUTES, trimmed)) return trimmed;
  const upper = trimmed.toUpperCase();
  if (Object.hasOwn(INDUSTRIAL_ROUTES, upper)) return upper;
  return null;
}

function normalizeExtractedData(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!fieldNames.has(key)) continue;
    if (val === null || val === undefined) continue;
    let strVal: string | null = null;
    if (typeof val === "string") {
      strVal = val.trim();
    } else if (typeof val === "number" || typeof val === "boolean") {
      strVal = String(val).trim();
    } else if (typeof val === "object" && !Array.isArray(val)) {
      const nested = (val as Record<string, unknown>).value;
      if (typeof nested === "string" || typeof nested === "number") {
        strVal = String(nested).trim();
      }
    }
    if (!strVal) continue;
    const lower = strVal.toLowerCase();
    if (lower === "null" || lower === "undefined" || lower === "não informado") continue;
    result[key] = strVal.slice(0, 4000);
  }
  return result;
}

function normalizeMessagesToSend(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return list
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 2000))
    .filter((item) => item.length > 0)
    .slice(0, 8);
}

const siteMigrationIntentSet = new Set([
  "offer_whatsapp",
  "confirm_whatsapp",
  "decline_stay_site",
  "insist_phone_call",
]);

const siteWhatsappMigrationSchema = z
  .unknown()
  .optional()
  .transform((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const rawIntent = typeof obj.intent === "string" ? obj.intent.trim() : "";
    const intent = siteMigrationIntentSet.has(rawIntent)
      ? (rawIntent as
          | "offer_whatsapp"
          | "confirm_whatsapp"
          | "decline_stay_site"
          | "insist_phone_call")
      : null;
    const rawPhone = typeof obj.providedPhone === "string" ? obj.providedPhone.trim() : "";
    const providedPhone =
      rawPhone && rawPhone.toLowerCase() !== "null" ? rawPhone.slice(0, 40) : null;
    if (!intent && !providedPhone) return null;
    return {
      intent,
      providedPhone,
    };
  });

const quoteReasonSet = new Set<IndustrialQuoteReason>([
  "unanswered_question",
  "client_question",
  "client_media",
]);

function normalizeMessageQuotes(raw: unknown): IndustrialMessageQuote[] {
  if (!Array.isArray(raw)) return [];
  const results: IndustrialMessageQuote[] = [];
  const seenIndices = new Set<number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const rawIdx =
      typeof obj.messageIndex === "number"
        ? obj.messageIndex
        : typeof obj.messageIndex === "string" && /^\d+$/.test(obj.messageIndex.trim())
          ? Number.parseInt(obj.messageIndex.trim(), 10)
          : NaN;
    if (!Number.isInteger(rawIdx) || rawIdx < 0 || rawIdx >= 8) continue;
    if (seenIndices.has(rawIdx)) continue;
    const rawId = typeof obj.quoteMessageId === "string" ? obj.quoteMessageId.trim() : "";
    if (!rawId || rawId.toLowerCase() === "null" || rawId.toLowerCase() === "none") continue;
    const rawReason = typeof obj.reason === "string" ? obj.reason.trim() : "";
    const reason = quoteReasonSet.has(rawReason as IndustrialQuoteReason)
      ? (rawReason as IndustrialQuoteReason)
      : null;
    seenIndices.add(rawIdx);
    results.push({
      messageIndex: rawIdx,
      quoteMessageId: rawId.slice(0, 250),
      reason,
    });
    if (results.length >= 3) break;
  }
  return results;
}

const schema = z.object({
  subflow: z.unknown().transform(normalizeSubflow),
  extractedData: z.unknown().transform(normalizeExtractedData),
  funnelStage: nullableTrimmedString(80),
  targetFunnel: nullableTrimmedString(120),
  messagesToSend: z
    .unknown()
    .transform(normalizeMessagesToSend)
    .refine((arr) => arr.length >= 1, { message: "messagesToSend vazio após normalização" }),
  // Uma resposta do LLM não autoriza um provedor de áudio.
  audioMessage: z
    .unknown()
    .optional()
    .transform(() => null),
  quoteMessageId: nullableTrimmedString(250),
  messageQuotes: z.unknown().optional().transform(normalizeMessageQuotes),
  mediaDescription: nullableTrimmedString(8000),
  directOperatorRequest: directOperatorRequestSchema,
  siteWhatsappMigration: siteWhatsappMigrationSchema,
  escalateToHumanReview: z
    .unknown()
    .optional()
    .transform((v) => v === true || v === "true")
    .default(false),
  escalationReason: nullableTrimmedString(120).optional().default(null),
  isCompleted: z
    .unknown()
    .transform((v) => v === true || v === "true")
    .default(false),
});

export function parseIndustrialAiResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.warn(
      "[parseIndustrialAiResult] Falha ao validar JSON da IA:",
      JSON.stringify(parsed.error.issues),
      "keys:",
      Object.keys(value as Record<string, unknown>).join(","),
    );
    return null;
  }
  return parsed.data;
}
