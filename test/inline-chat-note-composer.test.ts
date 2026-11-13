import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("InlineChatNoteComposer & Botão Anotação (Pré-Captura e Janela Meta 24h Encerrada)", () => {
  const root = process.cwd();
  const chatPanelSrc = readFileSync(resolve(root, "src/components/chat/ChatPanel.tsx"), "utf-8");
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

  it("usa a mesma função da Nota Interna (isInternalNote = true, note.form_opened e eventos CRM) obedecendo 100% ao Design System", () => {
    expect(noteComposerSrc).toContain("sendMessage(trimmed, true");
    expect(noteComposerSrc).toContain('eventType: "note.form_opened"');
    expect(noteComposerSrc).toContain('new Event("crm-deals-changed")');
    expect(noteComposerSrc).toContain('new Event("chat:reconnected")');

    // Proibição estrita de controles HTML nativos (AGENTS.md)
    expect(noteComposerSrc).not.toMatch(/\btitle\s*=/);
    expect(noteComposerSrc).not.toMatch(/<select[\s>]/i);
    expect(noteComposerSrc).not.toMatch(/type=["'](?:date|time|datetime-local)["']/i);
    expect(noteComposerSrc).toContain("SystemTooltip");
  });

  it("libera isInternalNote antes da captura no useChatState e na API /api/chats preservando todas as travas para mensagens externas", () => {
    expect(useChatStateSrc).toContain(
      '!isInternalNote &&\n      (!currentChat || currentChat.queue !== "meus" || currentChat.operatorId !== currentOperatorId)',
    );
    expect(chatsApiSrc).toContain("isInternalNote\n            ? await requireConversationAccess(session, conversationId)");
    expect(chatsApiSrc).toContain("...(isCurrentOwner ? { unreadCount: 0 } : {})");
  });
});
