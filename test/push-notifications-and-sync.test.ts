import { describe, expect, it } from "bun:test";
import webpush from "web-push";
import {
  extractPushEndpointHost,
  formatPushErrorSummary,
  isPermanentSubscriptionFailure,
} from "../src/lib/push-notifications";
import {
  areApplicationServerKeysEqual,
  buildPushSyncFingerprint,
  PUSH_SYNC_STORAGE_KEY,
  syncBrowserPushSubscription,
  urlBase64ToUint8Array,
  type PushRegistrationLike,
  type PushSubscriptionLike,
} from "../src/lib/push-subscription-sync";

function makeMemoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe("push-notifications helpers", () => {
  it("extracts host without leaking endpoint secret path", () => {
    expect(
      extractPushEndpointHost("https://fcm.googleapis.com/fcm/send/secret-token-123")
    ).toBe("fcm.googleapis.com");
    expect(
      extractPushEndpointHost("https://wns2-bn3p.notify.windows.com/w/?token=abc")
    ).toBe("wns2-bn3p.notify.windows.com");
    expect(extractPushEndpointHost("not-a-valid-url")).toBe("unknown");
  });

  it("classifies permanent subscription failures safely", () => {
    expect(isPermanentSubscriptionFailure({ statusCode: 404 }, false)).toBe(true);
    expect(isPermanentSubscriptionFailure({ statusCode: 410 }, false)).toBe(true);
    expect(isPermanentSubscriptionFailure({ statusCode: 404 }, true)).toBe(true);
    expect(isPermanentSubscriptionFailure({ statusCode: 410 }, true)).toBe(true);

    expect(isPermanentSubscriptionFailure({ statusCode: 401 }, false)).toBe(true);
    expect(isPermanentSubscriptionFailure({ statusCode: 403 }, false)).toBe(true);
    expect(isPermanentSubscriptionFailure({ statusCode: 401 }, true)).toBe(false);
    expect(isPermanentSubscriptionFailure({ statusCode: 403 }, true)).toBe(false);

    expect(
      isPermanentSubscriptionFailure(
        { statusCode: 400, body: "VapidPkHashMismatch" },
        false
      )
    ).toBe(true);
    expect(
      isPermanentSubscriptionFailure({ statusCode: 400, body: "Bad payload" }, false)
    ).toBe(false);

    expect(isPermanentSubscriptionFailure({ statusCode: 429 }, false)).toBe(false);
    expect(isPermanentSubscriptionFailure({ statusCode: 500 }, false)).toBe(false);
    expect(isPermanentSubscriptionFailure({ statusCode: 503 }, false)).toBe(false);
    expect(isPermanentSubscriptionFailure(new Error("timeout"), false)).toBe(false);
  });

  it("formats push error summary with status, host, message and truncated body", () => {
    const longBody = "X".repeat(350);
    const summary = formatPushErrorSummary(
      {
        statusCode: 403,
        message: "Received unexpected response code",
        body: `  ${longBody}\nline2  `,
      },
      "https://fcm.googleapis.com/fcm/send/secret-token"
    );

    expect(summary.statusCode).toBe(403);
    expect(summary.host).toBe("fcm.googleapis.com");
    expect(summary.message).toBe("Received unexpected response code");
    expect(summary.body.length).toBe(300);
    expect(summary.body).not.toContain("\n");
  });
});

describe("push-subscription-sync", () => {
  it("compares applicationServerKey ArrayBuffer and Uint8Array accurately", () => {
    const { publicKey } = webpush.generateVAPIDKeys();
    const { publicKey: otherPublicKey } = webpush.generateVAPIDKeys();
    const expected = urlBase64ToUint8Array(publicKey);
    const other = urlBase64ToUint8Array(otherPublicKey);

    expect(expected.length).toBe(65);
    expect(areApplicationServerKeysEqual(expected.buffer, expected)).toBe(true);
    expect(areApplicationServerKeysEqual(expected, expected)).toBe(true);
    expect(areApplicationServerKeysEqual(other.buffer, expected)).toBe(false);
    expect(areApplicationServerKeysEqual(null, expected)).toBe(false);
    expect(areApplicationServerKeysEqual(undefined, expected)).toBe(false);
  });

  it("subscribes from scratch when browser has no subscription and persists fingerprint", async () => {
    const { publicKey } = webpush.generateVAPIDKeys();
    const expectedKey = urlBase64ToUint8Array(publicKey);
    const storage = makeMemoryStorage();
    const events: string[] = [];

    const newSub: PushSubscriptionLike = {
      endpoint: "https://fcm.googleapis.com/fcm/send/new-1",
      options: { applicationServerKey: expectedKey.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/new-1",
        keys: { p256dh: "p256", auth: "auth" },
      }),
      unsubscribe: async () => true,
    };

    const registration: PushRegistrationLike = {
      pushManager: {
        getSubscription: async () => null,
        subscribe: async (opts) => {
          events.push("subscribe");
          expect(areApplicationServerKeysEqual(opts.applicationServerKey, expectedKey)).toBe(true);
          return newSub;
        },
      },
    };

    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/push" && (!init?.method || init.method === "GET")) {
        events.push("GET /api/push");
        return new Response(JSON.stringify({ publicKey }), { status: 200 });
      }
      if (url === "/api/push" && init?.method === "POST") {
        events.push("POST /api/push");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await syncBrowserPushSubscription({
      registration,
      fetchImpl,
      storage,
      tenantId: "tecfag",
      operatorId: "op-1",
      userAgent: "TestBrowser/1.0",
      forceSync: false,
    });

    expect(result).toEqual({
      ok: true,
      status: "resubscribed",
      endpoint: "https://fcm.googleapis.com/fcm/send/new-1",
    });
    expect(events).toEqual(["GET /api/push", "subscribe", "POST /api/push"]);
    expect(storage.getItem(PUSH_SYNC_STORAGE_KEY)).toBe(
      buildPushSyncFingerprint(
        "tecfag",
        "op-1",
        publicKey,
        "https://fcm.googleapis.com/fcm/send/new-1"
      )
    );
  });

  it("unsubscribes old subscription and re-subscribes when applicationServerKey mismatches", async () => {
    const { publicKey: oldKey } = webpush.generateVAPIDKeys();
    const { publicKey: newKey } = webpush.generateVAPIDKeys();
    const oldBytes = urlBase64ToUint8Array(oldKey);
    const newBytes = urlBase64ToUint8Array(newKey);
    const events: string[] = [];

    const existingSub: PushSubscriptionLike = {
      endpoint: "https://fcm.googleapis.com/fcm/send/old-sub",
      options: { applicationServerKey: oldBytes.buffer },
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/old-sub" }),
      unsubscribe: async () => {
        events.push("unsubscribe");
        return true;
      },
    };

    const renewedSub: PushSubscriptionLike = {
      endpoint: "https://fcm.googleapis.com/fcm/send/renewed-sub",
      options: { applicationServerKey: newBytes.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/renewed-sub",
        keys: { p256dh: "p256-new", auth: "auth-new" },
      }),
      unsubscribe: async () => true,
    };

    const registration: PushRegistrationLike = {
      pushManager: {
        getSubscription: async () => existingSub,
        subscribe: async (opts) => {
          events.push("subscribe");
          expect(areApplicationServerKeysEqual(opts.applicationServerKey, newBytes)).toBe(true);
          return renewedSub;
        },
      },
    };

    const fetchImpl: typeof fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        events.push("GET /api/push");
        return new Response(JSON.stringify({ publicKey: newKey }), { status: 200 });
      }
      events.push("POST /api/push");
      const parsed = JSON.parse(String(init.body));
      expect(parsed.subscription.endpoint).toBe("https://fcm.googleapis.com/fcm/send/renewed-sub");
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const result = await syncBrowserPushSubscription({
      registration,
      fetchImpl,
      storage: makeMemoryStorage(),
      tenantId: "valem",
      operatorId: "op-2",
      forceSync: false,
    });

    expect(result).toEqual({
      ok: true,
      status: "resubscribed",
      endpoint: "https://fcm.googleapis.com/fcm/send/renewed-sub",
    });
    expect(events).toEqual(["GET /api/push", "unsubscribe", "subscribe", "POST /api/push"]);
  });

  it("skips redundant POST when fingerprint matches and re-POSTs when operator changes", async () => {
    const { publicKey } = webpush.generateVAPIDKeys();
    const keyBytes = urlBase64ToUint8Array(publicKey);
    const endpoint = "https://fcm.googleapis.com/fcm/send/steady";
    const storage = makeMemoryStorage({
      [PUSH_SYNC_STORAGE_KEY]: buildPushSyncFingerprint("tecfag", "op-1", publicKey, endpoint),
    });

    let postCount = 0;
    const sub: PushSubscriptionLike = {
      endpoint,
      options: { applicationServerKey: keyBytes.buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: async () => true,
    };
    const registration: PushRegistrationLike = {
      pushManager: {
        getSubscription: async () => sub,
        subscribe: async () => sub,
      },
    };
    const fetchImpl: typeof fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return new Response(JSON.stringify({ publicKey }), { status: 200 });
      }
      postCount++;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const skipped = await syncBrowserPushSubscription({
      registration,
      fetchImpl,
      storage,
      tenantId: "tecfag",
      operatorId: "op-1",
      forceSync: false,
    });
    expect(skipped.ok).toBe(true);
    if (skipped.ok) expect(skipped.status).toBe("already_synced");
    expect(postCount).toBe(0);

    const switchedOperator = await syncBrowserPushSubscription({
      registration,
      fetchImpl,
      storage,
      tenantId: "tecfag",
      operatorId: "op-99",
      forceSync: false,
    });
    expect(switchedOperator.ok).toBe(true);
    if (switchedOperator.ok) expect(switchedOperator.status).toBe("synced");
    expect(postCount).toBe(1);
    expect(storage.getItem(PUSH_SYNC_STORAGE_KEY)).toBe(
      buildPushSyncFingerprint("tecfag", "op-99", publicKey, endpoint)
    );
  });

  it("re-subscribes and retries once when POST /api/push returns 409", async () => {
    const { publicKey } = webpush.generateVAPIDKeys();
    const keyBytes = urlBase64ToUint8Array(publicKey);
    const events: string[] = [];

    const firstSub: PushSubscriptionLike = {
      endpoint: "https://fcm.googleapis.com/fcm/send/conflict-endpoint",
      options: { applicationServerKey: keyBytes.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/conflict-endpoint",
        keys: { p256dh: "old", auth: "old" },
      }),
      unsubscribe: async () => {
        events.push("unsubscribe");
        return true;
      },
    };
    const freshSub: PushSubscriptionLike = {
      endpoint: "https://fcm.googleapis.com/fcm/send/fresh-endpoint",
      options: { applicationServerKey: keyBytes.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/fresh-endpoint",
        keys: { p256dh: "fresh", auth: "fresh" },
      }),
      unsubscribe: async () => true,
    };

    const registration: PushRegistrationLike = {
      pushManager: {
        getSubscription: async () => firstSub,
        subscribe: async () => {
          events.push("subscribe");
          return freshSub;
        },
      },
    };

    let postAttempt = 0;
    const fetchImpl: typeof fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        events.push("GET");
        return new Response(JSON.stringify({ publicKey }), { status: 200 });
      }
      postAttempt++;
      events.push(`POST#${postAttempt}`);
      if (postAttempt === 1) {
        return new Response(JSON.stringify({ error: "conflict" }), { status: 409 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const result = await syncBrowserPushSubscription({
      registration,
      fetchImpl,
      storage: makeMemoryStorage(),
      tenantId: "tecfag",
      operatorId: "op-1",
      forceSync: false,
    });

    expect(result).toEqual({
      ok: true,
      status: "resubscribed",
      endpoint: "https://fcm.googleapis.com/fcm/send/fresh-endpoint",
    });
    expect(events).toEqual(["GET", "POST#1", "unsubscribe", "subscribe", "POST#2"]);
  });
});
