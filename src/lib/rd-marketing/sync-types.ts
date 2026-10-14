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
  outboundEnabled: boolean;
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
  }[];
};
