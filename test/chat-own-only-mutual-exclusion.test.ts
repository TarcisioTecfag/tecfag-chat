import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { canReadConversation, conversationReadRules } from "../src/lib/access-control/conversation-policy";

describe("Chat permissions: restrictToOwnChats vs canViewAllChats / canOverrideChat", () => {
  it("reproduces the Assistência Técnica block when restrictToOwnChats=true overrides canViewAllChats=true, and proves clearing restrictToOwnChats=false unlocks opening other operators' chats", () => {
    const buggyGroupPrincipal = {
      tenantId: "tecfag",
      operator: { id: "op-1791377346185", role: "agent", groupId: "group-1791375897099" },
      accessGroup: { allowedChannels: ["whatsapp"] },
      permissions: {
        views: { chat: true },
        chat: {
          canCaptureChat: true,
          canTransferChat: true,
          canFinishChat: true,
          canViewAllChats: true,
          canOverrideChat: true,
          restrictToOwnChats: true,
          canViewQueueMine: true,
          canViewQueueWaiting: true,
          canViewQueueBot: true,
          canViewQueueClosed: true,
        },
      },
    };

    const otherOperatorConv = {
      tenantId: "tecfag",
      operatorId: "op-1794601994898",
      queueState: "meus",
      mainChannel: "whatsapp",
      whatsappConnectionId: null,
    };

    expect(conversationReadRules(buggyGroupPrincipal).ownOnly).toBe(true);
    expect(canReadConversation(buggyGroupPrincipal, otherOperatorConv)).toBe(false);

    const fixedGroupPrincipal = {
      ...buggyGroupPrincipal,
      permissions: {
        ...buggyGroupPrincipal.permissions,
        chat: {
          ...buggyGroupPrincipal.permissions.chat,
          restrictToOwnChats: false,
        },
      },
    };

    expect(conversationReadRules(fixedGroupPrincipal).ownOnly).toBe(false);
    expect(conversationReadRules(fixedGroupPrincipal).others).toBe(true);
    expect(canReadConversation(fixedGroupPrincipal, otherOperatorConv)).toBe(true);
  });

  it("enforces mutual exclusion and conflict alert in GroupsView.tsx", () => {
    const groupsViewSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/chat/GroupsView.tsx"),
      "utf8",
    );
    expect(groupsViewSrc).toContain('if (key === "restrictToOwnChats" && value === true)');
    expect(groupsViewSrc).toContain("categoryPatch.canViewAllChats = false");
    expect(groupsViewSrc).toContain("categoryPatch.canOverrideChat = false");
    expect(groupsViewSrc).toContain('else if (key === "canViewAllChats" && value === true)');
    expect(groupsViewSrc).toContain('else if (key === "canOverrideChat" && value === true)');
    expect(groupsViewSrc).toContain("Conflito de permissões ativo neste grupo");
  });

  it("switches activeQueue to 'todos' when opening a chat owned by another operator via /chat/$chatKey or CrmView", () => {
    const chatKeySrc = fs.readFileSync(
      path.join(process.cwd(), "src/routes/chat/$chatKey.tsx"),
      "utf8",
    );
    const crmViewSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/crm/CrmView.tsx"),
      "utf8",
    );
    expect(chatKeySrc).toContain('activeChat.operatorId !== currentOperatorId');
    expect(chatKeySrc).toContain('setActiveQueue("todos")');
    expect(crmViewSrc).toContain('deal.operatorId !== currentOperatorId');
  });

  it("includes idempotent startup sanitization for tecfag Assistência Técnica group-1791375897099", () => {
    const migrationSrc = fs.readFileSync(
      path.join(process.cwd(), "scripts/apply-platform-access-migration.mjs"),
      "utf8",
    );
    expect(migrationSrc).toContain("fix_tecfag_assistencia_tecnica_chat_visibility_2026_11_16_v1");
    expect(migrationSrc).toContain("WHERE tenant_id = 'tecfag'");
    expect(migrationSrc).toContain("AND id = 'group-1791375897099'");
  });
});
