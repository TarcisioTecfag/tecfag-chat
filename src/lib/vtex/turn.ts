import { readSiteContext } from "../livechat/site-context.ts";
import { resolveIndustrialRoute, requestsHuman } from "../triage/industrial-policy.ts";
import { type VtexQuery, type VtexResult, type VtexChannel, plainText } from "./contract.ts";
export function deriveVtexQuery(
  text: string,
  siteContext: unknown,
  previous?: { selectedSkuId?: string | null; status?: string },
) {
  if (requestsHuman(text)) return null;
  const route = resolveIndustrialRoute({ text, collectedData: {} });
  if (["financeiro", "assistencia_tecnica", "pos_venda"].includes(route.funnelStage)) return null;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const shipping = /\b(?:frete|prazo de entrega|cep|entrega para)\b/.test(normalized);
  const price = /\b(?:preco|valor|quanto custa|custa quanto)\b/.test(normalized);
  const availability = /\b(?:estoque|disponibilidade|disponivel|pronta entrega)\b/.test(normalized);
  const detail =
    availability ||
    /\b(?:especificac|ficha tecnica|informacoes sobre|medidas|dimensoes|potencia|voltagem|sku)\w*/.test(
      normalized,
    );
  const postal = text.match(/\b\d{5}-?\d{3}\b/)?.[0];
  const sku =
    text.match(/\bsku\s*[:#-]?\s*(\d{1,20})\b/i)?.[1] ||
    (previous?.status === "choices" ? text.match(/^\s*(\d{1,20})\s*$/)?.[1] : undefined);
  const url = text.match(/https:\/\/[^\s<>"']+/i)?.[0]?.replace(/[).,;]+$/, "");
  const postalReply = postal && previous?.selectedSkuId && /^\s*\d{5}-?\d{3}[.!]?\s*$/.test(text);
  if (!shipping && !price && !detail && !sku && !url && !postalReply) return null;
  const product = readSiteContext(siteContext)?.product;
  let query: VtexQuery | null = sku
    ? { kind: "sku", value: sku, quantity: 1 }
    : url
      ? { kind: "url", value: url, quantity: 1 }
      : null;
  // Um produto novo nomeado na mensagem não pode herdar silenciosamente o SKU anterior.
  const named = text
    .match(
      /(?:pre[cç]o|valor|quanto custa|especifica[cç][oõ]es|ficha t[eé]cnica)\s+(?:d[aoe]\s+|sobre\s+)?(.+)/i,
    )?.[1]
    ?.replace(/[?!.]+$/g, "")
    .trim();
  const generic =
    !named ||
    /^(?:d?esse|d?este|d?essa|d?esta|o|a)?\s*(?:produto|modelo|item|maquina)?$/i.test(named);
  if (!query && named && !generic && named.length >= 3 && named.length <= 120)
    query = { kind: "term", value: named, quantity: 1 };
  const changingProduct = /\b(?:outro|outra|diferente|mudar|trocar de modelo)\b/.test(normalized);
  if (
    !query &&
    !changingProduct &&
    product &&
    normalized.includes(
      product.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    )
  )
    query = { kind: "url", value: product.url, quantity: 1 };
  if (!query && !changingProduct && previous?.selectedSkuId)
    query = { kind: "sku", value: previous.selectedSkuId, quantity: 1 };
  if (!query && !changingProduct && product)
    query = { kind: "url", value: product.url, quantity: 1 };
  return {
    query: query
      ? {
          ...query,
          ...(postal ? { postalCode: postal } : {}),
          quantity: Number(normalized.match(/\b(\d{1,3})\s*(?:unidades?|pecas?)\b/)?.[1] || 1),
        }
      : null,
    intent:
      shipping || postalReply
        ? ("shipping" as const)
        : price
          ? ("price" as const)
          : ("details" as const),
  };
}
const money = (value: number) =>
  (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function formatVtexEstimate(value: string) {
  const match = value.match(/^(\d+)(bd|d|h|m)$/i);
  if (!match) return plainText(value, 80);
  const amount = Number(match[1]),
    units: Record<string, [string, string]> = {
      bd: ["dia útil", "dias úteis"],
      d: ["dia corrido", "dias corridos"],
      h: ["hora", "horas"],
      m: ["minuto", "minutos"],
    };
  return `${amount} ${units[match[2].toLowerCase()][amount === 1 ? 0 : 1]}`;
}
export function formatVtexAnswer(
  result: VtexResult,
  intent: "price" | "shipping" | "details",
): string[] {
  if (result.status === "policy_blocked")
    return [
      "A consulta da loja não está liberada neste canal. A equipe responsável pode ajudar com seu atendimento.",
    ];
  if (result.status === "unavailable")
    return [
      "Não consegui confirmar os dados na loja agora. A equipe responsável pode conferir essa informação; não vou estimar preço ou prazo.",
    ];
  if (result.status === "not_found")
    return [
      "Não localizei uma referência correspondente na loja. Pode enviar o link do produto ou o SKU?",
    ];
  if (result.status === "choices")
    return [
      "Preciso confirmar o produto e a variante antes de consultar os valores. Qual destas opções você deseja?\n" +
        result.products
          .flatMap((product) =>
            product.skus.map(
              (sku) => `${product.name} — ${sku.name || "Variante"} — SKU ${sku.id}`,
            ),
          )
          .slice(0, 12)
          .join("\n"),
    ];
  const product = result.products[0],
    sku = product?.skus.find((item) => item.id === result.selectedSkuId);
  if (!product || !sku) return ["Pode confirmar o SKU ou o link do produto?"];
  const checkedAt = new Date(result.checkedAt).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const lines = [`${product.name}${sku.name ? ` — ${sku.name}` : ""} (SKU ${sku.id})`];
  if (intent === "price")
    lines.push(
      sku.priceCents !== null
        ? `Preço público consultado: ${money(sku.priceCents)} por unidade.`
        : "Não há preço público confirmado nesta consulta. A equipe pode verificar o orçamento.",
    );
  if (intent === "details") {
    if (product.description) lines.push(product.description.slice(0, 1000));
    for (const [key, value] of Object.entries(product.specifications).slice(0, 8))
      lines.push(`${key}: ${value}`);
  }
  if (sku.available !== null)
    lines.push(
      sku.available
        ? "Consta disponível nesta consulta, sujeito à confirmação da loja."
        : "Não consta disponível para o vendedor configurado nesta consulta.",
    );
  if (intent === "shipping") {
    if (result.shippingStatus === "needs_postal_code")
      lines.push("Qual é o CEP de destino para consultar o frete?");
    else if (result.shippingStatus === "available") {
      lines.push(`Simulação pública para ${result.quantity} unidade(s):`);
      for (const option of result.shipping)
        lines.push(
          `${option.name}: ${money(option.priceCents)}${option.estimate ? `; prazo informado pela loja: ${formatVtexEstimate(option.estimate)}` : ""}.`,
        );
      lines.push("O prazo e o valor precisam ser confirmados pela loja no fechamento.");
    } else
      lines.push(
        "Não obtive uma opção de entrega confirmada para essa consulta. A equipe pode conferir o frete.",
      );
  }
  lines.push(
    `Fonte: ${product.url}`,
    `Consulta em ${checkedAt} (Brasília). Não representa reserva ou pedido confirmado.`,
  );
  return [lines.join("\n")];
}
export function blockedVtexAnswer(channel: VtexChannel, intent: "price" | "shipping" | "details") {
  return intent === "details"
    ? "A consulta de especificações não está liberada neste canal. A equipe responsável pode conferir."
    : `Neste ${channel === "whatsapp" ? "WhatsApp" : "canal"}, a equipe responsável confirma ${intent === "price" ? "os valores" : "o frete e o prazo"}. Posso continuar com as informações técnicas e o encaminhamento.`;
}
/** Valores comerciais só podem vir de um balão composto pelo servidor com consulta atual. */
export function guardVtexMessages(messages: string[], allowed: readonly string[] = []) {
  const commercial =
    /R\$|\breais\b|\b(?:custa|custam|desconto)\b|\b(?:pre[cç]o|valor)\b.{0,40}\d|\bfrete\s+gr[aá]tis|\b(?:temos|tem|h[aá]|est[aá]|produto)\b.{0,25}\b(?:estoque|dispon[ií]vel|pronta entrega)\b|\b(?:entrega|chega|prazo)\b.{0,30}(?:\d+\s*(?:dias?|horas?|h\b|bd\b)|amanh[aã]|hoje|semana)/i;
  return [
    ...new Set(
      messages.map((message) =>
        commercial.test(message) && !allowed.includes(message)
          ? "Preço, disponibilidade e prazo precisam ser confirmados na consulta da loja ou pela equipe responsável."
          : message,
      ),
    ),
  ];
}
export function safeVtexEvidence(result: VtexResult | null) {
  if (!result) return null;
  return {
    source: "vtex" as const,
    status: result.status,
    checkedAt: result.checkedAt,
    channel: result.channel,
    selectedSkuId: result.selectedSkuId,
    productName: plainText(result.products[0]?.name, 300),
    productUrl: result.products[0]?.url || null,
    shippingStatus: result.shippingStatus,
    diagnostic: result.diagnostic || null,
  };
}
