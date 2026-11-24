import { describe, expect, test } from "bun:test";
import {
  buildAppRoutePath,
  buildChatQueuePath,
  CHAT_QUEUE_SLUGS,
  isOpenInNewTabModifier,
  MODULE_ROUTE_SPECS,
  parseAppRoute,
  parseChatQueueFromSearch,
} from "../src/lib/app-routes";
import { tryAcquireCrossTabSoundSlot } from "../src/lib/sound-notifications";
import type { ViewId } from "../src/lib/rbac";

describe("New-tab navigation helpers (Ctrl+Click & Middle-Click)", () => {
  test("isOpenInNewTabModifier detects normal left click vs new-tab intents", () => {
    const base = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    expect(isOpenInNewTabModifier(base)).toBe(false);
    expect(isOpenInNewTabModifier({ ...base, ctrlKey: true })).toBe(true);
    expect(isOpenInNewTabModifier({ ...base, metaKey: true })).toBe(true);
    expect(isOpenInNewTabModifier({ ...base, shiftKey: true })).toBe(true);
    expect(isOpenInNewTabModifier({ ...base, altKey: true })).toBe(true);
    expect(isOpenInNewTabModifier({ ...base, button: 1 })).toBe(true);
    expect(isOpenInNewTabModifier({ ...base, button: 2 })).toBe(true);
  });

  test("chat queue query string round-trips safely for all valid queues", () => {
    for (const queue of CHAT_QUEUE_SLUGS) {
      const path = buildChatQueuePath(queue);
      expect(path).toBe(`/chat?queue=${queue}`);
      const search = path.slice(path.indexOf("?"));
      expect(parseChatQueueFromSearch(search)).toBe(queue);
      expect(parseAppRoute(path).viewId).toBe("chat");
    }

    expect(parseChatQueueFromSearch("?queue=invalid")).toBeNull();
    expect(parseChatQueueFromSearch("")).toBeNull();
    expect(parseChatQueueFromSearch(null)).toBeNull();
    expect(buildChatQueuePath("unknown")).toBe("/chat");
  });

  test("every module and tab in MODULE_ROUTE_SPECS round-trips cleanly via URL", () => {
    const viewIds = Object.keys(MODULE_ROUTE_SPECS) as ViewId[];
    expect(viewIds.length).toBeGreaterThanOrEqual(14);

    for (const viewId of viewIds) {
      const spec = MODULE_ROUTE_SPECS[viewId];
      const basePath = buildAppRoutePath(viewId);
      const parsedBase = parseAppRoute(basePath);
      expect(parsedBase.isAppShell).toBe(true);
      expect(parsedBase.viewId).toBe(viewId);

      if (spec.tabToSlug) {
        for (const tabId of Object.keys(spec.tabToSlug)) {
          const tabPath = buildAppRoutePath(viewId, { tabId });
          const parsedTab = parseAppRoute(tabPath);
          expect(parsedTab.isAppShell).toBe(true);
          expect(parsedTab.viewId).toBe(viewId);
          expect(parsedTab.tabId).toBe(tabId);
        }
      }
    }

    // Garante explicitamente que a aba Webhook em Ajustes resolve corretamente em nova guia
    const webhookPath = buildAppRoutePath("settings", { tabId: "webhook" });
    expect(webhookPath).toBe("/ajustes/webhook");
    expect(parseAppRoute(webhookPath)).toEqual({
      isAppShell: true,
      isRoot: false,
      viewId: "settings",
      tabId: "webhook",
      extraParam: undefined,
    });
  });

  test("tryAcquireCrossTabSoundSlot deduplicates chimes across concurrent browser tabs", () => {
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };

    expect(tryAcquireCrossTabSoundSlot(10_000, fakeStorage)).toBe(true);
    // Outra guia 50ms depois não pode duplicar o som
    expect(tryAcquireCrossTabSoundSlot(10_050, fakeStorage)).toBe(false);
    // Outra guia 1199ms depois ainda está na janela de supressão
    expect(tryAcquireCrossTabSoundSlot(11_199, fakeStorage)).toBe(false);
    // Após 1200ms a nova notificação pode tocar normalmente
    expect(tryAcquireCrossTabSoundSlot(11_201, fakeStorage)).toBe(true);
  });
});
