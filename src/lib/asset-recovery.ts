const RECOVERY_KEY = "tecfag-chat:asset-recovery-at";
const RECOVERY_COOLDOWN_MS = 60_000;

/** A lazy module can disappear when Railway replaces a deployment. */
export function isMissingAssetError(error: unknown): boolean {
  if (error instanceof Error && error.name === "ChunkLoadError") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to load module script|chunkloaderror|loading chunk .+ failed/i.test(
    message,
  );
}

export function reloadForMissingAsset(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const now = Date.now();
    const lastAttempt = Number(window.sessionStorage.getItem(RECOVERY_KEY) || 0);
    if (Number.isFinite(lastAttempt) && now - lastAttempt < RECOVERY_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RECOVERY_KEY, String(now));
  } catch {
    // If storage is unavailable, leave recovery to the explicit reload button.
    return false;
  }

  window.location.reload();
  return true;
}

export function installAssetRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    const preloadEvent = event as Event & { payload?: unknown };
    if (!isMissingAssetError(preloadEvent.payload)) return;
    if (reloadForMissingAsset()) preloadEvent.preventDefault();
  });
}
