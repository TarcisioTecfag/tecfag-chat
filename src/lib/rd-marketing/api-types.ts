export type RdIdentifier = "uuid" | "email" | "phone";
export type RdEventType = "CONVERSION" | "OPPORTUNITY";
export type RdApiStatus = {
  encryptionReady: boolean;
  configured: boolean;
  connected: boolean;
  clientId: string;
  callbackUrl: string;
  connectedAt: string | null;
};
export type RdEventView = {
  id: string | null;
  identifier: string | null;
  date: string | null;
  source: string | null;
  campaign: string | null;
  medium?: string | null;
  funnelName?: string | null;
  links: string[];
  raw: unknown;
};
export type RdEventPage = {
  eventType: RdEventType;
  page: number;
  recognized: boolean;
  nextPage: number | null;
  events: RdEventView[];
  raw: unknown;
};
export type RdProbe = {
  contact: {
    uuid: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    raw: unknown;
  };
  pages: RdEventPage[];
};
