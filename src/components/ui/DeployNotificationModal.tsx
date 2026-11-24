import { useEffect, useState, useRef, useCallback } from "react";
import { ChevronDown, Mic, RotateCw, Sparkles, X } from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { AiAvatar } from "@/components/ui/AiAvatar";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  getActiveDeployReloadHolds,
  getDeployReloadHoldLabel,
  subscribeDeployReloadHolds,
  type ActiveDeployHold,
} from "@/lib/deploy-activity-guard";

export const DEPLOY_AUTO_RELOAD_SECONDS = 300; // 5 minutos
const URGENT_THRESHOLD_SECONDS = 30;
const POST_HOLD_GRACE_MS = 2000;
const NORMAL_RELOAD_DELAY_MS = 350;

export function formatDeployCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function triggerHardReload(): void {
  if (typeof window === "undefined") return;
  const doReload = () => {
    try {
      window.location.reload();
    } catch {
      window.location.assign(window.location.href);
    }
  };
  try {
    void fetch(window.location.href, {
      cache: "reload",
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    }).finally(doReload);
  } catch {
    doReload();
  }
}

/**
 * Aviso não-bloqueante de novo deploy (Railway).
 *
 * Em vez de travar a tela inteira no meio do atendimento, exibe um card compacto
 * flutuante no topo com contagem regressiva de 5 minutos (minimizável para pílula)
 * e segura o recarregamento automático enquanto houver gravação de áudio, ligação
 * ou envio de mensagem em andamento.
 */
export function DeployNotificationModal() {
  const { tenant } = useChat();
  const persona = getAiPersona(tenant || "valem");
  const [hasNewDeploy, setHasNewDeploy] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(DEPLOY_AUTO_RELOAD_SECONDS);
  const [isReloading, setIsReloading] = useState(false);
  const [activeHolds, setActiveHolds] = useState<ActiveDeployHold[]>(() =>
    getActiveDeployReloadHolds(),
  );

  const initialVersionRef = useRef<string | null>(null);
  const deadlineMsRef = useRef<number | null>(null);
  const isCheckingRef = useRef(false);
  const reloadTriggeredRef = useRef(false);
  const wasDeferredByHoldRef = useRef(false);

  // Estilos de tema dinâmicos conforme o tenant ativo (Valem = Verde, Tecfag = Vermelho)
  const isTecfag = tenant === "tecfag";
  const themeStyles = isTecfag
    ? ({
        "--primary": "#df3d3d",
        "--primary-soft": "#fde8e8",
      } as React.CSSProperties)
    : ({
        "--primary": "#2dc4a0",
        "--primary-soft": "#d8f1ea",
      } as React.CSSProperties);

  const handleReload = useCallback(() => {
    if (reloadTriggeredRef.current) return;
    reloadTriggeredRef.current = true;
    setIsReloading(true);
    triggerHardReload();
  }, []);

  const checkVersion = useCallback(async () => {
    if (isCheckingRef.current || reloadTriggeredRef.current) return;
    isCheckingRef.current = true;

    try {
      const res = await fetch("/api/version", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });

      if (res.ok) {
        const data = await res.json();
        const currentVersion = data.version;

        if (currentVersion) {
          if (!initialVersionRef.current) {
            initialVersionRef.current = currentVersion;
          } else if (initialVersionRef.current !== currentVersion) {
            if (deadlineMsRef.current === null) {
              console.log("[DeployNotification] Novo deploy detectado:", currentVersion);
              deadlineMsRef.current = Date.now() + DEPLOY_AUTO_RELOAD_SECONDS * 1000;
              setRemainingSeconds(DEPLOY_AUTO_RELOAD_SECONDS);
              setHasNewDeploy(true);
            }
          }
        }
      }
    } catch (error) {
      console.warn("[DeployNotification] Falha ao verificar versão:", error);
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void checkVersion();

    const interval = setInterval(() => {
      void checkVersion();
    }, 30_000);

    const handleFocus = () => {
      void checkVersion();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkVersion();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkVersion]);

  // Assina travas ativas de gravação/ligação/envio em tempo real
  useEffect(() => {
    setActiveHolds(getActiveDeployReloadHolds());
    return subscribeDeployReloadHolds(() => {
      setActiveHolds(getActiveDeployReloadHolds());
    });
  }, []);

  // Contagem regressiva baseada em relógio real (imune a throttling em aba de fundo)
  useEffect(() => {
    if (!hasNewDeploy || deadlineMsRef.current === null) return;

    const syncCountdown = () => {
      if (deadlineMsRef.current === null) return;
      const nextRemaining = Math.max(0, Math.ceil((deadlineMsRef.current - Date.now()) / 1000));
      setRemainingSeconds((prev) => (prev === nextRemaining ? prev : nextRemaining));
    };

    syncCountdown();
    const tick = setInterval(syncCountdown, 500);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") syncCountdown();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", syncCountdown);

    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", syncCountdown);
    };
  }, [hasNewDeploy]);

  // Dispara reload automático ao zerar o timer, segurando enquanto houver atividade crítica
  useEffect(() => {
    if (!hasNewDeploy || remainingSeconds > 0 || reloadTriggeredRef.current) return;

    if (activeHolds.length > 0) {
      wasDeferredByHoldRef.current = true;
      return;
    }

    const delayMs = wasDeferredByHoldRef.current ? POST_HOLD_GRACE_MS : NORMAL_RELOAD_DELAY_MS;
    const timer = setTimeout(() => {
      if (getActiveDeployReloadHolds().length > 0) {
        wasDeferredByHoldRef.current = true;
        return;
      }
      handleReload();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [hasNewDeploy, remainingSeconds, activeHolds, handleReload]);

  if (!hasNewDeploy) return null;

  const isWaitingForHold = remainingSeconds === 0 && activeHolds.length > 0 && !isReloading;
  const isUrgent = remainingSeconds <= URGENT_THRESHOLD_SECONDS && !isWaitingForHold;
  const holdLabel = getDeployReloadHoldLabel(activeHolds);
  const formattedCountdown = formatDeployCountdown(remainingSeconds);
  const progressPct = Math.max(
    0,
    Math.min(100, (remainingSeconds / DEPLOY_AUTO_RELOAD_SECONDS) * 100),
  );

  if (isMinimized) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-[calc(var(--safe-top,0px)+0.75rem)] left-1/2 -translate-x-1/2 z-[10060] pointer-events-none flex justify-center px-3"
        style={themeStyles}
      >
        <div
          className={`pointer-events-auto inline-flex items-center gap-2 rounded-full bg-card/95 backdrop-blur-xl border pl-2 pr-1.5 py-1.5 shadow-xl transition-all duration-200 animate-in fade-in slide-in-from-top-2 ${
            isWaitingForHold
              ? "border-amber-500/60 ring-2 ring-amber-500/20"
              : isUrgent
                ? "border-primary/70 ring-2 ring-primary/25"
                : "border-border/80"
          }`}
        >
          <div className="relative shrink-0">
            <AiAvatar
              tenantId={tenant}
              className="w-6 h-6 rounded-full border border-primary/40 shadow-xs"
            />
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" />
          </div>

          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground whitespace-nowrap">
            {isReloading ? (
              <span>Atualizando...</span>
            ) : isWaitingForHold ? (
              <>
                <Mic className="w-3.5 h-3.5 text-amber-500 animate-pulse shrink-0" />
                <span className="text-amber-600 dark:text-amber-400">
                  Aguardando concluir...
                </span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground hidden sm:inline">Atualização em</span>
                <span
                  className={`font-mono font-bold tabular-nums px-1.5 py-0.5 rounded-md ${
                    isUrgent
                      ? "bg-primary/15 text-primary animate-pulse"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {formattedCountdown}
                </span>
              </>
            )}
          </div>

          <SystemTooltip content="Recarregar agora para aplicar a atualização" side="bottom">
            <button
              type="button"
              onClick={handleReload}
              disabled={isReloading}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary hover:bg-primary/90 active:scale-95 text-primary-foreground text-[11px] font-bold transition cursor-pointer disabled:opacity-60"
            >
              <RotateCw className={`w-3 h-3 ${isReloading ? "animate-spin" : ""}`} />
              <span>Atualizar</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Expandir aviso de atualização" side="bottom">
            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              aria-label="Expandir aviso de atualização"
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </SystemTooltip>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[calc(var(--safe-top,0px)+0.75rem)] left-1/2 -translate-x-1/2 z-[10060] pointer-events-none w-[calc(100vw-1.5rem)] max-w-md"
      style={themeStyles}
    >
      <div
        className={`pointer-events-auto relative w-full bg-card/95 backdrop-blur-xl border rounded-2xl shadow-2xl overflow-hidden text-foreground animate-in fade-in slide-in-from-top-3 duration-200 ${
          isWaitingForHold
            ? "border-amber-500/60 ring-2 ring-amber-500/15"
            : isUrgent
              ? "border-primary/70 ring-2 ring-primary/20"
              : "border-border/80"
        }`}
      >
        <div className="p-3.5 sm:p-4 flex items-start gap-3">
          {/* Avatar da IA */}
          <div className="relative shrink-0 mt-0.5">
            <AiAvatar
              tenantId={tenant}
              className="w-11 h-11 rounded-full border-2 border-primary/40 shadow-md"
            />
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-card flex items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
            </span>
          </div>

          {/* Conteúdo */}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-soft text-primary border border-primary/20">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>{persona.name} IA</span>
                  </span>
                  <h2 className="text-xs sm:text-sm font-bold text-foreground tracking-tight">
                    Nova atualização disponível
                  </h2>
                </div>
              </div>

              <SystemTooltip
                content="Minimizar aviso (o cronômetro continuará visível no topo)"
                side="bottom"
              >
                <button
                  type="button"
                  onClick={() => setIsMinimized(true)}
                  aria-label="Minimizar aviso de atualização"
                  className="inline-flex items-center justify-center w-6 h-6 -mt-0.5 -mr-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </SystemTooltip>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {isReloading ? (
                "Recarregando o sistema para aplicar a nova versão..."
              ) : isWaitingForHold ? (
                <span className="text-amber-600 dark:text-amber-400 font-medium inline-flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                  <span>{holdLabel} O sistema atualizará assim que terminar.</span>
                </span>
              ) : isUrgent ? (
                <>
                  Finalize ou salve o que estiver fazendo. Atualização automática em{" "}
                  <strong className="font-mono tabular-nums text-primary">
                    {formattedCountdown}
                  </strong>
                  .
                </>
              ) : (
                <>
                  Continue normalmente e finalize o que estiver fazendo. O sistema atualizará
                  automaticamente em{" "}
                  <strong className="font-mono tabular-nums text-foreground">
                    {formattedCountdown}
                  </strong>
                  .
                </>
              )}
            </p>

            {/* Ações */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                {isWaitingForHold ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    Pausado durante atividade
                  </span>
                ) : (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-mono tabular-nums ${
                      isUrgent
                        ? "bg-primary/15 text-primary animate-pulse"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isReloading ? "00:00" : formattedCountdown}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsMinimized(true)}
                  disabled={isReloading}
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
                >
                  Minimizar
                </button>
                <button
                  type="button"
                  onClick={handleReload}
                  disabled={isReloading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.98] text-primary-foreground text-[11px] font-bold shadow-sm transition cursor-pointer disabled:opacity-60"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isReloading ? "animate-spin" : ""}`} />
                  <span>Atualizar agora</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Barra de progresso regressiva na base */}
        <div className="h-1 w-full bg-muted/60 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ease-linear ${
              isWaitingForHold ? "bg-amber-500 animate-pulse w-full" : "bg-primary"
            }`}
            style={isWaitingForHold ? undefined : { width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
