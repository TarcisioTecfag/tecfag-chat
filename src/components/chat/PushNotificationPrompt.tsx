import React, { useCallback, useEffect, useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "@/hooks/useTheme";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  Bell,
  CheckCircle2,
  Laptop,
  Lock,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
  X,
} from "lucide-react";
import { toast } from "sonner";

const DISMISS_STORAGE_KEY = "push_notification_dismissed";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushNotificationPrompt() {
  const { tenant, currentOperatorId, isAuthenticated } = useChat();
  const isMobile = useIsMobile();
  const { theme } = useTheme();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(DISMISS_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showDeniedTutorial, setShowDeniedTutorial] = useState(false);
  const [stillBlockedNotice, setStillBlockedNotice] = useState(false);
  const [tutorialPlatform, setTutorialPlatform] = useState<"desktop" | "mobile">("desktop");

  useEffect(() => {
    setTutorialPlatform(isMobile ? "mobile" : "desktop");
  }, [isMobile]);

  const subscribePushToServer = useCallback(async () => {
    // 1. Aguardar Service Worker pronto
    const registration = await navigator.serviceWorker.ready;

    // 2. Obter chave pública VAPID do servidor
    const keyRes = await fetch(`/api/push?tenantId=${tenant}`, {
      credentials: "include",
    });
    const keyData = await keyRes.json();

    if (!keyData.publicKey) {
      throw new Error("Chave VAPID não configurada no servidor.");
    }

    // 3. Assinar Push Manager
    const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // 4. Enviar assinatura para o banco de dados via API
    const saveRes = await fetch("/api/push", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant,
        operatorId: currentOperatorId || "op-1",
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
      }),
    });

    if (saveRes.ok) {
      toast.info("Notificações ativadas com sucesso!");
      setShowDeniedTutorial(false);
      setStillBlockedNotice(false);
      setIsDismissed(true);
      try {
        window.localStorage.setItem(DISMISS_STORAGE_KEY, "true");
      } catch {
        // ignore
      }
      return true;
    } else {
      toast.info("Não foi possível salvar a assinatura de notificação no servidor.");
      return false;
    }
  }, [tenant, currentOperatorId]);

  useEffect(() => {
    if (document.documentElement.dataset.trainingInstalled) {
      setPermission("unsupported");
      return;
    }
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission);

    // Registrar o Service Worker silenciosamente
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("Service Worker registrado com sucesso:", reg.scope);
      })
      .catch((err) => {
        console.error("Falha ao registrar Service Worker:", err);
      });

    // Monitorar mudança de permissão em tempo real (quando o usuário desbloqueia na barra de endereço)
    let permStatus: PermissionStatus | null = null;
    if ("permissions" in navigator && typeof navigator.permissions?.query === "function") {
      navigator.permissions
        .query({ name: "notifications" as PermissionName })
        .then((status) => {
          permStatus = status;
          status.onchange = () => {
            const updatedPerm = Notification.permission;
            setPermission(updatedPerm);
            if (updatedPerm === "granted") {
              setStillBlockedNotice(false);
              setIsLoading(true);
              subscribePushToServer()
                .catch((err) => {
                  console.error("Erro ao assinar push após liberação:", err);
                })
                .finally(() => {
                  setIsLoading(false);
                });
            }
          };
        })
        .catch(() => {
          // ignore if browser doesn't support permissions query
        });
    }

    return () => {
      if (permStatus) {
        permStatus.onchange = null;
      }
    };
  }, [subscribePushToServer]);

  const handleDismiss = () => {
    setIsDismissed(true);
    setShowDeniedTutorial(false);
    setStillBlockedNotice(false);
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, "true");
    } catch {
      // ignore
    }
  };

  const handleEnablePush = async () => {
    if (permission === "unsupported") {
      toast.info("Notificações não são suportadas neste navegador.");
      return;
    }

    setStillBlockedNotice(false);

    // Se já estava como denied antes mesmo de chamar requestPermission, abre direto o tutorial
    if (Notification.permission === "denied") {
      setPermission("denied");
      setShowDeniedTutorial(true);
      return;
    }

    setIsLoading(true);

    try {
      const permResult = await Notification.requestPermission();
      setPermission(permResult);

      if (permResult === "denied") {
        setShowDeniedTutorial(true);
        setIsLoading(false);
        return;
      }

      if (permResult !== "granted") {
        toast.info("Confirme a permissão na janela do navegador para ativar os avisos.");
        setIsLoading(false);
        return;
      }

      await subscribePushToServer();
    } catch (err: any) {
      console.error("Erro ao ativar Push Notifications:", err);
      toast.info("Não foi possível ativar as notificações neste momento.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetryAfterTutorial = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const currentPerm = Notification.permission;
    setPermission(currentPerm);

    if (currentPerm === "denied") {
      setStillBlockedNotice(true);
      return;
    }

    setStillBlockedNotice(false);
    await handleEnablePush();
  };

  if (!isAuthenticated || permission === "granted" || permission === "unsupported" || isDismissed) {
    return null;
  }

  const currentOriginHost =
    typeof window !== "undefined" ? window.location.host || "sistema.tecfag.com.br" : "sistema.tecfag.com.br";

  return (
    <div
      data-push-notification-prompt="true"
      data-theme-mode={theme}
      className="fixed bottom-16 left-4 right-4 md:bottom-6 md:left-auto md:right-6 md:w-full md:max-w-[400px] z-50 bg-card text-card-foreground p-4 rounded-2xl shadow-card border border-border flex flex-col gap-3.5 transition-all duration-300"
    >
      {!showDeniedTutorial ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0 mt-0.5">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground tracking-tight">
                  Notificações no Celular
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  Receba alertas sonoros sempre que um cliente responder ao seu atendimento.
                </p>
              </div>
            </div>
            <SystemTooltip content="Fechar aviso">
              <button
                type="button"
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-muted shrink-0 cursor-pointer"
                aria-label="Fechar aviso de notificações"
              >
                <X className="h-4 w-4" />
              </button>
            </SystemTooltip>
          </div>

          <div className="flex items-center justify-end gap-2 pt-0.5">
            <button
              type="button"
              onClick={handleDismiss}
              className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-xl cursor-pointer"
            >
              Agora não
            </button>
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={isLoading}
              className="px-4 py-1.5 text-xs font-bold bg-primary hover:opacity-90 text-primary-foreground rounded-xl shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Bell className="h-3.5 w-3.5" />
              <span>{isLoading ? "Ativando..." : "Ativar Avisos"}</span>
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Cabeçalho do Tutorial quando Permissão = Denied */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0 mt-0.5">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h4 className="text-sm font-bold text-foreground tracking-tight">
                    Como Desbloquear as Notificações
                  </h4>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                    Permissão Negada
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                  O navegador bloqueou os avisos deste site. Veja como reverter em segundos:
                </p>
              </div>
            </div>
            <SystemTooltip content="Fechar tutorial">
              <button
                type="button"
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-muted shrink-0 cursor-pointer"
                aria-label="Fechar tutorial"
              >
                <X className="h-4 w-4" />
              </button>
            </SystemTooltip>
          </div>

          {/* Seletor Computador / Celular */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted border border-border">
            <button
              type="button"
              onClick={() => setTutorialPlatform("desktop")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                tutorialPlatform === "desktop"
                  ? "bg-card text-foreground shadow-2xs border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Laptop className="h-3.5 w-3.5" />
              <span>No Computador</span>
            </button>
            <button
              type="button"
              onClick={() => setTutorialPlatform("mobile")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                tutorialPlatform === "mobile"
                  ? "bg-card text-foreground shadow-2xs border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span>No Celular</span>
            </button>
          </div>

          {/* Ilustração visual da barra de endereço do navegador */}
          <div className="rounded-xl bg-muted/70 border border-border p-2.5 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/30 text-[10px] font-bold shrink-0 animate-pulse">
                  <SlidersHorizontal className="h-3 w-3" />
                  1. Clique aqui
                </span>
                <span className="text-[11px] font-mono text-muted-foreground truncate">
                  https://{currentOriginHost}
                </span>
              </div>
              <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
            </div>

            <div className="flex items-center justify-between gap-2 bg-card border border-border rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-xs font-semibold text-foreground">Notificações</span>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary text-primary-foreground text-[10px] font-bold">
                <CheckCircle2 className="h-3 w-3" />
                2. Mudar para Permitir
              </span>
            </div>
          </div>

          {/* Passos numerados */}
          <ol className="space-y-2 text-xs text-foreground">
            {tutorialPlatform === "desktop" ? (
              <>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span className="text-muted-foreground leading-snug">
                    No topo do navegador, clique no ícone de{" "}
                    <strong className="text-foreground">Ajustes da página</strong> (ou{" "}
                    <strong className="text-foreground">Cadeado</strong>) ao lado esquerdo da URL.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span className="text-muted-foreground leading-snug">
                    Encontre <strong className="text-foreground">Notificações</strong> e altere de{" "}
                    <em>Bloqueado</em> para <strong className="text-foreground">Permitir</strong> (ou ative a chave).
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <span className="text-muted-foreground leading-snug">
                    Clique em <strong className="text-foreground">Já liberei, testar</strong> abaixo para ativar os alertas.
                  </span>
                </li>
              </>
            ) : (
              <>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span className="text-muted-foreground leading-snug">
                    Toque no ícone de <strong className="text-foreground">Ajustes / Cadeado</strong> ao lado do endereço do site (ou no menu <strong className="text-foreground">⋮ → Permissões</strong>).
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span className="text-muted-foreground leading-snug">
                    Toque em <strong className="text-foreground">Notificações</strong> e mude de{" "}
                    <em>Bloqueado</em> para <strong className="text-foreground">Permitir</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <span className="text-muted-foreground leading-snug">
                    Toque em <strong className="text-foreground">Já liberei, testar</strong> abaixo para concluir.
                  </span>
                </li>
              </>
            )}
          </ol>

          {stillBlockedNotice && (
            <div className="rounded-xl bg-primary/10 border border-primary/25 px-3 py-2 text-[11px] text-foreground leading-snug">
              <strong className="text-primary font-semibold">Permissão ainda bloqueada no navegador:</strong>{" "}
              altere <strong>Notificações</strong> para <strong>Permitir</strong> no ícone ao lado da URL e clique em{" "}
              <strong>Recarregar</strong>.
            </div>
          )}

          {/* Ações do rodapé do tutorial */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
            <button
              type="button"
              onClick={handleDismiss}
              className="px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-xl cursor-pointer"
            >
              Agora não
            </button>
            <div className="flex items-center gap-1.5">
              <SystemTooltip content="Recarregar a página após alterar a permissão no navegador">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="px-2.5 py-1.5 text-xs font-semibold text-foreground bg-muted hover:bg-muted/80 border border-border rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Recarregar</span>
                </button>
              </SystemTooltip>
              <button
                type="button"
                onClick={handleRetryAfterTutorial}
                disabled={isLoading}
                className="px-3.5 py-1.5 text-xs font-bold bg-primary hover:opacity-90 text-primary-foreground rounded-xl shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Bell className="h-3.5 w-3.5" />
                <span>{isLoading ? "Testando..." : "Já liberei, testar"}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

