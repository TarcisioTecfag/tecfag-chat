export interface WhisperOpenTransition {
  nextWasOpen: boolean;
  shouldResetForm: boolean;
}

/**
 * Decide se o formulário do modal de sussurro deve ser inicializado/limpo.
 * Retorna `shouldResetForm: true` apenas na transição fechado -> aberto,
 * preservando o rascunho em re-renders enquanto o modal permanece aberto.
 */
export function resolveWhisperOpenTransition(
  wasOpen: boolean,
  isOpen: boolean,
): WhisperOpenTransition {
  if (!isOpen) {
    return { nextWasOpen: false, shouldResetForm: false };
  }
  if (wasOpen) {
    return { nextWasOpen: true, shouldResetForm: false };
  }
  return { nextWasOpen: true, shouldResetForm: true };
}
