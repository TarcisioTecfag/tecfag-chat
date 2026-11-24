import React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { isOpenInNewTabModifier } from "@/lib/app-routes";

export interface AppNavLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  onNavigate?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  disabled?: boolean;
}

/**
 * Link semântico `<a href>` para abas, módulos e atalhos de navegação:
 * - Clique esquerdo simples: evita reload (`preventDefault`) e executa `onNavigate` em 0 ms (SPA).
 * - `Ctrl+Click` / `Cmd+Click` / botão do meio (scroll) / botão direito "Abrir em nova guia":
 *   deixa o navegador abrir a URL nativamente em uma nova guia sem substituir a atual.
 */
export const AppNavLink = React.forwardRef<HTMLAnchorElement, AppNavLinkProps>(
  function AppNavLink(
    { href, onNavigate, onClick, disabled = false, draggable = false, ...rest },
    ref,
  ) {
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      if (isOpenInNewTabModifier(event.nativeEvent)) {
        // Deixa o navegador abrir em nova guia/janela nativamente
        return;
      }
      event.preventDefault();
      onClick?.(event);
      if (!event.defaultPrevented || onNavigate) {
        onNavigate?.(event);
      }
    };

    return (
      <a
        ref={ref}
        href={disabled ? undefined : href}
        draggable={draggable}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : rest.tabIndex}
        onClick={handleClick}
        {...rest}
      />
    );
  },
);

export interface MotionAppNavLinkProps
  extends Omit<HTMLMotionProps<"a">, "href"> {
  href: string;
  onNavigate?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  disabled?: boolean;
}

/**
 * Versão animada (`motion.a`) do `AppNavLink` para itens com animações Framer Motion (ex.: Sidebar).
 */
export const MotionAppNavLink = React.forwardRef<HTMLAnchorElement, MotionAppNavLinkProps>(
  function MotionAppNavLink(
    { href, onNavigate, onClick, disabled = false, draggable = false, ...rest },
    ref,
  ) {
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      if (isOpenInNewTabModifier(event.nativeEvent)) {
        return;
      }
      event.preventDefault();
      onClick?.(event);
      onNavigate?.(event);
    };

    return (
      <motion.a
        ref={ref}
        href={disabled ? undefined : href}
        draggable={draggable}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : rest.tabIndex}
        onClick={handleClick}
        {...rest}
      />
    );
  },
);

const INTERACTIVE_DESCENDANT_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [role="menuitem"], [data-no-new-tab="true"]';

function isClickInsideNestedInteractive(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) return false;
  const interactive = target.closest(INTERACTIVE_DESCENDANT_SELECTOR);
  return Boolean(interactive && interactive !== currentTarget && currentTarget.contains(interactive));
}

export function openHrefInNewTab(href: string): boolean {
  if (typeof window === "undefined" || !href) return false;
  window.open(href, "_blank", "noopener");
  return true;
}

/**
 * Trata clique com Ctrl/Cmd/Shift em containers complexos (ex.: cards do Kanban ou itens da lista de chat
 * que contêm botões internos e portanto não podem ser envolvidos por `<a>`).
 * Retorna `true` se abriu em nova guia (o caller deve dar `return` e não disparar a ação na guia atual).
 */
export function handleModifiedNewTabClick(
  event: React.MouseEvent<HTMLElement>,
  href: string | null | undefined,
): boolean {
  if (!href) return false;
  if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return false;
  if (isClickInsideNestedInteractive(event.target, event.currentTarget)) return false;
  event.preventDefault();
  event.stopPropagation();
  return openHrefInNewTab(href);
}

/**
 * Handler para `onMouseDown` em containers complexos: impede o autoscroll nativo ao clicar com o scroll (botão do meio).
 */
export function handleMiddleClickMouseDown(
  event: React.MouseEvent<HTMLElement>,
  href: string | null | undefined,
): void {
  if (!href || event.button !== 1) return;
  if (isClickInsideNestedInteractive(event.target, event.currentTarget)) return;
  event.preventDefault();
}

/**
 * Handler para `onAuxClick` em containers complexos: abre a URL em nova guia ao clicar com o scroll (botão do meio).
 */
export function handleMiddleClickAuxOpen(
  event: React.MouseEvent<HTMLElement>,
  href: string | null | undefined,
): boolean {
  if (!href || event.button !== 1) return false;
  if (isClickInsideNestedInteractive(event.target, event.currentTarget)) return false;
  event.preventDefault();
  event.stopPropagation();
  return openHrefInNewTab(href);
}
