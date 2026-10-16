export interface ContactDealInput {
  dealId?: string;
  newDeal?: {
    title: string;
    pipelineId: string;
    stageId: string;
    customFields?: Record<string, unknown>;
  };
}
