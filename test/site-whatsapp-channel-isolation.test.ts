import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isSiteConversationId } from "../src/lib/livechat/site-channel-policy";
import {
  canReadConversation,
  resolveEffectiveConversationChannel,
} from "../src/lib/access-control/conversation-policy";

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

    const mcpWrite = read("src/lib/mcp/valem-tecfag-mcp-write-tools.ts");
    expect(mcpWrite).toContain("!conv.whatsappConnectionId && isSiteConversationId(conv.id)");
    expect(mcpWrite).not.toContain("!conv.whatsappConnectionId && contact.mainChannel === SITE_CHANNEL");

    const reactRoute = read("src/routes/api/whatsapp/react.ts");
    expect(reactRoute).toContain("!isSiteConversationId(conv.id)");
    expect(reactRoute).toContain('contact.mainChannel === "livechat"');

    const convAccess = read("src/lib/access-control/conversation-access.ts");
    expect(convAccess).toContain("like(conversations.id, sitePattern)");
    expect(convAccess).toContain("notLike(conversations.id, sitePattern)");
  });

  test("controle de acesso resolve canal efetivo da conversa: WhatsApp de contato Site liberado p/ grupos WhatsApp, conv-lc-* isolado em livechat", () => {
    expect(
      resolveEffectiveConversationChannel({
        id: "conv-56fbd6b8-994e-448d-8ece-9460b6879805",
        whatsappConnectionId: null,
        mainChannel: "livechat",
      }),
    ).toBe("whatsapp");
    expect(
      resolveEffectiveConversationChannel({
        id: "conv-lc-79b4ba26-079f-4011-82f8-97baae1af741",
        whatsappConnectionId: null,
        mainChannel: "livechat",
      }),
    ).toBe("livechat");
    expect(
      resolveEffectiveConversationChannel({
        id: "conv-lc-7e240833-6fd4-424d-84ca-61553f7c19bf",
        whatsappConnectionId: null,
        mainChannel: "whatsapp",
      }),
    ).toBe("livechat");

    for (const tenantId of ["tecfag", "valem"] as const) {
      const sdrPrincipal = {
        tenantId,
        operator: { id: "op-sdr", role: "agent" },
        permissions: { views: { chat: true }, chat: { canViewAllChats: true, restrictToOwnChats: false } },
        accessGroup: { allowedChannels: ["whatsapp", "instagram", "messenger"] },
      };
      const posVendaPrincipal = {
        tenantId,
        operator: { id: "op-pv", role: "agent" },
        permissions: { views: { chat: true }, chat: { canViewAllChats: true, restrictToOwnChats: false } },
        accessGroup: { allowedChannels: ["whatsapp"] },
      };

      // Conversa WhatsApp Oficial de contato nascido no Site -> VISÍVEL para SDR e Pós-Venda
      const waOfSiteContact = {
        id: "conv-56fbd6b8-994e-448d-8ece-9460b6879805",
        tenantId,
        operatorId: "op-sdr",
        queueState: "meus",
        mainChannel: "livechat",
        whatsappConnectionId: null,
      };
      expect(canReadConversation(sdrPrincipal, waOfSiteContact)).toBe(true);
      expect(canReadConversation(posVendaPrincipal, { ...waOfSiteContact, operatorId: "op-pv" })).toBe(true);

      // Conversa do Site (conv-lc-*) -> BLOQUEADA para grupos sem "livechat", mesmo se mainChannel migrou para "whatsapp"
      expect(
        canReadConversation(sdrPrincipal, {
          ...waOfSiteContact,
          id: "conv-lc-79b4ba26-079f-4011-82f8-97baae1af741",
        }),
      ).toBe(false);
      expect(
        canReadConversation(posVendaPrincipal, {
          ...waOfSiteContact,
          id: "conv-lc-7e240833-6fd4-424d-84ca-61553f7c19bf",
          mainChannel: "whatsapp",
        }),
      ).toBe(false);

      // Isolamento cross-tenant preservado
      const otherTenant = tenantId === "tecfag" ? "valem" : "tecfag";
      expect(canReadConversation(sdrPrincipal, { ...waOfSiteContact, tenantId: otherTenant })).toBe(false);
    }
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
