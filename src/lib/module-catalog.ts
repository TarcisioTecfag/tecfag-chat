import type { ComponentType } from "react";
import {
  House,
  Users,
  Columns3,
  ClipboardCheck,
  Contact,
  Wallet,
  BriefcaseBusiness,
  LineChart,
  Bot,
  PhoneCall,
  Eye,
  BarChart2,
  Shield,
  Settings,
} from "lucide-react";
import { getAiPersona } from "@/lib/ai-persona";
import type { ViewId } from "@/lib/rbac";

export interface ModuleAccessContext {
  tenant: string | null;
  sessionRole?: string | null;
  isCommercialConsultant?: boolean;
  canAccessView: (viewId: ViewId) => boolean;
}

export interface ModuleCatalogEntry {
  id: ViewId;
  section: "primary" | "secondary";
  showInDesktopRail?: boolean;
  mobilePrimaryCandidate?: boolean;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  getLabel: (tenant: string | null) => string;
  getShortLabel: (tenant: string | null) => string;
}

export interface ResolvedModuleItem {
  id: ViewId;
  section: "primary" | "secondary";
  showInDesktopRail: boolean;
  mobilePrimaryCandidate: boolean;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  shortLabel: string;
  isAvailable: boolean;
}

export const MODULE_CATALOG: ModuleCatalogEntry[] = [
  {
    id: "commercialHome",
    section: "primary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: true,
    icon: House,
    getLabel: () => "Início",
    getShortLabel: () => "Início",
  },
  {
    id: "chat",
    section: "primary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: true,
    icon: Users,
    getLabel: () => "Chat",
    getShortLabel: () => "Chat",
  },
  {
    id: "crm",
    section: "primary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: true,
    icon: Columns3,
    getLabel: () => "Negociações",
    getShortLabel: () => "Negócios",
  },
  {
    id: "tasks",
    section: "primary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: true,
    icon: ClipboardCheck,
    getLabel: () => "Tarefas",
    getShortLabel: () => "Tarefas",
  },
  {
    id: "contacts",
    section: "primary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: true,
    icon: Contact,
    getLabel: () => "Base de Clientes",
    getShortLabel: () => "Clientes",
  },
  {
    id: "wallet",
    section: "primary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: false,
    icon: Wallet,
    getLabel: () => "Minha Carteira",
    getShortLabel: () => "Carteira",
  },
  {
    id: "commercialManagement",
    section: "secondary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: false,
    icon: BriefcaseBusiness,
    getLabel: () => "Gestão Comercial",
    getShortLabel: () => "Gestão",
  },
  {
    id: "commercialBi",
    section: "secondary",
    showInDesktopRail: false,
    mobilePrimaryCandidate: false,
    icon: LineChart,
    getLabel: () => "War Room BI",
    getShortLabel: () => "War Room",
  },
  {
    id: "valentina",
    section: "secondary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: false,
    icon: Bot,
    getLabel: (tenant) => getAiPersona(tenant || "valem").name,
    getShortLabel: (tenant) => getAiPersona(tenant || "valem").name,
  },
  {
    id: "ligacoes",
    section: "secondary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: false,
    icon: PhoneCall,
    getLabel: () => "Ligações",
    getShortLabel: () => "Ligações",
  },
  {
    id: "monitor",
    section: "secondary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: false,
    icon: Eye,
    getLabel: () => "Monitorar",
    getShortLabel: () => "Monitor",
  },
  {
    id: "analytics",
    section: "secondary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: false,
    icon: BarChart2,
    getLabel: () => "Estatísticas",
    getShortLabel: () => "Dados",
  },
  {
    id: "groups",
    section: "secondary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: false,
    icon: Shield,
    getLabel: () => "Grupo de Acesso",
    getShortLabel: () => "Acessos",
  },
  {
    id: "settings",
    section: "secondary",
    showInDesktopRail: true,
    mobilePrimaryCandidate: false,
    icon: Settings,
    getLabel: () => "Ajustes",
    getShortLabel: () => "Ajustes",
  },
];

export function isModuleAuthorized(viewId: ViewId, ctx: ModuleAccessContext): boolean {
  if (viewId === "commercialHome") {
    return ctx.tenant === "tecfag" && Boolean(ctx.isCommercialConsultant) && ctx.canAccessView("commercialHome");
  }
  if (viewId === "commercialManagement") {
    return ctx.tenant === "tecfag" && ctx.sessionRole === "admin" && ctx.canAccessView("commercialManagement");
  }
  if (viewId === "commercialBi") {
    if (ctx.tenant !== "tecfag") return false;
    return (
      ctx.canAccessView("commercialBi") ||
      (ctx.sessionRole === "admin" && ctx.canAccessView("commercialManagement"))
    );
  }
  return ctx.canAccessView(viewId);
}

export function getAuthorizedCatalogModules(ctx: ModuleAccessContext): ResolvedModuleItem[] {
  return MODULE_CATALOG.filter((entry) => isModuleAuthorized(entry.id, ctx)).map((entry) => ({
    id: entry.id,
    section: entry.section,
    showInDesktopRail: entry.showInDesktopRail !== false,
    mobilePrimaryCandidate: Boolean(entry.mobilePrimaryCandidate),
    icon: entry.icon,
    label: entry.getLabel(ctx.tenant),
    shortLabel: entry.getShortLabel(ctx.tenant),
    isAvailable: true,
  }));
}

export function getDesktopSidebarModules(ctx: ModuleAccessContext): {
  navItems: ResolvedModuleItem[];
  decorativeItems: ResolvedModuleItem[];
} {
  const authorized = getAuthorizedCatalogModules(ctx).filter((item) => item.showInDesktopRail);
  return {
    navItems: authorized.filter((item) => item.section === "primary"),
    decorativeItems: authorized.filter((item) => item.section === "secondary"),
  };
}

export function getMobileNavigationModules(ctx: ModuleAccessContext, maxBottomItems = 4): {
  bottomItems: ResolvedModuleItem[];
  drawerPrimaryItems: ResolvedModuleItem[];
  drawerSecondaryItems: ResolvedModuleItem[];
  allAuthorizedItems: ResolvedModuleItem[];
} {
  const allAuthorizedItems = getAuthorizedCatalogModules(ctx);
  const preferredOrder: ViewId[] = ["chat", "crm", "tasks", "contacts", "commercialHome", "wallet", "valentina", "monitor"];

  const bottomItems: ResolvedModuleItem[] = [];
  for (const preferredId of preferredOrder) {
    if (bottomItems.length >= maxBottomItems) break;
    const match = allAuthorizedItems.find((m) => m.id === preferredId);
    if (match && !bottomItems.some((b) => b.id === match.id)) {
      bottomItems.push(match);
    }
  }

  for (const item of allAuthorizedItems) {
    if (bottomItems.length >= maxBottomItems) break;
    if (!bottomItems.some((b) => b.id === item.id)) {
      bottomItems.push(item);
    }
  }

  return {
    bottomItems,
    drawerPrimaryItems: allAuthorizedItems.filter((item) => item.section === "primary"),
    drawerSecondaryItems: allAuthorizedItems.filter((item) => item.section === "secondary"),
    allAuthorizedItems,
  };
}

export function resolveAuthorizedActiveView(
  activeView: ViewId,
  ctx: ModuleAccessContext
): ViewId | null {
  if (isModuleAuthorized(activeView, ctx)) {
    return activeView;
  }

  if (
    (activeView === "commercialHome" ||
      activeView === "commercialManagement" ||
      activeView === "commercialBi") &&
    isModuleAuthorized("chat", ctx)
  ) {
    return "chat";
  }

  const authorized = getAuthorizedCatalogModules(ctx);
  return authorized[0]?.id ?? null;
}
