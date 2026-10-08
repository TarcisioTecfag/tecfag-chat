import { useState, useEffect, useCallback } from "react";

export type DensityMode = "auto" | "75" | "85" | "100";

const STORAGE_KEY = "chat_ui_density";

/** Aplica o atributo de densidade ao elemento raiz do documento */
export function applyDensity(mode: DensityMode) {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  if (mode === "auto") {
    root.removeAttribute("data-density");
  } else {
    root.setAttribute("data-density", mode);
  }
}

/** Obtém a densidade inicial salva ou padrão "auto" */
export function getInitialDensity(): DensityMode {
  if (typeof window === "undefined") return "auto";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "auto" || saved === "75" || saved === "85" || saved === "100") {
    return saved as DensityMode;
  }
  return "auto";
}

export function useDensity() {
  const [density, setDensityState] = useState<DensityMode>(getInitialDensity);

  const setDensity = useCallback((newDensity: DensityMode) => {
    setDensityState(newDensity);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, newDensity);
      applyDensity(newDensity);
      window.dispatchEvent(new CustomEvent("densitychange", { detail: newDensity }));
    }
  }, []);

  useEffect(() => {
    applyDensity(density);

    const handleDensityChange = (e: Event) => {
      const customEvent = e as CustomEvent<DensityMode>;
      if (customEvent.detail) {
        setDensityState(customEvent.detail);
      }
    };

    window.addEventListener("densitychange", handleDensityChange);
    return () => {
      window.removeEventListener("densitychange", handleDensityChange);
    };
  }, [density]);

  return { density, setDensity };
}
