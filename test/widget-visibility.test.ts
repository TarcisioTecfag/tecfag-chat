import { describe, expect, it } from "bun:test";
import { shouldShowMiniChatWidget, UPPER_MODULES_WITH_CHAT_WIDGET } from "../src/lib/widget-visibility";

describe("Regra de Visibilidade do Mini Pop-up 'Conversas' (CrmChatWidget)", () => {
  it("deve conter exatamente os 5 módulos superiores permitidos", () => {
    expect(UPPER_MODULES_WITH_CHAT_WIDGET).toEqual([
      "commercialHome",
      "crm",
      "tasks",
      "contacts",
      "wallet",
    ]);
  });

  describe("Módulos Superiores Permitidos", () => {
    it("deve permitir exibição no módulo Início (commercialHome)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "commercialHome", pathname: "/" })
      ).toBe(true);
    });

    it("deve permitir exibição no módulo Negociações (crm)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "crm", pathname: "/" })
      ).toBe(true);
    });

    it("deve permitir exibição na rota de detalhe de deal (/crm/deals/123)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "crm", pathname: "/crm/deals/123" })
      ).toBe(true);
    });

    it("deve permitir exibição no módulo Tarefas (tasks)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "tasks", pathname: "/" })
      ).toBe(true);
    });

    it("deve permitir exibição no módulo Base de Clientes (contacts)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "contacts", pathname: "/" })
      ).toBe(true);
    });

    it("deve permitir exibição no módulo Minha Carteira (wallet)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "wallet", pathname: "/" })
      ).toBe(true);
    });
  });

  describe("Exceção Mandatória: Módulo Superior Chat (NÃO deve aparecer)", () => {
    it("NÃO deve exibir quando activeView for 'chat'", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "chat", pathname: "/" })
      ).toBe(false);
    });

    it("NÃO deve exibir na rota direta /chat", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "chat", pathname: "/chat" })
      ).toBe(false);
    });

    it("NÃO deve exibir na rota de conversa aberta /chat/5514998364338", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "chat", pathname: "/chat/5514998364338" })
      ).toBe(false);
    });

    it("NÃO deve exibir na rota /chat mesmo se activeView for crm (proteção de rota)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "crm", pathname: "/chat/123" })
      ).toBe(false);
    });
  });

  describe("Módulos Administrativos / Inferiores (NUNCA devem exibir)", () => {
    it("NÃO deve exibir em Gestão Comercial (commercialManagement)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "commercialManagement", pathname: "/" })
      ).toBe(false);
    });

    it("NÃO deve exibir no War Room (commercialBi)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "commercialBi", pathname: "/" })
      ).toBe(false);
    });

    it("NÃO deve exibir no Chat Valentina / Fagner IA (valentina)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "valentina", pathname: "/" })
      ).toBe(false);
    });

    it("NÃO deve exibir em Ligações (ligacoes)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "ligacoes", pathname: "/" })
      ).toBe(false);
    });

    it("NÃO deve exibir em Monitorar (monitor)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "monitor", pathname: "/" })
      ).toBe(false);
    });

    it("NÃO deve exibir em Estatísticas (analytics)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "analytics", pathname: "/" })
      ).toBe(false);
    });

    it("NÃO deve exibir em Grupo de Acesso (groups)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "groups", pathname: "/" })
      ).toBe(false);
    });

    it("NÃO deve exibir em Ajustes (settings)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "settings", pathname: "/" })
      ).toBe(false);
    });

    it("NÃO deve exibir em rotas de chamada (/call/*)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "crm", pathname: "/call/room-xyz" })
      ).toBe(false);
    });
  });

  describe("Condições de Autenticação e Dispositivo", () => {
    it("NÃO deve exibir se não autenticado", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "crm", isAuthenticated: false })
      ).toBe(false);
    });

    it("NÃO deve exibir em dispositivos móveis (isMobile = true)", () => {
      expect(
        shouldShowMiniChatWidget({ activeView: "crm", isMobile: true })
      ).toBe(false);
    });
  });
});
