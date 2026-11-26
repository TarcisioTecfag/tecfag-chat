export function normalizeCatalogSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function stripSoftSeparators(normalized: string): string {
  return normalized.replace(/[-_]+/g, "");
}

function matchesSearchToken(
  normalizedLabel: string,
  compactLabel: string,
  token: string,
): boolean {
  if (!token) return true;
  if (normalizedLabel.includes(token)) return true;
  const compactToken = stripSoftSeparators(token);
  return compactToken.length > 0 && compactLabel.includes(compactToken);
}

function getMatchScore(
  normalizedLabel: string,
  compactLabel: string,
  normalizedQuery: string,
  compactQuery: string,
): number {
  if (normalizedLabel === normalizedQuery || compactLabel === compactQuery) return 0;
  if (normalizedLabel.startsWith(normalizedQuery) || compactLabel.startsWith(compactQuery)) {
    return 1;
  }
  if (normalizedLabel.includes(normalizedQuery) || compactLabel.includes(compactQuery)) {
    return 2;
  }
  return 3;
}

export function filterCatalogSearchOptions<T>(
  options: readonly T[],
  query: string,
  getLabel: (item: T) => string,
): T[] {
  const normalizedQuery = normalizeCatalogSearchText(query);
  if (!normalizedQuery) return [...options];

  const compactQuery = stripSoftSeparators(normalizedQuery);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  const ranked: Array<{ item: T; score: number; index: number }> = [];

  for (let index = 0; index < options.length; index++) {
    const item = options[index];
    const normalizedLabel = normalizeCatalogSearchText(getLabel(item));
    const compactLabel = stripSoftSeparators(normalizedLabel);

    const allMatch = tokens.every((token) =>
      matchesSearchToken(normalizedLabel, compactLabel, token),
    );
    if (!allMatch) continue;

    ranked.push({
      item,
      score: getMatchScore(normalizedLabel, compactLabel, normalizedQuery, compactQuery),
      index,
    });
  }

  ranked.sort((a, b) => a.score - b.score || a.index - b.index);
  return ranked.map((entry) => entry.item);
}
