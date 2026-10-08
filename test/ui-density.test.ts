import { describe, expect, test, beforeEach } from "bun:test";
import { applyDensity, getInitialDensity, DensityMode } from "../src/hooks/useDensity";

describe("Escala Global de Densidade e Visualização (Notebook / Monitor)", () => {
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
    };

    const mockDoc = {
      documentElement: {
        attributes: {} as Record<string, string>,
        setAttribute(k: string, v: string) {
          this.attributes[k] = v;
        },
        removeAttribute(k: string) {
          delete this.attributes[k];
        },
        getAttribute(k: string) {
          return this.attributes[k] ?? null;
        },
      },
    };

    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: mockDoc, configurable: true, writable: true });
    (globalThis as any).window.localStorage = mockStorage;
    (globalThis as any).window.document = mockDoc;
  });

  test("Retorna 'auto' como densidade inicial padrão quando nada salvo", () => {
    const initial = getInitialDensity();
    expect(initial).toBe("auto");
  });

  test("Lê corretamente a densidade salva no localStorage", () => {
    localStorage.setItem("chat_ui_density", "75");
    expect(getInitialDensity()).toBe("75");

    localStorage.setItem("chat_ui_density", "85");
    expect(getInitialDensity()).toBe("85");

    localStorage.setItem("chat_ui_density", "100");
    expect(getInitialDensity()).toBe("100");
  });

  test("Ignora valores inválidos no localStorage e retorna 'auto'", () => {
    localStorage.setItem("chat_ui_density", "invalid_value");
    expect(getInitialDensity()).toBe("auto");
  });

  test("applyDensity remove data-density quando modo é 'auto'", () => {
    document.documentElement.setAttribute("data-density", "75");
    applyDensity("auto");
    expect(document.documentElement.getAttribute("data-density")).toBeNull();
  });

  test("applyDensity define o atributo data-density para 75, 85 e 100", () => {
    applyDensity("75");
    expect(document.documentElement.getAttribute("data-density")).toBe("75");

    applyDensity("85");
    expect(document.documentElement.getAttribute("data-density")).toBe("85");

    applyDensity("100");
    expect(document.documentElement.getAttribute("data-density")).toBe("100");
  });
});
