import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ChatProvider } from "@/hooks/useChatState";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DeployNotificationModal } from "@/components/ui/DeployNotificationModal";
import { useTheme } from "../hooks/useTheme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-card px-4 py-8">
      <div className="max-w-md w-full text-center bg-card rounded-3xl border border-border p-8 shadow-2xl space-y-6">
        {/* Foto da Valentina */}
        <div className="relative mx-auto w-24 h-24">
          <img
            src="/valentina.png"
            alt="Valentina IA"
            className="w-24 h-24 rounded-full object-cover border-4 border-primary/30 shadow-xl"
          />
          <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-primary ring-4 ring-card animate-pulse" />
        </div>

        {/* Mensagem da Valentina */}
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-primary-soft text-primary border border-primary/20">
            Valentina IA
          </span>
          <h1 className="text-lg font-black text-foreground leading-snug">
            Ops, acho que algo deu errado! 🤖
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed px-2 font-medium">
            Poderia avisar o Tarcisio por favor?
          </p>
        </div>

        {/* Botões: Tentar de novo & Falar com Tarcisio no Teams */}
        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="w-full py-3.5 px-4 rounded-2xl bg-primary hover:bg-primary-hover text-primary-foreground font-black text-xs transition flex items-center justify-center gap-2 shadow-soft cursor-pointer"
          >
            Tentar de novo
          </button>

          <a
            href="https://teams.microsoft.com/l/chat/0/0?users=suporte2@tecfag.com.br&message=Olá,%20Tarcisio!%20Ocorreu%20um%20erro%20no%20sistema%20Valem%20Chat."
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3.5 px-4 rounded-2xl bg-primary-soft hover:bg-primary-soft/80 text-primary font-black text-xs border border-primary/30 transition flex items-center justify-center gap-2.5 cursor-pointer decoration-none"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" className="text-primary" viewBox="0 0 16 16">
              <path d="M9.186 4.797a2.42 2.42 0 1 0-2.86-2.448h1.178c.929 0 1.682.753 1.682 1.682zm-4.295 7.738h2.613c.929 0 1.682-.753 1.682-1.682V5.58h2.783a.7.7 0 0 1 .682.716v4.294a4.197 4.197 0 0 1-4.093 4.293c-1.618-.04-3-.99-3.667-2.35Zm10.737-9.372a1.674 1.674 0 1 1-3.349 0 1.674 1.674 0 0 1 3.349 0m-2.238 9.488-.12-.002a5.2 5.2 0 0 0 .381-2.07V6.306a1.7 1.7 0 0 0-.15-.725h1.792c.39 0 .707.317.707.707v3.765a2.6 2.6 0 0 1-2.598 2.598z"/>
              <path d="M.682 3.349h6.822c.377 0 .682.305.682.682v6.822a.68.68 0 0 1-.682.682H.682A.68.68 0 0 1 0 10.853V4.03c0-.377.305-.682.682-.682Zm5.206 2.596v-.72h-3.59v.72h1.357V9.66h.87V5.945z"/>
            </svg>
            <span>Falar com Tarcisio (Teams)</span>
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" },
      { name: "google", content: "notranslate" },
      { name: "theme-color", content: "#2dc4a0" },
      { title: "Valem Chat — Central de Atendimento & Gestão Comercial" },
      { name: "description", content: "Plataforma oficial de atendimento multicanal, automação via WhatsApp, IA Valentina e gestão comercial da Valem Válvulas e Embalagens." },
      { name: "author", content: "Valem Válvulas e Embalagens" },

      // Open Graph (WhatsApp, Facebook, LinkedIn, Discord, Telegram)
      { property: "og:title", content: "Valem Chat — Central de Atendimento & Gestão Comercial" },
      { property: "og:description", content: "Plataforma oficial de atendimento multicanal, automação via WhatsApp, IA Valentina e gestão comercial da Valem Válvulas e Embalagens." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://tecfagchat.up.railway.app" },
      { property: "og:site_name", content: "Valem Chat" },
      { property: "og:image", content: "https://tecfagchat.up.railway.app/og-image.png" },
      { property: "og:image:secure_url", content: "https://tecfagchat.up.railway.app/og-image.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Valem Chat — Atendimento Inteligente & Gestão Comercial" },

      // Twitter Cards
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Valem Chat — Central de Atendimento & Gestão Comercial" },
      { name: "twitter:description", content: "Plataforma oficial de atendimento multicanal, automação via WhatsApp, IA Valentina e gestão comercial da Valem Válvulas e Embalagens." },
      { name: "twitter:image", content: "https://tecfagchat.up.railway.app/og-image.png" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/logo192.png" },
      { rel: "apple-touch-icon", href: "/logo192.png" },
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
  }),
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
            __html: `(function(){try{var t=localStorage.getItem("chat_theme_mode");var d=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d){document.documentElement.classList.add("dark");}else{document.documentElement.classList.remove("dark");}}catch(e){}})();`,
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

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ChatProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster />
          <DeployNotificationModal />
        </ChatProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
