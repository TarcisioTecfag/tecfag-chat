import { useEffect, useState } from "react";

export interface TourTargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

export interface TourTargetState {
  element: HTMLElement | null;
  rect: TourTargetRect | null;
  found: boolean;
}

function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  ) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findVisibleTourElement(selectorKey: string | null): HTMLElement | null {
  if (!selectorKey || typeof document === "undefined") return null;
  const unwrapped = selectorKey
    .replace(/^\[data-tour=["']?/, "")
    .replace(/["']?\]$/, "");
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(unwrapped)
      : unwrapped.replace(/"/g, '\\"');
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-tour="${escaped}"]`),
  );
  // 1. Prefer visible live elements outside the fallback demo stage
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i];
    if (
      !candidate.closest('[data-tour-fallback-stage="true"]') &&
      isElementVisible(candidate)
    ) {
      return candidate;
    }
  }
  // 2. Otherwise use the visible element inside the interactive demo stage
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i];
    if (isElementVisible(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? null;
}

/**
 * Tracks a DOM element matching `[data-tour="<targetSelector>"]` in real time
 * across scroll, resize, DOM mutations, and layout animations.
 */
export function useTourTarget(
  targetSelector: string | null,
  active: boolean,
): TourTargetState {
  const [state, setState] = useState<TourTargetState>({
    element: null,
    rect: null,
    found: false,
  });

  useEffect(() => {
    if (!active || !targetSelector || typeof window === "undefined") {
      setState({ element: null, rect: null, found: false });
      return;
    }

    let rafId: number | null = null;
    let scrolledIntoViewForSelector = false;

    const measure = () => {
      const el = findVisibleTourElement(targetSelector);
      if (!el) {
        setState((prev) =>
          prev.found || prev.element !== null
            ? { element: null, rect: null, found: false }
            : prev,
        );
        return;
      }

      if (!scrolledIntoViewForSelector) {
        scrolledIntoViewForSelector = true;
        const r = el.getBoundingClientRect();
        const outOfViewport =
          r.top < 56 ||
          r.bottom > window.innerHeight - 56 ||
          r.left < 0 ||
          r.right > window.innerWidth;
        if (outOfViewport && typeof el.scrollIntoView === "function") {
          try {
            el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          } catch {
            // Fallback for older browsers
            el.scrollIntoView();
          }
        }
      }

      const raw = el.getBoundingClientRect();
      const nextRect: TourTargetRect = {
        top: Math.round(raw.top),
        left: Math.round(raw.left),
        width: Math.round(raw.width),
        height: Math.round(raw.height),
        bottom: Math.round(raw.bottom),
        right: Math.round(raw.right),
      };

      setState((prev) => {
        if (
          prev.found &&
          prev.element === el &&
          prev.rect &&
          Math.abs(prev.rect.top - nextRect.top) <= 1 &&
          Math.abs(prev.rect.left - nextRect.left) <= 1 &&
          Math.abs(prev.rect.width - nextRect.width) <= 1 &&
          Math.abs(prev.rect.height - nextRect.height) <= 1
        ) {
          return prev;
        }
        return { element: el, rect: nextRect, found: true };
      });
    };

    const scheduleMeasure = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    measure();
    const timerA = window.setTimeout(scheduleMeasure, 90);
    const timerB = window.setTimeout(scheduleMeasure, 240);

    window.addEventListener("resize", scheduleMeasure, { passive: true });
    window.addEventListener("scroll", scheduleMeasure, {
      capture: true,
      passive: true,
    });

    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-tour", "class", "style", "open", "data-state"],
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.clearTimeout(timerA);
      window.clearTimeout(timerB);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      mutationObserver.disconnect();
    };
  }, [targetSelector, active]);

  return state;
}
