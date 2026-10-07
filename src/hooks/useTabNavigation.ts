import { useEffect, useRef } from "react";

export interface TabNavigationOptions<T extends string | number> {
  tabs: readonly T[];
  activeTab: T;
  onChange: (tab: T) => void;
  enabled?: boolean;
}

/**
 * Dispara evento global para avançar ou recuar abas no módulo atualmente ativo.
 */
export function dispatchTabNavigation(direction: "left" | "right") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("app:navigate-tab", {
      detail: { direction },
    })
  );
}

/**
 * Hook para componentes de visão registrarem suas abas e responderem
 * às setas ← e → (Esquerda / Direita) com wrap-around cíclico.
 */
export function useTabNavigation<T extends string | number>({
  tabs,
  activeTab,
  onChange,
  enabled = true,
}: TabNavigationOptions<T>) {
  const tabsRef = useRef(tabs);
  const activeTabRef = useRef(activeTab);
  const onChangeRef = useRef(onChange);
  const enabledRef = useRef(enabled);

  tabsRef.current = tabs;
  activeTabRef.current = activeTab;
  onChangeRef.current = onChange;
  enabledRef.current = enabled;

  useEffect(() => {
    const handleTabNav = (event: Event) => {
      if (!enabledRef.current) return;
      const currentTabs = tabsRef.current;
      if (!currentTabs || currentTabs.length <= 1) return;

      const customEvent = event as CustomEvent<{ direction: "left" | "right" }>;
      const { direction } = customEvent.detail || {};
      if (!direction) return;

      const currentActive = activeTabRef.current;
      const currentIndex = currentTabs.indexOf(currentActive);

      if (currentIndex === -1) {
        onChangeRef.current(currentTabs[0]);
        return;
      }

      if (direction === "right") {
        const nextIndex = (currentIndex + 1) % currentTabs.length;
        onChangeRef.current(currentTabs[nextIndex]);
      } else if (direction === "left") {
        const prevIndex = (currentIndex - 1 + currentTabs.length) % currentTabs.length;
        onChangeRef.current(currentTabs[prevIndex]);
      }
    };

    window.addEventListener("app:navigate-tab", handleTabNav as EventListener);
    return () => {
      window.removeEventListener("app:navigate-tab", handleTabNav as EventListener);
    };
  }, []);
}
