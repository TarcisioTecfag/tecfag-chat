import { describe, expect, test } from "bun:test";
import { rememberRdMarketingFlow, restoreRdMarketingFlow } from "../src/lib/rd-marketing/selection";

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
const flows = [
  { id: "one", settings: { name: "Primeiro" } },
  { id: "two", settings: { name: "Segundo" } },
];

describe("RD Marketing: reabrir integrações salvas", () => {
  test("abre um fluxo salvo mesmo no primeiro acesso em outro navegador", () => {
    expect(restoreRdMarketingFlow("tenant-a", flows, storage())).toEqual(flows[0]);
    expect(restoreRdMarketingFlow("tenant-a", [], storage())).toBeNull();
  });

  test("restaura a seleção e a configuração do servidor depois de recarregar", () => {
    const saved = storage();
    rememberRdMarketingFlow("tenant-a", "two", saved);
    const updated = [{ ...flows[1], settings: { name: "Atualizado no servidor" } }];
    expect(restoreRdMarketingFlow("tenant-a", updated, saved)).toEqual(updated[0]);
    expect(restoreRdMarketingFlow("tenant-a", flows, saved)).toEqual(flows[1]);
  });

  test("não usa preferência de outro tenant nem fluxo ausente na resposta", () => {
    const saved = storage();
    rememberRdMarketingFlow("tenant-a", "two", saved);
    expect(restoreRdMarketingFlow("tenant-b", flows, saved)).toEqual(flows[0]);
    expect(restoreRdMarketingFlow("tenant-a", [flows[0]], saved)).toEqual(flows[0]);
  });

  test("iniciar rascunho não esconde o último fluxo salvo após recarregar", () => {
    const saved = storage();
    rememberRdMarketingFlow("tenant-a", "two", saved);
    rememberRdMarketingFlow("tenant-a", "", saved);
    expect(restoreRdMarketingFlow("tenant-a", flows, saved)).toEqual(flows[1]);
  });

  test("armazenamento bloqueado não impede abrir configurações do servidor", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => rememberRdMarketingFlow("tenant-a", "two", blocked)).not.toThrow();
    expect(restoreRdMarketingFlow("tenant-a", flows, blocked)).toEqual(flows[0]);
  });
});
