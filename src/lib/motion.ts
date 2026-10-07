/**
 * Padronização de Movimento e Transições do Valem Chat / Tecfag Chat
 *
 * Diretrizes:
 * - Movimentos rápidos e discretos que não atrasam o operador de atendimento.
 * - Duração máxima de 140ms-220ms para trocas visuais.
 * - Curva de desaceleração suave (ease-out-expo) para sensação tátil e premium.
 * - Respeito estrito a `prefers-reduced-motion`.
 */

export const MOTION_DURATIONS = {
  instant: 0,
  micro: 0.12, // 120ms - hover, microinterações, badges
  fast: 0.15,  // 150ms - tabs, filas, toggles, dropdowns
  normal: 0.20, // 200ms - troca de módulos, abertura de sheets, modais
  smooth: 0.28, // 280ms - expansões de acordeões ou elementos grandes
} as const;

export const MOTION_EASINGS = {
  // Apple/Material 3 ease-out exponencial (rápida aceleração, parada suave)
  easeOutExpo: [0.16, 1, 0.3, 1] as const,
  // Transição equilibrada para cores e opacidades
  easeInOutSubtle: [0.4, 0, 0.2, 1] as const,
} as const;

// Transição padrão para telas e módulos principais
export const pageTransitionVariants = {
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: MOTION_DURATIONS.normal,
      ease: MOTION_EASINGS.easeOutExpo,
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: {
      duration: MOTION_DURATIONS.fast,
      ease: MOTION_EASINGS.easeInOutSubtle,
    },
  },
};

// Transição sutil de cross-fade simples para tabs e filtros
export const tabContentVariants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      duration: MOTION_DURATIONS.fast,
      ease: MOTION_EASINGS.easeInOutSubtle,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: MOTION_DURATIONS.micro,
      ease: MOTION_EASINGS.easeInOutSubtle,
    },
  },
};

// Microinterações de hover para botões e cards interativos
export const interactiveCardHover = {
  whileHover: { y: -2, transition: { duration: MOTION_DURATIONS.micro, ease: "easeOut" } },
  whileTap: { scale: 0.98, transition: { duration: MOTION_DURATIONS.instant } },
};
