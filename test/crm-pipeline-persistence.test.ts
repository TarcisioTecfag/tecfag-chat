import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { getSavedCrmPipelineId, saveCrmPipelineId } from "../src/components/crm/CrmView";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Persistência do Funil Selecionado no CRM & Remoção de '(Padrão)'", () => {
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;

  beforeEach(() => {
    const mockStorage = {
      _store: {} as Record<string, string>,
      getItem(key: string) {
        return this._store[key] ?? null;
      },
      setItem(key: string, val: string) {
        this._store[key] = val;
      },
      removeItem(key: string) {
        delete this._store[key];
      },
      clear() {
        this._store = {};
      },
    };

    Object.defineProperty(globalThis, "window", {
      value: {
        location: {
          search: "",
          href: "http://localhost:3000/",
        },
        history: {
          replaceState: () => {},
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      configurable: true,
      writable: true,
    });
    (globalThis as any).window.localStorage = mockStorage;
  });

  afterAll(() => {
    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
    if (originalLocalStorage !== undefined) {
      (globalThis as any).localStorage = originalLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
  });

  test("Salva e recupera o funil selecionado por tenant e operador no localStorage", () => {
    saveCrmPipelineId("pipe-tecfag-pecas", "tecfag", "op-tarcisio");

    const saved = getSavedCrmPipelineId("tecfag", "op-tarcisio");
    expect(saved).toBe("pipe-tecfag-pecas");
  });

  test("Simulação de fechamento de aba: ao recarregar sem memória, restaura exatamente o funil em que o usuário parou", () => {
    // 1. Usuário seleciona o Funil Peças
    saveCrmPipelineId("pipe-tecfag-pecas", "tecfag", "op-tarcisio");

    // 2. Simula fechamento de aba e novo acesso (limpa variáveis em memória)
    const pipelineRestaurado = getSavedCrmPipelineId("tecfag", "op-tarcisio");
    expect(pipelineRestaurado).toBe("pipe-tecfag-pecas");

    // 3. Usuário troca para o Funil Suporte Técnico
    saveCrmPipelineId("pipe-tecfag-suporte-tecnico", "tecfag", "op-tarcisio");

    // 4. Nova sessão restaura o novo funil
    expect(getSavedCrmPipelineId("tecfag", "op-tarcisio")).toBe("pipe-tecfag-suporte-tecnico");
  });

  test("Isolamento entre operadores: cada atendente tem seu próprio funil memorizado", () => {
    // Operador Tarcísio está no Funil Peças
    saveCrmPipelineId("pipe-tecfag-pecas", "tecfag", "op-tarcisio");

    // Operadora Melissa está no Funil Projetos
    saveCrmPipelineId("pipe-tecfag-projetos", "tecfag", "op-melissa");

    expect(getSavedCrmPipelineId("tecfag", "op-tarcisio")).toBe("pipe-tecfag-pecas");
    expect(getSavedCrmPipelineId("tecfag", "op-melissa")).toBe("pipe-tecfag-projetos");
  });

  test("Fallback hierárquico quando operador específico ainda não carregou", () => {
    // Salva para o tenant
    saveCrmPipelineId("pipe-tecfag-pecas", "tecfag", "op-tarcisio");

    // Se a sessão ainda não resolveu o ID do operador, recupera pelo tenant
    expect(getSavedCrmPipelineId("tecfag", null)).toBe("pipe-tecfag-pecas");
  });

  test("Prioridade máxima para parâmetro de URL (?pipelineId=...)", () => {
    saveCrmPipelineId("pipe-tecfag-pecas", "tecfag", "op-tarcisio");

    (globalThis as any).window.location.search = "?pipelineId=pipe-tecfag-projetos";
    expect(getSavedCrmPipelineId("tecfag", "op-tarcisio")).toBe("pipe-tecfag-projetos");
  });

  test("Verificação de código-fonte: eliminação total de '(Padrão)' no CrmToolbar", () => {
    const toolbarPath = path.resolve(import.meta.dir, "../src/components/crm/CrmToolbar.tsx");
    const content = fs.readFileSync(toolbarPath, "utf-8");

    // Não deve conter a concatenação do texto '(Padrão)' na renderização dos itens do select
    expect(content).not.toContain('" (Padrão)"');
    expect(content).not.toContain("' (Padrão)'");
  });

  test("Verificação de código-fonte: CrmView não força fallback de 'isDefault'", () => {
    const crmViewPath = path.resolve(import.meta.dir, "../src/components/crm/CrmView.tsx");
    const content = fs.readFileSync(crmViewPath, "utf-8");

    // Não deve existir 'list.find((p) => p.isDefault)' forçando reset de funil
    expect(content).not.toContain("p.isDefault");
  });
});
