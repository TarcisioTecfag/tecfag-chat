export type PipelineDivision = "personnalite" | "maquinas";
export type PipelineByDivision = Partial<Record<PipelineDivision, string>>;

export function configuredPipelineId(
  mapping: PipelineByDivision,
  division: string | null | undefined,
): string | null {
  if (division !== "personnalite" && division !== "maquinas") return null;
  return mapping[division] || null;
}

export function belongsToTeamPipeline(
  mapping: PipelineByDivision,
  division: string | null | undefined,
  pipelineId: string,
): boolean {
  return configuredPipelineId(mapping, division) === pipelineId;
}

export function teamStages<T extends { pipelineId: string; excluded?: boolean }>(
  stages: T[],
  mapping: PipelineByDivision,
  division: PipelineDivision,
): T[] {
  const pipelineId = configuredPipelineId(mapping, division);
  return pipelineId
    ? stages.filter((stage) => stage.pipelineId === pipelineId && !stage.excluded)
    : [];
}
