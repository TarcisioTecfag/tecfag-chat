import { useEffect } from "react";

export type DeployHoldReason =
  | "audio_recording"
  | "audio_preview"
  | "active_call"
  | "sending_message";

export interface ActiveDeployHold {
  id: string;
  reason: DeployHoldReason;
}

const activeHolds = new Map<string, DeployHoldReason>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Nunca deixar um listener quebrar os demais
    }
  }
}

export function acquireDeployReloadHold(id: string, reason: DeployHoldReason): void {
  if (!id) return;
  if (activeHolds.get(id) === reason) return;
  activeHolds.set(id, reason);
  notifyListeners();
}

export function releaseDeployReloadHold(id: string): void {
  if (!id || !activeHolds.has(id)) return;
  activeHolds.delete(id);
  notifyListeners();
}

export function getActiveDeployReloadHolds(): ActiveDeployHold[] {
  return Array.from(activeHolds.entries()).map(([id, reason]) => ({ id, reason }));
}

export function hasActiveDeployReloadHold(): boolean {
  return activeHolds.size > 0;
}

export function subscribeDeployReloadHolds(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Retorna uma descrição amigável e prioritária do motivo pelo qual o reload automático está pausado.
 */
export function getDeployReloadHoldLabel(holds: ActiveDeployHold[]): string {
  if (holds.length === 0) return "";
  const reasons = new Set(holds.map((h) => h.reason));
  if (reasons.has("active_call")) return "Aguardando finalizar ligação...";
  if (reasons.has("audio_recording")) return "Aguardando finalizar gravação de áudio...";
  if (reasons.has("audio_preview")) return "Aguardando enviar ou descartar o áudio gravado...";
  return "Aguardando concluir envio de mensagem...";
}

/**
 * Hook declarativo para segurar o recarregamento automático de deploy enquanto
 * uma ação sensível (gravação de áudio, ligação ou envio) estiver em andamento.
 */
export function useDeployReloadHold(
  active: boolean,
  id: string,
  reason: DeployHoldReason,
): void {
  useEffect(() => {
    if (!active) {
      releaseDeployReloadHold(id);
      return;
    }
    acquireDeployReloadHold(id, reason);
    return () => {
      releaseDeployReloadHold(id);
    };
  }, [active, id, reason]);
}

export function resetDeployReloadHoldsForTests(): void {
  activeHolds.clear();
  notifyListeners();
}
