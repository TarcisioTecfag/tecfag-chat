import type { IndustrialDatabase } from "../triage/industrial-rodizio-store";
import { readVtexConfig, credentialsForVtex } from "./store";
import { queryVtex } from "./client";
import { deriveVtexQuery, formatVtexAnswer, blockedVtexAnswer, safeVtexEvidence } from "./turn";
import type { VtexChannel } from "./contract";
export async function runVtexStoreTurn(
  database: IndustrialDatabase,
  tenantId: string,
  input: {
    text: string;
    channel: VtexChannel;
    siteContext: unknown;
    previous?: { selectedSkuId?: string | null; status?: string };
    signal?: AbortSignal;
    fetch?: typeof fetch;
  },
) {
  const request = deriveVtexQuery(input.text, input.siteContext, input.previous);
  if (!request) return null;
  const state = await readVtexConfig(database, tenantId);
  if (!state.settings.enabled || state.row?.enabled !== 1) return null;
  const policy = state.settings.channels[input.channel];
  if (
    !policy.catalog ||
    (request.intent === "price" && !policy.price) ||
    (request.intent === "shipping" && !policy.shipping)
  )
    return { messages: [blockedVtexAnswer(input.channel, request.intent)], evidence: null };
  if (!request.query)
    return {
      messages: [
        "Pode enviar o link do produto ou informar o SKU para eu consultar a referência correta?",
      ],
      evidence: null,
    };
  try {
    const result = await queryVtex(state.settings, request.query, input.channel, {
      signal: input.signal,
      fetch: input.fetch,
      intent: request.intent,
      shippingRequested: request.intent === "shipping",
      credentials: credentialsForVtex(tenantId, state),
    });
    return {
      messages: formatVtexAnswer(result, request.intent),
      evidence: safeVtexEvidence(result),
    };
  } catch {
    return {
      messages: [
        "A consulta da loja está indisponível agora. A equipe responsável pode conferir os dados.",
      ],
      evidence: null,
    };
  }
}
