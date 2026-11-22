import { z } from "zod";
import { INDUSTRIAL_ROUTES } from "./industrial-policy.ts";

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
      ? (rawIntent as "direct_transfer" | "past_reference_only" | "ambiguous_homonym" | "not_found")
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
  mediaDescription: nullableTrimmedString(8000),
  directOperatorRequest: directOperatorRequestSchema,
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
