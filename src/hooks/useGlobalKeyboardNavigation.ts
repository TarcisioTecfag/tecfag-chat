import { useEffect, useRef } from "react";
import { ViewId } from "@/lib/rbac";
import { dispatchTabNavigation } from "./useTabNavigation";

export function isEditingText(target: EventTarget | null): boolean {
  if (!target) return false;
  if (typeof HTMLElement !== "undefined" && !(target instanceof HTMLElement)) return false;
  const el = target as any;
  const tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
  if (tag === "input") {
    const type = typeof el.type === "string" ? el.type.toLowerCase() : "";
    // Botões e seletores não são digitação de texto puro, mas form elements
    if (type === "button" || type === "submit" || type === "reset" || type === "checkbox" || type === "radio") {
      return false;
    }
    return true;
  }
  if (tag === "textarea" || tag === "select") {
    return true;
  }
  if (el.isContentEditable || (typeof el.getAttribute === "function" && el.getAttribute("contenteditable") === "true")) {
    return true;
  }
  if (typeof el.closest === "function" && el.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) {
    return true;
  }
  return false;
}

export function isModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  const openModal = document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], .radix-dialog-content'
  );
  return Boolean(openModal);
}

export function getAccessibleModulesList({
  tenant,
  sessionRole,
  canAccessView,
}: {
  tenant: string | null;
  sessionRole?: string | null;
  canAccessView: (view: ViewId) => boolean;
}): ViewId[] {
  const navItems: ViewId[] = [
    ...(tenant === "tecfag" ? (["commercialHome"] as ViewId[]) : []),
    "chat",
    "crm",
    "tasks",
    "contacts",
    "wallet",
  ];

  const decorativeItems: ViewId[] = [
    ...(tenant === "tecfag" && sessionRole === "admin"
      ? (["commercialManagement", "commercialBi"] as ViewId[])
      : []),
    "valentina",
    "ligacoes",
    "monitor",
    "analytics",
    "groups",
    "settings",
  ];

  return [...navItems, ...decorativeItems].filter((id) => canAccessView(id));
}

interface UseGlobalKeyboardNavigationProps {
  tenant: string | null;
  sessionRole?: string | null;
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  canAccessView: (view: ViewId) => boolean;
  enabled?: boolean;
}

export function useGlobalKeyboardNavigation({
  tenant,
  sessionRole,
  activeView,
  setActiveView,
  canAccessView,
  enabled = true,
}: UseGlobalKeyboardNavigationProps) {
  const activeViewRef = useRef(activeView);
  const setActiveViewRef = useRef(setActiveView);
  const tenantRef = useRef(tenant);
  const sessionRoleRef = useRef(sessionRole);
  const canAccessViewRef = useRef(canAccessView);
  const enabledRef = useRef(enabled);

  activeViewRef.current = activeView;
  setActiveViewRef.current = setActiveView;
  tenantRef.current = tenant;
  sessionRoleRef.current = sessionRole;
  canAccessViewRef.current = canAccessView;
  enabledRef.current = enabled;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;

      // Não interfere com comandos que utilizam Ctrl, Cmd ou Shift
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;

      const isText = isEditingText(e.target);

      // Tecla Escape em campo de digitação: remove o foco para liberar navegação livre imediata
      if (e.key === "Escape" && isText) {
        (e.target as HTMLElement).blur();
        return;
      }

      // Se estiver digitando em campo de texto e não estiver segurando Alt, preserva a digitação normal
      if (isText && !e.altKey) {
        return;
      }

      // Se houver modal ou diálogo sobreposto aberto, não troca de tela em segundo plano
      if (isModalOpen()) return;

      // 1. Setas Verticais: Navegação entre Módulos do Sistema (Sidebar)
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const modules = getAccessibleModulesList({
          tenant: tenantRef.current,
          sessionRole: sessionRoleRef.current,
          canAccessView: canAccessViewRef.current,
        });

        if (!modules.length) return;

        e.preventDefault();
        const currentIdx = modules.indexOf(activeViewRef.current);

        if (e.key === "ArrowDown") {
          const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % modules.length;
          setActiveViewRef.current(modules[nextIdx]);
        } else {
          const prevIdx = currentIdx === -1 ? modules.length - 1 : (currentIdx - 1 + modules.length) % modules.length;
          setActiveViewRef.current(modules[prevIdx]);
        }
        return;
      }

      // 2. Setas Horizontais: Navegação entre Abas do Módulo Ativo
      if (e.key === "ArrowRight") {
        e.preventDefault();
        dispatchTabNavigation("right");
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        dispatchTabNavigation("left");
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
