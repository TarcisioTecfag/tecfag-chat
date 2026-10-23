import { useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ViewId } from "./rbac";

export interface ModuleRouteSpec {
  viewId: ViewId;
  baseSlug: string;
  aliases?: string[];
  defaultTabId?: string;
  /** Map internal tab ID -> URL slug */
  tabToSlug?: Record<string, string>;
  /** Map URL slug (including aliases) -> internal tab ID */
  slugToTab?: Record<string, string>;
}

export const MODULE_ROUTE_SPECS: Record<ViewId, ModuleRouteSpec> = {
  commercialHome: {
    viewId: "commercialHome",
    baseSlug: "inicio",
    defaultTabId: "Todas",
    tabToSlug: {
      Todas: "todas",
      Atrasadas: "atrasadas",
      Alta: "alta",
      Hoje: "hoje",
      "Concluídas": "concluidas",
    },
    slugToTab: {
      todas: "Todas",
      atrasadas: "Atrasadas",
      alta: "Alta",
      hoje: "Hoje",
      concluidas: "Concluídas",
    },
  },
  chat: {
    viewId: "chat",
    baseSlug: "chat",
    aliases: ["conversas", "atendimentos"],
  },
  crm: {
    viewId: "crm",
    baseSlug: "negociacoes",
    aliases: ["crm"],
    defaultTabId: "kanban",
    tabToSlug: {
      kanban: "quadro",
      list: "lista",
    },
    slugToTab: {
      quadro: "kanban",
      kanban: "kanban",
      lista: "list",
      list: "list",
    },
  },
  tasks: {
    viewId: "tasks",
    baseSlug: "tarefas",
    aliases: ["tasks"],
    defaultTabId: "month",
    tabToSlug: {
      month: "mes",
      week: "semana",
      day: "dia",
    },
    slugToTab: {
      mes: "month",
      month: "month",
      semana: "week",
      week: "week",
      dia: "day",
      day: "day",
    },
  },
  contacts: {
    viewId: "contacts",
    baseSlug: "clientes",
    aliases: ["contatos", "contacts"],
    defaultTabId: "all",
    tabToSlug: {
      all: "todos",
      whatsapp: "whatsapp",
      instagram: "instagram",
      messenger: "messenger",
      companies: "empresas",
    },
    slugToTab: {
      todos: "all",
      all: "all",
      whatsapp: "whatsapp",
      instagram: "instagram",
      messenger: "messenger",
      empresas: "companies",
      companies: "companies",
    },
  },
  wallet: {
    viewId: "wallet",
    baseSlug: "carteira",
    aliases: ["wallet"],
    defaultTabId: "wallet",
    tabToSlug: {
      wallet: "clientes",
      templates: "templates",
    },
    slugToTab: {
      clientes: "wallet",
      wallet: "wallet",
      templates: "templates",
    },
  },
  commercialManagement: {
    viewId: "commercialManagement",
    baseSlug: "gestao-comercial",
    defaultTabId: "consultants",
    tabToSlug: {
      consultants: "consultores",
      profiles: "perfis",
      goals: "metas",
      calendar: "calendario",
      directives: "diretrizes",
      evidence: "evidencias",
      operation: "operacao",
      settings: "configuracoes",
    },
    slugToTab: {
      consultores: "consultants",
      consultants: "consultants",
      perfis: "profiles",
      profiles: "profiles",
      metas: "goals",
      goals: "goals",
      calendario: "calendar",
      calendar: "calendar",
      diretrizes: "directives",
      directives: "directives",
      evidencias: "evidence",
      evidence: "evidence",
      operacao: "operation",
      operation: "operation",
      configuracoes: "settings",
      settings: "settings",
    },
  },
  commercialBi: {
    viewId: "commercialBi",
    baseSlug: "war-room",
    aliases: ["diretoria", "bi"],
    defaultTabId: "0",
    tabToSlug: {
      "0": "pipeline",
      "1": "depara",
      "2": "previstas",
      "3": "pacing",
      "4": "perdas",
      "5": "ranking",
      "6": "diretrizes",
      "7": "tma",
      "8": "safras",
    },
    slugToTab: {
      pipeline: "0",
      "0": "0",
      depara: "1",
      "1": "1",
      previstas: "2",
      "2": "2",
      pacing: "3",
      "3": "3",
      perdas: "4",
      "4": "4",
      ranking: "5",
      "5": "5",
      diretrizes: "6",
      "6": "6",
      tma: "7",
      "7": "7",
      safras: "8",
      "8": "8",
    },
  },
  valentina: {
    viewId: "valentina",
    baseSlug: "ia",
    aliases: ["fagner", "valentina"],
    defaultTabId: "chat",
    tabToSlug: {
      chat: "chat",
      sdr: "sdr",
      rodizio: "rodizio",
      fluxos: "fluxos",
      supervisor: "supervisor",
      vendedor: "vendedor",
      knowledge: "conhecimento",
    },
    slugToTab: {
      chat: "chat",
      sdr: "sdr",
      rodizio: "rodizio",
      fluxos: "fluxos",
      supervisor: "supervisor",
      vendedor: "vendedor",
      conhecimento: "knowledge",
      knowledge: "knowledge",
    },
  },
  ligacoes: {
    viewId: "ligacoes",
    baseSlug: "ligacoes",
    defaultTabId: "voice_equipe",
    tabToSlug: {
      voice_equipe: "performance",
      voice_vendedor: "vendedor",
      voice_ligacao: "analise",
      dashboard: "dashboard",
      agenda: "agenda",
      historico: "historico",
      clientes: "clientes",
      campanhas: "campanhas",
      objetivos: "objetivos",
    },
    slugToTab: {
      performance: "voice_equipe",
      equipe: "voice_equipe",
      voice_equipe: "voice_equipe",
      vendedor: "voice_vendedor",
      voice_vendedor: "voice_vendedor",
      analise: "voice_ligacao",
      ligacao: "voice_ligacao",
      voice_ligacao: "voice_ligacao",
      dashboard: "dashboard",
      agenda: "agenda",
      historico: "historico",
      clientes: "clientes",
      campanhas: "campanhas",
      objetivos: "objetivos",
    },
  },
  monitor: {
    viewId: "monitor",
    baseSlug: "monitorar",
    aliases: ["monitor"],
    defaultTabId: "live",
    tabToSlug: {
      live: "ao-vivo",
      alerts: "alertas",
      operators: "operadores",
      audits: "auditorias",
      tasks: "tarefas",
      site: "site",
    },
    slugToTab: {
      "ao-vivo": "live",
      live: "live",
      alertas: "alerts",
      alerts: "alerts",
      operadores: "operators",
      operators: "operators",
      auditorias: "audits",
      audits: "audits",
      tarefas: "tasks",
      tasks: "tasks",
      site: "site",
    },
  },
  analytics: {
    viewId: "analytics",
    baseSlug: "estatisticas",
    aliases: ["analytics"],
    defaultTabId: "overview",
    tabToSlug: {
      overview: "visao-geral",
      performance: "desempenho",
      sla: "sla",
      contacts: "clientes",
      reports: "relatorios-ia",
      costs: "custos",
    },
    slugToTab: {
      "visao-geral": "overview",
      overview: "overview",
      desempenho: "performance",
      performance: "performance",
      sla: "sla",
      clientes: "contacts",
      contacts: "contacts",
      "relatorios-ia": "reports",
      reports: "reports",
      custos: "costs",
      costs: "costs",
    },
  },
  groups: {
    viewId: "groups",
    baseSlug: "acessos",
    aliases: ["grupos", "groups"],
    defaultTabId: "users",
    tabToSlug: {
      users: "usuarios",
      groups: "grupos",
      sectors: "setores",
      wallets: "carteiras",
      templates: "templates",
    },
    slugToTab: {
      usuarios: "users",
      users: "users",
      grupos: "groups",
      groups: "groups",
      setores: "sectors",
      sectors: "sectors",
      carteiras: "wallets",
      wallets: "wallets",
      templates: "templates",
    },
  },
  settings: {
    viewId: "settings",
    baseSlug: "ajustes",
    aliases: ["configuracoes", "settings"],
    defaultTabId: "whatsapp",
    tabToSlug: {
      whatsapp: "whatsapp",
      voz: "voz",
      rd: "rd-station",
      crm: "crm",
      email: "email",
      livechat: "livechat",
      mcp: "mcp",
    },
    slugToTab: {
      whatsapp: "whatsapp",
      voz: "voz",
      "rd-station": "rd",
      rd: "rd",
      crm: "crm",
      email: "email",
      livechat: "livechat",
      mcp: "mcp",
      "conector-mcp": "mcp",
    },
  },
};

const SLUG_TO_SPEC = new Map<string, ModuleRouteSpec>();
for (const spec of Object.values(MODULE_ROUTE_SPECS)) {
  SLUG_TO_SPEC.set(spec.baseSlug.toLowerCase(), spec);
  if (spec.aliases) {
    for (const alias of spec.aliases) {
      SLUG_TO_SPEC.set(alias.toLowerCase(), spec);
    }
  }
}

const CHAT_AI_SLUGS = new Set(["assistente", "ia", "fagner", "valentina"]);

/** Memory cache of the last visited tab per module so returning to a module restores its last tab */
const lastActiveTabByView: Partial<Record<ViewId, string>> = {};

export function setRememberedTabForView(viewId: ViewId, tabId: string) {
  lastActiveTabByView[viewId] = tabId;
}

export function getRememberedTabForView(viewId: ViewId): string | undefined {
  return lastActiveTabByView[viewId];
}

export interface ParsedAppRoute {
  isAppShell: boolean;
  isRoot: boolean;
  viewId: ViewId | null;
  tabId?: string;
  chatKey?: string;
  isAiAssistantChat?: boolean;
  extraParam?: string;
}

/**
 * Parses a browser pathname into the corresponding module (ViewId) and sub-tab.
 */
export function parseAppRoute(pathname: string | undefined | null): ParsedAppRoute {
  const clean = (pathname || "/").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";

  if (clean === "/") {
    return {
      isAppShell: true,
      isRoot: true,
      viewId: null,
    };
  }

  // Standalone routes that are NOT rendered inside the main Index shell
  if (
    clean.startsWith("/api/") ||
    clean === "/api" ||
    clean.startsWith("/call/") ||
    clean === "/call" ||
    clean.startsWith("/crm/deals/") ||
    clean === "/crm/deals"
  ) {
    return {
      isAppShell: false,
      isRoot: false,
      viewId: null,
    };
  }

  const segments = clean.slice(1).split("/").filter(Boolean);
  if (segments.length === 0) {
    return {
      isAppShell: true,
      isRoot: true,
      viewId: null,
    };
  }

  const first = decodeURIComponent(segments[0]).toLowerCase();
  const spec = SLUG_TO_SPEC.get(first);
  if (!spec) {
    return {
      isAppShell: false,
      isRoot: false,
      viewId: null,
    };
  }

  // Special handling for Chat module (/chat, /chat/assistente, /chat/$chatKey)
  if (spec.viewId === "chat") {
    if (segments.length === 1) {
      return {
        isAppShell: true,
        isRoot: false,
        viewId: "chat",
      };
    }
    const secondRaw = decodeURIComponent(segments[1]);
    const secondLower = secondRaw.toLowerCase();
    if (CHAT_AI_SLUGS.has(secondLower)) {
      return {
        isAppShell: true,
        isRoot: false,
        viewId: "chat",
        isAiAssistantChat: true,
      };
    }
    return {
      isAppShell: true,
      isRoot: false,
      viewId: "chat",
      chatKey: secondRaw,
    };
  }

  // Other modules: /<module> or /<module>/<tabSlug> or /<module>/<tabSlug>/<extraParam>
  if (segments.length === 1) {
    return {
      isAppShell: true,
      isRoot: false,
      viewId: spec.viewId,
      tabId: undefined,
    };
  }

  const secondLower = decodeURIComponent(segments[1]).toLowerCase();
  const matchedTabId = spec.slugToTab?.[secondLower];
  if (!matchedTabId) {
    // Still a valid module path, fallback to default tab of that module
    return {
      isAppShell: true,
      isRoot: false,
      viewId: spec.viewId,
      tabId: spec.defaultTabId,
    };
  }

  const extraParam = segments.length >= 3 ? decodeURIComponent(segments[2]) : undefined;

  return {
    isAppShell: true,
    isRoot: false,
    viewId: spec.viewId,
    tabId: matchedTabId,
    extraParam,
  };
}

/**
 * Returns true if the pathname is a valid standalone route outside the persistent <Index /> shell
 * (e.g. /crm/deals/:dealId, /call/:roomId).
 */
export function isKnownStandalonePath(pathname: string | undefined | null): boolean {
  const clean = (pathname || "/").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  return (
    clean.startsWith("/crm/deals/") ||
    clean === "/crm/deals" ||
    clean.startsWith("/call/") ||
    clean === "/call" ||
    clean.startsWith("/api/") ||
    clean === "/api"
  );
}

/**
 * Returns true if the pathname should be rendered by the persistent <Index /> shell.
 */
export function isAppShellPath(pathname: string | undefined | null): boolean {
  return parseAppRoute(pathname).isAppShell;
}

/**
 * Builds the canonical URL path for a given module (ViewId) and optional tab/chat state.
 */
export function buildAppRoutePath(
  viewId: ViewId,
  options?: {
    tabId?: string | number | null;
    chatKey?: string | null;
    selectedChatId?: string | null;
    extraParam?: string | null;
  },
): string {
  const spec = MODULE_ROUTE_SPECS[viewId];
  if (!spec) return "/";

  if (viewId === "chat") {
    if (options?.selectedChatId === "valentina") {
      return "/chat/assistente";
    }
    if (options?.chatKey) {
      return `/chat/${encodeURIComponent(options.chatKey)}`;
    }
    return "/chat";
  }

  const rawTabId =
    options?.tabId !== undefined && options?.tabId !== null
      ? String(options.tabId)
      : lastActiveTabByView[viewId] || spec.defaultTabId;

  if (!rawTabId || !spec.tabToSlug) {
    return `/${spec.baseSlug}`;
  }

  const tabSlug = spec.tabToSlug[rawTabId] || spec.tabToSlug[spec.defaultTabId || ""] || rawTabId;

  // For modules where the default tab can also have a clean URL or explicit tab URL:
  // Using explicit tab URLs (e.g. /ia/chat, /ia/sdr, /ligacoes/performance, /tarefas/mes)
  // makes every tab explicitly visible in the address bar.
  if (options?.extraParam) {
    return `/${spec.baseSlug}/${tabSlug}/${encodeURIComponent(options.extraParam)}`;
  }

  return `/${spec.baseSlug}/${tabSlug}`;
}

/**
 * Hook used by each module View to synchronize its internal tab state with the browser URL
 * in 0ms without remounting the shell.
 */
export function useSyncModuleTabWithUrl<T extends string | number>({
  viewId,
  activeTab,
  setActiveTab,
  allowedTabs,
  extraParam,
  replaceOnChange = false,
  enabled = true,
}: {
  viewId: ViewId;
  activeTab: T;
  setActiveTab: (tab: T) => void;
  allowedTabs?: readonly T[];
  extraParam?: string | null;
  replaceOnChange?: boolean;
  enabled?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const prevPathRef = useRef<string>(location.pathname);
  const prevTabRef = useRef<T>(activeTab);
  const isInitialMountRef = useRef(true);

  const isTabAllowed = useCallback(
    (candidate: string): candidate is Extract<T, string> => {
      if (!allowedTabs || allowedTabs.length === 0) return true;
      return allowedTabs.some((t) => String(t) === String(candidate));
    },
    [allowedTabs],
  );

  // 1. On initial mount or when browser URL changes externally (Back / Forward / Direct Link):
  useEffect(() => {
    if (!enabled) return;
    const parsed = parseAppRoute(location.pathname);
    if (parsed.viewId !== viewId) {
      prevPathRef.current = location.pathname;
      return;
    }

    const pathChanged = prevPathRef.current !== location.pathname;
    prevPathRef.current = location.pathname;

    if (isInitialMountRef.current || pathChanged) {
      if (parsed.tabId !== undefined && isTabAllowed(parsed.tabId)) {
        const nextTab = (typeof activeTab === "number" ? Number(parsed.tabId) : parsed.tabId) as T;
        if (nextTab !== activeTab) {
          prevTabRef.current = nextTab;
          setRememberedTabForView(viewId, String(nextTab));
          setActiveTab(nextTab);
          isInitialMountRef.current = false;
          return;
        }
      }
    }

    // If URL is at base module path (e.g. /ia or /ligacoes or /tarefas) without tab slug,
    // normalize it in-place (replace: true) to include the active tab slug!
    const expectedPath = buildAppRoutePath(viewId, {
      tabId: activeTab,
      extraParam,
    });
    setRememberedTabForView(viewId, String(activeTab));

    if (isInitialMountRef.current && location.pathname !== expectedPath) {
      isInitialMountRef.current = false;
      prevPathRef.current = expectedPath;
      navigate({ to: expectedPath as any, replace: true });
      return;
    }

    isInitialMountRef.current = false;
  }, [activeTab, enabled, extraParam, isTabAllowed, location.pathname, navigate, setActiveTab, viewId]);

  // 2. When activeTab changes via user click or keyboard shortcut inside the View:
  useEffect(() => {
    if (!enabled) return;
    setRememberedTabForView(viewId, String(activeTab));
    if (prevTabRef.current === activeTab) return;
    prevTabRef.current = activeTab;

    const parsed = parseAppRoute(location.pathname);
    if (parsed.viewId !== viewId) return;

    const targetPath = buildAppRoutePath(viewId, {
      tabId: activeTab,
      extraParam,
    });

    if (location.pathname !== targetPath) {
      prevPathRef.current = targetPath;
      navigate({ to: targetPath as any, replace: replaceOnChange });
    }
  }, [activeTab, enabled, extraParam, location.pathname, navigate, replaceOnChange, viewId]);
}

/**
 * Helper to read the initial tab from window.location.pathname on first render (SSR-safe)
 * so pressing F5 on /ia/sdr or /ligacoes/vendedor renders the exact tab on frame 0.
 */
export function getInitialTabFromUrl<T extends string | number>(
  viewId: ViewId,
  fallbackTab: T,
  allowedTabs?: readonly T[],
): T {
  if (typeof window === "undefined") return fallbackTab;
  const parsed = parseAppRoute(window.location.pathname);
  if (parsed.viewId === viewId && parsed.tabId !== undefined) {
    const candidate = (typeof fallbackTab === "number" ? Number(parsed.tabId) : parsed.tabId) as T;
    if (!allowedTabs || allowedTabs.length === 0 || allowedTabs.includes(candidate)) {
      return candidate;
    }
  }
  const remembered = getRememberedTabForView(viewId);
  if (remembered !== undefined) {
    const candidate = (typeof fallbackTab === "number" ? Number(remembered) : remembered) as T;
    if (!allowedTabs || allowedTabs.length === 0 || allowedTabs.includes(candidate)) {
      return candidate;
    }
  }
  return fallbackTab;
}
