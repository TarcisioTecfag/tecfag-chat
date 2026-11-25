import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isSiteConversationId } from "../src/lib/livechat/site-channel-policy";

const root = path.resolve(import.meta.dir, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("Isolamento de canal Site (conv-lc-*) vs WhatsApp", () => {
  test("isSiteConversationId distingue estritamente conversas do site de conversas WhatsApp", () => {
    expect(isSiteConversationId("conv-lc-41d3671e-0924-4510-a4a2-85d435177b34")).toBe(true);
    expect(isSiteConversationId("conv-1795526516985-ab12")).toBe(false);
    expect(isSiteConversationId("conv-tecfag-cont-rdc-556285844890")).toBe(false);
    expect(isSiteConversationId(null)).toBe(false);
    expect(isSiteConversationId(undefined)).toBe(false);
  });

  test("buscas de conversa WhatsApp nunca retornam nem vinculam conv-lc-*", () => {
    const contactPhones = read("src/lib/crm/contact-phones.ts");
    expect(contactPhones).toContain('notLike(conversations.id, "conv-lc-%")');
    // Tanto em syncContactPhones quanto em findConversationForContactPhone
    const matches = contactPhones.match(/notLike\(conversations\.id, "conv-lc-%"\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);

    const connections = read("src/lib/whatsapp/connections.ts");
    expect(connections).toContain('notLike(conversations.id, "conv-lc-%")');

    const contactConversationsRoute = read("src/routes/api/contacts/$contactId/conversations.ts");
    expect(contactConversationsRoute).toContain('notLike(conversations.id, "conv-lc-%")');

    const dealConversationsRoute = read("src/routes/api/crm/deals/$dealId/conversations.ts");
    expect(dealConversationsRoute).toContain('notLike(conversations.id, "conv-lc-%")');

    const inbound = read("src/lib/whatsapp/inbound.ts");
    expect(inbound).toContain('notLike(conversations.id, "conv-lc-%")');

    const rdDispatch = read("src/lib/rd-marketing/sdr-template-dispatch.ts");
    expect(rdDispatch).toContain('notLike(conversations.id, "conv-lc-%")');

    const mcpWrite = read("src/lib/mcp/valem-tecfag-mcp-write-tools.ts");
    expect(mcpWrite).toContain('notLike(conversations.id, "conv-lc-%")');

    const baileys = read("src/lib/baileys/session-manager.ts");
    expect(baileys).toContain('notLike(conversations.id, "conv-lc-%")');

    const resolveRoute = read("src/routes/api/chats/resolve.ts");
    expect(resolveRoute).toContain('notLike(conversations.id, "conv-lc-%")');
    expect(resolveRoute).toContain("NOT LIKE 'conv-lc-%'");

    const testSendRoute = read("src/routes/api/settings/whatsapp/test-send.ts");
    expect(testSendRoute).toContain('notLike(conversations.id, "conv-lc-%")');

    const contactHistoryRoute = read("src/routes/api/whatsapp/contact-history.ts");
    const contactHistoryMatches =
      contactHistoryRoute.match(/notLike\(conversations\.id, "conv-lc-%"\)/g) || [];
    expect(contactHistoryMatches.length).toBeGreaterThanOrEqual(3);
    expect(contactHistoryRoute).toContain('conversationId.startsWith("conv-lc-")');
    expect(contactHistoryRoute).toContain("readMirroredSourceKey");
  });

  test("APIs de chat, deal, meta-state, envio e MCP derivam o canal pela conversa (nunca misturando Site x WhatsApp)", () => {
    const chatsRoute = read("src/routes/api/chats.ts");
    expect(chatsRoute).toContain("isSiteConversationId(row.conversation.id)");
    expect(chatsRoute).toContain('row.contact.mainChannel === "livechat"');

    const dealConversationsRoute = read("src/routes/api/crm/deals/$dealId/conversations.ts");
    expect(dealConversationsRoute).toContain("isSiteConversationId(r.conversation.id)");

    const metaStateRoute = read("src/routes/api/whatsapp/meta-state.ts");
    expect(metaStateRoute).toContain("if (isSiteConversationId(conversationId))");
    expect(metaStateRoute).toContain('activeProvider: "livechat"');

    const sendRoute = read("src/routes/api/whatsapp/send.ts");
    expect(sendRoute).toContain("!conv.whatsappConnectionId && isSiteConversationId(conv.id)");
    expect(sendRoute).not.toContain("targetContact?.mainChannel === SITE_CHANNEL");

    const mcpCore = read("src/lib/mcp/valem-tecfag-mcp-core.ts");
    expect(mcpCore).toContain("!r.whatsapp_connection_id && !isSiteConversationId(r.conversation_id)");
  });

  test("UI (ChatPanel e CrmChatWidget) jamais exibe bloqueio Meta 24h ou templates em conversas do site e oferece atalho para WhatsApp", () => {
    const chatPanel = read("src/components/chat/ChatPanel.tsx");
    expect(chatPanel).toContain("isSiteConversationId(activeChat.id)");
    expect(chatPanel).toContain("!isAiChat && !isSiteChat && activeProvider === \"meta\"");
    expect(chatPanel).toContain("Abrir no WhatsApp");
    expect(chatPanel).toContain("<SiteLogo");

    const crmWidget = read("src/components/crm/CrmChatWidget.tsx");
    expect(crmWidget).toContain("isSiteConversationId(selected?.id)");
  });
});
