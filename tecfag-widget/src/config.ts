// ══════════════════════════════════════════════════════════════════════════════
// ⚙️ TECFAG CHAT WIDGET PRO — Configuração Dinâmica de Origem e Tenant
// Detecta automaticamente o servidor de onde o script foi carregado para que
// o mesmo bundle funcione em homologação, produção ou domínio externo (VTEX).
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_PRODUCTION_BACKEND = "https://tecfagchat.up.railway.app";

const capturedScript =
  typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null) : null;

function findWidgetScript(): HTMLScriptElement | null {
  if (capturedScript) return capturedScript;
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLScriptElement>(
    'script[src*="site-chat"], script[src*="tecfag-chat"], script[src*="widget.iife"], script[data-gtmsrc*="site-chat"], script[data-gtmsrc*="tecfag-chat"]',
  );
}

function isLegacyOrStoreHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "tecfag.com.br" ||
    h === "www.tecfag.com.br" ||
    h.endsWith(".tecfag.com.br") ||
    h === "fagner-fajos.vercel.app" ||
    h === "fagnertecfag-production.up.railway.app"
  );
}

function resolveBackendUrl(): string {
  if (typeof window !== "undefined") {
    const winAny = window as any;
    if (winAny.__TECFAG_BACKEND_URL__) {
      return String(winAny.__TECFAG_BACKEND_URL__).replace(/\/+$/, "");
    }
    if (winAny.__VITE_BACKEND_URL__) {
      const candidate = String(winAny.__VITE_BACKEND_URL__).replace(/\/+$/, "");
      if (!candidate.includes("fagnertecfag-production.up.railway.app")) {
        return candidate;
      }
    }
  }

  const scriptEl = findWidgetScript();
  if (scriptEl?.dataset?.backend) {
    return scriptEl.dataset.backend.replace(/\/+$/, "");
  }

  const rawScriptSrc = scriptEl?.src || scriptEl?.getAttribute?.("data-gtmsrc") || "";
  if (rawScriptSrc) {
    try {
      const parsed = new URL(rawScriptSrc, typeof window !== "undefined" ? window.location?.href : undefined);
      if (!isLegacyOrStoreHost(parsed.hostname)) {
        return parsed.origin;
      }
    } catch {}
  }

  const envUrl = (import.meta as any).env?.VITE_BACKEND_URL;
  if (envUrl && !String(envUrl).includes("fagnertecfag-production.up.railway.app")) {
    return String(envUrl).replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    const host = window.location.hostname || "";
    if (!isLegacyOrStoreHost(host)) {
      return window.location.origin;
    }
  }

  return DEFAULT_PRODUCTION_BACKEND;
}

export const BACKEND_URL = resolveBackendUrl();
export const TENANT_ID = findWidgetScript()?.dataset?.tenant || "tecfag";
export const AVATAR_URL =
  findWidgetScript()?.dataset?.avatar || `${BACKEND_URL}/fagner-avatar.jpg`;
export const BLACK_AVATAR_URL = `${BACKEND_URL}/fagner-black-november.png`;

export function buildLiveChatWsUrl(cookieId: string): string {
  const scriptEl = findWidgetScript();
  const customWs = scriptEl?.dataset?.ws;
  const wsProtocol = BACKEND_URL.startsWith("https") ? "wss" : "ws";
  const wsHost = BACKEND_URL.replace(/^https?:\/\//, "");
  const baseWs = customWs || `${wsProtocol}://${wsHost}/ws/livechat`;

  const currentUrl = typeof window !== "undefined" ? window.location.href : "";
  const currentTitle = typeof document !== "undefined" ? document.title : "";
  const referrer = typeof document !== "undefined" ? document.referrer : "";

  const params = new URLSearchParams({
    tenantId: TENANT_ID,
    cookieId,
    ...(currentUrl ? { currentUrl } : {}),
    ...(currentTitle ? { currentTitle } : {}),
    ...(referrer ? { referrer } : {}),
  });

  return `${baseWs}${baseWs.includes("?") ? "&" : "?"}${params.toString()}`;
}

export function ensureWidgetStylesheetLoaded(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("tecfag-widget-external-css")) return;

  const existingLink = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some(
    (link) =>
      link.href.includes("site-chat.css") ||
      link.href.includes("tecfag-chat.css") ||
      link.href.includes("widget.css"),
  );
  if (existingLink) return;

  const link = document.createElement("link");
  link.id = "tecfag-widget-external-css";
  link.rel = "stylesheet";
  link.href = `${BACKEND_URL}/tecfag-chat.css`;
  document.head.appendChild(link);
}
