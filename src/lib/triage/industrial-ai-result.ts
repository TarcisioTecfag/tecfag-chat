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
  isCompleted: z.boolean().default(false),
});

export function parseIndustrialAiResult(value: unknown) {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
