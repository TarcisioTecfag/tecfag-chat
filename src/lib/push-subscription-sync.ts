export const PUSH_SYNC_STORAGE_KEY = "push_subscription_synced_v1";

export interface PushSubscriptionLike {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | ArrayBufferView | null } | null;
  toJSON: () => unknown;
  unsubscribe: () => Promise<boolean>;
}

export interface PushRegistrationLike {
  pushManager: {
    getSubscription: () => Promise<PushSubscriptionLike | null>;
    subscribe: (options: {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array<ArrayBuffer>;
    }) => Promise<PushSubscriptionLike>;
  };
}

export interface SyncPushParams {
  registration: PushRegistrationLike;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  tenantId?: string | null;
  operatorId?: string | null;
  userAgent?: string;
  forceSync?: boolean;
}

export type SyncPushResult =
  | { ok: true; status: "already_synced" | "synced" | "resubscribed"; endpoint: string }
  | { ok: false; status: "save_failed"; httpStatus: number; endpoint: string };

function decodeBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const buf = Buffer.from(base64, "base64");
  const outputArray = new Uint8Array(new ArrayBuffer(buf.length));
  outputArray.set(buf);
  return outputArray;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const trimmed = base64String.trim();
  const padding = "=".repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = (trimmed + padding).replace(/-/g, "+").replace(/_/g, "/");
  return decodeBase64ToBytes(base64);
}

export function areApplicationServerKeysEqual(
  existingKey: ArrayBuffer | ArrayBufferView | null | undefined,
  expectedKey: Uint8Array
): boolean {
  if (!existingKey) return false;
  const existingBytes =
    existingKey instanceof ArrayBuffer
      ? new Uint8Array(existingKey)
      : new Uint8Array(existingKey.buffer, existingKey.byteOffset, existingKey.byteLength);

  if (existingBytes.length !== expectedKey.length) return false;
  for (let i = 0; i < expectedKey.length; i++) {
    if (existingBytes[i] !== expectedKey[i]) return false;
  }
  return true;
}

export function buildPushSyncFingerprint(
  tenantId: string | null | undefined,
  operatorId: string | null | undefined,
  publicKey: string,
  endpoint: string
): string {
  return `${tenantId || ""}|${operatorId || ""}|${publicKey}|${endpoint}`;
}

export async function syncBrowserPushSubscription(params: SyncPushParams): Promise<SyncPushResult> {
  const fetchFn = params.fetchImpl ?? fetch;
  const keyRes = await fetchFn("/api/push", { credentials: "include" });
  if (!keyRes.ok) {
    throw new Error("Não foi possível obter a chave VAPID do servidor.");
  }

  const keyData = (await keyRes.json()) as { publicKey?: unknown };
  const publicKey = typeof keyData?.publicKey === "string" ? keyData.publicKey.trim() : "";
  if (!publicKey) {
    throw new Error("Chave VAPID não configurada no servidor.");
  }

  const expectedKey = urlBase64ToUint8Array(publicKey);
  let subscription = await params.registration.pushManager.getSubscription();
  let resubscribed = false;

  if (
    subscription &&
    !areApplicationServerKeysEqual(subscription.options?.applicationServerKey, expectedKey)
  ) {
    await subscription.unsubscribe();
    subscription = await params.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: expectedKey,
    });
    resubscribed = true;
  } else if (!subscription) {
    subscription = await params.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: expectedKey,
    });
    resubscribed = true;
  }

  const fingerprint = buildPushSyncFingerprint(
    params.tenantId,
    params.operatorId,
    publicKey,
    subscription.endpoint
  );

  if (!params.forceSync && !resubscribed && params.storage) {
    try {
      if (params.storage.getItem(PUSH_SYNC_STORAGE_KEY) === fingerprint) {
        return { ok: true, status: "already_synced", endpoint: subscription.endpoint };
      }
    } catch {
      // ignore storage read error
    }
  }

  const postSubscription = (sub: PushSubscriptionLike) =>
    fetchFn("/api/push", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        userAgent: params.userAgent,
      }),
    });

  let saveRes = await postSubscription(subscription);
  if (saveRes.status === 409) {
    await subscription.unsubscribe();
    subscription = await params.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: expectedKey,
    });
    resubscribed = true;
    saveRes = await postSubscription(subscription);
  }

  if (saveRes.ok) {
    if (params.storage) {
      try {
        const finalFingerprint = buildPushSyncFingerprint(
          params.tenantId,
          params.operatorId,
          publicKey,
          subscription.endpoint
        );
        params.storage.setItem(PUSH_SYNC_STORAGE_KEY, finalFingerprint);
      } catch {
        // ignore storage write error
      }
    }
    return {
      ok: true,
      status: resubscribed ? "resubscribed" : "synced",
      endpoint: subscription.endpoint,
    };
  }

  return {
    ok: false,
    status: "save_failed",
    httpStatus: saveRes.status,
    endpoint: subscription.endpoint,
  };
}
