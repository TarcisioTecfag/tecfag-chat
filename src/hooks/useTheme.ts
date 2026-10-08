import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "chat_theme_mode";

/** Aplica a classe .dark ao elemento raiz do documento */
export function applyTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const isSystemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = mode === "dark" || (mode === "system" && isSystemDark);

  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/** Obtém o tema inicial salvo ou padrão "system" */
export function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") {
    return saved;
  }
  return "system";
}

/** Verifica se o modo escuro está ativo atualmente no DOM */
export function isDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, newTheme);
      applyTheme(newTheme);
      // Dispara evento customizado para sincronizar instâncias
      window.dispatchEvent(new CustomEvent("themechange", { detail: newTheme }));
    }
  }, []);

  useEffect(() => {
    // Aplica o tema na montagem
    applyTheme(theme);

    // Escuta mudanças no matchMedia do sistema se o tema for "system"
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      const current = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (current === "system" || !current) {
        applyTheme("system");
        window.dispatchEvent(new CustomEvent("themechange", { detail: "system" }));
      }
    };

    mediaQuery.addEventListener("change", handleSystemChange);

    // Escuta evento customizado de troca de tema
    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<ThemeMode>;
      if (customEvent.detail && customEvent.detail !== theme) {
        setThemeState(customEvent.detail);
      }
    };

    window.addEventListener("themechange", handleCustomChange);

    return () => {
      mediaQuery.removeEventListener("change", handleSystemChange);
      window.removeEventListener("themechange", handleCustomChange);
    };
  }, [theme]);

  return { theme, setTheme, isDark };
}
