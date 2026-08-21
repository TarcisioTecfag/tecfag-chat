// ══════════════════════════════════════════════════════════════════════════════
// 🛒 TRAY CHECKOUT SERVICE
// Gera links de checkout pré-montados para a loja Tray Commerce.
// Sem cupom de desconto (decisão de negócio 20/08/2026).
// ══════════════════════════════════════════════════════════════════════════════

export interface CheckoutItem {
  productId: number;
  variantId?: number;
  quantity: number;
}

/**
 * Gera URL de checkout pré-montado da Tray com produto e quantidade.
 * O visitante é direcionado direto para o carrinho com os itens já preenchidos.
 *
 * Formato Tray: https://{loja}/carrinho/?product_id={id}&quantity={qtd}
 * Para múltiplos produtos: adiciona &product_id[]={id}&quantity[]={qtd}
 */
export function buildCheckoutUrl(
  storeBaseUrl: string,
  items: CheckoutItem[],
  utmSource = "valem-chat",
  utmMedium = "livechat",
  utmCampaign = "valentina-site"
): string {
  const base = storeBaseUrl.replace(/\/web_api$/, ""); // remove /web_api se presente
  const cartPath = `${base}/carrinho/`;

  const params = new URLSearchParams();

  if (items.length === 1) {
    params.set("product_id", String(items[0].productId));
    params.set("quantity", String(items[0].quantity));
    if (items[0].variantId) {
      params.set("variant_id", String(items[0].variantId));
    }
  } else {
    items.forEach((item) => {
      params.append("product_id[]", String(item.productId));
      params.append("quantity[]", String(item.quantity));
      if (item.variantId) {
        params.append("variant_id[]", String(item.variantId));
      }
    });
  }

  // UTM para rastrear origem do chat
  params.set("utm_source", utmSource);
  params.set("utm_medium", utmMedium);
  params.set("utm_campaign", utmCampaign);

  return `${cartPath}?${params.toString()}`;
}

/**
 * Formata um link de checkout como mensagem amigável da Valentina.
 * Ex: "🛒 Adicionei o produto no seu carrinho! Clique para finalizar:"
 */
export function buildCheckoutMessage(checkoutUrl: string, productName: string): string {
  return [
    `🛒 Preparei o carrinho para você com **${productName}**!`,
    ``,
    `Clique no link abaixo para finalizar seu pedido:`,
    `👉 ${checkoutUrl}`,
    ``,
    `Se tiver dúvidas sobre frete, prazo ou forma de pagamento, é só perguntar! 😊`,
  ].join("\n");
}