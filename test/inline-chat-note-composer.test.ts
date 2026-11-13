import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  appendUniqueNoteFiles,
  enqueueInlineNoteFiles,
  extractFilesFromClipboard,
  hasDraggedFiles,
  normalizePastedFile,
} from "../src/components/chat/InlineChatNoteComposer";

describe("InlineChatNoteComposer & Botão Anotação (Pré-Captura, Janela Meta 24h & Upload Colar/Arrastar)", () => {
  const root = process.cwd();
  const chatPanelSrc = readFileSync(resolve(root, "src/components/chat/ChatPanel.tsx"), "utf-8");
  const bubbleSrc = readFileSync(
    resolve(root, "src/components/chat/ChatMessageBubble.tsx"),
    "utf-8",
  );
  const noteComposerSrc = readFileSync(
    resolve(root, "src/components/chat/InlineChatNoteComposer.tsx"),
    "utf-8",
  );
  const dealReqSrc = readFileSync(
    resolve(root, "src/components/crm/ConversationDealRequirement.tsx"),
    "utf-8",
  );
  const crmWidgetSrc = readFileSync(
    resolve(root, "src/components/crm/CrmChatWidget.tsx"),
    "utf-8",
  );
  const useChatStateSrc = readFileSync(resolve(root, "src/hooks/useChatState.tsx"), "utf-8");
  const chatsApiSrc = readFileSync(resolve(root, "src/routes/api/chats.ts"), "utf-8");

  it("disponibiliza o botão Anotação em todos os cenários de cliente não captado e de janela Meta 24h encerrada no ChatPanel", () => {
    expect(chatPanelSrc).toContain("<InlineChatNoteComposer");
    expect(chatPanelSrc).toContain('data-chat-annotation-trigger="fila"');
    expect(chatPanelSrc).toContain('data-chat-annotation-trigger="automacao"');
    expect(chatPanelSrc).toContain('data-chat-annotation-trigger="other-operator"');
    expect(chatPanelSrc).toContain('data-chat-annotation-trigger="meta-24h-closed"');
    expect(chatPanelSrc).toContain('data-chat-annotation-trigger="finalizados"');
    expect(chatPanelSrc).toContain('data-chat-annotation-trigger="readonly-connection"');

    // No card de Janela de 24 horas encerrada, Anotação fica ao lado de Enviar Template e Tarefas
    const idxClosedBanner = chatPanelSrc.indexOf("Janela de 24 horas encerrada");
    const idxEnviarTemplate = chatPanelSrc.indexOf("Enviar Template", idxClosedBanner);
    const idxAnotacaoClosed = chatPanelSrc.indexOf(
      'data-chat-annotation-trigger="meta-24h-closed"',
      idxEnviarTemplate,
    );
    const idxTarefasClosed = chatPanelSrc.indexOf("Fechar Tarefas", idxAnotacaoClosed);

    expect(idxClosedBanner).toBeGreaterThan(-1);
    expect(idxEnviarTemplate).toBeGreaterThan(idxClosedBanner);
    expect(idxAnotacaoClosed).toBeGreaterThan(idxEnviarTemplate);
    expect(idxTarefasClosed).toBeGreaterThan(idxAnotacaoClosed);
  });

  it("disponibiliza o botão Anotação também no pré-vínculo de negociação (ConversationDealRequirement) e no Mini-Chat CRM (CrmChatWidget)", () => {
    expect(dealReqSrc).toContain("<InlineChatNoteComposer");
    expect(dealReqSrc).toContain('data-chat-annotation-trigger="deal-requirement"');

    expect(crmWidgetSrc).toContain("<InlineChatNoteComposer");
    expect(crmWidgetSrc).toContain('data-chat-annotation-trigger="mini-meta-24h-closed"');
    expect(crmWidgetSrc).toContain('data-chat-annotation-trigger="mini-composer"');
  });

  it("suporta colar arquivos (Ctrl+V), arrastar e soltar (Drag & Drop) e botão de anexar obedecendo 100% ao Design System", () => {
    expect(noteComposerSrc).toContain("sendMessage(trimmed, true, currentAttachments");
    expect(noteComposerSrc).toContain("onPaste={handlePasteOnInput}");
    expect(noteComposerSrc).toContain("onDrop={handleDrop}");
    expect(noteComposerSrc).toContain('data-attach-inline-note="true"');
    expect(noteComposerSrc).toContain('data-inline-note-attachments="true"');
    expect(noteComposerSrc).toContain('eventType: "note.form_opened"');
    expect(noteComposerSrc).toContain('new Event("crm-deals-changed")');
    expect(noteComposerSrc).toContain('new Event("chat:reconnected")');

    // Roteamento de Ctrl+V e Drag & Drop no ChatPanel quando o composer normal está bloqueado
    expect(chatPanelSrc).toContain("enqueueInlineNoteFiles(activeChat.id, files)");
    expect(chatPanelSrc).toContain("Solte os arquivos para anexar na Anotação Interna");

    // Proibição estrita de controles HTML nativos proibidos (AGENTS.md)
    expect(noteComposerSrc).not.toMatch(/\btitle\s*=/);
    expect(noteComposerSrc).not.toMatch(/<select[\s>]/i);
    expect(noteComposerSrc).not.toMatch(/type=["'](?:date|time|datetime-local)["']/i);
    expect(noteComposerSrc).toContain("SystemTooltip");
  });

  it("extrai múltiplos prints/arquivos do clipboard sem colisão de nome e detecta Drag & Drop de arquivos", () => {
    const genericShotA = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const genericShotB = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const realPdf = new File([new Uint8Array([37, 80, 68, 70])], "Proposta_Comercial.pdf", {
      type: "application/pdf",
      lastModified: 1700000000000,
    });

    const normalizedA = normalizePastedFile(genericShotA, 0);
    const normalizedB = normalizePastedFile(genericShotB, 1);
    expect(normalizedA.name).toMatch(/^captura-\d{6}-1-[a-z0-9]+\.png$/);
    expect(normalizedB.name).toMatch(/^captura-\d{6}-2-[a-z0-9]+\.png$/);
    expect(normalizedA.name).not.toBe(normalizedB.name);

    // Dois prints colados em sequência nunca colidem na deduplicação
    const combined = appendUniqueNoteFiles([normalizedA], [normalizedB, realPdf, realPdf]);
    expect(combined).toHaveLength(3);
    expect(combined[2].name).toBe("Proposta_Comercial.pdf");

    // Extração via clipboardData.items e fallback clipboardData.files
    const mockClipboardFromItems = {
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => genericShotA },
        { kind: "file", getAsFile: () => realPdf },
      ],
      files: [],
    } as unknown as DataTransfer;

    const extracted = extractFilesFromClipboard(mockClipboardFromItems);
    expect(extracted).toHaveLength(2);
    expect(extracted[0].name).toMatch(/^captura-/);
    expect(extracted[1].name).toBe("Proposta_Comercial.pdf");

    const mockClipboardFromFilesOnly = {
      items: [],
      files: [realPdf],
    } as unknown as DataTransfer;
    expect(extractFilesFromClipboard(mockClipboardFromFilesOnly)).toHaveLength(1);

    // Detecção de arrastar arquivos vs arrastar texto comum
    expect(hasDraggedFiles({ types: ["Files"] } as unknown as DataTransfer)).toBe(true);
    expect(hasDraggedFiles({ types: ["text/plain"] } as unknown as DataTransfer)).toBe(false);

    // Enfileiramento por conversa preserva isolamento
    const convKey = `test-conv-inline-note-${Date.now()}`;
    const queued = enqueueInlineNoteFiles(convKey, [realPdf]);
    expect(queued).toHaveLength(1);
    expect(queued[0].name).toBe("Proposta_Comercial.pdf");
  });

  it("persiste anexos de Nota Interna em multipart/form-data no backend /api/chats e renderiza mídia nos balões de Nota Interna", () => {
    expect(useChatStateSrc).toContain('formData.append("file", file, safeName)');
    expect(useChatStateSrc).toContain("isInternalNote,");
    expect(chatsApiSrc).toContain('contentType.includes("multipart/form-data")');
    expect(chatsApiSrc).toContain("tx.insert(mediaFiles)");

    // Renderização de imagem/documento dentro do balão âmbar de Nota Interna no Chat e Mini-Chat
    expect(bubbleSrc).toContain("if (m.isInternalNote)");
    expect(bubbleSrc).toContain("isMedia ? (");
    expect(crmWidgetSrc).toContain("<MiniMediaRenderer");
  });
});
