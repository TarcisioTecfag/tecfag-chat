import { useEffect, useState, useRef } from "react";
import { RotateCw, Sparkles } from "lucide-react";
import { useChat } from "@/hooks/useChatState";

/**
 * Componente Modal Responsivo de Notificação de Novo Deploy (Railway)
 * Exibe a foto da Valentina e solicita o recarregamento da página
 * quando uma nova versão da aplicação é detectada no servidor.
 * As cores se adaptam dinamicamente ao tenant ativo (Valem = Verde #2dc4a0, Tecfag = Vermelho #df3d3d).
 */
export function DeployNotificationModal() {
  const { tenant } = useChat();
  const [hasNewDeploy, setHasNewDeploy] = useState(false);
  const initialVersionRef = useRef<string | null>(null);
  const isCheckingRef = useRef(false);

  // Estilos de tema dinâmicos para o modal conforme o tenant ativo
  const isTecfag = tenant === "tecfag";
  const themeStyles = isTecfag
    ? ({
        "--primary": "#df3d3d", // Vermelho Tecfag
        "--primary-soft": "#fde8e8",
      } as React.CSSProperties)
    : ({
        "--primary": "#2dc4a0", // Verde Esmeralda Valem
        "--primary-soft": "#d8f1ea",
      } as React.CSSProperties);

  const shadowColor = isTecfag ? "rgba(223, 61, 61, 0.15)" : "rgba(45, 196, 160, 0.15)";
  const gradientVia = isTecfag ? "via-red-400" : "via-emerald-400";

  const checkVersion = async () => {
    if (isCheckingRef.current) return;
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
            // Salva a versão inicial no primeiro carregamento
            initialVersionRef.current = currentVersion;
          } else if (initialVersionRef.current !== currentVersion) {
            // Novo deploy detectado!
            console.log("[DeployNotification] Novo deploy detectado:", currentVersion);
            setHasNewDeploy(true);
          }
        }
      }
    } catch (error) {
      console.warn("[DeployNotification] Falha ao verificar versão:", error);
    } finally {
      isCheckingRef.current = false;
    }
  };

  useEffect(() => {
    // 1. Checagem inicial
    checkVersion();

    // 2. Polling periódico a cada 30 segundos
    const interval = setInterval(checkVersion, 30000);

    // 3. Verificação ao focar novamente a aba do navegador
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkVersion();
      }
    };

    window.addEventListener("focus", checkVersion);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", checkVersion);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleReload = () => {
    window.location.reload();
  };

  if (!hasNewDeploy) return null;

  return (
    <div 
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-300"
      style={themeStyles}
    >
      <div 
        className="relative w-full max-w-md bg-card border border-border/80 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center text-foreground overflow-hidden animate-in zoom-in-95 duration-300"
        style={{ boxShadow: `0 20px 50px ${shadowColor}, 0 10px 30px rgba(0, 0, 0, 0.3)` }}
      >
        {/* Glow decorativo no topo com a cor da marca */}
        <div className="absolute -top-16 -left-16 w-32 h-32 bg-primary/20 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-16 w-32 h-32 bg-primary/15 rounded-full blur-2xl pointer-events-none" />

        {/* Badge Valentina IA */}
        <div className="flex items-center justify-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black bg-primary-soft text-primary border border-primary/20 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span>Valentina IA • Atualização do Sistema</span>
          </span>
        </div>

        {/* Foto da Valentina em tamanho destacado */}
        <div className="relative mx-auto w-28 h-28 sm:w-32 sm:h-32">
          <div className={`absolute -inset-1.5 rounded-full bg-gradient-to-r from-primary ${gradientVia} to-primary opacity-75 blur-sm animate-pulse`} />
          <img
            src="/valentina.png"
            alt="Valentina IA"
            className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full object-cover border-4 border-card shadow-2xl"
          />
          {/* Status Indicator */}
          <span className="absolute bottom-1 right-1 h-5 w-5 rounded-full bg-emerald-500 ring-4 ring-card flex items-center justify-center shadow-md">
            <span className="h-2 w-2 rounded-full bg-white animate-ping" />
          </span>
        </div>

        {/* Mensagem Solicitada */}
        <div className="space-y-2 px-1">
          <h2 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
            Nova Atualização! 🚀
          </h2>
          <p className="text-sm sm:text-base text-foreground/90 font-medium leading-relaxed">
            "Olá, acabamos de atualizar o sistema, poderia por favor recarregar a pagina?"
          </p>
        </div>

        {/* Botão de Ação para Recarregar a Página */}
        <div className="pt-2">
          <button
            onClick={handleReload}
            className="w-full py-4 px-6 rounded-2xl bg-primary hover:bg-primary/90 active:scale-[0.98] text-primary-foreground font-black text-sm sm:text-base transition-all duration-200 flex items-center justify-center gap-2.5 shadow-lg shadow-primary/25 cursor-pointer"
          >
            <RotateCw className="w-5 h-5 animate-spin-slow" />
            <span>Recarregar Página</span>
          </button>
        </div>
      </div>
    </div>
  );
}
