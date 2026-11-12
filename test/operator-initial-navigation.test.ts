import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeInitialLetter,
  sortAlphabeticallyByName,
  getAvailableInitials,
  cycleItemByInitial,
  stepActiveItem,
  isEditableKeyboardTarget,
  extractInitialKeyFromKeyboardEvent,
} from "../src/lib/operator-initial-navigation";

describe("operator-initial-navigation — ordenação alfabética e ciclo por letra inicial", () => {
  const rawOperators = [
    { id: "op-7", name: "Victor Hugo" },
    { id: "op-3", name: "Carlos Eduardo" },
    { id: "op-1", name: "beatriz ribeiro" },
    { id: "op-5", name: "Carolina Mendes" },
    { id: "op-2", name: "Átila Costa" },
    { id: "op-4", name: "Camila Souza" },
    { id: "op-6", name: "Denise Gomes" },
    { id: "op-8", name: "Denis Menezes" },
  ];

  test("ordena operadores sempre em ordem alfabética (pt-BR, case-insensitive e ignorando acentos)", () => {
    const sorted = sortAlphabeticallyByName(rawOperators);
    expect(sorted.map((op) => op.name)).toEqual([
      "Átila Costa",
      "beatriz ribeiro",
      "Camila Souza",
      "Carlos Eduardo",
      "Carolina Mendes",
      "Denis Menezes",
      "Denise Gomes",
      "Victor Hugo",
    ]);
    // Garante imutabilidade do array original
    expect(rawOperators[0].name).toBe("Victor Hugo");
  });

  test("ordena setores do menu de transferência em ordem alfabética (pt-BR)", () => {
    const rawSectors = [
      { id: "s1", name: "Projetos" },
      { id: "s2", name: "Peças" },
      { id: "s3", name: "Pós venda" },
      { id: "s4", name: "Suporte Técnico" },
      { id: "s5", name: "Sdr" },
      { id: "s6", name: "Financeiro" },
      { id: "s7", name: "Recepção" },
    ];
    const sorted = sortAlphabeticallyByName(rawSectors);
    expect(sorted.map((s) => s.name)).toEqual([
      "Financeiro",
      "Peças",
      "Pós venda",
      "Projetos",
      "Recepção",
      "Sdr",
      "Suporte Técnico",
    ]);
  });

  test("normaliza letras iniciais com acentos, minúsculas e espaços", () => {
    expect(normalizeInitialLetter("Carlos")).toBe("C");
    expect(normalizeInitialLetter("  camila ")).toBe("C");
    expect(normalizeInitialLetter("Átila")).toBe("A");
    expect(normalizeInitialLetter("érica")).toBe("E");
    expect(normalizeInitialLetter("Ícaro")).toBe("I");
    expect(normalizeInitialLetter("")).toBe("");
    expect(normalizeInitialLetter(null)).toBe("");
  });

  test("extrai iniciais únicas disponíveis em ordem alfabética", () => {
    const sorted = sortAlphabeticallyByName(rawOperators);
    expect(getAvailableInitials(sorted)).toEqual(["A", "B", "C", "D", "V"]);
  });

  test("clicar/teclar C avança ciclicamente entre todos os operadores que começam com C", () => {
    const sorted = sortAlphabeticallyByName(rawOperators);

    // 1º clique/tecla C -> Camila Souza (1/3)
    const first = cycleItemByInitial({
      items: sorted,
      letter: "c",
      currentActiveId: null,
    });
    expect(first?.item.name).toBe("Camila Souza");
    expect(first?.matchPosition).toBe(1);
    expect(first?.matchCount).toBe(3);

    // 2º clique/tecla C -> Carlos Eduardo (2/3)
    const second = cycleItemByInitial({
      items: sorted,
      letter: "C",
      currentActiveId: first?.id,
    });
    expect(second?.item.name).toBe("Carlos Eduardo");
    expect(second?.matchPosition).toBe(2);
    expect(second?.matchCount).toBe(3);

    // 3º clique/tecla C -> Carolina Mendes (3/3)
    const third = cycleItemByInitial({
      items: sorted,
      letter: "c",
      currentActiveId: second?.id,
    });
    expect(third?.item.name).toBe("Carolina Mendes");
    expect(third?.matchPosition).toBe(3);
    expect(third?.matchCount).toBe(3);

    // 4º clique/tecla C -> volta ao início do grupo C (Camila Souza, 1/3)
    const wrap = cycleItemByInitial({
      items: sorted,
      letter: "C",
      currentActiveId: third?.id,
    });
    expect(wrap?.item.name).toBe("Camila Souza");
    expect(wrap?.matchPosition).toBe(1);

    // Mudar para letra D a partir de C -> vai para o 1º D (Denis Menezes, 1/2)
    const firstD = cycleItemByInitial({
      items: sorted,
      letter: "d",
      currentActiveId: second?.id,
    });
    expect(firstD?.item.name).toBe("Denis Menezes");
    expect(firstD?.matchPosition).toBe(1);
    expect(firstD?.matchCount).toBe(2);

    // Repetir D -> Denise Gomes (2/2)
    const secondD = cycleItemByInitial({
      items: sorted,
      letter: "D",
      currentActiveId: firstD?.id,
    });
    expect(secondD?.item.name).toBe("Denise Gomes");
    expect(secondD?.matchPosition).toBe(2);

    // Letra inexistente -> retorna null
    const none = cycleItemByInitial({
      items: sorted,
      letter: "Z",
      currentActiveId: secondD?.id,
    });
    expect(none).toBeNull();
  });

  test("suporta navegação por setas ArrowDown / ArrowUp e detecção segura de teclas/inputs", () => {
    const sorted = sortAlphabeticallyByName(rawOperators);
    const step1 = stepActiveItem({ items: sorted, direction: 1, currentActiveId: null });
    expect(step1?.item.name).toBe("Átila Costa");

    const step2 = stepActiveItem({ items: sorted, direction: 1, currentActiveId: step1?.id });
    expect(step2?.item.name).toBe("beatriz ribeiro");

    const stepWrapUp = stepActiveItem({ items: sorted, direction: -1, currentActiveId: step1?.id });
    expect(stepWrapUp?.item.name).toBe("Victor Hugo");

    expect(extractInitialKeyFromKeyboardEvent({ key: "c" })).toBe("C");
    expect(extractInitialKeyFromKeyboardEvent({ key: "c", ctrlKey: true })).toBeNull();
    expect(extractInitialKeyFromKeyboardEvent({ key: "Enter" })).toBeNull();

    expect(isEditableKeyboardTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
  });

  test("componentes de transferência integram ordenação alfabética + OperatorInitialQuickBar sem title nativo", () => {
    const root = path.resolve(__dirname, "..");
    const quickBarSource = fs.readFileSync(
      path.join(root, "src/components/chat/OperatorInitialQuickBar.tsx"),
      "utf8",
    );
    expect(quickBarSource).not.toMatch(/\btitle\s*=/);

    const chatPanelSource = fs.readFileSync(
      path.join(root, "src/components/chat/ChatPanel.tsx"),
      "utf8",
    );
    expect(chatPanelSource).toContain("OperatorInitialQuickBar");
    expect(chatPanelSource).toContain("handleCycleTransferDropdownInitial");
    expect(chatPanelSource).toContain("sortedTransferDropdownOps");

    const miniChatSource = fs.readFileSync(
      path.join(root, "src/components/crm/CrmChatWidget.tsx"),
      "utf8",
    );
    expect(miniChatSource).toContain("OperatorInitialQuickBar");
    expect(miniChatSource).toContain("sortedTransferOperators");

    const mobileSource = fs.readFileSync(
      path.join(root, "src/components/mobile/MobileActionsModal.tsx"),
      "utf8",
    );
    expect(mobileSource).toContain("OperatorInitialQuickBar");
    expect(mobileSource).toContain("sortedOperators");
  });
});
