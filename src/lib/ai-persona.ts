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
    chatFeatureKey: "valentina_chat",
  },
  tecfag: {
    name: "Fagner",
    company: "Tecfag Informática",
    segment: "soluções de TI, suporte técnico, hardware e informática",
    tone: "técnico, masculino, consultivo e objetivo",
    gender: "male",
    avatar: "🤖",
    avatarUrl: "/fagner.png",
    avatarHdUrl: "/fagner-avatar-hd.png",
    avatarFullUrl: "/fagner-full.png",
    chatFeatureKey: "fagner_chat",
  },
};

/**
 * Retorna a persona de IA para o tenant informado.
 * Se o tenant for desconhecido, retorna um fallback neutro — NUNCA deve acontecer em produção.
 */
export function getAiPersona(tenantId: string): AiPersona {
  const persona = PERSONAS[tenantId];
  if (!persona) {
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
      chatFeatureKey: "general",
    };
  }
  return persona;
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
