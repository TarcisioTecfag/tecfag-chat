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
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (!v || v.toLowerCase() === "null" ? null : v));

const directOperatorIntentSet = new Set([
  "direct_transfer",
  "past_reference_only",
  "ambiguous_homonym",
  "not_found",
]);

const directOperatorRequestSchema = z
  .object({
    intent: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((v) =>
        v && directOperatorIntentSet.has(v)
          ? (v as "direct_transfer" | "past_reference_only" | "ambiguous_homonym" | "not_found")
          : null,
      ),
    citedName: nullableTrimmedString(160),
    matchedOperatorId: nullableTrimmedString(160),
    matchedOperatorName: nullableTrimmedString(160),
  })
  .nullable()
  .optional()
  .default(null);

const schema = z.object({
  subflow: z
    .string()
    .refine((value) => Object.hasOwn(INDUSTRIAL_ROUTES, value))
    .nullable()
    .optional(),
  extractedData: z
    .record(z.string().max(4000))
    .default({})
    .transform((fields) =>
      Object.fromEntries(Object.entries(fields).filter(([key]) => fieldNames.has(key))),
    ),
  funnelStage: z.string().max(80).nullable().optional(),
  targetFunnel: z.string().max(120).nullable().optional(),
  messagesToSend: z.array(z.string().trim().min(1).max(2000)).min(1).max(8),
  // Uma resposta do LLM não autoriza um provedor de áudio.
  audioMessage: z
    .unknown()
    .optional()
    .transform(() => null),
  quoteMessageId: z.string().max(250).nullable().optional(),
  mediaDescription: z.string().max(8000).nullable().optional(),
  directOperatorRequest: directOperatorRequestSchema,
  isCompleted: z.boolean().default(false),
});

export function parseIndustrialAiResult(value: unknown) {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
