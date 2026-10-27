import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ChatProvider, useChat } from "@/hooks/useChatState";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DeployNotificationModal } from "@/components/ui/DeployNotificationModal";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "../hooks/useTheme";
import { useDensity } from "../hooks/useDensity";

import { getAiPersona } from "@/lib/ai-persona";
import { AiAvatar } from "@/components/ui/AiAvatar";
import {
  installAssetRecovery,
  isMissingAssetError,
  reloadForMissingAsset,
} from "@/lib/asset-recovery";

import { shouldShowMiniChatWidget } from "@/lib/widget-visibility";
import { isAppShellPath, isKnownStandalonePath } from "@/lib/app-routes";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import { OnboardingHost } from "@/components/onboarding/OnboardingHost";
import { Index } from "./index";

installAssetRecovery();

const CrmChatWidget = lazy(() =>
  import("@/components/crm/CrmChatWidget").then((module) => ({ default: module.CrmChatWidget })),
);

function PersistentAppShell() {
  const { currentPathname, resolvedPathname, isTransitioning } = useRouterState({
    select: (state) => ({
      currentPathname: state.location.pathname,
      resolvedPathname: state.resolvedLocation?.pathname,
      isTransitioning: state.isTransitioning || state.status === "pending",
    }),
  });

  // Mantém o shell visível enquanto a nova rota dedicada (ex: /crm/deals/$dealId) ainda está resolvendo/carregando chunk
  const effectivePathname = isTransitioning && resolvedPathname ? resolvedPathname : currentPathname;
  if (!isAppShellPath(effectivePathname)) {
    return null;
  }
  return <Index />;
}

function MaybeCrmChatWidget() {
  const { activeView, isAuthenticated } = useChat();
  const location = useLocation();
  const isMobile = useIsMobile();

  const shouldShow = shouldShowMiniChatWidget({
    activeView,
    pathname: location.pathname,
    isAuthenticated,
    isMobile,
  });

  if (!shouldShow) return null;
  return (
    <Suspense fallback={null}>
      <CrmChatWidget />
    </Suspense>
  );
}

function NotFoundComponent() {
  const location = useLocation();
  const { resolvedPathname, isTransitioning } = useRouterState({
    select: (state) => ({
      resolvedPathname: state.resolvedLocation?.pathname,
      isTransitioning: state.isTransitioning || state.status === "pending",
    }),
  });

  if (
    isAppShellPath(location.pathname) ||
    isKnownStandalonePath(location.pathname) ||
    (resolvedPathname &&
      (isAppShellPath(resolvedPathname) || isKnownStandalonePath(resolvedPathname))) ||
    isTransitioning
  ) {
    return null;
  }

  return (
    <div className="fixed inset-0 flex h-full w-full items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A rota acessada não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const missingAsset = isMissingAssetError(error);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  useEffect(() => {
    if (missingAsset) reloadForMissingAsset();
  }, [missingAsset]);

  let tenant = "valem";
  if (typeof window !== "undefined") {
    try {
      const savedTenant = localStorage.getItem("chat_tenant");
      if (savedTenant === "tecfag" || savedTenant === "valem") {
        tenant = savedTenant;
      }
    } catch (e) {}
  }
  const persona = getAiPersona(tenant);
  const isTecfag = tenant === "tecfag";
  const systemName = isTecfag ? "Tecfag Chat" : "Valem Chat";
  const teamsMsg = encodeURIComponent(`Olá, Tarcisio! Ocorreu um erro no sistema ${systemName}.`);

  return (
    <div className="fixed inset-0 flex h-full w-full items-center justify-center bg-card px-4 py-8">
      <div className="max-w-md w-full text-center bg-card rounded-3xl border border-border p-8 shadow-2xl space-y-6">
        {/* Foto da IA (Fagner para Tecfag / Valentina para Valem) */}
        <div className="relative mx-auto w-24 h-24">
          <AiAvatar
            tenantId={tenant}
            className="w-24 h-24 rounded-full border-4 border-primary/30 shadow-xl"
          />
          <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-primary ring-4 ring-card animate-pulse" />
        </div>

        {/* Mensagem da IA */}
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-primary-soft text-primary border border-primary/20">
            {persona.name} IA
          </span>
          <h1 className="text-lg font-black text-foreground leading-snug">
            Ops, acho que algo deu errado!
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed px-2 font-medium">
            {missingAsset
              ? "Uma atualização interrompeu o carregamento. Recarregue para abrir a versão atual."
              : "Poderia avisar o Tarcisio por favor?"}
          </p>
        </div>

        {/* Botões: Tentar de novo & Falar com Tarcisio no Teams */}
        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={() => {
              if (missingAsset) {
                window.location.reload();
              } else {
                router.invalidate();
                reset();
              }
            }}
            className="w-full py-3.5 px-4 rounded-2xl bg-primary hover:bg-primary-hover text-primary-foreground font-black text-xs transition flex items-center justify-center gap-2 shadow-soft cursor-pointer"
          >
            Tentar de novo
          </button>

          <a
            href={`https://teams.microsoft.com/l/chat/0/0?users=suporte2@tecfag.com.br&message=${teamsMsg}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3.5 px-4 rounded-2xl bg-primary-soft hover:bg-primary-soft/80 text-primary font-black text-xs border border-primary/30 transition flex items-center justify-center gap-2.5 cursor-pointer decoration-none"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              fill="currentColor"
              className="text-primary"
              viewBox="0 0 16 16"
            >
              <path d="M9.186 4.797a2.42 2.42 0 1 0-2.86-2.448h1.178c.929 0 1.682.753 1.682 1.682zm-4.295 7.738h2.613c.929 0 1.682-.753 1.682-1.682V5.58h2.783a.7.7 0 0 1 .682.716v4.294a4.197 4.197 0 0 1-4.093 4.293c-1.618-.04-3-.99-3.667-2.35Zm10.737-9.372a1.674 1.674 0 1 1-3.349 0 1.674 1.674 0 0 1 3.349 0m-2.238 9.488-.12-.002a5.2 5.2 0 0 0 .381-2.07V6.306a1.7 1.7 0 0 0-.15-.725h1.792c.39 0 .707.317.707.707v3.765a2.6 2.6 0 0 1-2.598 2.598z" />
              <path d="M.682 3.349h6.822c.377 0 .682.305.682.682v6.822a.68.68 0 0 1-.682.682H.682A.68.68 0 0 1 0 10.853V4.03c0-.377.305-.682.682-.682Zm5.206 2.596v-.72h-3.59v.72h1.357V9.66h.87V5.945z" />
            </svg>
            <span>Falar com Tarcisio (Teams)</span>
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => {
    let title = "Tecfag Group";
    let iconHref = "/logo_t_preto.png";
    let themeColor = "#0a0a0a";
    const ogTitle = "Tecfag Group";
    const ogDescription = "Sistema desenvolvido especialmente para a Tecfag Group.";
    const ogImageUrl = "https://tecfagchat.up.railway.app/og-image.png?v=tecfag";

    if (typeof window !== "undefined") {
      try {
        const savedTenant = localStorage.getItem("chat_tenant");
        if (savedTenant === "valem") {
          title = "Valem Chat";
          iconHref = "/favicon.png";
          themeColor = "#2dc4a0";
        } else if (savedTenant === "tecfag") {
          title = "Tecfag Chat";
          iconHref = "/logo_tecfag.png";
          themeColor = "#df3d3d";
        }
      } catch (e) {}
    }

    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content:
            "width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover",
        },
        { name: "google", content: "notranslate" },
        { name: "theme-color", content: themeColor },
        { title },
        {
          name: "description",
          content: ogDescription,
        },
        { name: "author", content: "Tecfag Group" },

        // Open Graph (WhatsApp, Facebook, LinkedIn, Discord, Telegram, Microsoft Teams)
        { property: "og:title", content: ogTitle },
        {
          property: "og:description",
          content: ogDescription,
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: "https://tecfagchat.up.railway.app" },
        { property: "og:site_name", content: ogTitle },
        { property: "og:image", content: ogImageUrl },
        {
          property: "og:image:secure_url",
          content: ogImageUrl,
        },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: ogTitle },

        // Twitter Cards
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: ogTitle },
        {
          name: "twitter:description",
          content: ogDescription,
        },
        { name: "twitter:image", content: ogImageUrl },

        // Mobile & PWA App (Safari iOS e Chrome Android)
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "default" },
        { name: "apple-mobile-web-app-title", content: "Tecfag Group" },
        { name: "application-name", content: "Tecfag Group" },
      ],
      links: [
        { rel: "icon", type: "image/png", href: iconHref },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "apple-touch-icon", sizes: "192x192", href: "/logo192.png" },
        { rel: "apple-touch-icon", sizes: "512x512", href: "/logo512.png" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/manifest.json" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
        },
        {
          rel: "stylesheet",
          href: appCss,
        },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="notranslate" translate="no">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(typeof window!=="undefined"){if(typeof window.global==="undefined")window.global=window;if(typeof window.Buffer==="undefined"){window.Buffer={isBuffer:function(b){return b instanceof Uint8Array;},from:function(d){if(typeof d==="string")return new TextEncoder().encode(d);return new Uint8Array(d);},alloc:function(s){return new Uint8Array(s);},allocUnsafe:function(s){return new Uint8Array(s);},concat:function(l){var t=0;for(var i=0;i<l.length;i++)t+=(l[i].length||0);var r=new Uint8Array(t);var o=0;for(var j=0;j<l.length;j++){r.set(l[j],o);o+=l[j].length;}return r;}};}}}catch(e){}})();(function(){try{var t=localStorage.getItem("chat_tenant");var isV=t==="valem";var isT=t==="tecfag";document.title=isV?"Valem Chat":(isT?"Tecfag Chat":"Tecfag Group");var icon=isV?"/favicon.png":(isT?"/logo_tecfag.png":"/logo_t_preto.png");var l=document.querySelectorAll("link[rel='icon'], link[rel='shortcut icon']");l.forEach(function(el){el.href=icon;});}catch(e){}})();(function(){try{var t=localStorage.getItem("chat_theme_mode");var v=t==="voice";var d=t==="dark"||v||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d){document.documentElement.classList.add("dark");}else{document.documentElement.classList.remove("dark");}if(v){document.documentElement.classList.add("theme-voice");document.documentElement.setAttribute("data-theme","voice");}else{document.documentElement.classList.remove("theme-voice");document.documentElement.removeAttribute("data-theme");}}catch(e){}})();(function(){try{var d=localStorage.getItem("chat_ui_density");if(d&&d!=="auto"){document.documentElement.setAttribute("data-density",d);}}catch(e){}})();(function(){try{var syncMobileSafeViewport=function(){var root=document.documentElement;if(window.innerWidth>=768){root.style.removeProperty("--mobile-app-height");root.style.removeProperty("--safe-top");root.style.removeProperty("--safe-bottom");return;}var ua=navigator.userAgent||"";var isIOS=/iPhone|iPod|iPad/i.test(ua);var isStandalone=Boolean(navigator.standalone)||(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches);var isPortrait=window.innerWidth<window.innerHeight;var screenH=(window.screen&&window.screen.height)||window.innerHeight;var innerH=(window.visualViewport&&window.visualViewport.height)||window.innerHeight;var diff=screenH-window.innerHeight;if(isIOS&&isStandalone&&isPortrait){var minTop=diff>=40&&diff<=120?diff:(screenH>=812?54:20);var safeBot=diff>=40&&diff<=120?"6px":"max(env(safe-area-inset-bottom, 0px), "+(screenH>=812?20:8)+"px)";root.style.setProperty("--mobile-app-height",Math.round(innerH)+"px");root.style.setProperty("--safe-top","max(env(safe-area-inset-top, 0px), "+minTop+"px)");root.style.setProperty("--safe-bottom",safeBot);}else{root.style.setProperty("--mobile-app-height",Math.round(innerH)+"px");root.style.setProperty("--safe-top","env(safe-area-inset-top, 0px)");root.style.setProperty("--safe-bottom","env(safe-area-inset-bottom, 0px)");}};syncMobileSafeViewport();window.addEventListener("resize",syncMobileSafeViewport);window.addEventListener("orientationchange",syncMobileSafeViewport);if(window.visualViewport){window.visualViewport.addEventListener("resize",syncMobileSafeViewport);}}catch(e){}})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useTheme(); // Mantém ouvintes de matchMedia e sincronização de tema ativos
  useDensity(); // Mantém ouvintes de densidade/escala de tela ativos

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ChatProvider>
          <OnboardingProvider>
            <PersistentAppShell />
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
            <MaybeCrmChatWidget />
            <OnboardingHost />
            <Toaster />
            <DeployNotificationModal />
          </OnboardingProvider>
        </ChatProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
