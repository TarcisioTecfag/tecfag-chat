/** Regras de triagem industrial compartilháveis por Site e WhatsApp. Sem IO. */
export const INDUSTRIAL_POLICY_VERSION = "industrial-v3";
export const INDUSTRIAL_REVIEW_FUNNEL = "Análise e revisão humana";
export const INDUSTRIAL_CURRICULUM_SOLIDES_URL = "https://grupotecfag.vagas.solides.com.br";
export const INDUSTRIAL_SUPPLIERS_EMAIL = "adm@tecfag.com.br";
export type TriageStage =
  | "triagem"
  | "assistencia_tecnica"
  | "pos_venda"
  | "maquinas"
  | "personalite"
  | "financeiro"
  | "pecas"
  | "outros"
  | "sem_resposta";
export type CollectedFields = Record<string, { value?: string; status?: string }>;

export const INDUSTRIAL_ROUTES = {
  MAQUINAS: {
    stage: "maquinas",
    funnel: "Máquinas",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request", "application", "production"],
  },
  PERSONNALITE: {
    stage: "personalite",
    funnel: "Personnalité",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request", "application", "production"],
  },
  PECAS: {
    stage: "pecas",
    funnel: "Peças",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "2A_BOLETO": {
    stage: "financeiro",
    funnel: "Financeiro",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "2B_NF": {
    stage: "financeiro",
    funnel: "Financeiro",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "2C_OUTROS": {
    stage: "financeiro",
    funnel: "Financeiro",
    createsDeal: false,
    action: "handoff",
    fields: ["name", "request"],
  },
  "3_AT": {
    stage: "assistencia_tecnica",
    funnel: "Assistência Técnica",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "request"],
  },
  "4A_RASTREAR": {
    stage: "pos_venda",
    funnel: "Pós-Venda",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "4B_NF": {
    stage: "pos_venda",
    funnel: "Pós-Venda",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  POS_VENDA: {
    stage: "pos_venda",
    funnel: "Pós-Venda",
    createsDeal: true,
    action: "handoff",
    fields: ["name", "document", "request"],
  },
  "5A_CLIENTE": {
    stage: "outros",
    funnel: INDUSTRIAL_REVIEW_FUNNEL,
    createsDeal: false,
    action: "review",
    fields: [],
  },
  "5B_CURRICULO": {
    stage: "outros",
    funnel: "Currículos",
    createsDeal: false,
    action: "inform",
    fields: [],
  },
  "5C_COMPRAS": {
    stage: "outros",
    funnel: "Compras / Fornecedores",
    createsDeal: false,
    action: "inform",
    fields: [],
  },
} as const;

export type IndustrialSubflow = keyof typeof INDUSTRIAL_ROUTES;
export type IndustrialFunnel = (typeof INDUSTRIAL_ROUTES)[IndustrialSubflow]["funnel"];
export const INDUSTRIAL_FUNNELS = [
  ...new Set(
    Object.values(INDUSTRIAL_ROUTES)
      .filter((route) => route.action !== "inform")
      .map((route) => route.funnel),
  ),
];

/** Compatibilidade somente do núcleo industrial; não altera a política dos demais tenants. */
const LEGACY_INDUSTRIAL_FUNNELS: Record<string, string> = {
  "Fin. Boleto": "Financeiro",
  "Fin. Nota Fiscal": "Financeiro",
  "Fin. Outros": "Financeiro",
  "Pós-Venda Rastreio": "Pós-Venda",
  "Pós-Venda - NF do Pedido": "Pós-Venda",
  "Pós-Venda Geral": "Pós-Venda",
  "Pós venda": "Pós-Venda",
  "Pos venda": "Pós-Venda",
  "Suporte Técnico": "Assistência Técnica",
  "Suporte Tecnico": "Assistência Técnica",
  "Atendimento Geral": INDUSTRIAL_REVIEW_FUNNEL,
};
export function normalizeIndustrialFunnel(value: string): string {
  const normalized = normalizeTriageText(value);
  return (
    Object.entries(LEGACY_INDUSTRIAL_FUNNELS).find(
      ([name]) => normalizeTriageText(name) === normalized,
    )?.[1] ||
    INDUSTRIAL_FUNNELS.find((name) => normalizeTriageText(name) === normalized) ||
    value
  );
}
export function normalizeIndustrialFunnels(values: readonly string[]): string[] {
  return [
    ...new Set(values.filter((value) => typeof value === "string").map(normalizeIndustrialFunnel)),
  ];
}
export type RequiredField = "name" | "document" | "request" | "application" | "production";
export interface SystemOperatorCandidate {
  id: string;
  name: string;
  email?: string;
  funnels?: string[];
  sectorName?: string;
  isOnLeave?: boolean;
  status?: string;
}
export type DirectOperatorIntent =
  | "direct_transfer"
  | "confirm_absent_transfer"
  | "offer_transfer"
  | "past_reference_only"
  | "ambiguous_homonym"
  | "not_found";
export interface DirectOperatorAiDecision {
  intent?: DirectOperatorIntent | null;
  citedName?: string | null;
  matchedOperatorId?: string | null;
  matchedOperatorName?: string | null;
}
export interface DirectOperatorTarget {
  id: string;
  name: string;
  isAbsent: boolean;
  primaryFunnel: IndustrialFunnel | null;
}
export interface ResolvedDirectOperator {
  status:
    | "matched"
    | "offer_transfer"
    | "operator_absent"
    | "past_reference_only"
    | "ambiguous_homonym"
    | "not_found"
    | "none";
  citedName: string | null;
  operator: DirectOperatorTarget | null;
  homonyms?: Array<{ id: string; name: string; funnels: string[] }>;
}
export interface IndustrialRoute {
  subflow: IndustrialSubflow | null;
  funnelStage: TriageStage;
  targetFunnel: IndustrialFunnel | null;
  needsReview: boolean;
  reason:
    | "intent"
    | "declared_route"
    | "previous_route"
    | "unknown"
    | "human_requested"
    | "direct_operator_requested"
    | "direct_operator_not_found"
    | "specialist_review"
    | "classification_pending";
  targetOperator?: DirectOperatorTarget | null;
}

export function normalizeTriageText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function collectedValue(data: CollectedFields, ...keys: string[]): string {
  for (const key of keys) {
    const entry = data[key];
    if (entry?.status === "pending" || typeof entry?.value !== "string") continue;
    const value = entry.value.trim();
    const normalized = normalizeTriageText(value);
    if (
      normalized &&
      !/^(?:aguardando.*|nao informado|nao informada|mantem.*|n\/a|nenhum|nenhuma|true|false|sim|nao)$/i.test(
        normalized,
      )
    )
      return value;
  }
  return "";
}

export function isIndustrialSubflow(value: unknown): value is IndustrialSubflow {
  return typeof value === "string" && Object.hasOwn(INDUSTRIAL_ROUTES, value);
}

/** Identifica subfluxos puramente informativos/não-lead (currículos e fornecedores/parcerias). */
export function isIndustrialInformativeSubflow(value?: string | null): boolean {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return code === "5B_CURRICULO" || code === "5C_COMPRAS";
}

function declaredSubflow(value?: string | null): IndustrialSubflow | null {
  if (isIndustrialSubflow(value)) return value;
  const normalized = normalizeTriageText(value || "");
  // Rótulos antigos preservam o assunto específico; o destino novo continua unificado.
  const legacy: Record<string, IndustrialSubflow> = {
    "Fin. Boleto": "2A_BOLETO",
    "Fin. Nota Fiscal": "2B_NF",
    "Fin. Outros": "2C_OUTROS",
    "Pós-Venda Rastreio": "4A_RASTREAR",
    "Pós-Venda - NF do Pedido": "4B_NF",
    "Pós-Venda Geral": "POS_VENDA",
    "Atendimento Geral": "5A_CLIENTE",
    Financeiro: "2C_OUTROS",
    "Pós-Venda": "POS_VENDA",
  };
  const old = Object.entries(legacy).find(([name]) => normalizeTriageText(name) === normalized);
  if (old) return old[1];
  return (
    (Object.keys(INDUSTRIAL_ROUTES) as IndustrialSubflow[]).find(
      (key) => normalizeTriageText(INDUSTRIAL_ROUTES[key].funnel) === normalized,
    ) || null
  );
}

/** Não confundir solicitação de manual com compra de "seladora manual". */
function isTechnicalDocument(text: string): boolean {
  if (/\b(?:esquema|diagrama) eletric\w*\b/.test(text)) return true;
  return (
    /\bmanua(?:l|is)\b/.test(text) &&
    (/\b(?:do|da|o|um|seu|pdf|copia|instrucoes|tecnico) manual\b/.test(text) ||
      /\bmanual (?:d[aoe]|de instrucoes|tecnico)\b/.test(text) ||
      (/\b(?:preciso|quero|envia|enviar|manda|mandar|perdi|solicito)\b/.test(text) &&
        !/\b(?:seladora|envasadora|dosadora|rotuladora|maquina|arqueadora|embaladora) manual\b/.test(
          text,
        )))
  );
}

/**
 * Remove menções de "peça(s)" / "insumo(s)" que representam o produto que o cliente embala,
 * o ramo de atuação (ex.: autopeças, frigorífico, laticínios), dimensões físicas ou unidade de
 * produtividade — evitando confundir compra de máquina com setor de Peças de reposição.
 */
export function stripNonReplacementPartsContext(normalizedText: string): string {
  if (!normalizedText) return "";
  return normalizedText
    // 1. Objeto de verbo/substantivo de embalagem ou processamento ("embalar peças de carro", "embalagem de peças")
    .replace(
      /\b(?:embalar|empacotar|ensacar|selar|envasar|dosar|rotular|datar|codificar|encaixotar|enfardar|encolher|processar|plastificar|etiquetar|contar|(?:embalagem|embalagens)\s+(?:de|para))\s+(?:as\s+|os\s+|umas?\s+|uns\s+|minhas?\s+|meus?\s+|nossas?\s+|nossos?\s+|varias?\s+|diversas?\s+|\d+(?:[.,]\d+)?\s+)?(?:pecas?|insumos?|correias?|sensores?|resistencias?|roletes?)\b(?:\s+(?:de|da|do|das|dos|automotiv[ao]s?|plastic[ao]s?|metalic[ao]s?|agricolas?|hospitalares?|alimentici[ao]s?|pequen[ao]s?|grandes?|usinad[ao]s?|injetad[ao]s?|avuls[ao]s?)(?:\s+[a-z0-9]+){0,2})?/g,
      " ",
    )
    // 2. "peças (pequenas) para embalar/empacotar/selar..."
    .replace(
      /\b(?:pecas?|insumos?)(?:\s+(?:pequen[ao]s?|grandes?|avuls[ao]s?|divers[ao]s?|variad[ao]s?|individuais?|automotiv[ao]s?|plastic[ao]s?|metalic[ao]s?))?\s+para\s+(?:embalar|empacotar|ensacar|selar|envasar|dosar|rotular|datar|codificar|encaixotar|enfardar|encolher|plastificar|etiquetar)\b/g,
      " ",
    )
    // 3. Máquina/solução/linha PARA peças ("máquina para peças automotivas", "seladora a vácuo para peças")
    .replace(
      /\b(?:maquinas?|equipamentos?|soluc(?:ao|oes)|linhas?|seladoras?|envasadoras?|dosadoras?|empacotadoras?|rotuladoras?|embaladoras?|datador\w*|tuneis|tunel|personnalite|personalite)\s+(?:[a-z0-9]+\s+){0,4}para\s+(?:as\s+|os\s+)?(?:pecas?|insumos?)\b/g,
      (match) => match.replace(/\bpara\s+(?:as\s+|os\s+)?(?:pecas?|insumos?)\b$/, ""),
    )
    // 4. Unidade de produtividade/contagem ("500 peças por hora", "300 peças/dia", "quantas peças", "10 a 20 peças")
    .replace(
      /\b(?:\d+(?:[.,]\d+)*(?:\s*(?:a|ate|mil))?\s*(?:\d+(?:[.,]\d+)*)?|quantas?|cerca de \d+|aproximadamente \d+)\s*pecas?\s*(?:\/|por\s+|ao\s+|na\s+|no\s+|a\s+)(?:min(?:uto)?s?|h|hr|horas?|dias?|semanas?|mes(?:es)?|turnos?|lotes?|caixas?|pacotes?|embalagens?|sacos?)\b/g,
      " ",
    )
    .replace(/\bquantas?\s+pecas?\b/g, " ")
    // 5. Medidas / peso / diagnóstico incerto ("altura da peça", "a peça pesa 30g", "não sabemos se alguma peça danificada")
    .replace(
      /\b(?:altura|largura|comprimento|espessura|tamanho|dimens(?:ao|oes)|medidas?|peso)\s+(?:aproximad[ao]s?\s+)?(?:da|das|de cada)\s+pecas?\b/g,
      " ",
    )
    .replace(
      /\b(?:a|as|cada|essa|essas|esta|estas|nossa|nossas)\s+pecas?\s+(?:tem|mede|medem|pesa|pesam|possui|possuem|e de|sao de)\b/g,
      " ",
    )
    .replace(
      /\b(?:nao\s+(?:sabemos|sei)|talvez|pode\s+ser|ver\s+se|verificar\s+se)\s+(?:se\s+)?(?:e\s+|ha\s+|tem\s+)?(?:alguma\s+|uma\s+)?pecas?\s+(?:danificad[ao]s?|quebrad[ao]s?|queimad[ao]s?|com\s+defeito|solta|gasta)\b/g,
      " ",
    )
    // 6. Ramos / produtos não-reposição ("auto peças", "peças de carro/carne/queijo/roupa", "insumos agrícolas")
    .replace(
      /\b(?:auto\s*pecas?|moto\s*pecas?|pecas?\s+(?:automotiv[ao]s?|de\s+(?:carro|carros|moto|motos|caminhao|caminhoes|veiculo|veiculos|automovel|automoveis|bicicleta|bicicletas|roupa|roupas|vestuario|tecido|carne|carnes|queijo|queijos|frango|peixe|bacalhau|frios|embutidos|madeira|plastico|metal|ferro|aco|aluminio|vidro|ceramica|borracha|decoracao|artesanato|bijuteria|joia|joias|moveis|relogio|ferragem|ferragens|eletronica|eletronicas)|intim[ao]s?|plastic[ao]s?|metalic[ao]s?|usinad[ao]s?|injetad[ao]s?|textil|texteis|confeccao))\b/g,
      " ",
    )
    .replace(
      /\binsumos?\s+(?:agricolas?|agropecuarios?|veterinarios?|alimenticios?|hospitalares?|farmaceuticos?|quimicos?|odontologicos?|cosmeticos?|de\s+construcao)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

const REPLACEMENT_PARTS_ANY_RE =
  /\b(?:pecas?|insumos?|consumiveis|reposicao|ribbon|ink ?roll|teflon|resistencia(?:s)?|correias?|roletes?|sensor(?:es)?|clp)\b/;

const REPLACEMENT_PARTS_EXPLICIT_RE =
  /\b(?:reposicao|consumiveis|ribbon|ink ?roll|teflon|resistencia(?:s)?|correias?|roletes?|sensor(?:es)?|clp|pistao|vedac(?:ao|oes))\b/;

const REPLACEMENT_PARTS_PHRASE_RE =
  /\b(?:(?:pecas?|insumos?)\s+(?:de\s+reposicao|(?:para|pra)\s+(?:a\s+|o\s+|minha\s+|meu\s+|nossa\s+|nosso\s+)?(?:maquina|seladora|envasadora|dosadora|empacotadora|rotuladora|embaladora|datador\w*|tunel|equipamento|linha)|d[ao]\s+(?:minha\s+|meu\s+|nossa\s+|nosso\s+)?(?:maquina|seladora|envasadora|dosadora|empacotadora|rotuladora|embaladora|datador\w*|tunel|equipamento))|(?:setor|departamento|area|equipe|vendedor|cotacao|orcamento)\s+de\s+pecas|(?:preciso|quero|gostaria|comprar|cotar|trocar|substituir)\s+(?:de\s+)?(?:uma?\s+|umas?\s+|algumas?\s+)?pecas?)\b/;

/** Não confundir compra de máquina para embalar peças/insumos com compra de peças de reposição. */
export function isReplacementPartsIntent(raw: string): boolean {
  const cleaned = stripNonReplacementPartsContext(normalizeTriageText(raw));
  if (!cleaned) return false;
  return REPLACEMENT_PARTS_ANY_RE.test(cleaned);
}

/**
 * Indica intenção inequívoca de peça de reposição/consumível (capaz de sobrepor um fluxo comercial
 * já classificado pelo LLM, diferente de uma resposta ambígua como apenas "Peças").
 */
export function isExplicitReplacementPartsIntent(raw: string): boolean {
  const cleaned = stripNonReplacementPartsContext(normalizeTriageText(raw));
  if (!cleaned) return false;
  return REPLACEMENT_PARTS_EXPLICIT_RE.test(cleaned) || REPLACEMENT_PARTS_PHRASE_RE.test(cleaned);
}

/**
 * Detecta linguagem comercial de pré-compra (condição de pagamento, boleto parcelado, desconto PIX,
 * prazo de entrega, pronta entrega, frete ou "esteira transportadora") para impedir que regex
 * sequestre vendas novas para Financeiro ou Pós-Venda.
 */
export function isPrePurchaseCommercialInquiry(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (!text) return false;
  return (
    /\b(?:cotacao|orcamento|proposta|quanto custa|valor d[ao]|preco d[ao]|quero comprar|gostaria de comprar|tenho interesse)\b/.test(
      text,
    ) ||
    /\b(?:condic(?:ao|oes)\s+de\s+pagamento|formas?\s+de\s+pagamento|desconto\s+(?:no|via|a\s+vista|pix)|pagamento\s+(?:via|no)\s+pix|no\s+boleto\s+em\s+\d+x|boleto\s+parcelado|aceita(?:m)?\s+boleto|parcela(?:r|mento|do))\b/.test(
      text,
    ) ||
    /\b(?:prazo\s+de\s+entrega|pronta\s+entrega|frete\s+para|valor\s+do\s+frete|esteira\s+transportadora)\b/.test(
      text,
    )
  );
}

function isExplicitBoletoBillingIntent(text: string): boolean {
  if (!/\b(?:boleto|cobranca|inadimplencia)\b/.test(text)) return false;
  // Pergunta comercial de pagamento/parcelamento em cotação NÃO é setor Financeiro (2A_BOLETO)
  const isCommercialQuoteBoleto =
    /\b(?:no\s+boleto\s+em\s+\d+x|boleto\s+parcelado|aceita(?:m)?\s+boleto|pagar\s+(?:no|por|via)\s+boleto|fazer\s+no\s+boleto|condic(?:ao|oes)\s+de\s+pagamento|formas?\s+de\s+pagamento|parcelamento\s+no\s+boleto)\b/.test(
      text,
    ) ||
    (/\b(?:cotacao|orcamento|quanto\s+(?:fica|custa|da)|valor\s+d[ao]|quero\s+comprar)\b/.test(
      text,
    ) &&
      !/\b(?:segunda\s+via|2a\s+via|2\s+via|vencido|venceu|em\s+aberto|atraso|atualizar|reemitir|prorrogar|cobranca|inadimplencia)\b/.test(
        text,
      ));
  return !isCommercialQuoteBoleto;
}

function isExplicitFinancialOtherIntent(text: string): boolean {
  // "pagamento" solto em "condição de pagamento" / "pagamento via PIX" é comercial, NÃO Financeiro
  const hasStrongFinanceTerm =
    /\b(?:setor\s+financeiro|departamento\s+financeiro|falar\s+com\s+(?:o\s+)?financeiro|\bfinanceiro\b|comprovante(?:\s+de\s+pagamento)?|fatura\b|prorrogacao|baixa\s+de\s+pagamento|duplicidade\s+de\s+pagamento|erro\s+no\s+pagamento|ja\s+efetuei\s+o\s+pagamento|ja\s+paguei)\b/.test(
      text,
    );
  if (!hasStrongFinanceTerm) return false;
  // Mesmo citando "financeiro", se for pergunta de condição/cotação sem cobrança/comprovante, não forçar 2C_OUTROS
  if (
    isPrePurchaseCommercialInquiry(text) &&
    !/\b(?:setor\s+financeiro|departamento\s+financeiro|falar\s+com\s+(?:o\s+)?financeiro|comprovante|prorrogacao|ja\s+paguei|fatura|estorn\w*|reembols\w*)\b/.test(
      text,
    )
  ) {
    return false;
  }
  return true;
}

function isExplicitOrderTrackingContext(text: string): boolean {
  // Remove explicitamente "esteira transportadora" e "prazo de entrega / pronta entrega" antes de testar
  const sanitized = text
    .replace(/\besteira\s+transportadora\b/g, " ")
    .replace(/\b(?:prazo\s+de\s+entrega|pronta\s+entrega|valor\s+da\s+entrega|frete\s+e\s+entrega)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized) return false;
  return /\b(?:rastre\w*|codigo\s+de\s+rastre\w*|meu\s+pedido|nosso\s+pedido|numero\s+do\s+pedido|pedido\s+\d|pedido\s+(?:chegou|existente)|status\s+d[ao]\s+(?:meu\s+|nosso\s+)?(?:pedido|entrega)|ainda\s+nao\s+recebi\s+(?:a|as|o|os|minha|meu|nada)?\s*(?:maquina|seladora|envasadora|equipamento|encomenda|pedido|peca|mercadoria)|nao\s+recebi\s+(?:a|as|o|os|minha|meu)\s*(?:maquina|seladora|envasadora|equipamento|encomenda|pedido|peca|mercadoria)|nao\s+chegou|ainda\s+nao\s+chegou|cade\s+(?:meu|o|a|as|os)\s+(?:pedido|maquina|seladora|envasadora|equipamento|encomenda)|entrega\s+do\s+(?:meu|nosso)\s+(?:pedido|equipamento|maquina)|previsao\s+de\s+entrega\s+do\s+(?:meu|nosso)\s+pedido|data\s+prevista\s+de\s+entrega\s+do\s+pedido|nota\s+fiscal\s+do\s+pedido|danfe)\b/.test(
    sanitized,
  );
}

function isSupplierOrPartnershipOffer(text: string): boolean {
  if (
    /\b(?:sou fornecedor|somos fornecedores|cadastrar como fornecedor|cadastro de fornecedor|nos cadastrar como fornecedor|fornecer para voces|fornecer pra voces|fornecer para a empresa|fornecer produtos|fornecer insumos|fornecer materiais)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(?:oferecer|ofertar|apresentar|divulgar)\s+(?:os\s+|as\s+|nossos?\s+|nossas?\s+|meus?\s+|minhas?\s+|uns?\s+|umas?\s+)?(?:produtos?|servicos?|insumos?|materiais?|materia[\s-]?prima|embalagens?|frete|fretes|transporte|logistica|solucoes|catalogo|portfolio|tabela(?:\s+de\s+frete)?)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(?:vender|comercializar|fornecer)\s+(?:os\s+|as\s+|nossos?\s+|nossas?\s+|meus?\s+|minhas?\s+)?(?:insumos?|produtos?|materiais?|materia[\s-]?prima|servicos?|embalagens?|frete)\s*(?:para\s+(?:voces|a\s+empresa|a\s+tecfag)|pra\s+voces)?\b/.test(
      text,
    ) &&
    !/\b(?:eu\s+vendo|a\s+gente\s+vende|nos\s+vendemos|vendo\s+(?:bolos?|salgados?|doces?|marmitas?|queijos?|cafe|mel|temperos?|suplementos?|cosmeticos?|roupas?|alimentos?))\b/.test(
      text,
    ) &&
    !/\b(?:preciso\s+de\s+(?:uma?\s+)?(?:maquina|seladora|envasadora|empacotadora|dosadora|rotuladora)|quero\s+comprar|orcamento\s+de\s+(?:uma?\s+)?(?:maquina|seladora|envasadora|empacotadora))\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(?:(?:fazer|propor|fechar|firmar|buscar|ver|conversar\s+sobre)\s+(?:uma\s+)?parceria|proposta\s+de\s+parceria|parceria\s+(?:comercial|logistica|de\s+frete|de\s+transporte|de\s+negocios|estrategica|com\s+voces)|(?:ser|tornar[\s-]?se|virar)\s+(?:um\s+)?parceiro|parceiros?\s+de\s+voces)\b/.test(
      text,
    )
  ) {
    return true;
  }
  const mentionsCarrierOffering =
    /\b(?:somos\s+(?:uma\s+|da\s+)?transportadora|(?:sou|falo|trabalho|represento)\s+(?:da|na|pela|de\s+uma)\s+transportadora)\b/.test(
      text,
    ) ||
    (/\btransportadora\b/.test(text) &&
      !isExplicitOrderTrackingContext(text) &&
      /\b(?:parceria|oferecer|ofertar|apresentar|cotacao\s+de\s+frete|tabela\s+de\s+frete|servicos?\s+de\s+(?:frete|transporte|logistica)|atender\s+voces|trabalhar\s+com\s+voces|coleta\s+e\s+entrega|rotas|cargas|fretes|logistica)\b/.test(
        text,
      ));
  if (mentionsCarrierOffering && !isExplicitOrderTrackingContext(text)) {
    return true;
  }
  if (
    /\b(?:falar\s+com\s+(?:o\s+)?(?:setor|departamento|responsavel)\s+de\s+compras|falar\s+com\s+(?:o\s+)?comprador|contato\s+do\s+setor\s+de\s+compras|e-?mail\s+do\s+setor\s+de\s+compras)\b/.test(
      text,
    ) &&
    !/\b(?:quero\s+comprar|gostaria\s+de\s+comprar|orcamento|cotacao)\b/.test(text)
  ) {
    return true;
  }
  return false;
}

function isCurriculumOrJobIntent(text: string): boolean {
  if (/\b(?:curriculos?|curriculum)\b/.test(text)) return true;
  if (/\b(?:enviar|mandar|anexar|deixar|cadastrar|encaminhar)\s+(?:meu\s+|o\s+|um\s+)?cv\b/.test(text)) {
    return true;
  }
  if (
    /\b(?:vagas?\s+(?:de\s+emprego|abertas?|disponive(?:l|is)|na\s+(?:empresa|tecfag))|oportunidade\s+de\s+(?:emprego|trabalho)|processo\s+seletivo|trabalhe\s+conosco|me\s+candidatar|candidatura\s+(?:a|para)\s+vaga|solides)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(?:trabalhar\s+(?:na|com)\s+(?:voces|a\s+tecfag|tecfag|a\s+empresa)|(?:quero|queria|gostaria\s+de|busco|procuro|tem\s+vaga\s+para)\s+trabalhar\s+(?:ai|com\s+voces|na\s+tecfag|na\s+empresa))\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(?:vagas?\b|setor\s+de\s+rh|departamento\s+de\s+rh|falar\s+com\s+o\s+rh|recursos\s+humanos)\b/.test(
      text,
    ) &&
    !/\b(?:maquina|seladora|envasadora|empacotadora|dosadora|peca|boleto|nota\s+fiscal|rastreio|defeito|manutencao)\b/.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

function textSubflow(raw: string): IndustrialSubflow | null {
  const withoutEmails = String(raw || "").replace(
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
    " ",
  );
  const text = normalizeTriageText(withoutEmails);
  if (!text) return null;
  if (isCurriculumOrJobIntent(text)) return "5B_CURRICULO";
  if (isSupplierOrPartnershipOffer(text)) return "5C_COMPRAS";

  const pendingReturn =
    /\b(?:quero|queria|preciso|vou|gostaria de|como faco para) (?:fazer (?:a |uma )?)?(?:devolver|devolucao|cancelar)\b/.test(
      text,
    );
  const returned = /\b(?:devolvi|devolvemos|devolvid[oa]s?|ja devol\w*)\b/.test(text);
  if (
    /\b(?:estorn\w*|reembols\w*|ressarc\w*|restituicao|dinheiro de volta)\b/.test(text) ||
    (returned && /\b(?:dinheiro|valor|pagamento|credito)\b/.test(text))
  ) {
    return pendingReturn && !returned ? "POS_VENDA" : "2C_OUTROS";
  }
  if (pendingReturn || /\b(?:devolucao|cancelamento (?:do|de) pedido)\b/.test(text))
    return "POS_VENDA";
  if (isExplicitBoletoBillingIntent(text)) return "2A_BOLETO";
  if (/\b(?:nota fiscal|nf|danfe|xml)\b/.test(text)) {
    return /\b(?:pedido|compra|entrega|rastre\w*)\b/.test(text) ? "4B_NF" : "2B_NF";
  }
  if (isExplicitFinancialOtherIntent(text)) return "2C_OUTROS";
  if (isTechnicalDocument(text)) return "3_AT";
  const hasExplicitFailureOrSupport =
    /\b(?:defeito|conserto|garantia|assistencia|suporte tecnico|nao (?:liga|funciona|sela|corta)|maquina parada|fita (?:arrebenta|rompendo|quebrando))\b/.test(
      text,
    );
  const mentionsMaintenanceOnlyAsRecipient =
    /\bmanutencao\b/.test(text) &&
    !hasExplicitFailureOrSupport &&
    (/(?:setor|departamento|equipe|pessoal|gerente|coordenador|responsavel|e-?mail)\s+(?:de|da)\s+manutencao|\bda\s+manutencao\b/.test(
      text,
    ) ||
      /\b(?:agradece(?:mos)?\s+(?:o\s+)?(?:seu\s+)?contato|assim\s+que\s+possivel\s+respond|horario\s+comercial|mensagem\s+automatica)\b/.test(
        text,
      )) &&
    (/\b(?:oferta|black\s*friday|apresentacao|catalogo|cotacao|orcamento|proposta|comprar|adquirir|seladoras?|envasadoras?|maquinas?)\b/.test(
      text,
    ) ||
      /\b(?:agradece(?:mos)?\s+(?:o\s+)?(?:seu\s+)?contato|assim\s+que\s+possivel\s+respond|horario\s+comercial|mensagem\s+automatica)\b/.test(
        text,
      ));
  if (
    (hasExplicitFailureOrSupport || /\bmanutencao\b/.test(text)) &&
    !mentionsMaintenanceOnlyAsRecipient
  ) {
    if (!/\b(?:quero comprar|gostaria de comprar|quero adquirir)\b/.test(text)) return "3_AT";
  }
  if (isExplicitOrderTrackingContext(text)) return "4A_RASTREAR";
  if (isExistingCommercialProposalInquiry(text)) {
    return "5A_CLIENTE";
  }
  const boughtElsewhere =
    /\b(?:comprei|compramos|adquiri|adquirimos|fechei|fechamos|fiz(?:emos)? a compra)\s+(?:na\s+shopee|no\s+mercado\s*livre|na\s+amazon|na\s+magalu|com\s+outr[ao]|em\s+outr[ao]|por\s+fora|no\s+concorrente|na\s+concorrencia)\b/.test(
      text,
    );
  if (
    !boughtElsewhere &&
    /\b(?:pos venda|comprei|compramos|efetuamos um pedido|fizemos um pedido)\b/.test(text)
  )
    return "POS_VENDA";
  if (isReplacementPartsIntent(text)) return "PECAS";
  if (
    /\b(?:maquinas?|esteiras?|seladoras?|envasadoras?|dosadoras?|empacotadoras?|rotuladoras?|embaladoras?|datador\w*|encapsuladoras?|fechadoras?|rosqueadeiras?|arqueadoras?|tuneis|tunel|personnalite|personalite|orcamento|cotacao|quero comprar)\b/.test(
      text,
    )
  )
    return "MAQUINAS";
  return null;
}

/**
 * Override estrito de segurança: dispara APENAS para intenções 100% inequívocas
 * que realmente podem prevalecer sobre o subfluxo declarado pelo Gemini
 * (currículo, fornecedor, estorno/devolução, 2ª via boleto, NF/DANFE/XML, defeito/suporte técnico
 * explícito, rastreio explícito de pedido já comprado ou proposta já emitida).
 * NUNCA dispara por palavras comerciais soltas ("pagamento", "entrega", "transportadora", "peças de carro").
 */
function strictHardOverrideSubflow(
  raw: string,
  existingSubflow?: IndustrialSubflow | null,
): IndustrialSubflow | null {
  const withoutEmails = String(raw || "").replace(
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
    " ",
  );
  const text = normalizeTriageText(withoutEmails);
  if (!text) return null;
  if (isCurriculumOrJobIntent(text)) return "5B_CURRICULO";
  if (isSupplierOrPartnershipOffer(text)) return "5C_COMPRAS";

  const pendingReturn =
    /\b(?:quero|queria|preciso|vou|gostaria de|como faco para) (?:fazer (?:a |uma )?)?(?:devolver|devolucao|cancelar)\b/.test(
      text,
    );
  const returned = /\b(?:devolvi|devolvemos|devolvid[oa]s?|ja devol\w*)\b/.test(text);
  if (
    /\b(?:estorn\w*|reembols\w*|ressarc\w*|restituicao|dinheiro de volta)\b/.test(text) ||
    (returned && /\b(?:dinheiro|valor|pagamento|credito)\b/.test(text))
  ) {
    return pendingReturn && !returned ? "POS_VENDA" : "2C_OUTROS";
  }
  if (pendingReturn || /\b(?:devolucao|cancelamento (?:do|de) pedido)\b/.test(text)) {
    return "POS_VENDA";
  }
  if (isExplicitBoletoBillingIntent(text)) return "2A_BOLETO";
  if (/\b(?:nota fiscal|nf|danfe|xml)\b/.test(text) && !/\b(?:emite|emitir|com)\s+nota\s+fiscal\b/.test(text)) {
    return /\b(?:pedido|compra|entrega|rastre\w*)\b/.test(text) ? "4B_NF" : "2B_NF";
  }
  if (isExplicitFinancialOtherIntent(text)) return "2C_OUTROS";
  if (isTechnicalDocument(text)) return "3_AT";
  const hasExplicitFailureOrSupport =
    /\b(?:defeito|conserto|garantia|assistencia tecnica|suporte tecnico|nao (?:liga|funciona|sela|corta)|maquina parada|fita (?:arrebenta|rompendo|quebrando))\b/.test(
      text,
    );
  const mentionsMaintenanceOnlyAsRecipient =
    /\bmanutencao\b/.test(text) &&
    !hasExplicitFailureOrSupport &&
    (/(?:setor|departamento|equipe|pessoal|gerente|coordenador|responsavel|e-?mail)\s+(?:de|da)\s+manutencao|\bda\s+manutencao\b/.test(
      text,
    ) ||
      /\b(?:agradece(?:mos)?\s+(?:o\s+)?(?:seu\s+)?contato|assim\s+que\s+possivel\s+respond|horario\s+comercial|mensagem\s+automatica)\b/.test(
        text,
      )) &&
    (/\b(?:oferta|black\s*friday|apresentacao|catalogo|cotacao|orcamento|proposta|comprar|adquirir|seladoras?|envasadoras?|maquinas?)\b/.test(
      text,
    ) ||
      /\b(?:agradece(?:mos)?\s+(?:o\s+)?(?:seu\s+)?contato|assim\s+que\s+possivel\s+respond|horario\s+comercial|mensagem\s+automatica)\b/.test(
        text,
      ));
  if (
    (hasExplicitFailureOrSupport || /\bmanutencao\b/.test(text)) &&
    !mentionsMaintenanceOnlyAsRecipient &&
    !/\b(?:quero comprar|gostaria de comprar|quero adquirir)\b/.test(text)
  ) {
    return "3_AT";
  }
  if (isExplicitOrderTrackingContext(text)) return "4A_RASTREAR";
  if (isExistingCommercialProposalInquiry(text)) return "5A_CLIENTE";
  // Peças só faz hard-override se for intenção explícita de reposição E não estiver em suporte técnico nem falando de máquina para embalar peças
  if (
    existingSubflow !== "3_AT" &&
    isExplicitReplacementPartsIntent(text) &&
    !/\b(?:embalar|empacotar|selar|envasar|dosar|rotular|personnalite|personalite)\b/.test(text)
  ) {
    return "PECAS";
  }
  return null;
}

export function isPastPersonReference(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (!text) return false;
  return (
    /\b(?:ja|eu ja|cheguei a|costumava|vivia) (?:falei|conversei|falar|conversar|tratei|negociei) (?:antes |uma vez |outra vez )?(?:com|pelo|pela)\b/.test(
      text,
    ) ||
    /\b(?:falei|conversei|comprei|fechei|negociei|tratei) (?:com|pelo|pela) (?:o |a )?[a-z]{3,}\b.*\b(?:ontem|antes|passad[oa]|semana|mes|ano|uma vez|outra vez|da ultima vez|anteriormente)\b/.test(
      text,
    ) ||
    /\b(?:ontem|antes|semana passada|mes passado|ano passado|uma vez|da ultima vez) (?:eu )?(?:falei|conversei|comprei|tratei|falar|conversar) com\b/.test(
      text,
    )
  );
}

/**
 * Detecta cliente referenciando proposta/orçamento comercial já emitido (ex.: "proposta comercial 0022524-01",
 * "na proposta já consta isso") — nesses casos NÃO faz sentido exigir aplicação/produção do zero.
 */
export function isExistingCommercialProposalInquiry(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (!text) return false;
  return (
    /\b(?:proposta|orcamento|cotacao)\s+(?:comercial\s+)?(?:n(?:o|umero)?\.?\s*)?\d[\d./-]{2,}\b/.test(
      text,
    ) ||
    /\b(?:na|nessa|nesta|da|essa|esta)\s+proposta\s+(?:ja\s+)?(?:consta|tem|esta|estao|enviei|passei|informei)\b/.test(
      text,
    ) ||
    /\bcom\s+quem\s+(?:converso|falo|trato)\s+sobre\s+(?:a|essa|esta|minha|nossa)\s+(?:proposta|cotacao)\b/.test(
      text,
    )
  );
}

/** Detecta pedido genérico de atendimento humano (sem citar nome de pessoa específica). */
export function requestsGenericHuman(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (/\bnao (?:quero|preciso|desejo) (?:falar|conversar|ser transferido)\b/.test(text))
    return false;
  return (
    /\b(?:quero|prefiro|preciso|posso|gostaria de|pode me|me) (?:falar|conversar|passar|transferir|transfere|passa|conecte|conectar)\b.*\b(?:humano|humana|atendente|alguem|equipe)\b/.test(
      text,
    ) ||
    /\b(?:nao quero|pare de) (?:falar|conversar) com (?:robo|ia|bot)\b/.test(text) ||
    /\b(?:preciso|quero)\s+(?:apenas|so|somente)\s+(?:falar|conversar)\s+com\s+(?:o|a|um|uma)?\s*(?:consultor|vendedor|especialista|atendente|responsavel)\b/.test(
      text,
    ) ||
    /\b(?:so|apenas|somente)\s+(?:preciso|quero)\s+(?:falar|conversar)\s+com\s+(?:o|a|um|uma)?\s*(?:consultor|vendedor|especialista|atendente|responsavel)\b/.test(
      text,
    )
  );
}

export function requestsHuman(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (/\bnao (?:quero|preciso|desejo) (?:falar|conversar|ser transferido)\b/.test(text))
    return false;
  if (isPastPersonReference(text)) return false;
  return (
    requestsGenericHuman(raw) ||
    /\b(?:quero|prefiro|preciso|posso|gostaria de|pode me|me) (?:falar|conversar|passar|transferir|transfere|passa|conecte|conectar)\b.*\b(?:pessoa)\b/.test(
      text,
    ) ||
    /\b(?:falar|conversar|transfere|transferir|passa) (?:diretamente )?(?:com|para|pra) (?:o |a |um |uma )?(?!(?:vendedor|consultor|especialista|suporte|financeiro|pos|fagner|valentina|setor|departamento|area|compras|comprador|rh|recursos|administrativo|adm)\b)[a-z]{3,}(?:\b|$)/.test(
      text,
    )
  );
}

const STOPWORDS_PERSON_NAME = new Set(["sr", "sra", "dr", "dra", "de", "da", "do", "dos", "das", "o", "a"]);

function extractNameTokens(rawName: string): string[] {
  return normalizeTriageText(rawName)
    .replace(/\s*-\s*\d+\s*$/, "")
    .split(" ")
    .filter((token) => token.length >= 2 && !STOPWORDS_PERSON_NAME.has(token));
}

function levenshteinWithinOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) {
      i++;
    } else if (b.length > a.length) {
      j++;
    } else {
      i++;
      j++;
    }
  }
  if (i < a.length || j < b.length) edits++;
  return edits <= 1;
}

function tokenMatchesApproximately(citedToken: string, opToken: string): boolean {
  if (citedToken === opToken) return true;
  if (citedToken.length >= 3 && opToken.startsWith(citedToken)) return true;
  if (citedToken.length >= 4 && opToken.length >= 4 && levenshteinWithinOne(citedToken, opToken)) {
    return true;
  }
  return false;
}

function findOperatorMatchesByName(
  rawCited: string,
  systemOperators: readonly SystemOperatorCandidate[],
): SystemOperatorCandidate[] {
  const citedTokens = extractNameTokens(rawCited);
  if (citedTokens.length === 0) return [];
  const normCitedFull = citedTokens.join(" ");

  const exactMatches = systemOperators.filter((op) => {
    const opTokens = extractNameTokens(op.name);
    if (opTokens.length === 0) return false;
    const normOpFull = opTokens.join(" ");
    if (normOpFull === normCitedFull) return true;
    if (citedTokens.length === 1) {
      return opTokens[0] === citedTokens[0];
    }
    return citedTokens.every((token) => opTokens.includes(token));
  });

  if (exactMatches.length > 0) {
    const exactFullMatches =
      citedTokens.length > 1
        ? exactMatches.filter((op) => extractNameTokens(op.name).join(" ") === normCitedFull)
        : [];
    return exactFullMatches.length === 1 ? exactFullMatches : exactMatches;
  }

  return systemOperators.filter((op) => {
    const opTokens = extractNameTokens(op.name);
    if (opTokens.length === 0) return false;
    if (citedTokens.length === 1) {
      return opTokens.some((opTok) => tokenMatchesApproximately(citedTokens[0], opTok));
    }
    return citedTokens.every((token) =>
      opTokens.some((opTok) => tokenMatchesApproximately(token, opTok)),
    );
  });
}

function toDirectOperatorTarget(chosen: SystemOperatorCandidate): DirectOperatorTarget {
  const normalizedFunnels = normalizeIndustrialFunnels(chosen.funnels || []);
  const primaryFunnel =
    (normalizedFunnels.find((f) =>
      (INDUSTRIAL_FUNNELS as readonly string[]).includes(f),
    ) as IndustrialFunnel | undefined) || null;
  const isAbsent = Boolean(
    chosen.isOnLeave === true || normalizeTriageText(chosen.status || "") === "ausente",
  );
  return {
    id: chosen.id,
    name: chosen.name,
    isAbsent,
    primaryFunnel,
  };
}

/**
 * Cruza a interpretação contextual inteligente do Gemini (`directOperatorRequest`) com a lista
 * real de todos os usuários/operadores cadastrados no tenant (`operators` + `flowOperators`).
 * Prioriza o `matchedOperatorId` resolvido semanticamente pelo Gemini (validado estritamente
 * contra os operadores do tenant), com fallback tolerante a grafia/apelidos.
 */
export function resolveDirectOperatorRequest(
  aiDecision: DirectOperatorAiDecision | null | undefined,
  systemOperators: readonly SystemOperatorCandidate[],
): ResolvedDirectOperator {
  if (!aiDecision || !aiDecision.intent) {
    return { status: "none", citedName: null, operator: null };
  }
  const rawCited = (aiDecision.citedName || aiDecision.matchedOperatorName || "").trim();

  if (aiDecision.intent === "past_reference_only") {
    return {
      status: "past_reference_only",
      citedName: rawCited || null,
      operator: null,
    };
  }

  if (aiDecision.intent === "not_found") {
    return {
      status: "not_found",
      citedName: rawCited || null,
      operator: null,
    };
  }

  if (aiDecision.intent === "ambiguous_homonym") {
    const homonymMatches = findOperatorMatchesByName(rawCited, systemOperators);
    return {
      status: "ambiguous_homonym",
      citedName: rawCited || null,
      operator: null,
      homonyms: homonymMatches.map((op) => ({
        id: op.id,
        name: op.name,
        funnels: normalizeIndustrialFunnels(op.funnels || []),
      })),
    };
  }

  // Prioridade 1: ID validado escolhido semanticamente pelo Gemini dentro do mesmo tenant
  const idMatch = aiDecision.matchedOperatorId
    ? systemOperators.find((op) => op.id === aiDecision.matchedOperatorId) || null
    : null;

  let chosen: SystemOperatorCandidate | null = idMatch;

  // Prioridade 2: fallback por nome (exato ou aproximado) se o Gemini não informou ID válido
  if (!chosen) {
    const nameMatches = findOperatorMatchesByName(rawCited, systemOperators);
    if (nameMatches.length > 1) {
      return {
        status: "ambiguous_homonym",
        citedName: rawCited || null,
        operator: null,
        homonyms: nameMatches.map((op) => ({
          id: op.id,
          name: op.name,
          funnels: normalizeIndustrialFunnels(op.funnels || []),
        })),
      };
    }
    chosen = nameMatches.length === 1 ? nameMatches[0] : null;
  }

  if (!chosen) {
    return {
      status: "not_found",
      citedName: rawCited || null,
      operator: null,
    };
  }

  const target = toDirectOperatorTarget(chosen);

  // Operador ausente: pergunta primeiro se o cliente quer falar com outro consultor ou aguardar,
  // transferindo direto somente se o cliente já confirmou (`confirm_absent_transfer`).
  if (target.isAbsent && aiDecision.intent !== "confirm_absent_transfer") {
    return {
      status: "operator_absent",
      citedName: rawCited || chosen.name,
      operator: target,
    };
  }

  // Menção em aberto ("estava falando com o Victor"): oferece a transferência antes de transferir.
  if (aiDecision.intent === "offer_transfer") {
    return {
      status: "offer_transfer",
      citedName: rawCited || chosen.name,
      operator: target,
    };
  }

  return {
    status: "matched",
    citedName: rawCited || chosen.name,
    operator: target,
  };
}

/** Autorização por destino unificado, incluindo os nomes industriais anteriores. */
export function isEligibleIndustrialOperator(
  operator: {
    id: string;
    funnels: string[];
    isParticipating: boolean;
    isOnLeave: boolean;
    isPenalized?: boolean;
  },
  target: string,
  systemOperatorIds: ReadonlySet<string>,
): boolean {
  const normalized = normalizeTriageText(normalizeIndustrialFunnel(target));
  return (
    Boolean(normalized) &&
    systemOperatorIds.has(operator.id) &&
    operator.isParticipating === true &&
    operator.isOnLeave === false &&
    operator.isPenalized !== true &&
    Array.isArray(operator.funnels) &&
    operator.funnels.some(
      (funnel) =>
        typeof funnel === "string" &&
        normalizeTriageText(normalizeIndustrialFunnel(funnel)) === normalized,
    )
  );
}

export interface ResolveIndustrialRouteInput {
  text?: string;
  aiSubflow?: string | null;
  aiFunnelStage?: string | null;
  aiTargetFunnel?: string | null;
  collectedData: CollectedFields;
  existingSubflow?: string | null;
  existingStage?: string | null;
  existingFunnel?: string | null;
  /** Evidência produzida pelo servidor/catálogo ou revisão, nunca copiada do JSON do LLM. */
  machineEvidence?: {
    source: "catalog" | "manual_review";
    group: "PERSONNALITE" | "SEMI-INDUSTRIAL";
    confidence: number;
  };
  /** Resolução validada pelo servidor de pedido nominal de transferência direta. */
  directOperator?: ResolvedDirectOperator | null;
}

export function resolveIndustrialRoute(input: ResolveIndustrialRouteInput): IndustrialRoute {
  if (input.directOperator?.status === "matched" && input.directOperator.operator) {
    const targetOp = input.directOperator.operator;
    const subflowFromFunnel = targetOp.primaryFunnel ? declaredSubflow(targetOp.primaryFunnel) : null;
    const effectiveSubflow: IndustrialSubflow = subflowFromFunnel || "5A_CLIENTE";
    return {
      subflow: effectiveSubflow,
      funnelStage: INDUSTRIAL_ROUTES[effectiveSubflow].stage,
      targetFunnel: targetOp.primaryFunnel || INDUSTRIAL_ROUTES[effectiveSubflow].funnel,
      needsReview: false,
      reason: "direct_operator_requested",
      targetOperator: targetOp,
    };
  }
  if (input.directOperator?.status === "not_found") {
    // Mesmo quando não localiza o usuário apontado, o Fagner para imediatamente a triagem
    // para não ficar forçando barra, acionando revisão humana (awaiting_approval).
    return routeFor("5A_CLIENTE", "direct_operator_not_found", true);
  }
  const fromCurrentText = textSubflow(input.text || "");
  const suppressNominalHumanRegex =
    input.directOperator?.status === "past_reference_only" ||
    input.directOperator?.status === "offer_transfer" ||
    input.directOperator?.status === "operator_absent" ||
    input.directOperator?.status === "ambiguous_homonym";
  // Fluxos informativos não-lead (currículos/RH e fornecedores/parcerias) encerram com orientação
  // oficial (Sólides / adm@tecfag.com.br) mesmo quando a pessoa diz "falar com o setor de compras"
  // ou "falar com alguém do RH", sem abrir fila humana nem aprovação SDR.
  if (
    !isIndustrialInformativeSubflow(fromCurrentText) &&
    (suppressNominalHumanRegex
      ? requestsGenericHuman(input.text || "")
      : requestsHuman(input.text || ""))
  ) {
    return routeFor("5A_CLIENTE", "human_requested", true);
  }
  const interest = collectedValue(
    input.collectedData,
    "MÁQUINA / PEÇA / INTERESSE",
    "SOLICITAÇÃO",
    "QUAL O TIPO DE PRODUTO?",
    "PRODUTO DE INTERESSE",
  );
  const existing =
    declaredSubflow(input.existingSubflow) ||
    declaredSubflow(input.existingFunnel) ||
    declaredSubflow(collectedValue(input.collectedData, "SETOR / FUNIL DE DESTINO", "SETOR"));
  const declared = declaredSubflow(input.aiSubflow) || declaredSubflow(input.aiTargetFunnel);
  const hardCurrent = strictHardOverrideSubflow(input.text || "", existing);
  const fromFields = textSubflow(interest);
  const commercial = new Set<IndustrialSubflow>(["MAQUINAS", "PERSONNALITE"]);

  // Proteção contra falso PECAS do próprio LLM quando o cliente quer máquina p/ embalar peças
  // (ex.: "embalar peças de carro") ou está em manutenção técnica ("não sabemos se alguma peça danificada").
  let effectiveDeclared = declared;
  if (declared === "PECAS") {
    const rawCombined = normalizeTriageText(`${input.text || ""} ${interest}`);
    const hasExplicitPart =
      isExplicitReplacementPartsIntent(input.text || "") ||
      isExplicitReplacementPartsIntent(interest);
    const interestIsMachine = fromFields !== null && commercial.has(fromFields);
    const interestIsSupport = fromFields === "3_AT";
    const mentionsPartsWordOnlyAsProductOrDamage =
      /\b(?:pecas?|insumos?)\b/.test(rawCombined) && !isReplacementPartsIntent(rawCombined);
    if (!hasExplicitPart && existing === "3_AT" && (interestIsSupport || mentionsPartsWordOnlyAsProductOrDamage)) {
      effectiveDeclared = "3_AT";
    } else if (!hasExplicitPart && interestIsMachine && existing && commercial.has(existing)) {
      effectiveDeclared = existing;
    } else if (
      !hasExplicitPart &&
      mentionsPartsWordOnlyAsProductOrDamage &&
      /\b(?:embalar|empacotar|selar|envasar|dosar|rotular|maquina|equipamento|solucao|linha|personnalite)\b/.test(
        rawCombined,
      )
    ) {
      effectiveDeclared = "MAQUINAS";
    }
  }

  // Nova hierarquia de autoridade (Decisão 1):
  // 1) hardCurrent: override estrito apenas p/ casos 100% inequívocos (currículo, fornecedor, estorno, 2ª via boleto, defeito explícito, rastreio de pedido já comprado).
  // 2) effectiveDeclared: classificação semântica do Gemini no contexto completo da conversa (SOBERANA sobre regex fraco).
  // 3) strictFieldOverride: apenas quando Gemini retornou null e o interesse já tem intenção inequívoca.
  // 4) Fallback heurístico (fromCurrentText / fromFields) + estabilidade da rota anterior (existing).
  const strictFieldOverride = !effectiveDeclared
    ? strictHardOverrideSubflow(interest, existing)
    : null;

  const effectiveFallbackText =
    fromCurrentText === "PECAS" &&
    existing &&
    (commercial.has(existing) || existing === "3_AT") &&
    !isExplicitReplacementPartsIntent(input.text || "")
      ? null
      : fromCurrentText;

  let subflow =
    hardCurrent ||
    effectiveDeclared ||
    strictFieldOverride ||
    effectiveFallbackText ||
    fromFields ||
    null;
  let reason: IndustrialRoute["reason"] = hardCurrent
    ? "intent"
    : effectiveDeclared
      ? "declared_route"
      : strictFieldOverride || effectiveFallbackText || fromFields
        ? "intent"
        : "declared_route";

  if (!subflow) {
    subflow = existing;
    reason = "previous_route";
  }
  if (input.aiFunnelStage === "sem_resposta" && !fromCurrentText && !declared && !fromFields) {
    return {
      subflow: null,
      funnelStage: "sem_resposta",
      targetFunnel: null,
      needsReview: false,
      reason: "unknown",
    };
  }
  if (!subflow) {
    const other = input.aiFunnelStage === "outros" && !suppressNominalHumanRegex;
    if (other) return routeFor("5A_CLIENTE", "unknown", true);
    return {
      subflow: null,
      funnelStage: other ? "outros" : "triagem",
      targetFunnel: null,
      needsReview: other,
      reason: "unknown",
    };
  }
  if (commercial.has(subflow)) {
    const evidence = input.machineEvidence;
    const trusted =
      evidence &&
      ["catalog", "manual_review"].includes(evidence.source) &&
      Number.isFinite(evidence.confidence) &&
      evidence.confidence >= 0.7 &&
      evidence.confidence <= 1;
    if (trusted)
      return routeFor(evidence.group === "PERSONNALITE" ? "PERSONNALITE" : "MAQUINAS", reason);
    const mentionsPremium =
      subflow === "PERSONNALITE" ||
      /\b(?:personnalite|personalite)\b/.test(
        normalizeTriageText(`${input.text || ""} ${interest}`),
      );
    return routeFor(
      "MAQUINAS",
      mentionsPremium ? "classification_pending" : reason,
      mentionsPremium,
    );
  }
  return routeFor(subflow, reason);
}

function routeFor(
  subflow: IndustrialSubflow,
  reason: IndustrialRoute["reason"],
  needsReview = false,
): IndustrialRoute {
  return {
    subflow,
    funnelStage: INDUSTRIAL_ROUTES[subflow].stage,
    targetFunnel: INDUSTRIAL_ROUTES[subflow].funnel,
    needsReview: needsReview || subflow === "5A_CLIENTE",
    reason,
  };
}

/** Validação local de CPF/CNPJ; não prova titularidade nem situação cadastral. */
export function isValidTriageDocument(raw: string): boolean {
  if (!/^[\d.\s/()-]+$/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  if (![11, 14].includes(digits.length) || /^(\d)\1+$/.test(digits)) return false;
  const check = (body: string, weights: number[]) => {
    const sum = [...body].reduce(
      (total, digit, index) => total + Number(digit) * weights[index],
      0,
    );
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  };
  const weights =
    digits.length === 11 ? [10, 9, 8, 7, 6, 5, 4, 3, 2] : [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const body = digits.slice(0, -2);
  const first = check(body, weights);
  const second = check(body + first, digits.length === 11 ? [11, ...weights] : [6, ...weights]);
  return digits.endsWith(`${first}${second}`);
}

export const INDUSTRIAL_ALL_DISPLAY_FIELDS = [
  "NOME COMPLETO",
  "EMPRESA",
  "CNPJ OU CPF",
  "RAMO / O QUE EMBALA",
  "MÁQUINA / PEÇA / INTERESSE",
  "VOLUME / PRODUÇÃO",
  "SETOR / FUNIL DE DESTINO",
] as const;

export type IndustrialDisplayField = (typeof INDUSTRIAL_ALL_DISPLAY_FIELDS)[number];

export interface AdaptiveIndustrialFieldContext {
  subflow?: string | null;
  funnelStage?: string | null;
  targetFunnel?: string | null;
  collectedData?: CollectedFields | null;
  company?: string | null;
  document?: string | null;
  isCompleted?: boolean;
  text?: string;
}

export function resolveEffectiveIndustrialSubflow(
  ctx: AdaptiveIndustrialFieldContext,
): IndustrialSubflow | null {
  const data = ctx.collectedData || {};
  const fromExplicit = declaredSubflow(ctx.subflow);
  if (fromExplicit) return fromExplicit;

  const fromDataSector = declaredSubflow(
    collectedValue(data, "SETOR / FUNIL DE DESTINO", "SETOR"),
  );
  if (fromDataSector) return fromDataSector;

  const fromTargetFunnel = declaredSubflow(ctx.targetFunnel);
  if (fromTargetFunnel) return fromTargetFunnel;

  const stage = normalizeTriageText(ctx.funnelStage || "");
  if (stage === "maquinas") return "MAQUINAS";
  if (stage === "personalite") return "PERSONNALITE";
  if (stage === "pecas") return "PECAS";
  if (stage === "assistencia tecnica") return "3_AT";
  if (stage === "pos venda") return "POS_VENDA";
  if (stage === "financeiro") {
    const hasDoc = Boolean(
      collectedValue(data, "CNPJ OU CPF", "CNPJ", "CPF") ||
        (ctx.document && ctx.document.trim()) ||
        data._KNOWN_COMPANY_CONFIRMED?.status === "filled",
    );
    return hasDoc ? "2A_BOLETO" : "2C_OUTROS";
  }
  if (stage === "outros") return "5A_CLIENTE";

  return resolveIndustrialRoute({
    text: ctx.text,
    collectedData: data,
    existingSubflow: ctx.subflow,
    existingStage: ctx.funnelStage,
    existingFunnel: ctx.targetFunnel,
  }).subflow;
}

/**
 * Retorna a lista de campos do painel "Dados Coletados" adaptada ao setor/subfluxo da triagem.
 * Setores não-comerciais (Peças, Assistência Técnica, Financeiro, Pós-Venda, Outros) exibem
 * apenas os campos pertinentes ao seu fluxo (mais quaisquer campos extras já preenchidos).
 */
export function getIndustrialTargetFields(
  ctx: AdaptiveIndustrialFieldContext,
): IndustrialDisplayField[] {
  const data = ctx.collectedData || {};
  const subflow = resolveEffectiveIndustrialSubflow(ctx);

  if (!subflow || subflow === "MAQUINAS" || subflow === "PERSONNALITE") {
    return [...INDUSTRIAL_ALL_DISPLAY_FIELDS];
  }

  const policyFields = new Set<RequiredField>(
    INDUSTRIAL_ROUTES[subflow].fields as readonly RequiredField[],
  );

  const hasCompanyValue = Boolean(
    collectedValue(data, "EMPRESA") || (ctx.company && ctx.company.trim()),
  );
  const hasDocValue = Boolean(
    collectedValue(data, "CNPJ OU CPF", "CNPJ", "CPF") ||
      (ctx.document && ctx.document.trim()) ||
      data._KNOWN_COMPANY_CONFIRMED?.status === "filled",
  );
  const hasApplicationValue = Boolean(collectedValue(data, "RAMO / O QUE EMBALA"));
  const hasProductionValue = Boolean(collectedValue(data, "VOLUME / PRODUÇÃO"));
  const hasNameValue = Boolean(collectedValue(data, "NOME COMPLETO"));
  const hasRequestValue = Boolean(
    collectedValue(
      data,
      "MÁQUINA / PEÇA / INTERESSE",
      "SOLICITAÇÃO",
      "QUAL O TIPO DE PRODUTO?",
      "PRODUTO DE INTERESSE",
    ),
  );

  const result: IndustrialDisplayField[] = [];

  if (policyFields.has("name") || hasNameValue || (!ctx.isCompleted && policyFields.size === 0)) {
    result.push("NOME COMPLETO");
  }

  if (policyFields.has("document") || hasCompanyValue) {
    result.push("EMPRESA");
  }

  if (policyFields.has("document") || hasDocValue) {
    result.push("CNPJ OU CPF");
  }

  if (policyFields.has("application") || hasApplicationValue) {
    result.push("RAMO / O QUE EMBALA");
  }

  if (
    policyFields.has("request") ||
    hasRequestValue ||
    (!ctx.isCompleted && policyFields.size === 0)
  ) {
    result.push("MÁQUINA / PEÇA / INTERESSE");
  }

  if (policyFields.has("production") || hasProductionValue) {
    result.push("VOLUME / PRODUÇÃO");
  }

  result.push("SETOR / FUNIL DE DESTINO");
  return result;
}

/**
 * Normaliza o dicionário `collectedData` para exibição e cálculo de progresso:
 * - Remove chaves internas iniciadas por `_`
 * - Preenche `EMPRESA` quando já conhecida no cadastro/sessão (ou "Pessoa Física (CPF)" quando CPF válido sem empresa)
 * - Preenche `CNPJ OU CPF` quando já conhecido no vínculo ou confirmado pelo cadastro
 * - Preenche `SETOR / FUNIL DE DESTINO` a partir da rota identificada
 */
export function getAdaptiveIndustrialCollectedData(
  ctx: AdaptiveIndustrialFieldContext,
): CollectedFields {
  const raw = ctx.collectedData || {};
  const subflow = resolveEffectiveIndustrialSubflow(ctx);
  const targetFields = getIndustrialTargetFields(ctx);

  const normalized: CollectedFields = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    normalized[key] = entry ? { ...entry } : { value: "Aguardando...", status: "pending" };
  }

  const nameVal = collectedValue(raw, "NOME COMPLETO");
  const companyVal =
    collectedValue(raw, "EMPRESA") || (ctx.company && ctx.company.trim() ? ctx.company.trim() : "");
  const docVal =
    collectedValue(raw, "CNPJ OU CPF", "CNPJ", "CPF") ||
    (ctx.document && ctx.document.trim() ? ctx.document.trim() : "");
  const appVal = collectedValue(raw, "RAMO / O QUE EMBALA");
  const reqVal = collectedValue(
    raw,
    "MÁQUINA / PEÇA / INTERESSE",
    "SOLICITAÇÃO",
    "QUAL O TIPO DE PRODUTO?",
    "PRODUTO DE INTERESSE",
  );
  const prodVal = collectedValue(raw, "VOLUME / PRODUÇÃO");
  const routeFunnel =
    collectedValue(raw, "SETOR / FUNIL DE DESTINO", "SETOR") ||
    (ctx.targetFunnel && ctx.targetFunnel.trim() ? ctx.targetFunnel.trim() : "") ||
    (subflow ? INDUSTRIAL_ROUTES[subflow].funnel : "");

  const isCpfOnly =
    Boolean(docVal) &&
    docVal.replace(/\D/g, "").length === 11 &&
    isValidTriageDocument(docVal) &&
    !companyVal;

  const isKnownCompanyConfirmed =
    raw._KNOWN_COMPANY_CONFIRMED?.status === "filled" && Boolean(companyVal);

  const resolvedValues: Record<IndustrialDisplayField, string> = {
    "NOME COMPLETO": nameVal,
    EMPRESA: companyVal || (isCpfOnly && ctx.isCompleted ? "Pessoa Física (CPF)" : ""),
    "CNPJ OU CPF": docVal || (isKnownCompanyConfirmed ? "Vinculado ao cadastro" : ""),
    "RAMO / O QUE EMBALA": appVal,
    "MÁQUINA / PEÇA / INTERESSE": reqVal,
    "VOLUME / PRODUÇÃO": prodVal,
    "SETOR / FUNIL DE DESTINO": routeFunnel,
  };

  const result: CollectedFields = {};
  for (const field of targetFields) {
    const val = resolvedValues[field];
    if (val) {
      result[field] = { value: val, status: "filled" };
    } else {
      result[field] = { value: "Aguardando...", status: "pending" };
    }
  }

  return result;
}

export function computeIndustrialTriageProgress(ctx: AdaptiveIndustrialFieldContext): {
  filledCount: number;
  totalCount: number;
  percentage: number;
  targetFields: IndustrialDisplayField[];
  adaptiveData: CollectedFields;
} {
  const targetFields = getIndustrialTargetFields(ctx);
  const adaptiveData = getAdaptiveIndustrialCollectedData(ctx);
  const totalCount = targetFields.length || 1;
  const filledCount = targetFields.filter((key) =>
    Boolean(collectedValue(adaptiveData, key)),
  ).length;

  const percentage = Math.min(100, Math.round((filledCount / totalCount) * 100));

  return {
    filledCount,
    totalCount,
    percentage,
    targetFields,
    adaptiveData,
  };
}

export function assessIndustrialReadiness(
  route: IndustrialRoute,
  data: CollectedFields,
): {
  ready: boolean;
  missing: RequiredField[];
  action: "collect" | "handoff" | "inform" | "review";
  createsDeal: boolean;
} {
  if (route.reason === "direct_operator_requested" && route.targetOperator?.id) {
    return { ready: true, missing: [], action: "handoff", createsDeal: false };
  }
  if (!route.subflow)
    return {
      ready: false,
      missing: [],
      action: route.needsReview ? "review" : "collect",
      createsDeal: false,
    };
  const policy = INDUSTRIAL_ROUTES[route.subflow];
  const hasVerifiedKnownCompany =
    data._KNOWN_COMPANY_CONFIRMED?.status === "filled" &&
    Boolean(collectedValue(data, "EMPRESA"));
  const available: Record<RequiredField, boolean> = {
    name: Boolean(collectedValue(data, "NOME COMPLETO")),
    document:
      isValidTriageDocument(collectedValue(data, "CNPJ OU CPF", "CNPJ", "CPF")) ||
      hasVerifiedKnownCompany,
    request: Boolean(
      collectedValue(
        data,
        "MÁQUINA / PEÇA / INTERESSE",
        "SOLICITAÇÃO",
        "QUAL O TIPO DE PRODUTO?",
        "PRODUTO DE INTERESSE",
      ),
    ),
    application: Boolean(collectedValue(data, "RAMO / O QUE EMBALA")),
    production: Boolean(collectedValue(data, "VOLUME / PRODUÇÃO")),
  };
  const missing = (policy.fields as readonly RequiredField[]).filter((key) => !available[key]);
  if (
    route.reason === "human_requested" ||
    route.reason === "specialist_review" ||
    route.reason === "direct_operator_not_found"
  )
    return { ready: true, missing: [], action: "review", createsDeal: false };
  return {
    ready: missing.length === 0,
    missing,
    action: missing.length ? "collect" : route.needsReview ? "review" : policy.action,
    createsDeal: policy.createsDeal && !route.needsReview,
  };
}

/** Critérios de conclusão separados das palavras de despedida produzidas pelo modelo. */
export function canFinishIndustrialTriage(params: {
  route: IndustrialRoute;
  data: CollectedFields;
  isCompleted?: boolean;
  hasPendingQuestion?: boolean;
}): boolean {
  const ready = assessIndustrialReadiness(params.route, params.data);
  if (
    params.route.reason === "human_requested" ||
    params.route.reason === "specialist_review" ||
    params.route.reason === "direct_operator_not_found" ||
    (params.route.reason === "direct_operator_requested" && Boolean(params.route.targetOperator?.id))
  )
    return true;
  if (ready.action === "inform") return true;
  return ready.ready && params.isCompleted === true && !params.hasPendingQuestion;
}

const INVALID_PERSON_NAME_EXACT = new Set([
  "em reuniao",
  "ocupado",
  "ausente",
  "disponivel",
  "online",
  "offline",
  "nome privado",
  "privado",
  "cliente",
  "cliente whatsapp",
  "contato",
  "visitante",
  "usuario",
  "lead",
  "whatsapp",
  "sem nome",
  "nao informado",
  "nao informada",
  "comercial",
  "financeiro",
  "vendas",
  "compras",
  "atendimento",
  "suporte",
  "sac",
  "adm",
  "admin",
  "administrativo",
  "rh",
  "ti",
  "marketing",
  "recepcao",
  "escritorio",
  "empresa",
]);

const INVALID_PERSON_NAME_MOTTO_PATTERN =
  /\b(?:deus\s+no\s+controle|fe\s+em\s+deus|jesus\s+e\s+fiel|so\s+deus|abencoad[oa]\s+por\s+deus|gratidao\s+a\s+deus)\b/i;

/**
 * Valida se um valor representa um nome humano plausível (impedindo que apelidos/status
 * de perfil do WhatsApp como "Em Reuniao", ".", "DEUS NO CONTROLE 😎", e-mails ou telefones virem NOME COMPLETO).
 */
export function isValidIndustrialPersonName(raw?: string | null): boolean {
  const clean = String(raw || "").trim();
  if (!clean) return false;
  if (clean.includes("@")) return false;
  // Rejeita nomes com emojis (ex.: "DEUS NO CONTROLE 😎", "Bem Natural 💚")
  if (/\p{Extended_Pictographic}/u.test(clean)) return false;
  const digitsOnly = clean.replace(/[\s().+-]/g, "");
  if (/^\d{6,20}$/.test(digitsOnly)) return false;
  const normalized = normalizeTriageText(clean);
  if (!normalized || normalized.length < 2) return false;
  if (INVALID_PERSON_NAME_EXACT.has(normalized)) return false;
  if (INVALID_PERSON_NAME_MOTTO_PATTERN.test(normalized)) return false;
  // Rejeita apenas pontuação/símbolos/emojis sem ao menos 2 letras reais
  const lettersOnly = clean.replace(/[^\p{L}]/gu, "");
  if (lettersOnly.length < 2) return false;
  return true;
}

/**
 * Detecta resistência explícita do cliente à pergunta de produtividade/volume quando os demais
 * dados comerciais (nome, empresa/CNPJ, máquina e aplicação) já foram fornecidos — evitando
 * loops repetitivos de cobrança de produção (ex.: "me passa as opções e suas capacidades",
 * "sem mais perguntas", "não importa quanto produzo").
 */
export function isClientResistingProductionQuestion(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (!text || text.length > 260) return false;
  // Se trouxe um número com unidade/cadência real de produção, não é resistência — é resposta válida!
  if (
    /\b\d[\d.,]*\s*(?:mil\s+)?(?:un(?:id(?:ade)?s?)?|pcs?|pecas?|pacotes?|sacos?|potes?|frascos?|garrafas?|caixas?|capsulas?|saches?|kg|quilos?|litros?|l)\s*(?:\/|\bpor\b|\bao\b|\bna\b|\bno\b)\s*(?:min(?:uto)?|h|hr|hora|dia|semana|mes|turno)\b/.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /\b(?:sem\s+mais\s+perguntas|chega\s+de\s+perguntas|nao\s+quero\s+responder\s+mais)\b/.test(text) ||
    /\b(?:me\s+(?:passa|manda|envia|mostra)|passa|manda|mostra)\s+(?:as\s+|os\s+)?(?:opcoes|modelos|maquinas|equipamentos|catalogo)\s*(?:e\s+(?:as\s+|suas\s+)?capacidades|que\s+(?:eu\s+)?vejo|pra\s+eu\s+ver|para\s+eu\s+ver|primeiro)\b/.test(
      text,
    ) ||
    /\b(?:nao\s+importa\s+(?:quanto|a\s+producao|o\s+volume)|prefiro\s+ver\s+as\s+opcoes|depois\s+vejo\s+(?:a\s+)?(?:producao|media)|nao\s+sei\s+(?:informar|dizer)\s+(?:a\s+)?(?:producao|produtividade|media|volume)|nao\s+tenho\s+(?:como\s+saber|essa\s+estimativa|uma\s+estimativa|estimativa\s+agora|media\s+definida))\b/.test(
      text,
    )
  );
}

/**
 * Detecta resposta mínima/frustrada enviada logo após resistência à produtividade
 * (ex.: ".", "...", "nao sei", "nao tenho media").
 */
export function isTerseProductionFrustrationTurn(raw: string): boolean {
  const clean = String(raw || "").trim();
  if (!clean) return false;
  const text = normalizeTriageText(clean);
  if (!/[a-z0-9]/.test(text)) return true; // ex.: ".", "...", "?"
  return /^(?:nao sei|sei nao|nao tenho|nao tenho media|nao tenho uma media correta|tanto faz|pula|pode seguir|sem mais perguntas|ja disse|ja falei)$/.test(
    text,
  );
}

/**
 * Detecta respostas excessivamente vagas para `VOLUME / PRODUÇÃO` sem números nem escala real
 * (ex.: "muito", "muito trigo", "bastante", "pouco", "muita coisa"), evitando marcar o campo
 * como preenchido antes de o cliente informar uma ordem de grandeza aproximada.
 */
export function isVagueIndustrialProductionValue(raw?: string | null): boolean {
  const normalized = normalizeTriageText(String(raw || ""));
  if (!normalized) return true;
  // Qualquer dígito numérico (ex.: "3000/h", "50 por dia") ou declaração explícita de desconhecimento/escala já é válida
  if (/\d/.test(normalized)) return false;
  if (
    /\b(?:nao sei|nao sei informar|nao tenho como saber|sem estimativa|nao tenho estimativa|nao tenho media|nao tenho uma media|ainda nao tenho essa informacao|nao tenho essa informacao|nao informado|a definir com especialista|ainda nao sei|ainda nao defini|comecando agora|iniciando|artesanal|escala industrial|pequena producao|media producao|alta producao|grande producao|pequena escala|media escala|alta escala|grande escala|baixo volume|medio volume|alto volume|grande volume)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  return /^(?:muit[oa]s?|bastante|pouc[oa]s?|vari[oa]s?|um pouco|demais|bem pouco|muita coisa|bastante coisa|grande quantidade|alta quantidade|em grande quantidade)(?:\s+[a-z]{2,}){0,3}$/.test(
    normalized,
  );
}

/**
 * Detecta quando o cliente informa objetivamente que não sabe ou não possui a informação de
 * produtividade/volume ("ainda não tenho essa informação", "não tenho estimativa", etc.), além
 * da recusa explícita já tratada por `isClientResistingProductionQuestion`.
 */
export function isClientUnableOrRefusingProduction(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (!text || text.length > 320) return false;
  if (
    /\b\d[\d.,]*\s*(?:mil\s+)?(?:un(?:id(?:ade)?s?)?|pcs?|pecas?|pacotes?|sacos?|potes?|frascos?|garrafas?|caixas?|capsulas?|saches?|kg|quilos?|litros?|l)\s*(?:\/|\bpor\b|\bao\b|\bna\b|\bno\b)\s*(?:min(?:uto)?|h|hr|hora|dia|semana|mes|turno)\b/.test(
      text,
    )
  ) {
    return false;
  }
  if (isClientResistingProductionQuestion(raw)) return true;
  return (
    /\b(?:ainda\s+)?nao\s+tenho\s+(?:essa\s+|esta\s+)?(?:informacao|media|estimativa|previsao|dado|numero|ideia)\b/.test(
      text,
    ) ||
    /\bnao\s+(?:sei|sabemos)\s+(?:ainda|informar|dizer|estimar|a\s+media|o\s+volume|a\s+producao|a\s+produtividade|quanto)\b/.test(
      text,
    ) ||
    /\b(?:nao\s+faco\s+ideia|sem\s+(?:media|estimativa|previsao)\s*(?:de\s+producao|ainda)?|ainda\s+nao\s+defini(?:mos)?|nao\s+temos\s+(?:essa\s+)?(?:informacao|media|estimativa))\b/.test(
      text,
    )
  );
}

/**
 * Detecta quando o cliente recusa continuar respondendo ao questionário de qualificação, já é
 * cliente recorrente pronto para comprar/Pix de modelo conhecido, ou pede contato humano por
 * ligação/celular — devendo escalar imediatamente para Análise e revisão humana sem forçar barra.
 */
export function isClientRefusingAdditionalQualification(raw: string): boolean {
  const clean = String(raw || "").trim();
  if (!clean || clean.length > 420) return false;
  if (isClientDecliningTriage(clean) || isAutomatedBotOrUraMessage({ text: clean })) {
    return false;
  }
  if (isClientResistingProductionQuestion(clean)) return true;
  const text = normalizeTriageText(clean);
  if (!text) return false;

  // 1. Recusa explícita de continuar questionário / informar dados (CNPJ, CPF, volume, etc.)
  if (
    /\b(?:nao\s+quero\s+(?:passar|informar|fornecer|dar|responder)|prefiro\s+nao\s+(?:passar|informar|fornecer|responder)|nao\s+vou\s+(?:passar|informar)|nao\s+estou\s+com\s+(?:o\s+)?(?:cnpj|cpf)|sem\s+(?:o\s+)?(?:cnpj|cpf)\s+(?:agora|aqui|facil)|muitas\s+perguntas|para\s+de\s+perguntar|chega\s+de\s+perguntas|sem\s+mais\s+perguntas|so\s+quero\s+(?:o\s+)?(?:preco|valor|orcamento|cotacao|falar\s+com\s+(?:um\s+)?(?:vendedor|consultor|humano|atendente)))\b/.test(
      text,
    )
  ) {
    return true;
  }

  // Não sequestra solicitações genuínas de assistência técnica/defeito ou peças de reposição
  const isSupportOrPartsContext =
    /\b(?:defeito|quebrou|nao\s+(?:liga|funciona|sela|corta|esquenta)|manual|assistencia\s+tecnica|suporte\s+tecnico|peca\s+de\s+reposicao|pecas\s+de\s+reposicao|resistencia|teflon|correia)\b/.test(
      text,
    );

  // 2. Cliente recorrente que já possui/conhece a máquina e dispensa triagem técnica (Paulo/DB, Ricardo)
  if (!isSupportOrPartsContext) {
    const ownsMultipleOrPrior =
      /\b(?:ja\s+)?(?:tenho|temos|uso|usamos|possuo|possuimos|comprei|compramos)\s+(?:varias?|diversas?|uma|duas|tres|\d+)\s+(?:maquinas?|seladoras?|envasadoras?|dosadoras?|rotuladoras?|empacotadoras?|equipamentos?)\b/.test(
        text,
      );
    const recurrentBypassCue =
      /\b(?:ja\s+conheco|conheco\s+o\s+produto|de\s+reserva|mais\s+uma|desculpe|nao\s+precisa\s+de|so\s+quero|so\s+preciso)\b/.test(
        text,
      );
    const knowsProductOrIsClient =
      /\b(?:ja\s+conheco\s+(?:o\s+produto|a\s+maquina|o\s+equipamento|os\s+equipamentos)|ja\s+sou\s+cliente|ja\s+somos\s+clientes?)\b/.test(
        text,
      );
    const commercialBypassCue =
      /\b(?:tenho\s+\d+|varias?\s+(?:seladoras?|maquinas?|envasadoras?)|so\s+(?:quero|preciso)|desculpe|preco|valor|proposta|pix|orcamento|cotacao|comprar\s+mais\s+uma)\b/.test(
        text,
      );
    if (
      (ownsMultipleOrPrior && recurrentBypassCue) ||
      (knowsProductOrIsClient && commercialBypassCue)
    ) {
      return true;
    }
  }

  // 3. Pronto para pagar / pedido explícito de chave Pix (Ricardo Wennek)
  if (
    /\b(?:ja\s+me\s+)?(?:manda|envia|passa)\s+(?:(?:o|a)\s+)?(?:chave\s+)?pix\b/.test(text) ||
    /\bchave\s+pix\b.*\b(?:ja\s+faco|ja\s+pago|vou\s+pagar|fechar|comprar)\b/.test(text)
  ) {
    return true;
  }

  // 4. Pedido explícito de contato por ligação / celular (Luiz Ernani)
  if (
    /\b(?:poderia|pode|consegue|prefiro\s+que)\s+me\s+(?:chamar|ligar)\s+(?:via\s+|no\s+|por\s+|pelo\s+)?(?:celular|telefone|ligacao|whats(?:app)?)\b/.test(
      text,
    ) ||
    /\b(?:me\s+liga|liga\s+(?:pra|para)\s+mim|quero\s+(?:falar|conversar)\s+(?:por|ao)\s+telefone|prefiro\s+(?:falar|conversar)\s+por\s+(?:telefone|ligacao))\b/.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}

/** Verifica se o próprio Fagner já perguntou um determinado campo obrigatório neste ciclo. */
export function botAlreadyAskedMissingField(
  botMessages: readonly string[],
  field: RequiredField,
): boolean {
  const pattern = (() => {
    switch (field) {
      case "production":
        return /\b(?:producao|produtividade|volume\s+de\s+producao|volume\s+aproximado|quantos?\s+(?:pacotes?|sacos?|frascos?|unidades?|potes?|kg|quilos?|packs?|kits?|caixas?)\s+(?:por|\/))\b/;
      case "document":
        return /\b(?:cnpj|cpf|nome\s+da\s+sua\s+empresa|para\s+qual\s+empresa)\b/;
      case "application":
        return /\b(?:o\s+que\s+(?:exatamente\s+)?(?:voce\s+)?(?:vai|pretende|precisa)\s+(?:embalar|envasar|selar|produzir|processar|rotular|datar)|qual\s+(?:sera\s+a\s+|e\s+a\s+)?aplicacao|qual\s+produto\s+voce\s+pretende)\b/;
      case "name":
        return /\b(?:qual\s+(?:e\s+)?(?:o\s+)?seu\s+nome|como\s+(?:voce\s+)?se\s+chama)\b/;
      case "request":
        return /\b(?:qual\s+(?:maquina|equipamento|peca|solucao)|como\s+posso\s+te\s+ajudar)\b/;
      default:
        return null;
    }
  })();
  if (!pattern) return false;
  return botMessages.some((msg) => {
    const text = normalizeTriageText(String(msg || ""));
    return Boolean(text && pattern.test(text));
  });
}

const ACTIVE_DEMAND_CUE_PATTERN =
  /\b(?:maquina|maquinas|seladora|seladoras|envasadora|envasadoras|dosadora|dosadoras|empacotadora|empacotadoras|rotuladora|rotuladoras|datador|peca|pecas|teflon|resistencia|correia|borracha|pistao|vedacao|boleto|nota fiscal|nf|rastreio|entrega|nao recebi|ainda nao recebi|nao chegou|defeito|manutencao|assistencia|orcamento|cotacao|preco|valor|quero comprar|preciso de|manda (?:a )?foto|envia (?:a )?foto|mande foto|consegue verificar|voces vendem|vcs vendem|segmento de|linha de)\b/;

/**
 * Detecta se o cliente fez uma pergunta informativa/institucional junto com a recusa
 * (ex.: "Agora não mais. Já fiz a compra com outra empresa. Vcs são de onde"), permitindo
 * responder a dúvida rapidamente e ainda encerrar limpo sem aprovação/transferência.
 */
export function hasClientFactualQuestionInDecline(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (!text) return false;
  return (
    raw.includes("?") ||
    /\b(?:vcs sao de onde|voces sao de onde|de onde voces sao|onde voces ficam|onde fica|qual cidade|qual endereco|qual telefone|qual o site|qual site|tem garantia|qual a garantia|tem assistencia)\b/.test(
      text,
    )
  );
}

/**
 * Detecta desistência/recusa educada explícita do cliente (ex.: "Não, agradeço", "Não tenho interesse",
 * "deixa quieto", "já comprei na Shopee", "já fui atendido e já comprei", "no momento não")
 * sem nova demanda comercial/suporte na mesma mensagem.
 */
export function isClientDecliningTriage(raw: string): boolean {
  const text = normalizeTriageText(raw);
  if (!text || text.length > 320) return false;

  // Desistência/recusa inequívoca (inclusive quando acompanhada de frustração mencionando "máquina"/"vendedor")
  const hasExplicitWalkAway =
    /\b(?:vamos\s+deixar\s+quieto|deix[ae]r?\s+quieto|deix[ae]r?\s+pra\s+la|pode\s+encerrar|desisti|nao\s+quero\s+mais|nao\s+preciso\s+mais|nao\s+tenho\s+interesse|pode\s+esquecer|esquece\s+isso)\b/.test(
      text,
    );
  const hasActiveBuyingAsk =
    /\b(?:quero\s+comprar|preciso\s+de\s+uma?|me\s+passa\s+o?\s*(?:valor|preco|orcamento)|quanto\s+custa|faz\s+um?\s*orcamento|quero\s+cotacao|voces\s+vendem|vcs\s+vendem)\b/.test(
      text,
    );
  if (hasExplicitWalkAway && !hasActiveBuyingAsk) {
    return true;
  }

  const hasNewDemand = ACTIVE_DEMAND_CUE_PATTERN.test(text);

  // Cliente informa explicitamente que já comprou em outra empresa / marketplace concorrente
  const hasBoughtElsewhere =
    /\b(?:ja\s+)?(?:comprei|compramos|adquiri|adquirimos|fechei|fechamos|fiz(?:emos)?\s+a\s+compra)\s+(?:na\s+shopee|no\s+mercado\s*livre|na\s+amazon|na\s+magalu|com\s+outr[ao]\s*(?:empresa|fornecedor|loja|vendedor)?|em\s+outr[ao]\s*(?:empresa|lugar|loja|fornecedor)?|por\s+fora|no\s+concorrente|na\s+concorrencia)\b/.test(
      text,
    );
  if (hasBoughtElsewhere && !hasNewDemand) {
    return true;
  }

  // Cliente informa que já comprou a máquina/equipamento procurado (inclusive em transcrição de áudio)
  // sem pedir peça, manutenção, foto ou outro equipamento na mesma mensagem.
  const hasAlreadyBoughtTargetMachine =
    /\b(?:(?:eu\s+|nos\s+)?ja\s+(?:comprei|compramos|adquiri|adquirimos|comprou)\s+(?:a\s+|o\s+)?(?:maquina|equipamento)(?:\s+que\s+(?:eu\s+)?(?:estava|estavamos|estava)\s+(?:procurando|buscando|precisando|cotando))?)\b/.test(
      text,
    );
  const hasFollowOnNeedWithMachine =
    /\b(?:peca|pecas|borracha|vedacao|pistao|resistencia|teflon|correia|defeito|quebrou|nao\s+funciona|nao\s+liga|nao\s+recebi|ainda\s+nao\s+recebi|rastreio|manda\s+(?:a\s+)?foto|envia\s+(?:a\s+)?foto|aproveitando|mas\s+(?:quero|preciso|gostaria)|agora\s+(?:quero|preciso)|outra\s+maquina|mais\s+uma)\b/.test(
      text,
    );
  if (hasAlreadyBoughtTargetMachine && !hasActiveBuyingAsk && !hasFollowOnNeedWithMachine) {
    return true;
  }

  if (text.length > 180) return false;
  if (hasNewDemand) return false;

  return (
    /^(?:nao|n)\s*,?\s*(?:muito\s+)?(?:obrigad[oa]|agradeco|valeu|bgd|obg)[!.]*$/.test(text) ||
    /^(?:obrigad[oa]|agradeco)\s*,?\s*(?:mas\s+)?nao(?:\s+(?:preciso|quero|tenho interesse))?[!.]*$/.test(
      text,
    ) ||
    /^(?:no\s+momento\s+nao|agora\s+nao(?:\s+mais)?|por\s+enquanto\s+nao|no\s+momento\s+nao\s+(?:preciso|quero|tenho|possuo\s+nenhuma\s+solicitacao(?:\s+em\s+andamento)?)|agora\s+nao\s+(?:preciso|quero))(?:\s*,?\s*(?:muito\s+)?(?:obrigad[oa]|agradeco|valeu|obg))?[!.]*$/.test(
      text,
    ) ||
    /\b(?:ja\s+resolvi(?:do)?|ja\s+resolvemos(?:\s+ja)?|ja\s+foi\s+resolvido|ja\s+comprei\s+em\s+outro|ja\s+fui\s+atendid[oa]|ja\s+estou\s+sendo\s+atendid[oa]|ja\s+estamos\s+sendo\s+atendid[oa]s|nao\s+precisa\s+mais|por\s+enquanto\s+nao(?:,\s*(?:obrigad[oa]|agradeco))?)\b/.test(
      text,
    ) ||
    /^(?:(?:muito\s+)?(?:obrigad[oa]|agradeco|valeu|oi|ola|bom dia|boa tarde|boa noite)[\s,!]*)?(?:mas\s+)?(?:eu\s+)?ja\s+(?:comprei|compramos|adquiri|adquirimos)\b/.test(
      text,
    )
  );
}

const POST_CLOSE_COURTESY_MULTIWORD_PHRASES = [
  "tenha um bom dia",
  "tenha um otimo dia",
  "tenha uma boa tarde",
  "tenha uma boa noite",
  "pelo retorno",
  "pela atencao",
  "bom dia",
  "boa tarde",
  "boa noite",
  "ate mais",
  "de nada",
];

const POST_CLOSE_COURTESY_SINGLE_TOKENS = new Set([
  "a",
  "eh",
  "ta",
  "okay",
  "certo",
  "beleza",
  "blz",
  "joia",
  "show",
  "perfeito",
  "combinado",
  "entendido",
  "entendi",
  "tranquilo",
  "valeu",
  "vlw",
  "obg",
  "bgd",
  "muito",
  "obrigado",
  "obrigada",
  "agradeco",
  "igualmente",
  "otimo",
  "otima",
  "abraco",
  "abracos",
  "tchau",
  "disponha",
  "imagina",
  "sim",
  "nao",
]);

/**
 * Detecta mensagens curtas puramente de cortesia/despedida após um encerramento automático
 * (ex.: "Ok", "Obrigada", "Ah ta joia", "Tenha um bom dia"), que NÃO devem reabrir o fluxo.
 * Implementação estritamente linear O(N) para eliminar qualquer risco de backtracking (ReDoS).
 */
export function isPostCloseCourtesyOnlyMessage(raw: string): boolean {
  const clean = String(raw || "").trim();
  if (!clean) return true;
  const text = normalizeTriageText(clean);
  // Apenas emojis/pontuação sem letras ou dígitos (ex.: "👍", "🙏")
  if (!/[a-z0-9]/.test(text)) return true;
  if (text.length > 90) return false;
  if (clean.includes("?") || ACTIVE_DEMAND_CUE_PATTERN.test(text)) return false;

  const words = text
    .replace(/[\s,!.]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return true;

  let idx = 0;
  while (idx < words.length) {
    let matchedPhraseLen = 0;
    for (const phrase of POST_CLOSE_COURTESY_MULTIWORD_PHRASES) {
      const parts = phrase.split(" ");
      if (idx + parts.length <= words.length) {
        let matches = true;
        for (let k = 0; k < parts.length; k++) {
          if (words[idx + k] !== parts[k]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          matchedPhraseLen = parts.length;
          break;
        }
      }
    }
    if (matchedPhraseLen > 0) {
      idx += matchedPhraseLen;
      continue;
    }
    const token = words[idx];
    if (POST_CLOSE_COURTESY_SINGLE_TOKENS.has(token) || /^(?:ah+|ok+)$/.test(token)) {
      idx += 1;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Detecta mensagens vindas de URAs/bots automáticos externos, pesquisas NPS ou números 0800
 * (ex.: Grupo Caçola 558007222652, bot NPS DSM) para evitar loop bot-a-bot e card falso no FUNIL CWR.
 */
export function isAutomatedBotOrUraMessage(params: {
  phone?: string | null;
  text?: string | null;
}): boolean {
  const digits = String(params.phone || "").replace(/\D/g, "");
  if (/^550?800\d{6,8}$/.test(digits) || /^0?800\d{6,8}$/.test(digits)) {
    return true;
  }
  const raw = String(params.text || "");
  const text = normalizeTriageText(raw);
  if (!text) return false;

  if (
    /\b(?:finalizar autoatendimento|nao entendi,\s*poderia repetir|(?:desculpe,\s*)?nao entendi sua resposta|como nao entendi sua resposta,\s*estarei te direcionando|seja bem vindo ao atendimento automatico|atendimento eletronico|digite um numero entre \d+ e \d+|digite uma nota (?:de|entre) \d+|obrigado\s+nome privado\s+por entrar em contato)\b/.test(
      text,
    )
  ) {
    return true;
  }

  // Pesquisa de satisfação / NPS automática (ex.: "Como você avalia o atendimento recebido? 1 = Péssimo a 5 = Excelente")
  const hasSurveyHeader =
    /\b(?:como voce avalia (?:o|nosso) atendimento|deixe sua avaliacao|avalie (?:o|nosso) atendimento|pesquisa de satisfacao)\b/.test(
      text,
    );
  const hasSurveyScale =
    /\b(?:pessimo|excelente|neutro|vou encerrar seu atendimento por aqui|1\s*(?:=|a|-)\s*5|0\s*(?:=|a|-)\s*10)\b/.test(
      text,
    );
  if (hasSurveyHeader && hasSurveyScale) {
    return true;
  }

  // Mensagens automáticas de ausência / saudação / loja / mudança de número do WhatsApp Business
  // (ex.: "<Empresa> agradece seu contato. Como podemos ajudar?",
  // "Agradecemos sua mensagem. Não estamos disponíveis no momento...",
  // "Seja bem-vindo(a) à X! Recebemos sua mensagem e, em breve, um de nossos atendentes...",
  // "A X agora terá atendimento pelo WhatsApp da marca irmã... chame no número...")
  const hasExplicitAwayHeader =
    /\b(?:mensagem automatica|resposta automatica|fora do horario de atendimento|horario de atendimento|nao estamos disponive(?:l|is)|no momento nao (?:estamos disponive(?:l|is)|podemos responder))\b/.test(
      text,
    ) &&
    /\b(?:agradec(?:e|emos)|horario comercial|retornaremos|retorno sera realizado|entraremos em contato|assim que possivel|em breve|compreensao|deixe seu pedido|como podemos)\b/.test(
      text,
    );
  const hasGreetingAutoReply =
    /\b(?:agradec(?:e|emos)\s+(?:o\s+|a\s+)?(?:seu\s+contato|sua\s+mensagem))\b/.test(text) &&
    /\b(?:como podemos\s+(?:lhe\s+|te\s+)?ajudar|assim que possivel\s+(?:respond|retorn)|em breve\s+(?:respond|retorn)|entraremos em contato\s+(?:assim que possivel|em breve)|nosso retorno sera realizado|em horario comercial|responderemos\s+(?:assim que possivel|em breve)|responderei\s+(?:sua mensagem|assim que possivel|em breve)|lista de espera|nao estamos disponive(?:l|is))\b/.test(
      text,
    );
  const hasWelcomeAutoReply =
    /\bseja(?:m)?\s+bem[\s-]*vind[oa]s?(?:\s*\([ao]\))?\b/.test(text) &&
    /\b(?:recebemos sua mensagem|um de nossos atendentes|como podemos\s+(?:lhe\s+|te\s+)?ajudar|faca seu pedido|cardapio|carrinho virtual|instadelivery|goomer|ifood|trabalhamos com|melhor atender voce|e um prazer ter voce por aqui|e um prazer atende)\b/.test(
      text,
    );
  const hasNumberChangeAutoReply =
    /\b(?:agora tera atendimento pelo whatsapp|novo numero de atendimento|este numero nao recebe mais mensagens)\b/.test(
      text,
    ) &&
    /\b(?:chame no numero|entre em contato pelo numero|para receber atendimento|atendimento pelo whatsapp)\b/.test(
      text,
    );
  const hasActiveBuyingOrSupportAsk =
    /\b(?:quero comprar|preciso de uma?|gostaria de|orcamento|cotacao|quanto custa|minha maquina|defeito|quebrou|nao liga|nao funciona|segunda via|2a via|boleto|nota fiscal|rastreio)\b/.test(
      text,
    );
  if (
    (hasExplicitAwayHeader ||
      hasGreetingAutoReply ||
      hasWelcomeAutoReply ||
      hasNumberChangeAutoReply) &&
    !hasActiveBuyingOrSupportAsk
  ) {
    return true;
  }

  const hasUraPrompt = /\b(?:digite a opcao desejada|escolha uma das opcoes abaixo|selecione a opcao desejada)\b/.test(
    text,
  );
  const numberedOptionsCount = (raw.match(/(?:^|\n)\s*\*?\d{1,2}\*?\s*[-–.)]/g) || []).length;
  return hasUraPrompt && numberedOptionsCount >= 3;
}

const IMPERATIVE_COLLECTION_QUESTION_PATTERN =
  /\b(?:pode me (?:informar|confirmar|passar)|me (?:informe|confirme|passe|envie|conta)|qual (?:seu|sua|o|a)|esta correto)\b/;

const REAL_QUESTION_BEFORE_PHATIC_TAG_PATTERN =
  /\b(?:pode me (?:informar|confirmar|passar|dizer|enviar|mandar)|poderia me (?:informar|confirmar|passar|dizer|enviar|detalhar)|me (?:informe|confirme|passe|envie|conta|diga|manda)|qual (?:seria |e )?(?:o |a )?(?:seu|sua|o|a)\b|quais (?:sao|seriam)\b|quant[oa]s?\b|o que (?:voce|vc)\b|esta correto|sua empresa e\b|seu nome e\b|seu cnpj e\b|seu cpf e\b|e sobre (?:este|esse|esta|essa)\b|voce (?:busca|precisa|pretende|prefere|teria|sabe|consegue|pode|gostaria)\b|posso (?:te mandar|prosseguir|seguir|confirmar)\b)/;

const DATA_CONFIRMATION_CONTEXT_PATTERN =
  /\b(?:empresa|cadastro|cnpj|cpf|nome|telefone|numero|email|modelo|maquina|equipamento|produto|quantidade|producao|confirmar|confirmando|isso mesmo)\b/;

/**
 * Remove uma tag fática/retórica de encerramento no fim de um balão declarativo
 * (ex.: "...eles retornam amanhã a partir das 8h para finalizar com você, ok?"),
 * preservando perguntas reais de coleta ou confirmação de cadastro ("sua empresa é a X, certo?").
 */
export function stripTrailingPhaticConfirmationTag(normalizedText: string): string {
  const text = normalizedText.trim();
  if (!text) return text;
  if (/^(?:ok|ta|ta bom|certo|combinado|tudo bem|beleza|ne|nao e|nao e mesmo)\?$/.test(text)) {
    return "";
  }
  const strippedStrict = text.replace(
    /(?:[,.;!–—-]\s+|\s+)(?:ok|ta|ta bom|combinado|tudo bem|beleza|ne|nao e|nao e mesmo)\?$/,
    "",
  );
  if (strippedStrict !== text) return strippedStrict.trim();

  if (!DATA_CONFIRMATION_CONTEXT_PATTERN.test(text)) {
    const strippedCerto = text.replace(/(?:[,.;!–—-]\s+|\s+)certo\?$/, "");
    if (strippedCerto !== text) return strippedCerto.trim();
  }
  return text;
}

export function isPendingTriageQuestionBubble(message: string): boolean {
  const text = normalizeTriageText(String(message || ""));
  if (!text) return false;
  if (IMPERATIVE_COLLECTION_QUESTION_PATTERN.test(text)) return true;
  if (!text.includes("?")) return false;
  const withoutTrailingPhatic = stripTrailingPhaticConfirmationTag(text);
  if (withoutTrailingPhatic === text) return true;
  if (!withoutTrailingPhatic) return false;
  return (
    withoutTrailingPhatic.includes("?") ||
    REAL_QUESTION_BEFORE_PHATIC_TAG_PATTERN.test(withoutTrailingPhatic)
  );
}

export function hasPendingTriageQuestion(messages: readonly string[]): boolean {
  return messages.some((message) => isPendingTriageQuestionBubble(message));
}
