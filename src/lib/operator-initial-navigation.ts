/**
 * Utilitários puros e determinísticos para:
 * 1. Ordenação sempre em ordem alfabética (pt-BR, case-insensitive e accent-aware).
 * 2. Navegação / seleção cíclica de operadores pela letra inicial (ex.: teclar ou clicar "C"
 *    vai para o 1º operador com "C", repetir "C" avança para o próximo operador com "C", em ciclo).
 */

const ptBrAlphabeticalCollator = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});

function defaultGetName(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  if (typeof record.name === "string") return record.name;
  if (typeof record.operatorName === "string") return record.operatorName;
  if (typeof record.label === "string") return record.label;
  return "";
}

function defaultGetId(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  if (typeof record.operatorId === "string") return record.operatorId;
  if (typeof record.value === "string") return record.value;
  return "";
}

/**
 * Extrai a letra inicial normalizada (sem acento, maiúscula, A-Z ou 0-9).
 * Ex.: "Carlos" -> "C", "Átila" -> "A", "érica" -> "E", "  Lucas" -> "L".
 */
export function normalizeInitialLetter(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const firstSymbol = Array.from(trimmed)[0] || "";
  const ascii = firstSymbol
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return /^[A-Z0-9]$/.test(ascii) ? ascii : "";
}

/**
 * Retorna uma nova lista ordenada em ordem alfabética (pt-BR) sem mutar o array original.
 */
export function sortAlphabeticallyByName<T>(
  items: readonly T[],
  getName: (item: T) => string = defaultGetName,
  getId: (item: T) => string = defaultGetId,
): T[] {
  if (!Array.isArray(items) || items.length <= 1) {
    return Array.isArray(items) ? [...items] : [];
  }

  return [...items].sort((a, b) => {
    const nameA = String(getName(a) ?? "").trim();
    const nameB = String(getName(b) ?? "").trim();

    if (!nameA && nameB) return 1;
    if (nameA && !nameB) return -1;

    const cmp = ptBrAlphabeticalCollator.compare(nameA, nameB);
    if (cmp !== 0) return cmp;

    const idA = String(getId(a) ?? "");
    const idB = String(getId(b) ?? "");
    return idA.localeCompare(idB);
  });
}

/**
 * Retorna a lista única de letras iniciais disponíveis nos itens (ordenada A -> Z).
 */
export function getAvailableInitials<T>(
  items: readonly T[],
  getName: (item: T) => string = defaultGetName,
): string[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const seen = new Set<string>();
  for (const item of items) {
    const initial = normalizeInitialLetter(getName(item));
    if (initial) seen.add(initial);
  }
  return Array.from(seen).sort((a, b) => ptBrAlphabeticalCollator.compare(a, b));
}

export interface InitialCycleMatch<T> {
  item: T;
  id: string;
  index: number;
  letter: string;
  /** Posição 1-based dentro do grupo daquela letra (ex.: 2 de 3 operadores com "C") */
  matchPosition: number;
  /** Total de operadores que começam com aquela letra */
  matchCount: number;
}

/**
 * Seleciona o próximo item que começa com `letter`.
 * - Se `currentActiveId` ainda não começa com `letter`, seleciona o 1º item com `letter`.
 * - Se `currentActiveId` já é um item com `letter`, avança para o próximo item com `letter`
 *   e volta ao 1º ao chegar no fim daquela letra (ciclo contínuo).
 */
export function cycleItemByInitial<T>(params: {
  items: readonly T[];
  letter: string;
  currentActiveId?: string | null;
  getId?: (item: T) => string;
  getName?: (item: T) => string;
}): InitialCycleMatch<T> | null {
  const {
    items,
    letter,
    currentActiveId = null,
    getId = defaultGetId,
    getName = defaultGetName,
  } = params;

  if (!Array.isArray(items) || items.length === 0) return null;
  const targetLetter = normalizeInitialLetter(letter);
  if (!targetLetter) return null;

  const matchingIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (normalizeInitialLetter(getName(items[i])) === targetLetter) {
      matchingIndices.push(i);
    }
  }

  if (matchingIndices.length === 0) return null;

  const currentPosInMatches = currentActiveId
    ? matchingIndices.findIndex((idx) => getId(items[idx]) === currentActiveId)
    : -1;

  const nextPosInMatches =
    currentPosInMatches >= 0
      ? (currentPosInMatches + 1) % matchingIndices.length
      : 0;

  const targetIndex = matchingIndices[nextPosInMatches];
  const targetItem = items[targetIndex];

  return {
    item: targetItem,
    id: getId(targetItem),
    index: targetIndex,
    letter: targetLetter,
    matchPosition: nextPosInMatches + 1,
    matchCount: matchingIndices.length,
  };
}

/**
 * Avança ou retrocede 1 item na lista inteira (suporte às setas ArrowDown / ArrowUp).
 */
export function stepActiveItem<T>(params: {
  items: readonly T[];
  direction: 1 | -1;
  currentActiveId?: string | null;
  getId?: (item: T) => string;
}): { item: T; id: string; index: number } | null {
  const { items, direction, currentActiveId = null, getId = defaultGetId } = params;
  if (!Array.isArray(items) || items.length === 0) return null;

  const currentIndex = currentActiveId
    ? items.findIndex((it) => getId(it) === currentActiveId)
    : -1;

  let nextIndex: number;
  if (currentIndex < 0) {
    nextIndex = direction === 1 ? 0 : items.length - 1;
  } else {
    nextIndex = (currentIndex + direction + items.length) % items.length;
  }

  const item = items[nextIndex];
  return {
    item,
    id: getId(item),
    index: nextIndex,
  };
}

/**
 * Verifica se o foco atual está em um campo editável (input, textarea, contenteditable),
 * evitando interceptar digitação normal de busca ou mensagem.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (attr: string) => string | null;
  };
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.isContentEditable) return true;
  if (typeof el.getAttribute === "function" && el.getAttribute("contenteditable") === "true") {
    return true;
  }
  return false;
}

/**
 * Extrai a letra/dígito inicial de um KeyboardEvent de tecla única sem modificadores (Ctrl/Meta/Alt).
 */
export function extractInitialKeyFromKeyboardEvent(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (!event.key || Array.from(event.key).length !== 1) return null;
  const normalized = normalizeInitialLetter(event.key);
  return normalized || null;
}
