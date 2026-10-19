export interface ContactDealInput {
  dealId?: string;
  newDeal?: {
    title: string;
    pipelineId: string;
    stageId: string;
    customFields?: Record<string, unknown>;
  };
}

export function isContactDealInputComplete(value?: ContactDealInput | null): boolean {
  if (!value) return false;
  if (value.dealId && value.dealId.trim()) return true;
  if (
    value.newDeal &&
    value.newDeal.title?.trim() &&
    value.newDeal.pipelineId?.trim() &&
    value.newDeal.stageId?.trim()
  ) {
    return true;
  }
  return false;
}

