import { readSiteContext } from "../livechat/site-context.ts";
import { resolveIndustrialRoute, requestsHuman } from "../triage/industrial-policy.ts";
import {
  type VtexQuery,
  type VtexProduct,
  type VtexResult,
  type VtexChannel,
  plainText,
  smartTruncate,
} from "./contract.ts";
const NON_STORE_URL_HOST_PATTERN =
  /(?:^|\.)(?:instagram\.com|facebook\.com|fb\.com|fb\.watch|youtube\.com|youtu\.be|tiktok\.com|wa\.me|whatsapp\.com|linkedin\.com|twitter\.com|x\.com|google\.com(?:\.br)?|goo\.gl|maps\.app\.goo\.gl|mercadolivre\.com\.br|shopee\.com\.br|bit\.ly|linktr\.ee|t\.me)$/i;

const KNOWN_STORE_URL_HOST_PATTERN =
  /(?:^|\.)(?:tecfag\.com\.br|lojatecfag\.com\.br|vtexcommercestable\.com\.br)$/i;

function extractStoreProductUrl(text: string, siteContext: unknown): string | undefined {
  const matches = text.match(/https:\/\/[^\s<>"']+/gi) || [];
  if (matches.length === 0) return undefined;
  const ctx = readSiteContext(siteContext);
  let contextOrigin: string | null = null;
  for (const candidate of [ctx?.product?.url, ctx?.page?.url]) {
    if (!candidate) continue;
    try {
      contextOrigin = new URL(candidate).origin;
      break;
    } catch {
      /* ignore invalid context URL */
    }
  }
  for (const raw of matches) {
    const cleaned = raw.replace(/[).,;]+$/, "");
    try {
      const parsed = new URL(cleaned);
      if (NON_STORE_URL_HOST_PATTERN.test(parsed.hostname)) continue;
      if (
        (contextOrigin && parsed.origin === contextOrigin) ||
        KNOWN_STORE_URL_HOST_PATTERN.test(parsed.hostname) ||
        /\/p(?:\/|$)/i.test(parsed.pathname)
      ) {
        return cleaned;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractSkuIdFromStoreUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const parsed = new URL(rawUrl);
    const idsku = parsed.searchParams.get("idsku") || parsed.searchParams.get("skuId");
    return idsku && /^\d{1,10}$/.test(idsku.trim()) ? idsku.trim() : undefined;
  } catch {
    return undefined;
  }
}

const PURE_BRAZILIAN_DOCUMENT_PATTERN =
  /^\s*(?:(?:meu\s+|numero\s+d[eo]\s+)?(?:cpf|cnpj)\s*[:#-]?\s*)?(?:\d{11}|\d{14}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s*[.!]?\s*$/i;

export function deriveVtexQuery(
  text: string,
  siteContext: unknown,
  previous?: { selectedSkuId?: string | null; status?: string },
) {
  if (requestsHuman(text)) return null;
  // CPF (11 dígitos) ou CNPJ (14 dígitos) nunca devem ser interpretados como SKU/consulta de loja.
  if (PURE_BRAZILIAN_DOCUMENT_PATTERN.test(text)) return null;
  const route = resolveIndustrialRoute({ text, collectedData: {} });
  if (["financeiro", "assistencia_tecnica", "pos_venda"].includes(route.funnelStage)) return null;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const shipping = /\b(?:frete|prazo de entrega|cep|entrega para)\b/.test(normalized);
  const price = /\b(?:preco|valor|quanto custa|custa quanto)\b/.test(normalized);
  const availability = /\b(?:estoque|disponibilidade|disponivel|pronta entrega)\b/.test(normalized);
  const product = readSiteContext(siteContext)?.product;
  const postal = text.match(/\b\d{5}-?\d{3}\b/)?.[0];
  // Escolha numérica após `choices` aceita apenas SKUs curtos (1 a 7 dígitos), nunca CEP (8), CPF (11) ou CNPJ (14).
  const sku =
    text.match(/\bsku\s*[:#-]?\s*(\d{1,10})\b/i)?.[1] ||
    (previous?.status === "choices" ? text.match(/^\s*(\d{1,7})\s*$/)?.[1] : undefined);
  const url = extractStoreProductUrl(text, siteContext);
  const postalReply = postal && previous?.selectedSkuId && /^\s*\d{5}-?\d{3}[.!]?\s*$/.test(text);
  const hasStoreContext = Boolean(product || sku || url || previous?.selectedSkuId);
  // Extrai possível produto/modelo explicitamente nomeado antes de decidir se termos técnicos ativam a loja.
  const named = text
    .match(
      /(?:pre[cç]o|valor|quanto custa|especifica[cç][oõ]es|ficha t[eé]cnica)\s+(?:d[aoe]\s+|sobre\s+)?(.+)/i,
    )?.[1]
    ?.replace(/[?!.]+$/g, "")
    .trim();
  const normalizedNamed = named
    ? named
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
    : "";
  const isCommercialPaymentTerm =
    Boolean(normalizedNamed) &&
    /^(?:(?:o|a|os|as|no|na|nos|nas|em|de|do|da|dos|das|para|pra|com|sem|pelo|pela)\s+)*(?:pix|a\s*vista|avista|cartao(?:\s+de\s+credito)?|credito|debito|boleto|parcela(?:do|mento|s)?|\d+x(?:\s+sem\s+juros)?|juros|entrada|financiamento|desconto|promocao|oferta|black\s*friday|frete|entrega|prazo|proposta|orcamento|cotacao|negociacao|condic(?:ao|oes)|pagamento|compra|venda|envio|retirada|estoque|disponibilidade)(?:\s+(?:sem\s+juros|no\s+pix|a\s*vista|no\s+cartao|no\s+boleto|de\s+black\s*friday|com\s+desconto|em\s+\d+x))*$/i.test(
      normalizedNamed,
    );
  const generic =
    !normalizedNamed ||
    isCommercialPaymentTerm ||
    /^(?:(?:d?ess[ea]s?|d?est[ea]s?|aquel[ea]s?|o|a|os|as|n?ess[ea]s?|n?est[ea]s?)\s+)*(?:produto|modelo|item|m[aá]quina|equipamento|seladora|envasadora|dosadora)?s?(?:\s*(?:acima|abaixo|anterior(?:es)?|citad[oa]s?|mencionad[oa]s?|informad[oa]s?|enviad[oa]s?|descrit[oa]s?|pedid[oa]s?|solicitad[oa]s?|aqui|dela|dele|deles|delas))*$/i.test(
      normalizedNamed,
    ) ||
    /^(?:acima|abaixo|anterior(?:es)?|citad[oa]s?|mencionad[oa]s?|informad[oa]s?|enviad[oa]s?|descrit[oa]s?|pedid[oa]s?|solicitad[oa]s?|aqui|dela|dele|deles|delas)$/i.test(
      normalizedNamed,
    );
  const hasNamedProduct = Boolean(named && !generic && named.length >= 3 && named.length <= 120);
  const detail =
    (hasStoreContext && availability) ||
    (hasNamedProduct &&
      /\b(?:especificac|ficha tecnica|medidas|dimensoes|potencia|voltagem)\w*/.test(normalized)) ||
    (hasStoreContext &&
      /\b(?:especificac|ficha tecnica|medidas|dimensoes|potencia|voltagem|sku|informacoes sobre)\w*/.test(
        normalized,
      ));
  if (!shipping && !price && !detail && !sku && !url && !postalReply) return null;
  const urlSkuId = extractSkuIdFromStoreUrl(url);
  let query: VtexQuery | null = sku
    ? { kind: "sku", value: sku, quantity: 1 }
    : url
      ? { kind: "url", value: url, ...(urlSkuId ? { skuId: urlSkuId } : {}), quantity: 1 }
      : null;
  // Um produto novo nomeado na mensagem não pode herdar silenciosamente o SKU anterior.
  if (!query && hasNamedProduct && named)
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
const normalizeVtexCompare = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const isDescriptionSpecKey = (key: string) =>
  /^(?:descricao(?:\s+do\s+produto|\s+geral|\s+tecnica)?|sobre\s+o\s+produto)$/i.test(
    normalizeVtexCompare(key),
  );

const isPlaceholderSpecValue = (value: string) =>
  /^(?:[-–—.]+|n\/a|nao\s+informado|indisponivel|null|undefined)$/i.test(
    normalizeVtexCompare(value),
  );

function selectCleanVtexDetails(product: VtexProduct): {
  description: string;
  specifications: Array<[string, string]>;
} {
  const entries = Object.entries(product.specifications || {});
  let description = plainText(product.description, 2500);
  if (!description) {
    const descSpec = entries.find(([key, val]) => isDescriptionSpecKey(key) && val?.trim());
    if (descSpec) description = plainText(descSpec[1], 2500);
  }
  const normalizedDesc = normalizeVtexCompare(description);
  const seenKeys = new Set<string>();
  const specifications: Array<[string, string]> = [];

  for (const [rawKey, rawValue] of entries) {
    const key = plainText(rawKey, 100);
    const value = plainText(rawValue, 1000);
    if (!key || !value || isPlaceholderSpecValue(value)) continue;
    const normKey = normalizeVtexCompare(key);
    if (seenKeys.has(normKey)) continue;
    if (description && isDescriptionSpecKey(key)) continue;
    const normVal = normalizeVtexCompare(value);
    if (normalizedDesc && normVal.length >= 40) {
      const probe = normVal.slice(0, Math.min(80, normVal.length));
      if (normalizedDesc.includes(probe)) continue;
    }
    seenKeys.add(normKey);
    specifications.push([key, value]);
  }

  return { description, specifications };
}

export function formatVtexAiContext(
  result: VtexResult,
  channel: VtexChannel = "whatsapp",
): string | null {
  if (
    result.status !== "matched" &&
    !(result.status === "choices" && result.products.length === 1)
  ) {
    return null;
  }
  const product = result.products[0];
  if (!product) return null;

  const selectedSku = result.selectedSkuId
    ? product.skus.find((item) => item.id === result.selectedSkuId) || null
    : null;
  const { description, specifications } = selectCleanVtexDetails(product);

  const lines: string[] = [
    "🛒 PRODUTO CONSULTADO NA LOJA OFICIAL VTEX (DADOS OFICIAIS LIMPOS DESTE TURNO):",
    `- Nome oficial: ${product.name}`,
  ];
  if (selectedSku) {
    lines.push(
      `- Variante/SKU: ${selectedSku.name ? `${selectedSku.name} ` : ""}(SKU ${selectedSku.id})${selectedSku.reference ? ` · Ref: ${selectedSku.reference}` : ""}`,
    );
  } else if (product.skus.length > 0) {
    const variants = product.skus
      .slice(0, 6)
      .map((item) => `${item.name || "Variante"} (SKU ${item.id})`)
      .join(" | ");
    lines.push(`- Variantes disponíveis na loja: ${variants}`);
  }
  lines.push(`- Link oficial: ${product.url}`);
  if (description) {
    lines.push(`- Resumo oficial do produto: ${smartTruncate(description, 600)}`);
  }
  if (specifications.length > 0) {
    lines.push("- Especificações técnicas oficiais:");
    let budget = 1400;
    for (const [key, value] of specifications.slice(0, 8)) {
      const compactVal = smartTruncate(value, 360);
      if (!compactVal || compactVal.length > budget) continue;
      lines.push(`  • ${key}: ${compactVal}`);
      budget -= compactVal.length;
    }
  }
  if (channel === "livechat") {
    lines.push(
      "DIRETRIZES OBRIGATÓRIAS PARA RESPONDER SOBRE ESTE PRODUTO NO CHAT DO SITE:",
      "- O visitante clicou/perguntou sobre este equipamento específico da loja oficial. Confirme o modelo pelo nome oficial e registre o equipamento em extractedData[\"MÁQUINA / PEÇA / INTERESSE\"].",
      "- Responda de forma CURTA, humana e escaneável (1 a 2 balões curtos; resumo técnico enxuto de no máximo ~350 a 450 caracteres — NUNCA despeje a ficha técnica inteira nem envie texto cortado com reticências).",
      "- Destaque apenas para que serve e 2 a 4 diferenciais/especificações principais (ou responda diretamente à dúvida do visitante). Se houver variantes de voltagem (ex.: 110V / 220V), mencione brevemente.",
      "- OBRIGATÓRIO: encerre o último balão com UMA pergunta consultiva curta e natural para continuar a triagem (ex.: o que vai embalar/processar e qual a produção aproximada por hora ou dia) — NUNCA devolva apenas a ficha do produto sem uma pergunta de continuidade.",
      "- NUNCA invente preço, desconto, prazo de entrega, frete ou disponibilidade em estoque — se o cliente quiser orçamento ou frete, informe que seguimos com a qualificação para a equipe confirmar ou que pode informar CEP/voltagem para consulta.",
    );
  } else {
    lines.push(
      "DIRETRIZES OBRIGATÓRIAS PARA RESPONDER SOBRE ESTE PRODUTO NO WHATSAPP:",
      "- O cliente consultou/enviou o link deste equipamento específico da loja oficial. Confirme o modelo pelo nome oficial e registre o equipamento em extractedData[\"MÁQUINA / PEÇA / INTERESSE\"].",
      "- Responda de forma CURTA, humana e escaneável para leitura no WhatsApp (1 a 2 balões curtos; resumo técnico enxuto de no máximo ~350 a 450 caracteres — NUNCA despeje a ficha técnica inteira nem envie paredão de texto).",
      "- Destaque apenas para que serve e 2 a 4 pontos-chave (ou responda exatamente o que o cliente perguntou). Se houver variantes (ex.: 220V / 380V), mencione brevemente.",
      "- Conduza naturalmente a próxima etapa da triagem consultiva (ex.: perguntar qual produto/carga vai embalar e a demanda aproximada, ou se deseja avançar para cotação), seguindo as regras normais de triagem.",
      "- NUNCA informe, estime ou invente preço, valor, desconto, prazo de entrega, frete ou disponibilidade em estoque no WhatsApp — informe que o especialista confirma valores e condições comerciais na proposta.",
    );
  }

  return lines.join("\n");
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
    const { description, specifications } = selectCleanVtexDetails(product);
    if (description) lines.push(smartTruncate(description, 320));
    let remainingSpecBudget = 750;
    for (const [key, value] of specifications.slice(0, 5)) {
      if (remainingSpecBudget <= 40) break;
      const maxVal = Math.min(220, remainingSpecBudget);
      const compact = smartTruncate(value, maxVal);
      if (!compact) continue;
      const line = `${key}: ${compact}`;
      lines.push(line);
      remainingSpecBudget -= line.length + 1;
    }
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
  const hardCommercial =
    /R\$|\breais\b|\b(?:custa|custam)\b|\b(?:pre[cç]o|valor)\b.{0,40}\d|\b(?:desconto\s+de\s+\d|\d+\s*%\s*(?:de\s+)?desconto|\bdesconto\b.{0,20}\d+\s*%)|\bfrete\s+gr[aá]tis|\b(?:entrega|chega|prazo)\b.{0,30}(?:\d+\s*(?:dias?|horas?|h\b|bd\b)|amanh[aã]|hoje|semana)/i;
  const stockClaim =
    /\b(?:temos|tem|h[aá]|est[aá]|produto)\b.{0,25}\b(?:estoque|dispon[ií]vel|pronta entrega)\b/i;
  const nonStockAvailability =
    /\b(?:n[aã]o\s+(?:tenho|temos|est[aá]|h[aá]|possuo|possu[ií]mos)\b.{0,35}\b(?:dispon[ií]vel|estoque|pronta entrega)|(?:foto|fotos|v[ií]deo|v[ií]deos|imagem|imagens|cat[aá]logo|manual|material|atendente|especialista|consultor|equipe)\b.{0,25}\bdispon[ií]vel|(?:equipe|especialista|consultor|setor)\b.{0,35}\b(?:confirma|verifica|confere|informa|passa|valida)\b.{0,35}\b(?:estoque|dispon[ií]vel|disponibilidade|pronta entrega|desconto|condi[cç][oõ]es))/i;

  const isUnauthorizedCommercial = (message: string) => {
    if (hardCommercial.test(message)) return true;
    if (stockClaim.test(message) && !nonStockAvailability.test(message)) return true;
    return false;
  };

  return [
    ...new Set(
      messages.map((message) =>
        isUnauthorizedCommercial(message) && !allowed.includes(message)
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
