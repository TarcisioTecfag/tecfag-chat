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

  return false;
}

export interface ConsultantAvatarSource {
  id?: string | null;
  operatorId?: string | null;
  name?: string | null;
  avatar?: string | null;
  avatarUrl?: string | null;
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
    if (idOrOperatorId && avatarById.has(idOrOperatorId)) {
      return avatarById.get(idOrOperatorId);
    }
    if (name) {
      const cleaned = cleanConsultantName(name);
      if (cleaned && avatarByName.has(cleaned)) {
        return avatarByName.get(cleaned);
      }
      // Busca por correspondência flexível (ex: sufixo de ramal, inversão de prenome/sobrenome)
      for (const entry of registeredEntries) {
        if (matchConsultantNames(name, entry.name)) {
          return entry.avatar;
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
