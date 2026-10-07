import assert from "node:assert/strict";
import { test } from "node:test";
import {
  installAssetRecovery,
  isMissingAssetError,
  reloadForMissingAsset,
} from "../src/lib/asset-recovery";

test("reconhece erro de módulo removido sem confundir falha de API", () => {
  assert.equal(
    isMissingAssetError(
      new TypeError(
        "Failed to fetch dynamically imported module: https://example.com/assets/CommercialBiView-old.js",
      ),
    ),
    true,
  );
  assert.equal(isMissingAssetError(new Error("Request failed with status 500")), false);
});

test("recarrega somente uma vez durante uma sequência de falhas de chunks", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  let reloads = 0;
  let listener: ((event: Event & { payload?: unknown }) => void) | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      location: {
        reload: () => {
          reloads += 1;
        },
      },
      addEventListener: (_name: string, callback: typeof listener) => {
        listener = callback;
      },
    },
  });
  try {
    installAssetRecovery();
    let prevented = 0;
    const event = {
      payload: new TypeError(
        "Failed to fetch dynamically imported module: /assets/ProfileModal-old.js",
      ),
      preventDefault: () => {
        prevented += 1;
      },
    } as unknown as Event & { payload?: unknown };
    listener?.(event);
    listener?.(event);
    assert.equal(reloads, 1);
    assert.equal(prevented, 1);
    assert.equal(reloadForMissingAsset(), false);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
