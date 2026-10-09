import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("Redesenho Minimalista de Configurações de Perfil (ProfileModal.tsx)", () => {
  const profileModalPath = join(process.cwd(), "src/components/chat/ProfileModal.tsx");
  const profileModalContent = readFileSync(profileModalPath, "utf-8");

  it("deve conter arquitetura de abas com Perfil e Aparência", () => {
    expect(profileModalContent).toContain('activeTab === "perfil"');
    expect(profileModalContent).toContain('activeTab === "aparencia"');
    expect(profileModalContent).toContain('setActiveTab("perfil")');
    expect(profileModalContent).toContain('setActiveTab("aparencia")');
  });

  it("deve conter seletor de avatar por divulgação progressiva (showAvatarPicker)", () => {
    expect(profileModalContent).toContain("showAvatarPicker");
    expect(profileModalContent).toContain("setShowAvatarPicker");
    expect(profileModalContent).toContain("SYSTEM_AVATAR_PRESETS");
    expect(profileModalContent).toContain("Subir do PC");
  });

  it("deve conter status operacional semântico inline (disponivel, pausa, desconectado)", () => {
    expect(profileModalContent).toContain('setStatus("disponivel")');
    expect(profileModalContent).toContain('setStatus("pausa")');
    expect(profileModalContent).toContain('setStatus("desconectado")');
    expect(profileModalContent).toContain("bg-emerald-500");
    expect(profileModalContent).toContain("bg-amber-500");
    expect(profileModalContent).toContain("bg-zinc-400");
  });

  it("deve conter controles de Tema e Densidade de Tela na aba de Aparência", () => {
    expect(profileModalContent).toContain('setTheme("light")');
    expect(profileModalContent).toContain('setTheme("dark")');
    expect(profileModalContent).toContain('setTheme("system")');
    expect(profileModalContent).toContain('setDensity("auto")');
    expect(profileModalContent).toContain('setDensity("75")');
    expect(profileModalContent).toContain('setDensity("85")');
    expect(profileModalContent).toContain('setDensity("100")');
  });

  it("deve preservar funções de segurança, grupos de acesso e logout", () => {
    expect(profileModalContent).toContain("logout()");
    expect(profileModalContent).toContain("currentGroup");
    expect(profileModalContent).toContain("Grupo de Acesso");
    expect(profileModalContent).toContain("updateOperatorProfile");
  });
});
