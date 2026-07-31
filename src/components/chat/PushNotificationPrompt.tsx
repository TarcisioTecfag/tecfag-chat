import React, { useEffect, useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { Bell, BellOff, CheckCircle2, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

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
  const { tenant, currentOperatorId } = useChat();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
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
  }, []);

  const handleEnablePush = async () => {
    if (permission === "unsupported") {
      toast.error("Notificações não são suportadas neste navegador.");
      return;
    }

    setIsLoading(true);

    try {
      // 1. Solicitar permissão nativa
      const permResult = await Notification.requestPermission();
      setPermission(permResult);

      if (permResult !== "granted") {
        toast.error("Permissão de notificação foi negada.");
        setIsLoading(false);
        return;
      }

      // 2. Aguardar Service Worker pronto
      const registration = await navigator.serviceWorker.ready;

      // 3. Obter chave pública VAPID do servidor
      const keyRes = await fetch(`/api/push?tenantId=${tenant}`);
      const keyData = await keyRes.json();

      if (!keyData.publicKey) {
        throw new Error("Chave VAPID não configurada no servidor.");
      }

      // 4. Assinar Push Manager
      const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // 5. Enviar assinatura para o banco de dados via API
      const saveRes = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          operatorId: currentOperatorId || "op-1",
          subscription: subscription.toJSON(),
          userAgent: navigator.userAgent,
        }),
      });

      if (saveRes.ok) {
        toast.success("Notificações no celular ativadas com sucesso!");
        setIsDismissed(true);
      } else {
        toast.error("Erro ao salvar assinatura de notificação no servidor.");
      }
    } catch (err: any) {
      console.error("Erro ao ativar Push Notifications:", err);
      toast.error("Ocorreu um erro ao ativar as notificações.");
    } finally {
      setIsLoading(false);
    }
  };

  if (permission === "granted" || permission === "unsupported" || isDismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-16 left-4 right-4 md:bottom-6 md:left-auto md:right-6 md:max-w-sm z-50 bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-white/10 flex flex-col gap-3 transition-all duration-300 backdrop-blur-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[var(--primary)]/20 text-[var(--primary)] shrink-0">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold tracking-tight">Notificações no Celular</h4>
            <p className="text-xs text-slate-300 leading-snug mt-0.5">
              Receba alertas sonoros no celular sempre que um cliente responder ao seu atendimento.
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsDismissed(true)}
          className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={() => setIsDismissed(true)}
          className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors rounded-lg"
        >
          Agora não
        </button>
        <button
          onClick={handleEnablePush}
          disabled={isLoading}
          className="px-4 py-1.5 text-xs font-bold bg-[var(--primary)] hover:opacity-90 text-white rounded-xl shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
        >
          <Bell className="h-3.5 w-3.5" />
          <span>{isLoading ? "Ativando..." : "Ativar Avisos"}</span>
        </button>
      </div>
    </div>
  );
}
