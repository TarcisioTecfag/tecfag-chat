/**
 * ai-persona.ts
 * 
 * Fonte única de verdade para as personas de IA por tenant.
 * NUNCA hardcode o nome da IA diretamente na UI ou nos prompts.
 * SEMPRE use `getAiPersona(tenantId)` para obter o nome, gênero e avatar corretos.
 * 
 * Regra do projeto (AGENTS.md):
 *   - valem  → Valentina (SDR comercial, feminina, Valem Valvulas e Embalagens)
 *   - tecfag → Fagner (consultor técnico, masculino, Tecfag Informática)
 */

export interface AiPersona {
  /** Nome da IA para exibição na UI e prompts */
  name: string;
  /** Empresa do tenant */
  company: string;
  /** Segmento de negócio */
  segment: string;
  /** Tom da persona */
  tone: string;
  /** Gênero gramatical — usado para concordância em textos */
  gender: "female" | "male";
  /** Emoji representativo */
  avatar: string;
  /** URL da foto de perfil oficial padrão (quadrada / para avatar em qualquer condição) */
  avatarUrl: string;
  /** URL da foto de perfil em alta resolução / HD */
  avatarHdUrl: string;
  /** URL da foto completa original */
  avatarFullUrl: string;
  /** URL da foto oficial para tema claro */
  avatarLightUrl?: string;
  /** URL da foto oficial para tema escuro */
  avatarDarkUrl?: string;
  /** Feature key usada no painel de Custos (ai_usage_logs.feature) */
  chatFeatureKey: string;
}

const PERSONAS: Record<string, AiPersona> = {
  valem: {
    name: "Valentina",
    company: "Valem Valvulas e Embalagens",
    segment:
      "válvulas aerosol/spray, frascos, potes, seladoras, embaladoras e componentes industriais",
    tone: "profissional, feminino, comercial e consultivo",
    gender: "female",
    avatar: "💜",
    avatarUrl: "/valentina.png",
    avatarHdUrl: "/valentina-avatar-hd.png",
    avatarFullUrl: "/valentina.png",
    avatarLightUrl: "/valentina.png",
    avatarDarkUrl: "/valentina.png",
    chatFeatureKey: "valentina_chat",
  },
  tecfag: {
    name: "Fagner",
    company: "Tecfag Informática",
    segment: "soluções de TI, suporte técnico, hardware e informática",
    tone: "técnico, masculino, consultivo e objetivo",
    gender: "male",
    avatar: "🤖",
    avatarUrl: "/fagner-dark.png",
    avatarHdUrl: "/fagner-dark.png",
    avatarFullUrl: "/fagner-dark.png",
    avatarLightUrl: "/fagner-light.png",
    avatarDarkUrl: "/fagner-dark.png",
    chatFeatureKey: "fagner_chat",
  },
};

/**
 * Retorna se o ambiente atual está no modo escuro.
 */
function resolveIsDark(themeOrIsDark?: boolean | "light" | "dark"): boolean {
  if (typeof themeOrIsDark === "boolean") return themeOrIsDark;
  if (themeOrIsDark === "dark") return true;
  if (themeOrIsDark === "light") return false;
  if (typeof window !== "undefined") {
    try {
      if (typeof document !== "undefined" && document?.documentElement?.classList?.contains?.("dark")) return true;
      const saved = typeof localStorage !== "undefined" ? localStorage.getItem("chat_theme_mode") : null;
      if (saved === "dark") return true;
      if (saved === "light") return false;
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return true;
    } catch {}
  }
  return true; // Default dark
}

/**
 * Retorna a persona de IA para o tenant informado com avatar calibrado ao tema ativo.
 * Se o tenant for desconhecido, retorna um fallback neutro — NUNCA deve acontecer em produção.
 */
export function getAiPersona(
  tenantId: string = "valem",
  themeOrIsDark?: boolean | "light" | "dark"
): AiPersona {
  const base = PERSONAS[tenantId];
  if (!base) {
    console.warn(
      `[ai-persona] Tenant desconhecido: "${tenantId}". Usando persona fallback neutra. Verifique o tenantId.`
    );
    return {
      name: "Assistente",
      company: "Empresa",
      segment: "atendimento geral",
      tone: "neutro e profissional",
      gender: "female",
      avatar: "🤖",
      avatarUrl: "/favicon.png",
      avatarHdUrl: "/favicon.png",
      avatarFullUrl: "/favicon.png",
      avatarLightUrl: "/favicon.png",
      avatarDarkUrl: "/favicon.png",
      chatFeatureKey: "general",
    };
  }

  const isDark = resolveIsDark(themeOrIsDark);
  if (tenantId === "tecfag") {
    const avatar = isDark ? "/fagner-dark.png" : "/fagner-light.png";
    return {
      ...base,
      avatarUrl: avatar,
      avatarHdUrl: avatar,
      avatarFullUrl: avatar,
    };
  }

  return base;
}

/**
 * Verifica se um tenant existe e está configurado.
 * Útil para guards de feature: if (!isKnownTenant(tenantId)) return;
 */
export function isKnownTenant(tenantId: string): boolean {
  return tenantId in PERSONAS;
}

/**
 * Retorna a saudação de boas-vindas da IA no tom correto para o tenant.
 * Exemplo: "Olá! Eu sou a Valentina, da Valem Valvulas e Embalagens 😊"
 */
export function getAiGreeting(tenantId: string): string {
  const p = getAiPersona(tenantId);
  const article = p.gender === "female" ? "a" : "o";
  return `Olá! Eu sou ${article} ${p.name}, da ${p.company} ${p.avatar}`;
}
