export type RdTestContact = {
  uuid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};
export type RdOutboundScope = "test" | "all";
export type RdCommercialWorkerStatus = {
  startedAt: string | null;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
};
export type RdNotificationData = {
  label: string;
  source: string | null;
  campaign: string | null;
  medium: string | null;
  observedSource: string | null;
  observedCampaign: string | null;
  observedLifecycle: string | null;
  links: string[];
  raw: unknown;
};
export type RdSyncStatus = {
  worker: RdCommercialWorkerStatus;
  testDeals: {
    id: string;
    title: string;
    status: string;
    primaryContact: string | null;
    reason: string;
    latestStatus: string | null;
  }[];
  outboundEnabled: boolean;
  outboundScope: RdOutboundScope;
  testContact: RdTestContact | null;
  currency: string;
  connected: boolean;
  endpoints: {
    id: string;
    kind: string;
    label: string;
    url: string;
    enabled: boolean;
    currentConnection: boolean;
    registrationStatus: string;
    lastError: string | null;
  }[];
  deliveries: {
    id: string;
    dealId: string;
    title: string;
    eventType: string;
    status: string;
    lastError: string | null;
    createdAt: string;
    attempts: number;
    nextRetryAt: string | null;
    sentAt: string | null;
    externalEventId: string | null;
    waitsFor: { id: string; status: string } | null;
  }[];
};
