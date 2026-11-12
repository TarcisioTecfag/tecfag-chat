import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_TASK_TYPES, getRelativeDateYMD } from "../src/components/chat/InlineChatTaskComposer";

describe("InlineChatTaskComposer & Aba Tarefas no Composer do Chat", () => {
  const root = process.cwd();
  const chatPanelSrc = readFileSync(resolve(root, "src/components/chat/ChatPanel.tsx"), "utf-8");
  const mobileInputSrc = readFileSync(
    resolve(root, "src/components/mobile/MobileMessageInput.tsx"),
    "utf-8",
  );
  const inlineComposerSrc = readFileSync(
    resolve(root, "src/components/chat/InlineChatTaskComposer.tsx"),
    "utf-8",
  );
  const sharedFilesSrc = readFileSync(
    resolve(root, "src/components/chat/SharedFiles.tsx"),
    "utf-8",
  );

  it("posiciona a aba Tarefas imediatamente após Nota Interna e antes de Catálogo/Templates Meta no ChatPanel", () => {
    const idxEnviar = chatPanelSrc.indexOf("Enviar Mensagem");
    const idxNota = chatPanelSrc.indexOf("<span>Nota Interna</span>", idxEnviar);
    const idxTarefas = chatPanelSrc.indexOf('data-chat-task-tab="true"', idxNota);
    const idxCatalogo = chatPanelSrc.indexOf('"Catálogo" : "Válvulas"', idxTarefas);
    const idxTemplates = chatPanelSrc.indexOf("<span>Templates Meta</span>", idxCatalogo);

    expect(idxEnviar).toBeGreaterThan(-1);
    expect(idxNota).toBeGreaterThan(idxEnviar);
    expect(idxTarefas).toBeGreaterThan(idxNota);
    expect(idxCatalogo).toBeGreaterThan(idxTarefas);
    expect(idxTemplates).toBeGreaterThan(idxCatalogo);

    expect(chatPanelSrc).toContain('msgMode === "task" && canManageTags && activeChat.id !== "valentina"');
    expect(chatPanelSrc).toContain("<InlineChatTaskComposer");
  });

  it("posiciona a aba Tarefas imediatamente após Nota Interna e antes de Catálogo no MobileMessageInput", () => {
    const idxNota = mobileInputSrc.indexOf("<span>Nota Interna</span>");
    const idxTarefas = mobileInputSrc.indexOf("<span>Tarefas</span>", idxNota);
    const idxCatalogo = mobileInputSrc.indexOf('"Catálogo" : "Válvulas"', idxTarefas);

    expect(idxNota).toBeGreaterThan(-1);
    expect(idxTarefas).toBeGreaterThan(idxNota);
    expect(idxCatalogo).toBeGreaterThan(idxTarefas);
    expect(mobileInputSrc).toContain("<InlineChatTaskComposer");
  });

  it("usa o mesmo endpoint /api/chats/tag-task vinculado ao CRM com os 7 tipos de atividade e sem controles HTML nativos", () => {
    expect(CHAT_TASK_TYPES.map((t) => t.value)).toEqual([
      "task",
      "call",
      "whatsapp",
      "meeting",
      "email",
      "lunch",
      "visit",
    ]);

    expect(getRelativeDateYMD(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(getRelativeDateYMD(1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Endpoint e sincronização CRM idênticos ao painel lateral direito
    expect(inlineComposerSrc).toContain("/api/chats/tag-task");
    expect(inlineComposerSrc).toContain("expectedContextVersion");
    expect(inlineComposerSrc).toContain('new Event("crm-deals-changed")');
    expect(inlineComposerSrc).toContain('new Event("chat:reconnected")');

    // Design System estrito: proibido title=, <select>, <input type="date|time|datetime-local">
    expect(inlineComposerSrc).not.toMatch(/\btitle\s*=/);
    expect(inlineComposerSrc).not.toMatch(/<select[\s>]/i);
    expect(inlineComposerSrc).not.toMatch(/type=["'](?:date|time|datetime-local)["']/i);
    expect(inlineComposerSrc).toContain("SystemTooltip");
    expect(inlineComposerSrc).toContain("Popover");
  });

  it("preserva integralmente a criação de tarefas na barra lateral direita (SharedFiles)", () => {
    expect(sharedFilesSrc).toContain('data-tour="details.task-create"');
    expect(sharedFilesSrc).toContain('data-tour="details.task-tags"');
    expect(sharedFilesSrc).toContain("/api/chats/tag-task");
  });
});
