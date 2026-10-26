import { describe, expect, it } from "bun:test";
import {
  MODULE_CATALOG,
  getAuthorizedCatalogModules,
  getDesktopSidebarModules,
  getMobileNavigationModules,
  isModuleAuthorized,
  resolveAuthorizedActiveView,
} from "../src/lib/module-catalog";
import { shouldShowMiniChatWidget } from "../src/lib/widget-visibility";
import {
  getConversationPreviewMessage,
  isAutoDealContextSystemNote,
} from "../src/components/crm/CrmChatWidget";
import type { ViewId } from "../src/lib/rbac";

describe("Paridade e Catálogo de Módulos (Desktop & Mobile)", () => {
  const all14Modules: ViewId[] = [
    "commercialHome",
    "chat",
    "crm",
    "tasks",
    "contacts",
    "wallet",
    "commercialManagement",
    "commercialBi",
    "valentina",
    "ligacoes",
    "monitor",
    "analytics",
    "groups",
    "settings",
  ];

  it("Catálogo central registra todos os 14 módulos do sistema", () => {
    const catalogIds = MODULE_CATALOG.map((m) => m.id);
    expect(catalogIds).toEqual(all14Modules);
  });

  it("Aplica regras de tenant e RBAC em isModuleAuthorized para Tecfag e Valem", () => {
    const allowAll = () => true;

    // commercialHome exige tecfag + isCommercialConsultant + canAccessView
    expect(
      isModuleAuthorized("commercialHome", {
        tenant: "tecfag",
        sessionRole: "agent",
        isCommercialConsultant: true,
        canAccessView: allowAll,
      }),
    ).toBe(true);
    expect(
      isModuleAuthorized("commercialHome", {
        tenant: "valem",
        sessionRole: "admin",
        isCommercialConsultant: true,
        canAccessView: allowAll,
      }),
    ).toBe(false);

    // commercialManagement exige tecfag + admin
    expect(
      isModuleAuthorized("commercialManagement", {
        tenant: "tecfag",
        sessionRole: "agent",
        isCommercialConsultant: true,
        canAccessView: allowAll,
      }),
    ).toBe(false);
    expect(
      isModuleAuthorized("commercialManagement", {
        tenant: "tecfag",
        sessionRole: "admin",
        isCommercialConsultant: true,
        canAccessView: allowAll,
      }),
    ).toBe(true);
    expect(
      isModuleAuthorized("commercialManagement", {
        tenant: "valem",
        sessionRole: "admin",
        isCommercialConsultant: true,
        canAccessView: allowAll,
      }),
    ).toBe(false);

    // commercialBi exige tecfag + canAccessView("commercialBi") (ou admin com commercialManagement)
    expect(
      isModuleAuthorized("commercialBi", {
        tenant: "tecfag",
        sessionRole: "agent",
        isCommercialConsultant: false,
        canAccessView: (v) => v === "commercialBi",
      }),
    ).toBe(true);
    expect(
      isModuleAuthorized("commercialBi", {
        tenant: "valem",
        sessionRole: "admin",
        isCommercialConsultant: true,
        canAccessView: allowAll,
      }),
    ).toBe(false);
  });

  it("Expõe todos os 14 módulos autorizados na navegação mobile e 13 no rail desktop (War Room via atalho/menu)", () => {
    const ctx = {
      tenant: "tecfag",
      sessionRole: "admin",
      isCommercialConsultant: true,
      canAccessView: () => true,
    };

    const desktop = getDesktopSidebarModules(ctx);
    const mobile = getMobileNavigationModules(ctx);
    const allAuth = getAuthorizedCatalogModules(ctx);

    expect(allAuth.length).toBe(14);
    expect([...desktop.navItems, ...desktop.decorativeItems].length).toBe(13);
    expect(
      [...mobile.drawerPrimaryItems, ...mobile.drawerSecondaryItems].map((m) => m.id),
    ).toEqual(allAuth.map((m) => m.id));
    expect(mobile.bottomItems.length).toBe(4);
  });

  it("Redireciona view não autorizada para o módulo fallback autorizado em resolveAuthorizedActiveView", () => {
    const valemCtx = {
      tenant: "valem",
      sessionRole: "agent",
      isCommercialConsultant: false,
      canAccessView: (view: ViewId) => view === "chat" || view === "crm",
    };

    // commercialHome não é autorizado na Valem -> deve redirecionar para "chat"
    expect(resolveAuthorizedActiveView("commercialHome", valemCtx)).toBe("chat");
    // monitor não é autorizado para este agente -> deve redirecionar para "chat"
    expect(resolveAuthorizedActiveView("monitor", valemCtx)).toBe("chat");
    // crm é autorizado -> mantém "crm"
    expect(resolveAuthorizedActiveView("crm", valemCtx)).toBe("crm");
  });

  it("Habilita Mini Chat (shouldShowMiniChatWidget) em módulos superiores no desktop e no mobile", () => {
    expect(
      shouldShowMiniChatWidget({
        pathname: "/crm",
        activeView: "crm",
        isAuthenticated: true,
        isMobile: true,
      }),
    ).toBe(true);

    expect(
      shouldShowMiniChatWidget({
        pathname: "/chat",
        activeView: "chat",
        isAuthenticated: true,
        isMobile: true,
      }),
    ).toBe(false);

    expect(
      shouldShowMiniChatWidget({
        pathname: "/crm/deals/123",
        activeView: "chat",
        isAuthenticated: true,
        isMobile: true,
      }),
    ).toBe(true);
  });

  it("Ignora notas automáticas de seleção de negociação no preview da lista de conversas", () => {
    expect(
      isAutoDealContextSystemNote(
        "[Nota] Negociação atual selecionada automaticamente: Matheus dos santos vieira - Equipamentos.",
      ),
    ).toBe(true);

    const messages = [
      { id: "m1", text: "Bom dia, gostaria de um orçamento de seladora", sender: "client" as const, time: "10:15" },
      {
        id: "m2",
        text: "[Nota] Negociação atual selecionada automaticamente: Matheus dos santos vieira - Equipamentos.",
        sender: "system" as const,
        time: "10:16",
      },
    ];

    expect(getConversationPreviewMessage(messages)?.id).toBe("m1");
  });
});
