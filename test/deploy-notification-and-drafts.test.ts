import { beforeEach, describe, expect, it } from "bun:test";
import {
  acquireDeployReloadHold,
  getActiveDeployReloadHolds,
  getDeployReloadHoldLabel,
  hasActiveDeployReloadHold,
  releaseDeployReloadHold,
  resetDeployReloadHoldsForTests,
  subscribeDeployReloadHolds,
} from "../src/lib/deploy-activity-guard";
import { clearChatDraft, readChatDraft, writeChatDraft } from "../src/lib/chat-drafts";
import {
  DEPLOY_AUTO_RELOAD_SECONDS,
  formatDeployCountdown,
} from "../src/components/ui/DeployNotificationModal";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe("deploy-activity-guard", () => {
  beforeEach(() => {
    resetDeployReloadHoldsForTests();
  });

  it("adquire, lista e libera travas notificando inscritos", () => {
    let calls = 0;
    const unsubscribe = subscribeDeployReloadHolds(() => {
      calls += 1;
    });

    expect(hasActiveDeployReloadHold()).toBe(false);
    acquireDeployReloadHold("rec-1", "audio_recording");
    expect(hasActiveDeployReloadHold()).toBe(true);
    expect(getActiveDeployReloadHolds()).toEqual([{ id: "rec-1", reason: "audio_recording" }]);
    expect(calls).toBe(1);

    // Mesma chave e motivo não deve disparar notificação duplicada
    acquireDeployReloadHold("rec-1", "audio_recording");
    expect(calls).toBe(1);

    releaseDeployReloadHold("rec-1");
    expect(hasActiveDeployReloadHold()).toBe(false);
    expect(calls).toBe(2);

    unsubscribe();
    acquireDeployReloadHold("rec-2", "sending_message");
    expect(calls).toBe(2);
  });

  it("prioriza o rótulo correto quando múltiplas travas estão ativas", () => {
    expect(getDeployReloadHoldLabel([])).toBe("");
    expect(getDeployReloadHoldLabel([{ id: "1", reason: "sending_message" }])).toContain("envio");
    expect(
      getDeployReloadHoldLabel([
        { id: "1", reason: "sending_message" },
        { id: "2", reason: "audio_preview" },
      ]),
    ).toContain("áudio gravado");
    expect(
      getDeployReloadHoldLabel([
        { id: "1", reason: "audio_preview" },
        { id: "2", reason: "audio_recording" },
      ]),
    ).toContain("gravação de áudio");
    expect(
      getDeployReloadHoldLabel([
        { id: "1", reason: "audio_recording" },
        { id: "2", reason: "active_call" },
      ]),
    ).toContain("ligação");
  });
});

describe("chat-drafts (multi-tenant)", () => {
  it("isola rascunhos rigorosamente por tenantId e conversationId", () => {
    const storage = createMemoryStorage();

    writeChatDraft("tecfag", "conv-1", "Orçamento da seladora", { storage, now: 1_000 });
    writeChatDraft("valem", "conv-1", "Cotação de válvulas spray", { storage, now: 1_000 });

    expect(readChatDraft("tecfag", "conv-1", { storage, now: 2_000 })).toBe("Orçamento da seladora");
    expect(readChatDraft("valem", "conv-1", { storage, now: 2_000 })).toBe(
      "Cotação de válvulas spray",
    );

    clearChatDraft("tecfag", "conv-1", { storage });
    expect(readChatDraft("tecfag", "conv-1", { storage, now: 2_000 })).toBe("");
    expect(readChatDraft("valem", "conv-1", { storage, now: 2_000 })).toBe(
      "Cotação de válvulas spray",
    );
  });

  it("ignora tenantId vazio e remove rascunho quando texto fica em branco", () => {
    const storage = createMemoryStorage();

    writeChatDraft(null, "conv-1", "não deve salvar", { storage });
    expect(storage.length).toBe(0);

    writeChatDraft("tecfag", "conv-2", "texto temporário", { storage, now: 5_000 });
    expect(readChatDraft("tecfag", "conv-2", { storage, now: 5_000 })).toBe("texto temporário");

    writeChatDraft("tecfag", "conv-2", "   ", { storage, now: 6_000 });
    expect(readChatDraft("tecfag", "conv-2", { storage, now: 6_000 })).toBe("");
    expect(storage.getItem("chat_drafts:v1:tecfag")).toBeNull();
  });

  it("expira rascunhos antigos (> 14 dias) e mantém no máximo 120 por tenant", () => {
    const storage = createMemoryStorage();
    const baseNow = 1_700_000_000_000;

    writeChatDraft("tecfag", "conv-old", "antigo", { storage, now: baseNow });
    const after15Days = baseNow + 15 * 24 * 60 * 60 * 1000;
    expect(readChatDraft("tecfag", "conv-old", { storage, now: after15Days })).toBe("");

    for (let i = 0; i < 125; i += 1) {
      writeChatDraft("valem", `conv-${i}`, `msg-${i}`, { storage, now: baseNow + i * 1000 });
    }
    expect(readChatDraft("valem", "conv-0", { storage, now: baseNow + 200_000 })).toBe("");
    expect(readChatDraft("valem", "conv-124", { storage, now: baseNow + 200_000 })).toBe("msg-124");
  });

  it("tolera JSON corrompido ou erro de storage sem lançar exceção", () => {
    const storage = createMemoryStorage();
    storage.setItem("chat_drafts:v1:tecfag", "{json-invalido");
    expect(readChatDraft("tecfag", "conv-1", { storage })).toBe("");

    const brokenStorage = {
      ...createMemoryStorage(),
      setItem() {
        throw new Error("QuotaExceededError");
      },
      getItem() {
        throw new Error("SecurityError");
      },
    } as Storage;

    expect(() => writeChatDraft("tecfag", "conv-1", "teste", { storage: brokenStorage })).not.toThrow();
    expect(readChatDraft("tecfag", "conv-1", { storage: brokenStorage })).toBe("");
  });
});

describe("DeployNotificationModal helpers", () => {
  it("usa contagem padrão de 5 minutos e formata mm:ss corretamente", () => {
    expect(DEPLOY_AUTO_RELOAD_SECONDS).toBe(300);
    expect(formatDeployCountdown(300)).toBe("05:00");
    expect(formatDeployCountdown(299)).toBe("04:59");
    expect(formatDeployCountdown(9)).toBe("00:09");
    expect(formatDeployCountdown(0)).toBe("00:00");
    expect(formatDeployCountdown(-10)).toBe("00:00");
  });
});
