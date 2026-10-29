export type CrmProductGroup = "maquinas" | "pecas" | "servicos";
export type CrmProductGroupFilter = "all" | CrmProductGroup;

export interface GroupableCrmProduct {
  id: string;
  name?: string | null;
  description?: string | null;
  unitPrice?: string | number | null;
  sku?: string | null;
  category?: string | null;
}

export function normalizeSearchText(value?: string | null): string {
  if (!value) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function classifyCrmProductGroup(product: {
  name?: string | null;
  category?: string | null;
  sku?: string | null;
}): CrmProductGroup {
  const cat = normalizeSearchText(product.category);
  const sku = String(product.sku || "").trim().toUpperCase();
  const name = normalizeSearchText(product.name);

  if (
    cat.includes("pecas") ||
    cat.includes("peca") ||
    cat.includes("insumo") ||
    cat.includes("acessorio") ||
    cat.includes("consumive")
  ) {
    return "pecas";
  }

  if (
    cat.includes("servico") ||
    cat.includes("assistencia") ||
    cat.includes("manutencao") ||
    cat.includes("instalacao") ||
    cat.includes("treinamento")
  ) {
    return "servicos";
  }

  if (cat.length > 0) {
    return "maquinas";
  }

  if (sku.startsWith("PAAC") || sku.startsWith("PAPC") || sku.startsWith("PAIS")) {
    return "pecas";
  }

  if (
    name.startsWith("servico ") ||
    name.startsWith("manutencao ") ||
    name.startsWith("assistencia ") ||
    name.startsWith("instalacao ")
  ) {
    return "servicos";
  }

  return "maquinas";
}

export function formatShortProductCategory(category?: string | null): string {
  const raw = String(category || "").trim();
  if (!raw) return "Máquinas e Equipamentos";
  const parts = raw
    .split(">")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 2) return parts.join(" › ");
  return `${parts[0]} › ${parts[parts.length - 1]}`;
}

function getSearchRelevanceScore(product: GroupableCrmProduct, queryNormalized: string, tokens: string[]): number | null {
  if (!queryNormalized) return 1;

  const nameNorm = normalizeSearchText(product.name);
  const skuNorm = normalizeSearchText(product.sku);
  const catNorm = normalizeSearchText(product.category);
  const descNorm = normalizeSearchText(product.description);

  if (nameNorm.startsWith(queryNormalized)) return 0;
  if (skuNorm && skuNorm === queryNormalized) return 0;
  if (nameNorm.includes(queryNormalized)) return 1;
  if (tokens.length > 1 && tokens.every((t) => nameNorm.includes(t))) return 2;
  if (skuNorm.includes(queryNormalized) || (tokens.length > 0 && tokens.every((t) => skuNorm.includes(t) || nameNorm.includes(t)))) {
    return 3;
  }
  if (catNorm.includes(queryNormalized) || (tokens.length > 1 && tokens.every((t) => catNorm.includes(t) || nameNorm.includes(t)))) {
    return 4;
  }
  if (descNorm.includes(queryNormalized) || (tokens.length > 1 && tokens.every((t) => descNorm.includes(t)))) {
    return 5;
  }

  return null;
}

export interface GroupedCatalogResult<T extends GroupableCrmProduct> {
  maquinas: T[];
  pecas: T[];
  servicos: T[];
  filtered: T[];
  counts: {
    all: number;
    maquinas: number;
    pecas: number;
    servicos: number;
  };
}

export function filterAndGroupCatalogProducts<T extends GroupableCrmProduct>(
  products: T[],
  searchQuery: string,
  groupFilter: CrmProductGroupFilter = "all",
): GroupedCatalogResult<T> {
  const queryNormalized = normalizeSearchText(searchQuery);
  const tokens = queryNormalized.split(/\s+/).filter(Boolean);

  const scoredMaquinas: Array<{ item: T; score: number }> = [];
  const scoredPecas: Array<{ item: T; score: number }> = [];
  const scoredServicos: Array<{ item: T; score: number }> = [];

  for (const item of products) {
    const score = getSearchRelevanceScore(item, queryNormalized, tokens);
    if (score === null) continue;

    const group = classifyCrmProductGroup(item);
    if (group === "maquinas") {
      scoredMaquinas.push({ item, score });
    } else if (group === "pecas") {
      scoredPecas.push({ item, score });
    } else {
      scoredServicos.push({ item, score });
    }
  }

  const sortByScoreAndName = (a: { item: T; score: number }, b: { item: T; score: number }) => {
    if (a.score !== b.score) return a.score - b.score;
    return String(a.item.name || "").localeCompare(String(b.item.name || ""), "pt-BR");
  };

  scoredMaquinas.sort(sortByScoreAndName);
  scoredPecas.sort(sortByScoreAndName);
  scoredServicos.sort(sortByScoreAndName);

  const maquinas = scoredMaquinas.map((x) => x.item);
  const pecas = scoredPecas.map((x) => x.item);
  const servicos = scoredServicos.map((x) => x.item);

  const counts = {
    all: maquinas.length + pecas.length + servicos.length,
    maquinas: maquinas.length,
    pecas: pecas.length,
    servicos: servicos.length,
  };

  let filtered: T[];
  if (groupFilter === "maquinas") {
    filtered = maquinas;
  } else if (groupFilter === "pecas") {
    filtered = pecas;
  } else if (groupFilter === "servicos") {
    filtered = servicos;
  } else {
    // Em "Todos", Máquinas sempre vêm primeiro, seguidas de Serviços e Peças
    filtered = [...maquinas, ...servicos, ...pecas];
  }

  return {
    maquinas: groupFilter === "all" || groupFilter === "maquinas" ? maquinas : [],
    pecas: groupFilter === "all" || groupFilter === "pecas" ? pecas : [],
    servicos: groupFilter === "all" || groupFilter === "servicos" ? servicos : [],
    filtered,
    counts,
  };
}
