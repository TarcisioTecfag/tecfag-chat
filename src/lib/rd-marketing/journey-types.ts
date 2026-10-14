import type { RdEventPage, RdEventView } from "./api-types";

export type JourneyEvent = RdEventView & {
  key: string;
  eventType: "CONVERSION" | "OPPORTUNITY";
  deals: { id: string; title: string }[];
};
export type RdJourney = {
  contactId: string;
  contactName: string;
  snapshotId: string;
  syncedAt: string;
  cached: boolean;
  pages: RdEventPage[];
  events: JourneyEvent[];
  relatedDeals?: {
    id: string;
    title: string;
    status: string;
    value: string | null;
    currency: string;
    pipelineName: string | null;
    stageName: string | null;
    operatorName: string | null;
    createdAt: string;
  }[];
};
