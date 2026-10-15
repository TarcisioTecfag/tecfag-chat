import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatTemplateFirstName,
  resolveMetaTemplateValues,
} from "../src/lib/whatsapp/meta-template-common";

describe("Meta Template Inline Composer & First-Name Formatting (No @)", () => {
  it("formatTemplateFirstName extrai apenas o primeiro nome com primeira letra maiúscula e sem @", () => {
    expect(formatTemplateFirstName("Joao Lanza")).toBe("Joao");
    expect(formatTemplateFirstName("Tarcisio Pereira")).toBe("Tarcisio");
    expect(formatTemplateFirstName("@Joao Lanza")).toBe("Joao");
    expect(formatTemplateFirstName("@@tarcisio pereira da silva")).toBe("Tarcisio");
    expect(formatTemplateFirstName("MARIA VITÓRIA SOUZA")).toBe("Maria");
    expect(formatTemplateFirstName("joão carlos")).toBe("João");
    expect(formatTemplateFirstName("   ", "Cliente Padrão")).toBe("Cliente");
    expect(formatTemplateFirstName(null, "Atendente")).toBe("Atendente");
  });

  it("resolveMetaTemplateValues envia apenas o primeiro nome capitalizado sem @ para customer_name e operator_name", () => {
    const resolved = resolveMetaTemplateValues(
      3,
      {
        "1": "customer_name",
        "2": "operator_name",
        "3": "manual",
      },
      [{ text: "@Joao Lanza" }, { text: "@Tarcisio Pereira" }, { text: "Seladora Contínua" }],
      {
        customerName: "joao lanza",
        operatorName: "TARCISIO PEREIRA",
      },
    );

    expect(resolved).toEqual(["Joao", "Tarcisio", "Seladora Contínua"]);
  });

  it("MetaTemplateSelectModal, CrmChatWidget e MetaTemplatesManager não exibem prefixo @ nas variáveis", () => {
    const selectModalSource = readFileSync(
      resolve(process.cwd(), "src/components/chat/MetaTemplateSelectModal.tsx"),
      "utf-8",
    );
    const widgetSource = readFileSync(
      resolve(process.cwd(), "src/components/crm/CrmChatWidget.tsx"),
      "utf-8",
    );
    const managerSource = readFileSync(
      resolve(process.cwd(), "src/components/chat/MetaTemplatesManager.tsx"),
      "utf-8",
    );

    expect(selectModalSource).not.toContain("`@${customerName}`");
    expect(selectModalSource).not.toContain("`@${operatorName}`");
    expect(selectModalSource).toContain("formatTemplateFirstName(customerName");
    expect(selectModalSource).toContain("formatTemplateFirstName(operatorName");
    expect(selectModalSource).toContain('data-template-inline-panel="true"');

    expect(widgetSource).not.toContain("`@${customerName}`");
    expect(widgetSource).not.toContain("`@${operatorName}`");
    expect(widgetSource).toContain("formatTemplateFirstName(customerName");
    expect(widgetSource).toContain("formatTemplateFirstName(operatorName");

    expect(managerSource).not.toContain("@nome do cliente");
    expect(managerSource).not.toContain("@nome do operador");
  });

  it("ChatPanel expande MetaTemplateSelectModal e ValentinaAssistantModal inline e exibe card de bloqueio fora da janela de 24h", () => {
    const chatPanelSource = readFileSync(
      resolve(process.cwd(), "src/components/chat/ChatPanel.tsx"),
      "utf-8",
    );
    const assistantSource = readFileSync(
      resolve(process.cwd(), "src/components/chat/ValentinaAssistantModal.tsx"),
      "utf-8",
    );

    const templateMatches = chatPanelSource.match(/<MetaTemplateSelectModal/g) || [];
    expect(templateMatches.length).toBe(2); // 1 no card de bloqueio 24h + 1 no composer normal

    const assistantMatches = chatPanelSource.match(/<ValentinaAssistantModal/g) || [];
    expect(assistantMatches.length).toBe(1);
    expect(chatPanelSource).toContain("Janela de 24 horas encerrada");
    expect(chatPanelSource).toContain("Enviar Template");
    expect(assistantSource).toContain('data-assistant-inline-panel="true"');
  });
});
