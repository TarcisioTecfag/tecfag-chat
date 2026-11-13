export interface OrganizableStage {
  id: string;
  name: string;
  orderIndex: number;
  dealsCount?: number;
}

export interface OrganizablePipeline {
  id: string;
  name: string;
  orderIndex: number;
  dealsCount?: number;
  stages: OrganizableStage[];
}

/**
 * Move um item da posição `fromIndex` para `toIndex` retornando um novo array com `orderIndex` reindexado (0..N-1).
 */
export function reorderByIndex<T extends { orderIndex: number }>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const list = [...items];
  if (
    list.length <= 1 ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return list.map((item, idx) => ({ ...item, orderIndex: idx }));
  }

  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list.map((item, idx) => ({ ...item, orderIndex: idx }));
}

/**
 * Calcula o índice alvo em uma lista horizontal de etapas com base na coordenada X do ponteiro
 * e nos retângulos visuais (`left`, `width`) dos cards renderizados.
 */
export function resolveHorizontalDropIndex(
  pointerClientX: number,
  cardRects: ReadonlyArray<{ left: number; width: number }>,
): number {
  if (cardRects.length === 0) return 0;
  for (let i = 0; i < cardRects.length; i++) {
    const midpoint = cardRects[i].left + cardRects[i].width / 2;
    if (pointerClientX < midpoint) {
      return i;
    }
  }
  return cardRects.length - 1;
}

/**
 * Calcula o deslocamento automático de scroll horizontal (em px por frame) quando o cursor
 * se aproxima das bordas esquerda/direita do container durante um arraste.
 */
export function computeEdgeAutoScrollStep(
  pointerClientX: number,
  containerLeft: number,
  containerRight: number,
  edgeThresholdPx = 80,
  maxSpeedPx = 16,
): number {
  if (containerRight <= containerLeft) return 0;

  const distFromLeft = pointerClientX - containerLeft;
  if (distFromLeft >= 0 && distFromLeft < edgeThresholdPx) {
    const intensity = 1 - distFromLeft / edgeThresholdPx;
    return -Math.max(2, Math.round(intensity * maxSpeedPx));
  }

  const distFromRight = containerRight - pointerClientX;
  if (distFromRight >= 0 && distFromRight < edgeThresholdPx) {
    const intensity = 1 - distFromRight / edgeThresholdPx;
    return Math.max(2, Math.round(intensity * maxSpeedPx));
  }

  return 0;
}

/**
 * Escolhe automaticamente o melhor funil e etapa de destino padrão ao excluir 1 ou mais etapas:
 * 1. Prioriza etapa adjacente (anterior ou próxima) no mesmo funil que não esteja sendo excluída.
 * 2. Caso todas as etapas do funil atual estejam sendo excluídas, escolhe a primeira etapa disponível de outro funil.
 */
export function resolveDefaultStageMigrationTarget(
  pipelines: readonly OrganizablePipeline[],
  deletingStageIds: readonly string[],
  preferredPipelineId?: string | null,
): { targetPipelineId: string; targetStageId: string } | null {
  const deletingSet = new Set(deletingStageIds);

  if (preferredPipelineId) {
    const samePipeline = pipelines.find((p) => p.id === preferredPipelineId);
    if (samePipeline) {
      const ordered = [...samePipeline.stages].sort((a, b) => a.orderIndex - b.orderIndex);
      const remaining = ordered.filter((s) => !deletingSet.has(s.id));
      if (remaining.length > 0) {
        const firstDeletedIdx = ordered.findIndex((s) => deletingSet.has(s.id));
        if (firstDeletedIdx > 0) {
          for (let i = firstDeletedIdx - 1; i >= 0; i--) {
            if (!deletingSet.has(ordered[i].id)) {
              return { targetPipelineId: samePipeline.id, targetStageId: ordered[i].id };
            }
          }
        }
        return { targetPipelineId: samePipeline.id, targetStageId: remaining[0].id };
      }
    }
  }

  for (const pipeline of pipelines) {
    const ordered = [...pipeline.stages].sort((a, b) => a.orderIndex - b.orderIndex);
    const candidate = ordered.find((s) => !deletingSet.has(s.id));
    if (candidate) {
      return { targetPipelineId: pipeline.id, targetStageId: candidate.id };
    }
  }

  return null;
}
