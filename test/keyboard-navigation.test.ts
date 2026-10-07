import { describe, expect, test } from "bun:test";
import { getAccessibleModulesList, isEditingText } from "../src/hooks/useGlobalKeyboardNavigation";
import { ViewId } from "../src/lib/rbac";

describe("Navegação Ergonômica por Teclado (Módulos e Abas)", () => {
  test("Gera a lista correta de módulos acessíveis para o tenant Tecfag (Admin)", () => {
    const modules = getAccessibleModulesList({
      tenant: "tecfag",
      sessionRole: "admin",
      canAccessView: () => true,
    });

    expect(modules).toContain("commercialHome");
    expect(modules).toContain("chat");
    expect(modules).toContain("crm");
    expect(modules).toContain("tasks");
    expect(modules).toContain("commercialManagement");
    expect(modules).toContain("commercialBi");

    // Início deve ser o primeiro módulo no Tecfag
    expect(modules[0]).toBe("commercialHome");
    expect(modules[1]).toBe("chat");
  });

  test("Gera a lista correta de módulos acessíveis para o tenant Valem", () => {
    const modules = getAccessibleModulesList({
      tenant: "valem",
      sessionRole: "admin",
      canAccessView: () => true,
    });

    // Tenant Valem não deve conter commercialHome, commercialManagement ou commercialBi
    expect(modules).not.toContain("commercialHome");
    expect(modules).not.toContain("commercialManagement");
    expect(modules).not.toContain("commercialBi");

    // Chat deve ser o primeiro módulo na Valem
    expect(modules[0]).toBe("chat");
    expect(modules[1]).toBe("crm");
  });

  test("Respeita permissões RBAC de visualização canAccessView", () => {
    const allowed = new Set<ViewId>(["chat", "crm", "tasks"]);
    const modules = getAccessibleModulesList({
      tenant: "tecfag",
      sessionRole: "user",
      canAccessView: (view) => allowed.has(view),
    });

    expect(modules).toEqual(["chat", "crm", "tasks"]);
  });

  test("Identifica corretamente elementos de digitação de texto para proteção", () => {
    expect(isEditingText(null)).toBe(false);

    // Mock HTML elements
    const div = { tagName: "DIV", isContentEditable: false, getAttribute: () => null, closest: () => null } as any;
    expect(isEditingText(div)).toBe(false);

    const input = { tagName: "INPUT", type: "text", isContentEditable: false, getAttribute: () => null, closest: () => null } as any;
    expect(isEditingText(input)).toBe(true);

    const textarea = { tagName: "TEXTAREA", isContentEditable: false, getAttribute: () => null, closest: () => null } as any;
    expect(isEditingText(textarea)).toBe(true);

    const select = { tagName: "SELECT", isContentEditable: false, getAttribute: () => null, closest: () => null } as any;
    expect(isEditingText(select)).toBe(true);

    const contentEditable = { tagName: "DIV", isContentEditable: true, getAttribute: () => "true", closest: () => null } as any;
    expect(isEditingText(contentEditable)).toBe(true);
  });
});
