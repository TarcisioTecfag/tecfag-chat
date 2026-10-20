/**
 * Utilitário central de enriquecimento e espelhamento de avatares de consultores.
 * Normaliza nomes e códigos para garantir que fotos cadastradas no Tecfag Chat
 * sejam espelhadas com 100% de cobertura em todos os módulos e War Room.
 */

export function cleanConsultantName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\s*-\s*\d+.*$/, "") // remove sufixos como "- 96", "- 102"
    .replace(/\(inativo\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchConsultantNames(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const ca = cleanConsultantName(a);
  const cb = cleanConsultantName(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;

  const tokensA = ca.split(" ").filter(Boolean);
  const tokensB = cb.split(" ").filter(Boolean);

  // Se ambos têm primeiro e último nome, verifica se os conjuntos coincidem (ex: "Rosenvaldo Lucas" e "Lucas Rosenvaldo")
  if (tokensA.length >= 2 && tokensB.length >= 2) {
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    if (tokensA.every((t) => setB.has(t)) || tokensB.every((t) => setA.has(t))) {
      return true;
    }
  }

  // Se um é prefixo do outro com mais de 1 token
  if (tokensA.length >= 2 && tokensB.length >= 2) {
    if (ca.startsWith(cb) || cb.startsWith(ca)) return true;
  }

  // Se um dos lados tem apenas o primeiro nome (ex: "Beatriz - 27" -> "beatriz" vs "Beatriz Ribeiro - 96" -> "beatriz ribeiro")
  if (
    (tokensA.length === 1 || tokensB.length === 1) &&
    tokensA[0] &&
    tokensA[0] === tokensB[0] &&
    tokensA[0].length >= 4
  ) {
    return true;
  }

  return false;
}

export interface ConsultantAliasResolution {
  toCanonicalId: Map<string, string>;
  byCanonicalId: Map<string, string[]>;
  allOperatorIds: string[];
  resolve: (operatorId?: string | null) => string | null;
}

export function buildConsultantOperatorAliasMap(
  consultants: Array<{ operatorId: string; name: string }>,
  allTenantOperators: Array<{ id: string; name: string }> = [],
): ConsultantAliasResolution {
  const toCanonicalId = new Map<string, string>();
  const byCanonicalId = new Map<string, string[]>();
  const firstTokenCounts = new Map<string, number>();

  for (const c of consultants) {
    if (!c.operatorId) continue;
    toCanonicalId.set(c.operatorId, c.operatorId);
    byCanonicalId.set(c.operatorId, [c.operatorId]);
    const firstToken = cleanConsultantName(c.name).split(" ").filter(Boolean)[0];
    if (firstToken) {
      firstTokenCounts.set(firstToken, (firstTokenCounts.get(firstToken) || 0) + 1);
    }
  }

  for (const op of allTenantOperators) {
    if (!op.id || toCanonicalId.has(op.id)) continue;
    const tokensOp = cleanConsultantName(op.name).split(" ").filter(Boolean);
    if (!tokensOp.length) continue;

    // 1. Tentar match forte (2+ tokens ou nome limpo idêntico)
    const strongMatches = consultants.filter((c) => {
      const ca = cleanConsultantName(op.name);
      const cb = cleanConsultantName(c.name);
      if (!ca || !cb) return false;
      if (ca === cb) return true;
      const tA = ca.split(" ").filter(Boolean);
      const tB = cb.split(" ").filter(Boolean);
      if (tA.length >= 2 && tB.length >= 2) {
        const setA = new Set(tA);
        const setB = new Set(tB);
        if (tA.every((t) => setB.has(t)) || tB.every((t) => setA.has(t))) return true;
        if (ca.startsWith(cb) || cb.startsWith(ca)) return true;
      }
      return false;
    });

    let matchedConsultant = strongMatches.length === 1 ? strongMatches[0] : null;

    // 2. Fallback: se um dos lados tem apenas o primeiro nome e esse primeiro nome é único entre os consultores
    if (!matchedConsultant && firstTokenCounts.get(tokensOp[0]) === 1 && tokensOp[0].length >= 4) {
      const singleTokenMatches = consultants.filter((c) => {
        const tokensC = cleanConsultantName(c.name).split(" ").filter(Boolean);
        return (
          (tokensOp.length === 1 || tokensC.length === 1) &&
          tokensC[0] === tokensOp[0]
        );
      });
      if (singleTokenMatches.length === 1) {
        matchedConsultant = singleTokenMatches[0];
      }
    }

    if (matchedConsultant) {
      toCanonicalId.set(op.id, matchedConsultant.operatorId);
      const list = byCanonicalId.get(matchedConsultant.operatorId) || [matchedConsultant.operatorId];
      if (!list.includes(op.id)) list.push(op.id);
      byCanonicalId.set(matchedConsultant.operatorId, list);
    }
  }

  return {
    toCanonicalId,
    byCanonicalId,
    allOperatorIds: [...toCanonicalId.keys()],
    resolve: (operatorId?: string | null) =>
      operatorId ? (toCanonicalId.get(operatorId) ?? null) : null,
  };
}

export interface ConsultantAvatarSource {
  id?: string | null;
  operatorId?: string | null;
  name?: string | null;
  avatar?: string | null;
  avatarUrl?: string | null;
}

export function getDeterministicConsultantAvatar(name?: string | null): string {
  const clean = cleanConsultantName(name || "") || (name || "Consultor").trim();
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(clean)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

export interface ConsultantAvatarResolver {
  (idOrOperatorId?: string | null, name?: string | null): string | undefined;
  getAvatar: (idOrOperatorId?: string | null, name?: string | null) => string | undefined;
  avatarById: Map<string, string>;
  avatarByName: Map<string, string>;
}

export function buildConsultantAvatarResolver(
  sourcesList: Array<ConsultantAvatarSource[] | undefined | null> = [],
): ConsultantAvatarResolver {
  const avatarById = new Map<string, string>();
  const avatarByName = new Map<string, string>();
  const registeredEntries: Array<{ id: string; name: string; avatar: string }> = [];

  // Se estiver no navegador, tentar carregar também operadores salvos no localStorage
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("rbac_operators");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const av = item.avatar || item.avatarUrl;
            if (av && typeof av === "string") {
              if (item.id) avatarById.set(item.id, av);
              if (item.operatorId) avatarById.set(item.operatorId, av);
              if (item.name) {
                const cleaned = cleanConsultantName(item.name);
                if (cleaned) avatarByName.set(cleaned, av);
                registeredEntries.push({ id: item.id || item.operatorId || "", name: item.name, avatar: av });
              }
            }
          }
        }
      }
    } catch {}
  }

  // Percorrer todas as fontes passadas
  for (const sources of sourcesList) {
    if (!sources || !Array.isArray(sources)) continue;
    for (const item of sources) {
      const av = item.avatar || item.avatarUrl;
      if (av && typeof av === "string") {
        if (item.id) avatarById.set(item.id, av);
        if (item.operatorId) avatarById.set(item.operatorId, av);
        if (item.name) {
          const cleaned = cleanConsultantName(item.name);
          if (cleaned) avatarByName.set(cleaned, av);
          registeredEntries.push({ id: item.id || item.operatorId || "", name: item.name, avatar: av });
        }
      }
    }
  }

  const getAvatar = (idOrOperatorId?: string | null, name?: string | null): string | undefined => {
    // 1. Busca por ID exato
    if (idOrOperatorId && avatarById.has(idOrOperatorId)) {
      const found = avatarById.get(idOrOperatorId);
      if (found) return found;
    }
    // 2. Busca por nome limpo
    if (name) {
      const cleaned = cleanConsultantName(name);
      if (cleaned && avatarByName.has(cleaned)) {
        const found = avatarByName.get(cleaned);
        if (found) return found;
      }
      // 3. Busca por correspondência flexível (ex: sufixo de ramal, inversão de prenome/sobrenome)
      for (const entry of registeredEntries) {
        if (matchConsultantNames(name, entry.name)) {
          if (entry.avatar) return entry.avatar;
        }
      }
    }
    return undefined;
  };

  const resolver = ((idOrOperatorId?: string | null, name?: string | null) => {
    return getAvatar(idOrOperatorId, name);
  }) as ConsultantAvatarResolver;

  resolver.getAvatar = getAvatar;
  resolver.avatarById = avatarById;
  resolver.avatarByName = avatarByName;

  return resolver;
}
