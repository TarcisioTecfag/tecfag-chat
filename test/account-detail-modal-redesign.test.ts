import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("AccountDetailModal — Layout, Bordas, Tamanhos e Harmonia de Cores com o Sistema", () => {
  const modalPath = path.resolve(import.meta.dir, "..", "src/components/crm/AccountDetailModal.tsx");
  const customFieldsPath = path.resolve(import.meta.dir, "..", "src/components/crm/CustomFieldsEditor.tsx");
  const catalogSelectPath = path.resolve(import.meta.dir, "..", "src/components/crm/CatalogSelect.tsx");

  it("elimina todas as cores sky-* e bg-white hardcoded do AccountDetailModal em favor dos tokens do sistema (primary, card, muted, border)", () => {
    const source = readFileSync(modalPath, "utf8");

    expect(source).not.toContain("sky-");
    expect(source).not.toContain("bg-white");
    expect(source).toContain("bg-primary");
    expect(source).toContain("text-primary");
    expect(source).toContain("bg-card");
    expect(source).toContain("border-border");
  });

  it("utiliza largura total do formulário (sem max-w-2xl truncando a direita) e rodapé fixo de ações", () => {
    const source = readFileSync(modalPath, "utf8");

    expect(source).not.toContain("max-w-2xl");
    expect(source).toContain('id="account-detail-form"');
    expect(source).toContain('form="account-detail-form"');
    expect(source).toContain("columns={2}");
  });

  it("padroniza alturas (h-9), raios (rounded-[8px]) e bordas visíveis nos inputs e selects de AccountDetailModal, CustomFieldsEditor e CatalogSelect", () => {
    const modalSource = readFileSync(modalPath, "utf8");
    const customFieldsSource = readFileSync(customFieldsPath, "utf8");
    const catalogSelectSource = readFileSync(catalogSelectPath, "utf8");

    expect(modalSource).toContain("h-9 w-full rounded-[8px]");
    expect(customFieldsSource).toContain("h-9 w-full rounded-[8px]");
    expect(customFieldsSource).toContain("grid-cols-1 md:grid-cols-2");
    expect(catalogSelectSource).toContain("h-9 w-full rounded-[8px]");
  });
});
