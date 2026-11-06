const RECOVERY_KEY = "tecfag-chat:asset-recovery-at";
const RECOVERY_COOLDOWN_MS = 15_000;

let recoveryInProgress = false;

/** A lazy module can disappear when Railway replaces a deployment. */
export function isMissingAssetError(error: unknown): boolean {
  if (error instanceof Error && error.name === "ChunkLoadError") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const causeMessage =
    error instanceof Error && error.cause
      ? error.cause instanceof Error
        ? error.cause.message
        : String(error.cause)
      : "";
  const combined = `${message} ${causeMessage}`;
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to load module script|chunkloaderror|loading chunk .+ failed|minified react error #520/i.test(
    combined,
  );
}

export function isAssetRecoveryInProgress(): boolean {
  return recoveryInProgress;
}

export function reloadForMissingAsset(force = false): boolean {
  if (typeof window === "undefined") return false;
  if (recoveryInProgress && !force) return true;

  try {
    const now = Date.now();
    if (!force) {
      const lastAttempt = Number(window.sessionStorage.getItem(RECOVERY_KEY) || 0);
      if (Number.isFinite(lastAttempt) && now - lastAttempt < RECOVERY_COOLDOWN_MS) return false;
    }
    window.sessionStorage.setItem(RECOVERY_KEY, String(now));
  } catch {
    if (!force) {
      // If storage is unavailable, leave recovery to the explicit reload button.
      return false;
    }
  }

  recoveryInProgress = true;

  const triggerReload = () => {
    try {
      window.location.reload();
    } catch {
      window.location.assign(window.location.href);
    }
  };

  // Força a invalidação do documento HTML no cache HTTP do navegador antes de recarregar
  try {
    void fetch(window.location.href, {
      cache: "reload",
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    }).finally(triggerReload);
  } catch {
    triggerReload();
  }

  return true;
}

export function installAssetRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    const preloadEvent = event as Event & { payload?: unknown };
    if (!isMissingAssetError(preloadEvent.payload)) return;
    // IMPORTANTE: NÃO chamar preloadEvent.preventDefault()!
    // No Vite 8, preventDefault() engole o throw dentro de __vitePreload e faz o import()
    // resolver como `undefined`, causando "Minified React error #520" antes do reload completar.
    // Sem preventDefault(), o erro segue para o catch do lazyWithRetry, que mantém o <Suspense>
    // vivo (Promise pendente) enquanto o reload em andamento traz o HTML novo.
    reloadForMissingAsset();
  });
}
